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

#### `src/ui/SideMenu.tsx` — 1384 lines, container + six sub-components

**Smell.** 384 lines over the cap. The SideMenu container plus six
presentational sub-components (SectionHeader, FolderRow, FolderEditRow,
NavItem, BarButton, SwipeToRemove). The pure sort helpers (step 1) and the
footer (step 2, `MenuButton` / `MenuLink` / the About dropdown) have been
relocated; the remaining concern is splitting the action bar and the
note/folder list/namespace switcher out of the container. Re-verify with
`wc -l src/ui/SideMenu.tsx`.

**Plan (multi-PR).**

1. ~~**Easy win first:** relocate the pure sort/grouping helpers to
   `src/domain/`.~~ **Done 2026-06** — see Landed.
2. ~~**Footer** → `src/ui/SideMenuFooter.tsx` — the Donate / Achievements /
   About-dropdown / Settings burger menu plus the `MenuButton` / `MenuLink`
   primitives.~~ **Done 2026-06** — see Landed.
3. **Action bar** → `src/ui/SideMenuActionBar.tsx` (~65 lines, the
   New/Folder/Show-all/Archive/Undo/Redo `BarButton` island). Self-contained
   except for the Archive drop-target wiring (`noteDropActive` /
   `allowDropOn` / `dropOnArchive`), which is threaded down as props.
4. The note/folder list and namespace switcher are higher-risk (drag
   state + folder expand/rename state scattered across the parent) — defer or
   do as a careful prop-drilled presenter extraction last.

**Risk.** The list extraction (Seam 4) carries the drag/expand/rename
state coupling. The action-bar extraction (step 3) is the safe next slice —
a self-contained presentational island; its only coupling is the Archive
row's drop-target props. No storage hot-path. **Severity: 6.**

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

### Easy wins

_(none — the SideMenu sort-helper relocation landed 2026-06; see Landed.)_

---

## Landed

- **2026-06 — `SideMenu.tsx` Seam 2: sidebar footer extracted.** Moved the
  drawer's footer — the relocated burger menu (Donate / Achievements / About
  dropdown / Settings) plus its `FloatingPanel` of project links, the
  footer-local `MenuButton` / `MenuLink` row primitives, the `ABOUT_PLACEMENT`
  and `SOURCE_URL` consts, and the `donateUrl` / `privacyUrl` env reads — out of
  `SideMenu.tsx` into a self-contained `SideMenuFooter` component
  (`src/ui/SideMenuFooter.tsx`, 193 lines). The drawer now renders it with a
  single `onClose` prop; the About dropdown's open state (`aboutOpen` /
  `aboutRef`) moved into the new component, so nothing of the footer leaks back
  into the container. The footer reaches `useT` / `useModalDispatch` directly
  (same provider tree) rather than threading them as props, and recreates the
  parent's `close()`-then-dispatch behaviour inline — the parent's `pick` helper
  stays put, still used by the Namespaces section header. Pure presentational
  extraction, no behaviour change, no layering edge crossed (`app → ui`), no
  storage hot-path. Exposed the previously-untested footer (it was buried inside
  an unrendered `SideMenu`) to direct unit tests (added
  `tests/ui/side-menu-footer.test.tsx`, +8 tests covering the donate
  show/hide + href + drawer-close, the Settings dispatch + close, the About
  toggle revealing the project links, the source/privacy hrefs and
  external-vs-same-origin targets, the changelog dispatch, the link-follow
  collapse, and the achievements row). All 548 tests green; SideMenuFooter holds
  87% statement / 100% branch coverage (was 0). SideMenu 1547 → 1384 lines.
  Steps 3 (action bar) and 4 (note-list / namespace switcher) remain in Pending;
  also updated the `dictionary.md` / `overview.md` About-dropdown pointers to
  the new file.
- **2026-06 — `directory-adapter.ts` Seam 4a: encrypted-note JSON codec
  extracted.** Moved the pure `noteToEncJson()` / `encJsonToNote()` functions
  and the `EncAttachmentMeta` type out of `directory-adapter.ts` into a
  standalone `src/storage/enc-note-codec.ts` (89 lines), imported back at all
  five call sites (`save`, the encrypted load, `fetchNoteBody`, `migrateNote`,
  `demigrateNote`). These were already module-scope and pure (no closure state,
  no I/O), so the relocation is zero-risk — but it pre-stages the
  migration-converter split (Seam 4 proper) by isolating its single most
  dangerous invariant: the encrypted-note encoding is now defined in exactly
  one place, so `save()` and `migrateNote()` are *structurally* unable to drift
  into two encodings (the divergence the roadmap flags as a hash-mismatch →
  infinite-re-upload risk). The now-unused `Attachment` type import was dropped
  from the adapter. Pure relocation, no behaviour change, no on-disk format
  change. Exposed the previously-untested codec to direct unit tests (added
  `tests/storage/enc-note-codec.test.ts`, +13 tests covering the required-field
  encoding, the falsy-optional omission that keeps the content hash stable, the
  archived/folderId/attachment-metadata inclusion, the bytes-never-stored
  guarantee, the full + minimal round-trips, and every reject/coerce path of
  the parser — malformed JSON, non-object, missing/mistyped required fields,
  title default, empty-folderId drop, non-`true` archived, and the
  malformed-attachment skip/drop). All 533 tests green; enc-note-codec.ts holds
  100% statement / branch / function / line coverage. directory-adapter
  1427 → 1360 lines. (Seam 4 proper, the migrate/demigrate/splitLegacyBlob
  orchestration, landed in the **same PR** — see the next entry.)
