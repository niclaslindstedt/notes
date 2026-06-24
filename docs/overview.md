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
prompts the first note. While the active namespace's first load is still in
flight with nothing seeded (`loading` — see [namespace loading](#namespaces)),
it shows a spinner + `app.loading` instead of the empty prompt, so switching
into a folder/cloud namespace reads as "loading" rather than "empty" until the
document lands.

### Note card

`NoteCard` / `SwipeableNoteCard` in `src/app/App.tsx` — one note in the
overview. Shows the note's title (`noteTitle`), plus a green **lock**
(`LockIcon`, theme `--accent`) when the note and all its attachments are
encrypted at rest (the per-note status from the
[encryption migration](#encryption-migration); the side-menu note rows show the
same). `SwipeableNoteCard` wraps it in `useRowSwipe`: a right-swipe archives the
note, a left-swipe latches a trash button that needs a second tap to delete
(both undoable).

The preview body honours the [note-list layout](#note-list-layout)
(`Appearance.listLayout`): in **rows** it's a single truncated line
(`notePreview`); in **cards** it's a multi-line excerpt (`notePreviewBlock`)
that keeps the note's line breaks, clamps its height, and fades its tail out
with a CSS mask gradient when there's more text below the clamp (a cheap
content-length heuristic decides whether to fade, so a short note isn't dimmed);
in **list** there's no preview at all — `NoteCard` returns early to a bare
file-explorer row of a document glyph plus the title.

### Note-list layout

The overview's three looks, chosen in Settings → Appearance → Note list
(`Appearance.listLayout`, a `ListLayout` of `"rows" | "cards" | "list"` in
`src/theme/themes.ts`; the control is a segmented row in `AppearanceSection`).
**Cards** is the default — taller, roomier note cards with a multi-line,
tail-fading excerpt so the overview reads like a wall of cards. **Rows** is the
compact one-line list — a title plus a one-line excerpt. **List** is the densest
— a bare file-explorer listing of titles only: each note is a single
document-glyph-and-name row with no excerpt and no card chrome, packed tight
(`NoteList` tightens the row gap to `gap-0.5`) under its folder header so the
overview reads like a file tree. It's a synced appearance preference (it changes
nothing about the note document), and switching it the first time unlocks the
**Gallery** achievement. Read by `NoteCard`, which applies to the archive view's
cards too.

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
safe-area inset announcing "Update ready" with the incoming version (truncated
so a long version label never wraps). Driven by `usePwaUpdate`
(`src/pwa/usePwaUpdate.ts`): the new service worker parks in `waiting`, and the
page only swaps when the user presses the primary **Update** button — which
carries the whole "apply it" affordance, so the copy no longer spells out
"reload to apply" — never silently mid-edit. When the side menu is pinned open
as a docked sidebar (≥768px) the toast insets past it on the side it docks
(reading `nav.pinned` / `position.side`) so it centres within the notes content
area rather than the whole viewport. See also [PWA update](#pwa-update).

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

**Opening a note shows it fully formatted.** The active line is nullable
(`active: number | null`), and an existing note opens with *no* line active
(the app passes `focusOnMount={false}`), so every line — last one included —
renders as Markdown and there is no raw textarea until the user actually places
the caret. This is what keeps a note's final line (or its only line) from
opening as plain source, and on mobile it keeps the soft keyboard down until a
deliberate tap. A line goes active only on a click (`activateAt` /
`activateEnd`) or when the title field hands focus down through the editor's
imperative `focus()` handle (`MarkdownEditorHandle`, consumed by `focusBody` in
`App`) on Enter / Arrow-Down. A brand-new empty note shows the "Start writing"
placeholder on the blank rendered line instead of a textarea.

Clicking the empty space below the note (`activateEnd`) always lands the caret
on a blank line at the very bottom, **appending one when the document doesn't
already end in a newline**. Without that trailing blank line the click would
have nowhere to go but the last content line, rolling edit mode onto it and
turning a rendered image (or any formatted line) back into raw source — so a
note that ends in an image gains a fresh line to keep typing on instead. That
appended blank line is held locally and is **not** pushed through `onChange`:
placing the caret is not an edit, so it never bumps `updatedAt` or jumps the
note to the top of the list — the line joins the document only once the user
types onto it.

**Selecting across lines.** A press-and-drag is treated as a text selection
rather than a caret move. Because the active line is a `<textarea>` (its own
selection island) and every other line is a separate element, a plain native
drag could only ever select within one line; so once a drag crosses a few
pixels the editor dissolves the textarea (`active = -1`, every line renders as a
formatted div) and drives the selection with the Selection API from the press
point to the pointer. The drag is armed from a **capture-phase** `mousedown` so
it fires even when the press lands on a link (whose own `mousedown` stops the
bubble phase to stay clickable); the click the browser fires after such a drag
is swallowed so a sweep that began on a link doesn't also navigate. A copy of a
live-preview selection is intercepted (`markdown-selection.ts`) and the verbatim
**source** is placed on the clipboard — so Markdown syntax and full,
un-shortened URLs survive the copy rather than the rendered text. A selection
inside the active textarea is untouched (it's already raw source). See
[Selection mapping](#selection-mapping).

### Selection mapping

`src/ui/markdown-selection.ts` — translates a live-preview DOM selection back
onto the raw note. `sourcePointFromDom` resolves one selection endpoint (a DOM
node + offset) to a source `(line, column)` using the `data-line-index` the
editor stamps on every rendered line and the `data-src` offset each inline leaf
carries; a leaf whose rendered text is shorter than its source (a [shortened
bare URL](#shorten-links)) also carries `data-len` so the *end* of the leaf maps
to the end of the full source token. `extractSourceRange` then returns the
verbatim source the selection covers, clamping interior lines to their content
so list/heading/quote markers (drawn as non-selectable glyphs) never leak in.
Both are pure/DOM-only helpers the editor uses in its `copy` handler.

### Rendered line

`RenderedLine` (`src/ui/MarkdownLine.tsx`) — renders one parsed `LineBlock` as
formatted React (headings, quotes, lists, inline code/links/bold/em/strike).
Every leaf carries a `data-src` offset so a click maps back to a caret position
in the raw source (and a [selection](#selection-mapping) back to a source
column); a shortened bare URL also carries `data-len` (its full source length).
`markdownLineClass` (`src/ui/markdown-line-class.ts`) maps a block kind to its
CSS classes.

A rendered **link** (and an inline image) is the exception to click-to-caret:
it stops the line-level `mousedown` from rolling the editing textarea onto its
line, so a click (or tap, even while another line is being edited) opens the
link instead of entering edit mode on it. To edit a link's text or URL, click
just past it and backspace into it — the raw `[text](url)` source then shows in
the active line's textarea like any other text. Links are rendered
`draggable={false}` so dragging across one starts a text selection instead of a
native link drag.

### Markdown parser

`src/domain/markdown.ts` — a dependency-free, pragmatic Markdown subset.
`classifyLines` splits the body into `LineBlock[]` (one per line, tracking
fenced-code state); `parseInline` tokenizes a line into `InlineNode`s (strong,
em, code, link, image, strikethrough), each leaf carrying a source-column
`offset` for click-to-caret mapping. Both an explicit `[text](url)` link and a
**bare URL** (`http://…`, `https://…`, or `www.…`, via `matchAutolink`) become
a `link` node, so a pasted or typed URL renders and clicks through without the
`[…](…)` ceremony (`www.` gets an `https://` href; trailing sentence
punctuation and an unbalanced `)` stay outside the link). An autolinked node
carries a `bare: true` flag so the renderer knows it may [shorten it for
display](#shorten-links) — an explicit link's label is never touched. The `image` node (`![alt](href)`) is what
the [attachment renderer](#attachments) turns into an inline thumbnail. It is pure (no DOM/IO) and fast enough to run on every
keystroke, which is why it lives in `domain/`.

### Title field

`TitleField` in `src/app/App.tsx` — the note's title field above the editor. It
is an auto-growing textarea, so a long title wraps onto further lines and the
field grows to fit instead of scrolling out of view. A single-line title is
vertically centred against the back button and the copy/sync buttons; once it
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
`disableAutocorrect`, `shortenLinkChars` (see [Shorten links](#shorten-links)),
the `defaultTitle` scheme, and the `copyScope` (see
[Copy button](#copy-button)). They live in the
[appearance store](#appearance-store) (so they sync with the folder/cloud) and
are edited in the Editor tab of the settings modal, `EditorSection`
(`src/ui/settings/EditorSection.tsx`), which groups them into focused bordered
sections (mirroring the General tab) — **New notes** (the default-title scheme),
**Writing column** (margins, word wrap), **Markdown** (live render + link
shortening), **Typing aids** (spell-check / auto-correct), **Formatting on
save** (see [Format on save](#format-on-save)), and **Copying** (the copy scope)
— see [Storage settings](#storage-settings) and its sibling sections.

### Shorten links

`shortenUrl` (`src/domain/markdown.ts`) trims a long **bare URL** for *display*
in the [live-preview editor](#markdown-editor): it keeps the domain (scheme +
host) plus `shortenLinkChars` characters, a `[...]` marker, then the same many
trailing characters — e.g. `https://www.webhallen.com/se/product[...]INYQAvD_BwE`.
The `shortenLinkChars` editor setting (offered as `LINK_SHORTEN_LENGTHS`: 0 /
8 / 12 / 16 / 24, `0` = off, the default) drives it from the **Markdown** group
of [Editor settings](#editor-settings). Only `bare` autolink nodes are
shortened — an explicit `[label](url)` keeps its label — and only the *displayed*
text changes: the node's `data-src` offset and the `<a href>` keep the whole
URL, so the source the editor saves and the click target are untouched, and a
short URL (where head + marker + tail would meet or overlap) is shown in full.
`LinkNode` (`src/ui/MarkdownLine.tsx`) applies it; the
[Short and sweet](#unlock-triggers) achievement fires the first time it's
switched on.

### Format on save

`SaveFormatting` (`src/domain/note.ts`) is the pair of toggles that tidy a
note's body each time it is persisted: `trimTrailingSpaces` clears trailing
spaces / tabs from every line, and `trailingNewline` ensures the body ends with
a single newline (without doubling one already there). Both default on. The
pure `formatBody` / `formatSnapshotForSave` apply them, and the persistence
engine calls `formatSnapshotForSave` in `performSave`
(`src/app/use-notes-sync.ts`) on the snapshot it serializes — **only the stored
bytes are tidied; the on-screen document and undo timeline keep exactly what
was typed**. This is deliberate: the [live-preview editor](#markdown-editor)
treats a body that differs from what it echoed back as another writer's edit
and would clobber the keystroke, so trimming in memory would fight the caret.
The tidied form lands in memory the next time the note is read back from the
backend. The two flags are [Editor settings](#editor-settings) on the synced
[appearance store](#appearance-store), edited under **Formatting on save** in
the Editor tab, and changing either unlocks the **Tidy up** achievement. (The
markdown file backends already end every `.md` file with a newline via the
[markdown codec](#markdown-codec) independent of these flags; the toggles
govern the note body's own canonical form.)

### Attachments

Paste (`Ctrl`/`Cmd`+`V`) or drag-and-drop a file into the editor and it
becomes a note **attachment**. Two kinds, told apart by MIME
(`isImageAttachment`): an **image** shows inline as a small thumbnail you click
to open full-size; **any other file** (a PDF, an archive, a spreadsheet, …)
shows as a **file chip** — a type icon plus the filename, with no preview —
that downloads the file on click. The model is `Attachment`
(`{ filename, mime, data }`, `src/domain/attachment.ts`); it rides on the
`Note` as `attachments?: Attachment[]`, with the full file held in memory as a
`data:` URL and the body carrying a flat reference: an image is
`![file](attachments/<file>)`, an other-file is a plain
`[file](attachments/<file>)` link, so the renderer knows whether to draw a
thumbnail or a chip.

`MarkdownEditor`'s paste / drop handlers build the attachment
(`src/ui/attachments/fromFile.ts`), persist it via `useNotes().attach`, and
insert the reference; `attachableFilesFrom` takes images plus any file that
isn't an importable markdown/text note, so a dropped `.md` still falls through
to the [drag-and-drop import](#drag-and-drop-import). Image filenames take their
extension from the MIME (`attachmentFilename`); a file keeps its own extension
(`fileAttachmentFilename`), since its type may be unknown.

Rendering goes through `AttachmentsProvider` (`src/ui/attachments/`): an `image`
`InlineNode` resolves to one of the note's attachments and renders an
`InlineImage` thumbnail (`useThumbnail` downscales via canvas, cached by
filename); a `link` node whose href points into `attachments/` resolves to a
`FileAttachment` chip (`FileTypeIcon`, `file-icons.tsx`, maps the extension to
one of a handful of type glyphs). `ImageViewer` shows the original image on
click — the provider tracks the **index** of the open image into the note's
*images* (the gallery is images-only; a file chip never opens it), so the close
button (X), Escape, a backdrop click, or a swipe up/down dismisses it, and the
on-screen arrows, the arrow keys, or a left/right swipe step through the note's
images. The images sit side by side on a single horizontal track, so a swipe
drags the neighbouring image into place and the release animates the rest of the
way — a real slide, not a snap-back-and-swap.

Deleting an attachment's `![](attachments/…)` / `[file](attachments/…)`
reference from the body **prunes its attachment**: `editNote`
(`src/domain/note.ts`) drops any attachment the new body no longer references
(via `referencedAttachments`, which matches both reference forms), so an erased
attachment sheds its bytes from the document on every backend — and on the file
backends the next save reconciles the now-orphaned file off disk
([directory adapter](#directory-adapter)).

In memory an attachment's `data` (`data:` URL) is **optional**: on the
file/cloud backends a note loads with its attachments' metadata (`filename` +
`mime`) but **no bytes**, which are fetched **on demand** the first time the note
is opened and an image/file renders (`fetchAttachment` on the adapter →
`AttachmentFetchContext` + `useAttachmentData`, `src/ui/attachments/
fetch-context.ts`; a thumbnail/viewer shows a placeholder until the bytes
arrive). So the note list loads without downloading every note's images.

Attachments are **only offered on a folder / cloud backend** — the editor gates
paste / drop on the adapter's `"attachments"` capability, which the
[directory adapter](#directory-adapter) advertises when an `AttachmentStore`
(`src/storage/attachment-store.ts`) is wired. **Plaintext**: on save the
directory adapter externalises each referenced file to
`attachments/<note-name>/<filename>` (recovering the MIME from the extension via
`mimeForFilename` on fetch). **Encrypted**: each attachment is its own
gzip-compressed, AES-GCM blob at a flat opaque keyed-HMAC name (the binary
container carries the real MIME/filename *inside* the ciphertext), so nothing
leaks — never folded into the note. The local "This device" backend has no
`AttachmentStore`, so it never accepts an attachment.

### Attachments at the end

By default each attachment renders inline where its reference sits. The
**Images at the end** / **Files at the end** [editor settings](#editor-settings)
(`imagesAtEnd` / `filesAtEnd`, governed independently) instead collect the
relocated kind into a block at the foot of the note. The reference stays put in
the body source — only where it *renders* moves: the inline node renders nothing
(`ImageNode` / `LinkNode` return null when their kind is relocated), a whole
line that is just that reference is hidden (`hiddenAttachmentLines`, which also
absorbs the blank line the editor inserts after each attachment so no gap is
left), and `AttachmentsEndBlock` re-renders the relocated images (as
thumbnails opening the same viewer) and files (as chips) at the end.
`relocatedAttachments` splits the note's attachments into the two lists by kind
and placement. Both `MarkdownEditor` and the read-only `ReadOnlyNote` view share
this through the `placement` they pass `AttachmentsProvider`; navigating the
caret onto a hidden line in the editor reveals its raw source (it becomes the
active line), so the reference stays editable. Turning either toggle on unlocks
the **Appendix** achievement.

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
into is a [blank note](#blank-note) and discards itself on close. The trigger
is the add control at the foot of the [note list](#note-list--overview): a
circular floating action button on narrow viewports, which relaxes into an
in-flow, labelled "New note" pill from the `md` breakpoint up — where the side
menu docks as a permanent [sidebar](#side-menu) (`nav.pinned`), beside
which a floating puck reads as awkward.

### Edit a note

`editNote` (`src/domain/note.ts`) replaces the body and bumps `updatedAt` —
but only when the body actually changes: an identical body returns the note
untouched so re-opening a note (and the editor echoing its current source back)
never bumps the date or jumps the note to the top of the list. `useNotes().update`
guards the same way before routing the change through the sync engine and
recording onto the undo timeline with a per-note `mergeKey` so a typing burst
collapses into one step.

### Retitle

`retitleNote` (`src/domain/note.ts`) replaces the title (trimmed, so a stored
title never starts or ends with a space) and bumps `updatedAt`; exposed as
`useNotes().retitle`. See [title field](#title-field).

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
[note card](#note-card) in the **rows** layout. Image-attachment markdown
(`![alt](attachments/…)`, and any `![](…)` image reference) is stripped from
it — the raw syntax is noise in a text excerpt, not content. `notePreviewBlock`
is its **cards**-layout sibling: the same stripping, but it keeps the note's
line breaks (collapsing runs of blank lines) so the multi-line card excerpt
reads like the note itself.

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
a debounced save (per-backend `saveDebounceMs`). On any adapter swap (a
[namespace](#namespaces) switch, a backend change, an encryption unlock) it first
reseeds the on-screen document **synchronously** from the new adapter's
[`loadSync`](#offline-cache) cached index, then runs the async `load()` and
reconciles — so a switch paints the target's content on the first frame instead
of leaving the previous namespace's notes (or a blank list) on screen for the
seconds a cloud/folder load can take. A target with nothing cached parses to a
blank document, since showing nothing beats showing the wrong namespace. It owns
`SaveStatus` (`idle` /
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
binds ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z; the side menu also exposes undo/redo as the
bottom row of the [button island](#folders-in-the-side-menu) at the foot of the
list.

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
namespace switcher, the recent-notes list (with swipe-to-remove rows), a
bordered [button island](#folders-in-the-side-menu) (New note / New folder /
Show all / Archive over Undo / Redo) pinned to the foot of the list, and a
footer (an optional donate, the trophy, an **About** dropdown that folds away the
project links — What's new, source, privacy — and settings). It reads state from
`NavContext` and dispatches modal-open
commands on the [modal bus](#modal-bus). The **Namespaces** heading is a
collapsible toggle (a chevron to the left of the label, via `SectionHeader`'s
`collapsible` props): collapsed by default — and showing only the *active*
namespace, so you always see where you are — it expands to the full switcher on
tap, keeping the drawer led by the notes. The collapse state is view-local
(resets to collapsed on a fresh app load). Switching the active namespace leaves
the editor but deliberately keeps the drawer open, so several namespaces can be
hopped between in one go; opening a note (and the footer/modal actions) still
closes it. The notes list shows a spinner + `nav.notesLoading` while the
switched-to namespace's first load is still in flight with nothing seeded
(`loading` — see [namespace loading](#namespaces)), so the drawer never reads as
"No notes yet." for the seconds a folder/cloud fetch takes.

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

### Suppress swipe navigation

`useSuppressSwipeNavigation` (`src/ui/hooks/useSuppressSwipeNavigation.ts`) —
mounted once in `App`, it cancels the browser's native edge-swipe history
navigation (swipe in from the left edge to go *back*, the right to go
*forward*) so it stops hijacking the side menu's own horizontal swipes, which
live on the same edges. A document-level, non-passive `touchmove` guard:
once a single-touch drag that *starts* within 30px of a screen border proves
horizontal it calls `preventDefault`, killing the native navigation while
leaving the app's pointer-driven swipe gestures (a separate event stream)
untouched. `overscroll-behavior: none` on `html` (`src/styles/theme.css`)
covers Chrome's overscroll navigation; this covers iOS Safari's edge-back
gesture, which that property doesn't reach.

### Drawer swipe to close

`useDrawerSwipeClose` (`src/ui/hooks/useDrawerSwipeClose.ts`) — the reverse
gesture: dragging the open drawer back toward its edge (or a quick flick) closes
it, with the backdrop dimming in step with the drag. Rows tagged
`[data-drawer-swipe-ignore]` keep their own swipe.

### Row swipe

`useRowSwipe` (`src/ui/hooks/useRowSwipe.ts`) — the note-card gesture. A right
swipe >96px archives the note; a left swipe >48px latches a trash button that
needs a second confirming tap to delete. The foreground tracks the finger with
`translateX` and settles via CSS transition on release. **Touch only:** on a
hover/fine-pointer device (`useMediaQuery("(hover: hover) and (pointer:
fine)")`) `SwipeableNoteCard` skips the swipe wiring and renders the card inside
a [right-click menu](#right-click-menu) instead.

### Swipe reveal (sidebar)

`useSwipeReveal` (`src/ui/hooks/useSwipeReveal.ts`) — the side-menu row gesture:
a left swipe latches the row open to uncover a single trash button; tapping it
deletes the note straight away (no confirming second tap — deletion is undoable
from the Edit section), and tapping an open row closes it. **Touch only:** like
the overview card, `SwipeToRemove` swaps the swipe for a
[right-click menu](#right-click-menu) on a hover/fine-pointer device.

### Right-click menu

`RowActionMenu` (`src/ui/RowActionMenu.tsx`) — the desktop counterpart to the
two swipe gestures above. On a hover/fine-pointer device both the overview
card (`SwipeableNoteCard`) and the side-menu row (`SwipeToRemove`) wrap their
content in this component instead of arming a swipe: right-clicking the row
opens a menu of the same actions — archive/restore and delete — and a plain
click still opens/selects the note. It is built on the same
[`FloatingPanel`](#custom-dropdown) the custom dropdown uses (anchored to the
row, portalled to `document.body` so it escapes the drawer's `translateX`,
Escape / outside-click to dismiss, arrow-key nav), and fires the `rightClick`
achievement the first time it opens. Destructive rows (delete) are tinted via
a `danger` flag. Touch devices keep their native context menu and their swipe
gestures untouched.

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
mode / log capture are on), with a footer pinned below the content: **Reset to
defaults** on the left, **Cancel** + **Save** on the right (mirroring
checklist). The appearance settings it owns — theme, font, the Editor controls,
the achievements switch — are edited against a local **draft** and only persist
on **Save**: while the dialog is open the draft streams to the theme engine via
`setAppearancePreview` so the look previews live, **Cancel** (and Escape /
backdrop / the X) drops the draft so the persisted look snaps back, and **Save**
flushes it through `commitAppearance` (which preserves the earned achievements
the dialog can't edit). The device-local controls (language, the
menu-activation toggle, developer mode) and the storage connections apply
immediately — they don't live in the persisted appearance document the draft
snapshots. Tabs reset to General on reopen.

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

`SyncDetailsModal` (`src/ui/SyncDetailsModal.tsx`) — the cloud-sync **command
centre**, opened from the [sync glyph](#sync-status) whatever the current state.
It lays out, top to bottom:

- **Status** — the headline state (saving / error / throttled / offline /
  in-sync) and the failure reason verbatim, with a compact reload glyph beside
  the status card (whatever the state) and the contextual Reconnect / Save now /
  Try again actions below it (each glyphed).
- **Activity** (only when something is happening) — the notes whose file is
  uploading this second (resolved from the [per-note upload
  spinner](#per-note-upload-spinner) ids that `SyncIndicator` maps to titles)
  and the background [encryption conversion](#encryption-migration)'s live
  progress: a heading (Encrypting / Decrypting at rest), a `done / total`
  counter, a fill bar, and the per-note / per-attachment message — the same
  feed the [Storage tab](#storage-settings)'s status bar flashes. A stopped
  conversion shows its error here.
- **Details** — a two-column grid pairing the backend (cloud / folder glyph)
  with the at-rest **Encryption** state (On / Off), then the on-disk file
  location.
- **Sync log** — a collapsible panel reading the cloud-sync scopes straight from
  the in-memory log ring buffer (`getLogs` / `subscribeToLogs`, see
  [logger](#logger)), filtered to a `SYNC_LOG_SCOPES` allowlist. It shows even
  when the developer-mode capture toggle is off (capture only governs
  persistence across reloads, not the live buffer), with a Copy button — so a
  non-developer can read what sync is doing without entering dev mode.

The status copy names the bare service ("Synced to Dropbox"), since the
Encryption column now carries the at-rest state. Its content is short and opens
no soft keyboard, so it renders as a compact `centered` card rather than the
full-screen mobile sheet.

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
the gate. While the passphrase is being checked the **Unlock** button swaps in a
spinner (`BusyLabel`, `src/ui/BusyLabel.tsx`) and a status line beneath it leads
with the [cipher glyph](#cipher-glyph) and flashes the phase the unlock is in,
fed by an `onProgress` callback that `storage.unlock` calls as it brackets the
`load()` that derives the key, reads, and decrypts — so the gate hints at what's
happening instead of sitting blank. The gate uses its own unlock-specific
phrasing for those phases ("Checking your passphrase…", "Decrypting your
notes…", "Unlocking your notes…") via `UNLOCK_STEP_MESSAGE_KEY`
(`src/ui/encryption-progress.ts`) rather than the generic encryption-toggle
copy; the status-line glyph and the underlying `STEP_MESSAGE_KEY` map are still
shared with the
[storage tab's encryption status bar](#storage-settings). On a file/cloud
backend the unlock now renders the list from the [note index](#encryption) in a
single read + decrypt with every body deferred, so it's near-instant and decrypts
no note bodies up front. When there is no usable index — a vault from before the
index existed, or one another device left stale — the load falls back to
decrypting the per-file notes through a bounded concurrency pool (overlapping the
reads instead of one round-trip per note), and *that* path drives the gate's
per-note progress line ("Decrypting "Groceries" (3/12)…", a completion counter
rather than on-disk order): `storage.unlock` points the
`directoryCrypto.onDecryptNote` reporter ref at the gate's status callback for
the duration of the unlock (clearing it afterward), so each fallback note flows
up as a `decrypting` phase carrying an `EncryptionProgressDetail`
(`{ title, index, total }`). The browser backend decrypts one whole envelope, so
it just keeps the generic "Decrypting your notes…" line. See
[encryption](#encryption).

### Cipher glyph

`CipherGlyph` (`src/ui/CipherGlyph.tsx`) — the small "encryptish" progress mark
shown in place of a spinner on both encryption status lines (the
[unlock gate](#unlock-gate) and the [storage tab's encryption status
bar](#storage-settings)). It is a short run of monospace cipher characters
(hex digits and a few symbols) that gently re-scramble — a couple of cells shift
per tick rather than the whole row at once, so it reads as a flowing cipher
without strobing, and it animates without rotating the way a spinner does. It
honours reduce-motion both ways: it never starts the timer when the OS
`prefers-reduced-motion` is set, and freezes mid-flight when the in-app
**Reduce motion** toggle (see [appearance settings](#appearance-settings)),
mirrored onto `<html data-reduce-motion>`, is on — holding a static frame that
still reads as encrypted bytes. It is `aria-hidden`; the surrounding
`role="status"` line carries the readable phase text.

## Settings tabs

### General settings

`GeneralSection` (`src/ui/settings/GeneralSection.tsx`) — the language picker,
the toggle that disables achievements (and hides the trophy button), a
segmented control choosing how the side menu is opened (floating button vs.
edge swipe; mobile PWA only), and the dev-mode toggle.

### Appearance settings

`AppearanceSection` (`src/ui/settings/AppearanceSection.tsx`) — the
live-repainting theme picker (presets or the custom editor), the
[note-list layout](#note-list-layout) toggle (rows vs cards), the **Sidebar**
group (folder placement — folders on top vs mixed in — and the side-menu sort
key — last modified vs name; see
[folders in the side menu](#folders-in-the-side-menu)), font family and
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
[storage backend hook](#storage-backend-hook). How heavy turning encryption on
or off is depends on the backend:

- **On a file/cloud backend** the toggle is near-instant: it only flips the mode
  (and derives the key), then the [encryption migration](#encryption-migration)
  background queue converts the notes one at a time. So the **encryption status
  bar** here reflects that queue (`StorageSection` reads the live `conversion`
  snapshot the [encryption migration](#encryption-migration) hook returns, passed
  down from `App`): led by the [cipher glyph](#cipher-glyph), it flashes exactly
  which note — and which of that note's attachments — is being sealed or unsealed
  right now (`Encrypting "Groceries"…`,
  `Decrypting "photo.png" (attachment of "Trip")…`), and below it a line tells
  the user **they can close settings — the conversion finishes in the
  background**. The messages flash by too fast to read in full by design; they're
  there to show *something is happening* and let the curious watch (the green
  [lock](#note-card) filling in or draining away in the list and side menu is the
  same signal). Turning encryption *off* runs the exact reverse queue, so it is
  just as backgroundable.
- **On the This-device backend** there is no per-note representation (the whole
  document is one envelope), so the toggle still does the work in one pass: the
  buttons spin (the `BusyLabel` spinner) and the bar — led by the
  [cipher glyph](#cipher-glyph) — flashes the coarse phases (`Reading…`,
  `Deriving encryption key…`, `Encrypting…`, `Saving…`, `Finalizing…`) the
  `onProgress` callback reports.

On success the bar vanishes and the heading's "Encryption is on / off" is all
that's left. On failure the bar turns red and becomes a button that opens the
[encryption log modal](#encryption-log-modal) with the recent steps plus the
error that stopped it.

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
in sync, cloud-alert on error/offline). Tapping it always opens the [sync
details modal](#sync-details-modal) — the command centre where the status is
spelled out and Save now lives — whatever the state, including mid-save, so the
glyph stays one predictable way in. Errors take precedence over the dirty state
for which glyph shows.

### Sync indicator

`SyncIndicator` (`src/ui/SyncIndicator.tsx`) — the presentational glyph
`SyncStatus` renders, mapping a `SaveStatus` to an icon.

### Per-note upload spinner

The header [sync glyph](#sync-status) reports one global save state; this is its
per-note counterpart — a small spinner next to exactly the notes whose file is
being pushed to the backend right now, shown on the overview
[note card](#note-card), the side-menu note row, and (for the note open in the
editor) in place of the back button left of the title, so the note you're
editing shows its own sync state while the header cloud glyph keeps meaning
"any sync, including other notes". The signal originates in the
[directory adapter](#directory-adapter): `save` maps each changed note's file
path back to its note id and, around the `store.write` of those files, marks
them in an internal "uploading" set, emitting the full set (and once on
subscribe) through `watchUploads` on the adapter contract — the push-based
sibling of the pull-based `getEncryptionStatus`. The set clears in a `finally`,
so a failed write (conflict, offline, throttle) never leaves a note stuck
spinning. `watchUploads` is forwarded through the offline-cache wrapper
(`src/storage/cache/index.ts`) and carried verbatim by the Dropbox / Drive /
folder adapters (each returns the directory adapter directly); the local browser
backend doesn't implement it (one synchronous blob, nothing to watch).
`useUploadStatus` (`src/app/use-upload-status.ts`) subscribes to the active
adapter and returns the `ReadonlySet<string>` of uploading ids, which `App`
threads to `NoteList`/`NoteCard` and `SideMenu` exactly like the encryption
[lock](#note-card) status. The spinner takes precedence over the green lock on a
row: a note mid-write isn't settled at rest yet, and the lock returns once the
write (and any encryption) completes. It is the visual surface of cloud sync the
way the green lock is the visual surface of [encryption](#encryption-migration),
so — like the lock — it ships no achievement of its own.

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

### Active note cursor

`src/storage/active-note-preference.ts` — a per-device, per-namespace
localStorage cursor (`getActiveNote` / `setActiveNote`, keyed
`notes:active-note:<slug>`) remembering which note was open in the editor.
`App` seeds `editingId` from it on mount and writes it back whenever the open
note changes, so a reload or PWA upgrade lands back on the same note instead of
the overview; switching namespaces restores that namespace's own remembered
note. Like the [backend preference](#backend-preference) and the active-namespace
pointer, it's a device-local cursor (where you were looking, not shared document
state), so it lives outside the synced snapshot. A stale id (the note was
deleted elsewhere) resolves to nothing and falls back to the overview.

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
adapter](#directory-adapter), with grouped notes filed into a real
[folder subdirectory](#folders-sidecar); the store lists **recursively** so
those nested notes are found, and each file's `lastModified` is its revision.

### Dropbox backend

`createDropboxAdapter` (`src/storage/dropbox/index.ts`) — notes as `.md` files
under the scoped app folder (`free-notes` by default, overridable at build time
via `VITE_DROPBOX_APP_FOLDER`). It uses the PKCE
full-page-redirect [OAuth](#oauth) flow and refresh tokens for silent re-auth on
401 (coalescing concurrent refreshes), honours 429 rate limits with a cooldown,
and lists the namespace's notes folder recursively so notes filed into a
[folder subdirectory](#folders-sidecar) are found. Built on the
[directory adapter](#directory-adapter).

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
backends. It reads every `*.md` (now **recursively**, so notes filed into a
folder's subdirectory are found) into a snapshot, writes each note to its
folder-aware path (`noteFilePath`), writes only changed notes (hash-compared),
removes only files it authored — so a note that changes folder is moved by
writing the new path and removing the old — and scopes conflicts per-file so
another device's edit to a different note never blocks a save. It keeps the
last-loaded folder registry (`lastFolders`) so the per-note encryption
migrate / demigrate paths resolve a grouped note's plaintext path the same way a
save does. It remembers
the revisions it produced to tell listing lag from a real remote edit, and
tolerates lost acks. When a session passphrase is held it switches to the
**encrypted per-file representation** — one `<ref>.enc` per note, one opaque
blob per attachment, change-detected by hashing the *plaintext* source so a
fresh-IV re-encryption isn't a spurious change. Sealing (gzip + AES-GCM) is
deferred until *after* change detection picks the files to write, so one edit in
a 500-note vault encrypts one note rather than all of them; the opaque per-note
filename refs (a keyed HMAC) are memoised per session so the same save doesn't
re-derive every note's path. Alongside the per-note files it maintains the
sealed [note index](#encryption) (`.index.bin`) so an unlock renders the list
without decrypting any body, exposing `fetchNoteBody` to decrypt one note's body
on demand (the deferred-body counterpart of `fetchAttachment`); a deferred note
is skipped by the save planner so it's never rewritten body-less nor pruned. It
also exposes `fetchAttachment`, `getEncryptionStatus`, `migrateNote`,
`demigrateNote`, and `splitLegacyBlob` for the
[encryption migration](#encryption-migration). A representation conversion is
the one case it removes files it didn't author, done atomically (write-new →
verify-by-readback → delete-old over distinct deterministic paths): enabling
supersedes every `*.md` (+ plaintext attachment files) and a legacy `notes.json`;
disabling supersedes the `*.enc` (+ opaque blobs). So a toggle can't strand the
old representation, and a crash mid-switch leaves both copies for an idempotent
resume rather than losing data.

### Markdown codec

`src/storage/markdown/codec.ts` — the one-`.md`-file-per-note codec the file
backends share. `snapshotToFiles` / `filesToSnapshot` convert in both
directions; `noteToMarkdown` writes YAML frontmatter (id, title, created,
updated, archived, and the `folder:` id) plus the body; `parseNote` reads it
back defensively (skipping malformed files); `noteFileStem` builds the
`<slug>-<id-suffix>.md` filename. `noteFilePath` / `folderDirName` /
`folderDirSegment` add the **physical folder directory** a grouped note is filed
into — `<folder-dir>/<stem>.md`, the folder-name slug — and `noteToMarkdown`
takes a `folderDepth` so a note nested in a folder points its on-disk attachment
references up the extra `../` level to reach the sibling `attachments/` tree.

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

At-rest encryption keys off the passphrase via `src/storage/crypto.ts`
(PBKDF2-SHA256, 600k iterations). The key derivation is split from the cipher so
the session key is derived **once** (`deriveSessionKeys` → a content `CryptoKey`
+ an HMAC `fileKey`) and reused for every file, rather than re-deriving per note
— the non-secret salts live in a `.keyparams.json` beside the notes. There are
two on-disk shapes: a self-contained JSON `Envelope` (`encryptText` /
`decryptEnvelope`, carrying its own salt) used for the single-document browser
backend and the offline cache seal, and a compact binary container
(`src/storage/crypto-binary.ts`, `sealBytes`/`sealString`) used for the per-file
form. Everything is **gzip-compressed before encryption** (`src/storage/
compress.ts`).

On the file/cloud backends encryption is **per-file**, performed inside the
[directory adapter](#directory-adapter) (not the `withEncryption` wrapper, which
now only wraps the browser backend): each note is its own encrypted `<ref>.enc`
file and each attachment its own encrypted blob, both at opaque keyed-HMAC names
so titles, filenames, and grouping don't leak. The passphrase rides a
`passwordRef` so a runtime unlock/enable/disable doesn't rebuild the adapter;
after reload the store is locked until the [unlock gate](#unlock-gate) takes the
passphrase (verified against the per-file notes, or the sealed offline cache).
Toggling the mode converts every note + attachment across representations
atomically — write the new copy, verify it reads back, then delete the old —
over distinct deterministic paths, so an interruption can't lose data. See
[encryption migration](#encryption-migration) for the paced, resumable
conversion and the green lock. On a file/cloud backend `enableEncryption` only
flips the mode (no bulk re-save) and `disableEncryption` only raises
`encryptionDisabling`, handing the actual work to the background queue;
`finishDisableEncryption` is what the queue calls once the last note is back to
plaintext, to drop the passphrase and persist the plaintext mode. The
This-device backend has no per-note form, so there both still convert the whole
document in one pass and take an optional `onProgress` callback (`reading →
derivingKey → encrypting`/`decrypting → saving → finalizing`) the
[storage settings](#storage-settings) status bar feeds on.

**Fast unlock via the note index, lazy bodies.** Decrypting every note's `.enc`
on unlock made a cold load O(notes) reads + decrypts — tens of seconds for a
large vault. So alongside the per-note files the adapter keeps one sealed **note
index** (`src/storage/note-index.ts`, written to `.index.bin`): a list of every
note's metadata — id, title, timestamps, folder, archived flag, attachment
metadata — plus a `preview` snippet, so the whole list renders from a **single
read + decrypt** with each note's `body` left **deferred** (`undefined`).
`Note.body` is therefore optional: `undefined` means "not loaded yet" (distinct
from `""`), and the in-memory `preview` carries the list text meanwhile. Opening
a note calls `fetchNoteBody` (the body's counterpart to `fetchAttachment`),
which decrypts just that note's `.enc`; the editor shows a "Decrypting…"
placeholder and withholds editing until it lands, so a keystroke can't overwrite
the unloaded body. Offline is **progressive**: a note becomes readable offline
once it has been opened (its body is cached on first open); a note never opened
needs a connection the first time.
The index is a pure **optimisation, never the source of truth**: the per-note
files + the listing stay authoritative, so it's written best-effort (last-writer-
wins, *never* conflict-checked — which is what keeps per-file sync working), and
on load any `.enc` the index doesn't cover at the current revision (a stale index,
or a note another device just changed) is decrypted individually as the fallback.
Because a deferred note's body isn't in memory, the save planner **skips** it
(never re-writing it body-less, never removing it as an orphan) and attachment
reconciliation keeps all of its declared blobs; a metadata edit (retitle /
archive / move) loads the body first so the `.enc` is rewritten faithfully.
Bodies you've opened ride a second sealed mirror in `withLocalCache`
(`<key>:bodies`), written debounced so a burst of opens pays the deliberately-
slow seal once rather than per note — which is what makes an opened note
reopenable offline.

The encrypted load is also **cached** so the same notes are never decrypted
twice needlessly. Every `load()` still runs a fresh `store.list()` (so it can
never serve data staler than the backend), but keys two in-memory caches off the
revisions that listing reports: a **load memo** returns the previously-built
snapshot whole when the entire listing is byte-identical, and a **per-note
cache** (`encNoteCache`, keyed by `<path>@<rev>`) reuses each note's already-
unsealed JSON (so an opened body stays loaded across reloads, and a one-note
remote edit re-decrypts one note). Both caches are dropped whenever the
keys change (lock / unlock / passphrase switch). A fully-migrated vault also
skips the attachment listing on load entirely (each encrypted note already
carries its attachment metadata in its own JSON, as does the index), walking it
only while plaintext remnants from an in-progress migration remain.

### Encryption migration

`src/storage/encryption-migration.ts` (`runEncryptionMigration`) + the
`use-encryption-migration` hook (`src/app/use-encryption-migration.ts`,
`useEncryptionMigration`) — the paced background conversion that runs after
encryption is turned **on or off** on a file/cloud backend. It is
**bidirectional**: enabling hands it the directory adapter's `migrateNote`
(plaintext → encrypted), disabling hands it `demigrateNote` (encrypted →
plaintext), selected by the `disabling` flag. Either way the mode the app
reports flips immediately (the encrypted load merges any not-yet-converted
remnants, so the document stays complete and the run is resumable across a
reload), then the queue converts one note at a time — small pacing gap +
`RateLimitError` backoff so a big folder never bursts the cloud API, and the
settings modal can be **closed while it runs**. Failures are **triaged, not
blanket-aborted**, so a flaky link can't strand a folder half-converted: a
*transient* error (a dropped fetch / "Load failed", a 5xx) retries the same
note with growing backoff up to a budget (`onRetry` surfaces "retrying…" in
the log) before giving up; a *permanent* one (auth expired, a write conflict)
propagates straight to its reconnect / resolve UI. While the backend is
**offline** the queue holds entirely (`paused`) rather than failing every note
against an unreachable server — it keeps the locks visible, shows a neutral
"paused" line, and **resumes on its own when connectivity returns** (the hook
re-runs when `paused` flips, and each converter is idempotent so it picks up
where it left off). Existing users on a legacy whole-document `notes.json` are
upgraded first by `splitLegacyBlob` (forward only). Each converter reports fine-grained steps (each attachment, then the note
file) so the [storage settings](#storage-settings) can flash what it's on, and
the hook returns both the per-note `encrypted` / `pending` status map
(`getEncryptionStatus`, drives the green [lock](#note-card) in the overview and
side menu) and a live `conversion` snapshot (`EncryptionConversionState` — which
note/attachment, how far along, any error, a capped log). When every note is
sealed it fires the **Fort Knox** achievement; when every note is back to
plaintext it calls `onDisableComplete` to finalise the turn-off.

### Offline cache

`withLocalCache` (`src/storage/cache/index.ts`) mirrors a cloud backend's bytes
into localStorage (per-backend, per-namespace) so the document reads and edits
offline. It sits between the cloud adapter and the encryption wrapper, so cached
bytes are exactly what the cloud holds (encrypted if encryption is on). On a
network failure (`isOfflineError`) it **retries the load a couple of times with
short backoff before** falling back to the cache and flagging `offline: true`,
so a single dropped request (a flaky mobile link, an iOS Safari "Load failed"
`TypeError`) doesn't flap the offline banner — only a sustained outage does;
typed errors (conflict/auth/rate-limit) bypass the cache so their handlers
still fire, and an empty cache raises `OfflineUnavailableError`.
The wrapper also exposes `loadSync` from the mirror, so a cloud backend paints
its last-known notes on the first frame instead of flashing an empty list while
the network round-trip runs (the async `load()` then replaces them with the
fresh remote copy). It returns null while encryption is on, since unsealing the
mirrored envelope is async — that path stays on the async load.

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

**Switching loads the new namespace's document.** `switchNamespace` rebuilds
the document adapter onto the target's storage location, and the
[sync engine](#sync-engine) reseeds the on-screen document synchronously from
the adapter's `loadSync` fast path (the browser store's bytes, or a cloud
backend's offline mirror) before the async `load()` reconciles with the live
copy — so a switch paints the target's notes on the first frame rather than the
previous namespace's. When there's nothing to seed (a namespace never visited
on this device, so no mirror exists yet) the folder/cloud `load()` is a real
round-trip, and `App` derives a `notesLoading` flag (`!sync.loaded`, the backend
isn't the synchronous browser store, and no notes/folders are seeded) that the
[note list](#note-list--overview) and [side menu](#side-menu) render as a
spinner + loading hint (`app.loading` / `nav.notesLoading`) — so the empty list
reads as "loading" rather than the misleading "No notes yet." until the fetch
lands. The browser store loads synchronously, so it never enters this state.

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

## Folders

Folders group notes **inside** a single namespace — a namespace's "Login
feature", "Vacation 2025". They are a layer below namespaces: switching
namespace swaps the whole document, while folders just organise the notes
within one. A `Folder` (`src/domain/note.ts`) is `{ id, name, createdAt }`; a
note points at one by `Note.folderId` (absent = ungrouped), and the registry of
folders rides on the `Snapshot` as `folders?: Folder[]` — kept on the snapshot
rather than derived from the notes, so an **empty** folder persists. The pure
helpers are `createFolder`, `setNoteFolder` (moving a note, which deliberately
does **not** bump `updatedAt` — filing isn't editing), `notesInFolder`, and
`sortFoldersByCreated` (folders sort by creation order so the list stays stable
as notes move). A note whose `folderId` points at a folder the registry no
longer has is treated as ungrouped everywhere, so a stale link never hides a
note. On the file/cloud backends a folder is a **real directory** the note's
`.md` is filed into (see [folders sidecar](#folders-sidecar)); on the local
"This device" backend, where there are no files, folders are purely the
`folderId` + registry.

The notes store (`src/app/use-notes.ts`) exposes the sorted `folders` and the
verbs `createFolder` (fires the **Filing system** achievement), `renameFolder`,
`removeFolder` (which only ungroups its notes — they survive, undoably), and
`moveNote`; `create` takes an optional `folderId` so a note can be born inside a
folder. Every mutation runs through `commitSnapshot`, which preserves the folder
registry across edits (the plain `commit` is now a thin wrapper that swaps only
the notes list).

### Folders in the side menu

`SideMenu` (`src/ui/SideMenu.tsx`) renders the folders and the ungrouped notes
together in one root drop zone below the Notes heading. The Notes heading
carries no trailing action — adding a folder lives on the action bar below as
the **New folder** `BarButton` (a plain `FolderIcon`), beside New note. Pressing it
drops an inline, unnamed `FolderEditRow` into the list — commit a name
(Enter / blur) to persist it, or defocus it empty to discard it (the row simply
vanishes, so a misfire costs nothing). Each `FolderRow` expands to
reveal its notes (indented), and carries a **"+" pinned to its far right**
(`onAddNote`) that starts a note already filed inside it — replacing the old
per-folder "New note" row. Its glyph swaps closed→open (`FolderIcon` →
`FolderOpenIcon`) as it expands, but the **accent (green) tint is reserved for
when the open note is filed inside that folder** (`containsActiveNote`) — merely
expanding a folder does not colour it. The folder row's edit and delete actions stay hidden
until summoned, the way a note's do: a **left swipe** latches open an
`[edit | delete]` strip (sharing the width of a note's single delete button,
split in two) on touch, and a **right-click** opens the same two actions on a
computer (`RowActionMenu`); editing swaps the row for the inline
`FolderEditRow`.

How the folders and loose notes are ordered is two appearance preferences (see
[appearance store](#appearance-store)). **`folderPlacement`** is `top`
(folders pinned above the loose notes — the historical layout) or `mixed`
(folders interleaved with the notes by the sort key, via `mixTopLevel`).
**`noteSortKey`** is `modified` (most-recently-edited first) or `name`
(alphabetical); `sortNotesBy` orders the notes and a folder's contents, and
`sortFoldersBy` orders the folders — by name, or by their newest note's
timestamp (`folderModifiedAt`). The loose notes are still capped at
`MAX_RECENT_NOTES`. Both are set in **Appearance → Sidebar**.

The **button island** is one bordered block (`BarButton`) pinned to the foot of
the list (`mt-auto`), instead of full-width rows, to save vertical space: a top
row of **New note / New folder / Show all / Archive** and a bottom row of
**Undo / Redo**, split by a divider so the six icon buttons read as one coherent
unit rather than competing widgets. The cells sit flush against one another (the
parent owns the border, rounding, and the inner `divide-x` / `divide-y`
dividers) and split their row's width evenly so each row reads symmetric. The
buttons are **icon-only** — the label rides on `aria-label` / `title` rather than
visible text. New folder drops the inline `FolderEditRow` into the list above;
Show all and Archive tint accent when their view is showing; Archive carries the
archived-note count as a corner badge and doubles as a drop target; Undo / Redo
dim and go inert (`disabled`) at the ends of the timeline but keep the drawer
open so a burst of reverts can be applied without reopening it.

The drawer's **footer** — pinned below the island — is the relocated burger
menu: an optional donate link, the trophy ([achievements](#achievements)), an
**About** dropdown, and settings pinned last. The **About** row is a plain
footer row (no chevron) that toggles a `FloatingPanel` of the project links —
What's new ([changelog](#changelog--whats-new)), source (with the build label as
a subtitle), and privacy. The panel flips **upward** (`ABOUT_PLACEMENT`,
anchored left, viewport-spaced) because there is no room below it at the foot of
the drawer.

A note row can be **dragged onto a folder** to file it, or onto the ungrouped
root zone to take it out of one. On a pointer device this is native HTML5 drag
(`NOTE_DND_TYPE` carries the note id; the highlight follows `dropTarget`, and a
drop on a folder calls `stopPropagation` so it doesn't bubble to the root
zone); on a touchscreen it's a **press-and-hold** gesture (see
[note drag](#note-drag-touch--pointer)), with the
[folder picker](#folder-picker) as a keyboard/quick alternative.

### Folders in the overview

`NoteList` (`src/app/App.tsx`) mirrors the same grouping: with at least one
folder it renders a collapsible section per folder (each a drop target, with a
"New note" shortcut) followed by the ungrouped notes under a "No folder" label
(itself the drop zone for moving a note out). Cards drag onto folders exactly
like the side-menu rows — HTML5 drag on a pointer device, press-and-hold on
touch. With no folders it falls back to the flat list unchanged.

Each folder header carries the same hidden edit + delete actions the side
menu's [`FolderRow`](#folders-in-the-side-menu) does (`OverviewFolderHeader` in
`src/app/App.tsx`): a **left swipe** latches open an `[edit | delete]` strip on
touch (`useSwipeReveal`, no archive analogue so a right swipe is inert), and a
**right-click** opens the same two actions on a computer (`RowActionMenu`).
Editing swaps the header for the inline `FolderRenameRow` name editor (the
overview's counterpart of `FolderEditRow`); deleting only ungroups the folder's
notes and is undoable, so — like a note delete — it needs no confirm beat.

### Note drag (touch / pointer)

`src/ui/note-drag.tsx` (+ `note-drag-context.ts`) is the shared drag layer both
surfaces file notes through. Native HTML5 drag only fires for a mouse, so on a
touchscreen `useTouchNoteDrag` supplies the equivalent: a **long-press** (hold
~320ms without moving) picks the note up, a floating ghost follows the finger,
and releasing over a folder files it. It coexists with swipe-to-archive/delete
by latching on a still hold — any movement past a small slop before the timer
elapses is left to the existing swipe/scroll. Once engaged it captures the
pointer (so the inner swipe element stops seeing moves) and blocks page scroll,
and it hit-tests with `elementFromPoint` against any element carrying the
`data-note-drop` attribute. `NoteDragProvider` (mounted once around the shell in
`App`) renders the ghost and reports a drop as `onDrop(noteId, key)` — the raw
target key, which `App` resolves to an action. `NoteDragItem` is the per-row
wrapper that wires the desktop HTML5 props and the touch handlers together; drop
targets read the hovered key via `useNoteDropKey` to paint their highlight. The
side menu and the overview both carry `select-none` so a drag never paints a
text selection across the rows it crosses.

The drop-target keys (see `note-drag-context.ts`) span four kinds of target:

- a **folder id** — file the note into that folder, and `NOTE_DROP_ROOT` — take
  it out of every folder (both surfaces);
- `NOTE_DROP_ARCHIVE` — the side menu's **Archive** row, which archives the note;
- `ns:<slug>` (`noteDropNamespaceKey`) — a side-menu **namespace** row, which
  moves the note into that namespace.

The archive and namespace targets are **side-menu only**. Moving a note across
namespaces is a cross-document write: `useStorageBackend.moveNoteToNamespace`
hydrates the note's attachment bytes (so they travel), builds an adapter for the
target namespace's storage location on the same backend (`makeInner(slug)`),
prepends the note to that document, and saves; `App` then removes it from the
source namespace. The source folder link is dropped (the target has its own
folders). It's best-effort — if the target write fails (offline cloud) the note
is left in place — and undo restores the source copy (which can leave a copy in
both namespaces, the one rough edge of the cross-document move).

### Folder picker

`FolderPicker` (`src/app/App.tsx`) is a compact `SelectPicker` in the editor
header (shown only when folders exist) listing "No folder" plus every folder —
the cross-platform way to file the open note, since it works on touch where
drag-and-drop doesn't. Choosing an entry calls `moveNote` for the open note.
Its trigger collapses to just the folder icon on a narrow viewport (the name
eats scarce header width there) and brings the label back once the window is at
least 640px wide; the icon glows in the accent colour when the note is filed
and stays muted grey for "No folder", so the filed-vs-unfiled state reads at a
glance.

### Folders sidecar

On the local "This device" backend folders ride the JSON snapshot for free
(serialize/parse round-trip `folders` and `folderId`). On the file/cloud
backends a grouped note is filed into a **real subdirectory** named after its
folder — `notes/<folder-dir>/<stem>.md`, where `<folder-dir>` is a slug of the
folder's display name (`folderDirName` / `folderDirSegment` in the
[markdown codec](#markdown-codec)) — so the synced folder is browsable and
tool-friendly (open the `recipes/` directory in any file manager and there are
the recipes). The note's folder **id** still rides its markdown frontmatter
(`folder:`) — or the encrypted note JSON — and that frontmatter id, not the
directory, is the **authoritative link the load reads back**: the physical
directory is a write-side projection, so two folders that happen to slug alike
never lose a note, and moving a `.md` file between directories by hand doesn't
re-file it (the next save snaps it back to match the frontmatter). The folder
**names and any empty folders** live in a plaintext `folders.json` sidecar at
the notes root (`FOLDERS_FILE_NAME`); an empty folder simply has no directory on
disk until a note is filed into it. The [directory adapter](#directory-adapter)
owns it: `readFolders` / `injectFolders` fold the registry into the loaded
snapshot (and load a namespace whose only content is empty folders as a real,
non-null document), and `persistFolders` writes it back when it changed (writing
`[]` to clear a registry whose folders were all removed). `readFolders` reads
the sidecar **directly by path** rather than gating on the directory listing: a
cloud `list()` is only eventually consistent and can omit `folders.json` right
after a cold start (unlock on app start / upgrade reload), while a read of a
known path is strongly consistent — trusting the listing made the load cache a
folderless snapshot until the adapter was rebuilt (the "switch namespaces back
and forth" workaround), and dropped empty folders along with it. The extra read
is paid only when the listing actually moved, since an unchanged backend is
served from the [load memo](#directory-adapter). The read itself is also
**retried** a few times: a *thrown* read (a cold-start rate-limit from the
load's request burst, a dropped request) is not "no folders" — treating it as
empty was a second way the registry got dropped and cached. If every attempt
fails, `readFolders` keeps the previously-known folders and clears its
`foldersReadOk` flag so the load is **not memoized** (and a later refresh
re-reads it) rather than the folderless result sticking until a rebuild. Like
`namespaces.json`
it stays plaintext even under encryption — names aren't secret and must be
readable before the unlock gate — and it is metadata, never read as a note nor
removed on a representation switch. It sits outside the aggregate revision, so a
folder-only change on another device isn't picked up by a live pull until a note
also moves.

The **encrypted** per-file representation stays flat and opaque on purpose
(`<ref>.enc` at the notes root, no folder directories), so the at-rest layout
leaks nothing about which notes are grouped together — physical folders are a
plaintext-only nicety. Filing a note into a folder, renaming a folder, or
deleting one therefore relocates the affected `.md` files on the next save (the
[directory adapter](#directory-adapter) writes the new path and removes the old
one, the same per-file move it does for any path change); an emptied folder
directory may linger harmlessly until the backend prunes it.

## Theme and appearance

### Appearance store

`useTheme.ts` (`src/theme/`) — the external store (persisted to
`notes/appearance`) holding `Appearance`: `theme`, `fontFamily`, `fontScale`,
`customTheme`, `listLayout`, `folderPlacement` and `noteSortKey` (the side-menu
layout preferences — see
[folders in the side menu](#folders-in-the-side-menu)), `editor`
([Editor settings](#editor-settings)), and the achievements map + unseen queue.
`useAppearance` reads it, `updateAppearance` /
`setTheme` write it, `useApplyAppearance` projects it onto the DOM. Achievement
progress lives here so it syncs across devices via [settings
sync](#settings-sync).

The store also carries an **ephemeral preview override** for the [settings
modal](#settings-modal)'s draft/Save flow: `setAppearancePreview(draft | null)`
holds an unsaved draft that the projection (`useApplyAppearance`) paints in
place of the persisted document, while **every other consumer keeps reading the
persisted document** — so editor / achievement behaviour doesn't shift mid-edit
and reverts cleanly on Cancel. `commitAppearance(draft)` persists the draft
(preserving the live achievement map + unseen queue, which the dialog doesn't
edit) and clears the preview. Quick toggles outside the dialog still persist
immediately through `updateAppearance` / `setTheme`.

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
