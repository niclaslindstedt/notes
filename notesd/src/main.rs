//! `notesd` — a self-hosted, security-first daemon backend for the notes app.
//!
//! One folder, one user, over TLS. See `docs/notesd-daemon-plan.md` in the repo
//! for the full design; this binary is the daemon half of it. The module split:
//!
//! - [`config`]  — CLI + resolved runtime config.
//! - [`secret`]  — keys, tokens, hashing, constant-time compare.
//! - [`state`]   — durable state dir (cert, roster, revision) outside the folder.
//! - [`tls`]     — self-signed cert + the SPKI pin the client verifies.
//! - [`store`]   — the dumb, path-safe, atomic file store over the folder.
//! - [`index`]   — revision counter + fs-watch + the change broadcast (push).
//! - [`auth`]    — per-device keys, pairing, rate-limit/lockout.
//! - [`net`]     — LAN IP, UPnP, mDNS.
//! - [`qr`]      — the pairing payload and its terminal QR.
//! - [`server`]  — the axum wire protocol.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use clap::Parser;
use notify::{RecursiveMode, Watcher};

use notesd::config::{Cli, MIN_API_KEY_LEN};
use notesd::index::Index;
use notesd::server::AppState;
use notesd::state::StateDir;
use notesd::store::Store;
use notesd::{auth, net, qr, server, tls};

fn main() -> Result<()> {
    let cli = Cli::parse();

    tls::install_crypto_provider();

    let filter = if cli.debug {
        "notesd=debug,info"
    } else {
        "notesd=info,warn"
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| filter.into()),
        )
        .init();

    if let Some(key) = &cli.api_key {
        if key.len() < MIN_API_KEY_LEN {
            bail!(
                "--api-key is too weak: need >= {MIN_API_KEY_LEN} chars, got {}",
                key.len()
            );
        }
    }

    // Prepare everything synchronous *before* daemonising, so the QR lands on
    // the operator's terminal and the fork happens before any tokio thread
    // exists.
    let store = Arc::new(Store::open(&cli.folder).context("opening notes folder")?);
    let state = Arc::new(StateDir::resolve(&cli.folder).context("resolving state dir")?);
    let lan_ip = net::lan_ip();
    let tls_material = tls::load_or_generate(&state.dir, lan_ip).context("TLS material")?;
    let index = Index::bootstrap(&store, state.clone()).context("building index")?;
    let (authenticator, pairing_token) =
        auth::Authenticator::new(state.clone(), cli.api_key.as_deref())
            .context("initialising auth")?;
    let auth = Arc::new(authenticator);

    // Bind now so an ephemeral port is known before we print the QR.
    let requested = cli.port.unwrap_or(0);
    let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), requested);
    let listener = std::net::TcpListener::bind(bind).with_context(|| format!("binding {bind}"))?;
    let port = listener.local_addr()?.port();

    // The QR carries the LAN address; if UPnP maps a port, the WAN pairing URI
    // is logged once the async runtime brings it up.
    let secret = match (&pairing_token, &cli.api_key) {
        (Some(token), _) => qr::Secret::Token(token.clone()),
        (None, Some(key)) => qr::Secret::Key(key.clone()),
        (None, None) => unreachable!("pairing token exists whenever no static key is set"),
    };
    let pairing = qr::Pairing {
        name: cli.display_name(),
        lan: lan_ip.map(|ip| format!("{ip}:{port}")),
        wan: None,
        fingerprint: tls_material.spki_pin.clone(),
        secret,
    };

    print_banner(&cli);
    pairing.print();

    #[cfg(unix)]
    if !cli.follow {
        daemonise(&state)?;
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;

    runtime.block_on(serve(ServeArgs {
        cli,
        store,
        index,
        auth,
        tls_material,
        listener,
        port,
        spki_pin: pairing.fingerprint,
    }))
}

struct ServeArgs {
    cli: Cli,
    store: Arc<Store>,
    index: Arc<Index>,
    auth: Arc<auth::Authenticator>,
    tls_material: tls::TlsMaterial,
    listener: std::net::TcpListener,
    port: u16,
    spki_pin: String,
}

async fn serve(args: ServeArgs) -> Result<()> {
    // Bring reachability up now that we're on the async runtime.
    let reach = net::setup(
        args.port,
        &args.cli.display_name(),
        &args.spki_pin,
        args.cli.no_upnp,
    )
    .await;
    if let Some(wan) = &reach.wan {
        tracing::warn!(
            "UPnP mapped a public port — this daemon is reachable from the internet at https://{wan}"
        );
    }
    if let Some(lan) = &reach.lan {
        tracing::info!("listening on https://{lan}");
    }

    let _watcher = spawn_fs_watch(args.store.clone(), args.index.clone())?;

    let app_state = AppState {
        store: args.store,
        index: args.index,
        auth: args.auth,
    };
    let app = server::router(app_state);

    let rustls = tls::rustls_config(&args.tls_material).await?;
    tracing::info!("notesd ready on port {}", args.port);
    axum_server::from_tcp_rustls(args.listener, rustls)
        .serve(app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .context("server error")
}

/// Watch the folder for out-of-band edits (a second device on a synced folder,
/// or the local folder backend on the same directory) and reconcile the index,
/// which fans the change out to every subscribed client.
fn spawn_fs_watch(store: Arc<Store>, index: Arc<Index>) -> Result<notify::RecommendedWatcher> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .context("creating fs watcher")?;
    watcher
        .watch(store.root(), RecursiveMode::Recursive)
        .context("watching notes folder")?;

    tokio::spawn(async move {
        while rx.recv().await.is_some() {
            // Coalesce a burst of events, then reconcile once off the runtime
            // threads (the rescan does blocking I/O).
            tokio::time::sleep(Duration::from_millis(150)).await;
            while rx.try_recv().is_ok() {}
            let store = store.clone();
            let index = index.clone();
            let _ = tokio::task::spawn_blocking(move || index.rescan(&store)).await;
        }
    });

    Ok(watcher)
}

fn print_banner(cli: &Cli) {
    println!("notesd — self-hosted backend for {}", cli.folder.display());
    if !cli.no_upnp {
        println!(
            "  ⚠ UPnP is ON by default: this maps a port and EXPOSES this machine to the\n    \
             internet. Run with --no-upnp for LAN-only, and reach it over a VPN instead."
        );
    }
}

#[cfg(unix)]
fn daemonise(state: &StateDir) -> Result<()> {
    use daemonize::Daemonize;
    let log_path = state.dir.join("notesd.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("opening log {}", log_path.display()))?;
    let err = log.try_clone()?;
    Daemonize::new()
        .pid_file(state.dir.join("notesd.pid"))
        .stdout(log)
        .stderr(err)
        .start()
        .context("daemonising")?;
    Ok(())
}
