# Overview

How the app's subsystems and features actually behave — the "how it works"
companion to [`docs/dictionary.md`](dictionary.md).

The dictionary answers _"the user said X — which file is that?"_: it maps every
term to the most specific file and the symbols to grep for, and stops there.
**This file answers the next question** — _"I've found the file, so how does
this subsystem work, and what else does it touch?"_ Every term in the
dictionary has a matching entry here, under the same section headings, so the
two read as a pair: look the word up in the dictionary to find the code, read
the same word here to understand it.

It is **not** a way to find code (the dictionary does that) and it is **not**
the module / persisted-shape inventory ([`docs/architecture.md`](architecture.md)
does that — the layering, the `Snapshot` shape, the migration runner, the
storage seam). Read this to grasp a feature's behaviour and its cross-module
reach before working a request, especially to discover the surfaces a change
touches beyond the one file the request names.

**Maintain it in lockstep with the code, in the same PR.** When a feature's
behaviour changes, update its entry here — and the dictionary row too if the
file or symbols moved (usually only the overview needs touching, since the
dictionary row is just a pointer). Keep descriptions to current behaviour and
invariants, not changelog narration ("used to…", "previously…"). Keep the
inline `file.ts` / `symbol` references so the prose stays navigable. The
headings here mirror the dictionary's sections one-to-one; add a new heading
whenever you add a dictionary row.

## Top-level UI and shell

### App shell

`src/app/App.tsx` — the single-shell SPA. A flex-row layout holding the
`SideMenu` (a drawer on phones, a docked sidebar on tablets and up) beside a
main area that switches between four surfaces by plain state (no router, so the
tree stays mounted): the notes overview (`NoteList`), the archive
(`ArchiveList`), an editable note (`Editor`), and a read-only archived note
(`ReadOnlyNote`). It owns the small top-level state — `editingId`, `readingId`,
`view` — and wires the cross-cutting hooks (`useNotes`, `useNotesSync` via the
store, `useNavState`, `useTheme`/appearance, `usePullToRefresh`, `useFileDrop`,
`useEdgeSwipeOpen`, `useUndoRedoShortcuts`) plus the five modal hosts and the
header (app title, the sync glyph `SyncStatus`, and the `TrophyButton`).

### Entry point / path switch

`src/app/main.tsx` — the React entry point. It mounts the global stylesheet and
the bundled webfont for offline first paint, then does a trivial
`window.location.pathname` switch: a path ending in `/privacy` renders
`PrivacyPage`, `/home` renders `HomePage`, anything else renders the main
`App`. Only the app shell is wrapped in `LanguageRoot` (`src/i18n/`); the two
public pages are English-only and bypass i18n.

### Note list / overview

`NoteList` in `src/app/App.tsx` — the main screen. Renders the visible note
set (`notes` from `useNotes`: active, non-blank, sorted newest-edited) as a
column of `NoteCard`s, with pull-to-refresh on remote backends and a control
to create a new note. Tapping a card opens it in the `Editor`; the empty state
prompts the first note.

### Note card

`NoteCard` / `SwipeableNoteCard` in `src/app/App.tsx` — one note in the
overview. Shows the note's title (`noteTitle`) and a one-line preview
(`notePreview`). `SwipeableNoteCard` wraps it in `useRowSwipe`: a right-swipe
archives the note, a left-swipe latches a trash button that needs a second tap
to delete (both undoable).

### Archive view

`ArchiveList` and `ReadOnlyNote` in `src/app/App.tsx`, shown when
`view === "archive"`. Lists archived notes (`archived` from `useNotes`,
i.e. `archivedNotes` + `sortByUpdated`); tapping one opens it read-only in
`ReadOnlyNote`, from which it can be restored (`restore`) or deleted.

### App title

`AppTitle` (`src/ui/AppTitle.tsx`) — the wordmark in the header. Presentational
only; styled from theme tokens.

### Drag-and-drop import

`DropOverlay` (`src/ui/DropOverlay.tsx`) renders the full-window drop target;
`useFileDrop` (`src/ui/hooks/useFileDrop.ts`) reads dropped files (desktop
only) and routes importable ones through `importedNote` (`src/domain/import.ts`)
into new notes via `useNotes().importFiles`, landing as a single undo step.

### Update toast

