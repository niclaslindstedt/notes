# Refactoring roadmap

The single source of truth for what this codebase considers a code smell
worth fixing. It is maintained by the `refactor` agent skill
(`.agent/skills/refactor/`), which works it in three modes — **Work**
(land the highest-leverage pending item), **Explore** (survey for new
smells and append them), and **Clear** (reset the findings to a blank
slate).

## Strategic context — why these smells matter

`notes` is a local-first PWA with **no backend**. Its leverage comes from
keeping the layering honest so new surfaces stay cheap to add:

- **Honest dependency direction.** `app → ui → domain` and
  `app → storage → domain`. Nothing in `src/domain/` may import from
  `ui/`, `storage/`, or `app/`, or touch `window` / `document` / `fetch`
  — a lint-enforced invariant that keeps `domain/` pure and portable to
  the React Native app under `native/`. Any violation is an architectural
  blocker.
- **Interchangeable storage backends.** Every backend (local default,
  folder, Dropbox, Google Drive) is a `StorageAdapter` moving bytes
  (`src/storage/adapter.ts`), optionally behind the `encrypting/` and
  `cache/` higher-order wrappers. Logic that should be shared but lives in
  one adapter, or a contract one adapter quietly diverges from, breaks the
  interchangeability that lets a new backend drop in.
- **A stable persisted shape.** The serialize/migrate pipeline
  (`src/storage/serialize.ts`, `migrations.ts`) runs on every load/save so
  backends only move bytes. Refactors here must be pure relocation; any
  change to the stored shape is a migration — a feature, not a refactor.
- **Easy-to-add UI surfaces and namespace / Markdown features.** Large,
  multi-concern files and duplicated logic raise the cost of every new
  list view, settings section, namespace capability, or Markdown token.

A clean roadmap means the layering is honest and the next UI surface,
storage backend, or namespace feature has a clean runway.

## Severity rubric

Rate every finding 1–10. **3 is the fix threshold**; below 3 it does not
go on the list. Mechanical, zero-risk transforms (a rename, a helper
extraction with N≥3 call sites, a type-only edit) are **easy wins** — land
them at any severity when touching the file anyway.

| Band | What to look for                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9–10 | Architectural blocker. Correctness / persistence risk, a broken layering edge, a domain-purity violation, or a `StorageAdapter` divergence every backend bumps into. |
| 7–8  | Multiplier. Local today; every new storage backend / UI surface / namespace feature threads through it.                                                       |
| 5–6  | Friction. Slows iteration; readers stumble. Worth landing soon.                                                                                               |
| 3–4  | Nit with leverage. Cheap to fix; alternative call-sites would multiply if left alone.                                                                         |
| 1–2  | Cosmetic. Don't add to the roadmap; if it ever bothers anyone enough to want to fix it, it'll re-surface.                                                     |

