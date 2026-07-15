//! The pairing payload and its terminal QR code.
//!
//! On startup the daemon prints a QR the app scans to add this backend in one
//! step. The payload is a `notesd://pair?...` URI carrying everything the
//! client needs and nothing it doesn't: the address(es), the SPKI pin to
//! verify TLS against, and the single-use pairing token (or, in `--api-key`
//! mode, the static key). The QR — and the token in it — is a secret shown on
//! the operator's own screen; treat it like one.

/// The secret half of the payload: a single-use pairing token, or a static key.
pub enum Secret {
    Token(String),
    Key(String),
}

pub struct Pairing {
    pub name: String,
    /// `host:port` reachable on the LAN (or loopback).
    pub lan: Option<String>,
    /// `host:port` reachable from outside, when UPnP mapped a port.
    pub wan: Option<String>,
    /// `sha256:<base64url>` SPKI pin.
    pub fingerprint: String,
    pub secret: Secret,
}

impl Pairing {
    /// Render the `notesd://pair?...` URI.
    pub fn to_uri(&self) -> String {
        let mut q: Vec<(&str, String)> = vec![("v", "1".to_string())];
        q.push(("name", self.name.clone()));
        if let Some(lan) = &self.lan {
            q.push(("lan", lan.clone()));
        }
        if let Some(wan) = &self.wan {
            q.push(("wan", wan.clone()));
        }
        q.push(("fp", self.fingerprint.clone()));
        match &self.secret {
            Secret::Token(t) => q.push(("t", t.clone())),
            Secret::Key(k) => q.push(("k", k.clone())),
        }
        let query = q
            .iter()
            .map(|(k, v)| format!("{k}={}", percent_encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("notesd://pair?{query}")
    }

    /// Print the QR plus a human-readable summary to stdout.
    pub fn print(&self) {
        let uri = self.to_uri();
        println!();
        if let Err(err) = qr2term::print_qr(&uri) {
            // Fall back to the raw URI if the terminal can't render the QR.
            tracing::warn!("could not render QR ({err}); printing the URI instead");
        }
        println!();
        println!("  Scan to pair, or paste this into the app:");
        println!("    {uri}");
        println!();
        if let Some(lan) = &self.lan {
            println!("  LAN:  https://{lan}");
        }
        if let Some(wan) = &self.wan {
            println!("  WAN:  https://{wan}");
        }
        println!("  Pin:  {}", self.fingerprint);
        match &self.secret {
            Secret::Token(_) => {
                println!("  Auth: single-use pairing token (this QR is a secret)");
            }
            Secret::Key(_) => {
                println!("  Auth: static API key (this QR is a secret)");
            }
        }
        println!();
    }
}

/// Percent-encode a query value, leaving only the RFC-3986 unreserved set.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_roundtrips_fields() {
        let p = Pairing {
            name: "niclas imac".to_string(),
            lan: Some("192.168.1.20:8443".to_string()),
            wan: None,
            fingerprint: "sha256:abc_-DEF".to_string(),
            secret: Secret::Token("tok123".to_string()),
        };
        let uri = p.to_uri();
        assert!(uri.starts_with("notesd://pair?v=1"));
        assert!(uri.contains("name=niclas%20imac"));
        assert!(uri.contains("lan=192.168.1.20%3A8443"));
        assert!(uri.contains("fp=sha256%3Aabc_-DEF"));
        assert!(uri.contains("t=tok123"));
        assert!(!uri.contains("wan="));
    }
}
