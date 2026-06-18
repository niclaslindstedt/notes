// Base64URL (RFC 4648 §5) encode/decode over raw bytes. Used by the OAuth
// PKCE flow (verifier + challenge, in `storage/oauth-pkce.ts`), which needs
// the URL-safe alphabet (`-`/`_`) with padding stripped so the output drops
// into a URL query without further escaping. A pure leaf module — depends
// only on the `btoa`/`atob` globals — so any layer may import it.

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  // `atob` tolerates the missing `=` padding the encoder strips, so only
  // the alphabet needs restoring to standard base64 before decoding.
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
