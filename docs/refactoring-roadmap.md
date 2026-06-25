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

_(none)_

### Severity 5–6 — friction

#### `src/storage/useStorageBackend.ts` — 917 lines, two backend concerns left in one hook

**Smell.** Now **under** the 1000-line cap. The hook wires backend
**selection**, **OAuth** (Dropbox + Google Drive connect/disconnect +
redirect completion), and the **folder** FSA permission lifecycle. The
**encryption** state machine (step 1) and the **namespace registry** (step 2)
have been relocated to `useEncryption.ts` / `useNamespaceRegistry.ts`.
Re-verify with `wc -l src/storage/useStorageBackend.ts`.

**Plan (multi-PR, extract one concern-hook per PR, lowest-coupling
first).** Each seam becomes a focused hook the main hook composes:

1. ~~**Encryption** → `src/storage/useEncryption.ts`. Self-contained state
   machine; keep `passwordRef` / `decryptNoteRef` / `directoryCrypto` inside
   it and hand the stable ref bundle to the adapter factory.~~ **Done
   2026-06** — see Landed.
2. ~~**Namespace registry** → `src/storage/useNamespaceRegistry.ts`.~~
   **Done 2026-06** — see Landed. (Landed at 245 lines, taking the built
   `namespaceStore` as a plain arg rather than building it inside; the memo
   stayed in the orchestrator beside its symmetric `settingsStore` sibling.)
3. **Folder backend** → `src/storage/useFolderBackend.ts` (~130–160). Tighter
   coupling to the adapter factory and active-encryption wrap on disconnect
   (the `wrapBrowserForActive` now lives in `useEncryption.ts`, so the folder
   hook would consume it as a passed-in dep).
4. **Cloud OAuth** → `src/storage/useCloudBackend.ts` (~180–200). Highest
   risk — OAuth redirect handling is fragile and has **zero automated
   coverage**.

The `selection` memo, `makeInner` adapter factory, the `settingsStore` /
`namespaceStore` root-store memos, the cross-namespace `moveNoteToNamespace` /
`moveFolderToNamespace` (coupled to `makeInner` / `wrapBrowserForActive`), and
the return object stay in the orchestrating hook.

**Risk.** The OAuth/cloud and folder flows have **no automated coverage** —
any extraction touching them must be smoke-tested by hand (browser default
plus the cloud backend touched) before merge. The extraction order in the
`selection` memo and the encryption wrapper asymmetry (browser =
whole-document `withEncryption`; file/cloud = per-file `directoryCrypto`)
must be preserved exactly. With encryption and the namespace registry
extracted, the file is now **under the cap**; the remaining two seams (folder,
cloud OAuth) are lower-leverage, mechanical splits worth doing only when the
file is touched again. **Severity: 4.**

**Note for the next seam.** The encryption extraction broke a render-order
cycle with an `innerRef` the verbs read at call time (the hook produces the
`directoryCrypto` / `seal` / `unseal` that build the very adapter its verbs
need). The folder/cloud seams don't have this cycle — they don't produce
anything `makeInner` consumes — so they can take `inner` / `adapter` as plain
args, exactly as the namespace seam took the built `namespaceStore`.

### Easy wins

_(none — the SideMenu sort-helper relocation landed 2026-06; see Landed.)_

---

## Landed

- **2026-06 — `SideMenu.tsx` Seam 4: row primitives extracted — the SideMenu
  split-by-concern candidate is now resolved.** Rather than the roadmap's
  original Seam-4 sketch (a stateful note/folder-list *presenter* extraction
  that would have had to thread the `dragItem` / `dropTarget` /
  `expandedFolders` / `creatingFolder` / `renamingFolderId` state through a wide
  prop surface), a **lower-risk, higher-leverage seam** was used: the five pure
  presentational leaf components — `SectionHeader`, `FolderRow`, `FolderEditRow`,
  `NavItem`, `SwipeToRemove` (plus the shared `REMOVE_ACTION_W` const) — were
  relocated verbatim into a sibling `src/ui/SideMenuRows.tsx` (540 lines),
  exported and imported back. These take everything via props and touch none of
  the container's drag / folder-expand / namespace state, so the move carries
  **zero** state-threading risk while still leaving `SideMenu.tsx` holding only
  the stateful container that composes them (the `renderNoteRow` / `renderFolder`
  closures, the drag handlers, and the `sections` JSX stay put). Dropped the now
  unused `useSwipeReveal` / `RowActionMenu` imports, the moved-only icons
  (`ArchiveIcon` / `ChevronDownIcon` / `ChevronRightIcon` / `FolderIcon` /
  `FolderOpenIcon` / `PencilIcon` / `PlusIcon` / `TrashIcon`), and `useRef` /
  `ReactNode` from `SideMenu.tsx`. Pure presentational relocation, no behaviour
  change, no layering edge crossed (`app → ui`), no storage hot-path. Exposed the
  previously-buried primitives (they only rendered inside a mounted `SideMenu`)
  to direct unit tests (added `tests/ui/side-menu-rows.test.tsx`, +15 tests
  covering the `SectionHeader` collapsible toggle + add action, the `NavItem`
  active `aria-current` / badge show-hide / disabled-inert / drop wiring, the
  `FolderEditRow` Enter-commit-trimmed / empty-blur-cancel / Escape-cancel, the
  `FolderRow` toggle + add-note + count-pill + touch swipe-strip rename/delete +
  desktop right-click menu, and the `SwipeToRemove` touch trash + desktop
  archive/delete menu). All 597 tests green; SideMenuRows.tsx holds 94%
  statement / 97.9% line coverage. SideMenu 1275 → 757 lines, well under the
  §20.5 cap — every distinct concern (sort helpers, footer, action bar, row
  primitives) is now its own module and the residual is the cohesive stateful
  drawer container. Also updated the `dictionary.md` `SectionHeader` / `FolderRow`
  / `FolderEditRow` pointers and the `overview.md` side-menu description to name
  the new module.