- **2026-06 — `directory-adapter.ts` Seam 4: migration converters extracted —
  the directory-adapter split-by-concern candidate is now resolved.** Moved the
  three plain↔encrypted converter functions — `migrateNote()` (plaintext → per-
  file `.enc` + opaque attachment blobs), `demigrateNote()` (the exact reverse),
  and `splitLegacyBlob()` (the one-time `notes.json` → per-file upgrade) — out
  of the `createDirectoryAdapter` closure into a `createMigrationConverters`
  factory in `src/storage/migration-converters.ts` (306 lines). This was the
  highest-coupling seam: the factory takes an explicit deps bundle (the crypto
  session `ensureKeys`/`encNoteCache`, the `encNotePath`/`attBlobPath` ref
  derivers, the `plaintextNotePath` resolver, the revision-tracking
  `track`/`untrack`, the `store`/`attachments` stores, the `passwordRef`, the
  `blobFileName`/`isEncNotePath` path vocabulary, and the adapter's own `save`,
  which `splitLegacyBlob` reuses for the representation switch). The
  `encStatus`-reassignment snag flagged in the old plan was sidestepped by
  passing `setEncStatus`/`deleteEncStatus` **callbacks** rather than the Map —
  the load path still reassigns its own `encStatus` binding untouched, and the
  callbacks always see the current map. The pure codecs the converters use come
  from `enc-note-codec.ts` (Seam 4a), which is what structurally guarantees the
  encrypted-note encoding here is byte-identical to `save`'s. Dropped the now-
  unused `noteToMarkdown` / `sealBytes` imports and the `NoteConversionProgress`
  type from the adapter. Pure relocation, no behaviour change, no on-disk format
  change — pinned by the existing encrypted/migration directory-adapter
  integration tests (all green) plus a new direct unit test of the factory
  (`tests/storage/migration-converters.test.ts`, +7 tests: the migrate seal +
  plaintext-removal + status/track/cache wiring, the already-migrated and
  no-passphrase no-ops, the demigrate round-trip from a *deferred* note that
  proves the `.enc` is authoritative for the body, the no-ciphertext clear, and
  the `splitLegacyBlob` no-blob / no-passphrase early returns). All 540 tests
  green. **directory-adapter 1360 → 1195 lines** — below the old ~1250 target;
  every distinct concern (crypto session, folder registry, attachment reconcile,
  enc-note codec, migration converters) is now its own module and the residual
  ~195-over-cap is the cohesive load / save / plan / conflict / index sync core,
  which has no clean further seam — a future Explore pass should re-evaluate
  rather than force an artificial split. **NOTE: the folder + cloud (Dropbox /
  Google Drive) backends have no Vitest reach; hand-smoke-test a folder + cloud
  round-trip (enable encryption → migrate, disable → demigrate, and a legacy-
  blob unlock) before merging.**
