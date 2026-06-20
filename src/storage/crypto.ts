// AES-GCM + PBKDF2 crypto used to encrypt the document at rest. Pure helpers —
// no React, no localStorage.
//
// Two shapes live here:
//
//   1. The **self-contained text envelope** (`encryptText`/`decryptEnvelope`) —
//      a JSON object that carries its own salt + KDF params, so it can be
//      decrypted from the password alone with nothing else on hand. This is the
//      whole-document format used by the browser/localStorage backend and the
//      offline cache seal (so an offline reload can verify the passphrase
//      against the cached blob). Readers tell it from plaintext by the
//      `encrypted` discriminator.
//
//   2. The **session keys** (`deriveContentKey`/`deriveFileKey`) — derived
//      ONCE per session from the password plus the document's stored
//      `KeyParams` (salts), then reused for every per-file encrypt/decrypt and
//      every deterministic filename. This is what the per-note / per-attachment
//      at-rest format (see `./crypto-binary.ts`) keys off, so a 500-file
//      migration pays the deliberately-slow 600k-iteration PBKDF2 once, not
//      per file.
//
// Defaults follow OWASP 2023 password-storage guidance: PBKDF2-SHA256 at 600k
// iterations, AES-GCM with a 256-bit key, a fresh random salt per envelope /
// per document, and a fresh 12-byte IV per encryption. The KDF parameters are
// stored (on the envelope, or in `KeyParams`) so future iteration bumps can be
// honored without breaking older blobs.

import { gunzip, gzip } from "./compress.ts";

const ENVELOPE_TAG = "notes.encrypted.v1" as const;
const KEY_PARAMS_TAG = "notes.keyparams.v1" as const;
const DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;
// Bytes of HMAC output kept for a deterministic filename: 16 bytes = 128 bits,
// far more than enough to make a collision negligible, and a tidy 26 base32
// characters.
const REF_BYTES = 16;

export type Envelope = {
  encrypted: typeof ENVELOPE_TAG;
  kdf: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  // Present when the plaintext was gzip-compressed before encryption. Absent on
  // envelopes written by older builds, which `decryptEnvelope` then decodes as
  // raw UTF-8 — so old blobs still open.
  compression?: "gzip";
};

// Coarse phases an encrypt/decrypt passes through, fired so the settings UI can
// flash a one-line "this is what's happening" status while the (deliberately
// slow) 600k-iteration key derivation runs. Optional and side-effect-only —
// the crypto result is unchanged whether or not a callback is supplied.
export type CryptoProgressStep = "derivingKey" | "encrypting" | "decrypting";
export type CryptoProgress = (step: CryptoProgressStep) => void;

// Parse without throwing — returns `undefined` for malformed input so the
// envelope sniffers below can treat "not JSON" the same as "not an envelope".
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// RFC 4648 base32, lowercase, no padding. Lowercase keeps it safe on the
// case-insensitive cloud filesystems (Dropbox) where a base64 name could
// collide, and the alphabet is filesystem-safe everywhere.
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function importPasswordKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
}

async function deriveAesKey(
  password: string,
  salt: BufferSource,
  iterations: number,
): Promise<CryptoKey> {
  const passwordKey = await importPasswordKey(password);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

// -- AES-GCM with an already-derived key -----------------------------------
//
// The per-file format keys off a session `CryptoKey` (derived once), so these
// take the key directly rather than a password. They are the primitive
// `./crypto-binary.ts` and the per-note text seal build on.

/** Encrypt bytes with an AES-GCM key; returns `{ iv, ciphertext }` as bytes. */
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}> {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/** Decrypt AES-GCM bytes with the key + iv they were sealed under. */
export async function aesDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    // AES-GCM authentication failure — wrong key or tampered data.
    throw new Error("Wrong password");
  }
  return new Uint8Array(plaintext);
}

// -- Self-contained text envelope (password-based) -------------------------

export async function encryptText(
  plaintext: string,
  password: string,
  onProgress?: CryptoProgress,
): Promise<string> {
  if (!password) throw new Error("Password is required");
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const compressed = await gzip(new TextEncoder().encode(plaintext));
  onProgress?.("derivingKey");
  const key = await deriveAesKey(
    password,
    salt as BufferSource,
    DEFAULT_ITERATIONS,
  );
  onProgress?.("encrypting");
  const { iv, ciphertext } = await aesEncrypt(key, compressed);
  const envelope: Envelope = {
    encrypted: ENVELOPE_TAG,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: DEFAULT_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    compression: "gzip",
  };
  return JSON.stringify(envelope);
}

