//! Secret material: API keys, pairing tokens, hashing, and constant-time
//! comparison.
//!
//! API keys are 256 bits of CSPRNG output rendered as lowercase RFC-4648
//! base32 (no padding) — the same alphabet the app uses in
//! `src/storage/crypto.ts`, so keys look at home on both sides. Keys are
//! high-entropy, so at rest we store a plain SHA-256 of the key (a slow
//! password KDF buys nothing against a 256-bit random value) and compare in
//! constant time.

use data_encoding::Encoding;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Lowercase RFC-4648 base32, no padding — matches the app's `base32` in
/// `crypto.ts` so refs/keys share one alphabet across the wire.
fn base32_lower() -> Encoding {
    // data_encoding ships BASE32_NOPAD (uppercase). Build the lowercase twin
    // once so we don't depend on the macro crate at runtime.
    let mut spec = data_encoding::Specification::new();
    spec.symbols.push_str("abcdefghijklmnopqrstuvwxyz234567");
    spec.encoding().expect("valid base32 spec")
}

/// Encode bytes as lowercase base32 (no padding).
pub fn b32(bytes: &[u8]) -> String {
    base32_lower().encode(bytes)
}

/// 32 bytes (256 bits) of OS randomness.
pub fn random_32() -> [u8; 32] {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    buf
}

/// A fresh 256-bit API key, base32-encoded (52 chars).
pub fn new_api_key() -> String {
    b32(&random_32())
}

/// A fresh one-time pairing token (128 bits is plenty for a short-lived,
/// single-use, rate-limited secret).
pub fn new_pairing_token() -> String {
    let mut buf = [0u8; 16];
    OsRng.fill_bytes(&mut buf);
    b32(&buf)
}

/// A stable per-device id derived from randomness — used to key the roster.
pub fn new_device_id() -> String {
    let mut buf = [0u8; 8];
    OsRng.fill_bytes(&mut buf);
    b32(&buf)
}

/// Hex SHA-256 of the input — used for at-rest key hashing and content etags.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Constant-time equality over two byte slices. Returns false on length
/// mismatch without an early-return timing signal on the compared bytes.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_distinct_and_sized() {
        let a = new_api_key();
        let b = new_api_key();
        assert_ne!(a, b);
        // 32 bytes -> 52 base32 chars, no padding.
        assert_eq!(a.len(), 52);
        assert!(a
            .chars()
            .all(|c| "abcdefghijklmnopqrstuvwxyz234567".contains(c)));
    }

    #[test]
    fn ct_eq_matches_semantics() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
    }

    #[test]
    fn sha256_is_hex64() {
        let h = sha256_hex(b"hello");
        assert_eq!(h.len(), 64);
        assert_eq!(
            h,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
