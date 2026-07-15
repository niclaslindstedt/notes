//! Authentication and abuse defence.
//!
//! Two credential shapes:
//!   - **Per-device keys** (default): the QR carries a single-use, short-lived
//!     *pairing token*, not a long-lived key. A device redeems it once over TLS
//!     (`POST /v1/pair`) and is minted its own 256-bit key, recorded in the
//!     roster by SHA-256 so it can be revoked individually.
//!   - **A static key** (`--api-key`): one key for everything, for CI / simple
//!     setups.
//!
//! Every key check is constant-time (see [`crate::state::Roster::accepts`]) and
//! guarded by a per-IP rate limiter with exponential lockout, so an exposed
//! daemon can't be brute-forced. Keys and tokens are never logged.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::sync::Mutex;

use crate::secret::{ct_eq, new_api_key, new_device_id, new_pairing_token, sha256_hex};
use crate::state::{now_secs, Roster, StateDir};

/// Failures before lockout kicks in.
const LOCKOUT_THRESHOLD: u32 = 5;
/// Base lockout once the threshold is crossed (seconds), doubling each further
/// failure up to the cap.
const LOCKOUT_BASE_SECS: u64 = 5;
const LOCKOUT_CAP_SECS: u64 = 15 * 60;
/// How long a startup pairing token stays redeemable.
const PAIRING_TTL_SECS: u64 = 30 * 60;

#[derive(Default, Clone, Copy)]
struct Attempt {
    fails: u32,
    locked_until: u64,
}

struct PairingToken {
    token_hash: String,
    expires_at: u64,
}

pub struct Authenticator {
    roster: Mutex<Roster>,
    state: Arc<StateDir>,
    limiter: Mutex<HashMap<IpAddr, Attempt>>,
    pairing: Mutex<Option<PairingToken>>,
}

/// Why an auth attempt was rejected — mapped to HTTP status by the server.
#[derive(Debug)]
pub enum AuthReject {
    /// No/!valid credential. → 401
    Unauthorized,
    /// Too many failures from this IP; retry after N seconds. → 429
    LockedOut(u64),
}

impl Authenticator {
    /// Build the authenticator. When `static_key` is set, it is folded into the
    /// roster and **no** pairing token is minted (returns `None`). Otherwise a
    /// single-use startup pairing token is minted and its plaintext returned
    /// once, for the QR — only the hash is retained.
    pub fn new(
        state: Arc<StateDir>,
        static_key: Option<&str>,
    ) -> anyhow::Result<(Self, Option<String>)> {
        let mut roster = state.load_roster()?;
        let mut token_plain = None;

        if let Some(key) = static_key {
            roster.static_key_hash = Some(sha256_hex(key.as_bytes()));
            state.save_roster(&roster)?;
        }

        let pairing = if static_key.is_none() {
            let plain = new_pairing_token();
            let token = PairingToken {
                token_hash: sha256_hex(plain.as_bytes()),
                expires_at: now_secs() + PAIRING_TTL_SECS,
            };
            token_plain = Some(plain);
            Some(token)
        } else {
            None
        };

        Ok((
            Self {
                roster: Mutex::new(roster),
                state,
                limiter: Mutex::new(HashMap::new()),
                pairing: Mutex::new(pairing),
            },
            token_plain,
        ))
    }

    /// Reject early if this IP is currently locked out.
    fn check_locked(&self, ip: IpAddr) -> Result<(), AuthReject> {
        let now = now_secs();
        let limiter = self.limiter.lock().unwrap();
        if let Some(a) = limiter.get(&ip) {
            if a.locked_until > now {
                return Err(AuthReject::LockedOut(a.locked_until - now));
            }
        }
        Ok(())
    }

    fn record_failure(&self, ip: IpAddr) {
        let now = now_secs();
        let mut limiter = self.limiter.lock().unwrap();
        let a = limiter.entry(ip).or_default();
        a.fails = a.fails.saturating_add(1);
        if a.fails >= LOCKOUT_THRESHOLD {
            let over = a.fails - LOCKOUT_THRESHOLD;
            let backoff = LOCKOUT_BASE_SECS
                .saturating_mul(1u64 << over.min(20))
                .min(LOCKOUT_CAP_SECS);
            a.locked_until = now + backoff;
        }
    }

    fn record_success(&self, ip: IpAddr) {
        let mut limiter = self.limiter.lock().unwrap();
        limiter.remove(&ip);
    }

    /// Verify a bearer key from `ip`. Applies rate limiting and lockout.
    pub fn verify(&self, ip: IpAddr, presented: &str) -> Result<(), AuthReject> {
        self.check_locked(ip)?;
        let ok = self.roster.lock().unwrap().accepts(presented);
        if ok {
            self.record_success(ip);
            Ok(())
        } else {
            self.record_failure(ip);
            Err(AuthReject::Unauthorized)
        }
    }

    /// Redeem a pairing token for a freshly minted device key. The token is
    /// single-use (consumed on success) and rate-limited like any other
    /// credential. Returns the new key (shown to the device once).
    pub fn redeem_pairing(
        &self,
        ip: IpAddr,
        token: &str,
        label: &str,
    ) -> Result<String, AuthReject> {
        self.check_locked(ip)?;

        let presented_hash = sha256_hex(token.as_bytes());
        let mut guard = self.pairing.lock().unwrap();
        let valid = matches!(
            guard.as_ref(),
            Some(t) if t.expires_at > now_secs()
                && ct_eq(t.token_hash.as_bytes(), presented_hash.as_bytes())
        );
        if !valid {
            drop(guard);
            self.record_failure(ip);
            return Err(AuthReject::Unauthorized);
        }
        *guard = None; // single-use: consume it
        drop(guard);
        self.record_success(ip);

        let key = new_api_key();
        let id = new_device_id();
        let mut roster = self.roster.lock().unwrap();
        roster.add_device(id, label.to_string(), &key, now_secs());
        if let Err(err) = self.state.save_roster(&roster) {
            tracing::error!("saving roster after pairing failed: {err}");
        }
        Ok(key)
    }

    /// Revoke a device by id. Returns whether it existed.
    pub fn revoke_device(&self, id: &str) -> bool {
        let mut roster = self.roster.lock().unwrap();
        let removed = roster.revoke(id);
        if removed {
            if let Err(err) = self.state.save_roster(&roster) {
                tracing::error!("saving roster after revoke failed: {err}");
            }
        }
        removed
    }

    /// A redacted snapshot of the device roster for the management endpoint —
    /// ids/labels/timestamps only, never key material.
    pub fn devices(&self) -> Vec<(String, String, u64)> {
        self.roster
            .lock()
            .unwrap()
            .devices
            .iter()
            .map(|d| (d.id.clone(), d.label.clone(), d.created_at))
            .collect()
    }
}
