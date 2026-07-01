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

---

## Pending

_Sweep of 2026-07 — survey angle: storage-backend interchangeability in
`src/storage/`. Type-safety greps (`as any`, `@ts-ignore`, …) and the
DOM/network-leak grep over shared storage code came back clean; the byte
contract itself is respected everywhere._

### Severity 9–10 — architectural blockers

- **`src/storage/gdrive/index.ts` (795 lines) — Drive listings never
  paginate; silent truncation at 100 files.** Neither the file store's
  recursive `listDir` (~line 269) nor the shared `search` helper
  (~line 425) passes `pageSize` or follows `nextPageToken` — grep for
  `nextPageToken` in the file: zero hits. Google Drive's `files.list`
  returns at most 100 items per page by default, so a namespace with >100
  notes (or an attachments tree with >100 subfolders/files) silently
  truncates the listing; downstream sync/conflict logic would then treat
  the missing entries as remotely deleted — a data-loss shape. The Dropbox
  backend paginates correctly (`has_more`/`cursor` loop, ~line 336), so
  this is also a quiet contract divergence between backends. **Plan:** add
  a `nextPageToken` loop to `search`/`listDir` (mirroring Dropbox's
  cursor loop) and pass an explicit `pageSize`. Note this is strictly a
  **bug fix, not a pure refactor** — behaviour changes for large
  namespaces — so ship it as its own `fix:` PR, not under a `refactor:`
  title. **Risk:** no automated coverage for cloud backends; must be
  smoke-tested manually against a real Drive account with >100 files in
  one folder, plaintext and encrypted. **Severity: 9.**

### Severity 7–8 — multipliers

- **`src/storage/useStorageBackend.ts` (725 lines) — five concerns
  tangled in one hook.** Backend selection/wiring (~lines 273–352,
  407–469), encryption state (~256–269, 494–500), namespace routing
  (~362–396), settings-store reconciliation (~471–488), folder/cloud
  lifecycle (~284–319), and two cross-namespace move verbs (~546–681)
  share one closure of refs/memos/callbacks. Every new backend,
  encryption mode, or namespace operation threads through this hook, and
  none of it is unit-testable in isolation. **Plan:** split by concern —
  a `useBackendSelection()` seam first (resolves the active backend from
  tokens/grants), then lift `moveNoteToNamespace`/`moveFolderToNamespace`
  into a `useNamespaceMigration()` hook that consumes the selection;
  sequence as multiple <500-line PRs, each leaving the hook working.
  **Risk:** the move verbs and encryption re-wrap ordering are subtle;
  smoke-test local + folder backends after each step, and one cloud
  backend for the selection seam. **Severity: 7.**

### Severity 5–6 — friction

- **`src/storage/gdrive/index.ts` (795 lines) — file store and
  attachment store duplicate ~55 lines of folder plumbing.**
  `authHeader` (~lines 179 and 421), `createFolder` (~213 and 437),
  `resolveDirId` (~234 and 457, near-identical), and `dirAndName`
  (~295 and 502, identical) are each defined twice, once per store
  closure, each with its own `dirIdCache`. Grep: `function dirAndName`.
  **Plan:** extract the folder-resolution helpers to module level
  parameterized by `fetchImpl`/`token`/base segments; keep per-store
  caches unless the stores are provably always co-created. **Risk:**
  cloud backend, no automated coverage — manual Drive smoke test
  (nested folders, plaintext + encrypted). **Severity: 6.**
- **`src/storage/dropbox/index.ts` (614 lines) — file store and
  attachment store duplicate `relativePath` + `listOnce` (~50 lines).**
  Identical definitions at ~lines 295–322 (file store) and ~436–463
  (attachment store), plus near-identical `has_more`/`cursor` pagination
  loops in both `list()` implementations. Grep: `function listOnce`.
  **Plan:** hoist `relativePath`/`listOnce` to module-level helpers
  parameterized by `authedFetch`/`rootPrefix`; optionally share the
  pagination loop as `listAll()`. **Risk:** cloud backend, no automated
  coverage — manual Dropbox smoke test (plaintext + encrypted).
  **Severity: 5.**

### Severity 3–4 — nits with leverage

- **Dropbox and Google Drive map HTTP errors through divergent
  heuristics.** Drive centralizes mapping in `gdriveError()`
  (`gdrive/index.ts` ~78–91: 403 + `rateLimitExceeded` body-sniff →
  `RateLimitError`); Dropbox does it inline per call site
  (`dropbox/index.ts` ~272–283, 387–394: raw 429 + `Retry-After`). A
  third backend would have to reverse-engineer both. With only N=2
  backends, extracting a shared `ErrorMapper` seam is borderline
  speculative — prefer first consolidating Dropbox's inline mapping into
  its own `dropboxError()` mirror of `gdriveError()`, and revisit the
  shared abstraction only if a third cloud backend lands. **Risk:**
  changing which statuses count as transient could hide real failures;
  keep semantics bit-identical per backend. **Severity: 4.**
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

- The `dirAndName`/`authHeader` extractions inside the gdrive
  duplication row above are mechanical and type-safe — safe to land as
  the first slice of that row when touching the file anyway.

---

## Landed

_(none yet — history before this reset lives in git; see the
`refactor(...)` / `feat(...)` commits and prior revisions of this file.)_

---

## Investigated and skipped

_(none yet — reasoning before this reset lives in prior revisions of this
file in git.)_
