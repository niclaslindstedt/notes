//! The revision index — the machinery that makes the daemon fast and
//! push-capable, and the reason it beats the polling cloud backends.
//!
//! It keeps, in memory:
//!   - a monotonic **aggregate revision counter** (answers `GET /v1/rev` — the
//!     app's `getRevision()` — in O(1)),
//!   - each note's last-changed revision (answers `?since=` deltas), and
//!   - a broadcast channel of change events (drives the SSE stream — the app's
//!     `watch()`).
//!
//! Two things move the counter: our own writes (recorded inline by the HTTP
//! handlers), and **external** edits picked up by a filesystem watch — a second
//! device writing to a synced folder, or the local folder backend opened
//! directly on the same directory. Both fan out to every subscribed device.
//!
//! On startup the counter is bumped once and every present note is stamped with
//! it, so any client that was synced across a daemon restart performs exactly
//! one reconciling resync — correctness over a marginal efficiency win, since a
//! restart can't otherwise know what changed while it was down.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use tokio::sync::broadcast;

use crate::state::StateDir;
use crate::store::Store;

/// A change fanned out to subscribers. `rev` is the counter *after* the change.
#[derive(Debug, Clone)]
pub struct ChangeEvent {
    pub rev: u64,
    pub changed: Vec<String>,
    pub deleted: Vec<String>,
}

struct Inner {
    rev: u64,
    /// ref → last-changed revision.
    last_rev: HashMap<String, u64>,
    /// ref → current content etag (so an fs event we caused is a no-op rescan).
    etags: HashMap<String, String>,
    /// ref → revision at which it was deleted (a tombstone for `since` deltas).
    tombstones: HashMap<String, u64>,
}

pub struct Index {
    inner: Mutex<Inner>,
    tx: broadcast::Sender<ChangeEvent>,
    state: Arc<StateDir>,
}

impl Index {
    /// Build the index from the current folder contents, bumping the counter
    /// once so synced clients reconcile after a restart.
    pub fn bootstrap(store: &Store, state: Arc<StateDir>) -> Result<Arc<Self>> {
        let mut rev = state.load_rev();
        rev += 1;

        let mut last_rev = HashMap::new();
        let mut etags = HashMap::new();
        for meta in store.list()? {
            last_rev.insert(meta.reference.clone(), rev);
            etags.insert(meta.reference, meta.etag);
        }
        state.save_rev(rev)?;

        let (tx, _rx) = broadcast::channel(256);
        Ok(Arc::new(Self {
            inner: Mutex::new(Inner {
                rev,
                last_rev,
                etags,
                tombstones: HashMap::new(),
            }),
            tx,
            state,
        }))
    }

    /// The current aggregate revision.
    pub fn current_rev(&self) -> u64 {
        self.inner.lock().unwrap().rev
    }

    /// Subscribe to the change stream (one receiver per SSE connection).
    pub fn subscribe(&self) -> broadcast::Receiver<ChangeEvent> {
        self.tx.subscribe()
    }

    /// Record a note write we performed, bump the counter, and fan out.
    pub fn record_write(&self, reference: &str, etag: &str) {
        let event = {
            let mut inner = self.inner.lock().unwrap();
            inner.rev += 1;
            let rev = inner.rev;
            inner.last_rev.insert(reference.to_string(), rev);
            inner.etags.insert(reference.to_string(), etag.to_string());
            inner.tombstones.remove(reference);
            ChangeEvent {
                rev,
                changed: vec![reference.to_string()],
                deleted: vec![],
            }
        };
        self.persist_and_emit(event);
    }

    /// Record a note deletion, bump the counter, and fan out.
    pub fn record_delete(&self, reference: &str) {
        let event = {
            let mut inner = self.inner.lock().unwrap();
            inner.rev += 1;
            let rev = inner.rev;
            inner.last_rev.remove(reference);
            inner.etags.remove(reference);
            inner.tombstones.insert(reference.to_string(), rev);
            ChangeEvent {
                rev,
                changed: vec![],
                deleted: vec![reference.to_string()],
            }
        };
        self.persist_and_emit(event);
    }

    /// Reconcile the in-memory view against disk after a filesystem event.
    /// Emits a single event covering everything that actually moved; a rescan
    /// triggered by our own write finds matching etags and stays silent.
    pub fn rescan(&self, store: &Store) {
        let disk = match store.list() {
            Ok(list) => list,
            Err(err) => {
                tracing::warn!("rescan: listing failed: {err}");
                return;
            }
        };
        let event = {
            let mut inner = self.inner.lock().unwrap();
            let mut changed = Vec::new();
            let mut seen = HashMap::new();
            for meta in &disk {
                seen.insert(meta.reference.clone(), ());
                let differs = inner
                    .etags
                    .get(&meta.reference)
                    .map(|e| e != &meta.etag)
                    .unwrap_or(true);
                if differs {
                    changed.push(meta.reference.clone());
                }
            }
            let deleted: Vec<String> = inner
                .etags
                .keys()
                .filter(|r| !seen.contains_key(*r))
                .cloned()
                .collect();

            if changed.is_empty() && deleted.is_empty() {
                return;
            }

            inner.rev += 1;
            let rev = inner.rev;
            for meta in &disk {
                if changed.contains(&meta.reference) {
                    inner.last_rev.insert(meta.reference.clone(), rev);
                    inner
                        .etags
                        .insert(meta.reference.clone(), meta.etag.clone());
                }
            }
            for r in &deleted {
                inner.last_rev.remove(r);
                inner.etags.remove(r);
                inner.tombstones.insert(r.clone(), rev);
            }
            ChangeEvent {
                rev,
                changed,
                deleted,
            }
        };
        self.persist_and_emit(event);
    }

    /// The set of notes changed and deleted since `since`, plus the current rev.
    /// A `since` of 0 (or any value below every note's stamp) yields the full
    /// set, which is the first-load / full-resync path.
    pub fn delta_since(&self, since: u64) -> (u64, Vec<String>, Vec<String>) {
        let inner = self.inner.lock().unwrap();
        let changed = inner
            .last_rev
            .iter()
            .filter(|(_, &r)| r > since)
            .map(|(k, _)| k.clone())
            .collect();
        let deleted = inner
            .tombstones
            .iter()
            .filter(|(_, &r)| r > since)
            .map(|(k, _)| k.clone())
            .collect();
        (inner.rev, changed, deleted)
    }

    fn persist_and_emit(&self, event: ChangeEvent) {
        if let Err(err) = self.state.save_rev(event.rev) {
            tracing::warn!("persisting revision failed: {err}");
        }
        // A send error just means no subscribers right now — not a failure.
        let _ = self.tx.send(event);
    }
}
