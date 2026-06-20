// A compact binary AES-GCM container for the per-file at-rest format: one of
// these holds a single note's bytes or a single attachment's bytes, keyed off
// the session `contentKey` (derived once — see `./crypto.ts`). Compared with the
// JSON text `Envelope`, this avoids base64's 33% bloat on image bytes and folds
// a small self-describing header (mime / filename) *inside* the ciphertext, so
// nothing about the attachment leaks on disk and a fetched blob recovers its own
// type without trusting the (opaque) filename.
//
// Layout:
//   magic "NEB1" (4) | flags (1) | ivLen (1) | iv (ivLen) | ciphertext
// where the encrypted plaintext is, before gzip:
//   headerLen (4, little-endian) | header (JSON, UTF-8) | payload bytes
// flags bit 0 = the plaintext was gzip-compressed before encryption.

import { gunzip, gzip } from "./compress.ts";
import { aesDecrypt, aesEncrypt, fromBase64, toBase64 } from "./crypto.ts";

const MAGIC = new Uint8Array([0x4e, 0x45, 0x42, 0x31]); // "NEB1"
const FLAG_GZIP = 0x01;

export type BlobHeader = Record<string, unknown>;

function frameInner(
  header: BlobHeader,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.length + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, headerBytes.length, true);
  out.set(headerBytes, 4);
  out.set(payload, 4 + headerBytes.length);
  return out;
}

function unframeInner(inner: Uint8Array): {
  header: BlobHeader;
  bytes: Uint8Array;
} {
  const view = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  const headerLen = view.getUint32(0, true);
  const headerBytes = inner.subarray(4, 4 + headerLen);
  const header = JSON.parse(
    new TextDecoder().decode(headerBytes),
  ) as BlobHeader;
  const bytes = inner.subarray(4 + headerLen);
  return { header, bytes };
}

/** Seal bytes + a small header into a binary container. */
export async function sealBytes(
  key: CryptoKey,
  payload: Uint8Array,
  header: BlobHeader = {},
  opts: { compress?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const compress = opts.compress ?? true;
  let inner: Uint8Array = frameInner(header, payload);
  let flags = 0;
  if (compress) {
    inner = await gzip(inner);
    flags |= FLAG_GZIP;
  }
  const { iv, ciphertext } = await aesEncrypt(key, inner);
  const out = new Uint8Array(MAGIC.length + 2 + iv.length + ciphertext.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = flags;
  out[MAGIC.length + 1] = iv.length;
  out.set(iv, MAGIC.length + 2);
  out.set(ciphertext, MAGIC.length + 2 + iv.length);
  return out;
}

/** Open a binary container sealed by {@link sealBytes}. */
export async function openBytes(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<{ header: BlobHeader; bytes: Uint8Array }> {
  if (!isBinaryEnvelope(blob)) throw new Error("Not a binary envelope");
  const flags = blob[MAGIC.length]!;
  const ivLen = blob[MAGIC.length + 1]!;
  const ivStart = MAGIC.length + 2;
  const iv = blob.subarray(ivStart, ivStart + ivLen);
  const ciphertext = blob.subarray(ivStart + ivLen);
  let inner = await aesDecrypt(key, iv, ciphertext);
  if (flags & FLAG_GZIP) inner = await gunzip(inner);
  return unframeInner(inner);
}

/** Whether bytes look like a binary container (cheap magic check). */
export function isBinaryEnvelope(blob: Uint8Array): boolean {
  if (blob.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (blob[i] !== MAGIC[i]) return false;
  }
  return true;
}

// -- String wrappers for the text-only `FileStore` (per-note files) ---------
//
// A note's encrypted file rides on the markdown `FileStore`, whose contract is
// UTF-8 text, so its binary container is base64-encoded to a string. The note
// text gzip-compresses well, so the base64 cost lands on already-shrunk bytes.

/** Seal a UTF-8 string into a base64 container string. */
export async function sealString(
  key: CryptoKey,
  text: string,
  header: BlobHeader = {},
): Promise<string> {
  const blob = await sealBytes(key, new TextEncoder().encode(text), header);
  return toBase64(blob);
}

/** Open a base64 container string sealed by {@link sealString}. */
export async function openString(
  key: CryptoKey,
  text: string,
): Promise<{ header: BlobHeader; bytes: Uint8Array }> {
  return openBytes(key, fromBase64(text));
}
