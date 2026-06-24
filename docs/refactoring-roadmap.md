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

### Severity 9–10 — architectural blockers

_(none)_

### Severity 7–8 — multipliers

#### `src/storage/directory-adapter.ts` — 1766 lines, the shared base every file/cloud backend threads through

**Smell.** 766 lines over the cap, no opt-out — the shared `StorageAdapter`
base for the folder, Dropbox, and Google-Drive backends. One file tangles
several concerns: the markdown/path codec glue and types, the adapter
closure state (revision tracking, folder registry), the load path,
attachment reconcile (plaintext + encrypted), the save/conflict path, and
the atomic plain↔encrypted migration converters. Because **every**
file/cloud backend runs through it, it is the highest-multiplier file in the
storage layer. Re-verify with `wc -l src/storage/directory-adapter.ts`.

**Plan (multi-PR, one seam per PR, lowest-coupling first).** All seams are
pure relocations of sibling helpers out of the closure — the
`StorageAdapter` contract is unchanged and stays interchangeable:

1. ~~**Crypto session** → `src/storage/crypto-session.ts`
   (`ensureKeys()`, `cachedRef()`, key/ref/note caches).~~ **Done 2026-06** —
   see Landed. The adapter destructures `{ ensureKeys, cachedRef,
   encNoteCache }` from `createCryptoSession`, so the load/save/migration call
   sites are unchanged; `lastLoad` stays in the adapter and is cleared via the
   session's `onKeysInvalidated` callback.
2. **Folder registry** → `src/storage/folder-registry.ts` (~140 lines:
   `readFolders()` + retry, `injectFolders()`, `persistFolders()` and its
   state). Orthogonal to crypto/tracking. **Next — lowest remaining coupling.**
3. **Attachment reconcile** → `src/storage/attachment-reconcile.ts`
   (~150 lines: the plaintext + encrypted write/remove helpers).
4. **Migration converters** → `src/storage/migration-converters.ts`
   (~180 lines: `migrateNote()`, `demigrateNote()`, `splitLegacyBlob()`).
   Highest coupling — depends on seam 3 and the crypto session — do last.

Each remaining seam shaves the adapter toward the cap; the three together
leave it around ~750 lines.

**Risk — HIGH, and there is no automated cloud coverage.** This is the most
dangerous file in the tree to refactor: several seams carry silent
data-loss risk if the byte-level round-trip drifts. Hard invariants that
must be preserved verbatim across any split: the encrypted-note JSON
encoding must stay **identical** between `save()` and `migrateNote()` (a
divergence → hash mismatch → infinite re-upload loop); `attBlobPath()`'s
HMAC ref derivation and `splitLegacyBlob()` must share the **same**
`ensureKeys()` as `save()` (wrong key → orphaned/garbage blobs); the
revision-hash tracked-state map must not split from `plan()` / `isOurs()`
(conflict detection); `lastFolders` and the `foldersReadOk` memo gate must
stay coherent with the load path. Each PR must be hand-smoke-tested:
local default **plus** a folder round-trip at minimum, and the cloud
backend touched if any (Dropbox / Google Drive have no Vitest reach).
Pin the round-trip behaviour with a serialize/migrate test against the
local adapter before moving anything. **Severity: 8.**

#### `src/ui/SideMenu.tsx` — 1489 lines, container + eight sub-components

**Smell.** 489 lines over the cap. The SideMenu container plus eight
presentational sub-components (SectionHeader, FolderRow, FolderEditRow,
NavItem, BarButton, SwipeToRemove, MenuButton, MenuLink). The pure sort
helpers that previously lived here (step 1) have been relocated to
`src/domain/note.ts`; the remaining concern is splitting the presentational
sub-components out of the container. Re-verify with `wc -l src/ui/SideMenu.tsx`.

**Plan (multi-PR).**

1. ~~**Easy win first:** relocate the pure sort/grouping helpers to
   `src/domain/`.~~ **Done 2026-06** — see Landed.
2. **Footer** → `src/ui/SideMenuFooter.tsx` (~85 lines, self-contained,
   zero shared state).
3. **Action bar** → `src/ui/SideMenuActionBar.tsx` (~65 lines, the
   New/Folder/Show-all/Archive/Undo/Redo island).
4. The note/folder list and namespace switcher are higher-risk (drag
   state + folder expand/rename state scattered across the parent, and the
   About floating-panel anchor ties the footer to the switcher) — defer or
   do as a careful prop-drilled presenter extraction last.

**Risk.** The list extraction (Seam 4) carries the drag/expand/rename
state coupling; the namespace-switcher/footer floating-panel anchor must
move together or stay together. The footer and action-bar extractions
(steps 2–3) are the safe next slices — self-contained presentational islands.
No storage hot-path. **Severity: 6.**

### Severity 5–6 — friction

#### `src/storage/useStorageBackend.ts` — 1154 lines, four backend concerns in one hook