- **2026-06 — `useStorageBackend.ts` Seam 2: namespace registry extracted —
  the orchestrating hook is now under the 1000-line cap.** Moved the entire
  namespace-registry concern — the `namespaces` list + `activeNamespace` cursor
  state, the `pushNamespaces` best-effort mirror, the reconcile-against-
  `namespaces.json` effect, and the `switchNamespace` / `createNamespace` /
  `renameNamespace` / `setNamespaceAppearance` / `removeNamespace` verbs — out
  of `useStorageBackend` into a self-contained `useNamespaceRegistry` hook
  (`src/storage/useNamespaceRegistry.ts`, 245 lines). The seam diverged from the
  roadmap's original sketch in one deliberate way: rather than building the
  `namespaceStore` *inside* the new hook (which would have needed the parent's
  `BackendSelection` type, a parent↔child cycle), the orchestrator keeps the
  `namespaceStore` memo beside its **symmetric sibling `settingsStore`** (both
  are root stores derived purely from the same `selection`) and hands the built
  store in as a plain arg — along with the live `backend` / `dropboxToken` /
  `gdriveToken` / `folderHandle` the active-backend data-delete in
  `removeNamespace` routes on. The hook produces `activeNamespace`, which
  `makeInner` / `inner` key off, so it's called right after the `selection` /
  `namespaceStore` memos and before the adapter factory; it has **no** render-
  order cycle (unlike the encryption seam) because it produces nothing
  `makeInner` consumes. The cross-namespace `moveNoteToNamespace` /
  `moveFolderToNamespace` stayed in the orchestrator — they're coupled to
  `makeInner` / `wrapBrowserForActive`, a separate "cross-namespace move"
  concern, not registry CRUD. The reconcile effect's `[namespaceStore]` dep
  chain is preserved verbatim. Pure relocation, no behaviour change, no on-disk
  format change, no layering edge crossed (still `app → storage → domain`).
  Exposed the previously closure-bound registry logic to direct unit tests
  (added `tests/storage/use-namespace-registry.test.tsx`, +11 tests covering the
  localStorage seed, create → switch + store mirror + `compartments` unlock, the
  create-with-appearance, rename-keeps-slug, appearance apply/clear, the
  `switchNamespace` persist + re-read, the default-namespace removal reject, the
  browser removal that drops the entry + resets active + deletes the local
  document, the cloud-backend data-delete routing, and the reconcile effect's
  empty-backend seed + adopt-remote-and-push-local-only paths). All 582 tests
  green; useNamespaceRegistry.ts holds 92.5% statement / 93.8% line coverage
  (the uncovered lines are the folder / gdrive removal branches with no jsdom
  reach — by design). useStorageBackend 1053 → 917 lines, now under the §20.5
  cap. **NOTE: the folder + cloud (Dropbox / Google Drive) namespace data-delete
  and the `namespaces.json` reconcile have no Vitest reach against a real
  backend; hand-smoke-test a namespace create + remove and a two-device
  reconcile on a folder + cloud backend before merging.** Seams 3 (folder) and 4
  (cloud OAuth) remain in Pending, dropped to severity 4 as the file is now
  under the cap.
