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
main area that switches between four surfaces on a plain `Route` value (no
routing library, so the tree stays mounted): the notes overview (`NoteList`),
the archive (`ArchiveList`), an editable note (`Editor`), and a read-only
archived note (`ReadOnlyNote`). The small top-level state — `editingId`,
`readingId`, `view` — is projected off that route, which `useRoute` mirrors
into the browser's session history so Back / Forward walk the notes you
visited (see [route](#route--browser-back--forward)). It wires the
cross-cutting hooks (`useNotes`, `useNotesSync` via the store, `useNavState`,
`useTheme`/appearance, `usePullToRefresh`, `useFileDrop`, `useEdgeSwipeOpen`,
`useUndoRedoShortcuts`) plus the five modal hosts and the header (app title and
the `TrophyButton`; the sync glyph `SyncStatus` lives in the side menu's
[button island](#folders-in-the-side-menu) instead).

### Entry point / path switch

`src/app/main.tsx` — the Preact entry point. It mounts the global stylesheet and
the bundled webfont for offline first paint, then does a trivial
`window.location.pathname` switch: a path ending in `/privacy` renders
`PrivacyPage`, `/home` renders `HomePage`, anything else renders the main
`App`. Only the app shell is wrapped in `LanguageRoot` (`src/i18n/`); the two
public pages are English-only and bypass i18n. The shell is additionally wrapped
in `ErrorBoundary` (inside `LanguageRoot`, so the fallback is translated) — see
[crash screen](#crash-screen).

### Crash screen

`ErrorBoundary` (`src/ui/ErrorBoundary.tsx`) — the app's last line of defence,
wrapped around the shell in `main.tsx`. Preact unmounts the entire root when a
render throws and nothing catches it, which on a PWA leaves a blank page whose
only cure is force-quitting the app and launching it cold. The boundary turns
that into a titled message and a **Reload the app** button. Nothing is lost by
reloading: notes are persisted on every edit, so the reload re-reads them from
the active backend.

The caught error goes to the [in-app logger](#logger) under the `crash` scope
rather than the console — on the phone where a blank screen hurts most,
devtools aren't reachable, and the entry survives the reload so it can be read
back from Settings → Logs and reported. The stack and the Preact **component
stack** (which names the surface that threw) are also shown inline behind a
collapsed "Error details" disclosure, and a **Copy report** button puts both,
plus the tail of the in-app log, on the clipboard. Settings → Logs lives inside
the app this screen has replaced, so without that button the only way to report
a phone-only crash was to transcribe the stack off the screen by hand.

The screen is a **fixed, self-scrolling sheet**, not a block in document flow.
It renders outside the app shell (which pins itself to the visual viewport),
and `html, body` are locked to `overflow: hidden` so the document itself never
scrolls — anything past the fold was simply clipped away, taking the error
details with it. Pinning to the viewport and scrolling inside keeps the whole
report reachable, and safe-area padding on **all four** edges keeps it clear of
the notch, the home indicator, and the landscape rounded corners the way every
modal is.

This is a safety net, not a licence: a caught error is still a defect. The
crash it was built for was the [live-preview editor](#markdown-editor) letting
the browser mutate the DOM Preact owns (see [selection
mapping](#selection-mapping)), which is fixed at the source too.

### Note list / overview

`NoteList` (`src/ui/note-list/NoteList.tsx`) — the main screen. Renders the visible note
set (`notes` from `useNotes`: active, non-blank, sorted newest-edited) as a
column of `NoteCard`s, with pull-to-refresh on remote backends and a control
to create a new note. Tapping a card opens it in the `Editor`; the empty state
prompts the first note. While the active namespace's first load is still in
flight with nothing seeded (`loading` — see [namespace loading](#namespaces)),
it shows a spinner + `app.loading` instead of the empty prompt, so switching
into a folder/cloud namespace reads as "loading" rather than "empty" until the
document lands.

### Note card

`NoteCard` / `SwipeableNoteCard` (`src/ui/note-list/NoteCard.tsx`) — one note in the
overview. Shows the note's title (`noteTitle`), plus a **lock** (`LockIcon`,
rendered by the local `NoteLock` helper) when the note and all its attachments
are encrypted at rest (the per-note status from the
[encryption migration](#encryption-migration); the side-menu note rows show the
same). The lock's **colour** reports whether the body has been decrypted this
session: green (theme `--accent`) once it's loaded/warmed (`note.body !==
undefined`, after the lazy [`ensureBody`](#encryption) fetch on open), gray
(`--muted`) while it's still sealed-but-deferred and would decrypt on open — so
a glance tells which notes open instantly. `SwipeableNoteCard` wraps it in
`useRowSwipe`: a right-swipe archives the
note, a left-swipe latches a trash button that needs a second tap to delete
(both undoable).

The preview body honours the [note-list layout](#note-list-layout)
(`Appearance.listLayout`): in **rows** it's a single truncated line
(`notePreview`); in **cards** it's a multi-line excerpt (`notePreviewBlock`)
that keeps the note's line breaks and clamps to a fixed number of lines with
`line-clamp` (plus `contain: layout`) — a clean line-boundary cut that truncates
with an ellipsis only when the body overflows, so a short note keeps its natural
height and every long card is the same height. The `contain: layout` is
load-bearing: without it iOS WebKit lets a `-webkit-line-clamp` box reserve its
full un-clamped content height, inflating a long card (e.g. a deferred note whose
stored preview keeps blank lines) with empty space that reads as a large uneven
gap before the next card; layout containment isolates the box so the card sizes
to the clamped lines. (This whole clamp replaced an even earlier `max-height` +
CSS-mask fade, whose mask compounded the same iOS mis-measurement.)
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

`ArchiveList` and `ReadOnlyNote` (`src/ui/ArchivedNoteView.tsx`), shown when
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

### Toast

`Toast` (`src/ui/Toast.tsx`) — the transient confirmation pill: a message, an
optional leading glyph, and — usually — nothing to press. It says "that worked"
for an action that would otherwise finish silently; the [export
menu](#export)'s **Copy to clipboard** row shows `Copied` for 1.6 seconds, and
[ticking off a dropzone note](#dropzone) raises `DropzoneDeletedToast`
(`src/ui/DropzoneDeletedToast.tsx`) through it. That caller uses the pill's one
optional interactive part: an `action` prop grows a trailing button (its
**Undo**), the sole press the pill can carry — the pill itself stays
`pointer-events-none`, only the button catches taps.
The **caller owns the timer** and simply stops rendering the toast when it
expires — the component owns only where it sits and how it announces itself
(`role="status"` + `aria-live="polite"`, so it is read after the current
utterance rather than interrupting it, and `pointer-events-none` so it never
eats a tap meant for the note underneath). It enters on the `toast-in`
animation in `src/styles/theme.css` (a short rise and fade, zeroed under
`prefers-reduced-motion`), the same mount-time-`animation` pattern the drawer
and the styling toolbar use.

It docks the way the [update toast](#update-toast) does — above the bottom
safe-area inset, inset past the side menu when that is pinned open as a sidebar
— and **stacks above it**, which is the layering `UpdateToast` was written to
expect: a persistent "an update is ready" prompt and a 1.6-second tick would
otherwise land on the same pixels.

It **portals to `document.body`**, for the same reason the
[floating panel](#custom-dropdown) does: its callers sit in the note header,
which paints itself with `backdrop-blur`, and a `backdrop-filter` makes an
element the containing block for its `fixed` descendants — left in place, the
toast would dock to the bottom of the *header* rather than the screen.

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

`MarkdownEditor` (`src/ui/MarkdownEditor.tsx`) — the Obsidian-style live-preview
editor, built on **one `contenteditable` surface** (not a stack of per-line
inputs). Every line except the one the caret is on renders as formatted Markdown
(`RenderedLine`); the caret's line renders as raw source (the `data-raw`
`ActiveLine`) so it can be edited verbatim — though it is
[styled while raw](#styled-raw-line), so the markup comes into view without the
formatting going out of it. Because the whole note is a single
editable element, the browser owns caret movement — **arrow keys glide across a
wrapped line's visual rows natively** — whole-document selection (**Ctrl/Cmd+A**),
and **touch selection across lines on mobile**; the older per-line `<textarea>`
model could do none of these (each textarea was its own selection island). It
reads parsed blocks from `classifyLines` (`src/domain/markdown.ts`) and honours
the `EditorSettings` (word-wrap, spell-check, autocorrect, margin width).

**The source string stays the single source of truth.** Preact fully owns the
DOM: every edit the browser proposes arrives as a native `beforeinput`, is
`preventDefault`ed, and is applied to the source through the pure `replaceRange`
engine (`src/domain/line-edit.ts`) — typing, autocorrect, Backspace/Delete
(single-char via a direction fallback, or the exact span `getTargetRanges()`
reports for a word/line delete), Enter, and multi-line paste all funnel through
it. The active line then re-renders with the new text and the caret is re-placed
at the column the edit left it (`contenteditable-caret.ts` helpers). Letting the
browser mutate a contenteditable itself corrupts its structure (it inserts bare
text at the root), which is exactly why every edit is intercepted. **IME
composition is the one exception** — it can't be `preventDefault`ed, so it runs
natively on the active line and is reconciled on `compositionend`.

**An edit that can't be mapped is refused, not passed on.** The
`preventDefault` fires *before* the source points are resolved and regardless of
whether they resolve, in the `beforeinput` handler and in `onPaste` alike. An
unmappable edit that reaches the browser has it rewrite the surface behind
Preact's back, and the next render — reconciling against nodes that are no longer
there — throws and takes the whole app down (the same `removeChild`
`NotFoundError` the composition remount avoids). Refusing such an edit is the
strictly safer failure: the mapping itself is what should cover the case, and
[selection mapping](#selection-mapping) resolves the endpoints the browser
anchors above the lines.

**Refused is not the same as dropped, though.** Refusing *and* silently
discarding an edit reads as a dead keyboard — the user types and nothing at all
happens, with no crash to explain it and no way back. So an unmappable
**insertion** falls back to the last caret the editor tracked (clamped to the
current source), and the character lands there. A **deletion** gets no such
fallback: guessing a span would remove text the browser never pointed at, so it
is refused outright. Either way the drop is reported to the
[in-app logger](#logger) under the `editor` scope, since on a phone this is
otherwise completely silent.

**A composition always remounts the line it touched.** Because the browser wrote
into the line itself, Preact's record of that line's children is stale by the time
`readBackComposition` runs, so it bumps the active-line key rather than letting
Preact reconcile in place — even when the composed text turns out to match what
was already in the source (a cancelled composition still moved DOM around, and it
reports no edit through `onChange`, so a keystroke that changed nothing never
bumps the note's `updatedAt`). Reconciling in place instead would try to tear down
nodes the browser had already replaced — on an empty line, the lone `<br>` — and
the resulting `removeChild` `NotFoundError` unmounts the whole app. This is far
less niche than "IME" suggests: **a dead key composes too**, so on the Nordic
layouts, where `` ` `` and `´` are dead keys, typing a plain backtick went through
this path and blanked the screen.

**Opening a note shows it fully formatted.** The active line is nullable
(`active: { index: number | null; key }`), and an existing note opens with *no*
line active (the app passes `focusOnMount={false}`), so every line — last one
included — renders as Markdown and there is no raw line until the user places the
caret. On mobile this keeps the soft keyboard down until a deliberate tap. A line
goes active when the caret lands on it — observed via a `selectionchange`
listener that maps the caret's DOM position to a source `(line, col)`, makes that
line raw, and restores the caret there — or when the title hands focus down
through the editor's imperative `focus()` handle (`MarkdownEditorHandle`, consumed
by `focusBody` in `App`) on Enter / Arrow-Down / Tab (see
[Editor tab order](#editor-tab-order)). An empty note shows the "Start writing"
prompt.

**The prompt is drawn outside the editing host**, as an absolutely-positioned
overlay in the scroll container, mirroring the host's padding and width so it
lands exactly where the first character will (the host's `aria-label` already
announces it, so the overlay is `aria-hidden`). It used to be a
`contentEditable={false}` span *inside* the host, which put a node the browser
feels entitled to normalise around at the very start of the document — right
where a Backspace on an already-empty note aims — and left Preact having to
remove that node again on the first keystroke. Either way round, a browser that
had moved or eaten it in the meantime turned the next render into a
`removeChild` `NotFoundError` and unmounted the app. Out of the host, the
editing surface holds nothing but its lines.

The [collected attachments block](#attachments) is out of the host for the same
reason. It was the last child of the editing surface — a second
`contentEditable={false}` island, this one sitting exactly where a caret on the
final line forward-deletes into, and one Preact rebuilds whenever the placement
setting or the note's attachments change. It now renders as a sibling after the
host, mirroring its horizontal padding and width and carrying the bottom
safe-area inset; it hides itself entirely (`empty:hidden`) under the default
inline placement, so the tap-below-to-place-the-caret band is unchanged.

**Leaving the body clears the active line.** When focus moves out of the editor
— to the title field, a header button, the side menu — the `onBlur` handler nulls
the active line, so the note snaps back to fully-formatted, matching the just-
opened state. Without it the last line the caret sat on would keep showing its raw
markdown (a trailing `-` staying a literal dash instead of becoming a rule) until
the user tapped back in. The clear is deferred to a microtask and gated on
`document.activeElement` still being outside the root, so the transient blur a
cross-line edit fires (Preact remounts the active line and the caret effect
refocuses the root in the same commit) is ignored — only a real departure clears.

**A touch tap scrolls the tapped line clear of the soft keyboard.** On mobile
the browser's focus-time "reveal" runs before the keyboard shrinks the visual
viewport, so a line tapped in the lower half ends up hidden behind the keyboard
with the caret out of sight. A touch (or pen) `pointerdown` arms a reveal that
the caret-placement effect consumes the next time the caret rolls onto a
different line: it calls `scrollFocusedIntoView`
(`src/ui/hooks/scrollFocusedIntoView.ts`), which waits for the visual viewport
to settle, then centres the line **by scrolling the editor's own scroll
container** — not `Element.scrollIntoView`, which bubbles to the window / visual
viewport on iOS and flings a line tapped near the top of the note above the
sticky header (a first line vanishing off screen, caret and all). It is scoped
to touch (a mouse never loses the caret to a keyboard) and gated on the
active-line key so typing within a line never re-scrolls.

What it centres is the **caret**, not the line's box (`revealRect`,
`src/ui/hooks/scrollFocusedIntoView.ts`, reading the caret's own client rect via
`caretRectWithin` in `src/ui/contenteditable-caret.ts`). One source line
soft-wraps into as many rows as it needs, so a long sentence can be several
screens tall; centring that element lands on the middle of the sentence wherever
the caret actually is — tapping its start, its middle, or its end all scrolled to
the same place, with the caret often off screen. A short line's caret rect is its
text row, so the reveal is unchanged there. Targets with no document selection to
read (the Storage settings passphrase `<input>`) fall back to the element box.

A *ranged* selection is measured at the point it **starts** — which is what
[select mode](#select-mode)'s handover leans on to reveal a long line at its
head. Its
range begins on the line *element* (`(line, 0)`) rather than inside the text, and
a range's client rects lead with the border box of every element it swallows
whole, so the first rect there is the line's own box, as tall as all its rows.
`caretRectWithin` steps into the first character after such a boundary and
measures that single character instead: one character can only occupy one row,
and that row is the one the line begins on. A boundary with no text after it (a
horizontal rule) keeps the old rect-list reading.

**Typing keeps the caret on screen with a one-line buffer.** Because every edit
is intercepted and the caret re-placed programmatically, the browser runs no
native "keep the caret visible" pass — so on desktop, pressing Enter on the
bottom line would push the new line off the foot of the viewport. The same
caret-placement effect that handles the touch reveal falls through, on any
non-touch edit, to `scrollCaretLineIntoView` (`src/ui/MarkdownEditor.tsx`), which
keeps the caret clear of the container's top and bottom edges by a
one-line-height buffer via the pure `bufferedScrollTop`
(`src/ui/hooks/scrollFocusedIntoView.ts`). It scrolls the editor's own container
to an **absolute** target (so a call issued mid-animation retargets rather than
compounds) and is a no-op whenever the caret already sits inside the buffered
band, so ordinary mid-note typing never jumps the view. Its geometry comes from
the same caret rect (`revealRect`) for the same reason: a line that wraps past
the viewport is never "inside the band", so measuring its box would scroll on
every keystroke, and towards the paragraph's middle rather than the caret.

Clicking the empty space below the note lands the caret on a blank line at the
very bottom, **appending one when the document doesn't already end in a newline**
so a note that ends in an image gains a fresh line to type on. That appended
blank line is held locally and is **not** pushed through `onChange`: placing the
caret is not an edit, so it never bumps `updatedAt` or jumps the note to the top
of the list — the line joins the document only once the user types onto it.

The scroll region ends **on the last line**: its content carries a bottom pad of
`max(1rem, env(safe-area-inset-bottom))` so the final line clears the iOS home
indicator (the shell fills the visual viewport down to the physical edge), and
`overscroll-contain` keeps a mobile flick from chaining past it — the note
bottoms out (and bounces) with the last line visible above the safe zone rather
than scrolling away under it. Both editors (the live-preview `MarkdownEditor` and
the Markdown-off `PlainEditor`) share this.

**Select-all and cross-line selection.** Selection is native on the single
surface — a mouse drag or a mobile long-press-and-extend selects straight across
lines, and **Ctrl/Cmd+A** selects the whole note (the handler anchors the range
*inside* the first and last line elements, not at the contenteditable root, so
both endpoints map back to source and a following delete/replace leaves nothing
behind). The shortcut also works **before the body holds focus** — the opening
state of an existing note, which deliberately focuses nothing: a document-level
fallback (`useSelectAllShortcut`, `src/ui/hooks/useSelectAllShortcut.ts`) routes
a bare Ctrl/Cmd+A to the same select-all and moves focus into the surface so
the selection can be typed over or cut, instead of letting the browser take the
whole page (title and header chrome included) as an inert highlight. Focus
inside any other editable field (the title, a modal's input) keeps the
browser's native field-scoped select-all, and a press from inside an open
dialog is ignored so it never steals the dialog's focus; the Markdown-off
`PlainEditor` wires the same fallback to its textarea. A `copy` (and `cut`) is
intercepted (`markdown-selection.ts`) and the
verbatim **source** is placed on the clipboard — Markdown syntax and full,
un-shortened URLs survive the copy rather than the rendered text. See
[Selection mapping](#selection-mapping).

Where a press *lands* the caret within the line it hit is its own rule — see
[Caret placement on press](#caret-placement-on-press).

### Caret placement on press

`onSurfaceClick` (`src/ui/MarkdownEditor.tsx`) + `wordEndAt`
(`src/domain/line-edit.ts`) — how precisely a press is taken, which differs by
what pressed.

**A mouse keeps the browser's exact column.** Clicking rendered text maps
through the leaf's `data-src` offset ([selection mapping](#selection-mapping))
to the character under the pointer, and the press is left there.

**A touch snaps forward to the end of the word it hit.** A fingertip covers
roughly a word, so which of the characters under it the browser picks out is a
coin toss — and on a phone there is no way to nudge the caret one character over
afterwards. `wordEndAt` runs the mapped column out to the end of the run of
non-whitespace it sits in, giving a position a tap can actually aim at and the
one **Backspace** works back from. A press that landed *on* whitespace is left
where it is: that already is the end of the word before it. A "word" is any run
of non-whitespace, punctuation and Markdown markers included, so tapping inside
`**bold**` lands past the closing `**` — the end of the word as it is drawn. The
pointer type comes from the `pointerdown` that opened the press, and only an
explicit `touch` / `pen` snaps: an engine reporting no `pointerType` is treated
as a mouse, so a desktop click is never snapped.

**A press on a line the browser can't put a caret in lands at the end of that
line.** A [horizontal rule](#divider) renders as a lone `<hr>` with no
text to anchor in, so the browser drops the caret at the line's start or onto a
neighbour — leaving nothing to Backspace, and a phone has no forward-delete key,
so the rule could not be removed at all. Pressing one now takes the end of its
source line (`---`, caret at column 3), and three Backspaces erase it. This one
applies to **every** pointer type, mouse included, since the caret the browser
offers is unusable either way. The same fallback covers any press whose caret
the browser resolved onto a different line than the one under the pointer.

It runs on `click` rather than `pointerup`: by then the browser has placed its
own caret (so there is something to read and adjust), and the presses that must
*not* move the caret never produce one — dragging a selection handle, a
long-press selection. A press the content already answered (`preventDefault` —
a [link](#rendered-line) opening, an [attachment](#attachments) opening), a
ranged selection the press ended on (a drag-select, a double-click's word), and
a keyboard-synthesised click (`detail === 0`) are all left alone.

### Caret paint sync

`resyncCaret` (`src/ui/contenteditable-caret.ts`) + `scheduleCaretResync`
(`src/ui/MarkdownEditor.tsx`) — the correction that keeps the caret you *see*
where the editing actually is.

Every edit is intercepted, spliced into the source, and the line re-rendered by
React, so the caret has to be re-placed afterwards — which the editor does from
a layout effect, the instant after React rewrites the line's text and so
*before* the browser has laid that new text out. Most engines re-measure the
caret when the layout lands. WebKit keeps painting it at the rect it took when
the selection was set, and on iOS that is exactly what **holding the eraser**
exposes: each repeat re-places the caret against a layout one edit stale, so
the caret is drawn a row or two above the text disappearing under it while the
erasing itself carries on precisely where the source says it should. The DOM
selection is right the whole time — it is only the painting that lags — which
is why the note comes out correct and only the caret looks wrong.

`scheduleCaretResync` answers it by taking the caret again one animation frame
later, once the browser has performed that layout: `resyncCaret` re-sets the
selection to the identical range (`removeAllRanges` + `addRange`, which is a
real change and so a real re-measure, where setting an equal selection would
be skipped), and the engine takes the caret's rect afresh. Nothing about the
caret's *position* changes — this is a repaint, not a move.

Two guards keep it invisible:

- **Only one frame is ever in flight.** A held key re-places the caret faster
  than frames land, and only the last placement is worth correcting, so each
  placement cancels the frame the one before it queued.
- **It only ever re-takes a collapsed caret still inside the line it was
  placed in.** A user who has since drawn a selection, moved to another line,
  or switched notes owns the selection, and `resyncCaret` stands down rather
  than dragging it back.

The correction is set behind the same `settingSel` guard as every other
selection the editor places, so the `selectionchange` it fires isn't mistaken
for the user moving the caret.

### Goal column

`goalCol` + `dropGoalColumn` (`src/ui/MarkdownEditor.tsx`) — the column a run of
Up / Down presses is aiming for, so walking past a short line and out the other
side comes back to where the run started instead of clinging to column 0.

Every text editor keeps one, browsers included — but the browser's is measured
in pixels and is reset by any caret placed programmatically, and this editor
re-places the caret on **every** line change: the line the caret lands on
re-renders from formatted to raw ([active line](#markdown-editor)), so its DOM
is thrown away and the browser's memory of the column with it. Sitting at the
end of a long sentence and pressing Down therefore used to park the caret on the
next short line and leave it there, column 0 for the rest of the note. The
editor now remembers the column itself.

It is held as a **source column**, not an x-position, because that is the
coordinate this editor moves in — and because a line is drawn formatted until
the caret enters it, so an x remembered over a heading (large text, `# ` hidden)
would mean something else entirely once that heading opens raw.

The column is counted from the head of the caret's **visual row**, not of its
source line, and the row is resolved by `visualRowAt`
(`src/ui/contenteditable-caret.ts`). A soft-wrapped paragraph is many rows tall,
and only the row makes a column mean anything: "column 700" is somewhere in the
middle of a paragraph, while "44 into this row" is the place the eye is on.

**Set** on the first `ArrowUp` / `ArrowDown` / `PageUp` / `PageDown` of a run,
from the caret's current row-relative column, and kept for the whole run —
including across lines too short to reach it, which is the entire point.

**Applied** when the caret crosses onto a different source line. The row it
lands on is the one it came in through: the line's **last** row when walking up,
its **first** when walking down — so stepping up into a thirteen-row paragraph
arrives at its bottom edge, where the press visually came from, rather than at
its first row thirteen rows further up. The caret settles at
`min(row.start + goal, row.end)`, so a row too short to reach the column parks
at its end and the next press picks the goal back up.

Resolving the row has to wait for the destination line to render **raw**: the
formatted line it was a moment earlier wraps differently, so its geometry says
nothing about where the caret belongs. `selChangeRef` therefore activates the
line at the un-wrapped column and leaves a `pendingRow` marker; the
caret-placement effect measures the freshly-raw line and moves the caret onto
the right row. `visualRowAt` binary-searches the row's edges over per-character
rects (they only ever step *down* the line), and answers "the whole line as one
row" when the engine reports no geometry — a headless test, a line not laid out
yet — so the un-wrapped behaviour is the fallback rather than a wrong row.

**Dropped** by anything that says the user has chosen a new column: a key that
isn't one of the four (typing, Backspace, Home / End, Left / Right), any edit
through `commit` or the [styling toolbar](#styling-toolbar), a pointer press
(on `pointerdown`, before the browser places its caret, so the
`selectionchange` that follows reads the cleared goal), a ranged selection,
focus leaving the surface, and a [live pull](#live-pull) swapping the body out.
A bare modifier keypress drops nothing — `Shift` goes down *before* `Shift+Down`
— but an arrow held with Alt / Ctrl / Cmd does, since those are jumps by
paragraph or to the end of the document rather than a step onto the next line.

The [plain-textarea fallback](#markdown-editor) needs none of this: it never
re-places the caret, so the browser's own goal column survives there.

Moving *within* one wrapped line — down from its row 2 to its row 3 — is left
entirely to the browser, which already keeps the caret's x across a row step and
never has its work undone, since no line changes and nothing re-renders.

### Multiple cursors

`src/domain/multi-cursor.ts` (the pure half) + the multi-cursor block in
`src/ui/MarkdownEditor.tsx` (the DOM half) + `src/ui/multi-cursor-rects.ts` and
`src/ui/MultiCursorOverlay.tsx` (the paint) — VS Code's column of carets, in
the [live-preview editor](#markdown-editor).

**The four gestures.**

| Press                                     | Does                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `Ctrl/Cmd+D`                              | Takes the word under the caret; each press after that adds a caret over the next occurrence of it |
| `Ctrl/Cmd+↑` / `↓` (`Alt` may ride along) | Adds a bare caret on the line above / below, growing a column a line at a time |
| `Escape`                                  | Back to one caret — the **primary**, the one the run started from, still holding whatever it had selected |
| A press in the note                       | Ends the column, the same way it does in VS Code                          |

The first `Ctrl/Cmd+D` over a bare caret only *selects*: every collapsed cursor
takes the word it sits in and the run starts there, so one press is "select this
word" and two is "and the next one". A run seeded that way matches **whole words
only** (`Ctrl/Cmd+D` on `id` steps over `width`); a run seeded from a selection
the user drew themselves matches anywhere, which is the same distinction VS Code
draws. Either way the search is case-sensitive and wraps through the top of the
note, and stops once every occurrence is taken — a press too far costs nothing.
`Ctrl/Cmd+↑` / `↓` is deliberately **not** a selection: it is the shortcut for
typing the same thing down the edge of a list. Both unlock the **Many hands**
achievement the moment a second caret appears.

**Everything answers at every caret.** Typing, Backspace / Delete (by character,
by word, by line), Enter, the arrow keys with and without Shift, Home / End,
copy, cut and paste. A cursor holding a selection replaces exactly that whatever
the key was, so Backspace over a column of selections deletes the selections.
Copy puts each selection's source on the clipboard one per line, cut takes those
selections away and leaves a caret where each one was, and a paste holding
exactly one line per caret is **dealt out** a line each — so a column
round-trips through the clipboard; anything else goes in whole at every caret.

**A bare column speaks in whole lines.** With nothing selected there is no
per-cursor text to take, and VS Code's answer — copy and cut with an empty
selection act on the *line* — is the one this follows: `Ctrl/Cmd+C` puts the
whole line each caret sits on on the clipboard (in document order, a shared line
counted once, each **newline-terminated** like a single caret's [line
cut](#cut-button)), and `Ctrl/Cmd+X` takes those lines out and rides each caret
down onto whatever moved up into its place, in the column it was already in.
Whole lines **deal out** on the way back too — a caret takes a line rather than
a fragment of one — so a column of carets down the edge of a list round-trips
through cut and paste. The two readings of a clipboard can never both fit:
dropping the terminator leaves one part fewer, so a clipboard that deals as N
fragments cannot also deal as N lines. The pure half is `bareCursorLines` /
`bareCursorLineText` / `cutBareCursorLines`; a column that **mixes** selections
with bare carets is read as a column of selections, and the bare carets
contribute nothing.

**How one keystroke becomes N edits.** `applyAtCursors` works in flat offsets
into `lines.join("\n")` rather than in `(line, col)` pairs, because an insertion
on line 3 shifts the *line numbers* of every cursor below it as well as the
columns of the ones beside it — in one flat coordinate it shifts exactly one
number, monotonically. Edits are applied left to right in a single pass with a
running read head (so a cursor that would edit text an earlier one already
consumed is clipped rather than corrupting the source), and every caret lands
after the text its own edit inserted. `normalizeCursors` then merges the ones
that have grown into each other, keeping the lowest-indexed of a merged group so
the primary stays primary. One `onChange`, so the whole column is one
[undo](#undo--redo) step.

**Why the lines go raw.** Every line a cursor touches renders as raw source, not
just the active one. A formatted line's text isn't its source — a heading drops
its `# `, a [shortened URL](#shorten-links) its middle — so a caret painted at a
source column over a formatted line would land in the wrong place; and a column
that showed some lines formatted and one raw would read as the note flickering
rather than as one editing surface.

**Why some carets are painted.** A browser gives a page exactly one selection,
so exactly one cursor — the **last** in the list, the one a press just added,
which is also the one the view follows — gets the native caret and the native
highlight. Every other one is drawn by `MultiCursorOverlay`, from boxes
`measureCursors` reads out of the DOM after each render (and again on a
`ResizeObserver` tick, since a width change moves every one of them without
changing a character). The overlay is a **sibling** of the editing host, not a
child of it — the same rule the [empty-note prompt](#markdown-editor) and the
[attachments block](#attachments-at-the-end) follow, because a
`contenteditable={false}` island among the lines is a node the browser feels
entitled to normalise around. It is painted *before* the host so a highlight
sits behind its text exactly as `::selection` does, with the carets lifting
themselves back above on a `z-index`; the tint is literally the `::selection`
tint and the blink is the platform's 1s cadence, so a painted cursor and the
browser's own are indistinguishable. Reduced motion stops the blink rather than
hiding the caret.

**Why the blink is on the layer.** The carets share one animation, on the box
that holds them (`.multi-caret-layer`), rather than each running its own. A CSS
animation starts when its element is inserted, so a caret added as the column
grows would blink against whatever was already on screen and the column would
shimmer instead of pulsing as one — a column of carets that don't agree reads as
two different kinds of cursor, which is the one thing the paint exists to avoid.
`MultiCursorOverlay` also **restarts** that animation after every paint (through
the animation object, so there is no reflow), which puts a caret that just moved
— or just appeared — solid on the spot and blinking from there, the way a text
caret behaves everywhere else. The browser resets its own caret on the same
selection change, so the native one stays in step with the painted ones.

**Where a column ends.** A pointer press, focus leaving the surface, a locked
note, `Ctrl/Cmd+A`, the [cut](#cut-button) and [styling
toolbar](#styling-toolbar) verbs (which speak in one span), `Tab`, `PageUp` /
`PageDown`, an IME composition starting (it runs natively on one line and cannot
be split), an input type a column can't express, and a [live pull](#live-pull)
or [undo](#undo--redo) rewriting the body under it. A `selectionchange` that
lands the caret on a line no cursor is on ends it too — the backstop for the
routes that can't be enumerated.

There is no touch gesture and no button: this is a hardware-keyboard feature,
and it simply never comes up on a phone.

### Selection mapping

`src/ui/markdown-selection.ts` — translates a live-preview DOM selection back
onto the raw note. `sourcePointFromDom` resolves one selection endpoint (a DOM
node + offset) to a source `(line, column)`: on the active **raw** line
(`data-raw`) the DOM offset *is* the source column (measured with the
`contenteditable-caret.ts` helpers); on a formatted line it uses the
`data-line-index` the editor stamps on every line and the `data-src` offset each
inline leaf carries. A leaf whose rendered text is shorter than its source (a
[shortened bare URL](#shorten-links)) also carries `data-len` so the *end* of the
leaf maps to the end of the full source token, and an endpoint anchored at the
line container itself (Ctrl/Cmd+A's range boundaries) maps to the true line edge,
markers included.

An endpoint anchored *above* the lines — on the editing surface itself, or on a
wrapper between it and them — is resolved by `containerPoint` to the nearest
line edge rather than given up on: the DOM boundary `(el, offset)` sits before
`el.childNodes[offset]`, so it maps to the start of the first line at or after
that child, and to the end of the last line when the offset runs past the
children. The editor's own Ctrl/Cmd+A anchors *inside* the first and last lines
precisely so this isn't needed, but a selection the **browser** draws has no
such manners: iOS Safari's native "Select All" (the text-selection callout —
how a note gets erased on a phone) runs its range from `(surface, 0)` to
`(surface, childCount)`. While those endpoints resolved to `null` the editor
couldn't express the delete as a source splice, so it declined to intercept it,
and WebKit applied the delete itself — tearing out the line elements Preact
believes it owns and blanking the app on the next render (see [crash
screen](#crash-screen)).

`extractSourceRange` then returns the **verbatim** source the
selection covers — raw Markdown, list/heading/quote markers and all, so a copy
round-trips as the source it was typed as; only the columns at the very start and
end of the selection are trimmed, interior lines are taken in full. Both are
pure/DOM-only helpers the editor uses in its `copy` / `cut` handlers.

`snapStartToLineEdge` widens a ranged selection's **start** over the leading
block marker of the line it begins on. On a formatted line a `# `, `- `, `> ` or
`1. ` is drawn as a non-selectable glyph (or not drawn at all), so the browser
can't anchor before it — the earliest an endpoint can land is the line's content
start, and a range reaching there has visually taken the whole line. Snapping it
back to column 0 is what makes [cutting](#cut-button) a bulleted line take its
`- ` too, and what stops a select-and-type over a heading leaving a stray `# `.
Only the start endpoint needs it (markers are leading), and only for a range — a
collapsed caret lands after the marker, where editing happens.

**The active raw line is exempt**, and that exemption is the whole point of the
`rawLine` argument the editor passes (`activeRef.current.index`) from
`selectionPoints`, `editPoints`, and `selectionSource`. The active line renders
as verbatim source, so its marker is ordinary text the browser *can* address: a
range starting at the content start there means the content, not the line. It
matters because a **phone's autocorrect** is a ranged edit — accepting a
correction arrives as a `beforeinput` (`insertReplacementText`, or a ranged
`deleteWordBackward`) whose `getTargetRanges()` scopes exactly the word being
rewritten. When that word is the first one in a list item, its range starts at
the content start, and snapping swallowed the marker along with it: typing
`4. Somethign` and letting the keyboard fix the typo replaced the whole line
with `Something`, silently un-listing the row. A desktop spellcheck replacement
takes the same path.

**A selection doesn't outlive the focus that drew it — on a touch device.**
`dropSelectionOnBlur` (`src/ui/MarkdownEditor.tsx`), run from the surface's blur
handler once focus has genuinely landed outside it, removes any range still
standing inside the editor. On a phone the highlight and the range come apart:
dismissing the soft keyboard blurs the surface and takes the *painted* selection
with it, but the DOM range survives — and the next tap on those lines hands the
browser an existing selection to act on, so Android repaints the row and raises
its Cut / Copy / Paste bar instead of placing the caret, and only the tap after
that gets a caret back into a line that looked idle. It shows up most plainly
after a [line-number](#line-numbers) press, which draws a whole-line span with no
active line to blur out from under it, but it is the same for a hand-dragged
selection. The toolbar's `spanLine` stand-in is cleared alongside the range it
spoke for. Desktop pointers (`useDesktopPointer`) are left alone: the browser
keeps painting a selection, greyed, once focus moves on, so nothing goes
invisible there — and with no soft keyboard there is no way into the state in the
first place.

### Rendered line

`RenderedLine` (`src/ui/MarkdownLine.tsx`) — renders one parsed `LineBlock` as
formatted markup (headings, quotes, lists, inline code/links/bold/em/strike).
Every leaf carries a `data-src` offset so a click maps back to a caret position
in the raw source (and a [selection](#selection-mapping) back to a source
column); a shortened bare URL also carries `data-len` (its full source length).
`markdownLineClass` (`src/ui/markdown-line-class.ts`) maps a block kind to its
CSS classes. List items indent by their `depth` and pick a marker from it: an
unordered item cycles through the three [bullet characters](#bullet-characters)
(`•` → `-` → `+`), an ordered item shows its computed sequential `marker`, and a
[task item](#task-items) draws a pressable checkbox in place of the bullet.

A rendered **link** (and an inline image) is the exception to click-to-caret:
inside the contenteditable surface a plain click would drop the caret (turning
the link's line into raw source) and the browser won't navigate an editable
anchor, so the anchor suppresses the caret on `mousedown` and opens the link on a
plain, unmodified click instead (a modified click or a drag-select ending on it
is left to the browser). To edit a link's text or URL, click just past it and
backspace into it — the raw `[text](url)` source then shows in the active line
like any other text. Links are rendered `draggable={false}` so dragging across
one starts a text selection instead of a native link drag.

### Styled raw line

`RawLine` (`src/ui/MarkdownLine.tsx`) — the other half of the live preview: the
**active** line, shown as verbatim source so it can be edited, but wearing its
Markdown while it is. Stepping the caret onto `a **bold** word` no longer drops
the whole line back to flat grey text — the word stays bold and the `**` simply
come into view beside it, dimmed, ready to be typed over or deleted. The block
marker gets the same treatment: `## `, `- `, `> ` and `1. ` are dimmed while the
heading keeps its size and weight, so the line reads as what it will become
rather than as what it is made of. A fenced block's interior is the exception —
inside a fence nothing is Markdown, so those lines stay untouched.

The split of work follows the usual seam. `rawLineSegments`
(`src/domain/markdown.ts`) is the pure half: it walks the line's inline nodes,
paints a mark (`strong`, `em`, `strikethrough`, `code`, `link`, `markup`) over
each one's **source** span — delimiters included, which is what the `InlineSpan`
on every marked-up node is for — and returns the line tiled into runs of equal
marks. `rawMarkClass` (`src/ui/markdown-line-class.ts`) turns one run's marks
into classes, and `RawLine` emits a `<span>` per marked run (an unmarked run
stays a bare text node).

Two rules keep this from breaking the editor underneath it:

- **The rendered text is the source, exactly.** Nothing is added, elided, or
  reordered; the segments tile `[0, raw.length)` with no gaps. The editor reads
  a DOM offset into this element as a source column *directly* (see
  [selection mapping](#selection-mapping) and `contenteditable-caret.ts`), so
  one invented character would misplace every edit after it on the line.
- **No mark may move text.** Only weight, slant, decoration, colour and a
  background are honoured — never a size or padding change. The run sits in the
  line the caret is walking through, and a wider glyph mid-line would shift
  every column after it as the caret crosses in and out of the run. (A heading's
  size change is fine because it applies to the whole line via `lineTextClass`,
  which the rendered line uses too — which is exactly why landing on a heading
  causes no reflow.)

Markup dims by `opacity` rather than by taking a colour of its own, so a `**`
inside bold text keeps that text's colour and only steps back — visible enough
to aim a caret at, which is the whole point of showing it. Where two marks would
both set a colour (a link inside bold), `rawMarkClass` picks the winner
explicitly: two `text-*` utilities on one element are resolved by stylesheet
order, not by the order they are listed.

### Markdown parser

`src/domain/markdown.ts` — a dependency-free, pragmatic Markdown subset.
`classifyLines` splits the body into `LineBlock[]` (one per line, tracking
fenced-code state); `parseInline` tokenizes a line into `InlineNode`s (strong,
em, code, link, image, strikethrough), each leaf carrying a source-column
`offset` for click-to-caret mapping. (A seventh variant, `transform`, is
declared here but never emitted by the parser: [Transforms](#transforms)
splices it into an already-parsed tree.) Both an explicit `[text](url)` link and a
**bare URL** (`http://…`, `https://…`, or `www.…`, via `matchAutolink`) become
a `link` node, so a pasted or typed URL renders and clicks through without the
`[…](…)` ceremony (`www.` gets an `https://` href; trailing sentence
punctuation and an unbalanced `)` stay outside the link). An autolinked node
carries a `bare: true` flag so the renderer knows it may [shorten it for
display](#shorten-links) — an explicit link's label is never touched. The `image` node (`![alt](href)`) is what
the [attachment renderer](#attachments) turns into an inline thumbnail.

The four marked-up constructs — `strong`, `em`, `strikethrough`, `code` — also
carry an `InlineSpan`: the source columns of the *whole* run, delimiters
included. That is what lets a caret column be asked which runs it sits inside,
which the [styling toolbar](#styling-toolbar) lights its buttons from and its
presses unwrap by, and which `rawLineSegments` paints the [active
line](#styled-raw-line)'s styling over. A `***x***` is one run wearing two
marks, so its `strong` and its `em` share one span and each is taken off by its
own delimiter's width — which is why `rawLineSegments` measures a delimiter run
off the source rather than trusting either mark's width alone.

A ` ``` ` line toggles the fenced state, so the lines between a pair of them
classify as `code` and are never reparsed as Markdown; `fencedRanges` /
`hiddenFenceLines` / `hasClosedFence` are the helpers built on top of that
state — see [Code block](#code-block).

After the per-line pass, `numberLists` walks the blocks once more to fill in the
two list fields the classifier can't decide line-by-line: a `depth` from each
`ul`/`ol` item's indentation (a stack of `{ indent, count }` frames opens a
child list on a deeper indent, closes back on a shallower one, and treats an
equal indent as the next sibling), and a sequential `marker` for every `ol` item
so `1.`/`1.` displays as `1.` then `2.` — always counting from 1, so a list
typed `3.`/`4.` is rewritten to display `1.`/`2.`, and rotating the style by
depth (decimal → lower-alpha → lower-roman, `1.` → `a.` → `i.`). Blank lines are skipped so a gap between items
keeps a list going; any other non-list line ends it. A line that is just a
single `-` (as well as `---`/`***`/`___`) classifies as an `hr`, a quick divider
without counting out three dashes. An unordered item whose text opens with a
`[ ]` / `[x]` box is a [task item](#task-items) and carries a `task` flag; the
box is folded into the block marker, so `contentStart` — and every inline
offset past it — behaves exactly as on a bare bullet (and on the [styled raw
line](#styled-raw-line) the whole `- [x] ` dims as the markup it is).

It is pure (no DOM/IO) and fast enough to run on every
keystroke, which is why it lives in `domain/`.

### Title field

`TitleField` (`src/ui/NoteEditor.tsx`) — the note's title field above the editor. It
is an auto-growing textarea, so a long title wraps onto further lines and the
field grows to fit instead of scrolling out of view. A single-line title is
vertically centred against the back button and the copy/sync buttons; once it
wraps the header top-aligns so those stay pinned to the first line (the field
reports the one-line↔multi-line transition up via `onMultilineChange`). Opening
an existing note focuses nothing, so the soft keyboard stays down until the user
taps where to type — only a brand-new note opens with the title focused, ready
to be named. Enter,
Arrow-Down and Tab hand focus down to the body (see
[Editor tab order](#editor-tab-order)), so the field never holds a literal
newline. Edits route through `useNotes().retitle` → `retitleNote`
(`src/domain/note.ts`). On file/cloud backends the [save hold](#save-hold) keeps
the file from being created under the throwaway default title until the real
title settles.

### Editor tab order

`Editor` (`src/ui/NoteEditor.tsx`) spells out the editor's keyboard tab order by
hand: **back button → title → body → find / formatting / cut / copy**. That is the
order the work happens in — name the note, write it, and only then reach for the
toolbar — but document order can't express it, because the header (and every
button in it) precedes the body. So the two editing surfaces (the live-preview
[editor](#markdown-editor)'s contenteditable root and the plain-textarea
fallback) sit out of the browser's sequential order with `tabIndex={-1}`, and
focus is moved explicitly instead:

- Tab in the title focuses the body (the same `focusBody` hand-down as Enter /
  Arrow-Down; the [live-preview editor](#markdown-editor) opens a line at the end
  through its imperative handle).
- Tab in the body focuses the first header action — the
  [find button](#find-in-note).
  Both surfaces report the keystroke up through an `onTabOut(backwards)` prop
  rather than acting themselves, and only when the caret is on the surface: an
  attachment thumbnail inside the note is its own tab stop and its Tab bubbles
  through the same handler.
- Shift+Tab reverses both hops (body → title, first header action → body).

Keeping the surfaces out of the natural order is what makes the sequence a
straight line: nothing tabs back *into* the body from the toolbar, so tabbing on
past the last header action leaves the editor instead of cycling around the
header.

### Editor settings

`EditorSettings` (`src/theme/themes.ts`) — margin (writing-column max width via
`editorMarginMaxWidth`), `wordWrap`, `renderMarkdown`, `lineNumbers` (see
[Line numbers](#line-numbers)), `disableSpellcheck`,
`disableAutocorrect`, `capitaliseSentences` (see
[Sentence capitals](#sentence-capitals)),
`shortenLinkChars` (see [Shorten links](#shorten-links)),
the `defaultTitle` scheme, and the `copyScope` (see
[Copy row](#copy-scope)). They live in the
[appearance store](#appearance-store) (so they sync with the folder/cloud) and
are edited in the Editor tab of the settings modal, `EditorSection`
(`src/ui/settings/EditorSection.tsx`), which groups them into focused bordered
sections (mirroring the General tab) — **New notes** (the default-title scheme),
**Writing column** (margins, word wrap), **Markdown** (live render, line
numbers, link shortening), **Typing aids** (sentence capitals, spell-check /
auto-correct),
**Formatting on save** (see [Format on save](#format-on-save)), and **Copying**
(the copy scope) — see [Storage settings](#storage-settings) and its sibling
sections.

### Line numbers

Off by default. With the `lineNumbers` editor setting on, the
[live-preview editor](#markdown-editor) numbers every line in a gutter hanging
in its left padding, the way a code editor does — the line the caret sits on lit
brighter than the rest — and the gutter beside each line is a press target that
**opens [select mode](#select-mode) with that line taken**.

`LineRow` (`src/ui/MarkdownEditor.tsx`) is the whole feature. With the setting
off it renders its child — the line element — verbatim, so the default editor
produces exactly the DOM it always has; with it on it wraps the line in a
positioning context and hangs a `<button>` beside it. That button is
deliberately a **sibling** of the `[data-line-index]` element rather than a
child: everything that measures the editor's text works within that element
(`offsetWithin` on the active raw line, `domPointAt`'s tree walk in
`placeCaret`, the composition read-back's `textContent` — see
[Markdown editor](#markdown-editor)), so a digit inside it would shift every
source column by its width and corrupt each edit. It is `contentEditable={false}`
and `tabIndex={-1}`, keeping it out of both the editable text and the tab order
(the editor hands focus on via `onTabOut`, and one tab stop per line would trap
a long note).

**The gutter is only as wide as the note needs.** The surface reserves its left
padding from the digit count of the note's *highest* line number — a nine-line
note spends one digit's width on it, and the tenth line is what widens it to two
— so a short note keeps the room a fixed gutter would have spent on numbers it
will never show. The reservation is a `calc()` in `ch` at the surface's own
font, times the `0.75em` the numbers are drawn at, so it tracks the digits
across every font family and font-scale setting; `GUTTER_GAP` is the one
constant the surface and the number both read for the space between them. The
number itself shrink-wraps its digits and hangs off `right-full`, which
right-aligns the column against the text with no width to compute.

**The digit sits beside its line's first wrapped row**, not the middle of the
line. A line that wraps is a box whose centre can be anywhere, and on a phone a
paragraph is routinely taller than the screen — so a centred number drifts away
from where its line starts and, on a long enough line, off the screen entirely,
leaving the line you are reading as the one line whose number you can't see.
Aligning to the first row is also what makes the column read as a list: every
number sits where its line begins. It isn't flush with the row's top edge
either — the digit rides in a box exactly one *text* row tall (`h-[1lh]` at the
surface's own font, the same box the [task checkbox](#task-items) uses) and
centres in that, so at its `0.75em` it lines up with the text of the row rather
than floating above it.

**The press target is the whole gutter column**, not the digits: the button
spans the row's full height — so a line wrapped to ten rows has ten rows of
target — and stretches from the line's first character out to the surface's
left inset, carrying `GUTTER_GAP` as its right padding and the outer `1rem`
inset as its left. Two or three characters of digit at three-quarter size is
far below the size of a fingertip; the gesture is "press to the left of the
line", so the target has to be the band the finger actually lands in.

**The gutter is a selection surface and nothing else.** A press in it enters
[select mode](#select-mode) with the pressed line taken, and the same finger
carries straight on down the numbers to take a run — the mode's sweep picks up
from the line the press landed on, so there is nothing to enter the mode and
then aim again for. It follows that the gutter **takes no scroll at all**:
`touch-none` on the button is what makes a stroke starting there unambiguously a
selection, with no tap-versus-scroll to resolve. That is the one band of the
note a finger can't travel with, and it is the price of the gesture being this
direct; everywhere to the right of it the note scrolls exactly as it always did.

**It answers clicks and vertical strokes, and leaves sideways ones alone.** The
gutter is [rail](#select-mode), and on a phone it sits inside the screen-edge
strip the [side menu](#side-menu) opens from, so a touch says nothing yet: a
right swipe that means "open the drawer" starts on the very same pixels as a
press that means "take this line". The gutter therefore takes nothing — and does
not turn the mode on — until the stroke has travelled `SWEEP_SLOP` and shown
which way it is going. Sideways is the menu's and the gutter never fires; up,
down, or a lift with no travel at all is the gutter's and enters the mode as it
always did, an instant later than the press. Only a touch waits; a mouse enters
on the way down.

The button itself carries no handler beyond cancelling its `mousedown` (the
event an editing host takes focus from — the gutter lands no caret and raises no
keyboard). It marks itself `data-line-gutter`, and the surface's own pointer
handling does the rest: `onGutterDown` resolves the row with `lineRowAt` and
starts a sweep; `enterFromGutter` — reached on the way down from a mouse, and
from the stroke that declares itself vertical (or the lift that never travels)
on a touch — paints the line, remembers its head as `lastCaret`, and asks the
host for the mode with `onSelectModeChange(true)`. The run the sweep has already
painted is what the mode's entry effect seeds from (`gutterEntry`) rather than
the caret — seeding would take a line the finger never touched.

**The press never raises the keyboard**, which on a phone is the whole reason
the gesture is worth having: an existing note opens with no active line and the
soft keyboard down, and a gesture that landed a caret would answer "pick these
lines" by covering them. Three things would otherwise put one there, and select
mode refuses each where it happens — the surface's `mousedown` (the event an
editing host takes focus from, cancelled by the gutter button as well as by the
mode), the mode's own entry (which takes focus only on a
[desktop pointer](#select-mode)), and the edit a header verb commits
(`quietCommit`). The head of the pressed line is remembered as `lastCaret` all
the same, so it is where writing picks up if the user leaves the mode and taps
the note.

**And the press must not move the view.** You can only press a number you can
see, so there is no reveal owed — but the render that answers the press can
still slide the note out from under the finger. Entering the mode takes the
active raw line back to formatted, and its raw markdown (a `#`, a `- `, a `**`
pair) can wrap to one row more or fewer than the formatted line does, reflowing
everything below it. That reads as the note jumping somewhere else under the
finger, rather than as the line being taken where it already was. So
`enterFromGutter` measures the pressed line's first row (`lineTop`) before it
asks for the mode, and `holdLineAnchor` pins it back to that y (`anchoredScrollTop` is the clamped
arithmetic, alongside its siblings in `scrollFocusedIntoView.ts`). The pin is
held across a few frames rather than applied once: the mode is the host's flag,
so the re-render that drops the raw line is a render behind the gesture, and
correcting a frame late is the difference between a flicker and a scroll the
user has to undo by hand.

Numbers are the *source* line numbers, so a line hidden from the preview — an
[at-end attachment](#attachments-at-the-end) reference, or a
[fence](#code-block) the caret is outside of — takes its number with it, leaving
a gap the way a folded region does. The Markdown-off
[plain textarea](#markdown-editor) has no per-line elements to hang a gutter on
and ignores the setting, which the toggle's hint says outright.

### Select mode

Taking a run of lines with the ordinary selection means dragging two handles
onto two exact characters. With a mouse that is fiddly; with a fingertip it is
close to impossible, which is what makes "select these eight lines and delete
them" one of the hardest things to do in the editor on a phone. **Select mode**
drops the columns entirely: the note stops being a surface you put a caret in
and becomes a list you pick lines from.

**The way in is the gutter, and the toggle only where there isn't one.** With
[line numbers](#line-numbers) on, a press in the gutter *is* the way in: the
mode opens with that line taken, and a drag down the numbers takes a run in the
same stroke — the gesture and the mode arrive together, rather than the mode
being armed first and the lines aimed for second. A button that only armed the
mode and then waited for the same press would be a button the row is better off
without, so with the numbers on it isn't offered (`offerSelectMode`,
`src/ui/NoteEditor.tsx`). With them off there is no gutter, and the toggle is
the only door there is.

That says nothing about the way **out**: while the mode is on the toggle is
rendered whatever the setting says, because on a phone it is the only exit that
doesn't need a keyboard.

The toggle is the header button immediately **left of Find**
(`SelectModeButton`, `src/ui/SelectModeButton.tsx`), lit while the mode is on
the way the [formatting](#styling-toolbar) and find toggles are — the state is
the thing it reports, and once a selection has been handed over the lit button is
the only thing on screen still saying the mode is up. It is offered only on the
[live-preview editor](#markdown-editor): the Markdown-off plain textarea has the
browser's own selection and no per-line elements to paint. The flag itself lives
in `Editor` (`src/ui/NoteEditor.tsx`) and is dropped on a note switch and on
turning Markdown off — the mode is a detour from writing, so every note opens
ready to be written in. On a narrow header the lit toggle **pins itself out of
the ⋯** while the mode is on, exactly the way the star and the eye do — see
[pinned header state](#pinned-header-state) — because it is the mode's only
deliberate exit on a phone: the note takes no caret while it is up, Escape is a
keyboard a touch user doesn't have, and giving every line back one at a time is
not a way out anybody would go looking for.

**What is taken is a set, not a range.** A press takes the line it lands on; a
second press on the same line gives that line back; pressing a *different* line
takes that one **as well**. This is the rule the whole mode is built around, and
it is not the obvious one: a model that can only hold one unbroken run makes the
second press throw the first away, which is precisely what someone picking three
entries out of a list, or two headings and nothing between them, did not ask for.
So the state is a list of line indices (`LineSelection.lines`), and the few
operations that genuinely need a *range* — the exit handover, a block format —
work group by contiguous group (`lineSelectionGroups`) rather than assuming
there is only one.

**The rail is how a finger drags.** Dragging over lines takes every line the
stroke crosses, and dragging back up gives them back again — but a finger on a
phone is also the only way to scroll, and those two gestures want the same
pixels. The split is **spatial**: the sweep owns a rail down the left edge of
the scroller (`SWEEP_RAIL_PX`, drawn per line by `LineRow` as `.sweep-rail` /
`.sweep-rail-on`), and everywhere to the right of it the note scrolls exactly as
it always did. The [line-number gutter](#line-numbers) is rail wherever it
reaches, however wide the note's digit count has made it — a press on the far
side of its own numbers must not fall through to a scroller the gutter has
already refused. The timed split this replaced — hold still and the press becomes
a drag — asked the user to out-race a timer on every scroll, which is the wrong
trade for a mode you *stay* in: picking eight lines out of forty means scrolling
between the picks. A **mouse** has no such conflict, since it scrolls with a
wheel, so a mouse drags from anywhere. Off the rail, a touch is still a press
that toggles its line — it just has to lift without travelling first, because
until the finger comes up there is no telling a tap from the start of a scroll.

**The rail answers presses and vertical strokes, never sideways ones.** It runs
down the left edge of the note, which on a phone is also the left edge of the
*screen* — the strip the [side menu](#side-menu) opens from when its floating
button is hidden (`useEdgeSwipeOpen`, and the `EDGE_ZONE` the row swipes stand
down in). Both gestures therefore begin on the same pixels, and only their
direction tells them apart. So a **touch** that lands on the rail takes nothing
until it has travelled `SWEEP_SLOP` and declared an axis: sideways is the
drawer's, and the rail never fires — not on the way across, and not on the lift,
which is no longer a tap. Up, down, or nowhere at all is the rail's, and lands
exactly as a press always did, picking up from the line the finger pressed as
though it had been painting from the first pixel. The test is the complement of
the drawer's own (it stands down the moment `|dy| > |dx|`), so precisely one of
the two answers any given stroke. A mouse skips the wait: there is no edge swipe
on a pointer, and a drag from the rail is unambiguous.

Whether a stroke *takes* or *gives back* is decided once, by the line it starts
on (`PaintMode`): start on an untaken line and the finger paints, start on a
taken one and the same finger erases. That is the same rule as the second press
on a line — a press is simply a stroke that never moved — so one gesture covers
both directions. Every move replays the stroke against the selection as it stood
when the press landed (`paintLineRun` over the remembered `base`), which is what
makes dragging back up shrink the run instead of leaving a high-water mark, and
what keeps lines taken by *earlier* strokes untouched either way. Held against
the top or bottom of the viewport, the note scrolls under the sweep
(`startSweepScroll`) at a speed that rises with how far into the edge band the
pointer is, so a run can be longer than the screen. While a sweep is actually
dragging, a non-passive `touchmove` listener refuses the scroll — `touch-action`
can't be changed mid-gesture — and it is bound only while the mode is on, so
ordinary scrolling keeps its fast path everywhere else.

**The rail needs room, so the mode reserves it.** With
[line numbers](#line-numbers) on, the gutter they already reserve *is* the rail
and nothing moves. With them off, entering the mode widens the surface's left
inset by `SWEEP_RAIL_GAP`; the text shifts across by that much, which is the
affordance arriving rather than a glitch. Both the numbers and the rail hang
*outside* the line's own box, so the reservation is published as a `--gutter`
custom property on the surface for them to measure against.

**The actions are in the header, all four of them.** Entering the mode unfolds
the [selection actions](#selection-actions) — formatting, cut and copy — and
select mode adds the one verb they were missing: a **delete**
(`DeleteLinesButton`, `src/ui/DeleteLinesButton.tsx`), immediately right of
copy. Delete is the verb the mode had no button for at all: it was Backspace, on
a keyboard select mode deliberately keeps down. It wears the danger tone rather
than the accent every other header button carries — it is the only one that
destroys something, and it sits next to a copy button it must not be mistaken
for at thumb speed. No confirm step, because it is one Undo away. Its trophy is
**Off the top**.

Being in the header rather than in a bar over the note is the point: one row,
four verbs, in the same place every other action on the note already lives, and
nothing hovering over the lines being picked. They are out for the **whole
mode**, not only once a line is taken (`picking`, `src/ui/NoteEditor.tsx`): the
row a press lands in must not shuffle under the finger between one pick and the
next, and with nothing taken each verb is simply a no-op — the run *is* what
they act on, so a cut with no line picked doesn't fall back to cutting the line
an invisible caret was last left on. All four ride the row on **any** pointer:
cut and delete are touch-only affordances everywhere else (`useDesktopPointer`),
but here they are the mode's own verbs in a row that has just dropped four
buttons to make space. They still fold to nothing on a locked note the way every
other write-only action does (`WriteAction`), which leaves copy as the one thing
a locked note's run can be used for.

**And the header carries nothing else.** While the mode is on it stops being the
note's action row and becomes the mode's: the star, the read-only eye, the
export menu, find — and the ⋯ itself, which now has nothing left to unfold —
are all gone. They are answers to questions nobody in the middle of picking
lines is asking, and every one of them is a press that would throw the run away.
What is left beside the four verbs is the [pinned](#pinned-header-state) lit
toggle, which is the way back out. The whole row returns the moment the mode
goes off.

**The paint is the editor's, not the browser's.** A taken line is tinted with
`.line-selected` (`src/styles/theme.css`) across *both* of the boxes it is drawn
in: the number in the gutter and the text beside it. They are siblings rather
than one inside the other — the number hangs out in the surface's left padding
(see [line numbers](#line-numbers)) — so a background on the row alone would
stop dead at the first character; together they tile edge to edge into one band
across the page. Deliberately **not** `::selection`: while the mode is on there
is no browser range to style, and the whole point is that "taken by select mode"
and "selected the ordinary way" look different, because leaving the mode turns
one into the other and the change of colour is how you see it happen. What the
surface does keep is a **collapsed** caret at the head of the selection, hidden
by `.line-select-mode`'s transparent `caret-color`, because that is what keeps it
receiving `beforeinput` — without one, typing over the selection would silently
do nothing on a phone. The same class blanks `::selection` inside the surface, so
nothing left over from before the mode was entered can show through.

**The mode never asks for the keyboard.** A press picks a line, so it must not
also land a caret — and a caret in the note is what raises the soft keyboard
over the very lines being picked. Three separate things would otherwise do it,
and each is refused where it happens. The press is answered at `pointerdown`,
but a pointer event born of a touch cannot cancel the tap's default action, so
the *compatibility* `mousedown` the tap also produces is cancelled instead
(the scroller's `onMouseDown` in `MarkdownEditor`) — that is the event the
browser focuses an editing host from, and cancelling it is what keeps the caret,
and the keyboard, away. The header's own verbs already cancel their `mousedown`
for the mirror-image reason (the run has to survive the press). And the edit
those verbs commit — a cut, a delete — would install the caret it leaves behind,
which means taking focus: `quietCommit` (`src/ui/MarkdownEditor.tsx`) marks that
one commit as answered with the keyboard down, so with the surface unfocused the
note is simply rewritten, every line stays formatted, and `lastCaret` remembers
where writing would resume for whenever the note is next tapped. Focus the mode
*inherited* — the keyboard was already up, or a desktop took it on the way in —
is left exactly where it is, so typing over a run still works.

**Giving the last line back is the third way out.** The mode is a list you are
picking from, and an empty list is not one: with nothing taken every verb in the
header is a no-op and the note still refuses a caret, so emptying the run and
staying in the mode is a state with nothing to do in it. Undoing your last pick
therefore undoes the mode as well, which is what makes a mis-press cost one
press to fix rather than two — and it is why the toggle can be a pure exit
rather than a switch: the run and the mode begin and end together.

Only an **erasing** stroke can do it, and only on the lift (`onSweepUp`). A
stroke that started on an untaken line has taken nothing away, so a touch that
merely scrolled a note with nothing taken is not an exit; and an erasing stroke
can pass through empty on its way to giving back fewer lines than it began over,
so mid-drag is too early to ask.

**Leaving the mode by Escape is the handover.** It turns the taken lines into an
ordinary browser selection over the same lines, drawn in the ordinary selection
colour, and the mode goes off. The **header toggle** is the other exit and is
deliberately *not* a handover: it is the way out on a phone, where a browser
selection left behind would raise the platform's own Cut / Copy callout over the
note instead of giving the caret back (the same thing
[`dropSelectionOnBlur`](#selection-mapping) exists to prevent). It drops the run
and leaves nothing selected — as does a note switch, which resets the host's
flag the same way. The range is *queued* in
`pendingLineSpan` rather than drawn on the spot: leaving the mode unwraps every
line's row, so nodes a range pointed at now would be thrown away before the
browser painted it, and the layout effect that already owns `pendingLineSpan`
(the same one a multi-line [block format](#styling-toolbar) uses) draws it once
the DOM is final. Only an **unbroken** run is handed over (`isContiguous`) — the browser
draws one range, so a scattered set would come back with the lines *between* the
taken ones silently selected too, and a handover that quietly takes more than was
picked is worse than no handover at all.

**What the selection can then be used for**, all of it handed to the same pure
engine every other edit uses:

| Gesture                        | What happens                                        |
| ------------------------------ | --------------------------------------------------- |
| The header's ✂ / 🗑 (touch)      | Cuts, or deletes, every taken line                |
| Typing, or a paste             | Replaces every taken line, landing where the first was; the mode goes off |
| Backspace / Delete             | Takes the lines out entirely — no blanks left behind |
| Ctrl/Cmd+C                     | The verbatim source of the lines, newlines and all — gaps closed, not copied |
| Ctrl/Cmd+X, Ctrl/Cmd+K, ✂      | The same, and the lines go                           |
| A [styling toolbar](#styling-toolbar) press | Styles every line at once and **keeps** the selection |
| ↑ / ↓, Shift+↑ / ↓             | Steps the selection, or walks the last stroke's head alone |
| Ctrl/Cmd+A                     | The whole note                                       |

A format keeps the selection because bulleting five lines and then indenting the
same five is one gesture with a second press; an edit drops it because the lines
it named are gone and you are writing again. A format runs one contiguous group
at a time, **from the bottom of the note upwards**, so a format that adds lines
(a fence, a rule) can't shift a group out from under the next pass. The selection
is reported out through `onSelectionChange` like any other selection, so the
header offers copy and cut on it — which is how a phone, with no keyboard
shortcuts, gets at either. **Every** way out of the mode takes that report back
down again, including the two the editor is never asked about (the header toggle
and a note switch): the mode leaves the caret collapsed and hidden, so no
`selectionchange` is coming to correct a stale one, and the header would keep
cut / copy / formatting pinned out over a note with nothing in hand. The one
exception is Escape's handover, which reports the selection it just set. See
[selection actions](#selection-actions).

The pure half is `src/domain/line-selection.ts`: a `LineSelection` is the list of
taken lines plus the two ends of the stroke that drew last (`anchor` stays put,
`head` follows the finger — they are not the selection, they are what lets a
Shift+arrow carry a run on). The module turns it into the strokes
(`paintLineRun`), the contiguous groups (`lineSelectionGroups`), the source range
of one of them (`lineRunRange`), the clipboard text (`lineSelectionSource`), the
whole-line removal (`removeLineSelection` — the one place a line selection
reaches outside the lines it names, to swallow the newline that joined each to
its neighbour), the type-over (`overwriteLineSelection`, written as a removal
plus an insertion precisely because the lines need not be adjacent) and the
arrow-key steps (`moveLineSelection`, which redraws the walking run while leaving
every line taken outside it alone). `clampLineSelection` drops the lines another
writer — or an undo — has taken out from under it. The DOM half lives in
`MarkdownEditor`: the sweep (`onSweepDown` / `onSweepMove` / `onSweepUp`,
`lineRowAt`, `onSweepRail`, `paintSweep`), the document-level keyboard (the mode
is entered from a header button, so on a desktop the surface may not hold focus
at all and Escape has to work either way), and `LineRow`'s `data-line-row` box,
which is what a press is resolved against and which the mode renders for every
line whether or not the note is numbered.

A locked note keeps the mode: taking lines and copying them is reading, which is
exactly what a locked note is for. Every path that would rewrite it stands down.
Unlocking the mode's trophy is **Sweeping statement**, fired the first time the
selection holds more than one line — one line is what a single press already
gives you, and more than one is the thing the mode is for.


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

### Transforms

**Transform rules** rewrite what a note *shows* without changing what it
stores. A rule matches part of a note body with a regular expression and
renders something else in its place: `#134` as a link to that issue, a booking
code as the words it stands for, `0761234123` as `076****123`. The pure engine
is `src/domain/transform.ts`; the rules live in the
[appearance store](#appearance-store) as `transforms`, so they travel with a
synced folder or cloud the way every other preference does.

**The note is never rewritten.** This is the property everything else hangs
off: the saved bytes are exactly what was typed, the
[active line](#styled-raw-line) renders raw so the real text is one press away, and a
copied selection carries the source rather than the substitution (every
transformed run stamps `data-len` beside its `data-src`, the same mechanism a
[shortened link](#shorten-links) uses — see [selection
mapping](#selection-mapping)). That is what makes the `sensitive` kind
honest: it hides a phone number from someone reading over your shoulder, it
does **not** redact the note.

**A rule belongs to a namespace.** Work and home want different rewrites — the
issue links that make the work notes readable have no business rewriting a
shopping list — so every rule carries a `namespace` slug, or `null` for all of
them. `App` compiles the list against the [active namespace](#namespaces)
(`compileTransforms(rules, slug)`, filtered by `transformAppliesTo`), so a rule
scoped elsewhere is simply not in the compiled array the renderers get. The
whole list still lives in the one appearance document — `settings.json` sits at
the app-folder root and is shared by every namespace — so a work rule travels
with the folder and is still there when you switch back. A rule written before
scoping existed (and one an older build round-trips through, dropping the
field) reads back as `null`, which is exactly what it did before: run
everywhere.

A rule has a **pattern** (the regex, with an optional ignore-case flag), a
**kind**, a **replacement**, and — for `sensitive` — a **mask style**. The
replacement expands `$1`…`$99`, `$&`, `$<name>` and `$$` against the match
(`expandReplacement`), so several capture groups can be combined into one
substitution. The three kinds:

- **`link`** (the default) — the matched text stays on screen and becomes an
  anchor to the expanded replacement, wearing a dotted underline so it reads as
  derived rather than typed.
- **`text`** — the expanded replacement is shown in place of the match.
- **`sensitive`** — the match (or the expansion, when one is given) is masked
  by one of `MASK_STYLES`: `all` (every character starred, length still
  readable), `fixed` (always eight stars, so the length is hidden too), `ends`
  (`076****123`), `last`, `first`. A run shorter than the characters a style
  would keep in the clear is masked entirely rather than leaked.

The pipeline is three exports. `compileTransforms` builds the `RegExp`s once
per edit of the rule list — silently dropping the ones the engine rejects, so a
half-typed pattern can't throw on every keystroke — `transformHits` finds one
line's non-overlapping matches, and `applyTransforms` splices them into the
parsed inline tree as `transform` nodes (`src/domain/markdown.ts`), which
`TransformNode` (`src/ui/MarkdownLine.tsx`) draws. Rules run **in list order**
and the first to claim a run of text wins, so a broad rule below a narrow one
never swallows it. Only plain text runs are considered: a rule never fires
inside inline code, a link's label, an image reference, or a
[fenced code block](#code-block) — all markup the writer meant literally — but
it does walk into emphasis, so it still matches inside **bold**. Matches per
line are capped (`MAX_HITS_PER_LINE`) and zero-width matches are skipped, so a
pathological pattern can't hang the render.

`App` compiles the list once and hands the same array to the
[live-preview editor](#markdown-editor) and the
[read-only archived note](#archive-view), so a masked number reads the same in both;
each rendered line's memo compares that array by identity and bails out. The
Markdown-off [plain textarea](#markdown-editor) has no rendering layer and
shows the source, as it does for every other display-only feature.

See [Transform settings](#transform-settings) for the UI, and the
[Shapeshifter](#unlock-triggers) achievement, which fires on the first rule —
[Local dialect](#unlock-triggers) once rules exist in two different namespaces,
which is the point at which the rewrites have genuinely parted ways (a rule
carrying *a* namespace wouldn't do: a new rule is scoped to the namespace you're
in anyway).

### Transform settings

The **Transform** tab of the [settings modal](#settings-modal) —
`TransformSection` (`src/ui/settings/TransformSection.tsx`) — lists the rules in
the order they run. Each row shows the rule's name (falling back to its
pattern), its kind, and the pattern itself, with a checkbox that parks the rule
without deleting it and buttons to edit or delete it. Like every other
appearance tab it edits the dialog's **draft**, so nothing persists until
**Save**. **Reset to defaults** deliberately *keeps* the rules: they are
authored content, not a preference toggle, and are deleted one at a time from
their own tab.

The tab lists **every** rule, not just the ones that run here: a rule hidden
because you switched namespace is a rule you can't find, so the ones belonging
elsewhere stay in the list, greyed out, wearing a chip with the name of the
namespace they do run in (a rule left behind by a *deleted* namespace shows its
bare slug — deleting a namespace never deletes authored rules — and the dialog
re-scopes it). New rules start in the namespace you are in, and the dialog's
**Applies to** picker widens one back to *All namespaces*. None of that is
drawn while the device has a single namespace: there is nothing to scope to, so
the chip, the picker and the explanatory line stay away and a rule made then is
global — which keeps it working if a second namespace appears later.

Under the pattern field sits the **regex reference** — `RegexHelper`
(`src/ui/settings/RegexHelper.tsx`), a dropdown of the constructs a rule is
built from, each showing its snippet beside what it does in words ("`\d` — any
digit, 0 to 9"). Pressing a row types that snippet into the pattern **at the
caret**; a wrapping one (`(…)`, `[…]`, `(?:…)`) goes *around* the selection
instead, so selecting `\d+` and pressing `(…)` gives `(\d+)`. The press is
taken on `mousedown` so focus never leaves the field, and the caret is parked
where the insert left it (between the halves of an empty wrap, past the closing
half of a filled one) by a pending-caret effect — the field is controlled, so
the caret can only be placed once the new value has rendered. The panel stays
open, because building `#(\d+)` is three presses.

It is the app's own dropdown, not a control of its own: the trigger is
full-width and cut to the same size, border and type as a
[`SelectPicker`](#custom-dropdown) trigger — the mask picker further down the
same dialog *is* one, and the two must not read as different kinds of control —
and the rows hang in a portalled [`FloatingPanel`](#custom-dropdown) with the row
metrics every other menu in the app uses (`role="menu"`, one `role="group"` per
token group). The trigger takes its press on `mousedown` too, so merely opening
the reference doesn't cost the caret either. Being portalled, the panel escapes
the dialog body's scroll container rather than being clipped by it; the cost is
the panel's dismiss backdrop, so a tap on the pattern field while the reference
is open closes it, the way it does for every other dropdown.

The token catalog is data in `src/domain/transform.ts` (`REGEX_TOKEN_GROUPS`,
four groups: match a character, repeat, group, position) with every description
in the `settings` i18n namespace under `settings.transform.token.<id>` — the
same data/copy split the [achievements catalog](#achievement-catalog) uses, so a
new token is a row plus its strings. `insertRegexToken` is the pure insertion
(clamping and ordering the selection bounds, so a never-focused field simply
prepends); a test asserts every token has copy in both languages and compiles in
the position it is typed into.

**Add transform** and the edit button open the same dialog,
`TransformRuleModal` (`src/ui/settings/TransformRuleModal.tsx`) — titled **Add
transform** or **Edit transform** after which of the two opened it — laid out in
the order a rule is written in: the name, the **Applies to** scope (a
[`SelectPicker`](#custom-dropdown) of *All namespaces* plus every namespace,
shown only when there is more than one), the pattern, the kind, the replacement
(its label and hint follow the kind, and the mask picker appears only for
`sensitive`), then a **sample text** field and the **result** pane beneath it.
That pane is the point of the dialog — a regex is easy to get subtly wrong, and
the only convincing check is watching your own text go through it — so it
re-runs `previewSegments` on every keystroke, drawing links, replacements and
masks the way the note will. It compiles the draft **without** a namespace: the
question there is whether the rule does what you meant, not whether it runs
where you're standing. The sample is saved with the rule, so re-opening it shows
the example that proved it. Save is refused while the pattern is empty or the
regex engine rejects it (the error is shown verbatim), and while a `link` rule
has nowhere to point.

Unlike the app's other small dialogs it is **not** a centred card: it renders as
the [full-screen mobile sheet](#modal) (a card on desktop). The form is long and
almost every field raises the soft keyboard, and a card sized to the space left
above the keyboard pushes the result pane — the reason the dialog exists — out
of view on a phone.

### YouTube player

A **bare** YouTube URL on a rendered line becomes an inline **video player**
instead of a link: `YouTubeEmbed` (`src/ui/YouTubeEmbed.tsx`), swapped in by the
`link` case in `LinkNode` (`src/ui/MarkdownLine.tsx`) whenever `youtubeVideo`
(`src/domain/youtube.ts`) recognises the href. The note's source is untouched —
the URL is still exactly what was typed, and it comes back as raw text the
moment the caret lands on its line, like any other [rendered
line](#rendered-line).

`youtubeVideo` is the whole URL-shape story, and it is pure: it accepts
`youtube.com/watch?v=…`, any subdomain (`m.`, `music.`), `youtu.be/…`,
`/shorts/…`, `/live/…`, `/embed/…`, the legacy `/v/…` and `/e/…`,
`youtube-nocookie.com`, and a scheme-less `www.youtube.com/…` (what
[autolinking](#markdown-parser) hands it). Out of all that it keeps exactly two
things — the eleven-character video id and the start offset (`?t=90`, `?t=1h2m3s`,
`?start=90`, `#t=30`) — and **trims everything else**: `si`, `pp`, `feature`,
`ab_channel`, `ra`, the playlist it was watched from. Anything whose id isn't
id-shaped (a channel, a search, a playlist, `/embed/videoseries`) is not a video
and stays an ordinary link. `youtubeEmbedSrc` then rebuilds the player URL from
those two values alone.

Two carve-outs keep the swap from taking something away: an explicit
`[label](url)` stays a link (the writer chose words to put on it, and a player
would throw them away), and so does a link the [find bar](#find-in-note)
currently has a hit on, so the match it just reported is on screen to see.

**Nothing is fetched from YouTube until the video is played.** The card shows
the poster frame (`i.ytimg.com`, `hqdefault` — the one size every video has,
4:3, cropped back to 16:9 by the card) and only the press swaps in the player
iframe, served from `youtube-nocookie.com`. A note full of links therefore opens
without pulling in a megabyte of player code per link, and without YouTube
hearing about it on the reader's behalf. The poster failing (offline, or a
blocked host) leaves the play card, not a broken image.

**Widescreen** is the button in the player's corner: the card goes full-screen
over a blurred, dimmed backdrop, as wide as the viewport allows while still
leaving the note showing around it. It is a **class swap on the element the
iframe already lives in** — deliberately not a second player rendered in an
overlay — so the DOM node survives and the video plays straight through the
transition instead of restarting. A placeholder box holds the line's height
while the player is lifted out, so the note doesn't reflow underneath. Escape,
the backdrop, or the same button (now a minimise glyph) puts it back. Going wide
from a card that hasn't been played starts the video, since that is what the
gesture means. The [Now playing](#unlock-triggers) achievement fires the first
time a note holds a YouTube link.

### Code block

Lines wrapped in a pair of ` ``` ` (or `~~~`) fences are a **fenced code
block**: `classifyLines` (see [Markdown parser](#markdown-parser)) tracks the
fence state and gives every line inside the block the `code` kind, so its
contents render verbatim — a `#` inside a block stays a hash, not a heading.
The delimiter lines themselves are the `fence` kind.

In the [live-preview editor](#markdown-editor) the fences are hidden the same
way a heading's `#` is: `hiddenFenceLines(blocks, activeLine)`
(`src/domain/markdown.ts`) returns both delimiter lines of every **closed**
block the caret is *outside* of, and `MarkdownEditor` skips rendering those
lines. Move the caret anywhere inside a block — onto its code, or onto a fence
itself — and both delimiters reappear, so they can be edited or deleted; move
it out and they fold away again. `fencedRanges` is the underlying pairing pass
(each opening fence matched to the next closing one). Two rules keep this from
hiding something the user needs:

- An **unterminated** fence is never hidden. Until a closing ` ``` ` exists the
  block has no end, and hiding the opener would swallow the only marker saying
  the rest of the note is code — so a half-typed block keeps its fence on
  screen.
- A block stays **visible as a block** without its delimiters: `lineTextClass`
  (`src/ui/markdown-line-class.ts`) gives every `code` and `fence` line a
  `bg-surface-2` slab and horizontal padding. The editor renders one element
  per source line, so there is no container to paint — the adjacent lines'
  boxes meet and read as one block. The **active raw line** gets the same
  classes, so putting the caret inside a block doesn't punch a hole in it.
  `RenderedLine` (`src/ui/MarkdownLine.tsx`) then only varies the ink: a
  visible fence is muted (it is markup), the code it wraps is bright (it is
  content).
- The block's **box is closed at its outermost drawn lines**:
  `codeBlockEdges(blocks, activeLine)` (`src/domain/markdown.ts`) names the
  block's first and last drawn line, and `codeBlockEdgeClass`
  (`src/ui/markdown-line-class.ts`) gives them the rounded corners
  (`var(--radius)`, so the block follows the user's radius preference) and the
  vertical padding — top on the first, bottom on the last, so a one-line block
  closes the box on its own and a tall one keeps its interior lines tight
  rather than turning airy. The padding is also what gives the block's first
  row room to hold the [copy button](#code-block-copy-button). Which lines are
  the edges shifts as the fences fold: with the caret outside they are the
  first and last *code* lines, with it inside they are the delimiters. An
  unterminated fence counts from its opener to the end of the note, so a
  half-typed block reads as a block too. Like `lineTextClass`, the classes go
  on the active raw line as well, so the caret landing on an edge doesn't
  change the block's height.

The lines stay in the source throughout — hiding is purely a render-time skip,
so line indices, structural edits, and [selection
mapping](#selection-mapping) are unaffected. `hasClosedFence(body)` is the
cheap line-level scan (no blocks built) behind the
[Fenced in](#unlock-triggers) achievement, which fires the first time a note
holds a closed block.

### Code block copy button

Every **closed** code block wears a small copy button in its top-right corner,
so the code can be lifted out with one tap — without placing the caret in the
note, dragging a selection over the block, or opening the raw source.
`CodeCopyButton` (`src/ui/CodeCopyButton.tsx`) draws it, and one press puts the
block's lines on the clipboard through the shared `writeClipboard`
(`src/ui/clipboard.ts`) — the code **only**, with the ` ``` ` fences and any
info string (` ```sh `) left off — then flips its glyph to a check for a moment
to confirm the write. It fires the [Snippet snatcher](#unlock-triggers)
achievement.

`codeBlockCopyAnchors(blocks, activeLine)` (`src/domain/markdown.ts`) decides
where each button hangs: it returns a map from a source line index to the code
that line's button copies, and `MarkdownEditor` renders the button into that
line's wrapper. Because the editor draws one element per source line (there is
no per-block container to hang anything off — see [Code block](#code-block)),
the anchor is the block's first line that *actually renders*: the opening fence
while it is visible (the caret is inside the block), otherwise the first code
line under it. The active line is skipped as well — it renders as raw source —
so the button steps to the line below instead of being planted in the line
being typed on. A block with nothing between its fences gets no button: there
is no code to copy.

Living inside the `contenteditable` surface puts three constraints on the
button, all of them in `CodeCopyButton`:

- It is `contentEditable={false}` and unselectable, so the browser treats it as
  an atom — it never lands in the note's source, and dragging a selection
  across the note doesn't sweep it up with the code.
- Its `mousedown` is cancelled (the same trick [a link in the
  preview](#rendered-line) uses), so pressing it doesn't roll the caret into
  the block — which would unfold the block's fences and shuffle it down a line
  under the user's finger mid-press.
- It is a `sticky` float on a zero-height rail across the anchor line, centred
  on that line's first *row* (a code line is a fixed 20px tall) and following
  the block's own top padding down when the anchor is the block's top edge.
  Centring on the row rather than on the line's box keeps the button in the
  corner on a tall or wrapped block and inside the slab on a one-line one —
  which is why a block pads its [top and bottom edges](#code-block): a bare
  20px row has no room to hold a 28px button. The stickiness
  matters when word wrap ([Editor settings](#editor-settings)) is off and the note scrolls sideways —
  every line is then as wide as the widest line in the note, and without it the
  button would park a screen or two off to the right where nobody would find
  it.
### Quote continuation

Pressing **Enter** inside a quote opens another quote row, so a passage can be
typed straight through instead of re-marking every row from the
[styling toolbar](#styling-toolbar). `newlineFor(blocks, index, col, soft)`
(`src/domain/markdown-format.ts`) is the pure decision — what the press does to
the source (see [list continuation](#list-continuation), which shares it): a
bare `"\n"` everywhere else, and `"\n"` plus the line's **own** marker inside a
quote, so the indent and the exact spelling (`> ` or a bare `>`) carry across
rather than being normalised. The [live-preview editor](#markdown-editor) calls
it from the `insertParagraph` / `insertLineBreak` branch of its `beforeinput`
handler and feeds the result to the same `replaceRange` engine every other
structural edit goes through, so splitting mid-row quotes the tail too
(`> one|two` → `> one` / `> two`). It reads the caret's line from the
classification the editor already holds, so a `>` inside a
[fenced code block](#code-block) is code, not a quote.

Quote mode is deliberately **sticky**: an empty quote row opens another one
rather than dropping out of the quote, so leaving one is an explicit act —
press **Quote** on the [styling toolbar](#styling-toolbar) to unmark the row,
or put the caret on a row that isn't quoted (the decision is per-line, so the
next Enter simply follows whichever row the caret sits on). The one caret
position that doesn't continue is one still *inside* the marker: Enter there
pushes the whole row down, exactly as on any other line.

Only the live-preview editor does this. The Markdown-off
[plain fallback](#editor-settings) is a real `<textarea>` whose Enter the
browser handles natively; intercepting it there would cost the browser's own
undo history for the commonest keystroke in the note, which is a worse trade
than the inconsistency.

`hasMultiLineQuote(body)` (`src/domain/markdown.ts`) is the cheap, fence-aware
line-level scan (no blocks built) behind the [Quote, unquote](#unlock-triggers)
achievement, which fires the first time a note holds a quote running over two
or more consecutive rows.

### List continuation

A list is written the way it reads. Pressing **Enter** on a bullet or numbered
row opens the next one, **Tab** nests a row under the one above it, and
**Shift+Enter** opens another row *inside* the item you're on — so a whole
outline is typed without reaching for the [styling toolbar](#styling-toolbar)
or the mouse.

**Enter** shares its decision with [quote continuation](#quote-continuation):
`newlineFor(blocks, index, col, soft)` (`src/domain/markdown-format.ts`) answers
what the press does to the source, and the
[live-preview editor](#markdown-editor) applies it through the same
`replaceRange` engine every other structural edit uses. On a list row the
answer carries the marker across, exactly as written:

- **A bullet** repeats its own character and indent — `- `, `* `, `+ `,
  `  - ` — so the new row lands as a sibling of the one it came from.
- **A numbered item** bumps its number by one (`2. ` → `3. `, `9) ` → `10) `),
  so the source reads the way it renders. The preview renumbers regardless
  (`numberLists`), so a hand-edited file is never a column of `1.`.
- **A [task item](#task-items)** carries its `[ ]` box over too, but always an
  empty one — `- [x] milk` opens `- [ ] `, never a row that arrives
  pre-ticked.
- **Splitting mid-row** carries the tail into the new item, the same as a
  quote: `- one|two` → `- one` / `- two`.
- **A caret still inside the marker** isn't in the item at all — Enter there
  pushes the whole row down, as on any other line.

Lists, unlike quotes, are **not sticky** — an endless column of empty bullets
is nobody's intent. Enter on an **empty item** ends the list instead of opening
another: one press pulls a nested item back out a level (`  - ` → `- `), the
next clears the row to a blank line, so repeated Enter walks out of the list
the same way Tab walked into it. This is decided **before** the Shift+Enter
branch below, so an empty item ends the list whether or not Shift is held —
there is no content for a continuation row to hang under, and on a phone this
is the one row where the modifier is least trustworthy (see the soft-break
note below) and the way out matters most. That is the one case `newlineFor` answers with
a `replaceLine` rather than an `insert` — it rewrites the caret's row instead of
splicing at the caret — and it is a bare-caret answer only; with a range to
delete, Enter splits like any other press.

Spotting that empty row takes a second look, because a row emptied down to a
`- ` classifies as a **divider** (`hr` — the shorthand a note-taker reaches for
without counting out three dashes). `listItemAt(blocks, index)` resolves the
ambiguity from **the gap after the marker**: Enter on a bullet writes the marker
with its trailing space (`- `), and someone typing a divider types a bare `-`.
So `- ` under an open list is the empty item the last Enter opened, while a
hand-typed `-` stays the rule it looks like *wherever* it lands — including
straight under a list, which is exactly where a note-taker wants one and where
reading it as an empty bullet would silently eat the character they just typed.

**Shift+Enter** opens a continuation row instead of a new item: a plain line
padded out to the item's text column, keeping the row's own leading whitespace
verbatim (so a tab-indented item's continuation is tab-indented too). `numberLists`
(`src/domain/markdown.ts`) reads a paragraph indented past the open item's
indent as part of that item rather than as the end of the list, so a
continuation row doesn't restart the numbering or flatten the nesting under it.
In a **quote** Shift+Enter still carries the `> ` — a quote row without the
marker isn't in the quote at all.

Which of the two a press was is read from the `keydown` that precedes the
`beforeinput` (the `softBreak` ref in `MarkdownEditor`), not from its
`inputType`. `insertLineBreak` vs `insertParagraph` is meant to say exactly
this, but the two aren't reliably split that way across browsers in a
`plaintext-only` host, and getting it wrong would stop plain Enter continuing a
list.

The flag is read through `takeSoftBreak`, which **consumes** it. Only a keydown
ever sets it, so an edit that arrives without one — a soft keyboard, an
autocorrect commit, a dictated line break — would otherwise inherit whatever
the *last* physical press said, a Shift+Enter minutes ago silently turning a
later plain Enter into a soft break. A soft keyboard's Shift is not reliable
even when it does send a keydown: iOS auto-capitalises at the start of a line,
which leaves the on-screen shift engaged and reports `shiftKey` on the Return
that follows. That is why the empty-item exit above is decided ahead of this
branch rather than behind it.

**Tab** on a list row indents it; **Shift+Tab** pulls it back out. `indentList`
(`src/ui/MarkdownEditor.tsx`) routes straight to the toolbar's own
`{ kind: "indent" }` action, so the keyboard and the indent / outdent buttons
are the same edit, and a multi-line selection moves every row it covers.
Otherwise Tab keeps its existing job of handing focus on (see
[Editor tab order](#editor-tab-order)) — and so it does in two cases that
matter: when the selection holds no list row at all, and when a **Shift+Tab has
nothing left to unindent**. That second carve-out is what keeps the outer level
of a list from being a place the keyboard can't tab out of.

Only the live-preview editor does any of this, for the reason
[quote continuation](#quote-continuation) gives: the Markdown-off
[plain fallback](#editor-settings) is a real `<textarea>`, and intercepting its
Enter and Tab would cost the browser's own undo history.

`hasNestedListItem(body)` (`src/domain/markdown.ts`) is the cheap, fence-aware
line-level scan behind the [Sub-point](#unlock-triggers) achievement, which
fires the first time a note holds a list row indented under a shallower one.

### Double space period

Tapping **space twice** at the end of a word ends the sentence: the space
already there is swallowed and `". "` written over it, so `Hello ` + space
reads `Hello. ` with the caret sitting after the space, ready for the next
sentence.

This is the shortcut iOS and macOS apply inside any ordinary text field, and it
is in this app's hands rather than the platform's for the reason everything
else in the [live-preview editor](#markdown-editor) is: the editor intercepts
every `beforeinput`, `preventDefault`s it, and applies the edit to the source
itself. The keystroke never reaches the platform's own substitution, so the
shortcut simply stopped happening in the note body once the editor moved off
`<textarea>`s onto one `contenteditable` surface. Owning the rule also makes it
read the same everywhere — a desktop browser, Android (where the substitution
is a keyboard's option rather than the system's), and inside the
[wrappers](#embedded-wrapper-builds) — instead of depending on what the device underneath
happens to do.

`doubleSpacePeriod(line, col)` (`src/domain/sentence.ts`) is the rule, and it
is deliberately narrow: it fires only when the character being replaced is a
space **and** the one in front of it is a word's tail — a letter, a digit, or a
closing quote / bracket. That is what leaves the two habits that look like this
alone: double-spacing *after* a full stop (`Done.  ` — the character in front of
the space is `.`, not a word) and lining text up with a run of spaces (the
character in front is another space). It returns the column the rewrite starts
at, and the editor splices `". "` over `[from, col)` through the same
`replaceRange` engine every other edit uses — so it is one undo step, and the
[undo timeline](#undo--redo)'s sentence counter (also `src/domain/sentence.ts`)
sees the finished sentence and checkpoints there.

`autoPeriodAt` (`src/ui/MarkdownEditor.tsx`) decides whether to consult the
rule at all, in the `insert` branch of the `beforeinput` handler. It stands
down for a ranged selection (a space typed over a selection replaces it, like
any other character), when the caret is inside a **fenced code block** — code
is verbatim text where two spaces are two spaces, an exception no platform
keyboard makes — and when **Disable auto correct** is on in
[Editor settings](#editor-settings): the shortcut belongs to the same family as
the platform's autocorrect and auto-capitalisation, so the one switch that
turns those off turns this off too, and no new setting was added for it.

The [plain `<textarea>` fallback](#editor-settings) needs none of this — it
never intercepts a keystroke, so the platform's own shortcut still applies
there.

The first rewrite fires the **Full stop** achievement through the manual bus:
the dot it writes is indistinguishable from one typed by hand, so there is
nothing in the document to derive it from.

### Sentence capitals

The other half of the same story, and the same reason for existing: the note
writes the **capital that opens a sentence** as you type — the first letter of
a line, and the first letter after a full stop, question mark or exclamation
mark. A phone puts that capital in for you in any ordinary text field, and it
"falls away" the moment the caret is inside the
[live-preview editor](#markdown-editor), which `preventDefault`s every
`beforeinput` and writes the character into the source itself; the keystroke
never reaches the platform's substitution, so nothing capitalises it. On a
desktop browser nothing offered it in the first place. Owning the rule fixes
both at once, and makes them agree.

`sentenceCapital(line, col, typed)` (`src/domain/sentence.ts`) is the rule. It
answers with the capitalised letter, or `null` to insert what was typed, and it
is narrow in three ways:

- **Only a single lowercase letter is ever rewritten.** A paste, an autocorrect
  replacement (`insertReplacementText`), a digit, or an already-capital letter
  goes in untouched. A letter whose uppercase form is *longer* than the letter
  (`ß` → `SS`) is left alone too — growing the text would shove the caret one
  place past where the typist put it.
- **A sentence starts either at the head of a row or after a terminator and a
  space.** `LINE_LEAD` allows the markup that *opens* a row to sit in front of
  the caret — indentation, `>` and `#`, a bullet or numbered marker, a checkbox
  — so `- `, `1. `, `> ## ` and `- [ ] ` are all sentence starts. `SENTENCE_GAP`
  matches the terminators [the boundary rule](#undo--redo) counts (`.!?…`, plus
  any closing quotes or brackets) **followed by a space**. Requiring that space
  is what keeps `a.png` and `3.5` in lower case; an abbreviation (`e.g. `) is
  read as a sentence start, the same harmless over-reach every platform
  keyboard makes.
- **A half-typed emphasis marker is not a bullet.** `*` on its own opens
  `*italic*`; a list marker needs the space after it.

`autoCapitalAt` (`src/ui/MarkdownEditor.tsx`) decides whether to consult the
rule, in the `insert` branch of the `beforeinput` handler, and the capital goes
in through the same `replaceRange` engine as every other edit — so Backspace or
Undo takes it straight back off. Unlike the [full stop](#double-space-period)
it *does* apply over a ranged selection: what sits after the caret has no say in
whether a sentence starts there. It stands down inside a **fenced code block**
(`const x` must not become `Const x`), when **Capitalise sentences** is off in
[Editor settings](#editor-settings), and when **Disable auto correct** is on —
that switch turns the whole family off, this included.

The **Capitalise sentences** setting (`capitaliseSentences`, default on) also
drives the `autocapitalize` attribute on the [live-preview](#markdown-editor)
surface, on the [plain `<textarea>` fallback](#editor-settings) and on the
[title field](#title-field): a textarea is never intercepted, so there the
platform's own capitalisation still does the work and the setting only decides
whether to ask for it.

The first capital the editor writes fires the **Capital idea** achievement
through the manual bus — like the full stop's dot, the letter is
indistinguishable from one typed with Shift held.

### Divider

A **divider** — a horizontal rule, an `hr` — is written by putting a line on its
own that is nothing but dashes. Markdown proper wants three (`---`, or `***` /
`___`), and `HR_RE` in `classifyLine` (`src/domain/markdown.ts`) takes those;
notes also takes a **single `-`**, the shorthand a note-taker reaches for
without counting out three dashes. The [live preview](#markdown-editor) draws it
as a real `<hr>` rule spanning the line, and the [styling
toolbar](#styling-toolbar)'s Insert menu writes one for you.

That shorthand overlaps with the empty bullet [list
continuation](#list-continuation) opens, and the **trailing space** is what
tells the two apart: Enter on a bullet writes the marker with its gap (`- `),
while a person typing a divider types a bare `-`. `listItemAt` reads a `- ` row
under an open list as that empty item, and leaves a bare `-` a divider wherever
it lands — so typing `-` and pressing Enter draws a rule and opens the next
line, even directly under a list.

Deleting one is [caret placement on press](#caret-placement-on-press)'s
problem, not this section's: a rule renders as a lone `<hr>` with no text to
anchor a caret in, so a press on it takes the end of its **source** line and
Backspace works back from there.

### Bullet characters

An unordered list draws one of three fixed glyphs per nesting level:
`BULLET_GLYPHS = ["•", "-", "+"]` in `src/ui/MarkdownLine.tsx`, picked by
`bulletGlyph(depth)` as `depth % 3` (so a fourth level reuses the parent `•`).
All three glyphs are present in the app's bundled monospace font (JetBrains
Mono), so they render — and stay vertically centred — identically on every
platform; the `◦` / `▪` the list used to cycle through are **not** in that
font, so a device substituted them from another font and drew them off-centre.
The marker sits in a fixed-width, one-line-tall flex box centred on both axes,
which keeps every level's text starting at the same column.

### Task items

A list row written `- [ ] milk` (or `- [x] milk`) is a **task item**: the live
preview draws it with a real, pressable checkbox instead of a bullet, and
pressing that checkbox ticks the item off in the Markdown itself.

`classifyLine` (`src/domain/markdown.ts`) matches `TASK_RE` against whatever
follows the bullet and, on a hit, sets `LineBlock.task` to the box's state
(`false` for `[ ]`, `true` for `[x]` / `[X]`) — absent on every other line, a
bare bullet included, so `task !== undefined` is what says "this row is a
checkbox". The box counts as part of the **block marker**, not the content:
`contentStart` points past it, so the item's text renders and its inline
offsets map exactly as on any other list row, and nesting / numbering /
indenting all keep working untouched. `- []`, `- [todo]`, and an ordered
`1. [ ]` are deliberately *not* task rows.

`TaskCheckbox` (`src/ui/MarkdownLine.tsx`) draws the marker, reusing the app's
own checkbox artwork — `CheckboxGlyph` from the [shared
framework](#the-shared-framework), re-exported through `src/ui/form/Checkbox.tsx`
— so a note's checkboxes are the same accent-filled box as every checkbox in
Settings. It sits in the same fixed-width, one-line-tall `MARKER_BOX` the bullet
glyph does, so a mixed list keeps one text column; a nested item draws the
smaller box. A ticked item's text is struck through and dimmed. The
`aria-hidden` bullet is replaced by a `role="checkbox"` press target carrying
`TASK_TOGGLE_ATTR` (`data-task-toggle`), which is how the press is routed.

**Ticking one off never opens the editor.** That is the whole point of the
gesture — on a phone, checking off a shopping item shouldn't raise the soft
keyboard. Two things get it there:

- The checkbox cancels its own `mousedown`, exactly as a [rendered
  link](#rendered-line) does, so the browser never places a caret with the
  press and the row never becomes the raw active line.
- `onSurfaceClick` (`src/ui/MarkdownEditor.tsx`) looks for
  `TASK_TOGGLE_ATTR` on the way up from the click **before** its
  `defaultPrevented` bail (the checkbox is what cancelled the press), resolves
  the row from the enclosing `[data-line-index]`, and calls `toggleTask`. The
  press is routed through the DOM rather than a callback prop because
  `RenderedLine` is memoized on its block's primitive fields, and the editor
  already resolves a pressed line this way.

`toggleTask` deliberately does **not** go through `commit`: it rewrites the one
line via the pure `toggleTaskLine` and pushes the new body out, touching neither
the active line nor the caret. It can skip the caret arithmetic entirely because
`[ ]` and `[x]` are the same three characters wide — the swap is
length-preserving, so every column in the note still means what it did. The
touch-reveal a press armed is dropped too, since there is no line to scroll to.

Read-only surfaces (the archive's [note view](#archive-view)) leave
`RenderedLine`'s `interactiveTasks` off, and the box renders as inert state —
labelled "Done" / "Not done" — rather than as a control that would do nothing.

The row the caret is *on* shows its source instead, so there is no checkbox to
press there — the `[x]` is right in front of you to type over. Because the box
is part of the block marker, the [styled raw line](#styled-raw-line) dims the
whole `- [x] ` as one markup run, exactly as it dims a `- ` or a `## `.

Enter on a task row opens the next one with an **empty** box: `listItemAt`
(`src/domain/markdown-format.ts`) unticks the marker it carries over, so a
checklist is written straight through and no fresh item arrives pre-ticked
(see [list continuation](#list-continuation)). An empty task row ends the list
like any other empty item.

**Writing one without typing the brackets** is the [styling
toolbar](#styling-toolbar)'s job: **Checklist** sits in the Block style menu
beside Bullet list and Numbered list, and marks every line the selection
touches as `- [ ] `. Typing `- [ ] ` by hand is fiddly on a phone keyboard —
two bracket keys and a space, in the right order — which is the whole reason
the button exists.

It is its own `FormatAction` (`{ kind: "task" }` → the `task` `BlockTarget`)
rather than a flag on `list`, because the box is a *third* kind of list marker
rather than a variation on the bullet. That distinction is what
`matchesTarget` encodes: a checklist row and a plain bullet are both `ul`, so
the `task` flag is what tells them apart, and it buys three behaviours that
would otherwise be wrong —

- **Bullet list on a checklist row converts it** (box off, bullet kept)
  instead of reading it as already-bulleted and un-listing it outright. A
  second press then un-lists it, as on any bullet.
- **Checklist on a bullet, a numbered item, or a heading swaps the marker**
  rather than stacking a box on top of one (`splitMarker` strips the old
  marker first, exactly as every other block action does).
- **Exactly one of the two buttons is ever lit**, so the menu never claims a
  row is both.

Pressing Checklist on a row that already has a box takes the whole marker off,
tick and all — every toolbar action toggles. A fresh row always opens
unticked, the same reason Enter's continuation does.

`hasCheckedTask(body)` is the cheap, fence-aware line-level scan behind the
**Checked off** [achievement](#unlock-triggers), which fires the first time a
note holds a ticked item.

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

### Export

`ExportButton` (`src/ui/export/ExportButton.tsx`) — the **up arrow** at the end
of the editor's (and the read-only archived-note view's) header action cluster.
It opens a menu of the three ways a note leaves the app:

- **Export to PDF** typesets the note for paper, writes the PDF, and downloads
  it. See [PDF settings](#pdf-settings) for how that page is laid out. Unlocks
  the **Printing press** achievement.
- **Export to MD** downloads the note as a plain `.md` file. The bytes are the
  ones the file / cloud backends store (`noteToMarkdown` — see the
  [markdown codec](#markdown-codec)), YAML front matter and all, so an exported
  note opens in any Markdown app and round-trips back into notes unchanged. The
  filename is `exportFileStem` — a slug of the title, deliberately *without* the
  id suffix `noteFileStem` adds, since that noise has no place in a file you are
  about to send someone. Unlocks the **Takeaway** achievement.
- **Copy to clipboard** puts the note on the clipboard, as much of it as the
  `copyScope` [editor setting](#editor-settings) says — see
  [copy scope](#copy-scope). This is the only way to copy a note: the menu is
  where someone looks for "get this note out of the app", and a separate header
  button doing one of its three jobs was one too many in a row that already
  holds four. It confirms with a [toast](#toast) — the row swapping to a tick is
  confirmation nobody sees, because the menu closes on the press, and copying is
  the one row that finishes silently with no download to show for itself.
  Unlocks the **Copycat** achievement.

**Every row is a glyph and its label, at every width** — a phone has room for
the labelled menu, and three unexplained icons stacked under the header is a
guessing game. The [floating panel](#custom-dropdown) is measured and positioned
in JS, so this is a real width the panel is sized for rather than a CSS
`hidden sm:inline` that would leave it sized for text it doesn't draw.

The work is loaded **on the press**, not at mount (`await import()` from the
handlers): the Markdown codec, the layout engine and — by far the biggest of
them — the PDF writer are not something anyone who never exports should
download. See [code splitting](#code-splitting).

**A failed export says so.** When the on-press chunk can't be fetched — the
usual cause is a page outlived by a deploy, asking for a hashed chunk URL the
server has since replaced — or the PDF writer reports failure, the PDF/MD rows
raise a failure [toast](#toast) with a **Reload** action instead of silently
doing nothing: a reload gets a fresh page whose chunk URLs match what the
server actually serves.

#### Why the app writes the PDF itself

The export used to build an HTML page and hand it to `window.print()`, letting
the browser's engine write the PDF. It worked, but the **page furniture belonged
to the browser**: the print dialog stamps the URL, the date and the page number
into the margins, and CSS gives a page no way to turn any of that off — zeroing
the `@page` margin suppresses it, but only by taking the margins with it. The
file also arrived through a dialog rather than as a download, which on a phone
means a share sheet rather than a saved file.

So the app paginates and writes the document itself, in two halves either side
of a seam:

- **`layoutPdf` (`src/domain/pdf-layout.ts`)** — the typesetter. A note in, a
  list of pages of drawing operations out (`text`, `rect`, `ellipse`, `path`,
  `image`, `link`), in points from the top-left of the page. Pure, so the whole
  of pagination is unit-testable without a browser or a PDF library.
- **`buildPdf` (`src/ui/export/pdf-document.ts`)** — the writer. It drives
  [jsPDF](https://github.com/parallax/jsPDF), the app's one non-trivial runtime
  dependency, and is the only module that imports it. Loaded on the export press
  and nowhere else, so the ~130 kB (gzipped) writer never reaches someone who
  doesn't export.

Two things the typesetter can't know are injected across that seam: **`measure`**
— how wide a string is in a given font at a given size, which only the writer's
metrics can answer — and **`resolveImage`**, an image's pixel dimensions. The
measurer contract matters more than it looks: it must measure text *as the writer
will draw it*, fallback font and all, or a line wraps in the wrong place.

#### PDF fallback font

A PDF names its fonts rather than carrying them, and every reader already has the
**standard fonts** — Helvetica, Times, Courier — so an ordinary note costs the
file nothing to typeset. Their limit is that they encode Latin-1 only. The writer
therefore scans each string, splits it into runs the chosen family can and can't
express, and draws the second kind in an embedded fallback — the same font
fallback a browser does, done by hand.

The fallback faces are DejaVu Sans subsets committed under `src/assets/fonts/`
(see the README there for the exact subsetting command and the licence). They
are **not** precached and not loaded with the app: the export fetches one the
first time a note actually contains such a character, so a Latin-1 note
downloads nothing and exports to a ~3 kB file. jsPDF subsets whatever it embeds,
so even a Cyrillic note only carries the glyphs it used.

The subsets cover Latin-Ext, Greek, Cyrillic, punctuation, currency, arrows,
maths and a curated handful of symbols. **CJK and emoji are deliberately out** —
covering them means megabytes, not kilobytes. Text outside both the standard
fonts and the subset exports as `�`. List markers, checkboxes and rules are
*drawn* as vectors rather than set as glyphs, so a bullet never depends on any
of this.

### PDF settings

`PdfSettings` (`src/domain/pdf.ts`) — what an exported note looks like on paper:
page size and orientation, margins, the body font / size / line height /
heading scale, the heading font, the monospaced family, size and background fill
behind code, the bullet, whether the note's title heads the page, and whether —
and how — the pages are numbered. It lives in the domain (next to the pure
layout engine
that reads it, since `domain/` may not import the theme layer) and is re-exported
from `src/theme/themes.ts`; the values ride on the
[appearance store](#appearance-store) as `Appearance.pdf`, so they travel with
`settings.json` like every other preference, and `coercePdfSettings` validates a
stored document slot by slot on read.

Only offered values survive that read, and `codeBackground` is narrowed to
`transparent` or a hex colour — the value is written into the document as a
fill, so the allowlist is what stops a hostile `settings.json` from putting
something else there. That same read is what retires a setting the writer can no
longer honour: a document from when the export was a browser print job may name
a code font only CSS could resolve (`system`, `consolas`), and those land on the
default like any other value that isn't offered.

**Two of the choices are about what a self-contained file can honestly promise.**
The **heading font** is `body` by default — not a font but a deferral, so
headings follow the body unless someone deliberately mixes the two. The **code
font** offers exactly two entries: Courier, which every reader already has, and
DejaVu Sans Mono, which is embedded into the file. Naming a family the file
doesn't carry would just be a request the reader substitutes its way out of.

`layoutPdf` (`src/domain/pdf-layout.ts`) reads through the same
[Markdown parser](#markdown-parser) the live preview does, so a PDF says what
the editor showed: consecutive prose lines keep the newlines the writer typed as
hard breaks, lists nest by the `depth` the parser assigned and ordered lists
carry its computed numeric → alpha → roman markers, task rows print as boxes
showing their state, and a fence that was never closed still prints as a code
block. A heading is never left stranded at the foot of a page — it moves down
with the first line of what follows — and a code block too long for one page is
split, each slice carrying its own fill. The title heading is drawn without a
rule beneath it: its size already separates it from the body, and a border there
reads as a stray `---` the writer never typed.

The **page number** is the only thing written into the margins, and it can be
switched off. Nothing else goes there — the URL and date a print dialog used to
stamp in are the reason the app writes the file itself. What it says and where
it sits are the user's: **number style** picks between the spelled-out `2 of 7`,
the terse `2 / 7` and a bare `2` for a document whose end the reader doesn't need
to know about, and **number position** sets it against the left, centre or right
of the *text column* (not the paper edge, so it lines up with the body above it).
Both live under the toggle in [Export settings](#export-settings) and only appear
while numbering is on. `pdfPageNumberText` (`src/domain/pdf.ts`) is the pure
formatter behind all three forms, and the settings picker labels its options by
calling it — so the option you choose is literally the string that gets printed.
The one word the `2 of 7` form spells out is handed *in* to the typesetter
(`PdfLayoutInput.pageNumberOf`, sourced from `app.export.pageNumberOf` by
`ExportButton`): `domain/` holds no catalogue, and a Swedish reader's PDF should
still say `2 av 7`. Both settings default to the centred `2 / 7` the export has
always written, so a document stored before they existed prints unchanged.

The document deliberately shares nothing with the app's screen theme: it is
black on white in a print-safe family, because a note exported to PDF should
read as a document rather than a screenshot of a dark editor. (The app's bundled
webfonts are not what a PDF can name, which is why the font choices are the
standard families — see [PDF fallback font](#pdf-fallback-font).) Link and image
URLs are allowlisted by scheme throughout — a note can arrive from a synced
folder someone else wrote to, so it is treated as untrusted.

**The PDF honours the [Transform](#transforms) rules; the other two exports
don't.** This is the one place the three deliberately part company — the PDF is
what you *see*, the Markdown file and the clipboard are what you *stored*. The
latter two are byte-exact copies of the note by design, and transforms are
display-only; but a `sensitive` rule masking a phone number exists precisely so
the original doesn't leave the screen, and a document made to be handed out is
where it must not reappear. The layout splices the compiled rules into each
parsed line exactly as the live preview does, and a transformed `link` still
resolves to a clickable annotation when its target is an inert scheme.

Image attachments are fetched **and measured** before the layout runs
(`resolveImages` in `src/ui/export/export-note.ts`, through the
[on-demand fetcher](#attachments)) — a note from a file/cloud backend carries
its attachments' metadata but not their bytes, and a PDF has to carry the
picture itself. The pixel dimensions are what let the typesetter scale a picture
to the column and reserve its height; an attachment the backend can't produce,
or that the browser can't decode, degrades to its alt text rather than to a
broken-image box.

### Copy scope

**Copy to clipboard** is the third row of the [export menu](#export) — there is
no separate copy button in the header (the export menu is where someone looks
for "get this note out of the app", and a second button doing one of its three
jobs was one too many in a row that already holds four).

What it copies is the saved `copyScope` [editor setting](#editor-settings),
chosen from the dropdown in the Editor tab of the settings modal
(`EditorSection`). The three scopes are a `CopyScope` (`src/domain/note.ts`):
`body` (the body verbatim — the default, never the title), `titleBody` (the
title prepended as a `# ` heading), and `frontMatter` (the whole `.md` file the
way the file backends store it). `buildCopyText` (`src/ui/copy-note.ts`)
assembles the text — the `frontMatter` case reuses the
[markdown codec](#markdown-codec)'s `noteToMarkdown` so a copied note is
byte-identical to its on-disk file. Copying is the **Copycat** achievement
(fired via `unlock("copycat")`).

### Cut button

`CutButton` (`src/ui/CutButton.tsx`) — the scissors glyph immediately left of
the [export button](#export) in the editor header. It cuts at the caret: what it
takes leaves the note *and* lands on the clipboard, because clearing a line by
hand is otherwise a select-and-erase or a held Backspace, and text you pulled
out is text you often want to put somewhere else. `Ctrl/Cmd+K` is the same edit
from the keyboard, bound by each editing surface itself (so the browser only
loses the shortcut while the note body has focus). Neither is offered in the
read-only archived-note view (see [Archive view](#archive-view)), and the button
is withheld while a note is still [decrypting](#encryption) — there is no
surface to cut in.

**The button is a touch affordance, so a desktop pointer doesn't get one.**
`useDesktopPointer` (`(hover: hover) and (pointer: fine)`, the same test that
swaps a row's swipe for the [right-click menu](#right-click-menu)) drops it
from the header: with a mouse and a keyboard the edit is already two other
presses away — `Ctrl/Cmd+K`, and the browser's own right-click **Cut** over a
selection — so a fourth glyph in that row buys nothing and is one more thing to
read past. Nothing else changes with it: the shortcut, `cutLine`, and the
**Guillotine** achievement are untouched, and a touch pointer (phone, tablet,
a touchscreen laptop's finger) still gets the button. The one place the gate is
lifted is [select mode](#select-mode), where cut is one of the four verbs the
mode exists for, in a row that has just dropped four other buttons to make
space — and where cutting acts on the picked run rather than on a caret, so
with nothing picked the press is a no-op rather than a cut of the line an
invisible caret was last left on. Otherwise it follows the pointer
rather than the [platform](#capabilities), because the reason is the
input device, not the shell — the Electron window and a desktop browser tab are
the same case, and a tablet running the PWA is not.

What exactly goes is decided by the pure `cutLine` (`src/domain/line-edit.ts`),
so both surfaces agree:

- **A ranged selection** — exactly what is highlighted goes, to the column, and
  the caret lands where the selection started. What you can see is selected is
  what ends up on the clipboard. In the [live-preview
  editor](#markdown-editor) a selection reaching a *formatted* line's content
  start is first snapped over that line's block marker (`snapStartToLineEdge`),
  so cutting a bulleted line takes its `- ` too — the [active raw
  line](#selection-mapping) is exempt, its marker being text you can see and
  select for yourself.
- **Caret in the middle of a line** — only the text *after* it goes, and the
  caret stays at its column. This is the kill-to-end-of-line every terminal
  binds to Ctrl+K, and it's what makes the button useful for lifting the rest
  of a sentence rather than only whole lines.
- **Caret at either end of a line** — the whole line goes, newline and all, so
  the lines below move up. At the end of a line trimming the tail would cut
  nothing, and a button that sometimes does nothing reads as broken.

A whole line is cut *with* its trailing newline, so pasting it back re-creates a
line rather than splicing it into the one the caret is on; a selection is cut
verbatim. The text goes out through `writeClipboard` (`src/ui/clipboard.ts`,
shared with the [copy row](#copy-scope)) and the write is deliberately
fire-and-forget — a refused or unavailable clipboard must not hold up the edit,
and [undo](#undo--redo) is right there.

After a whole-line cut the caret lands at the start of whichever line moved up
into the gap (or at the end of the new last line when the note's tail was what
went), which is what lets presses repeat: hold the button (or Ctrl+K) and lines
peel off one after another. A one-line note empties to a single blank line
rather than to no lines at all, and the edit runs through the same commit path
as typing — so it is one step on the [undo timeline](#undo--redo) and syncs like
any other edit.

Like the [styling toolbar](#styling-toolbar)'s buttons, the header button cancels
its own `mousedown`: the press must not blur the editing surface, or there would
be no caret left to cut at. In the [live-preview editor](#markdown-editor) a
press with no caret ever placed (an existing note opened but not yet tapped)
does nothing rather than guess at a line. Cutting something unlocks the
**Guillotine** achievement.

### Styling toolbar

`FormatToolbar` + `FormatToolbarButton` (`src/ui/FormatToolbar.tsx`) — a row of
one button per Markdown construct the app renders, brought up by the
`FormatToolbarButton` sitting top-right in the editor header (after the
[find bar](#find-in-note)'s magnifier, before the
[cut](#cut-button) and [export](#export) buttons). Pressing that button opens the toolbar; pressing it
again takes it away, and the choice is remembered across notes and reloads under
the `notes/format-toolbar` localStorage key.

The toolbar renders **inside the note's content column**, as a sibling ahead of
the editing surface — so opening it pushes the note's text down rather than
floating over it, and the line you were about to format is never the line it
covers. It aligns with the writing column ([editor margin](#editor-settings)) and
unfolds with the `format-toolbar-in` animation in `src/styles/theme.css` (a grid
`0fr → 1fr` track, so the text below slides rather than jumps).

Twenty constructs would be twenty buttons, which wraps to three rows on a
phone — so the families collapse into **menus** and the row carries nine
controls, which fits one line down to a 360px viewport:

| Cluster       | Controls                                                        |
| ------------- | ---------------------------------------------------------------- |
| Heading ▾     | menu — the six heading levels                                     |
| inline        | buttons — **bold**, *italic*, ~~strikethrough~~, `inline code`     |
| Block style ▾ | menu — bullet list, numbered list, checklist, quote, fenced code block |
| nesting       | buttons — outdent, indent (how a bullet becomes a **child**)       |
| Insert ▾      | menu — link, image, divider                                       |

The two most-reached-for families stay one tap: inline emphasis, and the
indent pair the nesting of list children depends on. A menu's trigger wears the
glyph of whichever member is currently applied — a caret on an H2 line shows
`H2`, lit, and names itself "Heading 2" — and its rows carry both the glyph
**and** the construct's name, which the bare icon buttons never could. The row
still wraps if it must (a very narrow viewport, a large font scale). The whole
toolbar is one stop in the keyboard order — `role="toolbar"` with a roving
tabindex, arrow keys walking the controls; a menu opened *from the keyboard*
(a click with `detail === 0`) moves focus onto its first row, since the panel is
portalled out of the row and Tab would otherwise sail past it.

Two behaviours make it usable rather than merely present:

- **It never takes focus.** Every button — and every menu row, and the header
  toggle — cancels its own `mousedown`, so the caret and any selection stay
  exactly where they were in the editing surface. Without that, pressing Bold
  would blur the editor and there would be nothing left to embolden.
- **It shows what is already applied.** The caret's position is classified by the
  same [parser](#markdown-parser) the preview renders from and reported up as a
  `LineFormat` (`onLineFormat`), so the heading / block trigger lights up (and
  adopts the applied member's glyph and name) when the caret sits on such a
  line — and every action toggles, so pressing a lit control takes the marker
  back off. Outdent is disabled at the left margin.

  That reaches **inside the line** as well as across it. The editing surface
  reports the caret's *columns*, not just its line, and `inlineMarksAt` walks the
  line's inline nodes for every run enclosing them — so Bold lights anywhere
  within `**…**`, Italic within `*…*` or `_…_`, Strikethrough within `~~…~~`,
  Inline code within `` `…` ``, with no selection needed. A caret in
  `**a *b* c**` lights Bold *and* Italic; a `***x***` wears both at once. The
  lit-means-removable promise holds because `applyInline` unwraps the very run
  the toolbar lit: a caret anywhere in `**hello there**` unbolds the whole
  phrase, and `***x***` gives up one mark per press (`*x*`, then `x`). A caret
  inside a fenced block lights nothing — that text renders verbatim, so there is
  no emphasis there to be inside of. A selection spanning lines lights nothing
  either, since inline emphasis can't cross a line boundary.

The edits themselves are pure: `applyFormat` (`src/domain/markdown-format.ts`)
takes the line array plus a `{ start, end }` pair of `SourcePoint`s and returns the
new lines and the selection to restore, so both editing surfaces share one
implementation and agree on what a press does. A block press (heading, list, quote,
indent) re-marks every line the selection touches, deciding once from whether *all*
of them already carry the marker — so a mixed selection moves as one block — and
replaces any existing marker rather than stacking on it (a bullet asked to become a
heading is `# item`, never `# - item`). Indent reads a blank line by where the
caret is: the caret's *own* blank line indents like any other, so the way to open
a child item is to press Indent on the empty row and start typing — but a blank
line caught in the middle of a **multi-line** selection keeps its left margin,
since there it is a separator between the blocks being indented rather than one of
them. An inline press wraps the selection, or the
word under a bare caret, and unwraps when it is already wrapped. A link press makes
the selection the label and hands back the `url` placeholder *selected*, ready to
type over — unless the selection is itself a URL, in which case it becomes the href.

`MarkdownEditor` applies the result through its own commit path and then installs
the selection: a same-line result comes back ranged (`placeRange` in
`contenteditable-caret.ts`), so bolding a word leaves it highlighted; a result
spanning lines drops the raw active line and draws a whole-line selection across
the line elements instead, which is what lets presses **chain** — bullet three
lines, then indent the same three into children. `PlainEditor` (Markdown rendering
off) runs the same formatter, converting between the textarea's flat offsets and
source points. The first press of any button unlocks the **Stylist** achievement.

### Find in note

`NoteFindBar` + `NoteFindButton` (`src/ui/NoteFindBar.tsx`) — a one-line search
bar for the note that is **open**, raised by the magnifier pinned to the far
right of the editor header (past the actions that change the note, because it
opens a bar rather than changing anything) — or by **⌘F / Ctrl+F**, which the
app takes from the browser while a note is open (see
[the find shortcuts](#the-find-shortcuts) below) — and rendered directly beneath
the header, in the content column, with the same
`format-toolbar-in` unfold the [styling toolbar](#styling-toolbar) uses. The two
are independent and can both be up at once; the find bar sits above, closest to
the header its button lives in. Opening it pushes the note's text down rather
than covering the line you were looking for.

This is deliberately **not** the cross-note [search modal](#search). That one
answers "which note mentions this" — fuzzy, wildcard- and regex-aware, over
every note's title and preview — and opens a result list. This one answers
"where in *this* note", and so matches the typed characters **verbatim and
case-insensitively**: a fuzzy hit has no span to highlight, and someone scanning
their own text expects the literal characters they typed, spaces and punctuation
included. `findMatches` (`src/domain/note-find.ts`) is the whole engine: a pure
scan returning every `NoteMatch` as `(line, from) → (endLine, to)` in the same
source coordinates the editor speaks — two ends rather than one, because a
[pattern can match across a line break](#n-in-find-and-replace). It compares through a case-insensitive `RegExp`
over the original text rather than lowercasing both sides, because a handful of
characters change *length* when lowercased (`İ` becomes two code units), which
would slide every later column out of step with the source being highlighted.

What the bar shows and does:

- the field, **focused on mount** — the host opens it inside the tap through
  `flushSync`, and the bar focuses in a layout effect, which together are the
  only arrangement that raises the soft keyboard on iOS for a programmatic
  focus (the same trick the side menu uses for the search modal);
- **every hit painted at once**, the one you're parked on in the accent and the
  rest in a quieter tint;
- **previous / next** arrows, wrapping at either end, with **Enter** and
  **Shift+Enter** doing the same from the field so a phone can walk the note
  from its own keyboard (`inputMode="search"` / `enterKeyHint="next"` label that
  key). The arrows cancel their `mousedown`, so stepping never drops focus — or
  the keyboard — out of the field;
- a **counter** — "3 of 12", or "No matches" — so wrapping past the last hit is
  legible rather than a mystery. It hangs **underneath** the arrows rather than
  sitting in the field: it is the widest fixture the bar carries and it never
  shrinks, so in the field it left a phone three or four characters of query to
  read. Under the arrows it costs the row no width at all and sits with the two
  buttons it describes. Its line is rendered even while the query is empty, so
  the bar doesn't grow by a row the moment the first character lands;
- a **`.*` toggle** that reads the query as a pattern — see
  [regex mode](#regex-mode);
- the **magnifier** in the field, which is also the disclosure for the second
  row — see [replace in note](#replace-in-note). On a
  [locked note](#lock-a-note) it goes back to being a plain label;
- **Escape**, the close button, or the header toggle puts it away.

The browser's own find bar ("find on page") is not reachable from a web page —
it can't be opened, positioned, or read, and there is no way to put its
prev/next arrows on a phone's keyboard accessory bar — so this is the app's own.

#### The find shortcuts

`src/ui/hooks/useFindShortcuts.ts` holds the **⌘F family** — the two shortcuts
that answer "search what I'm looking at", both taken from the browser's "find on
page" and split by Shift the way the app splits searching in two:

| Keystroke              | Opens                                  | Bound by           |
| ---------------------- | -------------------------------------- | ------------------ |
| ⌘F / Ctrl+F            | this note's find bar                   | the editor         |
| ⌘⇧F / Ctrl+Shift+F     | the cross-note [search modal](#search) | `SearchModalHost`  |

`useFindShortcut`, mounted by the editor, calls `preventDefault()` so the
browser's bar never opens: it is the wrong tool in a note, searching what the
Markdown *renders to* rather than what the note says, highlighting it somewhere
the app can't read back, with nothing to step it with on a phone.
`useSearchShortcut` is the same key held with Shift — the same question asked
wider, which is also how editors everywhere spell "search more than this file".
It lives on the modal's host rather than on the editor because searching every
note is a question you can ask from the list or the archive just as well as from
inside a note, and that host is mounted the whole time the app is.

Where they deliberately differ from [select all](#selection-mapping)'s shortcut,
which stands down inside every editable element: these fire **even while the
caret is in the note** (the likeliest place to press them from), because no
field-level "find" exists for them to trample. Both stand down while a modal is
up — `isModalOpen()` — so neither fires over the search modal itself or over
settings, and ⌥⌘F is left to whatever the platform binds it to.

Pressing it on an **already-open** bar does not close it (the header toggle is
what closes it): `openFind` bumps a `focusSignal` prop the bar re-focuses and
**selects** its query on, so a second press types a fresh search over the old
one — matching what ⌘F does everywhere else. Both the open and the refocus run
through `flushSync`, keeping the focus inside the gesture that asked for it,
which is what raises a soft keyboard on iOS.

The hits reach the live-preview editor as the `matches` / `activeMatch` props on
[`MarkdownEditor`](#markdown-editor), which cuts each into the per-line pieces a
line can paint (`matchLineSpans`), buckets those by line, and hands each
[rendered line](#rendered-line) only its own. `markSource`
(`src/ui/MarkdownLine.tsx`) splits a rendered run of source text at the hits
inside it and wraps each in a `<mark>`. Every emitted segment carries its **own**
`data-src`: the segments are siblings rather than nesting inside the leaf's span,
because [selection mapping](#selection-mapping) resolves a DOM position by
walking up to the nearest `data-src` element and adding the offset within it, so
a `<mark>` without one would land the caret (and any copied text) at the wrong
column. A link's rendered text can be *shorter* than its source (a
[shortened URL](#shorten-links)), so a hit overlapping one tints the whole anchor
instead of splitting it. A line with no hits keeps a shared empty list, so the
per-line memo bails out and an open bar costs nothing on the lines it doesn't
touch. Stepping onto a hit scrolls its line into view, leaving an
already-visible one alone.

Only the raw **active line** goes unpainted — it renders as verbatim source
rather than through `RenderedLine`. In practice it never has to be: focusing the
find field blurs the editing surface, which drops the active line, so the whole
note renders formatted (and highlighted) while you search.

The Markdown-off fallback is a plain `<textarea>`, which can carry no per-match
markup, so there the current hit shows as the field's **own selection** — from
its start point to its end point, across a line break if it spans one (the
browser paints it greyed while unfocused) — and its line is scrolled to. Every hit
is still counted, so the counter stays honest; focus is restored afterwards in
case the browser moved it on `setSelectionRange`.

The query is **not** remembered across notes the way the toolbar's open state is
— a query is about the note you were reading, so the next note starts clean. The
replacement, the regex switch and the preview go with it, for the same reason.
Opening the bar is the **Pinpoint** achievement.

### Regex mode

The **`.*` toggle** beside the search field (`NoteFindBar`,
`src/ui/NoteFindBar.tsx`) stops reading the query as literal characters and
hands it to `RegExp` as typed. It wears the pattern it turns on rather than a
drawn glyph — `.*` is the smallest thing the feature *is*, and someone who wants
it recognises it on sight while someone who doesn't reads it as punctuation and
leaves it alone. It sits *beside* the field rather than inside it: inside, it
read as part of the match counter it sat against, and a counter is a readout
where this is a control.

Everything else about the scan is unchanged, which is the point:

- `^` and `$` still anchor to a **line** rather than to the note (the scan runs
  over the whole body with the `m` flag, which is how a code editor's find
  widget reads a pattern), and `.` still never swallows a line break — but `\n`
  matches one, so a hit *can* span lines. See
  [`\n` in find and replace](#n-in-find-and-replace);
- it is still **case-insensitive** — the bar is one search field, not a settings
  panel, and the promise it makes ("case doesn't matter here") shouldn't flip
  with a toggle about something else;
- **zero-length matches are dropped.** A literal query can't produce one, but
  `x*` matches the empty string at every column; there is no span to highlight,
  step onto or replace, so `findHits` skips past them (`domain/note-find.ts`).

A pattern that doesn't compile is the state most of a regex's keystrokes pass
through, so it is reported rather than treated as "no matches": `isPatternValid`
answers it, the field's ring turns `danger`, and the counter's slot reads
**Invalid**. One word, deliberately — the full sentence is the hover title,
because a phrase in that slot pushes the half-typed pattern it is about out of
sight.

Regex mode is also what makes `$1` mean anything in a replacement — see
[replace in note](#replace-in-note). Turning it on is the **Pattern seeker**
achievement.

This is **not** a [Transform](#transforms) rule, which also takes a regular
expression: a Transform rewrites what a note *shows* and never touches what it
stores, is persisted in the appearance store, and runs on every line forever.
This one is a search you typed, it lasts as long as the bar is open, and the
replace buttons beside it change the note for real.

### Replace in note

**The magnifier inside the search field** unfolds the bar's second half: a
replace field and the three buttons that act on it (`NoteFindBar`,
`src/ui/NoteFindBar.tsx`; the state and actions `replaceOpen`, `replacement`,
`runReplace`, `runReplaceAll` in `src/ui/NoteEditor.tsx`). It starts at the same
left edge as the search field — there is nothing to indent past — so the two
fields read as one stacked control and the buttons sit in the same three columns
as the arrows above them.

The disclosure is the **field's own leading glyph**, and its *face* is the state:
a magnifier while the bar only finds, the replace arrows once it can also write.
Folding it into a glyph the field already carried costs the row no width at all,
which on a phone is the whole budget — but it is a less discoverable affordance
than the chevron other editors put there, so the glyph carries a hover title, an
`aria-expanded`, and a lit chip behind it while open. The replace field below
deliberately carries **no** leading glyph: the search field's arrows already say
which mode the bar is in, and repeating them would put the same picture on both
rows while leaving the placeholders to say which field is which anyway. Both halves share **one query**, so the search already
typed is the one replace acts on and nothing has to be re-entered to cross over.

- **Replace** (`⇄`) rewrites the hit the bar is parked on and steps to the next.
- **Replace all** (`⇄` with trailing dots) rewrites every hit in one pass.
- **Preview** (the spectacles) writes nothing — see
  [replacement preview](#replacement-preview).

**Enter** in the replace field replaces the current hit and steps on, so a run
of them is one key held down; **Ctrl/Cmd+Enter** does the lot. Unfolding the row
moves the caret into the field it just revealed, since the press that opened it
said what the user wants to type next — but not on the bar's first render, where
the *search* field owns the focus even if the row came up already open.

`domain/note-replace.ts` is the engine, pure and shared with the preview so what
the panel promises and what the buttons apply cannot drift:

- **`replaceAll`** rebuilds the body left to right **from the original text**,
  so inserted text is never itself matched (`a` → `aa` terminates rather than
  feeding on its own output) and the offsets stay in step as the note's length
  changes underneath. It works in flat body offsets rather than per line,
  because a hit may cross a line break and a replacement crossing one is just
  an ordinary splice.
- **`replaceOne`** rewrites one hit and then re-scans the *rewritten* body to
  find the first hit at or after the text it just inserted. That is what makes
  pressing Replace repeatedly walk the note rather than stall: a replacement
  that matches the query again leaves a hit exactly where the cursor was, and
  stepping past it is the only reading that terminates. It wraps to the first
  hit when it replaced the last, and reports `-1` when nothing is left.
- A replacement is inserted **verbatim** in literal mode — replacing with `$1`
  writes those two characters, because a literal search promises that what you
  typed is what you get on *both* sides of it. In [regex mode](#regex-mode) the
  template expands `$&`, `$1`…`$99`, `$<name>` and `$$`. That expansion is not
  reimplemented here: it is `expandReplacement` (`domain/transform.ts`), which
  already speaks the grammar for the [Transform](#transforms) rules — one
  grammar, one implementation. Regex mode also resolves the backslash escapes
  `\n`, `\r`, `\t` and `\\` first, so a replacement can write a line break —
  see [`\n` in find and replace](#n-in-find-and-replace).

**A replace is always one undo**, however many lines it touched. It writes
through `replaceBody` (`src/app/use-notes.ts`) rather than the editor's ordinary
`update`, which coalesces continuous edits: a replace-all landing right after a
typing burst can share that burst's merge key and be swallowed by it, so undoing
the replace would take the typing with it. `replaceBody` commits with no merge
key at all, which also breaks the chain for whatever is typed next.

**The whole half is withheld on a [locked note](#lock-a-note)** — the magnifier
goes back to being a plain label and there is no row to open — alongside the styling toolbar, the cut button and the title field.
Finding still works there, because reading a locked note is what locking it is
for. Landing a replace is the **Swap meet** achievement.

### `\n` in find and replace

With [regex mode](#regex-mode) on, `\n` is a **real line break** on both sides
of the find bar — the same reading a code editor's find widget gives it, which
is what people arriving from VS Code expect and the reason the feature exists.

**In the query.** `compilePattern` compiles with `gim` and `findHits` scans the
**whole body** in one pass rather than line by line (`domain/note-find.ts`). The
`m` flag is what keeps `^` and `$` meaning the edges of a *line* — a note-taker
searching `^#` means the start of a line, not of the note — while `.` still
never swallows a break. So `\n\n` finds every blank line between paragraphs,
`,\s*\n` finds a comma left hanging at the end of one, and `\n- \[ \]` finds
every checklist item after the first.

A hit can therefore **end on a different line than it starts on**, which every
surface that draws one has to honour:

- `NoteMatch` carries `endLine` beside `line`, and `to` is a column on
  *`endLine`*.
- `matchLineSpans` cuts a hit into the per-line pieces a rendered line can
  paint: the start line from the hit's column to its end, whole lines in the
  middle, the last line up to the hit's end column.
  [`MarkdownEditor`](#markdown-editor) buckets those, not the hits themselves.
  **Empty spans are dropped** — the `\n` a hit swallows lives past the end of a
  line's text, so a search for a bare line break counts and steps like any other
  hit while highlighting nothing. A `<mark>` of zero width would paint the same
  nothing with more machinery.
- The Markdown-off `<textarea>` sets its selection from the hit's start point to
  its end point, and a textarea selection crosses a break happily.
- [The preview](#replacement-preview) folds the lines a hit spans into one row.

**In the replacement.** `expandTemplateEscapes` (`domain/note-replace.ts`)
resolves `\n`, `\r`, `\t` and `\\` before `expandReplacement` runs the `$`
grammar over the result. The order matters: a capture pasted in by `$1` is
inserted as it stood in the note rather than being re-read for escapes of its
own, so text that literally contains a backslash and an n survives a round trip.
It exists because the replace field is a single-line `<input>` — there is no
keystroke that puts a break into it, so an escape is the only way to ask for
one. Replacing every `·` with `\n- [ ] ` turns a run-on list into a checklist in
a single press.

**None of it applies to a literal search.** There `\n` is a backslash and an n,
exactly as typed, on both sides — the literal promise is that what you typed is
what you get, and quietly reading two of those characters as something else
would break it. The `.*` toggle governs both fields at once.

Landing a replacement that crosses a break — a hit that matched one, or a
template that writes one — is the **Line breaker** achievement
(`crossesLineBreak` in `src/ui/NoteEditor.tsx`).

### Replacement preview

The **spectacles** in the replace row (`PreviewPanel`, `src/ui/NoteFindBar.tsx`)
unfold a panel showing what the replacement *would* write — and write nothing.
Deliberately not an eye: the app already spends that glyph on the editor's
[read-only lock](#lock-a-note), and the two would sit centimetres apart on one
screen meaning different things.

`previewReplacements` (`domain/note-replace.ts`) returns one entry per affected
line — untouched lines are left out entirely, so a long note changed in two
places is two rows rather than a wall of context — each as a run of `kept` /
`removed` / `added` segments. A hit that spans a line break makes its lines
**one** entry rather than two halves, carrying `endLine` so the row is numbered
as a range (`23–24`); the break it swallows sits inside the `removed` run, and a
break the replacement *writes* sits inside the `added` one, both drawn where
they would land. The panel draws them **in place**: the line
numbered the way the [gutter](#line-numbers) numbers it, the text each hit takes
away struck through in `danger`, and the text arriving lit in the accent right
beside it, so the change reads in the context of its line rather than as a pair
of before/after blocks. An empty run is never emitted, so replacing with nothing
yields a `removed` with no `added` next to it.

Above the list is the **scope** — "Preview: 3 matches on 3 lines" — because "how
much of my note does this touch" is the question the preview exists to answer,
and it stays answered even when the list is truncated. `PREVIEW_LIMIT` caps the
drawn rows at 40 and says how many more there are: a replace-all over a long
note can touch hundreds of lines, and a panel that long is a wall, not an
answer.

Folding the replace row away takes the preview with it — it describes an edit
whose controls just left the screen — and unfolding the row again does not bring
it back on its own. Opening it is the **Dry run** achievement.

### Collapsed header actions

`Editor` (`src/ui/NoteEditor.tsx`) — under `COLLAPSE_QUERY`
(`max-width: 639px`, Tailwind's `sm` breakpoint from the other side) the
editor header stops trying to carry the note's name *and* the six-button
action cluster ([favorite](#favorites), [lock](#lock-a-note),
[formatting](#styling-toolbar), [cut](#cut-button), [export](#export),
[find](#find-in-note)) at once — five of them in a narrow window on a desktop
pointer, which gets no [cut button](#cut-button), and four on a
[locked note](#lock-a-note), which gets neither cut nor formatting. The cluster folds behind a single **⋯ button** (`MoreButton`, wearing `MoreIcon`
from `src/ui/icons.tsx`) pinned to the right of the row; the title gets the
whole width back. Pressing ⋯ unfolds the buttons *over* the title — the title
field is taken out of the row with `display: none` while they are out, because
the note itself is right below to say which note this is.

The unfold is one CSS transition on the box holding the buttons:
`max-width` from `0` to `ACTIONS_MAX_WIDTH`, plus `opacity`, plus
`visibility`. The box is right-anchored and clips what doesn't fit yet, so
growing it walks its content leftwards and the buttons read as unfolding out
of the ⋯ itself. `visibility` is the third property for a reason that isn't
cosmetic: it flips to `hidden` only at the *end* of a transition (the one
discrete property CSS defines that way), which keeps the closing slide visible
while it plays and still leaves the folded-away buttons out of the tab order
and off screen readers the rest of the time. Reduced motion drops all of it to
a jump through the global rule in `src/styles/theme.css`.

When even the unfolded row is wider than the screen — a touch pointer's cut
button plus a [pinned](#pinned-header-state) readout can push it past a small
phone — the box shrinks to what fits instead of shoving the ⋯ off the right
edge, and becomes a sideways **scroller**: the excess hangs off its *left*
edge, next to the back arrow, and is reached by swiping the row. The left
anchor is the box's `dir="rtl"` — an RTL scroll container starts scrolled to
its inline start, the right, and lets overflow extend leftwards, which a plain
LTR flex row cannot (start-side overflow is unscrollable) — with an inner
`dir="ltr"` row keeping the buttons in reading order. The scroller draws no
scrollbar (`.no-scrollbar`, `src/styles/theme.css`), like any horizontal strip
on a phone.

Three things close it again:

- **Pressing ⋯ a second time** — it carries `aria-expanded` and the same
  lit-when-open treatment as the formatting and find toggles.
- **Going back to the note** — `collapseActions` is wired to the content
  area's `onFocusCapture` *and* `onPointerDownCapture`, so a tap into the
  writing surface (or focus arriving anywhere below the header, including the
  find field) hands the title back. This is what makes the row a detour rather
  than a mode: you never have to dismiss it.
- **Widening past the breakpoint** — every action is back in the row on its
  own, so the held-open flag is dropped.

A **selection** opens the same box on its own — see
[selection actions](#selection-actions) below. Three of the buttons can also
stay out of the fold on their own account — see
[pinned header state](#pinned-header-state).

Like the [find bar](#find-in-note) and unlike the
[styling toolbar](#styling-toolbar), the open state is **not** remembered:
every note, and every return to a note, opens showing its title. The ⋯ cancels
its own `mousedown` the way the rest of the cluster does, so unfolding the row
never costs the caret the buttons behind it are about to act on. While the
cluster is folded away the editor's [tab order](#editor-tab-order) treats
whatever is actually on the row as the header's first action (`firstAction`) —
a [pinned](#pinned-header-state) star, eye or select-mode toggle, and the ⋯ when
nothing is pinned
— so Tab out of the body lands on a control that is really there. Unfolding it
the first time is the **Elbow room** achievement.

### Pinned header state

`Editor` (`src/ui/NoteEditor.tsx`) — `pinFavorite` / `pinLocked` /
`pinSelectMode`, `pinnedRef`.
Three of the cluster's buttons don't only *do* something, they **say** something
about the state the user is in: a lit star means this note is in
[Favorites](#favorites), a lit eye means it is
[read-only](#lock-a-note), and a lit [select-mode](#select-mode) toggle means
the note is taking line presses rather than a caret — all three filled to the
edges with the accent, so the row's readouts look like one another. Folding
those behind the ⋯ turned a fact about the
open document into something the user had to go looking for — and the eye
especially, because "why is my typing not landing" is the exact question the
glyph exists to answer.

Select mode is the one where folding it away is worse than merely inconvenient:
while the mode is up the note takes no caret at all, so the lit toggle is the
**only** way back out of it on a phone (the editor's other exits are Escape and
a press that consumes the run — a keyboard, and a gesture that is itself part of
the mode). Behind the ⋯ that is a state entered in one tap and left in two, on a
button the ⋯ gives no hint is still in there. It pins **last**, nearest the ⋯:
that is where it already sits in the unfolded row, past the actions that operate
on the note, so pinning never moves it either. Like the other two it is a live
readout — the press that leaves the mode is the press that unpins it — and it is
never pinned on the Markdown-off plain textarea, where the toggle isn't offered
at all.

So on a narrow header each of those, **while it is on**, steps out of the
sliding box and pins to the row between the cluster and the ⋯, in its own
small flex box (`pinnedRef`, carrying the same `pr-2` the cluster does because
the row's own `gap-2` is off at this width). It is rendered *once* — pinned out
there instead of inside the box, never in both places — so nothing is
duplicated and the [max-width caps](#collapsed-header-actions) simply travel to
a stop the narrower box doesn't reach. It sits to the **right** of the cluster
on purpose: that is where it ends up when the row unfolds past it, so pressing
⋯ never shuffles the pinned glyphs around. Off, a button has nothing to report
and folds away with the rest, and a **wide** header pins nothing at all — every
action is already in the row there.

The pin is a **live readout**, not a latch: it follows the note's current state
in both directions, so unstarring or unlocking from the pinned row folds that
button straight back behind the ⋯. There is deliberately no grace period for a
second press — the row is meant to answer "what is set on this note?" at a
glance, and a star left sitting there on a note that is no longer starred
answers it wrong. Turning the setting back on is one ⋯ away.

### Selection actions

`Editor` (`src/ui/NoteEditor.tsx`) — highlighting text on a phone is the moment
the actions that operate on a selection are wanted, so under
`COLLAPSE_QUERY` the [collapsed cluster](#collapsed-header-actions) unfolds
**itself** then, carrying just the ones that act on one: the
[formatting](#styling-toolbar) toggle, the two [line-move](#move-lines)
chevrons (whenever the selection covers whole lines), [cut](#cut-button) (on a
touch pointer — see the cut button), a
[copy](#copy-scope) button that takes the highlighted text and nothing else,
and — while [select mode](#select-mode) is on — a `DeleteLinesButton` that
takes the picked lines out of the note, the one verb an ordinary text selection
has no use for.
Reaching them through the ⋯ was two taps for something the user had already
asked for by highlighting it.

[Select mode](#select-mode) opens the same box (`picking`) and keeps it open
for as long as the mode is on, whatever is or isn't picked — and there the row
is *only* these verbs: the star, the eye, the export menu, find and the ⋯ all
stand down, and cut and delete drop their touch-only gate, because the mode's
four verbs are the whole point of the row while it is up.

It is **the same box on the same slide** as the ⋯ unfold — one element whose
contents depend on the mode (`selecting` / `picking`), travelling to
`SELECTION_MAX_WIDTH` rather than `ACTIONS_MAX_WIDTH` — not a second panel. That
is what makes the ⋯ behave the way it always has over a selection: pressing it
simply widens the row that is already out into the full five, because
`actionsOpen` wins over `selecting`. Over a *select-mode* row it wins over
nothing — there is nothing else to show — so the ⋯ isn't offered at all there.
Otherwise it never goes away, and letting the selection go folds the buttons
back and hands the note's name back.

Two things it deliberately does not do: it does not appear on a wide header
(every action is in the row there already), and it stands down while the
[find bar](#find-in-note) is open, where a selection belongs to the search
rather than to the note. Neither applies to select mode, which trims the wide
header down to its verbs the same way it trims the narrow one.

**Who decides there is a selection.** Both editing surfaces report it —
`onSelectionChange`, deduped through a ref so `selectionchange` firing on every
keystroke costs one boolean comparison. A second answer rides the same call,
`onWholeLineSelection`: whether what is selected is whole lines and nothing
else, which is what the [line-move](#move-lines) chevrons wait for. The two
always change together — every path that gains or loses a selection knows in the
same breath what shape it is — and a selection going away settles both. The live-preview editor
(`MarkdownEditor`) reports from the `selectionchange` handler it already runs,
and only when **both** endpoints are inside its surface, because a drag that
ran out of the note can't be mapped back to source (see
[selection mapping](#selection-mapping)); the plain fallback reports from
`trackCaret`. Each takes its report back down (`false`) when it unmounts — a
note switch, or Markdown being turned off — and after a cut, whose collapsed
caret is one the surface sets itself and therefore ignores.

[Select mode](#select-mode) reports the same way while it is on — its run of
taken lines is a selection as far as the header is concerned, which is what puts
cut and copy on a phone's header — and, because the ordinary reporter stands
down while the mode is up, it also owns saying so when the mode ends. That
matters most for the exits the editor is never asked about: the header's own
toggle and a note switch are the host flipping its `selectMode` flag, not a
gesture the editor sees, and the mode leaves the caret collapsed and hidden so
no `selectionchange` follows to correct the record. Reported false there, or
these three buttons stay pinned out over a note with nothing selected, and the
dedupe ref latches them there until something reports a selection again.

**What copy copies.** `runCopy` asks the mounted surface for its selection
(`selection()` on either handle) and puts *that* on the clipboard — the note's
**source**, so copying a heading out of the live preview yields `# Heading`
rather than the rendered line, the same as Ctrl/Cmd+C there. Copying the
*whole note* stays where it has always been, the export menu's "Copy to
clipboard" row with its [copy scope](#copy-scope): this button exists only
while there is a selection, so it can never take more than what is
highlighted. It confirms with the tick-and-`Toast` pair the export row uses,
because a copy is otherwise silent. The first unfold is the **Sleight of
hand** achievement.

### Move lines

`MoveLinesButton` (`src/ui/MoveLinesButton.tsx`), `moveLines`
(`src/domain/line-edit.ts`) — two chevrons immediately right of the
[formatting](#styling-toolbar) toggle that shuffle the selected lines one row up
or down the note, and the **Alt+↑ / Alt+↓** every code editor binds. Reordering a
list is otherwise a cut and a paste with the caret aimed twice; this is one press
per row, repeatable, with the lines staying selected so the second press carries
on where the first left off.

**What moves.** `moveLines` takes a *set* of line indices, not a range, because
that is what [select mode](#select-mode) holds. Each unbroken run in it moves on
its own: three scattered lines each swap with their own neighbour rather than
dragging everything between them along. Runs are maximal, so the line a run
swaps with is never part of another run and the moves can't collide — which is
why they need no reconciliation between them. A run already against the edge it
is travelling towards simply stays put (its neighbours still move), the way a
code editor parks the top line rather than wrapping it to the bottom; when
*nothing* could move the result is `null` and the source — and the undo timeline
— is left alone. The note never grows or shrinks: the displaced line hops over
the block to the other side.

**When the buttons appear.** Only while the selection covers **whole lines**.
Select mode's runs always do, so there the chevrons ride the header for the
whole of the mode beside its four verbs, for the same reason those do — the row
a press lands in must not shuffle under the finger between one pick and the next.
An ordinary selection qualifies when it starts at the head of a line and stops at
the foot of one; an end parked at column 0 of a *later* line counts too, since
nothing on that line is highlighted (`wholeLineSpan`, in both surfaces). A
selection holding one line and the first word of the next does **not**: moving
that second line whole is not what the highlight promised. They fold away with
the writing tools on a [locked note](#lock-a-note), through the same
`WriteAction` slide.

**The keyboard is the code editor's, not the buttons'.** Alt+↑ / Alt+↓ answers
wherever the caret is: with a whole-line selection it moves that block, with a
selection that stops mid-line it moves every line the selection touches (and
hands it back drawn over those lines whole, because the move is a whole-line
operation whatever columns it was measured in), and with a bare caret it moves
the caret's own line and rides along with it. That last case has no button: a
chevron offered over an untouched note would be a control with nothing named on
screen for it to act on.

**Both surfaces, one engine.** The live-preview editor and the plain textarea
each expose `moveLines` on their handle and reorder through the same pure
`moveLines`, so the two agree on what a press does. They differ only in how the
selection is put back: select mode re-takes the lines at their new indices
(it paints its own run), the live-preview editor queues the span for the layout
effect that owns `pendingLineSpan` — the same handover a multi-line block format
does — and the textarea installs the offsets through `pendingSelection`. The
first move that actually reorders something is the **Shuffle up** achievement.

### Editor position memory

`src/ui/editor-position.ts` — a **session-scoped** memory of where the caret sat
and how far the editor was scrolled in each note, so switching away and back
reopens the note exactly where you left it (same line and column, same scroll
offset) instead of at the top with no caret. It is a plain module-level
`Map<noteId, EditorPosition>` — deliberately **in-memory only**, never
`localStorage`: it remembers *where you were looking this session*, transient
view state that resets on a fresh load, unlike the persisted note document or the
per-reload [active-note cursor](#active-note-cursor). The caret is stored as a
source `(line, column)` `SourcePoint`, one shape both editors share; the plain
textarea converts to/from a flat character offset with the pure `offsetToPoint` /
`pointToOffset` helpers (both clamp, so a point saved against a body that later
changed can never overshoot).

Both editors (`MarkdownEditor` and the Markdown-off `PlainEditor`) key their copy
by the note id (threaded from `Editor` as `noteId`) and are keyed by note id in
`App`, so a switch remounts them: on **mount** each reads its remembered spot and,
when a caret was stored, seeds the active line + caret column and focuses the
surface (which raises the soft keyboard on phones so the caret lands in place),
then restores the scroll offset; on **unmount** each writes the latest caret
(tracked on every edit / caret move / `selectionchange`) and scroll offset back.
A note that was only viewed, never given a caret this visit, stores `caret: null`
— then only the scroll is restored and the note stays fully formatted (keyboard
down). On mobile the keyboard shrinks the visual viewport *after* focus, so with a
caret restored the editor nudges the caret's line into the smaller band via
[`scrollFocusedIntoView`](#viewport-height)'s `ifHidden` mode — which only scrolls
when the keyboard actually covers the caret, leaving the restored scroll untouched
otherwise. Landing back where you left off (a restore that replaces a remembered
caret) unlocks the **Right where you left off** achievement
(`unlock("whereYouLeftOff")`).

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

### Dropzone

A **dropzone note** is a deliberately temporary note whose only purpose is
handing a scrap of text to your *other* devices — a link, an address, a
confirmation code. You write it here, it syncs, you pick it up there and tick it
off. It is the one note in the app that is meant to be thrown away.

**Making one.** Press and hold any "new note" button: the overview's floating
"+" (`NoteList`) or the side menu's **New note** cell (`SideMenuActionBar`). An
ordinary press still makes an ordinary note; the hold is a second action laid
over the same button by `useLongPress` (`src/ui/hooks/useLongPress.ts`), which
fires after 500ms of holding *still* (more than 8px of movement is a scroll or a
drag, the same rule the [note drag](#note-drag-touch--pointer) uses, which is
what lets both live on one screen), taps the haptics, and swallows the click a
touchscreen delivers behind the hold so the gesture can't also make an ordinary
note. `App.openDropzone` then drops the throwaway note we're leaving, the way
`openNew` does, and opens the new note in the editor.

**It does not hold the save,** and that is load-bearing rather than an omission.
`openNew` calls [`holdSaves`](#save-hold) so a fresh note's file isn't written
under a throwaway default title and renamed a moment later; the hold is lifted
by the title field settling. A dropzone note is born bearing its final name, so
there is no rename to wait for — and, crucially, its title field never takes the
mount focus (`titleFirst` keys off `isBlank`, and a note with a title isn't
blank), so it never blurs and the hold would only lift when the editor
unmounted. Holding here would keep the note, and every keystroke in it, out of
the backend for exactly as long as it was open — on a synced backend, precisely
the window in which it is supposed to be reaching the other device.

For the same reason the editor opens with the caret in the **body**: `bodyFirst`
(`src/ui/NoteEditor.tsx`) takes the mount focus for a dropzone note with an empty
body, so the surface whose whole point is speed opens ready to paste, with the
soft keyboard already up, instead of with nothing focused at all.

**Only where it means something.** The whole feature is gated on
`isSharedBackend` (`src/storage/backend-preference.ts`): every backend except
the browser store, whose `localStorage` no other device can read. Below that
gate `onNewDropzone` / `onAddDropzone` are simply `undefined`, so the buttons
are exactly what they were and nothing can put a note in the section. A picked
folder counts — the app cannot tell a plain directory from one a desktop sync
client is watching, and the folder backend is how notes runs over
Dropbox/iCloud/Syncthing on the desktop.

**The timestamp is the name.** `createDropzoneNote` (`src/domain/note.ts`) names
the note after the moment it was made — `dropzoneTitle`, the same
`YYYY-MM-DD HH:mm` local-time form the `dateTime` [default title](#default-title)
uses. That name is *derived* from `createdAt` rather than remembered anywhere, so
`isDropzoneNamed` can tell "still the timestamp" from "the user named it" at any
later moment, on any device, after any reload — which is what both of the
lifecycle rules below hang on.

**Where it is listed.** In its own **Dropzone** section at the top of the side
menu, above [Favorites](#favorites) — the most perishable thing in the drawer,
a hand-off you are on your way to collect. It is fed by `dropzoneNotes`
(newest-created first) through the store's `dropzone` list. Unlike Favorites,
the notes in it appear *only* there: `useNotes` filters dropzone notes out of
`notes`, so the overview and the drawer's Notes list never fill up with scraps.

The rows are the **same rows as everywhere else** — `renderNoteRow`
(`src/ui/SideMenu.tsx`) takes a `dropzoneRow` flag that swaps the leading glyph
for the tray (`DropzoneIcon`), drops the archive action (ticking a hand-off off
deletes it; there is nothing to file away) and drops the drag (it belongs to no
folder, and filing it would defeat the point of the section). Deliberately not a
second row component: one shape means one thing to keep working, and a row that
renders everywhere else renders here. `SwipeToRemove` takes `onArchive` as
optional for it and still draws the archive backdrop it can never uncover —
`useSwipeReveal` clamps a right swipe to 0 without a handler — so an
un-archivable row's box is identical to an archivable one's.

`SideMenu` builds those rows *before* the section and renders the heading from
`dropzoneRows.length`, so "a heading with nothing under it" is not a state the
component can reach: the thing that decides the heading is the thing that is
listed.

**Ticking it off.** A dropzone note's editor grows one extra control: a floating
checkmark where the overview's "+" sits, the only floating button the editor
ever renders (`onDropzoneDone`, `src/ui/NoteEditor.tsx`). Pressing it **deletes**
the note. Not archives — a hand-off you have collected is not something to keep,
and an archive slowly filling with yesterday's wifi passwords is exactly the
mess the section exists to avoid. The deletion is an ordinary `remove`, so
[undo](#undo--redo) brings it back if the press was a mistake.

Because that press also drops the user back on the overview — the note simply
vanishes — a **toast** confirms it: `DropzoneDeletedToast`
(`src/ui/DropzoneDeletedToast.tsx`), hosted by `App` beside `UpdateToast`
(the editor that took the press unmounts in the same gesture), floats "Dropzone
note deleted" with an **Undo** button for about five seconds. The button is
plain timeline [undo](#undo--redo) — right after the press the last change *is*
the deletion — which is also why the window is short: the longer it lingers,
the more room for another edit to slip in and make the button restore the
wrong thing. The pill itself is the shared `Toast` (`src/ui/Toast.tsx`), which
grew an optional trailing `action` button for this; the pill stays
click-through, only the button catches presses.

**Keeping it.** Sometimes a scrap turns out to be worth keeping, and the gesture
that says so is naming it: nobody titles something they are about to throw away.
So when the title field settles (`onTitleSettle` now carries the committed
title, because the document does not yet) on a dropzone note whose name is no
longer its timestamp, `App` raises `DropzoneKeepModal` — "Save as a regular
note?". Answering yes runs `useNotes().keepDropzoneNote`, which clears the flag
(`setDropzone(note, false)`) on the shared `DOC_SCOPE` timeline, through
`withBody` so a deferred note on an [encrypted backend](#encryption) is loaded
first and the cleared flag reaches its `.enc` file; the note keeps its id, its
text and its new name and simply joins the ordinary list. Dismissing is a real
answer rather than a cancel — the note keeps the new name and stays in the
Dropzone — and `App` remembers it for that note so a second visit to the title
field doesn't nag. The prompt resolves its note fresh on every render, so a note
ticked off (or already promoted) between the rename and the answer takes the
question away with it.

**Abandoning one.** An empty dropzone note still wearing its timestamp is
`discardable` (`App`) on exactly the same terms as a never-typed ordinary note,
so backing out of one leaves nothing behind. It needs no `pristineNew` bookkeeping
to know that, because the name it was born with is derivable — which means the
rule survives a reload too.

**Persistence.** `Note.dropzone` is absent rather than `false` on an ordinary
note, so no migration was needed, and it rides every storage shape on the same
terms as `favorite`: `dropzone: true` in the markdown frontmatter
(`storage/markdown/codec.ts`), a field on the encrypted note JSON
(`enc-note-codec.ts`) and on the [note index](#encryption) row
(`note-index.ts`), and a defensive `=== true` check in `parse`
(`storage/serialize.ts`). It has to survive all four: a flag lost in transit
would resurface the note among the ordinary notes on the other device.

The **Dropzone** achievement (`dropzone`) fires from `createDropzone`; the
**Finders keepers** achievement (`keeper`) from `keepDropzoneNote`.

### Favorites

Starring a note lifts it into the side menu's **Favorites** section without
moving it: it keeps its folder, its place in the recents list, and everything
else about it. The star is the leading button of the editor header
(`FavoriteButton`, `src/ui/FavoriteButton.tsx`, drawing the framework's
`StarIcon`). Starred, it lights the *whole* button: the accent fills it edge to
edge and the star is knocked out of it in the page colour — the inverted
treatment the [eye](#lock-a-note) wears, so the two facts the header reports
about the open note read alike rather than one being a lit chip and the other a
slightly heavier glyph. The artwork still swaps outline→filled with the state,
which is what keeps the star legible once it paints in the background colour.
A lit star stays on the row on a phone rather than folding behind the ⋯, see
[pinned header state](#pinned-header-state); `App` routes
its press to `useNotes().toggleFavorite`, which flips `Note.favorite`
(`setFavorite`, `src/domain/note.ts`) on the shared `DOC_SCOPE` undo timeline —
structural, like archiving, because it changes where a note shows up rather than
what it says. `updatedAt` is deliberately left alone so starring never jumps a
note to the top of the recents, and the toggle runs through `withBody` so a
deferred note on an [encrypted backend](#encryption) is loaded first and the flag
actually reaches its `.enc` file.

The flag is absent rather than `false` on an unstarred note, so no migration was
needed and every persistence layer carries it on the same terms as `archived`:
`favorite: true` in the markdown frontmatter (`storage/markdown/codec.ts`), a
`favorite` field on the encrypted note JSON (`enc-note-codec.ts`) and on the
[note index](#encryption) row (`note-index.ts`), and a defensive
`favorite === true` check in `parse` (`storage/serialize.ts`) so a junk value
drops the flag instead of reading as truthy.

`favoriteNotes` (`src/domain/note.ts`) is what the section lists: everything
starred that isn't archived — an archived note is out of sight by definition, so
it leaves Favorites too and the star comes back with it on restore. The section
is drawn by `SideMenu` above the **Notes** heading and hides itself entirely
while nothing is starred (an empty heading is noise in a drawer this dense, and
the star button is where the feature is discovered). Each row is a full note
row, so swipe, right-click and drag behave exactly as they do in the list below.

By default the section flattens the folder hierarchy away — a favorite is a
shortcut, and where it is filed is precisely what the section sets aside. The
`favoritesShowFolders` appearance setting (default **off**, Settings →
Appearance → Sidebar) reproduces it instead: `groupFavoritesByFolder`
(`src/domain/note.ts`) buckets the starred notes under the folders that hold at
least one of them — sorted by the active `noteSortKey`, with the ungrouped run
last — and each bucket is headed by `FolderLabelRow`
(`src/ui/SideMenuRows.tsx`), a caption with no behaviour behind it. It is
deliberately not a `FolderRow`: there is nothing to expand (the run below it is
already every starred note in the folder), nothing to drop onto, and no rename /
delete — the Notes section stays the one place a folder is managed. A note
pointing at a folder the registry no longer carries counts as ungrouped, the
same way the rest of the drawer treats a stale link.

The **Star-struck** achievement (`starStruck`) derives from the first note in
the document gaining the flag.

### Lock a note

A **locked** note is read-only. Its toggle sits beside the star in the editor
header (`LockButton`, `src/ui/LockButton.tsx`), wearing an **eye** — `EyeIcon`
(`src/ui/icons.tsx`), filled in the accent colour while locked so the state is
visible at a glance. Deliberately *not* a padlock: this app already spends that
glyph on [encryption at rest](#encryption) (the `LockIcon` on an encrypted note's
card), and two padlocks standing for two unrelated features on one screen read as
one feature with a confusing second state. An eye says what this lock actually
does — you may look, not touch — and keeps it from being mistaken for a secrecy
feature, which it is not. There is only the one glyph, because no second eye
means "editable" without also meaning "hidden"; the state rides the accent fill
instead, the treatment the ⋯ / find / formatting toggles use for "this mode is
on". The same eye stands in for the document glyph on the note's
[side-menu row](#side-menu) (`renderNoteRow`, `src/ui/SideMenu.tsx`), so a
locked note is spottable in the list rather than only after opening it and
finding the caret gone — the *leading* glyph, because the row's trailing slot is
already spoken for by the [upload spinner](#per-note-upload-spinner) and the
[encryption lock](#encryption), and because a locked note is a different kind of
note, which is what that leading glyph says on the folder rows too. It reads off
`Note.locked` alone, so it is right even for a note whose body is still deferred
on an encrypted backend. `App` routes its press to `useNotes().toggleLock`, which flips
`Note.locked` (`setLocked`, `src/domain/note.ts`) on the shared `DOC_SCOPE` undo
timeline — structural, like starring, because it changes what may be *done* to a
note rather than what it says. `updatedAt` is left alone so locking never jumps a
note to the top of the recents, and the toggle runs through `withBody` so a
deferred note on an [encrypted backend](#encryption) is loaded first and the flag
reaches its `.enc` file. The flag is absent rather than `false` when unlocked, so
no migration was needed and it rides every persistence layer on exactly the terms
[`favorite`](#favorites) does: `locked: true` in the markdown frontmatter, a
`locked` field on the encrypted note JSON and on the [note index](#encryption)
row, and a defensive `locked === true` check in `parse` — junk must never leave a
note the user can neither edit nor unlock. Because it is part of the document, a
lock travels to the user's other devices with everything else.

**What the lock takes away is the caret**, and everything follows from that. In
the [live-preview editor](#markdown-editor) the surface stops being
`contenteditable` altogether (`contentEditable="false"`, plus `aria-readonly` so
a screen reader announces the textbox as read-only), which is what keeps the soft
keyboard down on a phone and stops anything blinking on a desktop. With no caret
there is no [active raw line](#markdown-editor): a locked note opens fully
formatted and *stays* that way, and locking a note that is open mid-edit drops
the raw line back to formatted in the same render. The paths that would mutate
the source stand down with it — `beforeinput` refuses everything outright (a
second lock, in case an edit reaches the DOM behind React's back, which is the
failure the whole interception layer exists to prevent), and `format`, `cut`,
`indentList`, `placeCaretAtEnd`, `toggleTask`, paste and file drop all return
early. [Task checkboxes](#task-items) render as state rather than press targets
(`interactiveTasks={false}`). The Markdown-off [plain fallback](#markdown-editor)
gets the same treatment through the textarea's own `readOnly` — which is what
suppresses the mobile keyboard there — plus `caret-transparent`, because a
read-only field still paints a desktop caret. The [title field](#title-field) is
read-only on the same terms: a lock that guarded the body but let the note be
renamed would be a strange half-lock.

**What the lock leaves alone is everything that only reads the note.** Scrolling,
[selecting](#selection-mapping), copying, [find](#find-in-note),
[export](#export), [starring](#favorites) and archiving are untouched, and the
[line-number gutter](#line-numbers) keeps working in full: pressing a number on a
locked note still draws the whole-line selection, still reports it up to the
header, and so still unfolds the narrow header's
[selection actions](#selection-actions) — which on a locked note is the copy
button alone, since the other two rewrite the note. The header **folds away** the
[formatting toggle](#styling-toolbar) and the [cut button](#cut-button) while
locked, and holds the styling toolbar off the screen without forgetting the
user's preference, so a Markdown writer's remembered toolbar doesn't arrive as a
bar of dead buttons over a note it can't touch. The eye itself goes the other
way on a phone: a lit one steps *out* of the [collapsed
cluster](#collapsed-header-actions) and stays on the row, because a note that
refuses the caret has to say so before the user wonders why — see
[pinned header state](#pinned-header-state).

**The two write-only buttons slide rather than vanish.** Each rides in a
`WriteAction` box (`src/ui/NoteEditor.tsx`) that stays mounted and travels
between its full width and zero on the same 200ms `max-width` / `opacity` /
`visibility` transition the [narrow header's cluster](#the-editor) uses — so
pressing the eye reads as the row folding its writing tools up, and pressing it
again unfolds them. `visibility` flips to hidden only at the *end* of the
closing slide, which is what takes the folded button out of the tab order and
off screen readers without cutting the animation short. The box also carries a
negative left margin while folded, cancelling the row's own `gap-2` so a
collapsed action leaves no dead space behind (`first:ml-0` gives it back when
there is no preceding sibling — during a [selection](#selection-actions) the
star and the eye aren't rendered and the box leads the row). The cut button uses
the same box for the decrypting pause, so it fades in with the note rather than
appearing.

The lock is a guard against a stray keystroke — the reference note you keep open,
the recipe you read while cooking, the pocket that finds the screen — not a
security boundary. Encryption at rest is a different feature entirely, with a
different lock glyph on the note card (see [encryption](#encryption)); this one
you hold the key to, and one press gives it back.

The **Under lock and key** achievement (`underLockAndKey`) derives from the first
note in the document gaining the flag.

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
between Preact and persistence. It translates create/edit/retitle/remove/
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
device's edits arrive without a gesture. Every automatic pull is guarded
against clobbering unsaved work: `refresh` stands down entirely while anything
is unsaved (an edit queued behind the debounce, a save in flight or backing
off, a [held save](#save-hold)), and `reload` — after its awaited backend
round-trip — refuses to adopt the pulled copy when a keystroke landed
mid-flight or the document was swapped wholesale under it. Local is newer;
the save pipeline syncs it, and the next quiet pull reconciles. Backgrounding
the app (`visibilitychange` → hidden) flushes any debounced edit immediately,
since a mobile browser throttles background timers and may evict the page
before an armed save ever fires; foregrounding pulls the latest via
`refresh`.

The mount/swap load guards the reverse race: with a cloud backend the async
`load()` round-trips for hundreds of milliseconds behind the instant
`loadSync` paint, and a checkbox toggled (or any edit made) in that window
would otherwise be reverted when the read resolves with the pre-edit
document. A monotonic edit counter (`editSeqRef`, bumped by every
`scheduleSave`) is snapshotted before the read starts; if it has moved by the
time the read resolves, a user edit interleaved, so the load keeps the local
(already-queued-for-save) document instead of adopting the stale bytes it
read, and just marks itself resolved. See [save baseline](#save-baseline) for
what that keeps-the-local-copy path must *not* do with the revision it read.

### Save baseline

The backend revision a write claims to be a forward step from — `revisionRef`
in `useNotesSync` (`src/app/use-notes-sync.ts`), handed to `adapter.save` as
`baseRevision` and checked there against what's actually on the backend.
Alongside it the engine tracks `baselineKnown`: whether that revision is
*authoritative*, meaning this device has actually seen the backend's state at
it. The two are separate because "I know the remote is at r7" and "I have no
idea what the remote is at" are different states, and only the first is
permission to overwrite.

`baselineKnown` starts false on every backend swap and becomes true when
something reconciles: an adopted `load()`/`reload()`, a
[watch](#live-pull) push, a successful save, a settled
[conflict](#conflict-modal) — or the [offline mirror](#offline-cache)'s own
record of which revision its bytes were built on, read at mount from
`loadSync`. That last one is what covers the window before the first cloud
round-trip lands: an edit typed in those seconds is written from the mirror's
revision rather than from nothing.

Two rules keep the baseline honest:

- **A load whose document we decline to adopt does not hand over its
  revision.** When a keystroke (or an unsynced mirror, below) means the engine
  keeps the local copy, adopting the revision it just read would tell the
  backend the next write is a forward step from its current state — and the
  queued save would go straight over the other device's edit. The stale
  baseline is kept instead, so the save is checked against it and the
  [file backends](#directory-adapter) reconcile per note: another device's edit
  to a *different* note survives untouched, a collision on the *same* note
  raises the conflict. If there was no baseline at all (the load is the first
  thing this device ever heard from that backend), there is no honest merge to
  attempt and the divergence is surfaced as a conflict.
- **An unknown baseline is not a licence to overwrite.** A save from one goes
  out with no `baseRevision`, and the directory adapter refuses to touch any
  file whose current revision it can't account for — see `isOurs` in
  `src/storage/directory-adapter.ts`, which passes only files that are absent
  remotely, match the baseline, or carry a revision this session produced or
  read. This is what stops the "typed a lot on the desktop, opened the phone,
  the desktop's text was gone" failure: previously an absent `baseRevision`
  disabled the conflict gate outright, so a device whose load had failed — or
  whose load result had been declined for a keystroke — wrote its whole stale
  document over the backend without asking.

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
then adopts the remote — and `reload` re-checks after its backend round-trip,
so even a keystroke typed while the pull's slow cloud load is in flight
survives (the pull result is discarded instead). Each pull passes the last `StoredSnapshot`
(`lastStoredRef`) to `load` as the `previous` hint, so a file-per-note backend
lists cheaply and re-downloads only the notes whose revision moved. When a pull
actually moves the document it fires the `liveSync` ("Telepathy") trophy. The
open editor reflects the pulled change through a body-reconcile effect in
`MarkdownEditor` / `PlainEditor`: since the user's own keystrokes echo back to
the identical `body`, a `body` that differs from the editor's local value can
only be another writer's edit, so it's adopted (and the active line clamped)
without disturbing in-progress typing.

A backend that advertises the **`watch`** capability opts out of this interval
poll entirely (the loop early-returns on `capabilities.has("watch")`) and drives
reconciliation from a push channel instead: `useNotesSync` subscribes to
`adapter.watch(onRemoteChange)` for the life of the active adapter, and
`applyRemoteSnapshot` adopts each pushed `StoredSnapshot` under the same
stand-down set `refresh` uses — dropping the update (rather than clobbering) if
anything is unsaved, and no-opping when the etag hasn't actually moved (our own
write echoing back, or a sibling namespace's revision bump). It still fires the
`liveSync` trophy when a pushed change lands. Today only [notesd](#notesd-backend)
advertises `watch`; its shim polls the daemon's cheap `GET /v1/rev` and re-loads
only when the aggregate revision moves, so a self-hosted device does a full
document download on an actual change rather than every 10s.

### Save hold

`holdSaves` / `releaseSaves` (`src/app/use-notes-sync.ts`) — arming a hold while
a brand-new note is being titled on file/cloud backends, so the first write
happens under the real title slug rather than the throwaway default filename.

### Undo / redo

`useUndoRedo` (`src/app/use-undo-redo.ts`) — in-memory undo/redo over whole
`Snapshot`s, **scoped per note**. It holds one timeline per *scope* — the id of
the note being edited, or the shared `DOC_SCOPE` for structural changes that
aren't about one note (create / delete / archive / restore / move / folder ops /
import) — each capped at `UNDO_HISTORY_LIMIT` (50) and seeded lazily (from the
pre-edit document) the first time something records against it. `undo` / `redo`
and `canUndo` / `canRedo` all act on the **active scope** — the note open in the
editor (`activeNoteId`, threaded from `App`'s `editingId`), or `DOC_SCOPE` on the
list / archive views. So switching notes switches which timeline ⌘/Ctrl+Z walks:
a burst of edits in one note is never reverted while you're looking at another,
and each note keeps its own session history.

`record` appends a labelled entry to a scope; a `mergeKey` collapses rapid
same-key records into one step, while creates/deletes (no key) always land as
their own steps. Body edits key on `edit:<noteId>:<run>:<completed-sentence-count>`,
composed by `useNotes`:

- the **sentence count** comes from `sentenceBoundaryCount`
  (`src/domain/sentence.ts` — a terminator `.`/`!`/`?`/`…` followed by
  whitespace, ignoring the trailing newline the live-preview editor keeps at the
  end of the body so the sentence you're still typing isn't counted as finished
  the instant you type its terminator), so keystrokes within one sentence
  coalesce and each finished sentence locks in as its own checkpoint — undo walks
  a long paragraph back **sentence by sentence**;
- the **run** comes from `nextEditRun`, a per-note counter that ticks up every
  time typing reverses direction (insert ↔ delete). Typing a word, erasing it,
  then typing another leaves **three** undo steps (retype → erased → original)
  instead of coalescing into one and swallowing the erase.

An image/file paste keeps its body reference and attachment together on one step
by sharing the note's current key (`currentBodyEditKey`, which peeks the run
without advancing it).

Applying a stepped-to entry is **surgical** so it never clobbers edits made in
another scope since: a note scope splices just that note's content (body / title
/ attachments) back into the live document, and `DOC_SCOPE` uses
`mergeDocSnapshot` to restore the note *set*, each note's structural fields
(`archived` / `folderId`) and the folder registry from the entry while keeping
every surviving note's **current** body. `reset` drops every timeline (and the
run bookkeeping) whenever the document arrives from outside the edit path (load,
reload, conflict-adopt); scopes reseed on their next edit.

The one note that rule can't keep current is the note the step **deletes**: it
is gone from the live document, so undo has nowhere to read its body from but
the entry itself — and that entry was written by whichever structural action
came *before*, potentially long before anything was typed. So the structural
timeline **rebases its head on every record**: the entry about to be appended
behind is re-merged against the document as it stands at that instant (the same
`mergeDocSnapshot` rule, structure from the entry, content from the live doc),
which is the last moment the content still exists. Without it the sequence that
makes up the whole [dropzone](#dropzone) flow — create a note, type into it,
tick it off — brings the note back **empty**, because the entry undo lands on is
the one the *create* wrote.

`useUndoRedoShortcuts` (`src/ui/hooks/useUndoRedoShortcuts.ts`) binds ⌘/Ctrl+Z
(undo) and ⌘/Ctrl+Shift+Z / Ctrl+Y (redo); the side menu also exposes undo/redo
as the bottom row of the [button island](#folders-in-the-side-menu) at the foot
of the list. The shortcut stands down inside plain `<input>` / `<textarea>`
fields (the note title, settings, modal inputs) so their native character-level
undo wins, but it **does** answer the shortcut inside the live-preview editor's
`contenteditable` — that surface deliberately swallows the browser's native
contenteditable undo (Preact owns its DOM), so without this the shortcut would be
dead while the caret sits in a note — answering only once the Undo button had
moved focus out of the editor. There it reverts one sentence of the open note's
editing burst, exactly as the side menu's Undo button does. That carve-out is
why the hook stays app-owned rather than re-exporting the
[framework's](#the-shared-framework), which stands down on every
`isContentEditable` target. It does adopt the framework's two gates: `enabled`,
and standing down while a modal (`[aria-modal="true"]`) is open.

**Undo / redo scrolls the changed region back into view.** When a step lands off
screen — you undo a paragraph you scrolled past, or redo an edit near the note's
foot — the reverted (or re-applied) part is revealed rather than silently
changing out of sight. Each content apply bumps `undoScrollSeq` (returned by
`useNotes`, threaded through the `Editor` to both the live-preview and plain
editors) in the same commit that swaps the body in; a no-op at a timeline edge
never ticks it. On a tick the editor diffs the incoming body against the text
still on screen with `firstChangedLine` (`src/domain/line-edit.ts`) and scrolls
that first differing line into view — the live-preview editor centres the line's
element (left alone when it's already fully visible), the plain textarea
estimates the offset from its line height. A change that leaves the body
untouched (only a title or attachment was reverted) diffs to nothing and never
moves the view, and the glide respects reduced motion.

### Settings sync

`useSettingsSync` (`src/app/use-settings-sync.ts`) reconciles the
[appearance store](#appearance-store) with the backend files that hold it. Two
of the three [settings widths](#settings-scopes) live on the backend and one
deliberately does not:

- **global** → `settings.json` at the app-folder root (`SettingsStore`,
  `src/storage/settings-store.ts`) — everyone on the account, in every
  namespace.
- **namespace** → `namespace-settings.json` inside the active namespace's own
  folder (`NamespaceSettingsStore`,
  `src/storage/namespace-settings-store.ts`) — only the people who share that
  namespace, and it travels with the folder when the folder is shared.
- **device** → localStorage only. Never uploaded, which is exactly what makes
  it usable on a login several people share.

Each remote width reconciles the same two ways: on mount / backend / namespace
switch it adopts the backend's file when one exists and seeds it from this
device when it doesn't, and on every local edit it writes that layer back. A
write is compared against what was last seen for that layer first — both layers
subscribe to the same store, so without the guard a device-layer edit would
re-upload the global and namespace files untouched, which on a shared login is
a write race between people over bytes nobody changed.

Best-effort and plaintext (so the [unlock gate](#unlock-gate) can render in the
user's theme); on the browser backend there are no file stores and the hook is
a no-op.

### Settings scopes

`src/theme/appearance-scopes.ts` (over the generic algebra in
`src/domain/settings-layers.ts`) — **how far a setting reaches**. A namespace
can be shared by several people through one login and one folder, so a single
settings document per account is not enough: one person switching to a light
theme would repaint everyone else's app. Three widths solve it, **narrowest
winning**: `global` → `namespace` → `device`.

Each layer is **sparse** — it holds only the leaves it has an opinion about,
down to `editor.wordWrap` and `customTheme.colors.accent` rather than whole
groups. That is what makes the stack work: saving one toggle at the device
width records that one leaf, and every other setting keeps following the wider
layers.

**Saving** (`applyScopedSave`) writes only the leaves the user actually moved
since the settings dialog opened — so saving globally never drags along every
untouched value and republishes it to everyone. For each moved leaf: it is
stored in the chosen layer *unless* it already equals what the wider layers
resolve to, in which case it is dropped from that layer (this is how a setting
stops being an override); and it is removed from every **narrower** layer,
because a leaf left behind there would shadow the save and the user would watch
their choice do nothing.

**Resetting** loads a wider baseline into the draft and persists nothing on its
own, so the width it lands at is still Save's decision. Reset-to-a-wider-width
followed by Save is therefore the way to *give up* an override.

Three keys sit outside the scheme entirely (`UNSCOPED_KEYS`): the
[Transform rules](#transforms) and the two achievement fields. They are
authored content and earned progress rather than preferences — and the rules
already carry a namespace of their own — so they stay in the global layer where
they have always lived.

Quick toggles outside the dialog (the theme switcher, the achievement recorder)
have no scope picker, so they write through `writeToOwningScope`: the setting
stays at the width already managing it, falling back to `global` when no layer
has an opinion yet.

### Settings scope pickers

The settings dialog's footer wears two `SplitButton`s
(`src/ui/form/SplitButton.tsx`) — one action with a chevron welded to its right
edge that drops a menu of variants:

- **Save** picks the width the change is written at: **Everyone** /
  **This namespace** / **This device**.
- **Reset** picks what the draft falls back to: **This namespace's settings** /
  **Everyone's settings** / **Defaults**. A width that holds no settings is
  **left out of the menu** rather than offered — falling back to an empty layer
  would be indistinguishable from Defaults, and offering it would imply there
  is something there to find.

Both remember the last choice per device (`src/ui/settings/scope-preference.ts`),
so the common case is one press with no menu. Saving at anything narrower than
Everyone unlocks the **Own terms** achievement.

### Nav state

`useNavState` (`src/app/use-nav.ts`) owns the drawer's `open` flag, the
`pinned` media-query state (docked sidebar vs. drawer), the floating button's
persisted `position`, and `showButton`. It is published through `NavContext`
(`src/ui/nav-context.ts`) so components read it via `useNav()` rather than
threaded props.

### Route / note link / browser back & forward

`useRoute` (`src/app/use-route.ts`) is the shell's route model, the address it
wears, and its bridge to the browser's session history. The main area still
switches surfaces on a plain value — `Route` is `{ kind: "list" }`,
`{ kind: "note", ns, id }`, `{ kind: "archive" }`, or
`{ kind: "archived", ns, id }`, and `App` projects `editingId` / `readingId` /
`view` off it — but every move leaves a history entry with a URL, so:

- **Back and Forward walk the notes you visited** (open note A, then note B,
  and Back returns to A). Android's back button and the desktop keyboard
  shortcut ride the same history.
- **an open note has a link** you can copy out of the address bar and reopen
  later — bookmark it, or send it to yourself. On a computer the note's
  [right-click menu](#right-click-menu) also carries a **Copy link** entry, so
  the address can be grabbed without opening the note.

There is no routing library and the tree stays a single mounted shell.

#### The address

The URL rides in the **hash**, not the path:

| Surface              | Address                |
| -------------------- | ---------------------- |
| overview             | _(no hash)_            |
| a note in the editor | `#/n/<namespace>/<id>` |
| the archive page     | `#/archive`            |
| an archived note     | `#/archive/<ns>/<id>`  |

A path would 404 on a cold load — the app is static files under three
[deploy slots](../AGENTS.md) with nothing rewriting `/note/<id>` to
`index.html` — while a hash is never sent to the server, so a link resolves on
any slot, offline from the service worker, and from the `file://` bundle inside
the native wrapper. It also keeps note ids out of every request (and every
server log). `routeToHash` / `hashToRoute` are the pure pair; an address the
app never wrote (hand-edited, or from a future version) parses to `null` and is
ignored rather than guessed at.

A note id only names a note inside its own namespace's document, so **the
namespace slug is part of the link**. `App` watches `routeNamespace(route)` and
switches namespace when a route names another one, so following a link lands in
the right document; a slug this device doesn't have is left alone (the ids then
resolve to nothing and the overview shows, and if that namespace turns up later
the switch runs then). While the route names another namespace, `editingId` /
`readingId` read as `null`, so a foreign id can never reach the document or the
[active note cursor](#active-note-cursor).

#### The history entry

`history.state` carries the same route as the hash, plus the entry's position
in the stack. The hash is what makes a _link_ work; the state is what survives
a `replaceState` from elsewhere (`useCloudBackend`'s OAuth URL cleanup nulls
it — hence the merge rather than overwrite) and what tells a `popstate` where
it landed. Either alone can drive the app: a `popstate` whose state was wiped
falls back to reading the address. State also survives a reload, so a refresh
resumes on the surface the tab was showing, ahead of the per-namespace
[remembered note](#active-note-cursor) — while a link, being the one input
another device may have written, beats both on a cold start.

Three verbs, so each caller says what kind of move it is:

- `go(route)` — navigate, leaving a back step. A no-op if it's the route
  already showing (tapping the open note doesn't stack an entry).
- `replace(route)` — navigate with no back step, for moves the user can't
  sensibly return to: the open note was deleted, archived, or moved to another
  namespace, or the namespace itself was switched.
- `backTo(target)` — an in-app back control (the editor's back button, the
  archive's, "Show all"): steps the browser back when the entry behind is
  exactly `target`, otherwise navigates. Keeps list → note → back → note from
  growing the stack each round.

`copyNoteLink` in `App` is what that menu entry calls: it resolves the id to a
route (an archived note gets its read-only address, matching where opening it
lands) and writes `routeUrl(route)` — the deploy slot's base plus the hash, not
whatever path this tab happens to sit on — through
`writeClipboard` (`src/ui/clipboard.ts`, shared with the editor's
[copy row](#copy-scope)).

`App` passes an `onPop` that runs the same side effects an in-app tap does for
any move the app didn't initiate — a Back / Forward step, or a hash pasted into
the bar: a never-typed-into new note is discarded on the way out (see
[blank note](#blank-note)), the note being landed on is refreshed from the
backend, and the `retrace` achievement fires. `fromLink` distinguishes the
address-bar case (which fires `deepLink`) from a history step. Some browsers
fire both `popstate` and `hashchange` for a fragment navigation, so the two
handlers are order-independent — whichever lands first applies the route and
the other reads as a no-op.

The [swipe-back suppression](#suppress-swipe-navigation) is unchanged — the iOS
edge-swipe still belongs to the side menu's gestures, not to history.

## Navigation, drawer, and gestures

### Side menu

`SideMenu` (`src/ui/SideMenu.tsx`) — the navigation surface: a drawer over a
dimmed backdrop on phones, an always-docked panel on tablets+. It holds the
namespace switcher, the [Favorites](#favorites) section, the recent-notes list
(with swipe-to-remove rows), a
bordered [button island](#folders-in-the-side-menu) (New note / New folder /
Show all / Archive over Undo / Redo / Search / the sync glyph) pinned to the foot
of the list, and a
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
"No notes yet." for the seconds a folder/cloud fetch takes. The drawer's
presentational leaf components — the `SectionHeader` section label, the generic
`NavItem` row, the `FolderRow` / `FolderEditRow` folder rows, the
`FolderLabelRow` caption the [Favorites](#favorites) section groups by, and the
`SwipeToRemove` note-row swipe wrapper — are extracted to a sibling
`src/ui/SideMenuRows.tsx`: each takes everything via props and touches none of
the container's drag / folder-expand / namespace state, so the `SideMenu` file
holds only the stateful container that composes them.

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

### Edge zone / edge gesture guard

`edge-gesture.ts` (`src/ui/hooks/edge-gesture.ts`) — the single definition of
where "the edge" is (`EDGE_ZONE`, 30px from either screen border) plus
`useEdgeGestureGuard`, which reserves that strip for the side menu. The zone is
shared by [edge swipe to open](#edge-swipe-to-open) (passed as its `edgeZone`),
[suppress swipe navigation](#suppress-swipe-navigation), and both row gestures.

The guard exists because an inward edge swipe still lands on whatever the page
paints there — a note card in the overview, a note row in the open drawer — and
a row only swallows the click trailing its own gesture once that gesture has
committed to a *horizontal* drag. An edge swipe that arcs downward as it comes
in locks the row's axis to "vertical", so the row treats it as a scroll and the
browser's synthesized click at the end activates it: the drawer opens and a note
opens behind it. `useRowSwipe` and `useSwipeReveal` therefore both run their
handlers through the guard — a **touch** gesture starting inside `EDGE_ZONE`
never reaches the row (no slide, no archive, no reveal) and its trailing click is
swallowed once the finger has travelled 8px or more. A stationary tap at the edge
still opens the row it hit, and mouse gestures pass through untouched so a narrow
window keeps no dead strip.

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

`useRowSwipe` (`src/ui/hooks/useRowSwipe.ts`) — the note-card gesture (a thin
wrapper over the framework hook that adds the
[edge guard](#edge-zone--edge-gesture-guard)). A right swipe >96px archives the
note; a left swipe >48px latches a trash button that needs a second confirming
tap to delete. The foreground tracks the finger with
`translateX` and settles via CSS transition on release. **Touch only:** on a
hover/fine-pointer device (`useMediaQuery("(hover: hover) and (pointer:
fine)")`) `SwipeableNoteCard` skips the swipe wiring and renders the card inside
a [right-click menu](#right-click-menu) instead.

### Swipe reveal (sidebar)

`useSwipeReveal` (`src/ui/hooks/useSwipeReveal.ts`) — the side-menu row gesture:
a left swipe latches the row open to uncover a single trash button; tapping it
deletes the note straight away (no confirming second tap — deletion is undoable
from the Edit section), and tapping an open row closes it. Like the card, it
stands down inside the [edge zone](#edge-zone--edge-gesture-guard). **Touch only:** like
the overview card, `SwipeToRemove` swaps the swipe for a
[right-click menu](#right-click-menu) on a hover/fine-pointer device.

### Right-click menu

`RowActionMenu` (`src/ui/RowActionMenu.tsx`) — the desktop counterpart to the
two swipe gestures above. On a hover/fine-pointer device both the overview
card (`SwipeableNoteCard`) and the side-menu row (`SwipeToRemove`) wrap their
content in this component instead of arming a swipe: right-clicking the row
opens a menu of the same actions — archive/restore and delete — plus
**Copy link**, which puts the note's own address on the clipboard (see
[route / note link](#route--note-link--browser-back--forward)); a plain click
still opens/selects the note. It is built on the same
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
Disabled when a modal is open or a scroll ancestor isn't at its top, and while a
note is being drag-filed into a folder — that gesture reports itself through
`ReportDragActivityContext` (`src/ui/drag-activity.ts`) so a note dragged
downward can't arm a refresh at the same time (see
[note drag](#note-drag-touch--pointer)).

### Pinned sidebar

`pinned` (`src/ui/nav-context.ts`), backed by `useMediaQuery`
(`src/ui/hooks/useMediaQuery.ts`) — at tablet width and up the menu docks open
as a sidebar and the floating button disappears; below that it's a drawer.

### Collapsing the docked sidebar

The docked sidebar isn't wanted every minute of the day, so it can be folded
away. `SidebarCollapseRail` (`src/ui/SideMenuRows.tsx`) is the vertical twin of
the [footer collapse rail](#folders-in-the-side-menu): the control seated on the
panel's **inner** edge — the one facing the notes — whose chevron points out
toward the edge to collapse and back in toward the content to restore. Pressing
it drops the panel entirely and the note takes the whole window. Everything
mirrors when the menu docks right (`position.side`).

**The rail is invisible, and free, until you go looking for it.** Collapsed, it
costs the note nothing at all; open, the rows' highlight runs the panel's full
`16rem` rather than stopping short of a permanent gutter. Two nested pieces buy
that:

- The `<button>` is a full-height, never-drawn **sensor** straddling the edge —
  `absolute`, `w-4` (16px), positioned by an inline `left`/`right` of `0` when
  collapsed and `calc(16rem - 0.5rem)` when open — and it is
  `pointer-events-none` for its entire life.
- The **grip** inside it is the only thing ever painted or pressed, and only
  when `revealed` turns its opacity and its pointer events back on together. A
  descendant may take pointer events back from a `none` ancestor, and its press
  still bubbles to the button's handler.

**The grip fills the sensor** — `h-full w-full`, so it is a 16px strip running
the panel's whole height rather than a handle floating at one spot on the edge.
Wherever along the divider the pointer arrives, it is already on the control; no
hunting up or down for a small box. Running that tall obliges it to be quiet, so
it carries no border and no shadow: revealed, it is a flat `bg-surface-3` strip
with the chevron `text-muted` at its centre. Hovering the strip directly fills
it with `bg-accent-wash` and brightens the chevron to `text-fg-bright` — the one
moment it has to read unmistakably as a button. `--accent-wash`
(`src/styles/theme.css`) is the accent at 20% over `--surface`, composited to an
opaque colour: the same green the panel's **active row** paints with
(`bg-accent/20`), so the lit strip and the selected note read as one family
rather than the strip shouting the raw accent beside them. Composing it in the
token rather than leaning on the translucent utility is what keeps both fills
**opaque** — the strip straddles the divider, so a wash would pick up `surface`
along one half and `page-bg` along the other and read as two tones down its
length.

`revealed` comes from **`useEdgeHover`** (`src/ui/hooks/useEdgeHover.ts`), which
tracks `pointermove` on the window and compares the cursor against the sensor's
own `getBoundingClientRect` (coalesced to one measurement per frame, with 8px of
hysteresis once entered so a cursor on the boundary can't flicker it). A
click-through element can never match `:hover`, which is exactly why the plain
CSS pseudo-class won't do here. Three consequences worth keeping:

- **Nothing invisible can swallow a press.** The only pixels the rail can take
  are the grip's own `w-4` strip, and only while it is on screen — so the note
  underneath keeps the whole edge otherwise. The rows' trailing "+" is safe even
  from the revealed strip: it stops 16px short of the panel edge, twice the 8px
  the strip reaches back over it.
- **The grip is centred on the divider**, straddling it evenly rather than
  sitting to one side, so revealing it doesn't appear to shift the line the
  panel draws — the solid fill covers that stretch of it while on screen. The
  panel owns that border (`border-r`, or `border-l` docked right) — the rail
  never draws one.
- **A device that can't hover keeps the grip up permanently.** `useEdgeHover` is
  gated on `useDesktopPointer()` and ignores `pointerType: "touch"`; without
  that, a collapsed sidebar on a tablet would have no way back.

Keyboard focus reveals the grip on its own terms (a focused button takes Enter
without needing pointer events at all). `title`, `aria-label`, `aria-expanded`
and `aria-controls` carry the meaning the hover styling doesn't — a screen
reader sees a plain toggle button either way; `aria-controls` is dropped while
collapsed, since the panel it names is gone.

**The choice is per device**, not synced: it rides `localStorage` under
`notes/sidebar-collapsed` alongside the floating button's position
(`useNavState`, `src/app/use-nav.ts`), because a wide desktop and a small laptop
want different answers. Collapsing (not restoring) fires the `clearTheDecks`
achievement.

The state reaches the rest of the app as `sidebarCollapsed` / `toggleSidebar` on
the [nav context](#side-menu). Only the docked layout has any of this — the
phone drawer closes rather than collapses, and `drawerShowing` (which springs
the active note's folder open) reads `open || (pinned && !sidebarCollapsed)` so
a folded-away sidebar counts as not showing. Overlays that inset themselves past
the menu — the [toast](#toast) and the [update toast](#update-toast) — ask
`dockedSidebarWidth(nav)` (`src/ui/nav-context.ts`) rather than hard-coding
`16rem`: it answers the bare `16rem` panel while docked open, and `undefined`
both once collapsed (the rail overlays the notes rather than displacing them)
and where there is no docked sidebar at all.

### Viewport height

`useViewportHeight` (`src/ui/hooks/useViewportHeight.ts`) reads the visual
viewport (accounting for the mobile soft keyboard and Dynamic Island) as a
`100svh` fallback; `appViewportRect` (`src/ui/appViewportRect.ts`) exposes the
app's drawable rect for overlay positioning. `scrollFocusedIntoView`
(`src/ui/hooks/scrollFocusedIntoView.ts`) is the companion for the *content*
side: it scrolls a freshly-focused field or tapped line clear of the soft
keyboard by re-centring it on every visual-viewport change until the
keyboard-settling burst goes quiet — the keyboard animates in as a series of
intermediate heights, so centring only on the first would leave the last line
(which can't scroll any further up) behind the keyboard. What it centres is the
target's *reveal rect* (`revealRect`): the caret's own client rect when the
target is an editable line holding the caret (or the head of a selection over
it), so a sentence that soft-wraps across several screens reveals where the
caret is rather than the middle of its box; the element's rect otherwise. It
centres by setting
the **nearest scrollable ancestor's `scrollTop`** (the pure `centeredScrollTop`
clamps to the container's scroll range), *not* `Element.scrollIntoView`: the
latter walks up every scroll container and, on iOS, nudges the visual viewport
too, so with the shell pinned to `--app-height` it drags the target past the top
of its container and off screen — the bug where tapping the first line of a note
hid it above the header. A clamped container scroll keeps an edge line resting at
the band's top / bottom instead; when nothing is scrollable (the content already
fits the band) it falls back to `Element.scrollIntoView`. The reveal glides
(`behavior: "smooth"`, retargeted on each event so the burst reads as one
continuous motion), falling back to an instant jump under
`prefers-reduced-motion`. Used by the [live-preview editor](#markdown-editor)'s
tap-to-reveal and the Storage settings passphrase field.

## Modals and dialogs

### Modal

`Modal` (`src/ui/Modal.tsx`) — the accessible base overlay: a body portal with a
dimmed backdrop, Escape-to-close (topmost only), backdrop-click close, and a
`centered` (card) vs full-screen-sheet mode. It manages a modal stack so nested
confirmations don't collapse every layer at once.

The sheet mode is also what keeps a dialog clear of the notch: it opens with an
`aria-hidden` spacer the height of `env(safe-area-inset-top)` (and a matching
`env(safe-area-inset-bottom)` one under a footer), and positions itself against
the app's visual-viewport rect. **A dialog that rolls its own overlay loses all
of that** — that is why the changelog modal renders its chrome here rather than
using the framework's ready-made component (see [changelog
modal](#changelog-modal)).

### Modal bus

`src/ui/modal-bus.ts` + `ModalBusProvider` (`src/ui/ModalBusProvider.tsx`) — a
global command dispatcher decoupling openers from hosts. A button dispatches a
`ModalCommand` (`{ kind: "settings" }`, etc.) via `useModalDispatch`; the
matching [host](#modal-hosts) reads it via `useModalState` and opens its modal —
no prop threading.

### Modal hosts

`src/app/modals/*Host.tsx` — `SettingsModalHost`, `NamespacesModalHost`,
`SearchModalHost`, `ChangelogModalHost`, `AchievementsModalHost`,
`AchievementsUnlockModalHost`. Each owns one modal's open state, reads its
command off the [modal bus](#modal-bus), and threads the app state the modal
needs (storage, appearance, sync, the document). All are mounted once at the
`App` root.

### Settings modal

`SettingsModal` (`src/ui/settings/SettingsModal.tsx`) — a tabbed dialog
(General, Appearance, Editor, Transform, Storage; Developer and Logs appear only
when dev mode / log capture are on), with a footer pinned below the content: **Reset to
defaults** on the left, **Cancel** + **Save** on the right (mirroring
checklist). The appearance settings it owns — theme, font, the Editor controls,
the achievements switch — are edited against a local **draft** and only persist
on **Save**: while the dialog is open the draft streams to the theme engine via
`setAppearancePreview` so the look previews live, **Cancel** (and Escape /
backdrop / the X) drops the draft so the persisted look snaps back, and **Save**
flushes it through `commitAppearance` (which preserves the earned achievements
the dialog can't edit). **Reset to defaults** likewise keeps the
[Transform rules](#transform-settings), which are authored content rather than a
preference. The device-local controls (language, the
menu-activation toggle, developer mode) and the storage connections apply
immediately — they don't live in the persisted appearance document the draft
snapshots. Tabs reset to General on reopen.

### Namespaces modal

`NamespacesModal` (`src/ui/NamespacesModal.tsx`) — add / rename / delete /
restyle namespaces. Each gets a name, optional glyph (`NamespaceGlyph` +
`GlyphGrid`), and optional colour; the active one shows a checkmark. Deleting one
removes it and its notes from the active backend (`removeNamespace` +
backend-specific delete). See [namespaces](#namespaces).

### Search

> Not to be confused with **[find in note](#find-in-note)** — the editor's own
> bar, which searches the open note verbatim and highlights the hits in place.
> This section is the cross-note search: which *note* mentions something.

`SearchModal` (`src/ui/SearchModal.tsx`) — find any note across the whole
namespace at once. Opened from the magnifier on the [action bar](#folders-in-the-side-menu)
(`SideMenuActionBar`, on the history row to the right of Undo / Redo) via a `{ kind: "search" }`
command on the [modal bus](#modal-bus), or from **⌘⇧F / Ctrl+Shift+F** anywhere
in the app (`useSearchShortcut`, bound by the host — see
[the find shortcuts](#the-find-shortcuts)); `SearchModalHost` owns its open state
and is handed the live document (`sync.doc`) and `switchTo` from `App`. It is a
plain `Modal`, so it fills the screen on mobile and centres on desktop.

The engine is pure and lives in the domain layer (`src/domain/search.ts`, no
DOM): `buildSearchIndex(snapshot)` flattens the document into a flat list of
searchable entries — one per note title and one per note body — skipping archived
notes since a result opens the note in the editor. `search(index, query)` parses
the query and returns the hits grouped per note, each carrying the character
`ranges` that matched so the modal can highlight them in place (`segmentMatches`
splits the text into plain / matched runs, rendered as `<mark>`; a long body is
clipped to a window around the first match). The query language is progressive: a
`/pattern/flags` literal is a JavaScript regex (an invalid one is reported, not
silently empty); a bare term with `*` / `?` is shell-style wildcards; anything
else is a case-insensitive substring match that falls back to a fuzzy subsequence
match (`grcl` → "Grocery list") when the substring finds nothing.

**Lazy-encryption fit.** The body entry is built from `notePreviewBlock`, the
same projection the encrypted [note index](#encryption) already carries per note.
For a loaded note that is the body itself (whitespace-normalised, attachment
markdown stripped); for a **deferred** note — one whose body is still sealed on a
file/cloud backend and not yet decrypted — it is the `preview` the index stored
at seal time, which is the full body text (the list view only clips it in CSS).
So the index the file backends build to render the list **is** the search corpus:
full-text search works across every note, encrypted or not, without decrypting a
single body up front and without bloating the index. Picking a result calls
`switchTo`, opening the note in the editor (which then decrypts its body on demand
if it was deferred). Searching is what unlocks the **Seeker** achievement (manual
`unlock("seeker")`).

### Clear button

The control that empties a text field, as opposed to the one that closes the
dialog around it. It paints `ClearFieldIcon` (`src/ui/icons.tsx`) — a cross
inside a circle — rather than the bare `CloseIcon` every dialog's close button
uses, and its hover halo is a full circle (`rounded-full`) to match.

The distinction exists because the two controls end up adjacent: in the
[search modal](#search) the clear button sits immediately left of the modal's
close button, and when both were a plain cross the header read as one control
accidentally drawn twice. The ring is what separates them at a glance, and it's
the conventional "empty this field" affordance besides. Any future field that
grows a clear button should reuse `ClearFieldIcon` for the same reason.

### Changelog modal

`ChangelogModal` (`src/ui/changelog/ChangelogModal.tsx`) — the in-app "What's
new", listing every shipped release (newest first) from the parsed
[changelog data](#changelog-data) with inline Markdown. A bullet carrying
`[Learn more](feature:<slug>)` drills into a [feature doc](#feature-docs) in
place, with a back button.

The dialog's chrome (header, scroll panes, drill-down state) is app-side on top
of the shared [`Modal`](#modal), **deliberately rather than** the framework's
ready-made `ChangelogModal`: that one portals into a private overlay of its own,
so on mobile it renders flush against the top edge with its header under the
status bar, and it also misses the visual-viewport rect, the stacked-Escape
handling and swipe-down-to-close. Only the shell is local — the parser and both
Markdown renderers still come from the framework, so there is no forked parser.
`tests/ui/changelog-modal.test.tsx` asserts the safe-area spacer is present, so
a drift back onto a private overlay fails loudly. Drop the local shell once the
framework component sits on the shared modal.

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
  [logger](#logger)), filtered to the `SYNC_LOG_SCOPES` allowlist in
  `src/ui/sync-log.ts`. It shows even when the developer-mode capture toggle is
  off (capture only governs persistence across reloads, not the live buffer),
  with a [Copy](#copy-range) button — so a non-developer can read what sync is
  doing without entering dev mode. The list is ordered **newest first**, so the
  line that explains what just happened sits at the top of the scroll box rather
  than below the whole session's history; a copy still writes the entries
  oldest-first, the order a log is read in when it is pasted into a bug report.
  (The [Logs](#logs) settings tab keeps its chronological order — it is a full
  transcript, not a "what just happened" view.)

The status copy names the bare service ("Synced to Dropbox"), since the
Encryption column now carries the at-rest state. Its content is short and opens
no soft keyboard, so it renders as a compact `centered` card rather than the
full-screen mobile sheet.

### Copy range

The sync log's **Copy** button is a menu, not a one-shot: it asks how far back
the copy should reach — **Last 10 minutes**, **Last 30 minutes**, **Last hour**,
**Everything** — because the reason anyone copies this log is to hand the
minutes around a failure to a bug report or an AI assistant, and a whole
session's history buries exactly those lines. Each row carries the number of
lines it would copy, so an empty stretch of time is visible before the press
rather than a button that silently copies nothing; a range no line falls into is
disabled. The trigger confirms in place (Copy → Copied / Copy failed) and the
successful copy unlocks the **Log Keeper** [achievement](#achievements).

The ranges, the filter, and the clipboard formatting live in
`src/ui/sync-log.ts` (`SYNC_LOG_RANGES`, `entriesInRange`, `formatSyncLog`) —
pure, so what gets copied is testable without rendering the modal. The window is
measured from the instant the menu opened, so the count a row shows and the
lines it copies always agree even as the log keeps growing underneath it; the
payload is sorted oldest-first whichever way the panel is listing it on screen.

### Conflict modal

`ConflictModal` (`src/ui/ConflictModal.tsx`) — a non-dismissable alertdialog
shown when a save collides with a newer remote copy (another device edited while
this one was offline). It summarises each copy (note/word counts) and the user
picks the winner: "keep this device's copy" re-saves against the remote
revision, "keep the other copy" adopts the remote bytes.

It is raised from two places. Usually it's a save that came back with
`ConflictError` — the backend refused a write whose [baseline](#save-baseline)
it couldn't account for. It is also raised straight from the mount load when
that load turns up a document this device has no baseline for while local edits
are already queued: the edit is based on nothing the backend has confirmed, so
there is nothing to merge against and the choice is the user's. Either way the
on-screen edit stays put until they pick.

### Unlock gate

`UnlockGate` (`src/ui/UnlockGate.tsx`) — the full-screen passphrase form that
blocks the app on a fresh reload when the **active namespace** is encrypted and
no passphrase is cached for it (it's session-only by design). Encryption is
[per namespace](#encryption), so the gate names the namespace it is asking
about and carries the
[locked-namespace switcher](#locked-namespace-switcher) as a way out. The
appearance theme stays visible under the gate. While the passphrase is being checked the **Unlock** button swaps in a
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
no note bodies up front. The index read (and write) is retried with a short
backoff, the same way the folder registry sidecar is, so a single dropped fetch
on a flaky link isn't mistaken for a missing index and doesn't needlessly drop
the unlock into the per-note path. When there is genuinely no usable index — a
vault from before the index existed, or one another device left stale — the load
falls back to
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
default-title scheme, and the [copy](#copy-scope) scope. The values are the
[Editor settings](#editor-settings) on the appearance store.

### Export settings

`ExportSection` (`src/ui/settings/ExportSection.tsx`) — the Export tab: every
control over the [PDF renderer](#pdf-settings), grouped by what it affects (the
sheet, the body text, code, lists, and what the page carries beyond the body).
The code background is a swatch row plus a native colour input, the way the
custom-theme editor picks a colour. The page-number **style** is the tab's one
dropdown, because its options are the footer strings themselves rather than
words that fit a segmented row; it and the **position** control sit under the
"Number the pages" toggle and are only rendered while it's on, since neither
means anything without a number to write. Only the PDF path reads any of it — the
Markdown export is a file the storage layer already writes and the clipboard
export is plain text, so neither has anything to style. Like the other
appearance tabs, each control edits the dialog's `draft` and takes effect on
Save.

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
replacement, used for the [copy row](#copy-scope) scope picker in the Editor
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

`src/ui/FloatingPanel.tsx` is a **wrapper** over the framework's component
rather than a bare re-export, for one prop: `drop`. The framework flips a panel
above its trigger when less than ~180px of viewport is left below it — right for
a control in the middle of a page, wrong for one pinned near the top, because
that branch has no viewport clamp (the below-branch clamps its `top` twice; the
above-branch's height is `max(120, spaceAbove)`). A panel taller than the room
above is therefore drawn straight off the top edge, and being `position: fixed`
it cannot be scrolled back. The [styling toolbar](#styling-toolbar)'s menus hit
exactly that on a phone: the toolbar sits directly under the header, the soft
keyboard shortens the viewport past the flip threshold, and the menu's first
rows disappear behind the status bar. Those menus pass `drop="down"`, which pins
the panel below the trigger and clamps its height to what is left, so it scrolls
inside its own box instead. Every other call site keeps the default `"auto"`,
which delegates straight to the framework unchanged — the sidebar footer's
[About dropdown](#folders-in-the-side-menu) in particular *wants* the flip, since
it sits at the bottom of the screen. Only the vertical axis is the app's: the
width and horizontal clamping still come from the framework's
`computeFloatingRect`.

The trigger and the row metrics are the app's dropdown *vocabulary*, not just
`SelectPicker`'s: a control that opens a list of commands rather than picking a
value — the [regex reference](#transform-settings) — reuses the same full-width
bordered trigger and the same `FloatingPanel`, switching only the ARIA from
listbox/option to menu/menuitem. A new dropdown belongs on one of those two
shapes; hand-rolling a third is what makes a dialog look assembled from parts.

## Sync and storage status

### Sync status

`SyncStatus` (`src/ui/SyncStatus.tsx`) — the single glyph that morphs
with sync state (cloud-upload when dirty, spinner when saving, cloud-check when
in sync, cloud-alert on error/offline). Tapping it always opens the [sync
details modal](#sync-details-modal) — the command centre where the status is
spelled out and Save now lives — whatever the state, including mid-save, so the
glyph stays one predictable way in. Errors take precedence over the dirty state
for which glyph shows.

It lives as the **last cell of the side menu's
[button island](#folders-in-the-side-menu)**, right of the (cross-note) Search
button — one sync affordance for the whole app rather than one per surface
header, which also hands the editor header its width back for the controls that
act on the note in front of you. It is therefore styled as a `BarButton` cell
(flush, borderless, icon-only, tinted by tone) rather than as a bordered header
button; `App` threads it down as `SideMenu`'s `syncSlot`. Nothing renders on the
local backend, which has no remote to sync against, and the row is then a cell
shorter.

### Sync indicator

`SyncIndicator` (`src/ui/SyncIndicator.tsx`) — the presentational glyph
`SyncStatus` renders, mapping a `SaveStatus` to an icon.

### Per-note upload spinner

The [sync glyph](#sync-status) reports one global save state; this is its
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
`App` seeds the initial [route](#route--browser-back--forward) from it on mount
and writes it back whenever the open note changes, so a reload or PWA upgrade
lands back on the same note instead of the overview; switching namespaces
restores that namespace's own remembered note. A reload where the history entry
still carries a route resumes on *that* surface instead — it's the more precise
record of where this tab was. Like the [backend preference](#backend-preference) and the active-namespace
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

### notesd backend

`createNotesdAdapter` (`src/storage/notesd/index.ts`) syncs to a user-run
**notesd** daemon (the Rust binary in `notesd/`) — the self-hosted alternative
to the cloud backends. Like Dropbox/Drive it is built on the
[directory adapter](#directory-adapter): the daemon serves its folder
as a **generic blob store** (`GET /v1/blobs?prefix=&etag=` to list a folder,
`GET/PUT/DELETE /v1/blob/{*path}` to move one file), so a `NotesdFileStore` moves
one note's Markdown and a `NotesdAttachmentStore` moves one image's bytes, each
scoped to the namespace's `notes/` / `attachments/` subfolder
(`namespaceNotesFolder` / `namespaceAttachmentsFolder`) exactly as the folder
backend lays them out — which is what lets the same daemon folder be opened
directly by the web folder backend. **Image attachments are therefore real files
under `attachments/`, not inline in the note**, and at-rest encryption composes
**per file inside** the directory adapter via the injected `DirectoryCrypto`
(the same branch as the folder/cloud backends in `useStorageBackend`, *not* the
whole-document `withEncryption` the browser store uses). The daemon's per-file
etag is the revision the directory adapter tracks; its own list+write conflict
detection drives keep-mine/keep-theirs.

It is the one backend that advertises the **`watch`** capability, so
cross-device edits arrive by push rather than the whole-document
[live pull](#live-pull). The directory adapter has no `watch` of its own, so
`createNotesdAdapter` **bolts one on** (spreading the adapter and adding the
capability). The daemon's true push channel is its `GET /v1/events` SSE stream,
but the pinned transport (`createPinnedFetch`) is request/response only — SSE
can't ride it as-is — so `watch` is a **shim**: it polls the O(1) `GET /v1/rev`
aggregate revision on a short cadence and, when it moves, re-loads through the
directory adapter and hands the fresh snapshot to the sync engine, which adopts
it under its usual guards (see [Live pull](#live-pull)). A real
streaming-over-bridge transport is a tracked follow-up; until then the shim gives
low-latency, download-only-on-change sync within the SPKI-pinned transport, with
no plaintext fallback.

The transport is what makes it **native-only**. `useBackendSelection` builds the
adapter with `createPinnedFetch(spkiPin)` from `src/platform/native-bridge.ts`,
which routes the request through the app wrapper's native `pinned-fetch` module
so the daemon's self-signed certificate is validated against the SPKI pin from
the pairing code. On the plain web that pinned fetch rejects, so
`useStorageBackend` reports `notesdAvailable` (i.e. `isNative()`) false and the
storage picker never offers the option there.

Pairing (`useNotesdBackend`, `src/storage/notesd/pairing.ts`): the daemon prints
a `notesd://pair?…` QR/paste code carrying its address(es), SPKI pin, and a
single-use token; `parsePairingUri` validates it and normalises the pin to
standard base64, `pairNotesd` redeems the token over the pinned fetch
(`POST /v1/pair`) for a per-device key, stores the config
(`getNotesdConfig`/`setNotesdConfig` in `backend-preference.ts`), and unlocks the
**Self-hoster** achievement. The pair UI is `PairNotesdForm` in `StorageSection`:
paste the code, or — in the installed app — tap **Scan QR** to read the daemon's
startup QR with the camera. The scan is bridged natively: `qr.scan()`
(`src/platform/native-bridge.ts`) posts a `qr.scan.request`, `WebViewHost`
mounts the `QrScanner` (`expo-camera`) overlay and injects the decoded string
back via `resolveQr`, and the form feeds it through the same
`parsePairingUri → resolvePairing → pairNotesd` path as a pasted code. The
button only renders under `isNative()`; on the plain web `qr.scan()` rejects and
paste is the only path.

Like the folder/cloud backends, notesd syncs its **appearance settings** and
**namespace registry** across paired devices: `createNotesdSettingsStore` and
`createNotesdNamespaceStore` (`src/storage/notesd/index.ts`) read/write
`settings.json` / `namespaces.json` over the daemon's `GET/PUT /v1/settings/{name}`
endpoint (both names are on the daemon's reserved list, kept off note listings),
and `useStorageBackend` returns them from the `notesd` case instead of `null`. So
a theme change or a new namespace made on one paired device lands on the others.
Removing a namespace deletes its whole subfolder on the daemon too
(`deleteNotesdNamespace` lists `<slug>/` via `GET /v1/blobs?prefix=` and deletes
each note and attachment blob) so no orphaned bytes are left behind; the daemon
prunes the now-empty folders. The default namespace shares the folder root with
the settings files and has no subtree of its own, so it is never deleted.

**Config plane** (`src/storage/notesd/config-plane.ts`, `useNotesdDiscovery`):
so a daemon can be found on your *other* devices without its QR, pairing
publishes a small `notesd.json` to whichever cloud backend
(Dropbox/Drive) is connected — a list of `{name, endpoint, fingerprint}` at the
app-folder root, written via `createDropboxConfigPlaneStore` /
`createGdriveConfigPlaneStore` (a root `FileStore`, the same pattern as the
settings/namespace stores). It is **credential-free by design**: never a device
key or token, so per-device keys stay per-device and there is nothing sensitive
for the provider to read (the pin is a public-key fingerprint, the endpoint just
an address), which is why the file is plaintext. `useNotesdDiscovery` reads it
from the connected cloud tokens (independent of the active `selection`, since
notesd is the active document store) and `StorageSection` lists the discovered
daemons; picking one pre-fills its address+pin so pairing only needs a fresh
credential — the device still redeems its own, preserving the model.

### Directory adapter

`createDirectoryAdapter` (`src/storage/directory-adapter.ts`) over a `FileStore`
(`src/storage/file-store.ts`) — the shared sync logic for all three file
backends. It reads every `*.md` (now **recursively**, so notes filed into a
folder's subdirectory are found) into a snapshot, writes each note to its
folder-aware path (`noteFilePath`), writes only changed notes (hash-compared),
removes only files it authored — so a note that changes folder is moved by
writing the new path and removing the old — and scopes conflicts per-file so
another device's edit to a different note never blocks a save. The
[folder registry](#folders-sidecar) keeps the last-loaded folders (via
`rememberFolders`) so its `plaintextNotePath` lets the per-note encryption
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
[encryption migration](#encryption-migration) — the latter three are
implemented in `src/storage/migration-converters.ts`
(`createMigrationConverters`), lifted out of the adapter closure but wired back
through an explicit deps bundle so the byte-level behaviour is unchanged; the
pure encrypted-note JSON codec they share with `save` (`noteToEncJson` /
`encJsonToNote`) lives in `src/storage/enc-note-codec.ts`. A representation
conversion is
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
`<slug>-<id-suffix>.md` filename. `noteFilePath` / `noteDirName` /
`folderDirName` / `folderDirSegment` resolve the directory a note is filed into
— the **physical folder directory** of a grouped note (`<folder-dir>/<stem>.md`,
the folder-name slug) and the [archive directory](#archive-directory) of an
archived one — and `noteToMarkdown` takes a `depth` so a nested note points its
on-disk attachment references up one extra `../` per level to reach the sibling
`attachments/` tree. `parseFiles` is the reporting form of `filesToSnapshot`:
same result, plus the paths that failed to parse, which the directory adapter
surfaces as [orphan files](#orphan-files) instead of discarding.

### Archive directory

Archiving is a soft delete in the document (see [archive /
restore](#archive--restore)); on the file/cloud backends it is also a **move on
disk**. An archived note's file lives under `archived/` at the namespace's notes
root, so the synced folder mirrors what the app shows — the root holds exactly
the notes the overview lists, and everything swiped away sits in one directory
that can be browsed, shared, or deleted wholesale. A note that is both archived
and grouped nests as `archived/<folder-dir>/<stem>.md`.

Both representations move: the plaintext `.md` and the encrypted `.enc` alike
(`ARCHIVED_DIR`, `noteDirName` in the codec; `encNotePath` in the directory
adapter). The encrypted filename is a keyed HMAC of the note id *alone*, so
archiving changes only the directory, never the name — which means the bytes can
be transferred verbatim. Note that with the ciphertext filed this way, an
observer of the raw folder can see how many notes are archived, though not which
ones or what they say; that is the deliberate trade for a layout that reads the
same whether or not encryption is on.

The `archived: true` frontmatter (and, encrypted, the sealed note JSON) stays
the **authoritative** flag the load reads back, so the directory is a write-side
projection only: a file in the "wrong" place still loads with the state its own
contents declare, and the next save relocates it. That is what makes the upgrade
free — notes archived by an older build sit at the notes root, load correctly,
and move the first time anything is saved.

`relocateDeferred` (`src/storage/directory-adapter.ts`) covers the one case the
ordinary write path can't. Archiving a note whose body was never loaded (a
**deferred** note on an encrypted backend) leaves nothing to write — the save
skips it — while its old path is tracked and unwanted, so the planner would
delete the only copy. The relocation pass moves the bytes first, turning it into
an ordinary rename; it runs after the conflict check and before the removals, so
an interruption leaves both copies rather than none.

### Orphan files

A file/cloud backend keeps your notes in a folder **you** can also open and
write to, so a load turns up files that aren't notes. Two kinds
(`OrphanReason`): `unreadable` — a `.md` with no frontmatter or no `id:`,
typically hand-authored in the synced folder — and `foreign`, a file whose
extension the app doesn't own at all. Sidecars (`folders.json`, the key params,
the encrypted index, the legacy blob) and dotfiles (`.DS_Store` and friends) are
never flagged.

The important half is what *stopped* happening. An unreadable `.md` used to be
skipped by the codec, yet it was still tracked from the directory listing and
absent from the desired set — the exact signature of a deleted note — so the
next unrelated save deleted it. The directory adapter now subtracts the orphan
set from both `plan`'s removals and the representation supersede, so an
unrecognised file is never removed as a side effect. `removeOrphan` is the only
path that deletes one, and it takes an explicit decision.

`getOrphans` reports what the last load found; `readOrphan` / `removeOrphan` act
on it, both scoped to the reported set so neither becomes a general read or
delete of anything under the notes root. `useOrphans`
(`src/app/use-orphans.ts`) reads the set once each load settles and drives
`OrphanFilesModal`, which offers the three answers that exist per file: **import
as note** (its contents become the body, its filename the title, via
`importFiles`; the original is deleted afterwards, since the adopted note is
rewritten at the app's own canonical path), **delete file**, or leave it alone —
either for now, or for good via `orphan-ignore.ts`. That ignore list is
deliberately device-local `localStorage`, keyed per backend + namespace:
"don't bother *me* about this" is a per-device preference, and syncing it would
let one device silence a file the others have never shown their user.

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

**Encryption is per namespace.** A [namespace](#namespaces) is a bucket several
people can share through one login and one folder, so the decision to seal one
is a decision about that bucket alone: sealing the namespace you keep your own
things in must not seal the one you share with four other people, and — the half
that actually bites — a namespace *they* sealed must not lock you out of yours.
So every piece of encryption state in `useEncryption`
(`src/storage/useEncryption.ts`) is keyed by slug: the mode
(`notes:encryption:<slug>` in localStorage), the session passphrase, the "why am
I locked" hint, the de-encryption drain flag. `locked` is only ever a statement
about the namespace currently open, `adoptEncryptedRemote` adopts the *active*
namespace's discovered encryption, and the salts sidecar already lived inside
each namespace's own folder. The
[locked-namespace switcher](#locked-namespace-switcher) on the unlock gate makes
switching away a way *out* of a lock rather than something the lock prevents,
and a cross-namespace note/folder move into a namespace this session hasn't
opened is refused rather than attempted.

The account-wide `notes:encryption` flag written before this was a per-namespace
choice is still read as the **fallback** for a namespace with no setting of its
own, rather than migrated on boot: an existing encrypted install reads exactly
as it did, without needing the namespace list resolved before the encryption
state can be answered (at boot, it isn't). The first explicit write for a
namespace takes over for good.

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
so titles, filenames, and grouping don't leak. The passphrase rides a per-namespace
`passwordRef` (`cryptoFor(slug)`, stable per slug) so a runtime
unlock/enable/disable doesn't rebuild the adapter;
after reload every encrypted namespace is locked until the
[unlock gate](#unlock-gate) takes its passphrase (verified against the per-file notes, or the sealed offline cache).
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
Two things keep an index in place so the fallback stays rare: every encrypted
`save` rewrites it, and the [encryption migration](#encryption-migration) calls
`refreshIndex` the moment it finishes sealing a freshly-encrypted vault (the
paced `migrateNote` writes `.enc` files but never the index, so this is what
makes the very first unlock after enabling encryption index-fast rather than a
full per-note decrypt). A load that couldn't render entirely from the index —
no index at all (a vault from before the index existed), or one another device
left **stale or incomplete** (missing rows, moved revisions, or orphan rows for
deleted notes), which forced some notes into the per-note fallback — self-heals
by rewriting the index from the authoritative picture it just built, so it pays
that fallback cost only once instead of on every unlock.
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
(`getEncryptionStatus`, drives the [lock](#note-card) in the overview and side
menu) and a live `conversion` snapshot (`EncryptionConversionState` — which
note/attachment, how far along, any error, a capped log). When every note is
sealed it **seals the [note index](#encryption)** from the in-memory snapshot
(`refreshIndex`) and fires the **Fort Knox** achievement; when every note is
back to plaintext it calls `onDisableComplete` to finalise the turn-off. The
index refresh matters because the per-note `migrateNote` never touches the
index, so without it the index would stay absent until the next regular save —
and the *first* unlock after enabling encryption would fall back to decrypting
every note (the slow path lazy decryption exists to avoid) instead of rendering
instantly from the index.

### Cross-device encryption enforcement

Encryption is a **per-device** preference (`notes:encryption` in
[backend-preference](#backend-preference)), so turning it on for one device
doesn't automatically flip the others — yet leaving a second device in plaintext
mode is worse than a nuisance: it can't read the `.enc` notes at all, and any
note it writes lands as a plaintext `.md` sitting in the clear right beside the
sealed ones. So the file/cloud backends **enforce** encryption across every
device that syncs the same folder, in two directions:

- **Adopt inbound plaintext (the encrypted device).** When an encrypted device
  loads and finds a plaintext `.md` another device left behind,
  `readEncryptedSnapshot` merges it into the document marked `pending`, and the
  background [encryption migration](#encryption-migration) then seals it
  (`migrateNote`) and removes the plaintext — so a note created on a
  not-yet-locked device is quietly pulled into the vault rather than lingering
  unencrypted.
- **Lock the plaintext device (the other device).** When a device running in
  plaintext mode loads a folder that holds `.enc` files, the
  [directory adapter](#directory-adapter)'s `load` raises `EncryptedRemoteError`
  (`src/storage/adapter.ts`) instead of returning a misleading empty /
  plaintext-only document. It keys off the presence of `*.enc` files, **not** the
  `.keyparams.json` salts sidecar (which lingers after encryption is turned off),
  so a genuinely-plaintext folder never trips it. The [sync engine](#sync-engine)
  catches it — on the first load and on every later reload / live pull — and
  calls `onEncryptedRemote`, wired to `adoptEncryptedRemote`
  (`src/storage/useEncryption.ts`): it flips this device's mode to `encrypted`
  with no passphrase held, so `locked` goes true and the [unlock gate](#unlock-gate)
  appears. The gate reads its "encryption was turned on from another device"
  copy off the `encryptionFromRemote` flag the same hook exposes. Entering the
  shared passphrase then unlocks the device (and, via the adopt path above,
  absorbs any plaintext notes it had created before it locked). This is the
  **Key handoff** achievement (fired from `adoptEncryptedRemote`).

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

### Unsynced mirror

The mirror records not just the bytes and their `revision` but whether those
bytes ever **reached** the backend, as `pending` on the `StoredSnapshot`
(`src/storage/adapter.ts`). A save that fails offline writes the attempted
document with `pending: true` and keeps the last revision the backend *did*
confirm — so on a pending mirror `revision` means "the baseline this text was
written on top of", not "the revision of this text".

It exists because the in-memory retry queue dies with the page. Closing the app
with an unsaved edit used to leave bytes on disk indistinguishable from synced
ones, and the next launch either lost the edit to the incoming load or wrote it
over another device's newer work as though nothing had happened. Now the
[sync engine](#sync-engine) reads the mark at mount, re-queues the document as
dirty, and pushes it against that confirmed revision — so if another device
wrote in the meantime the backend refuses the write and the
[conflict modal](#conflict-modal) asks, instead of one side silently winning.

The mark is cleared by any successful save, and by a successful `load()`
write-through: the backend is reachable again and these are its bytes, while
the unsynced copy has already been taken by the engine synchronously at mount.
Clearing there is what lets "keep the other copy" on the resulting conflict
actually stick rather than reappearing on the next launch. Mirrors written by
older builds carry no mark, which is correct — they came from a successful load
or save.

## Namespaces

### Namespaces

`src/storage/namespaces.ts` — named buckets, each holding its own note document.
A `Namespace` is `{ slug, name, glyph?, color?, pin? }`; the `slug` is fixed at
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
appearance, [PIN verifiers](#namespace-pin)) to `namespaces.json` at the file
backend's root via `fileNamespaceStore`, so it travels with a shared folder and
lands on every device. Plaintext even when notes are encrypted; the browser backend keeps the
registry in localStorage and has no file store. `mergeNamespaceLists`
reconciles local and remote on a new-device connect.

### Namespace PIN

`src/storage/namespace-pin.ts` + the PIN verbs on `useNamespaceRegistry` — a
short code that has to be entered before a namespace opens on this device. It
exists for the shared arrangement: it stops the namespace you keep to yourself
from opening because somebody tapped the wrong row, and it stops a
shoulder-surfer or a borrowed phone from reading it.

What is stored is a PBKDF2-SHA256 verifier (`{ salt, hash, iterations }`) on the
registry entry — never the code — so it rides `namespaces.json` and every
device, and everyone sharing the folder, is asked for it. Verification is
constant-time. Entered codes are remembered in module state for the page's
lifetime only: a PIN that survived a reload would be gating the first tap of the
session and nothing else.

**It is deliberately a soft lock, and the UI says so.** The verifier sits in a
file everyone sharing the account can read, so it can be attacked offline; a
code short enough to type on a phone has a small keyspace; and the notes behind
it are still plaintext at rest. [Encryption](#encryption-at-rest) is the real
protection — it is per namespace too, and the bytes are unreadable without the
passphrase. The two compose, and Settings → Storage puts them next to each
other so the comparison is unavoidable. Setting one unlocks the **Door code**
achievement.

While the gate is up the storage adapter is the same locked placeholder an
encrypted namespace gets, so the notes are never read into memory behind it.
`NamespacePinGate` (`src/ui/NamespacePinGate.tsx`) is the screen, and it is
asked for **before** the encryption passphrase when a namespace carries both.

### Locked-namespace switcher

`LockedNamespaceSwitcher` (`src/ui/LockedNamespaceSwitcher.tsx`) — the way out
of a locked namespace, carried by both full-screen gates (the
[unlock gate](#unlock-gate) and the [PIN gate](#namespace-pin)). Both locks are
per namespace, and a namespace shared through one login is exactly the one
somebody else may seal with a passphrase you were never given; without this bar
their lock would take the whole app down with it, including the namespaces that
are entirely yours. It lists every other namespace with its own lock state
marked, and a press switches the active one — the gate then either falls away
or re-asks about that namespace instead.

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

### Namespace settings store

`src/storage/namespace-settings-store.ts` — the middle
[settings width](#settings-scopes), written as `namespace-settings.json`
**inside the namespace's own folder** (the app-folder root for the default
namespace, `<slug>/` for the rest), beside its `notes/` and `attachments/`
subfolders. Deliberately not called `settings.json`: the default namespace owns
the app-folder root, where that name is already the account-wide file's.

Putting it in the namespace folder is the point — a namespace folder shared
wholesale carries the settings its users agreed on along with its notes.
Plaintext even when the notes are encrypted, and **sparse**: only the settings
that namespace actually has an opinion about, so everything else keeps falling
through to the global layer.

The notesd daemon's settings endpoint is a flat root namespace with no
subfolders to nest a file in, so there the default namespace takes the bare name
and every other one prefixes its slug (`work.namespace-settings.json`); the
daemon allows exactly that shape and refuses anything else
(`is_namespace_settings` in `notesd/src/store.rs`).

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

**Sliding the drawer open reveals the note you have open.** If the active note
is filed in a folder, that folder springs open as the drawer appears, so the
highlighted row is on screen rather than hidden behind a collapsed header —
which is the one thing the drawer is meant to orient you by. The effect is keyed
on the *folder*, not on the expanded set, so collapsing it by hand afterwards
sticks: it only runs again when the drawer reopens or the active note moves to a
different folder. The [docked sidebar](#pinned-sidebar) never opens, so there it
runs as the active note changes instead. A note pointing at a folder the
registry no longer has renders ungrouped, so there is nothing to reveal for it.

How the folders and loose notes are ordered is two appearance preferences (see
[appearance store](#appearance-store)). **`folderPlacement`** is `top`
(folders pinned above the loose notes — the historical layout) or `mixed`
(folders interleaved with the notes by the sort key, via `mixTopLevel`).
**`noteSortKey`** is `modified` (most-recently-edited first) or `name`
(alphabetical); `sortNotesBy` orders the notes and a folder's contents, and
`sortFoldersBy` orders the folders — by name, or by their newest note's
timestamp (`folderModifiedAt`). These ordering helpers (and `mixTopLevel`,
and the `NoteSortKey` type itself) are pure functions over the note model in
`src/domain/note.ts` — `SideMenu` only consumes them. Both are set in
**Appearance → Sidebar**.

The drawer lists **every** loose note, not a window of the most recent few.
It used to cap the list at `MAX_RECENT_NOTES` (6) and leave the rest to
"Show all", which had a sharp edge: the cap was applied by sorting with
`noteSortKey` and slicing afterwards, so under `name` it kept the
*alphabetically first* six rather than the six most recent — a freshly created
note whose title sorted past the cap never appeared in the drawer at all, on
any device, while the uncapped overview listed it at the top. Listing
everything removes the failure mode along with the cap.

That makes the note list the one part of the drawer that can outgrow the
viewport, so it is its **own scroll region**: everything above the
[button island](#folders-in-the-side-menu) (the namespace switcher, Favorites,
the folders and the loose notes) sits in a `flex-1 min-h-0 overflow-y-auto`
container, and the island, the footer-collapse rail and the footer are pinned
outside it. Both `<nav>` variants — the docked sidebar and the slide-in drawer
— are therefore `overflow-hidden` rather than `overflow-y-auto`: the frame no
longer scrolls as one column, so a long list can never carry the island and
the footer off the bottom. `min-h-0` is load-bearing (a flex item's floor is
its content height without it, which would push the pinned rows off-screen
instead of scrolling), and `flex-1` is what keeps the island at the foot when
the list is short — the job the island's own `mt-auto` used to do alone.

The **button island** is one bordered block (`BarButton`), extracted as a
self-contained `SideMenuActionBar` (`src/ui/SideMenuActionBar.tsx`) the drawer
renders below the list, pinned to its foot (`mt-auto`) instead of full-width
rows, to save vertical space: a top
row of **New note / New folder / Show all / Archive** and a bottom row of
**Undo / Redo / Search** and the [sync glyph](#sync-status), split by a divider
so the icon buttons read as one coherent unit rather than competing widgets. The cells sit flush against one another (the
parent owns the border, rounding, and the inner `divide-x` / `divide-y`
dividers) and split their row's width evenly so each row reads symmetric. The
buttons are **icon-only** — the label rides on `aria-label` / `title` rather than
visible text. New folder drops the inline `FolderEditRow` into the list above;
Show all and Archive tint accent when their view is showing; Archive carries the
archived-note count as a corner badge and doubles as a drop target; Undo / Redo
dim and go inert (`disabled`) at the ends of the timeline but keep the drawer
open so a burst of reverts can be applied without reopening it. The row's last
cell is the `syncSlot` — the [sync glyph](#sync-status), which styles itself as a
cell of this island and is absent entirely on the local backend.

The drawer's **footer** — pinned below the island — is the relocated burger
menu, extracted as a self-contained `SideMenuFooter`
(`src/ui/SideMenuFooter.tsx`) the drawer renders with just an `onClose` prop: an
optional donate link, the trophy ([achievements](#achievements)), an **About**
dropdown, and settings pinned last, built from the footer-local `MenuButton` /
`MenuLink` row primitives. The **About** row is a plain footer row (no chevron)
that toggles a `FloatingPanel` of the project links — What's new
([changelog](#changelog--whats-new)), source (with the build label as a
subtitle), and privacy. The panel flips **upward** (`ABOUT_PLACEMENT`, anchored
left, viewport-spaced) because there is no room below it at the foot of the
drawer. The dropdown's open state (`aboutOpen` / `aboutRef`) lives inside
`SideMenuFooter`, so nothing of the footer leaks back into the drawer container.

Seated just above the footer is the **footer collapse rail** (`FooterCollapseRail`
in `src/ui/SideMenuRows.tsx`): a thin, full-width chevron button that folds the
whole footer away, handing its vertical space to the note list, and taps back to
restore it. The choice is drawer-owned view state (`footerCollapsed` in
`SideMenu`) but — unlike the folder/namespace expand state — it is persisted to
`localStorage` under `notes/footer-collapsed`, so it survives reloads; it applies
on every viewport (docked sidebar and phone drawer alike). Folding it fires the
**Space saver** [achievement](#achievements) (`unlock("spaceSaver")`).

The drawer renders **edge to edge** — the installed iOS PWA paints under the
home indicator (a `@supports (-webkit-touch-callout: none)` /
`display-mode: standalone` rule in `theme.css` forces the root to `100vh`;
without it iOS letterboxes a percentage-height root and leaves a dead black
band below the shell that the footer/rail would float above). Because of that
the drawer reserves **no** bottom safe-area inset (its `<nav>` pads only the
top), and all the bottom breathing room lives on the footer instead: the
`SideMenuFooter` container carries a `calc(1.25rem - var(--density-row-py))`
top padding and a `calc(1.25rem - var(--density-row-py) + 10px)` bottom padding
— the extra 10px keeps the last row (**Settings**) a comfortable thumb reach
above the screen edge rather than sitting on it. The action bar's `mt-auto`
pins the action bar / rail / footer flush to the foot of the drawer, so with
the footer collapsed the rail rests snug against the bottom with nothing below
it, and expanded the footer's own padding is the gap beneath **Settings**.

A note row can be **dragged onto a folder** to file it, or onto the ungrouped
root zone to take it out of one. On a pointer device this is native HTML5 drag
(`NOTE_DND_TYPE` carries the note id; the highlight follows `dropTarget`, and a
drop on a folder calls `stopPropagation` so it doesn't bubble to the root
zone); on a touchscreen it's a **press-and-hold** gesture (see
[note drag](#note-drag-touch--pointer)). Dragging is the only way to file a
note: the editor header carries no folder control.

### Folders in the overview

`NoteList` (`src/ui/note-list/NoteList.tsx`) mirrors the same grouping: with at least one
folder it renders a collapsible section per folder (each a drop target, with a
"New note" shortcut) followed by the ungrouped notes under a "No folder" label
(itself the drop zone for moving a note out). Cards drag onto folders exactly
like the side-menu rows — HTML5 drag on a pointer device, press-and-hold on
touch. With no folders it falls back to the flat list unchanged.

Each folder header carries the same hidden edit + delete actions the side
menu's [`FolderRow`](#folders-in-the-side-menu) does (`OverviewFolderHeader` in
`src/ui/note-list/NoteList.tsx`): a **left swipe** latches open an `[edit | delete]` strip on
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
`App`) renders the ghost and reports a drop as `onDrop(item, key)` — the dragged
item (a note or a folder) and the raw target key, which `App` resolves to an
action. `NoteDragItem` is the per-row wrapper that wires the desktop HTML5 props
and the touch handlers together (a `kind` prop marks a folder row); drop
targets read the hovered key via `useNoteDropKey` to paint their highlight. The
side menu and the overview both carry `select-none` so a drag never paints a
text selection across the rows it crosses.

**Ending the gesture reliably.** Only `onPointerDown` lives on the row;
`useTouchNoteDrag` binds `pointermove`/`pointerup`/`pointercancel` to **`window`**
for the rest of the drag (dropped on cleanup). Keeping them on the row instead
would lean on the pointer capture `engage` requests — but capture is best-effort
(some engines refuse it mid-gesture, and a pen/touch point can drift off the
row), and a release the row never sees would leave the lifted note frozen
mid-air. Off `window` the release is caught wherever the pointer ends up; a
`pointercancel` aborts without filing.

That covers a release that lands anywhere, but not the screen being seized while
the finger is _still down_ — a background save colliding with another device
raises the non-dismissable conflict modal over the list mid-drag. For that, `App`
hands `NoteDragProvider` an `aborted` prop (`sync.conflict !== null`); on its
rising edge the provider clears the chip and bumps `DragAbortContext`, which each
active `useTouchNoteDrag` watches to tear its gesture down (so the lifted note
can't hover over the modal, and a later release can't commit a move into the
unresolved conflict), and which the native HTML5 drop zones in the overview and
side menu watch via `useNoteDragAbort` to clear a lift that `dragend` would
otherwise never resolve once the dragged row unmounts. The drag-to-folder
gesture also reports itself through `ReportDragActivityContext`
(`src/ui/drag-activity.ts`) so pull-to-refresh stands down for its duration — see
[pull to refresh](#pull-to-refresh).

The drop-target keys (see `note-drag-context.ts`) span four kinds of target:

- a **folder id** — file the note into that folder, and `NOTE_DROP_ROOT` — take
  it out of every folder (both surfaces);
- `NOTE_DROP_ARCHIVE` — the side menu's **Archive** row, which archives the note;
- `ns:<slug>` (`noteDropNamespaceKey`) — a side-menu **namespace** row, which
  moves the dragged item into that namespace.

A dragged item is either a single **note** or a whole **folder**
(`DragItem.kind`, reported via `onDrop(item, key)` and — for the touch path's
highlight gating — `useNoteDragKind`). A folder header is a drag source too: on
a backend with more than one namespace its row becomes draggable (HTML5 on
desktop with a distinct `FOLDER_DND_TYPE` MIME, the long-press gesture on
touch), and the only target it resolves against is a namespace row — every
notes-only target (a folder, the root zone, the Archive row) ignores a folder
drag and withholds its highlight (`noteDropActive`).

The archive and namespace targets are **side-menu only**. Moving a note across
namespaces is a cross-document write: `useStorageBackend.moveNoteToNamespace`
hydrates the note's attachment bytes (so they travel), builds an adapter for the
target namespace's storage location on the same backend (`makeInner(slug)`),
prepends the note to that document, and saves; `App` then removes it from the
source namespace. The source folder link is dropped (the target has its own
folders). It's best-effort — if the target write fails (offline cloud) the note
is left in place — and undo restores the source copy (which can leave a copy in
both namespaces, the one rough edge of the cross-document move).

Moving a **folder** across namespaces moves all of its contents:
`useStorageBackend.moveFolderToNamespace` hydrates each filed note's body and
attachment bytes (the encrypted backends keep both deferred in the list),
writes the folder record **and** its notes into the target document — each note
keeps its `folderId`, so it stays filed under the folder there — and saves;
`App` then clears the folder and its notes from the source in one undoable step
(`removeFolderWithNotes`). Same best-effort contract as the per-note move (a
failed target write leaves the source untouched). If the open note belonged to
the moved folder, `App` leaves the editor since it's gone from this namespace.

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
disk until a note is filed into it. A dedicated `createFolderRegistry`
(`src/storage/folder-registry.ts`) owns it, lifted out of the
[directory adapter](#directory-adapter) so the sidecar's state and read-retry
logic live (and test) on their own: `readFolders` / `injectFolders` fold the
registry into the loaded snapshot (and load a namespace whose only content is
empty folders as a real, non-null document), and `persistFolders` writes it back
when it changed (writing `[]` to clear a registry whose folders were all
removed). The adapter consumes the registry by destructuring those helpers and
reaches its two stateful touch points via `readOk()` (the load memo gate) and
`rememberFolders()` (the save). `readFolders` reads
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
read-OK flag (`readOk()`) so the load is **not memoized** (and a later refresh
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
([Editor settings](#editor-settings)), `transforms` ([Transforms](#transforms)),
and the achievements map + unseen queue.
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

`renderInlineMarkdown` / `renderMarkdownDoc`
(`@niclaslindstedt/oss-framework/changelog`, called from
`src/ui/changelog/ChangelogModal.tsx`) — the dependency-free Markdown renderers
for the changelog bullets and the feature-doc bodies, with the `feature:<slug>`
link scheme for in-modal cross-links.

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

### App icon

Every icon the app is *represented by* — browser tab, iOS home screen, Android
launcher, Windows taskbar, the macOS Dock — is generated from **one** file,
`public/favicon.svg`: a document glyph (a page with a folded top-right corner
and two text lines, stroked in the green `ink` gradient) on a full-bleed
`#1f2933` `<rect>` matching `theme_color`. `make icons` runs
`@vite-pwa/assets-generator` over it with `pwa-assets.config.ts` and rewrites
every raster in `public/`; the outputs are committed, and **no CI job checks
that they match the SVG**, so regenerating in the same change as an artwork
edit is a manual discipline. (Skipping it is how the committed rasters came to
be a generation behind the SVG.)

Three variants come out, and the difference between them is only how much the
generator insets the artwork before centring it on the dark background:

- **`pwa-{64,192,512}.png`** (`purpose: "any"`) and
  **`apple-touch-icon-180x180.png`** — padding 0, so the SVG lands on the
  canvas 1:1. The mark fills ~67% of the tile, inside the 60–80% band Apple's
  HIG asks for.
- **`maskable-icon-512x512.png`** (`purpose: "maskable"`) — padding 0.1, which
  shrinks the mark to ~61% so every foreground pixel clears the W3C
  80%-diameter safe circle whatever shape an Android launcher masks it with.
- **`maskable-icon-1024x1024.png`** — the same artwork at the largest size an
  `.icns` carries. It is not in the manifest and is excluded from the
  service-worker precache; it exists solely as `ICON` in
  `electron/electron-builder.config.cjs`, which converts it into the desktop
  app's `.icns` / `.ico` / PNG set.

Every output is **fully opaque, edge-to-edge** — there is no transparent margin
anywhere in the set. That is a requirement, not a stylistic choice: iOS paints
transparent regions white, and the macOS 26 Dock masks every app icon into the
system squircle and treats artwork carrying its own margin as a legacy icon,
insetting it further and filling the rest of the shape with a light backdrop.
An icon with a 2.5% transparent border therefore shows up in the Dock as a
small dark tile floating on a white plate rather than filling its shape. The
cost of the full-bleed source is that macOS 15 and earlier, which apply no
mask, draw it as a literal square.

Two follow-on notes. The mark is **stroked, not filled**, so its real extent is
half a `stroke-width` past the path coordinates on every side, scaled by the
group's `scale()` — reason about the raster, not the `d` attribute. And the
dark `#1f2933` is written in four places that must be retoned together: the
`<rect>` fill in `favicon.svg`, `THEME_BACKGROUND` in `pwa-assets.config.ts`,
`theme_color` / `background_color` in `vite.config.ts`, and `FAVICON_BG` in
`src/ui/glyphs.ts`, which paints the same plate behind a
[namespace's glyph](#namespace-favicon) so a re-badged tab icon still reads as
the same app.

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

### Embedded (wrapper) builds

`isEmbedded` / `__EMBEDDED__` (`vite.config.ts`, `src/vite-env.d.ts`) — true
when the bundle is being built for one of the two wrappers that ship the app as
a downloadable binary: `VITE_TARGET=native` (the React Native WebView shell in
`native/`) or `VITE_TARGET=electron` (the desktop shell in `electron/`). It
flips three things at once: the asset base becomes relative (`./`) so
`/assets/...` URLs resolve under a `file://` or private-scheme origin; VitePWA
is disabled, because offline is already guaranteed by the on-device bundle and
a service worker has no HTTP origin to attach to; and the sidecar emitters
(`version.json`, `precache-manifest.json`, the `/privacy` and `/home` aliases)
are skipped, since nothing in a wrapper reads them. `usePwaUpdate`
(`src/pwa/usePwaUpdate.ts`) reads `__EMBEDDED__` to know there is no service
worker to register.

### Capabilities

`platform()` / `capabilities()` (`src/platform/capabilities.ts`) — the single
answer to *which surface is this, and what can it do*. `platform()` returns
`"native"` (the `native/` WebView wrapper, detected by
`window.ReactNativeWebView`), `"desktop"` (the `electron/` shell, detected by
its private `notes:` scheme), or `"web"`. `capabilities()` turns that into the
four things that actually differ:

- **`folderPicker`** — the File System Access API behind the
  [folder backend](#folder-backend). A browser-engine question (Chromium yes,
  Firefox/Safari no), so it is true in both wrappers.
- **`redirectOauth`** — whether a redirect-based OAuth flow can complete on
  this origin. False on the desktop: `redirectUri()`
  (`src/storage/oauth-pkce.ts`) is built from `window.location`, so it is
  `notes://app` there, and no provider will register a custom scheme (Google
  rejects non-`https` outright).
- **`loopbackOauth`** — whether the redirect can be caught on a
  [loopback listener](#loopback-oauth) instead. True only on the desktop, and
  complementary to the flag above by construction: it is what gives that
  surface cloud sync despite failing it.
- **`pinnedFetch`** — SPKI-pinned HTTPS behind the
  [notesd backend](#notesd-backend). Native code only.

`useStorageBackend` reads all four of its availability flags from here
(`dropboxAvailable`, `gdriveAvailable`, `folderAvailable`, `notesdAvailable`)
rather than re-deriving each at its own call site. That centralisation is the
point: before it, the desktop build offered no cloud sync and the reason looked
like the packaging job not passing `VITE_DROPBOX_APP_KEY` /
`VITE_GOOGLE_CLIENT_ID`, when the real one was that the redirect could never
land. The module lives in `src/`, not in a wrapper: the page works its surface
out from what it can observe, and no shell tells it anything.

Note that `dropboxAvailable` and `gdriveAvailable` are no longer the same
expression. Dropbox takes either OAuth flow, so it is offered wherever one of
them works. Drive signs in through Google Identity Services' popup rather than
the shared PKCE helpers, and the loopback flow would additionally need a Google
OAuth client of the **Desktop app** type — a different registration from the
web client — so it stays gated on `redirectOauth` alone.

### Loopback OAuth

`runLoopbackAuth` (`src/storage/oauth-pkce.ts`) + `beginLoopbackRedirect` /
`awaitLoopbackRedirect` (`src/platform/desktop-bridge.ts`) + the listener in
`electron/main.js` — how the desktop build signs in to a cloud provider at all.

The problem it solves: the desktop app is served from `notes://app`, and no
provider will accept a custom scheme as a redirect URI, so the web flow
(`startAuth` navigating away and the provider redirecting back to the app's own
origin) has nowhere to land. The answer is the one RFC 8252 prescribes for
native apps — open the consent screen in the user's **real browser**, and
receive the redirect on a loopback listener the app opens for the occasion.

The split is deliberate and is the same one the
[native bridge](#notesd-backend) makes. The Electron shell holds the socket and
nothing else: it binds `127.0.0.1` (never `0.0.0.0`, which would put a listener
holding a live authorization code on the local network), takes the first free
port of three fixed ones, closes the instant a redirect arrives, and times out
after five minutes. It does not know which provider is being connected or what
the code is worth. Everything decided — the PKCE challenge, the `state` check,
the token exchange — is in `runLoopbackAuth`, which also passes the loopback
URI explicitly to `completeAuth`, since `window.location` knows nothing about
it and the providers re-check the URI at the token endpoint.

It needs no preload and no IPC: the page reaches the shell by `fetch`ing two
reserved paths (`__oauth/begin`, `__oauth/await`) on the `notes://` scheme the
protocol handler already serves. The ports are fixed rather than ephemeral
because providers match redirect URIs exactly, so each one has to be on the
Dropbox app's allowlist up front — `LOOPBACK_PORTS` in `electron/main.js` and
the list in `src/storage/dropbox/index.ts`'s header comment are the two halves
of that, and drift between them fails at the consent screen.

`connectDropbox` (`src/storage/useCloudBackend.ts`) is the one verb over both
shapes. On the web it navigates away and the boot effect completes the
round-trip; on the desktop the whole thing resolves in place, so the tokens are
stored right there and a failure rejects to the settings panel — there being no
redirect to explain a silent one.

### Desktop app (Electron)

`electron/` — a **thin** Electron window around the same compiled web app. The
entire main process is `electron/main.js`: it registers a private `notes://app`
scheme, serves `electron/webroot/` (the embedded build, written by
`electron/scripts/bundle-web.mjs`) from it, opens one sandboxed
context-isolated window, and sends off-origin links to the system browser.
There is no preload, no IPC, and no storage the renderer can see — the embedded
app runs its own `localStorage`, exactly as it does in a browser tab. It is
plain CommonJS rather than TypeScript (compiling one file would put generated
output between the source and what runs), but not unchecked: `// @ts-check`
plus `electron/jsconfig.json` type-check it against Electron's own
`electron.d.ts` with no emit, run by the `electron` job in `ci.yml` because the
root `make lint` / `make test` stop at that directory's edge.

The one thing the shell owns is the window's **remembered size and position**
(`window-state.json` in the app's user-data directory, written on `close`),
because a web page cannot size or place its own OS window. It reads that file
defensively: bounds are saved from `getNormalBounds` so a maximized window does
not restore at screen size forever, a rectangle that no longer overlaps any
connected display keeps its size but drops its position (an unplugged monitor
would otherwise strand the window off-screen), and an unreadable or malformed
file falls through to the 1100×800 default.

The private scheme rather than `loadFile` is the one load-bearing decision:
`localStorage` is keyed by origin and a `file://` page is an *opaque* origin, so
notes would depend on where the app happened to be installed. `notes://app` is
a constant, so notes survive updates and moves. It must be registered before
Electron's `ready` event — a scheme registered late loads the page as an opaque
origin anyway, with no `localStorage` at all.

`electron-builder.config.cjs` packages an **archive** per platform (Windows
zip, macOS zip for x64 and arm64 separately, Linux tar.gz) rather than an
installer, because an unsigned installer trips SmartScreen / Gatekeeper; it
reads the app's real version from the root `package.json`, and always signs the
macOS build — ad hoc when no Apple credentials are present, since Apple Silicon
refuses to execute unsigned arm64 code at all. The `desktop` job in
`.github/workflows/release.yml` builds all four on one runner per platform and
attaches them to the draft release, which the `publish` job then makes public.

The cloud backends (Dropbox, Google Drive) are **not offered** in the desktop
app — `capabilities().redirectOauth` is false there, so the storage picker
shows both rows disabled the way it already does for the folder backend on
Safari. Their OAuth flows redirect to a registered `https://` URL, which
`notes://app` is not. Local storage and the picked-folder backend work as they
do on the web. See [Capabilities](#capabilities), `electron/README.md`, and
AGENTS.md's "The wrappers are thin" for the rule about what may live in that
directory (in short: nothing that could live in `src/`).

### Code splitting

What the browser downloads before it can show a note, and what it fetches only
if you ask for it. Three seams decide that.

**The route decides first.** `src/app/main.tsx` reads `location.pathname` and
then dynamically imports one of three things: `PrivacyPage`, `HomePage`, or
`mount-app.tsx` — the module that pulls in `App`, the storage layer, the i18n
runtime, and every modal host. Because the app hangs off that one dynamic edge,
the two [public pages](#the-public-pages) load a page instead of a whole
application: `/home` and `/privacy` fetch about 17 kB of JavaScript where they
used to fetch the entire 184 kB app. They are the crawlable, log-in-free
surfaces, so their first paint is the one a search engine measures.

**A modal that opens on demand loads on demand.** `lazyModal`
(`src/app/modals/lazy-modal.tsx`) wraps a modal so its host stops mounting it
while closed and Preact fetches its chunk on the first open. Settings, "What's
new", the achievements tour and its unlock sibling, namespaces, and the
[sync details](#sync-details-modal) dialog all go through it. The changelog is the
biggest single beneficiary — `CHANGELOG.md` is inlined as a raw string and
parsed at build time, so "What's new" is ~28 kB gzipped that used to sit in
every first paint and is now read at most once per release. There is one
deliberate exception: the [search modal](#search) opens inside a `flushSync`
from the tap that requested it, precisely so iOS ties the focus to that gesture
and raises the keyboard, and an `await` in the middle of that loses it. Search
stays statically imported; so should anything else that must render within the
tap.

**The backends you never connect never load.** `remote-backends.ts` is a single
`import()` boundary in front of Dropbox, Google Drive, the picked folder and
notesd, together with the directory adapter and offline-cache mirror they
share. The app opens on the browser backend and stays there unless someone
deliberately connects something, so for most people that is code downloaded and
parsed to be skipped. The render path reaches it through `useRemoteBackends`,
which returns `null` until the module lands; every non-browser arm of
[`useBackendSelection`](#storage-backend-hook) requires it, so the selection stays
on the browser store meanwhile — the *same* fall-through it already takes while
a Dropbox token is being read or a folder grant probed, which is why nothing
downstream needed a new not-ready state. Verbs that run on a gesture — connect,
remove a namespace, publish a daemon — use a local `await import()` instead.
Three things have to answer at boot and were split into their own small modules
so they can: `cache/offline-error.ts` (the `instanceof` check in
[`UnlockGate`](#unlock-gate)), `dropbox/pending.ts` (is an OAuth redirect
waiting?), and `cloud-configured.ts` (was this build given a client id?).

**Dev-only code is imported where it is used.** The [seed
dataset](#fake-data) loads behind `import.meta.env.VITE_SEED`, which
folds to `false` in an ordinary build and drops the module entirely, and the
fake-data adapter is imported when the toggle flips rather than at mount —
safe because the toggle is off at mount and the adapter is only ever swapped in
mid-session.

**The wrappers get none of this.** `vite.config.ts` turns on
`inlineDynamicImports` for the embedded builds, so `native/` and `electron/`
emit exactly one chunk, the shape they have always shipped. Splitting is a
network optimisation and a wrapper has no network — it loads the bundle off the
device — while the native WebView serves the page from a `file://` origin,
where dynamic `import()` is not dependably permitted. The trade is that the
Swedish catalogue, which the web fetches only when the language is switched,
rides along in the wrapper bundle.

### The renderer (Preact)

The app renders with **Preact**, not React — a swap made purely for the
download: it takes roughly 190 KB (52 KB compressed) off the main bundle, which
is the app's whole first paint on a phone. Nothing imports `preact` by name.
`@preact/preset-vite` (`vite.config.ts`) aliases `react`, `react-dom`, and
`react/jsx-runtime` onto `preact/compat` for every importer — app source and
[the framework package](#the-shared-framework) alike — and `tsconfig.json`'s
`paths` mirrors those aliases so `tsc` checks against the modules Vite actually
bundles. **Keep writing `import … from "react"`.** React itself remains in
`node_modules` only to satisfy the framework's and Testing Library's peer
ranges; no build ever resolves it, and `tests/app/preact-alias.test.ts` fails
loudly if that stops being true. Vitest is the one place the alias needs help:
it externalises `node_modules` by default, so the framework is listed in
`test.server.deps.inline` to put its own `react` imports back through Vite's
resolver.

`preact/compat` is close to React but not identical, and four of the gaps are
load-bearing here. **`ref` belongs to the renderer**, not to props: Preact
lifts it off before a function component sees it (React 19 hands it through),
so a component exposing an imperative handle takes it as **`handleRef`** —
`MarkdownEditor` and `PlainEditor` both do. **`onSelect` is the DOM's**, firing
only when a *range* is selected, where React synthesised it from mouse and key
activity; the [plain editor](#the-editor) therefore tracks a collapsed caret
through `onMouseUp` / `onKeyUp` as well, so the [styling
toolbar](#styling-toolbar) still lights up when a click or an arrow key lands
inside a formatted run. **`onChange` / `onBlur` / `onFocus` are remapped by
compat** onto `input` / `focusout` / `focusin` — React's semantics, so real
usage is unchanged, but a test has to simulate the event the DOM delivers
(`fireEvent.input`, a real `el.blur()`) rather than the synthetic one. And
**nullable DOM fields are visible again**: `DragEvent.dataTransfer` and
`ClipboardEvent.clipboardData` are typed `| null` where React's synthetic
events hid it, so the drag and paste handlers degrade instead of assuming.
AGENTS.md's "The renderer is Preact" section carries the full list.

### The shared framework

`@niclaslindstedt/oss-framework` — the npm package (GitHub Packages
registry, authenticated through the `GITHUB_PAT` env variable via
`.npmrc`) holding the components, hooks, and utilities `notes` and
`checklist` used to grow in parallel. notes consumes it for the UI
primitives (`Modal`, `Button`, `Checkbox`, `SelectPicker`,
`FloatingPanel`, `RowActionMenu`, `CipherGlyph`, `UnlockGate`, the
settings layout blocks, most icons), the gesture/keyboard hooks, the PWA
update lifecycle, the changelog modal, the achievements modals, the
glyph/colour picker kit, and the namespaces management dialog. Each
replaced module still exists at its historical path as a **re-export
shim** (implementation moved, import path unchanged) or a **wrapper**
that injects the app's translated strings — framework components carry
no i18n and take labels-as-props with English defaults. Tailwind scans
the package (`@source` in `src/styles.css`) so its utility classes are
emitted, and `src/styles/theme.css` aliases the framework's seven extra
colour slots (meta/path/flag/pipe/success/positive/negative) onto notes'
11-slot palette. What deliberately stays app-side — the theme system,
the encryption core, the i18n runtime, the Markdown parser/editor, the
[undo/redo shortcuts](#undo--redo), the sync UI, search, the side-menu
shell, and everything the React Native app imports — is listed with
reasons in AGENTS.md's "The shared framework" section.

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