- **2026-06 — `directory-adapter.ts` Seam 3: attachment reconcile extracted.**
  Moved the entire attachment-externalisation concern — the load-side
  `hydrateAttachments` (→ `hydratePlaintext`) and `attachEncryptedMetadata`, the
  save-side `reconcileAttachments` (→ `reconcilePlaintext`),
  `reconcileEncryptedAttachments` (→ `reconcileEncrypted`),
  `clearAttachmentsWhere` (→ `clearWhere`), `clearAttachments` (→ `clearAll`),
  their `desiredAttachments` / `encDesiredAttachments` helpers, the
  `attachmentsTouched` session flag, and the `attachmentPath` /
  `stemOfAttachmentPath` / `isPlaintextAttachmentPath` / `keptAttachments` path
  helpers — out of the `createDirectoryAdapter` closure into a
  `createAttachmentReconciler` factory in `src/storage/attachment-reconcile.ts`
  (357 lines). The factory owns `attachmentsTouched`; the adapter's
  encrypted-load fast path (which spots attachment metadata off the note JSON
  without going through hydration) sets it via `attachmentReconciler.markTouched()`
  — the only flag touch-point left outside the module. The encrypted reconcile
  takes the adapter's keyed-HMAC `attBlobPath` deriver as a per-call argument
  (rather than holding it), so the new module has **no** dependency on the
  crypto session — only `keys.contentKey` flows in for sealing. The scope was
  deliberately wider than the roadmap's original "write/remove helpers" note:
  the load and save sides share `attachmentsTouched`, so moving only the
  save-side would have straddled the flag across two modules. `NoteEncStatus`
  (previously a local alias in the adapter and an inline union in
  `adapter.ts`'s `getEncryptionStatus`) was promoted to a shared export in
  `adapter.ts` so both modules name it. The shared path helpers are imported
  back into the adapter (still used by `fetchAttachment` / `migrateNote` /
  `demigrateNote` and the save's representation-switch supersede), which also
  pre-stages Seam 4. Pure relocation, no behaviour change, no on-disk format
  change. Exposed the previously-closure-bound reconciler to direct unit tests
  (added `tests/storage/attachment-reconcile.test.ts`, +16 tests covering the
  path helpers + orphan-pruning `keptAttachments`, the plaintext write/orphan-
  remove, the `attachmentsTouched` short-circuit vs. `markTouched`, plaintext
  hydration, the encrypted "pending" downgrade, the encrypted seal/round-trip +
  content-addressed skip + keep-without-bytes + orphan removal, the
  representation-switch clears, and the no-store no-ops). All 520 tests green;
  attachment-reconcile.ts holds 100% function / 92% line coverage and
  directory-adapter.ts holds 96% line coverage. directory-adapter 1658 → 1427
  lines. Seam 4 (migration converters) remains in Pending.
- **2026-06 — `directory-adapter.ts` Seam 2: folder registry extracted.**
  Moved the `folders.json` sidecar concern — the `lastFoldersJson` /
  `lastFolders` / `foldersReadOk` closure state, the `readFolders()` retry
  loop, `persistFolders()`, `plaintextNotePath()`, the `FOLDERS_FILE_NAME`
  constant, and the `FOLDERS_READ_ATTEMPTS` / `FOLDERS_READ_BACKOFF_MS` /
  `sleep` helpers — out of the `createDirectoryAdapter` closure into a
  `createFolderRegistry` factory in `src/storage/folder-registry.ts`
  (187 lines). The pure fold-into-snapshot helper `injectFolders()` is a
  standalone named export of the same module (it carries no state) and is
  imported directly. The adapter destructures
  `{ readFolders, persistFolders, plaintextNotePath }` so those call sites are
  unchanged; the two external-state touch points became method calls —
  `folderRegistry.readOk()` (the load memo gate, was a bare `foldersReadOk`
  read) and `folderRegistry.rememberFolders()` (the save's
  `lastFolders = snapshot.folders ?? []`). `FOLDERS_FILE_NAME` is re-exported
  from `directory-adapter.ts` so the encryption representation's path-set import
  is unchanged. Pure relocation, no behaviour change, no on-disk format change.
  Exposed the previously-closure-bound registry logic to direct unit tests
  (added `tests/storage/folder-registry.test.ts`, +11 tests covering the
  missing-sidecar / parse / transient-retry / all-fail-keeps-known /
  malformed-JSON read paths, the persist change-detection + clear-to-`[]` +
  null-snapshot paths, the folder-aware `plaintextNotePath` resolution, and the
  pure `injectFolders` fold incl. the empty-folders and encrypted-envelope
  no-ops). All 504 tests green; folder-registry.ts holds 100% line / 95% branch
  coverage and directory-adapter.ts holds 95% line coverage.
  directory-adapter 1772 → 1656 lines. Seams 3 (attachment reconcile) and 4
  (migration converters) remain in Pending.
- **2026-06 — `directory-adapter.ts`: `DEFERRED_SOURCE` NUL bytes removed —
  file is textual to git again.** The deferred-note tracked-source sentinel was
  `"\0deferred\0"` (literal NUL delimiters); a single NUL made git classify the
  whole 1766-line file as binary, so `git diff`/`blame`/the review UI showed
  "Binary files differ" — taxing every future review of the highest-multiplier
  storage file (the prerequisite for reviewing Seams 2–4 as diffs). Replaced it
  with the printable, non-control sentinel `"<<deferred-note: body not
  loaded>>"`. Confirmed safe: the sentinel is only ever `hashText()`-ed in
  `track()` (never persisted), and the only live comparison is against a real
  note's `noteToEncJson()` output — always a JSON object string starting with
  `{"id":` — so a non-`{` marker can never collide; documented that invariant
  at the declaration. The collision-proof property is pinned end-to-end by the
  existing "does not write or remove a deferred note on save" test (load
  deferred → fetch+edit one → save: asserts the edited note IS written and the
  deferred ones are NOT), which stays green. Added a regression guard asserting
  the source file contains no NUL byte
  (`tests/storage/directory-adapter-encrypted.test.ts`, +1 test). Pure value
  change, no behaviour change, no on-disk format change; all 493 tests green,
  directory-adapter holds 95% line coverage. The working tree is now textual;
  the diff against the pre-fix commit still shows binary (the old blob has the
  NUL), but every diff after this lands renders as text.
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