export async function decryptEnvelope(
  envelopeText: string,
  password: string,
  onProgress?: CryptoProgress,
): Promise<string> {
  const envelope = parseEnvelope(envelopeText);
  if (!envelope) throw new Error("Not an encrypted envelope");
  if (!password) throw new Error("Password is required");
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  onProgress?.("derivingKey");
  const key = await deriveAesKey(
    password,
    salt as BufferSource,
    envelope.iterations,
  );
  onProgress?.("decrypting");
  const plain = await aesDecrypt(key, iv, ciphertext);
  // Older envelopes (no `compression` field) stored raw UTF-8; newer ones gzip
  // first. Branch on the flag so both decode.
  if (envelope.compression === "gzip")
    return new TextDecoder().decode(await gunzip(plain));
  return new TextDecoder().decode(plain);
}

export function parseEnvelope(text: string): Envelope | null {
  const parsed = safeJsonParse(text);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { encrypted?: unknown }).encrypted === ENVELOPE_TAG
  ) {
    return parsed as Envelope;
  }
  return null;
}

export function isEncryptedEnvelope(text: string): boolean {
  return parseEnvelope(text) !== null;
}

// -- Session keys (derived once) + deterministic naming --------------------

// The non-secret KDF parameters for a document's at-rest encryption: the salts
// the content key and the filename-HMAC key derive from. Stored as a small
// plaintext JSON file beside the notes (salts are not secret), so any device
// with the passphrase can re-derive the same keys and resolve the same opaque
// filenames.
export type KeyParams = {
  v: typeof KEY_PARAMS_TAG;
  iterations: number;
  contentSalt: string;
  fileSalt: string;
};

export function newKeyParams(): KeyParams {
  return {
    v: KEY_PARAMS_TAG,
    iterations: DEFAULT_ITERATIONS,
    contentSalt: toBase64(randomBytes(SALT_LENGTH_BYTES)),
    fileSalt: toBase64(randomBytes(SALT_LENGTH_BYTES)),
  };
}

export function serializeKeyParams(params: KeyParams): string {
  return JSON.stringify(params);
}

export function parseKeyParams(
  text: string | null | undefined,
): KeyParams | null {
  if (!text) return null;
  const parsed = safeJsonParse(text);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { v?: unknown }).v === KEY_PARAMS_TAG
  ) {
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.iterations === "number" &&
      typeof p.contentSalt === "string" &&
      typeof p.fileSalt === "string"
    ) {
      return parsed as KeyParams;
    }
  }
  return null;
}

/** The session AES-GCM key for per-file content, derived once from the params. */
export function deriveContentKey(
  password: string,
  params: KeyParams,
): Promise<CryptoKey> {
  if (!password) throw new Error("Password is required");
  return deriveAesKey(
    password,
    fromBase64(params.contentSalt) as BufferSource,
    params.iterations,
  );
}

/** The session HMAC key used to derive deterministic opaque filenames. */
export async function deriveFileKey(
  password: string,
  params: KeyParams,
): Promise<CryptoKey> {
  if (!password) throw new Error("Password is required");
  const passwordKey = await importPasswordKey(password);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(params.fileSalt) as BufferSource,
      iterations: params.iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

// The session keys an at-rest-encrypted document is read/written with. Derived
// once at unlock / enable and reused for every file.
export type SessionKeys = {
  contentKey: CryptoKey;
  fileKey: CryptoKey;
};

export async function deriveSessionKeys(
  password: string,
  params: KeyParams,
): Promise<SessionKeys> {
  const [contentKey, fileKey] = await Promise.all([
    deriveContentKey(password, params),
    deriveFileKey(password, params),
  ]);
  return { contentKey, fileKey };
}

/**
 * A stable, opaque, collision-resistant name for one logical item, derived
 * from the file-HMAC key and a namespace label + identifier. Same inputs always
 * yield the same name (so a note can find its own attachment, and a re-run of
 * an interrupted migration lands on the same path), while the keyed HMAC hides
 * the original id / filename / structure from anyone reading the cloud folder.
 */
export async function deriveRef(
  fileKey: CryptoKey,
  label: string,
  id: string,
): Promise<string> {
  const msg = new TextEncoder().encode(`${label} ${id}`);
  const sig = await crypto.subtle.sign("HMAC", fileKey, msg as BufferSource);
  return base32(new Uint8Array(sig).slice(0, REF_BYTES));
}
