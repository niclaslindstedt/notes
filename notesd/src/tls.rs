//! TLS material: a self-signed certificate generated once and reused across
//! restarts, plus its SPKI SHA-256 fingerprint (the pin the client verifies).
//!
//! There is no public CA in this design. The daemon has no domain, so instead
//! of Let's Encrypt we generate a self-signed cert and hand the client its
//! **SPKI pin** out-of-band (in the QR / encrypted cloud config). The client
//! pins that fingerprint and refuses anything else — which removes the
//! trust-on-first-use window and any CA that could be coerced into
//! mis-issuing. The cert is stable across restarts so the pin never churns.

use std::net::IpAddr;
use std::path::Path;

use anyhow::{Context, Result};
use axum_server::tls_rustls::RustlsConfig;
use rcgen::{CertifiedKey, KeyPair};
use sha2::{Digest, Sha256};

/// Install the process-wide rustls crypto provider (ring). Idempotent: a second
/// call is a no-op. Must run once before any TLS config is built — both the
/// server (axum-server) and any in-process client rely on the process default.
pub fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// The on-disk PEM pair (certificate + private key) plus the derived pin.
pub struct TlsMaterial {
    pub cert_pem: String,
    pub key_pem: String,
    /// `sha256:<base64>` over the DER SubjectPublicKeyInfo — the client pin.
    pub spki_pin: String,
}

/// Load the cert/key from `dir`, or generate a fresh self-signed pair covering
/// `localhost`, `127.0.0.1`, and the machine's LAN IP, then persist it `0600`.
pub fn load_or_generate(dir: &Path, lan_ip: Option<IpAddr>) -> Result<TlsMaterial> {
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        let cert_pem = std::fs::read_to_string(&cert_path)
            .with_context(|| format!("reading {}", cert_path.display()))?;
        let key_pem = std::fs::read_to_string(&key_path)
            .with_context(|| format!("reading {}", key_path.display()))?;
        let key = KeyPair::from_pem(&key_pem).context("parsing stored key")?;
        let spki_pin = spki_pin_from_key(&key);
        return Ok(TlsMaterial {
            cert_pem,
            key_pem,
            spki_pin,
        });
    }

    let mut sans = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    if let Some(ip) = lan_ip {
        sans.push(ip.to_string());
    }
    let CertifiedKey { cert, key_pair } =
        rcgen::generate_simple_self_signed(sans).context("generating self-signed certificate")?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    let spki_pin = spki_pin_from_key(&key_pair);

    write_private(&cert_path, cert_pem.as_bytes())?;
    write_private(&key_path, key_pem.as_bytes())?;

    Ok(TlsMaterial {
        cert_pem,
        key_pem,
        spki_pin,
    })
}

/// `sha256:<base64(SHA-256(SPKI DER))>` — the standard HPKP-style SPKI pin.
fn spki_pin_from_key(key: &KeyPair) -> String {
    let spki_der = key.public_key_der();
    let digest = Sha256::digest(&spki_der);
    // URL-safe, unpadded — the pin rides in the QR's query string.
    format!("sha256:{}", data_encoding::BASE64URL_NOPAD.encode(&digest))
}

/// Build the rustls config axum-server serves from, straight from the PEM pair.
pub async fn rustls_config(material: &TlsMaterial) -> Result<RustlsConfig> {
    RustlsConfig::from_pem(
        material.cert_pem.clone().into_bytes(),
        material.key_pem.clone().into_bytes(),
    )
    .await
    .context("building rustls config from generated PEM")
}

/// Write a file with `0600` perms (owner read/write only). The private key and
/// the cert both live under the state dir, never inside the notes folder.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    std::fs::write(path, bytes).with_context(|| format!("writing {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("chmod 600 {}", path.display()))?;
    }
    Ok(())
}
