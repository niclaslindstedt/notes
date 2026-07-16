//! The HTTP surface: the bespoke, per-note wire protocol the app's `notesd`
//! adapter speaks, tuned for exactly the load/save shape the app produces.
//!
//! - `GET /v1/rev` — the aggregate revision (`getRevision()`), O(1).
//! - `GET /v1/notes?since=N` — one request returning every note changed since
//!   `N` *with its body inline*, plus the refs deleted since `N`
//!   (`load(previous)`). This is the delta that replaces "list + N GETs".
//! - `GET /v1/notes/{ref}` — one note's raw bytes (`fetchNoteBody()`).
//! - `PUT /v1/notes/{ref}` with `If-Match` — write; `409` + current bytes on an
//!   etag mismatch (`save()` → `ConflictError`, driving keep-mine/keep-theirs).
//! - `POST /v1/batch` — coalesce a burst of writes/deletes into one round trip.
//! - `GET /v1/blobs?prefix=&etag=` — list every file under a folder prefix
//!   (`notes/`, `attachments/`, `<slug>/notes/`, …), the listing the directory
//!   adapter's `FileStore` / `AttachmentStore` scope per namespace.
//! - `GET/PUT/DELETE /v1/blob/{*path}` — read/write/delete one file at any
//!   namespace-scoped relative path (a note or an externalised attachment).
//! - `GET/PUT /v1/settings/{name}` — `settings.json` / `namespaces.json`.
//! - `GET /v1/events` — an SSE stream of change events (`watch()`), the push
//!   the cloud backends structurally can't offer.
//! - `POST /v1/pair` — redeem a pairing token for a per-device key (the only
//!   route not behind bearer auth; it carries its own credential).
//! - `GET /v1/devices`, `DELETE /v1/devices/{id}` — roster management.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{middleware, Json, Router};
use data_encoding::BASE64;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::auth::{AuthReject, Authenticator};
use crate::index::Index;
use crate::store::{Store, StoreError};

/// 32 MiB — comfortably fits a large note or a pasted image while capping a
/// single request so a client can't exhaust memory.
const MAX_BODY: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub index: Arc<Index>,
    pub auth: Arc<Authenticator>,
}

/// Build the full router with the auth middleware applied to everything but
/// `POST /v1/pair`.
pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/rev", get(get_rev))
        .route("/v1/notes", get(list_notes))
        .route(
            "/v1/notes/{reference}",
            get(get_note).put(put_note).delete(delete_note),
        )
        .route("/v1/batch", post(batch))
        .route("/v1/blobs", get(list_blobs))
        .route(
            "/v1/blob/{*path}",
            get(get_blob).put(put_blob).delete(delete_blob),
        )
        .route("/v1/settings/{name}", get(get_settings).put(put_settings))
        .route("/v1/events", get(events))
        .route("/v1/devices", get(list_devices))
        .route("/v1/devices/{id}", axum::routing::delete(revoke_device))
        .layer(middleware::from_fn_with_state(state.clone(), auth_mw));

    let public = Router::new().route("/v1/pair", post(pair));

    Router::new()
        .merge(protected)
        .merge(public)
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .with_state(state)
}

// -- auth middleware --------------------------------------------------------

async fn auth_mw(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: axum::extract::Request,
    next: middleware::Next,
) -> Response {
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let Some(key) = presented else {
        return AppError::Unauthorized.into_response();
    };
    match state.auth.verify(peer.ip(), &key) {
        Ok(()) => next.run(req).await,
        Err(rej) => AppError::from(rej).into_response(),
    }
}

// -- notes ------------------------------------------------------------------

async fn get_rev(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "rev": state.index.current_rev() }))
}

#[derive(Deserialize)]
struct SinceQuery {
    since: Option<u64>,
}

#[derive(Serialize)]
struct WireNote {
    #[serde(rename = "ref")]
    reference: String,
    etag: String,
    /// The note's bytes, base64-encoded (notes may be ciphertext, so never
    /// assume UTF-8 on the wire).
    body_b64: String,
}

async fn list_notes(
    State(state): State<AppState>,
    Query(q): Query<SinceQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (rev, changed, deleted) = state.index.delta_since(q.since.unwrap_or(0));
    let mut notes = Vec::with_capacity(changed.len());
    for reference in changed {
        if let Some(bytes) = state.store.read_note(&reference)? {
            let etag = crate::secret::sha256_hex(&bytes);
            notes.push(WireNote {
                body_b64: BASE64.encode(&bytes),
                etag,
                reference,
            });
        }
    }
    Ok(Json(
        json!({ "rev": rev, "notes": notes, "deleted": deleted }),
    ))
}