- **2026-06 — `useStorageBackend.ts` Seam 1: encryption state machine
  extracted.** Moved the entire at-rest encryption concern — the session
  passphrase (`password` state + `passwordRef`), the `encryption` mode and
  `disabling` flags, the `decryptNoteRef` / `directoryCrypto` per-file ref
  bundle, the `applyPassword` lockstep setter, the offline-cache `seal` /
  `unseal`, the `wrapBrowserForActive` helper, the `locked` derivation, and
  the four `enableEncryption` / `disableEncryption` / `finishDisableEncryption`
  / `unlock` verbs (plus the `EncryptionProgress*` types and `hydrateForSwitch`)
  — out of `useStorageBackend` into a self-contained `useEncryption` hook
  (`src/storage/useEncryption.ts`, 317 lines). The verbs need the active
  document adapter, which is built *from* this hook's `directoryCrypto` /
  `seal` / `unseal` outputs — a render-order cycle, broken by handing in an
  `innerRef` the verbs read at call time (the main hook assigns
  `innerRef.current = inner` right after building it). `hydrateForSwitch`
  became a module-scope **pure function** (`(inner, text) => Promise<string>`)
  rather than an `inner`-closured `useCallback`, so it's now directly testable.
  The `EncryptionProgress*` types are re-exported from `useStorageBackend.ts`
  so the settings UI's `encryption-progress.ts` import path is unchanged; the
  `unlock` catch now restores the pre-attempt `passwordRef` value (captured
  locally) instead of reading the `password` state — behaviour-identical
  because `applyPassword` keeps them in lockstep, but it drops `password` from
  the verb's deps. Pure relocation, no behaviour change, no on-disk format
  change, no layering edge crossed (still `app → storage → domain`). Exposed
  the previously closure-bound state machine to direct unit tests (added
  `tests/storage/use-encryption.test.tsx`, +10 tests covering `hydrateForSwitch`
  hydrate + skip-already-loaded, the browser-backend enable re-save + phase
  order, the empty-passphrase reject, the disable round-trip to plaintext, the
  "unlock before disabling" guard, the unlock wrong-password / offline / success
  paths, and `seal`/`unseal` pass-through). All 571 tests green; useEncryption.ts
  holds 87% statement / 90% line coverage (the uncovered lines are the
  file/cloud `else` branches with no automated reach — by design).
  useStorageBackend 1244 → 1053 lines. **NOTE: the file/cloud encryption verbs
  (enable/disable/unlock on a folder or Dropbox / Google Drive backend) have no
  Vitest reach; hand-smoke-test enable → migrate, disable → demigrate, and an
  unlock on a folder + cloud backend before merging.** Seams 2–4 (namespace
  registry, folder backend, cloud OAuth) remain in Pending; the entry dropped
  to the 5–6 band as the file is now only ~53 over the cap.
- **2026-06 — `SideMenu.tsx` Seam 3: action-bar island extracted.** Moved the
  bordered "button island" below the note list — the
  New note / New folder / Show all / Archive top row and the Undo / Redo bottom
  row — plus the `BarButton` segmented-cell primitive it is the only caller of,
  out of `SideMenu.tsx` into a self-contained `SideMenuActionBar` component
  (`src/ui/SideMenuActionBar.tsx`, 192 lines). The drawer now renders it with a
  flat prop surface: each action is a plain callback (the New note / Show all /
  Archive ones compose the parent's `close()` before the verb, exactly as the
  inline handlers did), and the Archive cell's drop-target wiring
  (`noteDropActive(NOTE_DROP_ARCHIVE)` / `allowDropOn` / `setDropTarget` /
  `dropOnArchive`) is threaded down as the four `archive*` props because the
  live HTML5-drag state still lives in `SideMenu`. The component reaches `useT`
  directly (same provider tree) rather than threading `t` as a prop, and imports
  `NOTE_DROP_ARCHIVE` / `NOTE_DROP_ATTR` from `note-drag-context.ts` itself; the
  now-unused `ListIcon` / `RedoIcon` / `UndoIcon` imports were dropped from
  `SideMenu.tsx`. Pure presentational extraction, no behaviour change, no
  layering edge crossed (`app → ui`), no storage hot-path. Exposed the
  previously-buried island (it only rendered inside an unmounted `SideMenu`) to
  direct unit tests (added `tests/ui/side-menu-action-bar.test.tsx`, +5 tests
  covering the four create/navigate callbacks, the `aria-current` active mark,
  the archived-count badge show/hide at zero, the undo/redo disable-at-the-ends
  gating + fire-when-enabled, and the Archive `data-note-drop` attr + dragover /
  drop wiring). All 553 tests green; SideMenuActionBar holds 100% statement /
  100% function / 94.7% branch coverage (was 0). SideMenu 1383 → 1275 lines.
  Step 4 (note-list / folder / namespace switcher) is the last remaining seam;
  the entry dropped to the 5–6 band. Also updated the `dictionary.md` button-
  island pointer to the new file.
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