**Smell.** 154 lines over the cap. One hook wires backend **selection**,
**OAuth** (Dropbox + Google Drive connect/disconnect + redirect
completion), the **folder** FSA permission lifecycle, the **encryption**
state machine (enable/disable/unlock/password refs), and the **namespace
registry** (create/rename/remove + sync) — five cohesive concerns
interleaved across ~845 lines of hook body. Re-verify with
`wc -l src/storage/useStorageBackend.ts`.

**Plan (multi-PR, extract one concern-hook per PR, lowest-coupling
first).** Each seam becomes a focused hook the main hook composes:

1. **Encryption** → `src/storage/useEncryption.ts` (~160–200 lines).
   Safest — self-contained state machine, minimal external deps; keep
   `passwordRef` / `decryptNoteRef` / `directoryCrypto` inside it and hand
   the stable ref bundle to the adapter factory. Improves testability.
2. **Namespace registry** → `src/storage/useNamespaceRegistry.ts`
   (~140–180 lines). Must preserve the reconciliation effect's dep chain.
3. **Folder backend** → `src/storage/useFolderBackend.ts` (~130–160). Tighter
   coupling to the adapter factory and active-encryption wrap on disconnect.
4. **Cloud OAuth** → `src/storage/useCloudBackend.ts` (~180–200). Highest
   risk — OAuth redirect handling is fragile and has **zero automated
   coverage**.

The `selection` memo, `makeInner` adapter factory, and the return object
stay in the orchestrating hook (~400–500 lines after extraction).

**Risk.** The OAuth/cloud and folder flows have **no automated coverage** —
any extraction touching them must be smoke-tested by hand (browser default
plus the cloud backend touched) before merge. The extraction order in the
`selection` memo, the encryption wrapper asymmetry (browser =
whole-document `withEncryption`; file/cloud = per-file `directoryCrypto`),
and the lockstep `applyPassword` state+ref update must be preserved exactly.
Start with encryption (step 1) where the seam is cleanest and adds
testability. **Severity: 6.**

#### `src/storage/directory-adapter.ts` — `DEFERRED_SOURCE` embeds NUL bytes, so git reads the file as binary

**Smell.** The deferred-note tracked-source sentinel is declared as
`const DEFERRED_SOURCE = "\0deferred\0"` — the two delimiters around `deferred`
are literal NUL (`\x00`) bytes, not spaces. A single NUL anywhere makes git
classify the **entire** 1766-line file as binary, so `git diff` / `git blame`
/ the review UI all show "Binary files differ" instead of a textual diff. That
directly taxes the multi-PR split above (Seams 2–4): the highest-multiplier
storage file can't be reviewed as a diff. Re-verify with
`sed -n '/DEFERRED_SOURCE/p' src/storage/directory-adapter.ts | od -c`.

**Plan.** Replace the NUL delimiters with a printable sentinel that still
can't collide with a real note's plaintext source — e.g. a control-free marker
like `" "`-free `"·deferred·"` won't do (still risks collision); prefer a
prefix a serialized note can never start with, such as the existing
markdown-frontmatter shape inverted, or simply a sufficiently improbable ASCII
string documented as "must never equal a real note source". Confirm the
sentinel is only ever hashed/compared in-memory (it is — `track()` hashes it
and it is never persisted) so the value is free to change, then pin the
deferred-note round-trip with a test before swapping it.

**Risk.** Low-to-medium. The NUL is **likely deliberate** collision-proofing
(no real markdown body contains a NUL), so the change must keep the
collision-proof property; verify against the encrypted index/deferred-load
tests in `directory-adapter-encrypted.test.ts`. No on-disk format changes.
**Severity: 5.**

### Easy wins

_(none — the SideMenu sort-helper relocation landed 2026-06; see Landed.)_

---

## Landed

