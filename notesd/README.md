# notesd

A self-hosted, security-first daemon backend for the
[notes](https://github.com/niclaslindstedt/notes) app. It's the fast,
push-capable alternative to the Dropbox / Google Drive backends: because we own
both ends of the wire, there's no OAuth token dance, notes load and save over a
LAN/loopback round trip, and changes are **pushed** to every device instead of
polled.

> Design rationale, threat model, and roadmap live in
> [`../docs/notesd-daemon-plan.md`](../docs/notesd-daemon-plan.md). This README
> is the operator's manual for the daemon that plan describes.

## What it is

- **One folder, one user.** `notesd /path/to/folder` serves exactly one folder
  for one user. To host a second user, start a second `notesd` on a second
  folder. There is no user database — that missing surface is deliberate.
- **A dumb folder.** The daemon stores whatever bytes the client sends and
  never parses a note or opens an envelope. The on-disk layout is byte
  compatible with the app's local **folder** backend (one file per note,
  `attachments/`, `settings.json`), so the same directory can also be opened
  directly.
- **Security first.** TLS 1.3 only (no plaintext listener anywhere), a
  self-signed certificate whose **SPKI fingerprint is pinned** by the client
  out-of-band via the QR, **per-device revocable keys**, constant-time auth, and
  per-IP rate-limiting with lockout.

## Install & run

Requires a Rust toolchain (1.90+).

```sh
cargo build --release          # -> target/release/notesd
./target/release/notesd ~/my-notes
```

On startup it prints a QR code. Scan it in the notes app (**Add backend →
Self-hosted**) to pair the device, or paste the `notesd://pair?…` URI.

### Flags

| Flag | Meaning |
| ---- | ------- |
| `-f, --follow` | Stay in the foreground and stream logs (default: daemonise). |
| `--debug` | Verbose logging. Secrets are never logged at any level. |
| `--port <n>` | Force a TCP port (otherwise an ephemeral one is chosen). |
| `--api-key <key>` | Use one static key (≥ 32 chars) instead of per-device pairing. For CI / simple setups. |
| `--no-upnp` | Disable UPnP and run LAN-only (discoverable via mDNS). |
| `--name <label>` | Label shown in the app's backend list (default: hostname). |

```sh
notesd ~/my-notes                       # pair by QR, UPnP-open, backgrounded
notesd ~/my-notes -f --no-upnp          # foreground, LAN-only
notesd ~/my-notes --port 8443 --api-key "$(head -c32 /dev/urandom | base64)"
```

> ⚠ **UPnP is on by default** and maps a port that **exposes this machine to
> the internet**. The daemon says so at startup. For the tightest posture, run
> `--no-upnp` and reach it over a private overlay (WireGuard / Tailscale).

## Where state lives

Nothing operator-side is kept in the notes folder (it stays dumb). The cert,
the hashed device-key roster, and the persisted revision counter live under
`$XDG_STATE_HOME/notesd/<hash-of-folder-path>/` (default
`~/.local/state/notesd/…`), `0600`. The cert is stable across restarts so the
pin never churns.

## Wire protocol (v1)

Every route requires `Authorization: Bearer <key>` over TLS, except
`POST /v1/pair` (which carries the pairing token). Notes travel base64-encoded
because they may be ciphertext.

| Method & path | Purpose |
| ------------- | ------- |
| `GET /v1/rev` | Current aggregate revision (cheap change probe). |
| `GET /v1/notes?since=N` | Every note changed since rev `N` (bodies inline) + refs deleted since `N`. `since=0` is a full load. |
| `GET /v1/notes/{ref}` | One note's raw bytes (lazy fetch). |
| `PUT /v1/notes/{ref}` | Write; honours `If-Match: <etag>` → `409` + current bytes on mismatch. |
| `DELETE /v1/notes/{ref}` | Delete a note. |
| `POST /v1/batch` | Coalesce many writes/deletes into one round trip (per-item results). |
| `GET /v1/blobs?prefix=&etag=` | List every file under a folder prefix (`notes/`, `attachments/`, `<slug>/notes/`, …) as `{path, etag}`; `etag=0` omits the hash. The directory adapter's per-namespace `FileStore` / `AttachmentStore` scope on this. |
| `GET/PUT/DELETE /v1/blob/{*path}` | Read/write/delete one file at any namespace-scoped relative path — a note or an externalised attachment. |
| `GET/PUT /v1/settings/{name}` | `settings.json` / `namespaces.json`. |
| `GET /v1/events` | SSE stream of `{rev, changed, deleted}` change events — the push. |
| `POST /v1/pair` | Redeem a one-time pairing token → a per-device key. |
| `GET /v1/devices`, `DELETE /v1/devices/{id}` | Roster management / revocation. |

## Running at boot

Sample unit files are in [`dist/`](dist/): a `systemd` service (Linux) and a
`launchd` plist (macOS). Edit the folder path and install per the comments at
the top of each.

## Development

```sh
cargo build       # debug build
cargo test        # unit + end-to-end TLS integration tests
cargo fmt         # format
cargo clippy      # lint
```

The integration tests (`tests/protocol.rs`) boot a real TLS server on an
ephemeral loopback port and drive it with a cert-trusting client — covering the
note lifecycle, `If-Match` conflicts, delta sync, pairing, and the security
invariants (auth required, lockout, path-traversal rejected, plaintext
refused).