Patterns observed to rate consistently (capture them so the next agent
doesn't re-derive):

- A non-test source file **over the 1000-line cap** (OSS_SPEC §20.5) with
  no `oss-spec:allow-large-file:` opt-out is a standing split-by-concern
  candidate. Severity tracks how far over the cap and how many distinct
  concerns are tangled — multi-concern files near 2× the cap land in the
  7–8 band; a modestly-over file with clean internal seams sits at 5–6.
- A **cloud-backend dedup** (Dropbox / Google Drive) reads as
  "manual-smoke-test-only, no automated coverage" but is landable in this
  sandbox without live OAuth: pin the request sequence with a scripted
  `fetch` through the backend's **public** store factory
  (`createXSettingsStore` reaches `read`/`write`/`401`/`429`), then
  extract the duplicated machinery into a dedicated module and unit-test
  that seam directly (the gdrive `drive-fs.ts` and Dropbox `list.ts`
  precedents). The refactor should *close* the coverage gap, not inherit
  it — a manual smoke test against a real account stays a nice-to-have,
  not the only safety net.

---

## Pending

_Sweep of 2026-07 — survey angle: storage-backend interchangeability in
`src/storage/`. Type-safety greps (`as any`, `@ts-ignore`, …) and the
DOM/network-leak grep over shared storage code came back clean; the byte
contract itself is respected everywhere._

### Severity 9–10 — architectural blockers

_(none)_

### Severity 7–8 — multipliers

_(none)_

### Severity 5–6 — friction

_(none)_

### Severity 3–4 — nits with leverage

- **Wrapper capability-forwarding rules are implicit.**
  `cache/index.ts` (~238) adds `loadSync`; `encrypting/index.ts` (~36)
  deletes it — each wrapper hand-rolls what it preserves or strips from
  the `StorageAdapter` surface, and the valid stacking order
  (encrypting inside cache) lives only in the wiring. **Plan:** codify
  the composition rules where the contract lives (`adapter.ts`) — a
  short doc comment naming what each wrapper adds/removes and the valid
  stack order; type-level enforcement only if it falls out cheaply.
  **Risk:** none (comment/type-only). **Severity: 3.**

### Easy wins

_(none)_

---

## Landed

- **2026-07 — Dropbox HTTP error mapping consolidated into
  `dropbox/errors.ts` (was severity 4).** The ~8 `throw new Error("Dropbox
  <op> failed: <status> <body>")` sites across the file store, attachment
  store, list walk (`list.ts`), and namespace delete each hand-rolled the
  message; the two upload paths additionally mapped 429 → `RateLimitError`.
  All now throw through `dropboxError(op, res, { rateLimit? })` — the
  Dropbox mirror of `gdriveError`. Kept **bit-identical, not** unified with
  gdrive's uniform mapping: 401 is still handled upstream in
  `createAuthedFetch` (never reaches the helper, so no 401 branch), and
  only the upload paths pass `rateLimit: true` — a 429 on read/list/delete
  stays a plain labelled failure exactly as before (adopting gdrive's
  always-map-429 would have been a behaviour change, out of scope for a
  refactor). Pinned before/after via the settings-store scripted-fetch
  tests (download/upload/429/generic messages) and a direct helper unit
  test (`tests/storage/dropbox-errors.test.ts`, incl. the "429 without
  the flag stays generic" preservation case). `dropbox/index.ts` dropped
  509 → 476 lines. A shared cross-backend `ErrorMapper` remains
  deliberately un-built — revisit only if a third cloud backend lands.
- **2026-07 — `useBackendSelection` extracted from `useStorageBackend`
  (was severity 5).** The `selection` memo (backend resolution from the
  preference + live tokens/grant) and `makeInner` (the per-namespace
  adapter factory) now live in `src/storage/useBackendSelection.ts`, fed
  the tokens/handle/crypto the orchestrator already produced and returning
  `{ selection, makeInner }`. This also moved the six adapter-construction
  imports (`withLocalCache`/`localCacheKey`, `createDropboxAdapter`,
  `createGdriveAdapter`, `createFolderAdapter`, `BrowserLocalStorageAdapter`)
  and the `BackendSelection` union out of the orchestrator, which dropped
  600 → 507 lines. The dispatch had **no** direct coverage; it now ships
  `tests/storage/use-backend-selection.test.tsx` (10 cases: selection
  resolution for every backend incl. the token/grant fall-throughs to
  browser and the Dropbox refresh-callback wiring, plus `makeInner`'s
  per-backend adapter-id dispatch and any-namespace factory behaviour) —
  all reachable without live OAuth, since the cloud adapter factories only
  log at construction and don't hit the network until load/save. Pure
  move, no behaviour change; the encryption re-wrap (`adapter` memo) and
  the root store memos stayed in the orchestrator and were unaffected. A
  manual local + folder smoke test is still worth a once-over, but the
  branching is now automated.
- **2026-07 — Dropbox `list_folder` walk deduped into `dropbox/list.ts`
  (was severity 5; landed slightly wider than catalogued).** The file
  store and attachment store each carried a byte-identical `relativePath`
  + `listOnce`, plus near-identical `has_more`/`cursor` pagination loops.
  All three now live once in `src/storage/dropbox/list.ts` as
  `relativePath` / `listOnce` (module-private) / `listAllFiles<T>(…, map)`
  — the generic walk both stores call, each passing its own per-entry
  `map` (the file store's shallow-vs-recursive shape carrying `rev`; the
  attachment store's nested-only filter). `dropbox/index.ts` dropped
  614 → 509 lines. The roadmap flagged this as manual-smoke-test-only
  (no automated cloud coverage); the refactor **closed that gap** rather
  than inheriting it — the read/write/401-refresh/429 paths are now
  pinned through the public settings store (`tests/storage/dropbox-store.test.ts`,
  written **before** the refactor and green on both sides), and the
  extracted walk is unit-tested directly (`tests/storage/dropbox-list.test.ts`:
  pagination, `.tag` filtering, root-scoping, both stores' map filters).
  Dropbox went from zero automated coverage to 16 scripted-fetch cases.
  A manual Dropbox smoke test (plaintext + encrypted) is still worth
  doing once against a real account, but is no longer the only safety net.
- **2026-07 — `useNamespaceMigration` extracted from `useStorageBackend`
  (part of the was-severity-7 hook split; narrower than catalogued).**
  The two ~135-line cross-namespace move verbs
  (`moveNoteToNamespace`/`moveFolderToNamespace`) now live in their own
  leaf hook `src/storage/useNamespaceMigration.ts`, fed the resolved
  selection as plain arguments (`isBrowserBackend` in place of the
  `selection.kind` closure), so they're directly unit-testable —
  `useStorageBackend.ts` dropped 725 → 600 lines. The verbs had **zero**
  coverage before; the move now ships `tests/storage/use-namespace-migration.test.tsx`
  (14 cases over the no-op guards, note/folder moves, attachment + body
  hydration, same-id-remnant replacement, save-failure paths, and the
  browser-encryption-wrap branch) against in-memory adapters — no cloud
  needed. The remaining backend-resolution core of the hook is re-rated
  and re-queued at severity 5 (see Pending). The reversal from the
  roadmap's "selection seam first" plan was deliberate: the move verbs
  are leaf consumers, so they were the cleaner first cut.
- **2026-07 — gdrive list pagination (was severity 9; shipped as a `fix:`
  PR, user-authorized behaviour change).** `createDriveFolderFs`'s shared
  `search` now passes `pageSize=1000` and follows `nextPageToken` until
  the listing is exhausted, so namespaces or attachment trees with more
  files than one Drive page no longer silently truncate (previously a
  data-loss shape: truncated listings read as remote deletions). Covered
  by scripted-fetch pagination tests in
  `tests/storage/gdrive-drive-fs.test.ts`; still worth a manual smoke
  test against a real Drive account with >100 files in one folder.
- **2026-07 — gdrive folder-plumbing dedup (was severity 6, slightly
  wider than catalogued).** The ~130 lines of folder bookkeeping
  duplicated between the Google Drive file store and attachment store
  (`authHeader`, `search`, `createFolder`, `resolveDirId`, `dirAndName`)
  now live once in `src/storage/gdrive/drive-fs.ts`
  (`createDriveFolderFs`, per-store folder-id caches preserved);
  `gdrive/index.ts` dropped 795 → 555 lines. The store request sequence
  was pinned with scripted-fetch tests **before** the refactor
  (`tests/storage/gdrive-store.test.ts`) and the newly-reachable seam got
  direct tests (`tests/storage/gdrive-drive-fs.test.ts`) — gdrive
  coverage went from zero to 96% on the shared module. A third partial
  copy of the lookup inside `deleteGdriveNamespace` was deliberately left:
  its error labels (`namespace delete (lookup)`) are intentionally
  distinct and it omits response headers, so folding it in would change
  error semantics — rated 2, not queued.

---

## Investigated and skipped

_(none yet — reasoning before this reset lives in prior revisions of this
file in git.)_