- **2026-06 — `directory-adapter.ts` Seam 1: crypto session extracted.**
  Moved the per-session encryption state and helpers — `keyCache`, `refCache`,
  `encNoteCache`, `lastPassword`, `ensureKeys()`, `cachedRef()`, and the
  `KEY_PARAMS_FILE` salts-file constant — out of the `createDirectoryAdapter`
  closure into a `createCryptoSession` factory in
  `src/storage/crypto-session.ts` (112 lines). The adapter destructures
  `{ ensureKeys, cachedRef, encNoteCache }` from the session, so every
  load/save/migration call site is unchanged; the plaintext-safe `lastLoad`
  load memo stays in the adapter and is cleared via the session's
  `onKeysInvalidated` callback (preserving the "drop every key-derived cache
  exactly once per passphrase transition" behaviour verbatim). To avoid a
  circular import the session takes only `passwordRef` (not the whole
  `DirectoryCrypto`), and `KEY_PARAMS_FILE` is re-exported from
  `directory-adapter.ts` so the test's import path is unchanged. Pure
  relocation, no behaviour change — the contract that `save`, `attBlobPath`,
  and `migrateNote` all derive refs from the *same* session keys is now
  structurally enforced by there being a single session instance. Exposed the
  previously-closure-bound cache logic to direct unit tests (added
  `tests/storage/crypto-session.test.ts`, +7 tests covering the no-passphrase
  null path, first-unlock key-params creation, key caching, params reuse, ref
  memoisation, and the once-per-transition cache-drop + `onKeysInvalidated`
  invariant). All 159 storage tests stay green; `directory-adapter.ts` holds
  95% line coverage. directory-adapter 1811 → 1766 lines. Seams 2–4 (folder
  registry, attachment reconcile, migration converters) remain in Pending.
- **2026-06 — `SideMenu.tsx` Seam 1 (easy win): pure sort/grouping helpers
  relocated to `src/domain/`.** Moved `sortNotesBy`, `folderModifiedAt`,
  `sortFoldersBy`, `mixTopLevel`, and the `TopLevelItem` type out of the UI
  file into `src/domain/note.ts` (next to the existing `sortByUpdated` /
  `sortFoldersByCreated`), correcting a domain-logic-in-UI layering smell.
  To keep the relocated helpers framework-free, also moved the `NoteSortKey`
  preference type (+ `NOTE_SORT_KEYS`, `DEFAULT_NOTE_SORT_KEY`, `isNoteSortKey`)
  from `src/theme/themes.ts` into `src/domain/note.ts` beside its sibling
  preference types `CopyScope` / `DefaultTitleScheme`; `themes.ts` now
  re-exports them so the appearance store and settings UI import paths are
  unchanged. Adding them to `note.ts` (rather than a new `note-sort.ts`
  importing `NoteSortKey` back from `theme/`) avoids both a `note.ts ↔
  themes.ts` import cycle and a new `domain → theme` inversion. Pure
  relocation, no behaviour change; exposed the previously-untestable helpers
  to unit tests (added `tests/domain/note-sort.test.ts`, +13 tests covering
  both sort keys, the case-insensitive ordering, the empty-folder modified-time
  fallback, no-mutation, and the `mixed`-placement interleave). SideMenu
  1561 → 1489 lines; `note.ts` 406 → 502. Steps 2–4 (footer, action bar, list /
  namespace switcher) remain in Pending.
- **2026-06 — `App.tsx` Seam 3 (final): note-list overview extracted —
  decomposition complete.** Moved `NoteList`, `OverviewFolderHeader`, and
  `FolderRenameRow` (plus the `NOTE_DND_TYPE` / `FOLDER_ACTION_W` module
  consts) to `src/ui/note-list/NoteList.tsx`, importing `SwipeableNoteCard`
  from the sibling `./NoteCard`. The drag-drop provider, the
  `pristineNew` / `discardable()` discard-tracking, and the drop-key router
  stay in `App`, which threads plain callbacks down — no layering edge
  crossed (`app → ui`), no storage hot-path touched. Pure presentational
  extraction, no behaviour change. App.tsx 1131 → 605 lines, well under the
  §20.5 cap. Exposed the previously-unreachable overview to unit tests (added
  `tests/ui/note-list.test.tsx`, +5 tests covering the empty/loading states
  and the Enter shortcut, the flat list + open-on-click, folder grouping with
  the per-folder "New note", and the desktop right-click folder rename). Also
  corrected the dictionary/overview pointers that earlier seams left aimed at
  `App.tsx` (NoteList, NoteCard, NoteLock, ArchiveList, TitleField,
  FolderPicker, the per-surface header). This was the last seam — the App.tsx
  split-by-concern candidate is now fully resolved and off Pending.
- **2026-06 — `App.tsx` Seam 2: editor surface extracted.** Moved `Editor`,
  `TitleField`, `PlainEditor`, and `FolderPicker` to `src/ui/NoteEditor.tsx`
  (exporting `Editor`), leaving the `NOTE_DND_TYPE` const behind for Seam 3's
  `NoteList`. Pure presentational extraction, no behaviour change, no layering
  edge crossed (`app → ui`). App.tsx 1567 → 1131 lines. Exposed the
  previously-unreachable editor surface to unit tests (added
  `tests/ui/note-editor.test.tsx`, +6 tests covering title-buffer-then-settle,
  body keystroke propagation, the decrypting placeholder, and the
  folder-picker visibility gate). One seam remains (Seam 3, note-list
  overview); the entry dropped to the 5–6 band as the file is now ~1.1× the
  cap.
- **2026-06 — `App.tsx` Seam 1: archive view + shared note-card primitives
  extracted.** Moved `ArchiveList` + `ReadOnlyNote` to
  `src/ui/ArchivedNoteView.tsx`, and the shared `NoteLock` / `NoteCard` /
  `SwipeableNoteCard` primitives (rendered by both the archive view and the
  still-in-`App` note-list overview) to `src/ui/note-list/NoteCard.tsx` — a
  head-start on Seam 3, which now just relocates `NoteList` into the same
  directory. The roadmap's original Seam-1 plan folded the cards into
  `ArchivedNoteView`, but they're shared with `NoteList`, and `src/ui/` can't
  import a component back out of `src/app/` (layering forbids `ui → app`), so
  the cards had to land in `src/ui/` as their own module. App.tsx 1988 → 1567
  lines. Pure presentational extraction, no behaviour change; exposed the
  previously-unreachable components to unit tests (added
  `tests/ui/note-card.test.tsx` and `tests/ui/archived-note-view.test.tsx`,
  +8 tests).

---

## Investigated and skipped

_(none yet)_
