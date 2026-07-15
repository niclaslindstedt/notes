# `notesd` — a self-hosted daemon backend for notes

> **Status: the daemon is built** (roadmap phases 1–5). The Rust daemon lives
> in [`../notesd/`](../notesd/README.md) — TLS + SPKI pin, per-device pairing,
> the dumb file store, the revision index + fs-watch, SSE push, delta sync,
> UPnP/mDNS, and the QR on startup, with unit + end-to-end TLS integration
> tests. Still to come: the frontend `StorageAdapter` + pairing UI (phase 6)
> and the cloud config plane (phase 7). Security is the headline requirement —
> the whole reason to self-host is that a home machine is more trustworthy than
> a third party, so the self-hosted path has to be *water tight* or it defeats
> its own purpose.
>
> **Confirmed build decisions:** Rust · per-device revocable keys · UPnP-open
> by default · monorepo `notesd/`.

## Why this exists

The two cloud backends are correct but unpleasant:

- **Google Drive** — GIS popup tokens are short-lived and ship no refresh
  token, so the app raises `AuthError` and forces a **Reconnect** constantly
  (see `src/storage/adapter.ts`, `gdrive/`).
- **Dropbox** — works, but every note is a separate file request against a
  rate-limited remote, so it is *slow* and coalesces saves behind a ~1s
  debounce.

Neither can **push**: the app has a `watch()` capability in the adapter
contract, but the cloud backends can't cheaply deliver out-of-band change
events, so multi-device sync leans on polling `getRevision()`.

`notesd` fixes all three at once because we own both ends of the wire:

- **No token dance** — pair once, per-device keys after that.
- **Fast** — a LAN/loopback round trip instead of a rate-limited public API,
  one batched delta request instead of N file GETs.
- **Real push** — a server-sent-events stream so a save on one device lands
  on another in milliseconds, finally exercising `watch()` for real.

## Goals and non-goals

**Goals**

- A single self-contained binary that runs on macOS and Linux.
- `notesd /home/niclas/my-notes` — point it at a folder and go.
- Prints a **QR code** on startup that the mobile/desktop app scans to add
  the backend (endpoint + pairing token + certificate pin in one scan).
- Optimised for the exact load/save shape the app produces (see
  *Access patterns* below), not a generic file API.
- **Encrypted in transit, always.** No plaintext HTTP, ever, on any interface.
- The storage folder is **dumb**: it stores whatever bytes the client sends
  and neither knows nor cares whether the client encrypts them.
- **UPnP** port-mapping so a home box is reachable from outside without
  hand-configuring a router — on by default, with the internet-exposure risk
  stated loudly and a `--no-upnp` LAN-only escape hatch.
- Connection details (endpoint, key, pin) can be stashed in Dropbox / Google
  Drive as a **configuration** document — plaintext, or encrypted with the
  app's existing envelope — so a new device discovers the daemon without a QR
  scan.

**Non-goals**

- **Not a `StorageAdapter` re-implementation on the daemon side.** The daemon
  speaks a bespoke, purpose-built HTTP protocol. (The *frontend* still wraps
  that protocol in a `StorageAdapter` — see *Frontend integration* — because
  that contract already has every hook a smart backend wants: delta `load`,
  `watch`, `getRevision`, `fetchNoteBody`, `watchUploads`. We finally get to
  use all of them.)
- **Not multi-tenant.** One daemon serves **one folder for one user** (a
  roster of per-device keys under that user). Hosting a second user is "start a
  second `notesd` on a second folder." No user database, no roles — that
  missing surface is a security feature, not a gap.
- **Not a notes-format authority.** The daemon never parses a note, never runs
  the migration chain, never touches the crypto envelope. That all stays
  client-side in `src/domain` and `src/storage`.

## Two planes: configuration vs. data

The design splits cleanly into two independent planes. Keeping them separate
is what lets us have *encrypted config on a third party* and *plaintext data
at home* simultaneously — the user's exact stated preference.

| Plane | What it holds | Where it lives | Encryption |
| ----- | ------------- | -------------- | ---------- |
| **Config plane** | *How to reach the daemon*: host(s), port, cert pin, device key, display name | Dropbox / Drive app folder (a small `notesd.json`), **or** transferred by QR | Optional — plaintext or the app's `notes.encrypted.v1` envelope. Because a device key lives here, encrypting it is the recommended default when it sits on a third party. |
| **Data plane** | *The notes themselves* + attachments + `settings.json` / `namespaces.json` | The self-hosted folder `notesd` was pointed at | Optional and **client-side** — the daemon stores opaque bytes. Plaintext is a legitimate choice at home ("we trust our own computer"). |

