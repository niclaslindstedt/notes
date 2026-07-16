//! End-to-end tests over the real TLS server: pairing, the note lifecycle,
//! optimistic-concurrency conflicts, delta sync, and the security invariants
//! (auth required, lockout, path-traversal rejected, plaintext refused).
//!
//! Each test spins the daemon up on an ephemeral loopback port with a temp
//! folder, then drives it with a reqwest client that trusts the daemon's
//! self-signed cert (the moral equivalent of the app pinning its SPKI).

use std::net::SocketAddr;
use std::sync::Arc;

use reqwest::{Certificate, StatusCode};
use tempfile::TempDir;

// Pull the daemon's library modules in as a path dependency isn't set up, so
// the test drives it purely over HTTP against a spawned instance. We re-run the
// binary's server assembly here by importing the crate as a lib would require a
// lib target; instead we boot an equivalent server inline using the public
// modules through the binary's `--api-key` path.

/// Boot a daemon in-process on an ephemeral port with a fixed static key, and
/// return (base_url, api_key, pinned reqwest client, tempdir guard).
async fn boot() -> (String, String, reqwest::Client, TempDir, TempDir) {
    // Isolate both the notes folder and the state dir (XDG_STATE_HOME).
    let notes = TempDir::new().unwrap();
    let state = TempDir::new().unwrap();
    std::env::set_var("XDG_STATE_HOME", state.path());
    notesd::tls::install_crypto_provider();

    let api_key = "test-static-key-that-is-long-enough-xx".to_string();

    // Build the same pieces main() assembles.
    let store = Arc::new(notesd::store::Store::open(notes.path()).unwrap());
    let state_dir = Arc::new(notesd::state::StateDir::resolve(notes.path()).unwrap());
    let tls = notesd::tls::load_or_generate(&state_dir.dir, None).unwrap();
    let index = notesd::index::Index::bootstrap(&store, state_dir.clone()).unwrap();
    let (auth, _tok) = notesd::auth::Authenticator::new(state_dir.clone(), Some(&api_key)).unwrap();
    let auth = Arc::new(auth);

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let cert_pem = tls.cert_pem.clone();
    let app = notesd::server::router(notesd::server::AppState { store, index, auth });
    let rustls = notesd::tls::rustls_config(&tls).await.unwrap();

    tokio::spawn(async move {
        axum_server::from_tcp_rustls(listener, rustls)
            .serve(app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    // Give the listener a moment to accept.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let client = reqwest::Client::builder()
        .add_root_certificate(Certificate::from_pem(cert_pem.as_bytes()).unwrap())
        .build()
        .unwrap();

    (
        format!("https://127.0.0.1:{port}"),
        api_key,
        client,
        notes,
        state,
    )
}

fn bearer(key: &str) -> String {
    format!("Bearer {key}")
}

#[tokio::test]
async fn rev_starts_and_write_bumps_it() {
    let (base, key, client, _notes, _state) = boot().await;

    let rev0: serde_json::Value = client
        .get(format!("{base}/v1/rev"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let before = rev0["rev"].as_u64().unwrap();

    let put = client
        .put(format!("{base}/v1/notes/hello-abc.md"))
        .header("authorization", bearer(&key))
        .body("# hello")
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), StatusCode::OK);
    let body: serde_json::Value = put.json().await.unwrap();
    assert!(body["rev"].as_u64().unwrap() > before);
    assert_eq!(body["etag"].as_str().unwrap().len(), 64);
}

#[tokio::test]
async fn note_roundtrip_and_delta() {
    let (base, key, client, _notes, _state) = boot().await;

    // Write two notes, capturing the rev before the second.
    client
        .put(format!("{base}/v1/notes/one-a.md"))
        .header("authorization", bearer(&key))
        .body("first")
        .send()
        .await
        .unwrap();

    let mid: serde_json::Value = client
        .get(format!("{base}/v1/rev"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mid_rev = mid["rev"].as_u64().unwrap();

    client
        .put(format!("{base}/v1/notes/two-b.md"))
        .header("authorization", bearer(&key))
        .body("second")
        .send()
        .await
        .unwrap();

    // Delta since mid_rev should surface only the second note.
    let delta: serde_json::Value = client
        .get(format!("{base}/v1/notes?since={mid_rev}"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let notes = delta["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0]["ref"], "two-b.md");
    let body_b64 = notes[0]["body_b64"].as_str().unwrap();
    let decoded = data_encoding::BASE64.decode(body_b64.as_bytes()).unwrap();
    assert_eq!(decoded, b"second");

    // Single-note fetch returns raw bytes.
    let raw = client
        .get(format!("{base}/v1/notes/one-a.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(raw.status(), StatusCode::OK);
    assert_eq!(raw.bytes().await.unwrap().as_ref(), b"first");
}

#[tokio::test]
async fn if_match_conflict_returns_current() {
    let (base, key, client, _notes, _state) = boot().await;

    let first = client
        .put(format!("{base}/v1/notes/c-1.md"))
        .header("authorization", bearer(&key))
        .body("v1")
        .send()
        .await
        .unwrap();
    let etag = first.json::<serde_json::Value>().await.unwrap()["etag"]
        .as_str()
        .unwrap()
        .to_string();

    // Overwrite so the stored etag no longer matches `etag`.
    client
        .put(format!("{base}/v1/notes/c-1.md"))
        .header("authorization", bearer(&key))
        .body("v2")
        .send()
        .await
        .unwrap();

    // A conditional PUT against the stale etag must 409 with current bytes.
    let conflict = client
        .put(format!("{base}/v1/notes/c-1.md"))
        .header("authorization", bearer(&key))
        .header("if-match", etag)
        .body("v3")
        .send()
        .await
        .unwrap();
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(conflict.bytes().await.unwrap().as_ref(), b"v2");
}

#[tokio::test]
async fn delete_note_lifecycle() {
    let (base, key, client, _notes, _state) = boot().await;
    client
        .put(format!("{base}/v1/notes/d-1.md"))
        .header("authorization", bearer(&key))
        .body("bye")
        .send()
        .await
        .unwrap();
    let del = client
        .delete(format!("{base}/v1/notes/d-1.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), StatusCode::OK);
    assert_eq!(
        del.json::<serde_json::Value>().await.unwrap()["deleted"],
        true
    );

    let gone = client
        .get(format!("{base}/v1/notes/d-1.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(gone.status(), StatusCode::NOT_FOUND);
}

// -- blobs (namespace-scoped notes + attachments) ---------------------------

#[tokio::test]
async fn blob_roundtrip_at_a_nested_path() {
    let (base, key, client, _notes, _state) = boot().await;

    // Write a note file the directory adapter's FileStore would produce:
    // `notes/<stem>.md` under the default namespace's notes folder.
    let put = client
        .put(format!("{base}/v1/blob/notes/hello-abc.md"))
        .header("authorization", bearer(&key))
        .body("# hello")
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), StatusCode::OK);
    let body: serde_json::Value = put.json().await.unwrap();
    assert_eq!(body["path"], "notes/hello-abc.md");
    assert_eq!(body["etag"].as_str().unwrap().len(), 64);

    // Read it back as raw bytes.
    let got = client
        .get(format!("{base}/v1/blob/notes/hello-abc.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(got.status(), StatusCode::OK);
    assert_eq!(got.bytes().await.unwrap().as_ref(), b"# hello");

    // Delete it; a second delete reports it already gone.
    let del = client
        .delete(format!("{base}/v1/blob/notes/hello-abc.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(
        del.json::<serde_json::Value>().await.unwrap()["deleted"],
        true
    );
    let again = client
        .delete(format!("{base}/v1/blob/notes/hello-abc.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(
        again.json::<serde_json::Value>().await.unwrap()["deleted"],
        false
    );
}

#[tokio::test]
async fn dotfile_sidecars_round_trip_and_list_but_traversal_does_not() {
    let (base, key, client, _notes, _state) = boot().await;

    // The encryption sidecars the directory adapter keeps in the notes folder.
    for path in ["notes/.keyparams.json", "notes/.index.bin"] {
        let put = client
            .put(format!("{base}/v1/blob/{path}"))
            .header("authorization", bearer(&key))
            .body("sidecar")
            .send()
            .await
            .unwrap();
        assert_eq!(
            put.status(),
            StatusCode::OK,
            "sidecar {path} must be writable"
        );
    }

    // They read back and appear in the notes listing (so the adapter tracks them).
    let got = client
        .get(format!("{base}/v1/blob/notes/.keyparams.json"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    assert_eq!(got.bytes().await.unwrap().as_ref(), b"sidecar");

    let list: serde_json::Value = client
        .get(format!("{base}/v1/blobs?prefix=notes/"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let paths: Vec<&str> = list["blobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"notes/.keyparams.json"));
    assert!(paths.contains(&"notes/.index.bin"));

    // A leading dot is fine, but `..` traversal is still rejected.
    let traverse = client
        .put(format!("{base}/v1/blob/notes/..keyparams"))
        .header("authorization", bearer(&key))
        .body("x")
        .send()
        .await
        .unwrap();
    assert_eq!(traverse.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn blob_listing_scopes_to_prefix_and_isolates_namespaces() {
    let (base, key, client, _notes, _state) = boot().await;

    // Two namespaces' notes + one default-namespace attachment.
    for (path, bytes) in [
        ("notes/a-1.md", "a"),
        ("notes/b-2.md", "b"),
        ("work/notes/c-3.md", "c"),
        ("attachments/a-1/pic.png", "img"),
    ] {
        client
            .put(format!("{base}/v1/blob/{path}"))
            .header("authorization", bearer(&key))
            .body(bytes)
            .send()
            .await
            .unwrap();
    }

    // The default namespace's notes listing sees only `notes/…`, not the work
    // namespace's notes nor the attachments — and carries a content etag.
    let list: serde_json::Value = client
        .get(format!("{base}/v1/blobs?prefix=notes/"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let paths: Vec<&str> = list["blobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, vec!["notes/a-1.md", "notes/b-2.md"]);
    assert_eq!(
        list["blobs"][0]["etag"].as_str().unwrap().len(),
        64,
        "note listing carries the per-file etag"
    );

    // The work namespace is scoped by its own prefix.
    let work: serde_json::Value = client
        .get(format!("{base}/v1/blobs?prefix=work/notes/"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let work_paths: Vec<&str> = work["blobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["path"].as_str().unwrap())
        .collect();
    assert_eq!(work_paths, vec!["work/notes/c-3.md"]);

    // The attachment listing (etag=0) returns paths without hashing bytes.
    let att: serde_json::Value = client
        .get(format!("{base}/v1/blobs?prefix=attachments/&etag=0"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(att["blobs"][0]["path"], "attachments/a-1/pic.png");
    assert!(
        att["blobs"][0].get("etag").is_none(),
        "etag=0 omits the content hash"
    );
}

#[tokio::test]
async fn blob_delete_prunes_empty_folders() {
    let (base, key, client, notes, _state) = boot().await;

    client
        .put(format!("{base}/v1/blob/work/notes/x-1.md"))
        .header("authorization", bearer(&key))
        .body("x")
        .send()
        .await
        .unwrap();
    assert!(notes.path().join("work/notes/x-1.md").exists());

    client
        .delete(format!("{base}/v1/blob/work/notes/x-1.md"))
        .header("authorization", bearer(&key))
        .send()
        .await
        .unwrap();
    // The now-empty `work/notes` and `work` folders are pruned, but the folder
    // root survives.
    assert!(!notes.path().join("work").exists());
    assert!(notes.path().exists());
}

#[tokio::test]
async fn blob_cannot_clobber_reserved_settings() {
    let (base, key, client, _notes, _state) = boot().await;
    let resp = client
        .put(format!("{base}/v1/blob/settings.json"))
        .header("authorization", bearer(&key))
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn blob_path_traversal_is_rejected() {
    let (base, key, client, _notes, _state) = boot().await;
    let resp = client
        .put(format!("{base}/v1/blob/notes/..%2f..%2fetc%2fpasswd"))
        .header("authorization", bearer(&key))
        .body("x")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// -- security ---------------------------------------------------------------

#[tokio::test]
async fn no_auth_is_rejected() {
    let (base, _key, client, _notes, _state) = boot().await;
    let resp = client.get(format!("{base}/v1/rev")).send().await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn wrong_key_locks_out_after_repeated_failures() {
    let (base, _key, client, _notes, _state) = boot().await;
    let mut saw_lockout = false;
    for _ in 0..8 {
        let resp = client
            .get(format!("{base}/v1/rev"))
            .header("authorization", bearer("wrong-key"))
            .send()
            .await
            .unwrap();
        if resp.status() == StatusCode::TOO_MANY_REQUESTS {
            saw_lockout = true;
            break;
        }
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
    assert!(
        saw_lockout,
        "expected lockout (429) after repeated bad keys"
    );
}

#[tokio::test]
async fn path_traversal_is_rejected() {
    let (base, key, client, _notes, _state) = boot().await;
    // reqwest won't send raw `..`; encode it so the router sees the segment.
    let resp = client
        .put(format!("{base}/v1/notes/..%2f..%2fetc%2fpasswd"))
        .header("authorization", bearer(&key))
        .body("x")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status() == StatusCode::BAD_REQUEST || resp.status() == StatusCode::NOT_FOUND,
        "traversal must never succeed, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn plaintext_http_is_refused() {
    let (base, key, _client, _notes, _state) = boot().await;
    // Hit the TLS port with a plaintext (http://) client — it must not succeed.
    let plain = reqwest::Client::new();
    let http_url = base.replacen("https://", "http://", 1);
    let result = plain
        .get(format!("{http_url}/v1/rev"))
        .header("authorization", bearer(&key))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;
    assert!(
        result.is_err(),
        "plaintext request must fail against the TLS listener"
    );
}

#[tokio::test]
async fn pairing_mints_a_usable_device_key() {
    // A fresh daemon in pairing mode (no static key) issues a token; redeeming
    // it yields a key that authenticates, and a bad token is rejected.
    let notes = TempDir::new().unwrap();
    let state = TempDir::new().unwrap();
    std::env::set_var("XDG_STATE_HOME", state.path());
    notesd::tls::install_crypto_provider();

    let store = Arc::new(notesd::store::Store::open(notes.path()).unwrap());
    let state_dir = Arc::new(notesd::state::StateDir::resolve(notes.path()).unwrap());
    let tls = notesd::tls::load_or_generate(&state_dir.dir, None).unwrap();
    let index = notesd::index::Index::bootstrap(&store, state_dir.clone()).unwrap();
    let (auth, token) = notesd::auth::Authenticator::new(state_dir.clone(), None).unwrap();
    let token = token.expect("pairing token in pairing mode");
    let auth = Arc::new(auth);

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let cert_pem = tls.cert_pem.clone();
    let app = notesd::server::router(notesd::server::AppState { store, index, auth });
    let rustls = notesd::tls::rustls_config(&tls).await.unwrap();
    tokio::spawn(async move {
        axum_server::from_tcp_rustls(listener, rustls)
            .serve(app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let client = reqwest::Client::builder()
        .add_root_certificate(Certificate::from_pem(cert_pem.as_bytes()).unwrap())
        .build()
        .unwrap();
    let base = format!("https://127.0.0.1:{port}");

    // Bad token → 401.
    let bad = client
        .post(format!("{base}/v1/pair"))
        .json(&serde_json::json!({ "token": "nope", "label": "phone" }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), StatusCode::UNAUTHORIZED);

    // Good token → a key that works.
    let paired: serde_json::Value = client
        .post(format!("{base}/v1/pair"))
        .json(&serde_json::json!({ "token": token, "label": "phone" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let device_key = paired["key"].as_str().unwrap().to_string();

    let ok = client
        .get(format!("{base}/v1/rev"))
        .header("authorization", bearer(&device_key))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
}
