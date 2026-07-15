//! `notesd` library surface.
//!
//! The daemon's logic lives in these modules so both the `notesd` binary
//! (`src/main.rs`) and the integration tests (`tests/`) can assemble a server
//! from the same pieces. See each module's docs, and
//! `docs/notesd-daemon-plan.md` for the overall design.

pub mod auth;
pub mod config;
pub mod index;
pub mod net;
pub mod qr;
pub mod secret;
pub mod server;
pub mod state;
pub mod store;
pub mod tls;