The four combinations are all valid and independently chosen:

| Config plane | Data plane | When |
| ------------ | ---------- | ---- |
| encrypted in Dropbox | plaintext at home | **the user's stated default** — hide the key from Dropbox, trust the home disk |
| encrypted in Dropbox | encrypted at home | maximum paranoia / a shared/rented host |
| QR only (no cloud) | plaintext at home | fully offline homelab, LAN-only |
| plaintext in Dropbox | encrypted at home | config isn't a single point of failure because keys are per-device & revocable (see *Pairing*) |

## Security model — the water-tight core

Everything below is load-bearing. Treat a regression in any of it as a
release blocker.

### Transport: TLS 1.3 + certificate pinning, no public CA

A home IP has no domain and no CA-signed certificate, and we do **not** want to
depend on Let's Encrypt / DNS plumbing. Instead:

1. On first run the daemon generates a **self-signed certificate** (P-256 or
   Ed25519) and stores it in its state dir (key file `0600`). It is stable
   across restarts so the pin doesn't churn.
2. The daemon computes the **SPKI SHA-256 fingerprint** of that cert and puts
   it in the QR / config payload.
3. The client **pins** that fingerprint and refuses any cert that doesn't
   match.

This is *stronger* than public-CA trust: the pin is transferred out-of-band
(QR shown on the operator's own screen, or an encrypted cloud config), so
there is **no trust-on-first-use window and no CA that can be coerced into
mis-issuing**. A MITM would need the exact key on the box. TLS 1.3 only;
modern cipher suites only; HTTP is never served, on any interface (a plain
`:80`/`http://` listener does not exist in the binary).

### Authentication: per-device revocable keys

- The QR carries a *short-lived one-time pairing token*, not a long-lived key.
  A device redeems the token over TLS (`POST /v1/pair`) and the daemon mints
  that device its **own** 256-bit API key (CSPRNG output, rendered base32 to
  match the app's existing base32 helper in `crypto.ts`).
- Result: per-device keys that can be revoked individually without re-keying
  every other device — still "one user, one daemon, one folder," just with a
  device roster. Revocation is "drop this device's key from the roster."
- Keys are presented as `Authorization: Bearer <key>`; compared in **constant
  time**; the daemon stores only a hash of each at rest; keys are never logged.
- The `--api-key` path (one static key for everything) remains available for
  the simple case and for CI/testing, strength-validated on the way in.
- **Brute-force defence:** per-IP rate limiting and exponential lockout on
  repeated auth failures.

### Exposure and UPnP — on by default, and honest about the risk

UPnP opening a port to the public internet is genuinely the riskiest part of
this whole design, so it is on by default (the user wants "it just works from
anywhere") but treated with care rather than silently:

- UPnP/IGD port-mapping runs on startup: `notesd` maps the external port to
  its local listener and renews the lease. The mapping is torn down on clean
  shutdown.
- The startup banner and `--help` state **loudly** that this exposes the box
  to the internet, and `--no-upnp` runs LAN-only (mDNS discovery) for anyone
  who'd rather reach it over a private overlay (WireGuard / Tailscale). The QR
  can carry both a LAN and an external address; the client tries LAN first and
  falls back.
- Even when exposed, the standing attack surface is: TLS-1.3-pinned + a
  256-bit bearer key + rate-limited + a single-folder blast radius. There is no
  login page, no cookie, no user enumeration, no second folder to pivot to.

### At rest

- Data-plane encryption is **client-side and optional** — the app's existing
  `notes.encrypted.v1` per-file format (`crypto.ts`, `directory-adapter.ts`)
  flows through unchanged; the daemon sees `<ref>.enc` opaque blobs and stores
  them without understanding them. Plaintext markdown is equally fine and is
  the sensible home default.
- Daemon state (cert key, hashed device keys + roster, revision counter, UPnP
  lease) lives in a config dir with `0600` perms, **outside** the notes folder
  so the folder stays dumb.

### Threat model, enumerated

| Threat | Mitigation |
| ------ | ---------- |
| Passive network eavesdrop | TLS 1.3 only; no plaintext listener anywhere |
| Active MITM / rogue CA | SPKI pin transferred out-of-band via QR/encrypted config; no CA in the trust path |
| Stolen device key | Per-device keys, individually revocable; re-pair to rotate; hashed at rest, never logged |
| Online brute force | Constant-time compare + per-IP rate limit + exponential lockout |
| Path traversal on note refs | Refs validated against a strict base32/slug charset; no `..`, no absolute paths, writes confined to the folder |
| Resource-exhaustion DoS | Max request-body size, connection caps, per-IP request rate limit |
| Third party (Dropbox) reading a key | Config plane encrypted with the app envelope when stored in the cloud |
| Compromised home disk | Opt-in client-side E2EE turns the folder into ciphertext; plaintext is a documented, deliberate trust choice |
| Supply-chain / hidden egress | Minimal pinned crates, reproducible build, **no telemetry**, no outbound traffic except UPnP/mDNS on the LAN |

## The daemon (Rust)

### CLI

```
notesd <folder>            # e.g. notesd /home/niclas/my-notes
```

| Flag | Purpose |
| ---- | ------- |
| `-f, --follow` | Stay in the foreground and stream logs (otherwise it daemonises). |
| `--debug` | Verbose logging for diagnosing problems (secrets never logged). |
| `--port <n>` | Force a specific port (e.g. when UPnP is unavailable or unwanted). |
| `--api-key <key>` | Use a specific static key instead of the per-device pairing flow. **Validated for strength** and rejected if weak. |
| `--no-upnp` | Disable UPnP and run LAN-only (default is UPnP-open). |
| `--name <label>` | Human label shown in the app's backend list (defaults to hostname). |
| `--help` | Usage, including the internet-exposure warning. |

Startup sequence for `notesd /home/niclas/my-notes`:

1. Resolve/create the state dir keyed by the folder path; load or generate the
   self-signed cert and the key material (or accept `--api-key`).
2. Scan the folder to build the in-memory revision index (below).
3. Bind the TLS listener — `--port` if given, else an ephemeral port.
4. Map the external port via UPnP (unless `--no-upnp`); advertise on mDNS for
   LAN discovery.
5. **Print the QR code** (ANSI half-block characters, scannable straight from
   the terminal) plus the human-readable connection string and the exposure
   warning.
6. Daemonise unless `-f`.

### Runtime / crates

**Rust**, for a single static cross-compiled binary (macOS + Linux) with a
small, auditable dependency set — which matters most for the "water tight" bar.
Candidate crates: `tokio` + `axum`/`hyper` (HTTP/2), `rustls` (TLS 1.3),
`rcgen` (self-signed cert), `ring`/`sha2` (hashing, SPKI pin), `igd` (UPnP),
`mdns-sd` (LAN discovery), `notify` (fs-watch), `qrcode` (terminal QR), `clap`
(CLI). The daemon deliberately shares **no** domain/crypto code with the app —
the folder is dumb — so there is no pull toward a shared-TypeScript runtime.

### Storage layout — a dumb folder that matches the existing on-disk format

The folder `notesd` serves is **byte-compatible with the app's existing
directory format** (`directory-adapter.ts` + `markdown/codec.ts`): one file
per note, an `attachments/<note-stem>/` tree, `settings.json`,
`namespaces.json`. Two payoffs:

- The daemon is a thin network front-end over a representation the app already
  knows how to read/write — no new codec.
- The *same* folder can still be opened directly with the local **folder**
  backend, or lives inside a synced directory, with no conversion.

Because it is dumb, the daemon doesn't distinguish plaintext `<slug>-<id>.md`
from encrypted `<ref>.enc` — both are just files with a name, bytes, and an
mtime. It never opens the envelope.

### Revision model — cheap "did anything change?" + delta sync

The app's access pattern (below) wants three things a generic file API can't
give cheaply: a one-shot "has anything changed" probe, a "give me only what
changed" delta, and a push. The daemon provides all three from an in-memory
index rebuilt at startup and kept live by an fs-watch (`notify`):

- Each note ref → `{ etag (content hash), mtime }`.
- A monotonically increasing **aggregate revision counter**, bumped on every
  write and persisted, so a device can ask "anything past rev N?" in one call.
- A `notify` watch so **external** edits (a second device, the folder backend
  used directly, a text editor) also bump the counter and fan out over the
  push stream.

Writes are atomic: write-temp → fsync → rename.

### Wire protocol (sketch) and how it maps to the adapter

All endpoints require the bearer key and run over TLS. Shapes are illustrative.

| Endpoint | Purpose | Adapter hook it serves |
| -------- | ------- | ---------------------- |
| `GET /v1/rev` | current aggregate revision | `getRevision()` |
| `GET /v1/notes?since=<rev>` | list of notes changed since a rev, with etags + bodies (full dump when `since` omitted) | `load(previous)` delta |
| `GET /v1/notes/<ref>` | one note's body | `fetchNoteBody()` |
| `PUT /v1/notes/<ref>` + `If-Match: <etag>` | write one note; `409` with the newer note on etag mismatch | `save()` → `ConflictError` |
| `POST /v1/batch` | apply many note writes atomically in one round trip | coalesced multi-note save |
| `DELETE /v1/notes/<ref>` | remove a note | delete |
| `GET /v1/attachments/<note>/<file>` · `PUT …` | attachment bytes | `fetchAttachment()` |
| `GET /v1/settings` · `PUT /v1/settings` | `settings.json` / `namespaces.json` | settings + namespace stores |
| `GET /v1/events` (SSE) | push: `{rev, changed:[refs]}` on every change | **`watch()`** and `watchUploads()` |
| `POST /v1/pair` | redeem a one-time pairing token → per-device key | pairing |

**Efficiency wins this buys over Dropbox/Drive**, concretely:

- **One** `GET /v1/notes?since=` instead of *list + N file GETs* on load.
- Optimistic concurrency via `If-Match`/`409` reuses the existing
  `ConflictError` "keep mine / keep theirs" flow with zero new UI.
- `POST /v1/batch` collapses a burst of edited notes into one request.
- `GET /v1/events` (SSE) means **push, not poll** — the debounce can drop and
  a remote save appears near-instantly. This is the feature the cloud backends
  structurally can't offer.
- Loopback/LAN latency + HTTP/2 keep-alive instead of a rate-limited public API.

### Access patterns the protocol is tuned for

From the app side (`src/app/use-notes.ts`, `directory-adapter.ts`):

- **Load** = "give me the current document," ideally as a delta against what I
  last held (`load(previous)`), with per-note bodies lazy for the encrypted
  case (`fetchNoteBody`).
- **Save** = frequent, debounced, **per-note** (only changed notes, keyed on a
  hash of the plaintext source), each with its own revision for scoped
  conflict detection.
- **Probe** = cheap "did the remote move?" (`getRevision`).
- **React** = out-of-band remote changes should arrive without polling
  (`watch`).

The protocol above is a 1:1 fit for these — which is the whole point of owning
the backend.

### Daemonisation & logging

- Default: fork into the background, write a pidfile in the state dir, log to a
  file. `-f/--follow` keeps it in the foreground streaming to the terminal.
- `--debug` raises verbosity (request tracing, UPnP negotiation, fs-watch
  events). Secrets (device keys, pairing token) are **never** logged at any
  level.
- Ship a `systemd` unit (Linux) and a `launchd` plist (macOS) so it can run at
  boot; document `brew install` once packaged.

## Frontend integration

A new adapter, `src/storage/notesd/index.ts`, presented to the app as a
first-class `StorageAdapter` so `use-notes` and the sync engine don't change —
but one that finally implements the *optional* capabilities the cloud backends
can't:

- `id` union in `adapter.ts` / `backend-preference.ts` extends with
  `"notesd"`.
- Capabilities: `watch` (SSE), `getRevision`, `attachments`, and delta
  `load(previous)`; `saveDebounceMs` can go **low** because writes are cheap
  and pushed.
- `fetchNoteBody` / `fetchAttachment` map straight onto the lazy endpoints, so
  the encrypted-vault lazy-body flow works unchanged.
- Encryption composes exactly as today: `withEncryption` still seals bytes
  client-side before they hit the adapter, so E2EE-to-daemon is free and the
  daemon only ever sees ciphertext when the user opts in.

**Pairing UI:** "Add backend → Self-hosted (notesd) → Scan QR" (camera on
mobile; paste-the-string fallback on desktop). Scanning redeems the pairing
token, stores the endpoint + minted per-device key + SPKI pin in device-local
`localStorage` (alongside the existing `notes:dropbox:token` etc. in
`backend-preference.ts`) and, if a cloud config plane is connected, writes the
endpoint into `notesd.json` there.

## The configuration plane in Dropbox / Drive

A small `notesd.json` at the cloud app-folder root (beside `settings.json`),
holding an array of daemon endpoints:

```jsonc
{
  "v": 1,
  "daemons": [
    {
      "name": "niclas-imac",
      "lan": "192.168.1.20:8443",
      "wan": "203.0.113.5:8443",   // optional, only when exposed
      "fingerprint": "sha256:…",   // SPKI pin
      "keyRef": "…"                // per-device key, or absent if paired by QR only
    }
  ]
}
```

- Written **encrypted** with the app's `encryptText`/`decryptEnvelope`
  envelope by default when it sits on a third party — a device key must not be
  readable by Dropbox/Google. Plaintext is allowed (the per-device revocable
  model means the cloud copy isn't a single catastrophic point of failure).
- A device that has Dropbox/Drive connected reads `notesd.json`, and connects
  straight to the fast daemon for the actual notes — **config from the cloud,
  data from home**, exactly the split the user wants.

## When it ships — the lockstep obligations

Per `CLAUDE.md`, a user-facing feature fans out. The implementation PR(s) must
also land, in the same PR as the code:

- A changeset fragment under `.changes/unreleased/` (`type: Added`).
- An **achievement** — every feature is a trophy (a "Homelab / self-hosted"
  unlock): catalog row + glyph + `en`/`sv` strings.
- `en`/`sv` UI strings for the pairing flow and settings.
- **`HomePage.tsx` and `PrivacyPage.tsx` updates** — this introduces a new
  destination for note data (a self-hosted server) and a new use of the
  Dropbox/Drive scope (storing daemon config). Google's OAuth verification
  hinges on `/home` describing every data flow, so this is mandatory, not
  cosmetic.
- `docs/dictionary.md` + `docs/overview.md` entries for "notesd", "the
  daemon", "pairing / QR", "the config plane".
- A `docs/features/notesd.md` long-form doc referenced by the changeset `doc:`.

## Repo layout, testing, packaging

- **Where the daemon lives:** a `notesd/` directory at the repo root (monorepo,
  mirroring how `native/` already lives alongside the web app) so the wire
  protocol, the frontend adapter, and the daemon version together. Its own
  `README.md`, its own Cargo build, not part of the Vite build.
- **Testing:** Rust integration tests exercising the wire protocol; a
  security-focused suite (pinning enforced, auth lockout, path-traversal
  rejected, oversized-body rejected, plaintext-HTTP refused); the frontend
  adapter tested under vitest like the others, against a mock/local daemon.
- **Packaging:** signed release binaries for macOS (arm64/x64) and Linux
  (arm64/x64), `systemd` unit + `launchd` plist, a Homebrew formula.

## Roadmap (incremental, each phase shippable)

1. **Spec** — this document; freeze the wire protocol and pairing/QR payload. ✅
2. **Daemon MVP** — Rust: TLS self-signed + SPKI pin, `--api-key`, file store
   over the dumb folder, core REST (`rev`/`notes`/`put`/`delete`), QR on start,
   `-f`/`--debug`/`--port`/`--api-key`. ✅
3. **Daemonisation & durability** — state dir, cert persistence, atomic
   write-temp-rename + fsync, revision index, `notify` fs-watch. ✅
4. **Reachability** — UPnP mapping (default-on, with the loud warning) + mDNS
   discovery. ✅
5. **Smart sync** — SSE push (`watch`), `since=` delta, `batch`, attachments,
   per-device pairing + key revocation. ✅
6. **Frontend adapter** — `src/storage/notesd/`, capability wiring, pairing UI
   (QR scan), backend selection + settings. ⏳
7. **Config plane** — read/write `notesd.json` in Dropbox/Drive, encrypted
   option, auto-discovery. ⏳
8. **Hardening & ship** — rate-limit/lockout (done in the daemon), fuzzing,
   security review, the full lockstep fan-out (achievement, i18n, `/home` +
   `/privacy`, docs, changeset), packaging, release. ⏳
