// PIN codes on a namespace: a short code that has to be entered before a
// namespace opens on this device.
//
// **What this is for, and what it is not.** A namespace can be shared by
// several people through one login and one folder. A PIN is the cheap gate for
// that arrangement: it stops the namespace you keep to yourself from opening
// because somebody tapped the wrong row, and it stops a shoulder-surfer or a
// borrowed phone from reading it. It is deliberately a *soft* lock, and the
// UI says so:
//
//   - the verifier lives in `namespaces.json`, which everyone sharing the
//     account can read, so it can be attacked offline;
//   - a code short enough to type on a phone has a small keyspace, so a
//     determined co-user with the file will get through it;
//   - and the notes themselves are still plaintext at rest behind it.
//
// **Encryption is the real protection** — it is per namespace too, it derives
// keys from a passphrase nobody can recover, and the bytes on disk are
// unreadable without it. A PIN is the convenience layer on top; the two
// compose, and the settings copy points at encryption for anything that
// actually matters.
//
// What is stored is a PBKDF2-SHA256 verifier — a random salt, the derived
// bits, and the iteration count — never the code itself. Verification is
// constant-time so a co-user can't learn a prefix by timing the check.

import { fromBase64, toBase64 } from "./crypto.ts";

/** The shortest code accepted. Longer is meaningfully better — see above. */
export const PIN_MIN_LENGTH = 4;

// OWASP 2023 password-storage guidance, matching the document encryption's
// KDF cost. It buys real time against an offline attack on a *long* code; on a
// four-digit one it buys much less, which is why the copy is honest about it.
const PIN_ITERATIONS = 600_000;
const PIN_SALT_BYTES = 16;
const PIN_BITS = 256;

/** The stored verifier for a namespace's PIN. Never contains the code. */
export type NamespacePin = {
  /** Base64 random salt, fresh per PIN. */
  salt: string;
  /** Base64 PBKDF2-SHA256 output over the code and salt. */
  hash: string;
  /** KDF cost, stored so an old verifier keeps verifying after a bump. */
  iterations: number;
};

export function isNamespacePin(value: unknown): value is NamespacePin {
  if (typeof value !== "object" || value === null) return false;
  const pin = value as NamespacePin;
  return (
    typeof pin.salt === "string" &&
    pin.salt.length > 0 &&
    typeof pin.hash === "string" &&
    pin.hash.length > 0 &&
    typeof pin.iterations === "number" &&
    Number.isFinite(pin.iterations) &&
    pin.iterations > 0
  );
}

async function deriveBits(
  code: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    PIN_BITS,
  );
  return new Uint8Array(bits);
}

/** Mint a verifier for a code. Throws on a code shorter than the minimum. */
export async function createNamespacePin(code: string): Promise<NamespacePin> {
  if (code.length < PIN_MIN_LENGTH) {
    throw new Error(`A PIN needs at least ${PIN_MIN_LENGTH} characters`);
  }
  const salt = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await deriveBits(code, salt, PIN_ITERATIONS);
  return {
    salt: toBase64(salt),
    hash: toBase64(hash),
    iterations: PIN_ITERATIONS,
  };
}

/**
 * Whether a code matches a stored verifier. Compares in constant time: a
 * length-or-byte early return would leak how much of a guess was right to
 * anyone who can time the call, which on a short code is most of the work.
 */
export async function verifyNamespacePin(
  code: string,
  stored: NamespacePin,
): Promise<boolean> {
  let expected: Uint8Array;
  try {
    expected = fromBase64(stored.hash);
  } catch {
    return false;
  }
  const actual = await deriveBits(
    code,
    fromBase64(stored.salt),
    stored.iterations,
  );
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= (actual[i] as number) ^ (expected[i] as number);
  }
  return diff === 0;
}