`UpdateToast` (`src/ui/UpdateToast.tsx`) — a soft toast pinned above the bottom
safe-area inset announcing "a new build is ready — reload to apply". Driven by
`usePwaUpdate` (`src/pwa/usePwaUpdate.ts`): the new service worker parks in
`waiting`, the toast shows download progress and the incoming version, and the
page only swaps when the user clicks Reload (never silently mid-edit). See also
[PWA update](#pwa-update).

### Icons

`src/ui/icons.tsx` — the inline-SVG icon set (menu, cog, plus, trash, archive,
cloud variants, undo/redo, spinner, …), each painted with `currentColor` and
sized via `className`. The app stays dependency-free — no `lucide-react`. Reuse
one of these before adding a new glyph.

### Button

`Button` (`src/ui/form/Button.tsx`) — the button primitive with `primary` /
`secondary` / `danger` variants keyed off theme tokens.

### Checkbox

`Checkbox` (`src/ui/form/Checkbox.tsx`) — an accessible custom checkbox: a
visually-hidden native `<input>` carries focus and screen-reader semantics
while a sibling `<span>` draws the tick off the `:checked` state.

## The editor

### Markdown editor

`MarkdownEditor` (`src/ui/MarkdownEditor.tsx`) — the Obsidian-style
live-preview editor. Every line except the one with the caret renders as
formatted Markdown (`RenderedLine`); the active line becomes a plain textarea
showing raw source, and the caret "rolls" between lines on arrow keys or clicks
on rendered text. Structural edits (Enter, boundary Backspace/Delete) splice
the body explicitly; it reads the parsed blocks from `classifyLines`
(`src/domain/markdown.ts`) and honours the `EditorSettings` (word-wrap,
spell-check, autocorrect, margin width).

### Rendered line

`RenderedLine` (`src/ui/MarkdownLine.tsx`) — renders one parsed `LineBlock` as
formatted React (headings, quotes, lists, inline code/links/bold/em/strike).
Every leaf carries a `data-src` offset so a click maps back to a caret position
in the raw source. `markdownLineClass` (`src/ui/markdown-line-class.ts`) maps a
block kind to its CSS classes.

A rendered **link** (and an inline image) is the exception to click-to-caret:
it stops the line-level `mousedown` from rolling the editing textarea onto its
line, so a click (or tap, even while another line is being edited) opens the
link instead of entering edit mode on it. To edit a link's text or URL, click
just past it and backspace into it — the raw `[text](url)` source then shows in
the active line's textarea like any other text.

### Markdown parser

`src/domain/markdown.ts` — a dependency-free, pragmatic Markdown subset.
`classifyLines` splits the body into `LineBlock[]` (one per line, tracking
fenced-code state); `parseInline` tokenizes a line into `InlineNode`s (strong,
em, code, link, image, strikethrough), each leaf carrying a source-column
`offset` for click-to-caret mapping. The `image` node (`![alt](href)`) is what
the [attachment renderer](#image-attachments) turns into an inline thumbnail. It is pure (no DOM/IO) and fast enough to run on every
keystroke, which is why it lives in `domain/`.

### Title field

`TitleField` in `src/app/App.tsx` — the note's title field above the editor. It
is an auto-growing textarea, so a long title wraps onto further lines and the
field grows to fit instead of scrolling out of view. A single-line title is
vertically centred against the app glyph and the copy/sync buttons; once it
wraps the header top-aligns so those stay pinned to the first line (the field
reports the one-line↔multi-line transition up via `onMultilineChange`). Opening
an existing note focuses nothing, so the soft keyboard stays down until the user
taps where to type — only a brand-new note opens with the title focused, ready
to be named. Enter and
Arrow-Down hand focus down to the body, so the field never holds a literal
newline. Edits route through `useNotes().retitle` → `retitleNote`
(`src/domain/note.ts`). On file/cloud backends the [save hold](#save-hold) keeps
the file from being created under the throwaway default title until the real
title settles.

### Editor settings

`EditorSettings` (`src/theme/themes.ts`) — margin (writing-column max width via
`editorMarginMaxWidth`), `wordWrap`, `renderMarkdown`, `disableSpellcheck`,
`disableAutocorrect`, the `defaultTitle` scheme, and the `copyScope` (see
[Copy button](#copy-button)). They live in the
[appearance store](#appearance-store) (so they sync with the folder/cloud) and
are edited in the Editor tab of the settings modal, `EditorSection`
(`src/ui/settings/EditorSection.tsx`), which groups them into focused bordered
sections (mirroring the General tab) — **New notes** (the default-title scheme),
**Writing column** (margins, word wrap), **Markdown** (live render), **Typing
aids** (spell-check / auto-correct), and **Copying** (the copy scope) — see
[Storage settings](#storage-settings) and its sibling sections.

### Image attachments

Paste (`Ctrl`/`Cmd`+`V`) or drag-and-drop an image into the editor and it
becomes a note **attachment** — shown inline as a small thumbnail you click to
open full-size. The model is `Attachment`
(`{ filename, mime, data }`, `src/domain/attachment.ts`); it rides on the
`Note` as `attachments?: Attachment[]`, with the full image held in memory as a
`data:` URL and the body carrying a flat `![file](attachments/<file>)`
reference. `MarkdownEditor`'s paste / drop handlers build the attachment
(`src/ui/attachments/fromFile.ts`), persist it via `useNotes().attach`, and
insert the reference; `imageFilesFrom` filters the payload to images so a
dropped `.md` still falls through to the [drag-and-drop import](#drag-and-drop-import).
Rendering goes through `AttachmentsProvider` (`src/ui/attachments/`): the
`image` `InlineNode` resolves its reference to one of the note's attachments and
renders an `InlineImage` thumbnail (`useThumbnail` downscales via canvas, cached
by filename), with `ImageViewer` showing the original on click.

Attachments are **only offered on a folder / cloud backend** — the editor gates
paste / drop on the adapter's `"attachments"` capability, which the
[directory adapter](#directory-adapter) advertises when an `AttachmentStore`
(`src/storage/attachment-store.ts`) is wired. On save the directory adapter
externalises each referenced image to a real file at
`attachments/<note-name>/<filename>` (a sibling of the `notes/` folder, via each
backend's binary `AttachmentStore`); on load it reads the files back into the
`data:` URLs, reusing the offline cache's copies so unchanged images aren't
re-downloaded. Under encryption the images stay inside the single encrypted
blob rather than as separate files. The local "This device" backend has no
`AttachmentStore`, so it never accepts an image.

### Copy button

`CopyNoteButton` (`src/ui/CopyNoteButton.tsx`) — a single button to the left of
the [sync glyph](#sync-status) in the editor and the read-only archived-note
view. One tap copies the open note to the clipboard; what it copies is the saved
`copyScope` [editor setting](#editor-settings), chosen from the dropdown in the
Editor tab of the settings modal (`EditorSection`). The three scopes are a
`CopyScope` (`src/domain/note.ts`): `body` (the body verbatim — the default,
never the title), `titleBody` (the title prepended as a `# ` heading), and
`frontMatter` (the whole `.md` file the way the file backends store it).
`buildCopyText` (`src/ui/copy-note.ts`) assembles the text — the `frontMatter`
case reuses the [markdown codec](#markdown-codec)'s `noteToMarkdown` so a copied
note is byte-identical to its on-disk file. Copying is the **Copycat**
achievement (fired via `unlock("copycat")`).

## The note model and operations

### Note

`Note` (`src/domain/note.ts`) — `{ id, title, body, createdAt, updatedAt,
archived? }`. Title and body are separate fields so the title survives into the
markdown frontmatter on file backends. The whole model is pure and
framework-free so the React Native app reuses it verbatim.

### Snapshot

`Snapshot` (`src/domain/note.ts`) — `{ notes: Note[] }`, the persisted document.
It is version-free in the domain; versioning is a persistence concern handled by
[migrations](#migrations). The undo timeline and the sync engine both operate on
whole `Snapshot`s.

### Create a note

`createNote` (`src/domain/note.ts`) mints a blank note with a UUID and
timestamps; `useNotes().create` swaps it into the document and records an undo
step; `openNew` (`src/app/App.tsx`) opens it in the editor. A note never typed
into is a [blank note](#blank-note) and discards itself on close.

### Edit a note

`editNote` (`src/domain/note.ts`) replaces the body and bumps `updatedAt`;
`useNotes().update` routes it through the sync engine and records onto the undo
timeline with a per-note `mergeKey` so a typing burst collapses into one step.

### Retitle

`retitleNote` (`src/domain/note.ts`) replaces the title and bumps `updatedAt`;
exposed as `useNotes().retitle`. See [title field](#title-field).

### Archive / restore

`setArchived` (`src/domain/note.ts`) flips the soft-delete flag; `activeNotes`
and `archivedNotes` partition the list. `useNotes().archive` / `restore` are the
verbs; archived notes leave the overview but stay for the [archive
view](#archive-view) and undo.

### Delete

`useNotes().remove` drops a note from the document (a hard delete), recorded as
its own undo step so the prior snapshot still holds the deleted note.

### Blank note

`isBlank` (`src/domain/note.ts`) is true for an empty body and untouched default
title. `App` tracks a freshly-created note with the `pristineNew` ref and the
`discardable` check, dropping it when its editor closes so abandoned notes never
litter the list. Blank notes are hidden from the visible `notes` set but live in
`allNotes` so the editor can still resolve one before it appears.

### Default title

`noteTitle` (`src/domain/note.ts`) returns the title or a fallback;
`defaultNoteTitle` applies the user's `DefaultTitleScheme` (`none` /
`dateTime` / `numbered`) on creation. The scheme is an editor setting.

### Preview

`notePreview` (`src/domain/note.ts`) — the one-line body excerpt shown on the
[note card](#note-card).

### Sort order

`sortByUpdated` (`src/domain/note.ts`) orders notes newest-edited first; used by
both the overview and the archive list.

### Import files

`src/domain/import.ts` — pure transforms turning dropped files into notes:
`isImportableFilename` filters by extension, `titleFromFilename` derives the
title, `importedNote` builds the `Note` (CRLF normalized, trailing blanks
trimmed). The UI side is `useFileDrop` → `useNotes().importFiles`. See
[drag-and-drop import](#drag-and-drop-import).

## App state and orchestration

### Notes store

`useNotes` (`src/app/use-notes.ts`) returns `NotesStore` — the mutation API
between React and persistence. It translates create/edit/retitle/remove/
archive/restore/importFiles into whole-`Snapshot` swaps, records each onto the
undo timeline (coalescing keystroke edits per note), and hands `sync` state back
up for the header. It exposes `notes` (visible), `allNotes` (incl. blank), and
`archived`. It is the seam between UI and storage; it owns no I/O itself —
that's the [sync engine](#sync-engine).

### Sync engine

`useNotesSync` (`src/app/use-notes-sync.ts`) — the debounced-save state machine
between the in-memory document and the active `StorageAdapter`. On
mount/backend-swap it loads the document (or the offline cache); edits schedule
a debounced save (per-backend `saveDebounceMs`). It owns `SaveStatus` (`idle` /
`saving` / `saved` / `error` / `conflict` / `auth-error` / `throttled`),
exponential-backoff retry of transient failures, rate-limit cooldowns, offline
fallback, and conflict detection (every save carries a `baseRevision`). `setDoc`
and `scheduleSave` are the only paths that mutate the document; `refresh` pulls
without resetting history, `reload` replaces the document and resets it. A
fixed-cadence [live pull](#live-pull) drives `refresh` on its own so another
device's edits arrive without a gesture.

### Live pull

The live-sync loop in `useNotesSync` (`src/app/use-notes-sync.ts`) — a
`setInterval` every `LIVE_PULL_INTERVAL_MS` (10s, the one knob behind "write on
one device, watch it appear on the other") that calls `refresh` so a remote
edit shows up here on its own, even with the note open in the editor. The pure
`shouldLivePull` predicate gates each tick: only on a remote backend, only once
the first load has settled, and only after the note has sat **quiet for the
full window** (no keystroke within the interval — tracked by `lastEditRef`,
stamped in `scheduleSave`) with nothing unsaved, no open conflict, and no save
in flight. So a pull never clobbers a keystroke mid-edit; it waits for a pause,
then adopts the remote. Each pull passes the last `StoredSnapshot`
(`lastStoredRef`) to `load` as the `previous` hint, so a file-per-note backend
lists cheaply and re-downloads only the notes whose revision moved. When a pull
actually moves the document it fires the `liveSync` ("Telepathy") trophy. The
open editor reflects the pulled change through a body-reconcile effect in
`MarkdownEditor` / `PlainEditor`: since the user's own keystrokes echo back to
the identical `body`, a `body` that differs from the editor's local value can
only be another writer's edit, so it's adopted (and the active line clamped)
without disturbing in-progress typing.

### Save hold

`holdSaves` / `releaseSaves` (`src/app/use-notes-sync.ts`) — arming a hold while
a brand-new note is being titled on file/cloud backends, so the first write
happens under the real title slug rather than the throwaway default filename.

### Undo / redo

`useUndoRedo` (`src/app/use-undo-redo.ts`) — in-memory undo/redo over whole
`Snapshot`s, capped at `UNDO_HISTORY_LIMIT` (50). `record` appends a labelled
entry; a `mergeKey` collapses rapid same-key records (a typing session) into one
step, while creates/deletes always land as their own steps. `reset` rebuilds the
timeline whenever the document arrives from outside the edit path (load, reload,
conflict-adopt). `useUndoRedoShortcuts` (`src/ui/hooks/useUndoRedoShortcuts.ts`)
binds ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z; the side menu also has a side-by-side
undo/redo button pair at the foot of the drawer.

### Settings sync

`useSettingsSync` (`src/app/use-settings-sync.ts`) reconciles the
[appearance store](#appearance-store) with the active backend's `settings.json`
(via `SettingsStore`, `src/storage/settings-store.ts`), so theme/font/editor
choices travel with a synced or shared folder and land on every device.
Best-effort and plaintext (so the [unlock gate](#unlock-gate) can render in the
user's theme); on the browser backend there is no file store and the hook is a
no-op.

### Nav state

`useNavState` (`src/app/use-nav.ts`) owns the drawer's `open` flag, the
`pinned` media-query state (docked sidebar vs. drawer), the floating button's
persisted `position`, and `showButton`. It is published through `NavContext`
(`src/ui/nav-context.ts`) so components read it via `useNav()` rather than
threaded props.

## Navigation, drawer, and gestures

### Side menu

`SideMenu` (`src/ui/SideMenu.tsx`) — the navigation surface: a drawer over a
dimmed backdrop on phones, an always-docked panel on tablets+. It holds the
namespace switcher, the recent-notes list (with swipe-to-remove rows), the
archive link, a side-by-side undo/redo button pair pinned to the foot of the
list, and a footer (settings, privacy, changelog,
source, donate). It reads state from `NavContext` and dispatches modal-open
commands on the [modal bus](#modal-bus).

### Floating menu button

`useDraggableMenuButton` (`src/ui/hooks/useDraggableMenuButton.ts`) and
`src/ui/sideMenuPosition.ts` — the rounded menu button pinned to either screen
edge. A tap toggles the drawer; a drag repositions it and snaps to the nearer
edge, persisting the spot. On a standalone mobile PWA the General-tab
menu-activation segmented control can swap it (`showButton` in
`nav-context.ts`) for the [edge swipe](#edge-swipe-to-open).

### Edge swipe to open

`useEdgeSwipeOpen` (`src/ui/hooks/useEdgeSwipeOpen.ts`) — touch-only: a swipe
starting ≤30px from the drawer's resting edge and travelling inward >48px opens
the drawer. Gated by the menu-activation choice, disabled while a modal is open,
and axis-locked so vertical scrolls don't trigger it.

### Drawer swipe to close

`useDrawerSwipeClose` (`src/ui/hooks/useDrawerSwipeClose.ts`) — the reverse
gesture: dragging the open drawer back toward its edge (or a quick flick) closes
it, with the backdrop dimming in step with the drag. Rows tagged
`[data-drawer-swipe-ignore]` keep their own swipe.

### Row swipe

`useRowSwipe` (`src/ui/hooks/useRowSwipe.ts`) — the note-card gesture. A right
swipe >96px archives the note; a left swipe >48px latches a trash button that
needs a second confirming tap to delete. The foreground tracks the finger with
`translateX` and settles via CSS transition on release.

### Swipe reveal (sidebar)

`useSwipeReveal` (`src/ui/hooks/useSwipeReveal.ts`) — the side-menu row gesture:
a left swipe latches the row open to uncover a single trash button; tapping it
deletes the note straight away (no confirming second tap — deletion is undoable
from the Edit section), and tapping an open row closes it.

### Pull to refresh

`usePullToRefresh` (`src/ui/hooks/usePullToRefresh.ts`) plus
`PullToRefreshIndicator` (`src/ui/PullToRefreshIndicator.tsx`) — touch-only on
the overview: a downward drag from the top past ~70px (with rubber-band
resistance) triggers `refresh` on release, showing an arrow then a spinner.
Disabled when a modal is open or a scroll ancestor isn't at its top.

### Pinned sidebar

`pinned` (`src/ui/nav-context.ts`), backed by `useMediaQuery`
(`src/ui/hooks/useMediaQuery.ts`) — at tablet width and up the menu docks open
as a sidebar and the floating button disappears; below that it's a drawer.

### Viewport height

`useViewportHeight` (`src/ui/hooks/useViewportHeight.ts`) reads the visual
viewport (accounting for the mobile soft keyboard and Dynamic Island) as a
`100svh` fallback; `appViewportRect` (`src/ui/appViewportRect.ts`) exposes the
app's drawable rect for overlay positioning.

## Modals and dialogs

### Modal

`Modal` (`src/ui/Modal.tsx`) — the accessible base overlay: a body portal with a
dimmed backdrop, Escape-to-close (topmost only), backdrop-click close, and a
`centered` (card) vs full-screen-sheet mode. It manages a modal stack so nested
confirmations don't collapse every layer at once.

### Modal bus

`src/ui/modal-bus.ts` + `ModalBusProvider` (`src/ui/ModalBusProvider.tsx`) — a
global command dispatcher decoupling openers from hosts. A button dispatches a
`ModalCommand` (`{ kind: "settings" }`, etc.) via `useModalDispatch`; the
matching [host](#modal-hosts) reads it via `useModalState` and opens its modal —
no prop threading.

### Modal hosts

`src/app/modals/*Host.tsx` — `SettingsModalHost`, `NamespacesModalHost`,
`ChangelogModalHost`, `AchievementsModalHost`, `AchievementsUnlockModalHost`.
Each owns one modal's open state, reads its command off the [modal bus](#modal-bus),
and threads the app state the modal needs (storage, appearance, sync). All five
are mounted once at the `App` root.

### Settings modal

`SettingsModal` (`src/ui/settings/SettingsModal.tsx`) — a tabbed dialog
(General, Appearance, Editor, Storage; Developer and Logs appear only when dev
mode / log capture are on). Every control applies live through its store (no
draft/Save). Tabs reset to General on reopen.

### Namespaces modal

`NamespacesModal` (`src/ui/NamespacesModal.tsx`) — add / rename / delete /
restyle namespaces. Each gets a name, optional glyph (`NamespaceGlyph` +
`GlyphGrid`), and optional colour; the active one shows a checkmark. Deleting one
removes it and its notes from the active backend (`removeNamespace` +
backend-specific delete). See [namespaces](#namespaces).

### Changelog modal

`ChangelogModal` (`src/ui/changelog/ChangelogModal.tsx`) — the in-app "What's
new", listing every shipped release (newest first) from the parsed
[changelog data](#changelog-data) with inline Markdown. A bullet carrying
`[Learn more](feature:<slug>)` drills into a [feature doc](#feature-docs) in
place, with a back button.

### Achievements modal

`AchievementsModal` (`src/ui/achievements/AchievementsModal.tsx`) — the guided
tour of the whole catalog across the four tiers (Beginner → Intermediate → Pro →
Expert), read by `id` from the [catalog](#achievement-catalog) and rendered with
its i18n copy. New catalog entries appear automatically.

### Unlock modal

`AchievementUnlockModal` (`src/ui/achievements/AchievementUnlockModal.tsx`) —
the compact notification listing just the freshly-unlocked achievements; closing
it clears the unseen queue (`clearUnseenAchievements`). The [trophy
button](#trophy-button) opens this when there's something new, the tour
otherwise.

### Sync details modal

`SyncDetailsModal` (`src/ui/SyncDetailsModal.tsx`) — opened from the [sync
glyph](#sync-status). Explains the current state (saving / error / throttled /
offline / in-sync), shows the failure reason verbatim, links out to the
backend's web UI, and offers Reconnect, Save now / Try again, and Reload-from-
backend. Its content is short and opens no soft keyboard, so it renders as a
compact `centered` card rather than the full-screen mobile sheet.

### Conflict modal

`ConflictModal` (`src/ui/ConflictModal.tsx`) — a non-dismissable alertdialog
shown when a save collides with a newer remote copy (another device edited while
this one was offline). It summarises each copy (note/word counts) and the user
picks the winner: "keep this device's copy" re-saves against the remote
revision, "keep the other copy" adopts the remote bytes.

### Unlock gate

`UnlockGate` (`src/ui/UnlockGate.tsx`) — the full-screen passphrase form that
blocks the app on a fresh reload when encryption is on but no passphrase is
cached (it's session-only by design). The appearance theme stays visible under
the gate. See [encryption](#encryption).

## Settings tabs

### General settings

`GeneralSection` (`src/ui/settings/GeneralSection.tsx`) — the language picker,
the toggle that disables achievements (and hides the trophy button), a
segmented control choosing how the side menu is opened (floating button vs.
edge swipe; mobile PWA only), and the dev-mode toggle.

### Appearance settings

`AppearanceSection` (`src/ui/settings/AppearanceSection.tsx`) — the
live-repainting theme picker (presets or the custom editor), font family and
text-scale pickers (non-default fonts load on demand), density, and corner
radius. The custom editor uses `ColorPalette` (`src/ui/ColorPalette.tsx`) to
edit individual [colour slots](#custom-theme).

### Editor tab

`EditorSection` (`src/ui/settings/EditorSection.tsx`) — margin (writing-column
width), word-wrap, render-markdown, spell-check / autocorrect toggles, the
default-title scheme, and the [copy](#copy-button) scope. The values are the
[Editor settings](#editor-settings) on the appearance store.

### Storage settings

`StorageSection` (`src/ui/settings/StorageSection.tsx`) — the radio picker for
the backend (This device / Local folder / Dropbox / Google Drive) with connect
buttons, plus the at-rest-encryption toggle. Driven entirely by the
[storage backend hook](#storage-backend-hook). Turning encryption on or off is
the heaviest thing the tab does (key derivation, re-wrapping every note,
re-saving), so the toggle buttons spin while it runs and a one-line
**encryption status bar** flashes the phase it's on — `Reading…`,
`Deriving encryption key…`, `Encrypting…`, `Saving…`, `Finalizing…` — fed by the
`onProgress` callback the hook reports each phase through. The messages flash by
too fast to read in full by design; they're there to show *something is
happening* during the otherwise-silent key-derivation pause. On success the bar
vanishes and the heading's "Encryption is on / off" is all that's left. On
failure the bar turns red and becomes a button that opens the
[encryption log modal](#encryption-log-modal) with the whole phase sequence plus
the error that stopped it.

### Encryption log modal

`EncryptionLogModal` (`src/ui/settings/EncryptionLogModal.tsx`) — the full log
behind a failed [encryption status bar](#storage-settings). The status line only
ever shows the single phase it's on; when a turn-on / turn-off throws, the red
status line becomes tappable and opens this modal, which replays every phase
(timestamped) and the terminating error — the [Logs tab](#logs) experience
scoped to the one operation that just broke, so a passphrase or storage error is
legible on a phone without reaching for devtools.

### Developer settings

`DeveloperSection` (`src/ui/settings/DeveloperSection.tsx`) — appears only when
[dev mode](#dev-mode) is on; surfaces the log-capture toggle and the
[fake-data](#fake-data) toggle.

### Fake data

The developer "Fake data" toggle (`useDevSeed`, `src/dev/useDevSeed.ts`), shown
in [Developer settings](#developer-settings). While on, `App` swaps the active
storage adapter for an ephemeral in-memory seed adapter
(`createDevSeedAdapter`, `src/storage/dev-seed/index.ts`) preloaded with the
combined sample document (`buildSeedSnapshot`, `src/dev/seed.ts`), so a varied
note list can be previewed without touching the real notes on the device. The
flag is in-memory only — a reload (or leaving the app) drops straight back to
the real backend, and edits made against the sample are never saved. Turning it
on unlocks the **Holodeck** achievement. This is the in-app sibling of the
env-driven seed (`make dev-seed` / `VITE_SEED`, `seedDevData` in the same
module), which instead writes the multi-namespace dataset into the real
localStorage keys for debugging across reloads.

### Logs

`LogsSection` (`src/ui/settings/LogsSection.tsx`) — appears when log capture is
on; renders the live [logger](#logger) buffer with clear/export.

### Language picker

`LanguagePicker` (`src/ui/settings/LanguagePicker.tsx`) — switches the active
language; writes the preference (`writeLanguagePreference`) and dispatches the
runtime switch the [language root](#language-root) listens for.

### Settings layout helpers

`src/ui/settings/shared.tsx` — reusable section primitives (Section, Field,
ToggleRow, SegmentedRow) every settings tab composes from.

### Custom dropdown

`SelectPicker` (`src/ui/form/SelectPicker.tsx`) — the app's `<select>`
replacement, used for the [copy button](#copy-button) scope picker in the Editor
tab (`EditorSection`). The trigger is a bordered field wearing a `ChevronDownIcon`
caret; the open menu is a `role="listbox"` of `role="option"` buttons with the
current value ticked and full keyboard nav (Arrow/Home/End to move, Enter/Space
to commit, Escape to dismiss without committing). It renders the menu through
`FloatingPanel` (`src/ui/FloatingPanel.tsx`), a portalled popover shell that owns
the float position (`useFloatingPosition`, `src/ui/hooks/useFloatingPosition.ts`
— measures the trigger, clamps the panel into the visible viewport, and flips it
above the trigger when there isn't room below), the Escape/outside-click
dismissal (`useEscapeKey`, `DismissBackdrop`), and the `document.body` portal
mount. Portalling keeps the menu out of the settings modal's `overflow-y-auto`
body, so a picker on a control near the bottom of the modal isn't clipped.

## Sync and storage status (header)

### Sync status

`SyncStatus` (`src/ui/SyncStatus.tsx`) — the single header glyph that morphs
with sync state (cloud-upload when dirty, spinner when saving, cloud-check when
in sync, cloud-alert on error/offline). Tapping the upload glyph saves
immediately; every other state opens the [sync details modal](#sync-details-modal).
Errors take precedence over the dirty state.

### Sync indicator

`SyncIndicator` (`src/ui/SyncIndicator.tsx`) — the presentational glyph
`SyncStatus` renders, mapping a `SaveStatus` to an icon.

## Storage backends and persistence

### Storage adapter

`src/storage/adapter.ts` — the byte contract every backend implements:
`StorageAdapter` (`id`, `label`, `capabilities`, `load`, `save`, `watch?`,
`getRevision?`, `loadSync?`, `saveDebounceMs`) returning a `StoredSnapshot`
(`{ text, revision?, offline? }`). It is the only seam storage touches the app
through; serialize/parse/migrate all sit one level up so every backend goes
through the same pipeline. Typed failures — `ConflictError`, `AuthError`,
`RateLimitError` — let the sync engine react precisely.

### Storage backend hook

`useStorageBackend` (`src/storage/useStorageBackend.ts`) — wires the whole
storage layer: it resolves the active adapter from the [backend
preference](#backend-preference) + tokens/handles, completes OAuth redirects on
boot, and layers `withLocalCache` then `withEncryption` on cloud backends. It
holds the cloud tokens and the session passphrase, exposes connect/disconnect/
reconnect actions per backend, the `locked` flag and `unlock`, and the namespace
operations. The adapter is memoised so it doesn't churn each render.

### Backend preference

`src/storage/backend-preference.ts` — per-device localStorage keys for the
chosen `BackendId` (`browser` / `folder` / `dropbox` / `gdrive`), the cloud
tokens, and the encryption mode. These are device-local (never in the synced
document, which would create a bootstrap loop) and read on boot before any
backend resolves.

### Serialize / parse

`src/storage/serialize.ts` — `serialize` turns a domain `Snapshot` into stored
JSON (`{ version, ...snapshot }`); `parse` deserializes, runs the migration
chain, and defensively drops malformed notes (null/invalid JSON → empty
snapshot). Every `load`/`save` on every backend passes through here so the
domain never sees versioned JSON.

### Migrations

`src/storage/migrations.ts` — the forward-only chain. `migrate` lifts stored
JSON from its `version` up to `LATEST_VERSION`, one step at a time. Steps are
never rewritten or removed once shipped. The `Snapshot` shape and the runner
mechanics are documented in [`docs/architecture.md`](architecture.md).

### Local backend

`BrowserLocalStorageAdapter` (`src/storage/local/index.ts`), labelled "This
device" — a single JSON document in `localStorage`, one key per namespace
(`namespaceLocalKey`, default keeps the historical `notes/v1`). It implements
`loadSync` for before-first-paint reads and has no revision token (nothing else
writes the key). `deleteLocalNamespace` drops a namespace's key.

### Folder backend

`createFolderAdapter` + `FolderFileStore` (`src/storage/folder/index.ts`),
labelled "Local folder" — the File System Access API directory picker. The
`FileSystemDirectoryHandle` is persisted in IndexedDB (`handle-store.ts`) so it
survives reloads, and the OS permission is re-confirmed each session
(`ensurePermission`). Notes are one `.md` per note via the [directory
adapter](#directory-adapter); each file's `lastModified` is its revision.

### Dropbox backend

`createDropboxAdapter` (`src/storage/dropbox/index.ts`) — notes as `.md` files
under the scoped app folder `notes.niclaslindstedt.se`. It uses the PKCE
full-page-redirect [OAuth](#oauth) flow and refresh tokens for silent re-auth on
401 (coalescing concurrent refreshes), honours 429 rate limits with a cooldown,
and lists non-recursively so the default namespace doesn't pick up other
namespaces' folders. Built on the [directory adapter](#directory-adapter).

### Google Drive backend

`createGdriveAdapter` (`src/storage/gdrive/index.ts`) — notes under a `notes`
app folder in the user's My Drive, scoped to `drive.file` (`GDRIVE_SCOPE`). It
authenticates via a Google Identity Services popup (short-lived access token, no
refresh token — expiry forces re-auth), caches folder ids in memory, and treats
most rate limits as 403-with-reason (quota exhaustion is not transient). Built
on the [directory adapter](#directory-adapter).

### Directory adapter

`createDirectoryAdapter` (`src/storage/directory-adapter.ts`) over a `FileStore`
(`src/storage/file-store.ts`) — the shared sync logic for all three file
backends. It reads every `*.md` into a snapshot, writes only changed notes
(hash-compared), removes only files it authored, and scopes conflicts per-file
so another device's edit to a different note never blocks a save. It remembers
the revisions it produced to tell listing lag from a real remote edit, and
tolerates lost acks. Encrypted stores fall back to a single `notes.json` blob.
A format conversion (toggling encryption) is the one case it removes files it
didn't author: writing the blob clears every `*.md` (and the externalised image
files), and writing markdown clears the blob — so a toggle can't strand the old
representation, which the next load would otherwise read back.

### Markdown codec

`src/storage/markdown/codec.ts` — the one-`.md`-file-per-note codec the file
backends share. `snapshotToFiles` / `filesToSnapshot` convert in both
directions; `noteToMarkdown` writes YAML frontmatter (id, title, created,
updated, archived) plus the body; `parseNote` reads it back defensively
(skipping malformed files); `noteFileStem` builds the `<slug>-<id-suffix>.md`
filename.

### Save retry

`src/storage/save-retry.ts` — `isRetryableSaveError` (false for Conflict / Auth
/ RateLimit, true otherwise) and `backoffDelayMs` (equal-jitter exponential,
base 500ms, capped) drive the sync engine's transient-failure retries, up to
`MAX_TRANSIENT_SAVE_RETRIES`. `src/storage/http-utils.ts` parses `Retry-After`
and reads error bodies safely.

### OAuth

`src/storage/oauth-pkce.ts` — the shared PKCE helpers (`startAuth`,
`completeAuth`, `refreshAccessToken`) used by Dropbox (redirect) and Google
(popup). Each provider has its own `OAuthConfig` and `sessionStorage` verifier
key so parallel flows don't race; the redirect URI is derived from the current
origin+pathname so every deploy slot round-trips to itself.
`src/encoding/base64url.ts` is the URL-safe encoder for the verifier/challenge.

## Encryption and offline

### Encryption

`withEncryption` (`src/storage/encrypting/index.ts`) wraps any backend so the
bytes it stores are AES-GCM ciphertext, decrypted on load. The key is derived
from the passphrase by `src/storage/crypto.ts` (PBKDF2-SHA256, 600k iterations;
`encryptText` / `decryptEnvelope`; the envelope is itself JSON so it shares the
storage slot with plaintext). The passphrase is held in a `PasswordRef` per
session — after reload the store is locked until the [unlock gate](#unlock-gate)
takes it. Toggling the mode rewrites the document at rest: enabling re-wraps the
existing notes into ciphertext and disabling decrypts them back, and the
[directory adapter](#directory-adapter) clears the superseded representation so
no plaintext copy lingers behind a `notes.json` (or vice versa). Both
`enableEncryption` / `disableEncryption` (and `encryptText` / `decryptEnvelope`
underneath) take an optional `onProgress` callback that fires once per phase
(`reading → derivingKey → encrypting`/`decrypting → saving → finalizing`); the
[storage settings](#storage-settings) tab feeds it into its status bar.

### Offline cache

`withLocalCache` (`src/storage/cache/index.ts`) mirrors a cloud backend's bytes
into localStorage (per-backend, per-namespace) so the document reads and edits
offline. It sits between the cloud adapter and the encryption wrapper, so cached
bytes are exactly what the cloud holds (encrypted if encryption is on). On a
network failure (`isOfflineError`) it falls back to the cache and flags
`offline: true`; typed errors (conflict/auth/rate-limit) bypass the cache so
their handlers still fire, and an empty cache raises `OfflineUnavailableError`.

## Namespaces

### Namespaces

`src/storage/namespaces.ts` — named buckets, each holding its own note document.
A `Namespace` is `{ slug, name, glyph?, color? }`; the `slug` is fixed at
creation (it drives the storage location), the `name` is a cheap editable label.
The default namespace always exists and keeps the historical localStorage key /
root folder. Helpers: `addNamespace`, `renameNamespace`, `removeNamespace`,
`setNamespaceAppearance`, `slugify`, and the location mappers
(`namespaceLocalKey`, `namespaceNotesFolder`). The active slug
(`getActiveNamespaceSlug`) is a per-device cursor, not shared.

### Namespace registry store

`src/storage/namespace-store.ts` — mirrors the registry (slugs, names,
appearance) to `namespaces.json` at the file backend's root via
`fileNamespaceStore`, so it travels with a shared folder and lands on every
device. Plaintext even when notes are encrypted; the browser backend keeps the
registry in localStorage and has no file store. `mergeNamespaceLists`
reconciles local and remote on a new-device connect.

### Namespace glyph

`NamespaceGlyph` (`src/ui/NamespaceGlyph.tsx`) renders one namespace icon as an
inline SVG from the fixed path-data catalog in `src/ui/glyphs.ts` (picked via
`GlyphGrid`), painted with `currentColor` and falling back to the folder glyph.
The path data is shared with the [namespace favicon](#namespace-favicon).

### Namespace color

`src/ui/namespace-colors.ts` — the fixed accent palette offered in the namespace
editor; the choice tints the glyph and highlights the namespace's row in the
side menu.

### Namespace favicon

`src/ui/namespace-favicon.ts` — paints the active namespace's glyph and colour
into the browser tab favicon so each namespace is distinguishable at a glance.

## Theme and appearance

### Appearance store

`useTheme.ts` (`src/theme/`) — the external store (persisted to
`notes/appearance`) holding `Appearance`: `theme`, `fontFamily`, `fontScale`,
`customTheme`, `editor` ([Editor settings](#editor-settings)), and the
achievements map + unseen queue. `useAppearance` reads it, `updateAppearance` /
`setTheme` write it, `useApplyAppearance` projects it onto the DOM. Achievement
progress lives here so it syncs across devices via [settings
sync](#settings-sync).

### Theme preset

`ThemePreset` / `THEMES` (`src/theme/themes.ts`) — the built-in palettes (dark,
light, Dracula, Monokai, GitHub dark/light, Solarized Light, Quiet Light, Excel,
plus `system` and `custom`). `themeFamily` and `FAMILY_DEFAULT_THEME` classify
light vs dark; the projection sets `<html data-theme>` which the
[design tokens](#design-tokens) key off.

### Custom theme

`CustomTheme` / `CustomThemeColors` (`src/theme/themes.ts`) — the 11 colour slots
(`pageBg`, `surface`, `surface2/3`, `fg`, `fgBright`, `muted`, `line`, `accent`,
`danger`, `link`) the user can override. `COLOR_KEYS`, `COLOR_GROUPS`,
`COLOR_LABELS`, and `PRESET_PALETTES` drive the `ColorPalette`
(`src/ui/ColorPalette.tsx`) editor; switching to custom seeds from the current
theme (`customThemeSeed`). When `theme === "custom"` the store writes the slots
as inline CSS-variable overrides.

### Fonts

`FontFamilyId` / `FONT_FAMILIES` / `FONT_SCALE_PRESETS` (`src/theme/themes.ts`)
— mono (static), sans, serif, and a dyslexic-friendly face. `loadFontFamily`
(`src/theme/fonts.ts`) lazy-loads the non-default webfont stacks on demand; the
scale multiplier rides `--app-font-scale`.

### Density / radius

`DensityPreset` (compact / comfortable / spacious) and `RadiusPreset` (none / sm
/ md / lg) in `src/theme/themes.ts` — global spacing and corner-rounding,
applied as `--density-*` and `--radius` tokens.

### Design tokens

`src/styles/theme.css` (the `@theme` Tailwind mapping and structural tokens),
`src/styles/palettes.css` (one `[data-theme]` block per preset defining the 11
slots; `system` follows `prefers-color-scheme`, `custom` is filled at runtime),
and `src/styles.css`. `COLOR_KEY_TO_CSS_VAR` (`src/theme/themes.ts`) bridges the
custom-theme slot keys to their CSS-variable names. The whole UI paints from
these variables, so a palette change is a token change, never a per-component
edit.

## Achievements

### Achievement catalog

`src/achievements/catalog.ts` (+ `types.ts`) — `ACHIEVEMENTS`, each entry an
`Achievement` with a stable write-once `id`, an `AchievementTier` (beginner /
intermediate / pro / expert; `TIER_POINTS`, `TIER_ORDER`), a `glyph`, and an
unlock `trigger`. Display copy lives in the `achievements` i18n namespace keyed
by id (`achievements.catalog.<id>.{name,condition,learnMore}`). The
[achievements modal](#achievements-modal) reads it by id, so new entries appear
without touching the renderer.

### Trophy button

`TrophyButton` (`src/ui/achievements/TrophyButton.tsx`) — the header affordance.
Quiet (outline) when nothing is new; lit (accent) with a count badge when there
are unseen unlocks, opening the [unlock modal](#unlock-modal) (lit) or the
[tour](#achievements-modal) (quiet). It hides entirely when achievements are
disabled in [General settings](#general-settings).

### Unlock triggers

A trigger is `derived` — a predicate over `(prev, next)` of the combined
`{ snapshot, appearance }` state that flips false→true, evaluated by
`deriveUnlocks` (`src/achievements/derive.ts`) — or `manual`, fired by
`unlock("<id>")` on the bus (`src/achievements/bus.ts`) from the chokepoint that
observes the gesture (folder/cloud connect, encryption, namespace create,
install, undo, reload, conflict resolve). `useAchievementWatcher`
(`src/achievements/useAchievementWatcher.ts`), mounted once in `App`, runs the
derived pass on every transition and drains the manual bus. Every `manual` entry
must have a wired `unlock` call.

### Achievement glyphs

`src/achievements/glyphs.tsx` — the inline-SVG trophy/feature glyphs the catalog
references (dependency-free, like the UI icons).

## Changelog / What's new

### Changelog data

`src/ui/changelog/data.ts` + `parse.ts` — the build inlines `CHANGELOG.md` and
parses it into release sections the [changelog modal](#changelog-modal) renders.

### Feature docs

`src/ui/changelog/feature-docs.ts` inlines every `docs/features/<slug>.md` (via
`import.meta.glob`); a changelog bullet carrying `[Learn more](feature:<slug>)`
resolves to the matching doc and renders it in place. A feature doc exists only
to back a "Learn more" link — it is not general product documentation (that's
this file, the dictionary, and `docs/architecture.md`).

### Changelog renderer

`src/ui/changelog/render.tsx` — the dependency-free Markdown renderer for the
changelog body and feature docs, with the `feature:<slug>` link scheme for
in-modal cross-links.

## Internationalization

### i18n runtime

`src/i18n/index.ts` — a dependency-free typed runtime. `useT` returns the `t()`
function; `tFor(lang, key, params)` is the framework-free form; `MessageKey` is
the union of dotted catalog paths (typo-rejecting at compile time). English is
bundled and is the `Catalog`/`MessageKey` type source; every other language is
code-split and loaded on demand (`ensureCatalog`).

### Language root

`LanguageRoot` (`src/i18n/LanguageRoot.tsx`) — wraps the app shell, gates first
paint until the persisted language's catalog is resident (no flash of English),
sets `<html lang>`, and listens for the runtime `LANGUAGE_EVENT`.
`src/i18n/language-preference.ts` mirrors the choice to `notes/language` for
first-paint hydration.

### Locale helpers

`src/i18n/locale.ts` — the framework-free `Lang` (`en` | `sv`),
`SUPPORTED_LANGS`, `bcp47`, and `detectInitialLanguage`, shared with the React
Native app.

### Catalog namespaces

`src/i18n/locales/{en,sv}/<ns>.ts` — the per-namespace string modules (`app`,
`common`, `menu`, `nav`, `namespace`, `settings`, `sync`, `pwa`, `changelog`,
`achievements`, `native`). The Swedish files are typed against the English ones,
so a missing key is a compile error. English and Swedish ship today.

## PWA, dev, and build

### PWA update

`usePwaUpdate` (`src/pwa/usePwaUpdate.ts`) — registers the service worker via
`workbox-window` with `updateViaCache: "none"`, checks for updates hourly and on
visibility change, and uses the prompt strategy (the new SW parks in `waiting`;
no `skipWaiting`, to avoid discarding in-progress edits). It polls the precache
to compute download progress (0–100%) and reads the incoming `version.json`,
feeding the [update toast](#update-toast). `cacheIdForBase` keys the cache per
deploy slot.

### Standalone detection

`isStandaloneMobile` / `useStandaloneMobile` (`src/pwa/standalone.ts`) — detects
an installed PWA on mobile (`(display-mode: standalone)` on Android,
`navigator.standalone` on iOS, gated by a mobile UA). Used to enable the
hide-the-button + edge-swipe navigation.

### Dev mode

`useDevMode` (`src/dev/useDevMode.ts`) — the device-local `devMode` and
`captureLogs` flags (localStorage, not synced). Module-scope pub/sub keeps every
hook instance in sync, so toggling dev mode in General settings reveals the
Developer/Logs tabs immediately; turning dev mode off forces capture off.

### Logger

`src/dev/logger.ts` — `createLogger(scope)` writes to an always-on in-memory
ring buffer (bounded ~500 entries); when capture is on it mirrors to
`notes:logs` (debounced) so logs survive a reload. `getLogs` / `subscribeToLogs`
/ `clearLogs` back the [Logs tab](#logs); the storage backends log their sync
diagnostics through it.

### Build env

`src/build-env.ts` — `APP_VERSION` and `BUILD_LABEL`, injected by Vite's
`define` at build time (`__APP_VERSION__` / `__BUILD_LABEL__`) and re-exported
typed.

## The public pages

### Home page

`HomePage` (`src/ui/HomePage.tsx`) — the English-only public showcase / landing
page served at `/home` (and aliased per deploy slot). It doubles as the homepage
Google's OAuth verification requires, so it must accurately identify the app and
its verified domain, fully describe what the app does, and transparently explain
every reason the app requests user data (the opt-in cloud backends and their
exact scopes). Keep it in sync with the product in the same PR as any
feature/data-access change. Mounted by the [path switch](#entry-point--path-switch).

### Privacy page

`PrivacyPage` (`src/ui/PrivacyPage.tsx`) — the English-only privacy policy
served at `/privacy`, the URL given on the Google OAuth consent screen. It
covers storage, network requests, the optional sync backends and their scopes,
encryption, and the absence of cookies/analytics. Keep it accurate to what the
app stores or sends.