async fn get_note(
    State(state): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Response, AppError> {
    match state.store.read_note(&reference)? {
        Some(bytes) => {
            let etag = crate::secret::sha256_hex(&bytes);
            let mut headers = HeaderMap::new();
            headers.insert(header::ETAG, etag.parse().unwrap());
            headers.insert(
                header::CONTENT_TYPE,
                "application/octet-stream".parse().unwrap(),
            );
            Ok((StatusCode::OK, headers, bytes).into_response())
        }
        None => Err(AppError::NotFound),
    }
}

async fn put_note(
    State(state): State<AppState>,
    Path(reference): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    if let Some(expected) = if_match(&headers) {
        let current = state.store.note_etag(&reference)?;
        if current.as_deref() != Some(expected.as_str()) && !(expected == "*" && current.is_some())
        {
            // Someone else moved this note. Hand back the current bytes so the
            // client can resolve (keep-mine / keep-theirs) — the app's
            // `ConflictError` path.
            let bytes = state.store.read_note(&reference)?.unwrap_or_default();
            let etag = current.unwrap_or_default();
            return Ok(conflict_response(bytes, etag));
        }
    }
    let etag = state.store.write_note(&reference, &body)?;
    state.index.record_write(&reference, &etag);
    Ok(Json(json!({
        "ref": reference,
        "etag": etag,
        "rev": state.index.current_rev(),
    }))
    .into_response())
}

async fn delete_note(
    State(state): State<AppState>,
    Path(reference): Path<String>,
) -> Result<Response, AppError> {
    let existed = state.store.delete_note(&reference)?;
    if existed {
        state.index.record_delete(&reference);
    }
    Ok(Json(json!({
        "ref": reference,
        "deleted": existed,
        "rev": state.index.current_rev(),
    }))
    .into_response())
}

// -- batch ------------------------------------------------------------------

#[derive(Deserialize)]
struct BatchBody {
    #[serde(default)]
    writes: Vec<BatchWrite>,
    #[serde(default)]
    deletes: Vec<String>,
}

#[derive(Deserialize)]
struct BatchWrite {
    reference: String,
    body_b64: String,
    if_match: Option<String>,
}

/// Coalesce a burst of edits into one round trip. Applied per-item (not a
/// cross-file transaction — a plain folder has no such primitive); each item
/// reports its own result, so a conflict on one note doesn't sink the rest.
async fn batch(
    State(state): State<AppState>,
    Json(body): Json<BatchBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut results = Vec::new();
    for w in body.writes {
        let bytes = match BASE64.decode(w.body_b64.as_bytes()) {
            Ok(b) => b,
            Err(_) => {
                results.push(json!({ "ref": w.reference, "error": "bad base64" }));
                continue;
            }
        };
        if let Some(expected) = &w.if_match {
            let current = state.store.note_etag(&w.reference)?;
            if current.as_deref() != Some(expected.as_str()) {
                results.push(json!({
                    "ref": w.reference, "conflict": true, "etag": current,
                }));
                continue;
            }
        }
        let etag = state.store.write_note(&w.reference, &bytes)?;
        state.index.record_write(&w.reference, &etag);
        results.push(json!({ "ref": w.reference, "etag": etag }));
    }
    for reference in body.deletes {
        let existed = state.store.delete_note(&reference)?;
        if existed {
            state.index.record_delete(&reference);
        }
        results.push(json!({ "ref": reference, "deleted": existed }));
    }
    Ok(Json(
        json!({ "rev": state.index.current_rev(), "results": results }),
    ))
}

// -- blobs (notes + attachments, namespace-scoped) --------------------------

#[derive(Deserialize)]
struct BlobListQuery {
    /// Folder path the listing is scoped to (`notes/`, `attachments/`,
    /// `<slug>/notes/`, …). Absent lists the whole folder.
    prefix: Option<String>,
    /// `0` skips the content hash — an attachment listing wants only paths and
    /// shouldn't read every image's bytes. Any other value (or absent) includes
    /// the etag the note listing keys its per-file revision off.
    etag: Option<u8>,
}

async fn list_blobs(
    State(state): State<AppState>,
    Query(q): Query<BlobListQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let prefix = q.prefix.unwrap_or_default();
    let with_etag = q.etag.unwrap_or(1) != 0;
    let blobs: Vec<_> = state
        .store
        .list_blobs(&prefix, with_etag)?
        .into_iter()
        .map(|m| {
            if with_etag {
                json!({ "path": m.reference, "etag": m.etag })
            } else {
                json!({ "path": m.reference })
            }
        })
        .collect();
    Ok(Json(json!({ "blobs": blobs })))
}

async fn get_blob(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response, AppError> {
    match state.store.read_blob(&path)? {
        Some(bytes) => {
            let etag = crate::secret::sha256_hex(&bytes);
            let mut headers = HeaderMap::new();
            headers.insert(header::ETAG, etag.parse().unwrap());
            headers.insert(
                header::CONTENT_TYPE,
                "application/octet-stream".parse().unwrap(),
            );
            Ok((StatusCode::OK, headers, bytes).into_response())
        }
        None => Err(AppError::NotFound),
    }
}

async fn put_blob(
    State(state): State<AppState>,
    Path(path): Path<String>,
    body: Bytes,
) -> Result<Response, AppError> {
    let etag = state.store.write_blob(&path, &body)?;
    state.index.record_write(&path, &etag);
    Ok(Json(json!({
        "path": path,
        "etag": etag,
        "rev": state.index.current_rev(),
    }))
    .into_response())
}

async fn delete_blob(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response, AppError> {
    let existed = state.store.delete_blob(&path)?;
    if existed {
        state.index.record_delete(&path);
    }
    Ok(Json(json!({
        "path": path,
        "deleted": existed,
        "rev": state.index.current_rev(),
    }))
    .into_response())
}

// -- settings ---------------------------------------------------------------

async fn get_settings(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Response, AppError> {
    match state.store.read_settings(&name)? {
        Some(bytes) => Ok((StatusCode::OK, bytes).into_response()),
        None => Err(AppError::NotFound),
    }
}

async fn put_settings(
    State(state): State<AppState>,
    Path(name): Path<String>,
    body: Bytes,
) -> Result<Response, AppError> {
    state.store.write_settings(&name, &body)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// -- events (SSE) -----------------------------------------------------------

async fn events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.index.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|item| match item {
        Ok(ev) => {
            let payload = json!({
                "rev": ev.rev,
                "changed": ev.changed,
                "deleted": ev.deleted,
            });
            Some(Ok(Event::default()
                .event("change")
                .data(payload.to_string())))
        }
        // A lagged receiver just means this connection fell behind; the client
        // recovers with a `since=` delta, so drop the missed frame quietly.
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// -- pairing & devices ------------------------------------------------------

#[derive(Deserialize)]
struct PairBody {
    token: String,
    #[serde(default)]
    label: Option<String>,
}

async fn pair(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<PairBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let label = body.label.unwrap_or_else(|| "device".to_string());
    let key = state
        .auth
        .redeem_pairing(peer.ip(), &body.token, &label)
        .map_err(AppError::from)?;
    Ok(Json(json!({ "key": key })))
}

async fn list_devices(State(state): State<AppState>) -> Json<serde_json::Value> {
    let devices: Vec<_> = state
        .auth
        .devices()
        .into_iter()
        .map(|(id, label, created_at)| json!({ "id": id, "label": label, "createdAt": created_at }))
        .collect();
    Json(json!({ "devices": devices }))
}

async fn revoke_device(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let removed = state.auth.revoke_device(&id);
    Json(json!({ "id": id, "revoked": removed }))
}

// -- helpers & errors -------------------------------------------------------

fn if_match(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string())
}

fn conflict_response(bytes: Vec<u8>, etag: String) -> Response {
    let mut headers = HeaderMap::new();
    if let Ok(v) = etag.parse() {
        headers.insert(header::ETAG, v);
    }
    headers.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    (StatusCode::CONFLICT, headers, bytes).into_response()
}

/// The daemon's error taxonomy, mapped to HTTP status. Errors carry no
/// internal detail to the client beyond a short message.
enum AppError {
    NotFound,
    BadRequest(String),
    Unauthorized,
    LockedOut(u64),
    Internal(anyhow::Error),
}

impl From<StoreError> for AppError {
    fn from(e: StoreError) -> Self {
        match e {
            // A rejected/invalid name (bad ref, traversal) is the client's
            // fault; a real I/O failure is ours.
            StoreError::Invalid(msg) => AppError::BadRequest(msg),
            StoreError::Io(io) => AppError::Internal(anyhow::Error::new(io)),
        }
    }
}

impl From<AuthReject> for AppError {
    fn from(r: AuthReject) -> Self {
        match r {
            AuthReject::Unauthorized => AppError::Unauthorized,
            AuthReject::LockedOut(secs) => AppError::LockedOut(secs),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found").into_response(),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
            AppError::LockedOut(secs) => {
                let mut headers = HeaderMap::new();
                headers.insert(header::RETRY_AFTER, secs.to_string().parse().unwrap());
                (StatusCode::TOO_MANY_REQUESTS, headers, "locked out").into_response()
            }
            AppError::Internal(err) => {
                tracing::error!("internal error: {err:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}
