import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import {
  type Attachment,
  type AttachmentPlacement,
  attachmentMarkdown,
  hiddenAttachmentLines,
  INLINE_PLACEMENT,
} from "../domain/attachment.ts";
import { unlock } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import {
  cutLine,
  firstChangedLine,
  moveLines,
  orderPoints,
  pointsEqual,
  replaceRange,
  wordEndAt,
  type SourcePoint,
} from "../domain/line-edit.ts";
import {
  addCursorVertically,
  addNextOccurrence,
  applyAtCursors,
  bareCursorLineText,
  collapsedCursor,
  cursorLines,
  cutBareCursorLines,
  cursorPoints,
  cursorSpan,
  moveCursors,
  offsetOf,
  pointAt,
  wordBoundary,
  type Cursor,
  type CursorMove,
  type OccurrenceSession,
  type Replacement,
  type Span,
} from "../domain/multi-cursor.ts";
import {
  allLines,
  clampLineSelection,
  inLineSelection,
  isContiguous,
  lineRunRange,
  lineSelectionGroups,
  lineSelectionSize,
  lineSelectionSource,
  lineSpan,
  moveLineSelection,
  overwriteLineSelection,
  paintLineRun,
  removeLineSelection,
  sameLineSelection,
  singleLine,
  type LineSelection,
  type PaintMode,
} from "../domain/line-selection.ts";
import {
  classifyLines,
  codeBlockCopyAnchors,
  codeBlockEdges,
  hiddenFenceLines,
  toggleTaskLine,
  type LineBlock,
} from "../domain/markdown.ts";
import {
  applyFormat,
  lineFormatOf,
  newlineFor,
  type FormatAction,
  type LineFormat,
} from "../domain/markdown-format.ts";
import { matchLineSpans, type NoteMatch } from "../domain/note-find.ts";
import type { Note } from "../domain/note.ts";
import { doubleSpacePeriod, sentenceCapital } from "../domain/sentence.ts";
import type { CompiledTransform } from "../domain/transform.ts";
import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { writeClipboard } from "./clipboard.ts";
import { getEditorPosition, setEditorPosition } from "./editor-position.ts";
import { AttachmentsEndBlock } from "./attachments/AttachmentsEndBlock.tsx";
import { AttachmentsProvider } from "./attachments/AttachmentsProvider.tsx";
import {
  attachableFilesFrom,
  fileToAttachment,
} from "./attachments/fromFile.ts";
import {
  lineElementOf,
  lineIndexOf,
  placeCaret,
  placeRange,
  resyncCaret,
  visualRowAt,
} from "./contenteditable-caret.ts";
import {
  isEmptyPaint,
  measureCursors,
  samePaint,
  NO_PAINT,
  type CursorPaint,
} from "./multi-cursor-rects.ts";
import { MultiCursorOverlay } from "./MultiCursorOverlay.tsx";
import {
  anchoredScrollTop,
  bufferedScrollTop,
  revealRect,
  scrollFocusedIntoView,
} from "./hooks/scrollFocusedIntoView.ts";
import { useDesktopPointer } from "./hooks/useMediaQuery.ts";
import { useSelectAllShortcut } from "./hooks/useSelectAllShortcut.ts";
import { codeBlockEdgeClass, lineTextClass } from "./markdown-line-class.ts";
import { CodeCopyButton } from "./CodeCopyButton.tsx";
import {
  RawLine,
  RenderedLine,
  TASK_TOGGLE_ATTR,
  type LineHighlight,
} from "./MarkdownLine.tsx";
import {
  extractSourceRange,
  snapStartToLineEdge,
  sourcePointFromDom,
} from "./markdown-selection.ts";

// An Obsidian-style live-preview Markdown editor built on a single
// `contenteditable` surface. The document renders as a column of lines: every
// line shows its formatted Markdown except the one the caret sits on, which
// renders as raw source so it can be edited verbatim. Because the whole note is
// one editable element, the browser owns caret movement (arrows glide across
// wrapped lines natively), whole-document selection (Ctrl/Cmd+A), and touch
// selection across lines on mobile — none of which the older per-line
// `<textarea>` model could do (each textarea was a selection island).
//
// The source string stays the single source of truth, and React fully owns the
// DOM. Every edit the browser proposes arrives as a native `beforeinput`, is
// `preventDefault`ed, and is applied to the source through the pure
// `replaceRange` engine — typing, autocorrect, Backspace/Delete, Enter, and
// multi-line paste all funnel through it; the active line then re-renders with
// the new text and the caret is re-placed at the column the edit left it. We
// intercept everything because letting the browser mutate a contenteditable
// itself corrupts its structure (it inserts bare text at the root). IME
// composition is the one edit that can't be `preventDefault`ed: it runs
// natively on the active line and is reconciled on `compositionend`.
//
// Moving the caret onto a different line (arrow keys, a click) is observed via
// `selectionchange`: the line the caret landed on becomes the new active raw
// line at the mapped source column, and the line it left re-formats. A ranged
// selection is left exactly as the browser drew it — the raw active line maps to
// source the same as a formatted one — and a copy / cut puts the verbatim
// *source* (Markdown, full URLs) on the clipboard via `markdown-selection.ts`.
//
// Until the user places the caret — by clicking, or being handed focus from the
// title — no line is active (`active.index` is null) and the note renders fully
// formatted. This is the opening state for an existing note, and on mobile it
// keeps the soft keyboard down until a deliberate tap.

type Props = {
  body: string;
  onChange: (body: string) => void;
  /**
   * Ticks when undo / redo swaps `body` out from under the editor. On a tick the
   * editor diffs the incoming body against what's on screen and scrolls the
   * first changed line into view, so the reverted / re-applied part is revealed.
   */
  undoScrollSeq?: number;
  /**
   * The note is **locked**: render it read-only. The surface stops being
   * `contenteditable`, so the browser puts no caret in it and no soft keyboard
   * comes up, and every path that would mutate the source stands down. Reading,
   * selecting, copying and the line-number gutter are untouched — see
   * `docs/overview.md#lock-a-note`.
   */
  locked?: boolean;
  /** Wrap long lines, or keep them on one line and scroll horizontally. */
  wordWrap: boolean;
  /** Turn off browser/OS spell check (the red squiggles). */
  disableSpellcheck: boolean;
  /** Turn off mobile autocorrect and auto-capitalisation. */
  disableAutocorrect: boolean;
  /** Write the capital that starts a sentence (see `sentenceCapital`). Ignored
   *  while `disableAutocorrect` is on — that switch turns the family off. */
  capitaliseSentences?: boolean;
  /** Max width of the writing column (`"none"` for full-bleed) + classes. */
  maxWidth: string;
  /** Place the caret in the body on mount (false when the title takes focus). */
  focusOnMount?: boolean;
  /** The note being edited, for fetching attachment bytes on demand. */
  note?: Note | null;
  /** The note's attachments, for resolving `[…](attachments/…)` references. */
  attachments?: Attachment[];
  /** Whether the active backend can store attachments (the file backends). */
  canAttach?: boolean;
  /** Persist a pasted / dropped file onto the note. */
  onAttach?: (attachment: Attachment) => void;
  /** Render images / files inline (default) or collected at the note's foot. */
  placement?: AttachmentPlacement;
  /** Trim bare URLs in the preview to this many characters either side (0 = off). */
  shortenLinkChars?: number;
  /**
   * The user's compiled **Transform** rules, applied to the preview's text for
   * display only (`domain/transform.ts`) — the source is never rewritten.
   * Compiled once by the host so every line's memo sees a stable reference.
   */
  transforms?: readonly CompiledTransform[];
  /** Number every line in a gutter down the left edge, code-editor style, each
   *  number a press target that selects its whole line. */
  lineNumbers?: boolean;
  /**
   * **Select mode** is on (the header's toggle, left of Find). The note stops
   * being something you put a caret in and becomes a list you pick lines from:
   * a press takes the line it lands on, a hold and drag walks the far end of
   * the run, and the taken lines are tinted by the editor itself rather than
   * by the browser's selection. See `docs/overview.md#select-mode`.
   */
  selectMode?: boolean;
  /**
   * Turn select mode off from inside the editor — Escape, a press on the lines
   * already taken, or an edit that consumed them. The host owns the flag (its
   * header button reports it), so the editor asks rather than sets.
   */
  onSelectModeChange?: (on: boolean) => void;
  /** The open note's id, keying its session-remembered caret / scroll position
   *  so switching away and back reopens where you left off. */
  noteId?: string;
  /** Tab (or Shift+Tab) pressed on the editing surface. The editor is held out
   *  of the browser's own tab order (see the `tabIndex` on the surface), so its
   *  host decides where focus goes next — `backwards` is Shift+Tab. */
  onTabOut: (backwards: boolean) => void;
  /**
   * Called with the block state of the line the caret sits on (null when no
   * line is active), so the styling toolbar can light up the buttons that are
   * already applied. Only passed while the toolbar is open — the classification
   * is otherwise work nobody reads.
   */
  onLineFormat?: (line: LineFormat | null) => void;
  /**
   * Called as a selection over this surface appears and disappears, so the
   * header can put the actions that operate on a selection within reach (see
   * the selection actions in `NoteEditor.tsx`). Fires only on a change, never
   * per caret move.
   */
  onSelectionChange?: (selected: boolean) => void;
  /**
   * Called as the selection starts and stops covering **whole lines and nothing
   * else**, so the header can offer the two chevrons that move those lines up
   * and down the note (see `docs/overview.md#move-lines`). Select mode's runs
   * always qualify; an ordinary selection only does when it starts at the head
   * of a line and ends at the foot of one, because half a line moved as a whole
   * one is not what the button appears to promise. Fires only on a change, like
   * `onSelectionChange`.
   */
  onWholeLineSelection?: (whole: boolean) => void;
  /**
   * Find-bar hits to paint over the note, in source coordinates. Empty (the
   * default) while the bar is closed, so nothing is highlighted and no extra
   * nodes are rendered.
   */
  matches?: readonly NoteMatch[];
  /** Index into `matches` of the hit the bar is parked on, or -1 for none. */
  activeMatch?: number;
  /**
   * Imperative handle so the title field can hand focus down into the body.
   * Named `handleRef`, not `ref`: Preact reserves `ref` for the renderer (it
   * is lifted off props before the component sees it) and only replays it as
   * a prop through `forwardRef`, so a handle passed as `ref` would never
   * arrive.
   */
  handleRef?: Ref<MarkdownEditorHandle>;
};

// A stable empty hit list, so a closed find bar hands every line the identical
// `NO_HIGHLIGHTS` reference and each `RenderedLine` memo bails out.
const NO_MATCHES: readonly NoteMatch[] = [];

// Likewise for the Transform rules, so a user with none configured hands every
// line the identical reference and each `RenderedLine` memo bails out.
const NO_TRANSFORMS: readonly CompiledTransform[] = [];

// The editor's own channel into the in-app log. It only ever reports an edit it
// had to refuse — the one failure mode that is otherwise completely silent on a
// phone, where the console is out of reach (see `dev/logger.ts`).
const log = createLogger("editor");

// The breathing room between the line-number gutter and the text it numbers.
// One constant because two places must agree on it: the surface reserves it in
// its left padding, and the number pushes itself back out of the text by it.
const GUTTER_GAP = "1rem";

// The keys that walk the caret from line to line, and so aim at the remembered
// goal column (see `goalCol`). Only unmodified: Alt / Ctrl / Cmd turn the same
// arrows into by-paragraph and to-document-end jumps, which land where they
// land rather than at a column.
const VERTICAL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown"]);

// Pressing a modifier on its own is not the user choosing a new column, so it
// leaves the goal column standing — Shift is held *before* Shift+Down, and
// releasing Cmd after a shortcut must not wipe the run that follows.
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

// --- Select mode's gesture constants -------------------------------------
//
// A finger has to be able to do two different things while the mode is on:
// scroll the note, and sweep a run of lines. The split is **spatial** rather
// than timed — the note keeps its whole width for scrolling and the sweep gets
// a rail down the left edge — because the mode is one a user stays in: they
// came to pick eight lines out of forty, which means scrolling between picks,
// and a mode where every scroll has to out-race a hold timer is a mode that
// fights back. A press anywhere still takes (or gives back) the line it lands
// on, so the rail is the only thing the split costs.
//
// With the numbers on, that rail is the line-number gutter, and it is a
// selection surface whether or not the mode is on yet: a press in it *enters*
// the mode with the pressed line taken, and a drag down it takes a run (see
// `onGutterDown`). It scrolls nothing — the gutter is the one band of the note
// that never moves the view — which is what lets a stroke starting there mean
// "take these lines" with no ambiguity to resolve.
//
// **The rail answers presses and vertical strokes, never sideways ones.** It
// runs down the left edge of the note, which on a phone is also the left edge
// of the *screen* — the strip the side menu's own open gesture starts in
// (`useEdgeSwipeOpen`, `ui/hooks/edge-gesture.ts`). Both gestures therefore
// begin on the same pixels, and only their direction tells them apart, so a
// touch that lands on the rail takes nothing until it has travelled
// `SWEEP_SLOP` and declared an axis: sideways is the drawer's and the rail
// never fires; up, down, or nowhere at all (a tap) is the rail's and lands
// exactly as a press always did. The test is the complement of the drawer's
// own (it stands down the moment |dy| > |dx|), so precisely one of the two
// answers any given stroke. A mouse skips the wait — there is no edge swipe on
// a pointer, and a drag from the rail is unambiguous.

/** How far in from the left edge of the scroller the sweep rail reaches. A
 *  press that starts inside it drags lines; one that starts to the right of it
 *  scrolls the note as it always did. Sized as a fingertip, not as the bar the
 *  rail draws — the band a thumb actually lands in is wider than the mark that
 *  advertises it. The gutter counts as rail wherever it is drawn, so this is
 *  the floor rather than the whole answer (see `onSweepRail`). */
const SWEEP_RAIL_PX = 44;

/** The width the rail reserves in the surface's left inset when the note isn't
 *  numbered. With numbers on, the gutter they already reserve is the rail. */
const SWEEP_RAIL_GAP = "1.25rem";

/** Movement that says a press meant to travel rather than to toggle a line. */
const SWEEP_SLOP = 8;

/** The tick of feedback that says the rail took the finger — inert where
 *  unsupported. */
const SWEEP_FEEDBACK_MS = 12;

/** How close to the scroller's edge a sweep has to reach before the note
 *  starts scrolling under it, and the fastest it then travels (px per frame).
 *  The band is a little over a fingertip so the auto-scroll is reachable
 *  without pushing the finger off the screen. */
const SWEEP_EDGE_PX = 56;
const SWEEP_SCROLL_MAX = 18;

/** A stroke the sweep is following, from the press that started it to the
 *  lift that ends it. */
type SweepStroke = {
  pointerId: number;
  /** Where the press landed, so a move can measure how far it has come. */
  x: number;
  y: number;
  /** The line the stroke started on; the far end follows the pointer. */
  anchor: number;
  /** Taking lines or giving them back — fixed when the press landed. */
  mode: PaintMode;
  /** What was taken before this stroke began. Every move replays the stroke
   *  against it, so dragging back up un-paints rather than leaving a
   *  high-water mark, and earlier picks are never disturbed. */
  base: readonly number[];
  /** The stroke owns the pointer: it is on the rail, or it is a mouse. A
   *  touch outside the rail leaves this false so the note can scroll. */
  dragging: boolean;
  moved: boolean;
  /** A touch stroke on the rail that has not said which way it is going yet,
   *  and so has taken nothing (see `commitSweep`). `null` once it has said —
   *  and from the first frame for a mouse, which has nothing to be told apart
   *  from. */
  pending: { entering: boolean } | null;
};

/** Whether an event landed in the line-number gutter — the press target
 *  `LineRow` hangs beside every line while the numbers are on. Asked of the
 *  event's own target rather than of a coordinate, because the gutter's width
 *  tracks the note's digit count and its own left inset. */
function onGutter(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-line-gutter]") !== null
  );
}

/** What the editor exposes to its parent: a way to start editing from outside. */
export type MarkdownEditorHandle = {
  /** Place the caret at the end of the note and start editing there. */
  focus: () => void;
  /** Apply a styling-toolbar action to the selection (or the caret's line). */
  format: (action: FormatAction) => void;
  /** Cut to the clipboard: the selection, the text after a mid-line caret, or
   *  the whole line. */
  cut: () => void;
  /** The verbatim source the current selection covers, or null when there is
   *  no selection in this editor. */
  selection: () => string | null;
  /** Take the lines select mode has picked out of the note entirely. A no-op
   *  unless the mode is holding a run — the header only offers it then. */
  deleteSelection: () => void;
  /** Shuffle the selected lines one row up (`-1`) or down (`1`), keeping them
   *  selected. A no-op unless the selection covers whole lines — the header
   *  only offers it then (see `docs/overview.md#move-lines`). */
  moveLines: (direction: -1 | 1) => void;
  /** Attach files chosen from the file browser, exactly as a paste or a drop
   *  of the same files would: each becomes an `Attachment` and its Markdown
   *  reference lands at the caret. */
  attach: (files: readonly File[]) => void;
};

// The active line's identity: which source line is being edited as raw text, and
// a monotonically-rising key bumped only when the caret rolls onto a *different*
// line, so React remounts a clean node then but merely updates the text in place
// while the user types within one line.
type Active = { index: number | null; key: number };

export function MarkdownEditor({
  body,
  onChange,
  undoScrollSeq = 0,
  locked = false,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  capitaliseSentences = true,
  maxWidth,
  focusOnMount = true,
  note = null,
  attachments,
  canAttach = false,
  onAttach,
  placement = INLINE_PLACEMENT,
  shortenLinkChars = 0,
  transforms = NO_TRANSFORMS,
  lineNumbers = false,
  selectMode = false,
  onSelectModeChange,
  noteId,
  onTabOut,
  onLineFormat,
  onSelectionChange,
  onWholeLineSelection,
  matches = NO_MATCHES,
  activeMatch = -1,
  handleRef,
}: Props) {
  const t = useT();
  // Where the caret / scroll were the last time this note was left this session
  // (see `editor-position.ts`). Read once on mount — the editor is keyed by note
  // id, so a different note remounts and re-reads its own remembered spot.
  const [saved] = useState(() => (noteId ? getEditorPosition(noteId) : null));
  // Local source of truth, seeded from the note. App keys the editor by note
  // id, so a different note remounts rather than reconciling mid-edit.
  const [value, setValue] = useState(body);
  const lines = useMemo(() => value.split("\n"), [value]);
  const blocks = useMemo(() => classifyLines(value), [value]);
  // Lines hidden because their attachment renders in the end block instead.
  const hidden = useMemo(
    () => hiddenAttachmentLines(value, placement),
    [value, placement],
  );

  // A remembered caret reopens the note on that line (raw, focused); otherwise
  // fall back to the mount behaviour — the last line when `focusOnMount`, no
  // active line (fully formatted, keyboard down) for an existing note.
  const savedCaret = saved?.caret ?? null;
  // The first line of a whole-line selection a block press just drew, so the
  // toolbar still knows what it applied while no single line is active.
  const [spanLine, setSpanLine] = useState<number | null>(null);
  // Touch or mouse — the one thing that decides whether a selection outlives
  // the blur that ends it (see `dropSelectionOnBlur`).
  const desktopPointer = useDesktopPointer();
  // Where the caret (or a single-line selection) sits, in source coordinates —
  // what tells the toolbar which *inline* runs it is inside. The caret's line
  // alone can't: bold is a span within a line, not a property of it. Null while
  // the position isn't known, and only tracked while the toolbar is listening
  // (a closed toolbar shouldn't re-render the editor on every caret move).
  const [caretSpan, setCaretSpan] = useState<{
    line: number;
    from: number;
    to: number;
  } | null>(null);
  const [active, setActive] = useState<Active>(() => ({
    // A locked note has no active line, ever: the raw line exists so it can be
    // *edited*, and there is nothing here to edit. It opens the way an
    // untouched note does — every line formatted, no caret, keyboard down —
    // whatever caret this note was left on before it was locked.
    index:
      locked || (!savedCaret && !focusOnMount)
        ? null
        : savedCaret
          ? Math.min(savedCaret.line, body.split("\n").length - 1)
          : Math.max(0, body.split("\n").length - 1),
    key: 0,
  }));

  // Every caret in the note, or null when there is only the browser's own —
  // which is the ordinary state, and the one every path below falls back to.
  // A one-element list is a *session* with a single cursor: the state a first
  // Ctrl/Cmd+D leaves behind, where the word is selected but nothing has been
  // multiplied yet, so the native selection alone still draws it (see
  // `docs/overview.md#multiple-cursors`).
  const [cursors, setCursors] = useState<Cursor[] | null>(null);
  // Where the painted carets and highlights go. Measured from the DOM after
  // every render that can have moved them, so it is state rather than a memo.
  const [paint, setPaint] = useState<CursorPaint>(NO_PAINT);

  // The run of whole lines select mode has taken, or null when the mode is on
  // but nothing has been pressed yet. Meaningless while the mode is off, and
  // cleared with it — every reader below checks the mode first.
  const [lineSel, setLineSel] = useState<LineSelection | null>(null);
  // The taken lines as a set, so painting the note is one lookup per line
  // rather than a scan of the selection per line — a whole-note selection on a
  // long note is otherwise quadratic on every render.
  const selectedLines = useMemo(
    () => (selectMode && lineSel ? new Set(lineSel.lines) : null),
    [selectMode, lineSel],
  );

  // Refs so the document-level and native listeners below always read current
  // state without re-binding (they capture these, not the render closure).
  const rootRef = useRef<HTMLDivElement>(null);
  // The note's scroller — the editing surface's parent, held directly rather
  // than reached through `rootRef.current.parentElement`: the select-mode
  // gestures measure it on every frame of a sweep, and the floating action bar
  // centres itself on it.
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The zero-sized box the painted cursors are positioned against. It sits at
  // the scroller's content origin and scrolls with the note, so measuring
  // against it means the overlay never has to be re-measured on scroll.
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeElRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const linesRef = useRef(lines);
  const blocksRef = useRef(blocks);
  const activeRef = useRef(active);
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  // What a run of Ctrl/Cmd+D is looking for, held for the length of the run so
  // every press after the first searches for the same text under the same
  // whole-word rule (see `addNextOccurrence`). Cleared whenever the column is.
  const occurrence = useRef<OccurrenceSession | null>(null);
  // The mode and its selection, for the document-level listeners and the
  // pointer handlers, which run outside the render closure.
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const lineSelRef = useRef(lineSel);
  lineSelRef.current = lineSel;
  // Read by the effects that must see the *current* lock without re-running
  // when it flips (a mount-time position restore, an out-of-band body swap).
  const lockedRef = useRef(locked);
  valueRef.current = value;
  linesRef.current = lines;
  blocksRef.current = blocks;
  activeRef.current = active;
  lockedRef.current = locked;

  // The caret column to install after the active line (re)renders, or null when
  // the browser already left the caret where it belongs (a plain caret move).
  const pendingCaret = useRef<number | null>(
    locked
      ? null
      : savedCaret
        ? savedCaret.col
        : focusOnMount
          ? Math.max(0, (lines[lines.length - 1] ?? "").length)
          : null,
  );
  // The ranged sibling of `pendingCaret`, for an edit that hands a span back
  // *selected* rather than collapsed — the styling toolbar wrapping a word in
  // `**`, or dropping the caret onto a fresh link's `url` placeholder so the
  // address can be typed straight over it. Takes precedence when set.
  const pendingRange = useRef<{ from: number; to: number } | null>(null);
  // An edit that must not pull focus back into the note. Select mode's cut and
  // delete are pressed on a *header button* with the soft keyboard deliberately
  // down (see `docs/overview.md#select-mode`) — nothing about picking a run of
  // lines with a finger asks for a caret — so re-taking focus to install the
  // caret the edit left behind is exactly what would raise the keyboard over
  // the note the press just shortened. The caret is simply not installed then:
  // there is none on screen to move, and the next tap places one.
  const quietCommit = useRef(false);
  // A whole-line span to re-select after the value changes, by source line
  // index. Block formatting (heading, list, quote, indent) is a whole-line
  // affair, so when it spans several lines the selection is restored at line
  // granularity — which is what lets a press chain onto the last one: bullet
  // three lines, then indent the same three into children. Select mode's
  // handover queues one too, for the run it hands back as an ordinary
  // selection on the way out.
  const pendingLineSpan = useRef<{ from: number; to: number } | null>(null);

  // The latest known caret (as a source point) and scroll offset, kept current
  // as the user types / moves / scrolls so the unmount handler can stash them in
  // the session position store — restored the next time this note is opened.
  const lastCaret = useRef<SourcePoint | null>(savedCaret);
  const lastScrollTop = useRef<number>(saved?.scrollTop ?? 0);

  // The column a vertical run of caret moves is aiming for — the goal column
  // every text editor keeps, so walking Down past a short line and out the other
  // side returns to the column the run started from instead of clinging to the
  // short line's end. Browsers keep one of their own, but it is measured in
  // pixels and is reset by every caret placed programmatically — and this editor
  // re-places the caret on *every* line change, because the line the caret lands
  // on re-renders from formatted to raw and its DOM (with the browser's memory
  // of it) is thrown away. So the editor has to remember the column itself.
  //
  // Held as a source column rather than an x-position, because that is the
  // coordinate this editor moves in, and because a line is drawn formatted until
  // the caret enters it: an x remembered over a heading (large text, `# `
  // hidden) would mean something else entirely once that heading opens raw.
  //
  // Counted from the start of the caret's **visual row**, not of its source
  // line, because a soft-wrapped line is many rows tall and only the row makes
  // a column mean anything: column 700 of a paragraph is somewhere in its
  // middle, while "44 into this row" is the place the eye is actually on.
  //
  // Set on the first Up / Down / PageUp / PageDown of a run and kept for the
  // whole of it — including across lines too short to reach it, which is the
  // entire point. Dropped by anything that says the user picked a new column: a
  // horizontal key, typing, a press, a selection, leaving the surface.
  const goalCol = useRef<number | null>(null);
  // Which way the latest vertical press went, and so which visual row of the
  // line it lands on the caret arrives at: walking up enters a line from below
  // and belongs on its **last** row, walking down on its **first**. Read once
  // the line has rendered raw, in the caret-placement effect — the formatted
  // line it was before wraps differently, so its geometry says nothing.
  const pendingRow = useRef<"first" | "last" | null>(null);
  const upwards = useRef(false);
  function dropGoalColumn() {
    goalCol.current = null;
    pendingRow.current = null;
  }

  // The caret's column counted from the head of the visual row it sits in — the
  // goal column a vertical run starts aiming at. Falls back to the source column
  // when the caret isn't in the active raw line (nothing to measure against),
  // which is also what an un-wrapped line answers.
  function rowRelativeCaretColumn(): number | null {
    const at = lastCaret.current;
    if (!at) return null;
    const el = activeElRef.current;
    if (!el || activeRef.current.index !== at.line) return at.col;
    return Math.max(0, at.col - visualRowAt(el, at.col).start);
  }
  // Guards so a caret we place programmatically doesn't re-enter the
  // `selectionchange` handler, and so IME composition isn't disturbed.
  const settingSel = useRef(false);
  const composing = useRef(false);

  // A touch tap opened (or moved within) the editor, so the line the caret
  // lands on should be scrolled clear of the soft keyboard once it settles. Set
  // on a touch `pointerdown`, consumed the next time the caret rolls onto a
  // *different* line (see the caret-placement effect). Scoped to touch so a
  // desktop click or arrow-key move never yanks the view around.
  const revealPending = useRef(false);
  // The last active-line key we revealed for, so typing within a line (which
  // re-runs the effect without changing the key) never re-triggers a scroll.
  const lastRevealKey = useRef<number | null>(null);
  // Whether the press being handled came from a finger / pen rather than a
  // mouse, which decides how precisely its caret is taken (see `onSurfaceClick`).
  // Only an explicit touch/pen counts: an engine that reports no `pointerType`
  // is treated as a mouse, so a desktop click is never snapped.
  const touchPress = useRef(false);

  // Undo/redo scroll bookkeeping. `lastUndoSeq` remembers the tick we last acted
  // on (seeded to the current one so a fresh mount never scrolls); when it
  // advances we diff the incoming body against what's on screen and stash the
  // first changed line in `pendingScrollLine`, which the value-driven effect
  // below scrolls to once the new lines have rendered.
  const lastUndoSeq = useRef(undoScrollSeq);
  const pendingScrollLine = useRef<number | null>(null);

  const clampedIndex =
    active.index === null ? null : Math.min(active.index, lines.length - 1);

  // Every line a cursor touches is drawn as raw source, not just the active
  // one. Two reasons, and both are load-bearing: a formatted line's text isn't
  // its source (a heading drops its `# `, a shortened URL its middle), so a
  // painted caret measured at a source column would land in the wrong place —
  // and a column of carets that showed some lines formatted and one raw would
  // read as the note flickering rather than as one editing surface.
  const cursorRawLines = useMemo(
    () => (cursors && cursors.length > 1 ? cursorLines(cursors) : null),
    [cursors],
  );

  // The ``` delimiters of every closed code block the caret is outside of. They
  // are dropped from the preview the same way a heading's `#` is — the block
  // renders as code, and the fences reappear the moment the caret steps inside
  // it (see `hiddenFenceLines`). They stay in the source, so line indices and
  // structural edits are untouched.
  const hiddenFences = useMemo(
    () => hiddenFenceLines(blocks, clampedIndex),
    [blocks, clampedIndex],
  );

  // Which drawn lines carry a code block's copy button, and the code each one
  // copies. Keyed by the block's first *visible* line so the button rides the
  // top-right corner of the block as drawn (see `codeBlockCopyAnchors`).
  const copyAnchors = useMemo(
    () => codeBlockCopyAnchors(blocks, clampedIndex),
    [blocks, clampedIndex],
  );

  // The drawn lines that are a code block's top / bottom edge, which is where
  // the block's rounded corners and its vertical padding go — there is no
  // per-block container to put them on (see `codeBlockEdges`).
  const codeEdges = useMemo(
    () => codeBlockEdges(blocks, clampedIndex),
    [blocks, clampedIndex],
  );

  // Mutate the source and move the caret. Re-derives the string and queues the
  // caret column for the effect below to install. The active node is remounted
  // (bumped key) only when the caret crosses onto a *different* line — a
  // same-line edit keeps the node, letting React update its text in place.
  // `remount` forces that fresh node even within one line, for the one caller
  // whose line the browser has mutated behind React's back (see `activate`).
  function commit(nextLines: string[], caret: SourcePoint, remount = false) {
    // An edit chooses where the caret ends up, so the column a vertical run was
    // aiming for is history the moment the source changes.
    dropGoalColumn();
    const next = nextLines.join("\n");
    setValue(next);
    onChange(next);
    lastCaret.current = caret;
    // An edit the surface never held focus for — select mode's cut and delete,
    // pressed on a header button over a note with the keyboard down (see
    // `quietCommit`). Installing the caret means taking focus, which raises
    // the keyboard; and an active line with no caret in it would sit there
    // showing its raw markdown. So the note stays fully formatted and
    // caret-less, and `lastCaret` above remembers where writing would resume.
    if (quietCommit.current) {
      quietCommit.current = false;
      const root = rootRef.current;
      if (!root || document.activeElement !== root) {
        pendingCaret.current = null;
        pendingRange.current = null;
        setActive((a) =>
          a.index === null ? a : { index: null, key: a.key + 1 },
        );
        return;
      }
    }
    pendingCaret.current = caret.col;
    markCaret(caret.line, caret.col, caret.col);
    setActive((a) => ({
      index: caret.line,
      key: a.index === caret.line && !remount ? a.key : a.key + 1,
    }));
  }

  // Remember where the caret is, for the toolbar's inline lights. Every caret
  // we place ourselves reports here rather than waiting for the
  // `selectionchange` it fires — that one is swallowed by `settingSel`. A no-op
  // while the toolbar is closed, and while the position hasn't actually moved,
  // so neither costs a render.
  function markCaret(line: number, from: number, to: number) {
    if (!onLineFormat) return;
    setCaretSpan((cur) =>
      cur && cur.line === line && cur.from === from && cur.to === to
        ? cur
        : { line, from, to },
    );
  }

  // So the caret-placement effect can report a column without taking `markCaret`
  // (rebuilt every render) as a dependency and re-running on each one.
  const markCaretRef = useRef(markCaret);
  markCaretRef.current = markCaret;

  // A selection spanning lines has no single line's columns to report.
  function clearCaretSpan() {
    if (!onLineFormat) return;
    setCaretSpan((cur) => (cur === null ? cur : null));
  }

  // Seed the caret's position the moment the toolbar starts listening, so
  // opening it over a word already in `**` lights Bold without having to move
  // the caret first.
  useEffect(() => {
    if (!onLineFormat) return;
    const at = lastCaret.current;
    setCaretSpan(at ? { line: at.line, from: at.col, to: at.col } : null);
  }, [onLineFormat]);

  // Move the active line without editing the source (a caret move that reveals a
  // new raw line). Remounts the active node so it renders that line's raw text.
  // `remount` forces the remount when the line is already active: after an IME
  // composition the browser has rewritten that line's children itself, so
  // React's record of them is stale and reconciling in place tears down nodes
  // that are no longer there. A fresh key throws the whole subtree away instead.
  function activate(index: number, col: number, remount = false) {
    pendingCaret.current = col;
    lastCaret.current = { line: index, col };
    markCaret(index, col, col);
    setActive((a) => ({
      index,
      key: a.index === index && !remount ? a.key : a.key + 1,
    }));
  }

  // --- Multiple cursors -----------------------------------------------------
  //
  // The VS Code editing model: Ctrl/Cmd+D takes the word under the caret and
  // then each further press adds a caret over the next occurrence of it;
  // Ctrl/Cmd+Up / Down grow a column of bare carets; typing, deleting, Enter
  // and paste happen at every one of them at once; Escape drops back to the
  // one you started from.
  //
  // A browser gives a page exactly one selection, so exactly one cursor — the
  // **last** in the list, the one a press just added, which is also the one the
  // view follows — is the browser's, and every other is drawn by the overlay.
  // The list's *first* entry is the primary: the cursor Escape leaves standing.
  // Both facts survive an edit because `applyAtCursors` answers in the order it
  // was asked.
  //
  // The pure half of all this — where the cursors are, which occurrence is
  // next, how one keystroke becomes N edits — is `domain/multi-cursor.ts`. What
  // is left here is the DOM half: putting the native selection on the focus
  // cursor, keeping every line a cursor touches rendered as raw source (a
  // formatted line's text is not its source, so a column measured against one
  // lands in the wrong place), and knowing when the column is over.

  // End the session: back to the browser's single caret, wherever it now is.
  // The selection itself is left alone — Escape hands it to `collapseToPrimary`
  // below, and every other caller (a press, a blur, another writer's text) has
  // already moved it or is about to.
  function clearCursors() {
    occurrence.current = null;
    cursorsRef.current = null;
    setCursors((c) => (c === null ? c : null));
  }

  const clearCursorsRef = useRef(clearCursors);
  clearCursorsRef.current = clearCursors;

  // Put the browser's one selection on `c`, which makes its line the active raw
  // one. A single-line span is handed back *selected* (that is what a Ctrl/Cmd+D
  // occurrence has to look like); a span across lines can only be given a caret,
  // and the overlay draws its highlight instead.
  function focusCursor(c: Cursor) {
    const [start, end] = cursorPoints(c);
    dropGoalColumn();
    lastCaret.current = c.head;
    pendingLineSpan.current = null;
    if (start.line === end.line && start.col !== end.col) {
      pendingRange.current = { from: start.col, to: end.col };
      pendingCaret.current = null;
      markCaret(start.line, start.col, end.col);
    } else {
      pendingRange.current = null;
      pendingCaret.current = c.head.col;
      if (start.line === end.line)
        markCaret(c.head.line, c.head.col, c.head.col);
      else clearCaretSpan();
    }
    setActive((a) => ({ index: c.head.line, key: a.key + 1 }));
  }

  // Adopt a new set of cursors and follow the last one with the native caret.
  function applyCursors(next: Cursor[]) {
    cursorsRef.current = next;
    setCursors(next);
    focusCursor(next[next.length - 1]!);
  }

  // The cursors a command starts from: the column already up, or the browser's
  // selection promoted to a one-cursor session. Null when there is no caret in
  // the editor at all (an unopened note), where these commands do nothing.
  function currentCursors(): Cursor[] | null {
    if (cursorsRef.current) return cursorsRef.current;
    const pts = selectionPoints();
    if (pts)
      return [
        pts.collapsed
          ? collapsedCursor(pts.start)
          : { anchor: pts.start, head: pts.end },
      ];
    const at = lastCaret.current;
    return at ? [collapsedCursor(at)] : null;
  }

  // Ctrl/Cmd+D. The first press over a bare caret only *selects* the word it
  // sits in — the same press then finds the next one — which is why a step that
  // adds nothing is still applied.
  function selectNextOccurrence() {
    if (locked) return;
    const from = currentCursors();
    if (!from) return;
    const step = addNextOccurrence(linesRef.current, from, occurrence.current);
    if (!step) return;
    occurrence.current = step.session;
    applyCursors(step.cursors);
    if (step.cursors.length > 1) unlock("manyHands");
  }

  // Ctrl/Cmd+Up / Down: grow the column by a line. Not an occurrence run, so
  // whatever Ctrl/Cmd+D was searching for is dropped — the next press of it
  // starts again from the word under the caret.
  function addCursorLine(direction: -1 | 1) {
    if (locked) return;
    const from = currentCursors();
    if (!from) return;
    const next = addCursorVertically(linesRef.current, from, direction);
    if (!next) return;
    occurrence.current = null;
    applyCursors(next);
    unlock("manyHands");
  }

  // Escape: back to one caret — the *primary*, the cursor the run started from,
  // still holding whatever it had selected. Landing back where you began is
  // what makes a Ctrl/Cmd+D one press too far cost nothing.
  function collapseToPrimary() {
    const cur = cursorsRef.current;
    clearCursors();
    if (cur && cur.length > 0) focusCursor(cur[0]!);
  }

  // Mutate the source at every cursor at once and keep them all. The
  // multi-cursor twin of `commit`: same job, but the caret it leaves behind is
  // a whole column, and every line involved is re-rendered rather than one.
  function commitCursors(nextLines: string[], nextCursors: Cursor[]) {
    dropGoalColumn();
    const next = nextLines.join("\n");
    setValue(next);
    onChange(next);
    applyCursors(nextCursors);
  }

  // --- Select mode ---------------------------------------------------------
  //
  // Taking a run of lines with the ordinary selection means dragging two
  // handles onto two exact characters, which is fiddly with a mouse and close
  // to impossible with a fingertip. Select mode drops the columns: the note
  // becomes a list you pick from. A press takes the line it lands on and a
  // second press on the same line gives it back; a stroke down the rail takes
  // every line it crosses. What is taken is tinted — line number and text
  // alike — by the editor itself, not by the browser (`.line-selected`).
  //
  // **Picking a line never gives up the last one.** The mode's state is a set
  // of line indices (`domain/line-selection.ts`), not a range, because the
  // lines someone wants are as often scattered down the note as they are one
  // unbroken run — and a model that can only hold a run makes the second press
  // throw the first away, which is the one thing a mode called "select" must
  // not do. Everything the selection can then be used for is handed to the same
  // pure engine every other edit uses: type over it, delete it, cut or copy it,
  // style every line of it at once.
  //
  // Two things are deliberately *not* the browser's here. There is no native
  // range while the mode is on — a range would drag the platform's own handles
  // and callout bar onto a screen that is already saying what is taken — and
  // there is no visible caret. What the surface does keep is a **collapsed**
  // caret at the head of the selection, hidden by `.line-select-mode`, because
  // that is what makes it go on receiving `beforeinput`: without one, typing
  // over the selection would silently do nothing on a phone.
  //
  // Leaving the mode is the one place the two selections meet. Escape (or the
  // header toggle) hands an unbroken run over as an ordinary browser selection,
  // drawn in the ordinary selection colour. That handover is the whole reason
  // the two look different in the first place — and it is the one thing a
  // scattered set can't have, since the browser would have to draw the lines
  // between the ones actually taken.

  function setLineSelection(next: LineSelection | null) {
    lineSelRef.current = next;
    setLineSel((cur) => (sameLineSelection(cur, next) ? cur : next));
    // The trophy is for the *sweep*, not for the mode: one line is what a
    // press already gives you, and a run is the thing the gesture is for.
    if (next && lineSelectionSize(next) > 1) unlock("sweepingStatement");
  }
  const setLineSelectionRef = useRef(setLineSelection);
  setLineSelectionRef.current = setLineSelection;

  // The verbatim source of the run, or null when the mode isn't holding one —
  // the single question every clipboard path asks before falling back to the
  // browser's own selection.
  function lineSelectionClipboard(): string | null {
    const sel = lineSelRef.current;
    if (!selectModeRef.current || !sel) return null;
    return lineSelectionSource(linesRef.current, sel);
  }

  // The lines the mode opens with: whatever the user was already pointing at,
  // so turning the mode on over a selection (or over the caret) starts with
  // those lines taken rather than with a note that looks untouched.
  function seedLineSelection(): LineSelection | null {
    const pts = selectionPoints();
    if (pts) return paintLineRun([], pts.start.line, pts.end.line, "add");
    const at = lastCaret.current;
    return at ? singleLine(at.line) : null;
  }

  // Set by the handover exit below, read once by the effect that reports the
  // mode's state: "the selection that outlives this mode is one I just set, so
  // don't report it away".
  const handedOver = useRef(false);

  // Leave the mode. `keepAsSelection` is the handover: the same lines, drawn
  // the ordinary way. The span is *queued* rather than drawn here because
  // leaving the mode unwraps every line's row — the nodes a range set now
  // pointed at would be thrown away before the browser painted it — so the
  // layout effect that owns `pendingLineSpan` draws it once the DOM is final.
  //
  // Only an **unbroken** run can be handed over: the browser draws one range,
  // so a scattered set would come back with the lines between the taken ones
  // silently selected too — a handover that quietly takes more than was picked
  // is worse than none, so a scattered set simply ends when the mode does.
  function exitSelectMode(keepAsSelection: boolean) {
    const sel = lineSelRef.current;
    endSweep();
    setLineSelection(null);
    const handover = keepAsSelection && sel !== null && isContiguous(sel);
    if (handover && sel) {
      const { from, to } = lineSpan(sel);
      pendingCaret.current = null;
      pendingRange.current = null;
      pendingLineSpan.current = { from, to };
      lastCaret.current = {
        line: to,
        col: (linesRef.current[to] ?? "").length,
      };
    }
    // The selection we hand over is set by us, so the `selectionchange` it
    // fires is swallowed (`settingSel`) and never reaches the reporter — say
    // it here instead, or the header drops the actions the run just earned.
    // Flagged for the effect that reports the mode's own state, which is about
    // to see the mode go off and would otherwise call this handover a nothing.
    handedOver.current = handover;
    // The handover is a run of whole lines by construction, so the chevrons the
    // mode was offering stay offered on the selection it leaves behind.
    reportSelection(handover, handover);
    onSelectModeChange?.(false);
  }

  // Take the run out of the note entirely (Backspace / Delete / a cut), then
  // leave the mode: the lines it named are gone, so there is nothing left to
  // hold, and the caret the edit lands is where writing carries on.
  function deleteLineSelection() {
    const sel = lineSelRef.current;
    if (!sel || locked) return;
    const r = removeLineSelection(linesRef.current, sel);
    setLineSelection(null);
    reportSelection(false);
    onSelectModeChange?.(false);
    // The run may have been taken with a finger and deleted from the header,
    // with no caret in the note at all — see `quietCommit`.
    quietCommit.current = true;
    commit(r.lines, r.caret);
  }
  const deleteLineSelectionRef = useRef(deleteLineSelection);
  deleteLineSelectionRef.current = deleteLineSelection;

  // Type over the selection: every taken line goes and `text` lands where the
  // first of them was. Same exit as a delete — you are writing again, and the
  // lines the selection named described the note as it was.
  function replaceLineSelection(text: string) {
    const sel = lineSelRef.current;
    if (!sel || locked) return;
    const r = overwriteLineSelection(linesRef.current, sel, text);
    setLineSelection(null);
    reportSelection(false);
    onSelectModeChange?.(false);
    commit(r.lines, r.caret);
  }

  // A styling-toolbar press with lines taken styles every one of them at once
  // — and, unlike an edit, *keeps* the selection: bulleting five lines and then
  // indenting the same five is one gesture with a second press, which is
  // exactly what the selection is for. The result travels back into the
  // selection, so a format that changes the line count leaves the same lines
  // taken.
  //
  // Applied one unbroken group at a time, from the bottom of the note upwards:
  // a format is a range operation, so scattered lines are several of them, and
  // running the lowest group first leaves the indices of the groups above it
  // still pointing where they did. A format that adds lines (a fence, a rule)
  // therefore can't shift a group out from under the next pass.
  function formatLineSelection(action: FormatAction) {
    const sel = lineSelRef.current;
    if (!sel || locked) return;
    let lines: readonly string[] = linesRef.current;
    const groups = lineSelectionGroups(sel);
    const taken: number[][] = [];
    let caret: SourcePoint | null = null;
    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g]!;
      const range = lineRunRange(lines, group.from, group.to);
      const r = applyFormat(lines, range, action);
      lines = r.lines;
      // The bottom-most group is the one processed first, and where the caret
      // belongs: it is the end of the note's last styled line.
      caret ??= r.end;
      const rows: number[] = [];
      for (let n = r.start.line; n <= r.end.line; n++) rows.push(n);
      taken.unshift(rows);
    }
    const next = lines.join("\n");
    setValue(next);
    onChange(next);
    if (caret) lastCaret.current = caret;
    const rows = taken.flat();
    setLineSelection(
      rows.length === 0
        ? null
        : { lines: rows, anchor: rows[0]!, head: rows[rows.length - 1]! },
    );
  }

  // --- Select mode: the sweep ----------------------------------------------
  //
  // One finger has to do two things while the mode is on: scroll the note, and
  // sweep a run of lines. The split is **spatial** — the sweep owns a rail down
  // the left edge (`SWEEP_RAIL_PX`), and everywhere to the right of it the note
  // scrolls exactly as it always did. The timed split this replaced (hold still
  // and the press becomes a drag) asked the user to out-race a timer on every
  // scroll, which is the wrong trade for a mode you *stay* in: picking eight
  // lines out of forty means scrolling between picks. A mouse has no such
  // conflict — it scrolls with a wheel — so a mouse drags from anywhere.
  //
  // Whether a stroke takes lines or gives them back is decided by the line it
  // starts on, once, and held for the whole drag (`PaintMode`): start on an
  // untaken line and the finger paints, start on a taken one and it erases.
  // That is the same rule that makes a second press on a line drop it — a press
  // is simply a stroke that never moved.
  const sweep = useRef<SweepStroke | null>(null);
  // The live pointer position, read by the edge auto-scroll between moves.
  const sweepAt = useRef({ x: 0, y: 0 });
  const sweepScroll = useRef(0);
  // Set by a gutter press on its way into the mode, read once by the effect
  // that seeds the mode: "the run is already painted, don't seed over it".
  const gutterEntry = useRef(false);

  function endSweep() {
    sweep.current = null;
    if (sweepScroll.current !== 0) cancelAnimationFrame(sweepScroll.current);
    sweepScroll.current = 0;
  }
  const endSweepRef = useRef(endSweep);
  endSweepRef.current = endSweep;
  useEffect(() => () => endSweepRef.current(), []);

  // Which line a point is over. The hit test answers directly nearly every
  // time; the scan behind it is for the points that are over no row at all —
  // past the last line, out in the gutter's outer inset (where the rail lives),
  // or dragged clean off the top of the note — where the nearest row is what
  // the gesture means.
  function lineRowAt(x: number, y: number): number | null {
    const root = rootRef.current;
    if (!root) return null;
    // Feature-detected rather than assumed: the hit test is a rendering API,
    // and the non-browser environments this component is exercised in (jsdom)
    // don't lay anything out — there, and wherever a point is over no row at
    // all, the geometry scan below is the answer.
    const hit =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(x, y)
        : null;
    const row = hit?.closest?.("[data-line-row]");
    if (row instanceof HTMLElement && root.contains(row)) {
      const n = Number(row.dataset.lineRow);
      if (Number.isInteger(n)) return n;
    }
    let best: number | null = null;
    let nearest = Infinity;
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>("[data-line-row]"),
    )) {
      const r = el.getBoundingClientRect();
      const away = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (away < nearest) {
        nearest = away;
        best = Number(el.dataset.lineRow);
      }
      if (away === 0) break;
    }
    return best;
  }

  // Whether a press landed on the sweep rail — the band down the left edge of
  // the *scroller*, not of the text, so it stays put when a note with wrapping
  // off is scrolled sideways. The line-number gutter is always rail, however
  // wide it has grown: a note deep enough to need three digits reserves more
  // than the fingertip band below, and a press on the far side of its own
  // numbers must not fall through to the scroller — the gutter takes no scroll
  // at all (`touch-none` in `LineRow`), so a stroke it refused would do nothing.
  function onSweepRail(x: number, target: EventTarget | null): boolean {
    if (onGutter(target)) return true;
    const scroller = scrollerRef.current;
    if (!scroller) return false;
    return x - scroller.getBoundingClientRect().left <= SWEEP_RAIL_PX;
  }

  // Replay the current stroke with its far end at `line`.
  function paintSweep(line: number) {
    const s = sweep.current;
    if (!s) return;
    setLineSelection(paintLineRun(s.base, s.anchor, line, s.mode));
  }

  function extendSweep(x: number, y: number) {
    const line = lineRowAt(x, y);
    if (line === null) return;
    paintSweep(line);
  }

  // Scroll the note while the sweep is held against the top or bottom of the
  // viewport, so a run can be longer than the screen without the finger having
  // anywhere left to go. Speed rises with how far into the edge band the
  // pointer is, and the loop stops itself the moment it leaves — every move
  // re-arms it, so there is never a frame timer running over an idle finger.
  function startSweepScroll() {
    if (sweepScroll.current !== 0) return;
    const step = () => {
      sweepScroll.current = 0;
      const s = sweep.current;
      const scroller = scrollerRef.current;
      if (!s?.dragging || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const { x, y } = sweepAt.current;
      const above = rect.top + SWEEP_EDGE_PX - y;
      const below = y - (rect.bottom - SWEEP_EDGE_PX);
      const depth = above > 0 ? above : below > 0 ? below : 0;
      if (depth === 0) return;
      const speed = Math.ceil(
        (Math.min(depth, SWEEP_EDGE_PX) / SWEEP_EDGE_PX) * SWEEP_SCROLL_MAX,
      );
      setScrollTop(scroller, scroller.scrollTop + (above > 0 ? -speed : speed));
      extendSweep(x, y);
      sweepScroll.current = requestAnimationFrame(step);
    };
    sweepScroll.current = requestAnimationFrame(step);
  }

  function onSweepDown(e: ReactPointerEvent<HTMLDivElement>) {
    const line = lineRowAt(e.clientX, e.clientY);
    if (line === null) return;
    // The press is ours end to end: no caret is placed and no focus moves.
    // (This is not what keeps the note from scrolling — a pointer event born of
    // a touch can't cancel that — which is exactly why the rail exists.)
    e.preventDefault();
    const sel = lineSelRef.current;
    const mouse = e.pointerType === "mouse";
    const rail = onSweepRail(e.clientX, e.target);
    // A stroke that owns the pointer paints as it goes; a touch outside the
    // rail is the scroller's, and only toggles the line if it never travels.
    const dragging = mouse || rail;
    sweep.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      anchor: line,
      mode: inLineSelection(sel, line) ? "remove" : "add",
      base: sel?.lines ?? [],
      dragging,
      moved: false,
      // A finger on the rail is a stroke the side menu could also be claiming,
      // so it waits out the axis test before it takes anything.
      pending: dragging && !mouse ? { entering: false } : null,
    };
    if (!dragging) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!sweep.current.pending) paintSweep(line);
  }

  // The stroke has declared itself the note's rather than the side menu's (or
  // never had to). Take the line it pressed — and, from a gutter press with the
  // mode still off, turn the mode on around it.
  function commitSweep(s: SweepStroke) {
    const p = s.pending;
    if (!p) return;
    s.pending = null;
    if (p.entering) {
      // Only a touch ever waits, so the stroke that got here is never a mouse.
      enterFromGutter(s.anchor, false);
      return;
    }
    paintSweep(s.anchor);
    // Confirm the rail took the finger as it starts to travel, so the stroke
    // is felt rather than guessed at.
    haptics.vibrate(SWEEP_FEEDBACK_MS);
  }

  // A press in the line-number gutter with the mode still *off*: the shorthand
  // way in. It turns select mode on and takes the line it landed on in one
  // gesture, and the same finger carries straight on down the gutter to take a
  // run — the sweep is live from the first pixel, so there is nothing to enter
  // the mode and then aim again for.
  //
  // The gutter is the whole affordance: it never scrolls the note and never
  // lands a caret, so there is no gesture it has to be told apart from, and
  // nothing about it can drop the mode again. The way back out is the header
  // toggle or Escape — the same two exits the mode entered from the header has.
  function onGutterDown(e: ReactPointerEvent<HTMLDivElement>) {
    const line = lineRowAt(e.clientX, e.clientY);
    if (line === null) return;
    // The press is ours end to end: no caret is placed and no focus moves.
    e.preventDefault();
    const mouse = e.pointerType === "mouse";
    sweep.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      anchor: line,
      // Nothing has been taken yet, so the stroke can only take.
      mode: "add",
      base: [],
      dragging: true,
      moved: false,
      // The gutter is on the screen edge the side menu opens from, so a finger
      // says which gesture it meant by which way it goes (see the rail's note
      // above). Nothing is taken and the mode does not turn on until it has.
      pending: mouse ? null : { entering: true },
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mouse) enterFromGutter(line, mouse);
  }

  // Turn select mode on around the line a gutter stroke pressed. Split out of
  // `onGutterDown` because a touch only reaches it once the stroke has proved
  // it isn't the side menu's — on a lift that never travelled, or on the first
  // movement that is more vertical than sideways.
  function enterFromGutter(line: number, mouse: boolean) {
    // Where the pressed line sits *now*, before the mode re-renders the note.
    // Entering drops the active raw line back to formatted, and its markdown
    // (a `#`, a `- `, a `**`) can wrap to one row more or fewer than the
    // formatted line does, reflowing everything below it — so the line under
    // the finger is pinned to the y it was pressed at (see `holdLineAnchor`).
    const anchor = lineTop(rootRef.current, line);
    // The mode leaves nothing selected on the way out, so the head of the
    // pressed line is where writing picks up again.
    lastCaret.current = { line, col: 0 };
    gutterEntry.current = true;
    paintSweep(line);
    if (!mouse) haptics.vibrate(SWEEP_FEEDBACK_MS);
    onSelectModeChange?.(true);
    if (anchor !== undefined)
      holdLineAnchor(rootRef.current, line, anchor, ANCHOR_FRAMES_FOCUSED);
  }

  function onSweepMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = sweep.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > SWEEP_SLOP || Math.abs(dy) > SWEEP_SLOP) s.moved = true;
    // A rail stroke that hasn't said which way it is going: the first real
    // travel decides. Sideways is the side menu opening from the screen edge
    // the rail shares — the note takes nothing and stays out of the way, this
    // lift included (`moved` is set, so it is no longer a tap either). Up or
    // down is the note's, and picks up from the line the finger pressed as
    // though it had been painting all along.
    if (s.pending) {
      if (!s.moved) return;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Hand the pointer back as well as the gesture: the press captured it
        // on the way down, and the rest of this stroke belongs to whatever the
        // drawer does with it.
        if (e.currentTarget.hasPointerCapture?.(e.pointerId))
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        endSweep();
        return;
      }
      commitSweep(s);
    }
    // The note is scrolling under a finger that started outside the rail. Leave
    // it alone entirely — and remember that it travelled, so letting go doesn't
    // toggle whatever line the scroll happened to end on.
    if (!s.dragging) return;
    sweepAt.current = { x: e.clientX, y: e.clientY };
    extendSweep(e.clientX, e.clientY);
    startSweepScroll();
  }

  function onSweepUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = sweep.current;
    if (!s || s.pointerId !== e.pointerId) return;
    // A press that never travelled toggles the line it landed on: it takes an
    // untaken line, and gives back one that was already taken. Off the rail
    // that is decided here rather than on the way down, because until the
    // finger lifts there is no telling a tap from the start of a scroll — and
    // on the rail, because until then there is no telling it from the side
    // menu's swipe.
    if (s.pending) {
      if (!s.moved) commitSweep(s);
    } else if (!s.dragging && !s.moved) paintSweep(s.anchor);
    endSweep();
    // Giving the last line back is the other way out. The mode is a list you
    // are picking from, and an empty list is not one: with nothing taken every
    // verb in the header is a no-op and the note still refuses a caret, so
    // emptying the run and staying in the mode is a state with nothing to do in
    // it. Undoing your last pick therefore undoes the mode as well — which is
    // what makes a mis-press cost one press to fix rather than two.
    //
    // Only an **erasing** stroke can do it, and only on the lift. A stroke that
    // started on an untaken line has taken nothing away, so a touch that merely
    // scrolled a note with nothing taken is not an exit; and an erasing stroke
    // can pass through empty on its way to giving back fewer lines than it
    // began over, so mid-drag is too early to ask.
    if (s.mode === "remove" && selectModeRef.current && !lineSelRef.current)
      exitSelectMode(false);
  }

  // Everything the mode answers from the keyboard, bound to the document
  // rather than to the surface: the mode is entered from a header button, so
  // on a desktop the surface may not hold focus at all, and Escape has to work
  // either way. Chrome that owns its own keys (the title field, the find bar)
  // is left alone.
  const selectModeKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  selectModeKeyRef.current = (e: KeyboardEvent) => {
    if (!selectModeRef.current) return;
    const root = rootRef.current;
    const el = document.activeElement;
    if (el && el !== root && !root?.contains(el)) {
      const tag = el.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable
      )
        return;
    }
    const sel = lineSelRef.current;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      // The editor sits inside the app's own Escape handling (a modal, the
      // find bar); a press that left the mode has been used up.
      e.stopPropagation();
      exitSelectMode(sel !== null);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      // Alt+↑ / Alt+↓ moves the taken lines rather than walking the selection
      // — the code editor shortcut, answered here so it reaches the mode's own
      // run (see `moveSelectedLines`).
      if (e.altKey) {
        moveSelectedLines(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      const count = linesRef.current.length;
      const next = sel
        ? moveLineSelection(
            sel,
            e.key === "ArrowUp" ? -1 : 1,
            e.shiftKey,
            count,
          )
        : singleLine(0);
      setLineSelection(next);
      scrollLineIntoView(root, next.head);
      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setLineSelection(allLines(linesRef.current.length));
      return;
    }
    if (!sel) return;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void writeClipboard(lineSelectionSource(linesRef.current, sel));
      return;
    }
    if (
      mod &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "k")
    ) {
      e.preventDefault();
      cut();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !locked) {
      e.preventDefault();
      deleteLineSelection();
    }
  };

  // Entering and leaving the mode. Entering drops every other way of pointing
  // at the note — a column of carets, a vertical run's goal column, the active
  // raw line — so the tint is the only mark on it and every line reads as the
  // formatted line it is.
  const desktopPointerRef = useRef(desktopPointer);
  desktopPointerRef.current = desktopPointer;
  const seedLineSelectionRef = useRef(seedLineSelection);
  seedLineSelectionRef.current = seedLineSelection;
  useEffect(() => {
    if (!selectMode) {
      setLineSelectionRef.current(null);
      return;
    }
    clearCursorsRef.current();
    // A gutter press enters the mode *and* takes its line in one gesture, so
    // the run its sweep is already holding is the seed. Reading the caret here
    // instead would paint over the line the finger is on — and, mid-drag, over
    // the run it has taken since.
    const fromGutter = gutterEntry.current;
    gutterEntry.current = false;
    setLineSelectionRef.current(
      fromGutter ? lineSelRef.current : seedLineSelectionRef.current(),
    );
    pendingCaret.current = null;
    pendingRange.current = null;
    pendingLineSpan.current = null;
    setActive((a) => (a.index === null ? a : { index: null, key: a.key + 1 }));
    // Focus is what makes typing over the run possible (`beforeinput` only
    // reaches a focused host), and on a desktop it costs nothing — so take it
    // there. On a phone it would raise the soft keyboard over the very lines
    // being picked, so the mode settles for whatever focus it inherited: still
    // typeable when the keyboard was already up, and otherwise a mode for
    // picking, copying and deleting, which is what a phone came here for.
    const root = rootRef.current;
    if (
      root &&
      desktopPointerRef.current &&
      !root.contains(document.activeElement)
    )
      root.focus({ preventScroll: true });
  }, [selectMode]);

  // The run reported out to the host, so the header offers the actions a
  // selection earns (copy, cut) while the mode holds one. The ordinary
  // reporter stands down while the mode is on — there is no browser selection
  // for it to read.
  //
  // Leaving the mode has to be reported too, and this is the only place that
  // sees *every* way out of it: the host owns the flag, so its own toggle (and
  // a note switch, which resets it) turns the mode off without passing through
  // `exitSelectMode` at all. Nothing else would ever say so — the ordinary
  // reporter only speaks when the browser's selection changes, and the mode
  // left it collapsed and hidden, so no `selectionchange` is coming. Without
  // this the header keeps the cut / copy / format cluster pinned out over a
  // note with nothing selected, and `reportSelection`'s dedupe latches it
  // there.
  //
  // The one exit that already knows better is the handover, which sets a real
  // selection of its own and reports it before the mode goes off.
  useEffect(() => {
    if (selectMode) {
      // The mode only ever holds whole lines, so a run it is holding is always
      // one the chevrons can move.
      reportSelectionRef.current(lineSel !== null, true);
      return;
    }
    if (!handedOver.current) reportSelectionRef.current(false);
    handedOver.current = false;
  }, [selectMode, lineSel]);

  // Keep the collapsed caret at the head of the run: it is what keeps the
  // surface receiving `beforeinput`, and `.line-select-mode` is what keeps it
  // invisible. Never *takes* focus — see the mode effect above — so on a phone
  // with the keyboard down this is simply a no-op.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!selectMode || !lineSel || !root) return;
    if (!root.contains(document.activeElement)) return;
    const { from } = lineSpan(lineSel);
    const el = root.querySelector<HTMLElement>(`[data-line-index="${from}"]`);
    const sel = window.getSelection();
    if (!el || !sel) return;
    settingSel.current = true;
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    queueMicrotask(() => {
      settingSel.current = false;
    });
  }, [selectMode, lineSel, value]);

  // The note was rewritten under the run — another writer on a live pull, the
  // app's own undo, an edit of our own that changed the line count. Fold the
  // run into the note as it now stands rather than leaving it naming lines
  // that no longer exist.
  useEffect(() => {
    const sel = lineSelRef.current;
    if (!selectModeRef.current || !sel) return;
    const next = clampLineSelection(sel, lines.length);
    if (!sameLineSelection(sel, next)) setLineSelectionRef.current(next);
  }, [lines]);

  // While a sweep is dragging, the finger belongs to the selection rather than
  // to the scroller. A non-passive listener is the only thing that can say so
  // — `touch-action` can't be changed mid-gesture — and it is bound only while
  // there is a sweep to be had, so ordinary scrolling keeps its fast path
  // everywhere else. That is the whole mode, plus the gutter whenever the
  // numbers are drawn: a press there starts its sweep a render *before* the
  // host flips the mode on, so waiting for the flag would leave the first
  // moves of the very gesture that entered the mode unguarded.
  useEffect(() => {
    if (!selectMode && !lineNumbers) return;
    const el = scrollerRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (sweep.current?.dragging) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, [selectMode, lineNumbers]);

  // Locking the note while it is open (the header's read-only toggle, or
  // another device's lock arriving on a live pull) takes the caret's line back
  // to formatted. The
  // surface stops being editable in the same render, so the browser drops the
  // caret itself; this is what stops the line the caret *was* on being left
  // showing its raw markdown, which would read as a stray `#` or `- ` in an
  // otherwise rendered note.
  useEffect(() => {
    if (!locked) return;
    clearCursorsRef.current();
    pendingCaret.current = null;
    pendingRange.current = null;
    pendingLineSpan.current = null;
    setActive((a) => (a.index === null ? a : { index: null, key: a.key + 1 }));
  }, [locked]);

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open — without disturbing the user's own typing (our keystrokes
  // echo back to the identical string, so a differing `body` is another writer).
  useEffect(() => {
    if (body === valueRef.current) return;
    // The text the column was standing in has been rewritten under it — by
    // another writer on a live pull, or by the app's own undo / redo. Column
    // positions describe a note that no longer exists.
    clearCursorsRef.current();
    setValue(body);
    const editing = document.activeElement === rootRef.current;
    setActive((a) =>
      a.index === null
        ? a
        : {
            index: Math.min(a.index, body.split("\n").length - 1),
            key: a.key + 1,
          },
    );
    // Only restore the caret when the editor was actually focused; a background
    // pull must not steal focus into the body. A locked note never has one to
    // restore.
    pendingCaret.current = editing && !lockedRef.current ? 0 : null;
    // Another writer's text just landed under the caret; the column a vertical
    // run was aiming for describes a note that no longer exists.
    goalCol.current = null;
  }, [body]);

  // An undo / redo just swapped the body in. Diff the incoming `body` against
  // the value still on screen (`valueRef` — the `[body]` effect above has
  // scheduled `setValue(body)` but React hasn't re-rendered yet, so it still
  // holds the pre-undo text) and remember the first line that changed. The
  // value-driven effect below scrolls to it once those lines have rendered. A
  // no-op tick (nothing to undo) never fires, and a change that leaves the body
  // untouched (only a title / attachment was reverted) diffs to `null`, so
  // neither disturbs the scroll position.
  useEffect(() => {
    if (undoScrollSeq === lastUndoSeq.current) return;
    lastUndoSeq.current = undoScrollSeq;
    pendingScrollLine.current = firstChangedLine(valueRef.current, body);
  }, [undoScrollSeq, body]);

  // Re-take the caret's rect a frame after it is placed, once the browser has
  // laid the edited line out (see `resyncCaret` for what this is worth on iOS,
  // where holding the eraser otherwise leaves the caret drawn rows away from
  // the text being erased).
  //
  // One frame in flight at a time: a held key re-places the caret faster than
  // frames land, and only the last placement is worth correcting. The
  // correction is guarded like every selection we set ourselves, so the
  // `selectionchange` it fires doesn't re-enter the handler that watches for
  // the *user* moving the caret.
  const caretResync = useRef(0);
  function scheduleCaretResync(el: HTMLElement) {
    if (typeof requestAnimationFrame !== "function") return;
    cancelAnimationFrame(caretResync.current);
    caretResync.current = requestAnimationFrame(() => {
      caretResync.current = 0;
      // The line can be gone by now (a note switch, an undo): there is then no
      // caret of ours left to re-take, and the surface owns whatever replaced
      // it.
      if (!el.isConnected) return;
      settingSel.current = true;
      resyncCaret(el);
      queueMicrotask(() => {
        settingSel.current = false;
      });
    });
  }
  useEffect(() => () => cancelAnimationFrame(caretResync.current), []);

  // Install the pending caret after the active line (re)renders. React owns the
  // line's DOM — the browser never mutates it (every edit is intercepted below)
  // — so after each edit the caret must be re-placed at the column the edit
  // left it. Runs whenever the value or active line changes; a null pending
  // caret (plain caret move the browser already handled) is a no-op.
  useLayoutEffect(() => {
    const el = activeElRef.current;
    const range = pendingRange.current;
    if (active.index === null || !el) return;
    if (pendingCaret.current === null && range === null) return;
    settingSel.current = true;
    const root = rootRef.current;
    if (root && document.activeElement !== root) root.focus();
    if (range) placeRange(el, range.from, range.to);
    else placeCaret(el, pendingCaret.current!);
    pendingRange.current = null;
    pendingCaret.current = null;
    // A vertical run just stepped onto this line, which is only now drawn raw
    // and so only now has the wrapping the caret has to be measured against.
    // The row it belongs on is the one the caret came in through — the last
    // when walking up, the first when walking down — and the goal column is
    // counted from that row's head, so a paragraph many rows tall is entered at
    // the column the eye is on rather than at its first row.
    const row = pendingRow.current;
    const goal = goalCol.current;
    pendingRow.current = null;
    if (row && goal !== null) {
      const text = el.textContent ?? "";
      const at = visualRowAt(el, row === "last" ? text.length : 0);
      const col = Math.min(at.start + goal, at.end);
      placeCaret(el, col);
      lastCaret.current = { line: active.index, col };
      markCaretRef.current(active.index, col, col);
    }
    // A touch tap that just landed the caret on a new line: scroll that line
    // clear of the soft keyboard. The keyboard shrinks the visual viewport
    // *after* the browser's own focus-time reveal, so a line tapped in the lower
    // half ends up hidden behind it; `scrollFocusedIntoView` waits for the
    // viewport to settle, then centres the line. Gated on the active-line key so
    // typing within the line (same key) never re-scrolls.
    if (revealPending.current && active.key !== lastRevealKey.current) {
      revealPending.current = false;
      lastRevealKey.current = active.key;
      scrollFocusedIntoView(el);
    } else {
      // Desktop / hardware-keyboard edit: no soft keyboard to clear, so just
      // keep the caret's line off the container's edges with a one-line buffer.
      // A no-op unless the edit (an Enter at the foot of the viewport) pushed
      // the caret against or past an edge.
      scrollCaretLineIntoView(rootRef.current, el);
    }
    // The caret was just set against a layout the browser hasn't performed yet
    // — React rewrote this line's text moments ago. Take it again once that
    // layout has landed, or WebKit goes on painting the caret at the rect the
    // *previous* text gave it (see `resyncCaret`).
    scheduleCaretResync(el);
    // Let the selectionchange this fires settle, then re-arm the handler.
    queueMicrotask(() => {
      settingSel.current = false;
    });
  }, [active, value]);

  // Measure the painted carets and highlights, once the lines they sit on have
  // rendered. A layout effect rather than a memo because the answer is in the
  // DOM (where a column lands depends on the font, the wrap width and the
  // note's own text), and a `ResizeObserver` because a width change moves every
  // one of them without changing a single character.
  //
  // The cursor holding the native selection is skipped: the browser is already
  // drawing it, and painting a second caret over its own would double it. Only
  // when its span sits on one line, though — a selection across lines is handed
  // the caret alone (see `focusCursor`), so the overlay owes it a highlight.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const origin = overlayRef.current;
    if (!root || !origin || !cursors || cursors.length < 2) {
      setPaint((p) => (isEmptyPaint(p) ? p : NO_PAINT));
      return;
    }
    const focus = cursors[cursors.length - 1]!;
    const [start, end] = cursorPoints(focus);
    const skip = start.line === end.line ? cursors.length - 1 : null;
    const measure = () => {
      const next = measureCursors(
        root,
        origin.getBoundingClientRect(),
        linesRef.current,
        cursors,
        skip,
      );
      setPaint((p) => (samePaint(p, next) ? p : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [cursors, value, active]);

  // Reopen the note where it was left this session. Runs after the caret-
  // placement effect above (so a remembered caret is already placed and the
  // surface focused — which raises the soft keyboard on phones), then restores
  // the scroll offset. On mobile the keyboard shrinks the visual viewport after
  // focus, so with a caret remembered we nudge its line into the smaller band —
  // but only if the keyboard actually covers it (`ifHidden`), leaving the
  // restored scroll alone when the caret is already on screen.
  useLayoutEffect(() => {
    if (!saved) return;
    setScrollTop(scrollerRef.current, saved.scrollTop);
    // The scroll offset is restored either way — where you were *reading* is
    // just as true of a locked note — but the caret half of it is not, because
    // a locked note has no caret to put back.
    if (saved.caret && !lockedRef.current) {
      const el = activeElRef.current;
      if (el) scrollFocusedIntoView(el, { ifHidden: true });
      unlock("whereYouLeftOff");
    }
  }, [saved]);

  // Stash the caret / scroll for this note as the editor unmounts — a note
  // switch remounts it under a fresh `key`, and the mount effect above reads
  // this back so you land exactly where you left off.
  useEffect(() => {
    return () => {
      if (!noteId) return;
      setEditorPosition(noteId, {
        caret: lastCaret.current,
        scrollTop: lastScrollTop.current,
      });
    };
  }, [noteId]);

  // Scroll the line an undo / redo changed into view, now that the new value has
  // rendered so the target line's DOM exists. Runs after every value change but
  // only acts on the line the effect above stashed, so ordinary typing (which
  // leaves `pendingScrollLine` null) never moves the view. Deferred behind the
  // caret placement above (a `useEffect` runs after the `useLayoutEffect`), so
  // the reveal centres on the change rather than on the restored caret.
  useEffect(() => {
    const line = pendingScrollLine.current;
    if (line === null) return;
    pendingScrollLine.current = null;
    scrollLineIntoView(rootRef.current, Math.min(line, lines.length - 1));
  }, [lines]);

  // --- Find in note --------------------------------------------------------
  //
  // The find bar's hits, bucketed by the line they sit on, so each rendered
  // line is handed only its own (`RenderedLine` paints them as `<mark>` runs).
  // Lines with no hits are left `undefined`, which the renderer resolves to its
  // shared empty list — so an open bar costs nothing on the lines it doesn't
  // touch, and a closed one costs nothing at all.
  const highlightsByLine = useMemo(() => {
    const byLine = new Map<number, LineHighlight[]>();
    for (const [i, m] of matches.entries()) {
      // A regex hit can span a line break, so each one is cut into the per-line
      // pieces a rendered line can actually paint (`matchLineSpans`).
      for (const span of matchLineSpans(m, lines)) {
        const hit = { from: span.from, to: span.to, active: i === activeMatch };
        const list = byLine.get(span.line);
        if (list) list.push(hit);
        else byLine.set(span.line, [hit]);
      }
    }
    return byLine;
  }, [matches, activeMatch, lines]);

  // Reveal the hit the bar just stepped onto. `scrollLineIntoView` leaves an
  // already-visible line alone, so walking matches within the viewport doesn't
  // jog the note; one that has scrolled off is centred.
  const activeMatchLine = matches[activeMatch]?.line ?? null;
  useEffect(() => {
    if (activeMatchLine === null) return;
    scrollLineIntoView(
      rootRef.current,
      Math.min(activeMatchLine, linesRef.current.length - 1),
    );
  }, [activeMatchLine, activeMatch]);

  // --- Structural edits (cross-line) ---------------------------------------
  //
  // Everything that spans a line boundary is applied through the pure engine so
  // formatted DOM is never read back. Desktop `keydown` and mobile `beforeinput`
  // both funnel here via `selectionPoints`, which resolves the live DOM
  // selection to ordered source `(line, col)` endpoints.
  function selectionPoints(): {
    start: SourcePoint;
    end: SourcePoint;
    collapsed: boolean;
  } | null {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return null;
    const a = sourcePointFromDom(
      root,
      blocksRef.current,
      sel.anchorNode!,
      sel.anchorOffset,
    );
    const b = sourcePointFromDom(
      root,
      blocksRef.current,
      sel.focusNode!,
      sel.focusOffset,
    );
    if (!a || !b) return null;
    const [start, end] = orderPoints(a, b);
    // A ranged selection that reaches a *formatted* line's content start has
    // visually taken the whole line, so extend it over any leading block marker
    // (so a copy / cut / replace covers the `# `, `- `, `> ` too). The active
    // raw line is exempt: its marker is text the browser can address itself.
    return {
      start: sel.isCollapsed
        ? start
        : snapStartToLineEdge(
            blocksRef.current,
            start,
            activeRef.current.index,
          ),
      end,
      collapsed: sel.isCollapsed,
    };
  }

  /**
   * The whole lines an ordinary selection covers, or null when it covers
   * anything less — what decides whether the header offers the line-move
   * chevrons, and what they then move.
   *
   * "Whole" is read strictly: the selection has to start at the head of a line
   * and stop at the foot of one. A run that takes a line and the first word of
   * the next would otherwise move that next line entire, which is not what the
   * highlight promised.
   *
   * The one latitude is an end sitting at column 0 of a *later* line — where a
   * downward drag past a line's last character naturally lands, and where the
   * browser leaves a triple-click. Nothing on that line is highlighted, so it
   * is the line above that was taken.
   */
  function wholeLineSpan(
    pts: { start: SourcePoint; end: SourcePoint; collapsed: boolean } | null,
  ): { from: number; to: number } | null {
    if (!pts || pts.collapsed || pts.start.col !== 0) return null;
    const { start, end } = pts;
    if (end.col === 0)
      return end.line > start.line
        ? { from: start.line, to: end.line - 1 }
        : null;
    if (end.col !== (linesRef.current[end.line] ?? "").length) return null;
    return { from: start.line, to: end.line };
  }

  /** Every line a ranged selection touches, whole lines or not — what the
   *  keyboard shortcut moves when the selection stops mid-line. An end parked
   *  at column 0 belongs to the line above it, exactly as in `wholeLineSpan`. */
  function lineSpanOfSelection(
    pts: { start: SourcePoint; end: SourcePoint; collapsed: boolean } | null,
  ): { from: number; to: number } | null {
    if (!pts || pts.collapsed) return null;
    const { start, end } = pts;
    const to = end.col === 0 && end.line > start.line ? end.line - 1 : end.line;
    return { from: start.line, to };
  }

  function replaceSelection(
    start: SourcePoint,
    end: SourcePoint,
    text: string,
  ) {
    const r = replaceRange(linesRef.current, start, end, text);
    commit(r.lines, r.caret);
  }

  // Resolve a `beforeinput`'s target range (the exact span the browser is about
  // to edit — it hands it to us, so word- and line-deletes come out right) to
  // ordered source points, falling back to the live selection.
  function editPoints(
    e: InputEvent,
  ): { start: SourcePoint; end: SourcePoint } | null {
    const root = rootRef.current;
    if (!root) return null;
    const ranges = e.getTargetRanges?.() ?? [];
    const r = ranges[0];
    if (r) {
      const a = sourcePointFromDom(
        root,
        blocksRef.current,
        r.startContainer,
        r.startOffset,
      );
      const b = sourcePointFromDom(
        root,
        blocksRef.current,
        r.endContainer,
        r.endOffset,
      );
      if (a && b) {
        const [start, end] = orderPoints(a, b);
        // Extend a real range over a leading block marker (see selectionPoints);
        // a collapsed target (a single keystroke) is left exactly where it is.
        return {
          start: pointsEqual(start, end)
            ? start
            : snapStartToLineEdge(
                blocksRef.current,
                start,
                activeRef.current.index,
              ),
          end,
        };
      }
    }
    const pts = selectionPoints();
    return pts ? { start: pts.start, end: pts.end } : null;
  }

  // Whether the Enter now being processed was pressed with Shift, read from the
  // `keydown` that precedes the `beforeinput` rather than from its `inputType`.
  // `insertLineBreak` vs `insertParagraph` is meant to say exactly this, but the
  // two are not reliably split that way across browsers in a plaintext-only
  // host — and getting it wrong would stop plain Enter continuing a list.
  //
  // Read through `takeSoftBreak`, which **consumes** it. Only a keydown ever
  // sets this flag, so a `beforeinput` that arrives without one (a soft
  // keyboard, an autocorrect commit, a dictated line break) would otherwise
  // inherit whatever the *last* physical press happened to say — a Shift+Enter
  // minutes ago silently turning a later plain Enter into a soft break.
  const softBreak = useRef(false);

  function takeSoftBreak(): boolean {
    const soft = softBreak.current;
    softBreak.current = false;
    return soft;
  }

  // What one keystroke does at each cursor of a column, as a replacement over
  // the flat source (see `applyAtCursors`). The browser scopes a `beforeinput`
  // to its *one* selection, so the span it hands us is no use to the other
  // cursors — each one's span has to be derived from the same `inputType`
  // instead. Null for an input type a column can't answer, which leaves the
  // source untouched rather than guessing.
  //
  // A cursor holding a selection always replaces exactly that, whatever the key
  // was: Backspace over a selection deletes the selection, at every caret.
  function multiEditPlan(
    inputType: string,
    data: string,
  ):
    ((span: Span, source: string, index: number) => Replacement | null) | null {
    if (inputType === "insertParagraph" || inputType === "insertLineBreak")
      return (span) => ({ ...span, text: "\n" });
    if (inputType.startsWith("insert"))
      return data === "" ? null : (span) => ({ ...span, text: data });
    if (!inputType.startsWith("delete")) return null;
    const forward = inputType.includes("Forward");
    const byWord = inputType.includes("Word");
    const byLine = inputType.includes("Line");
    return (span, source) => {
      if (span.to > span.from) return { ...span, text: "" };
      const at = span.from;
      if (forward) {
        const to = byLine
          ? lineEndOffset(source, at)
          : byWord
            ? wordStepOffset(at, 1)
            : stepForward(source, at);
        return to > at ? { from: at, to, text: "" } : null;
      }
      const from = byLine
        ? lineStartOffset(source, at)
        : byWord
          ? wordStepOffset(at, -1)
          : stepBackward(source, at);
      return from < at ? { from, to: at, text: "" } : null;
    };
  }

  // A word-wise delete, in flat-source offsets. Word steps stop at the line's
  // edge (see `wordBoundary`), so a caret already there falls back to eating the
  // newline itself — which is what joins the line to its neighbour, exactly as a
  // plain Backspace at column 0 does.
  function wordStepOffset(at: number, direction: -1 | 1): number {
    const cur = linesRef.current;
    const point = pointAt(cur, at);
    const col = wordBoundary(cur[point.line] ?? "", point.col, direction);
    if (col !== point.col) return offsetOf(cur, { line: point.line, col });
    return at + direction;
  }

  // One code point back / forward, so a Backspace never leaves half of an emoji
  // behind.
  function stepBackward(source: string, at: number): number {
    if (at <= 0) return at;
    const before = source.charCodeAt(at - 1);
    const pair =
      at >= 2 &&
      before >= 0xdc00 &&
      before <= 0xdfff &&
      source.charCodeAt(at - 2) >= 0xd800 &&
      source.charCodeAt(at - 2) <= 0xdbff;
    return at - (pair ? 2 : 1);
  }

  function stepForward(source: string, at: number): number {
    if (at >= source.length) return at;
    const here = source.charCodeAt(at);
    const pair =
      at + 2 <= source.length &&
      here >= 0xd800 &&
      here <= 0xdbff &&
      source.charCodeAt(at + 1) >= 0xdc00 &&
      source.charCodeAt(at + 1) <= 0xdfff;
    return at + (pair ? 2 : 1);
  }

  function lineStartOffset(source: string, at: number): number {
    return source.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  }

  function lineEndOffset(source: string, at: number): number {
    const i = source.indexOf("\n", at);
    return i === -1 ? source.length : i;
  }

  // Apply one keystroke at every cursor. Answers whether it was applied, so the
  // caller can fall through to the single-caret path when a column can't
  // express the edit.
  function applyMultiEdit(inputType: string, data: string): boolean {
    const cur = cursorsRef.current;
    if (!cur || cur.length < 2) return false;
    const plan = multiEditPlan(inputType, data);
    if (!plan) return false;
    const out = applyAtCursors(linesRef.current, cur, plan);
    if (!out) return false;
    commitCursors(out.lines, out.cursors);
    return true;
  }

  // The single source of edits. Every mutation the browser proposes — typing,
  // autocorrect, delete, word/line delete, Enter — is intercepted here and
  // applied through the pure engine, so React fully owns the DOM and the browser
  // never inserts stray nodes at the contenteditable root (which it does, given
  // the chance). IME composition is the sole exception: it must run natively
  // (it can't be `preventDefault`ed), and is reconciled on `compositionend`.
  const beforeInputRef = useRef<(e: InputEvent) => void>(() => {});
  beforeInputRef.current = (e: InputEvent) => {
    // A locked note refuses every edit outright. The surface isn't editable
    // while locked so this should never fire, but an edit that reached the DOM
    // behind React's back is exactly the failure this whole interception layer
    // exists to prevent — so refuse it here too rather than trusting the
    // attribute.
    if (locked) {
      e.preventDefault();
      return;
    }
    const it = e.inputType;
    // Select mode owns whole lines, so the collapsed caret the surface keeps
    // (only so this event fires at all) says nothing about what the keystroke
    // is aimed at — the run does. Composition is the exception it always is:
    // it can't be `preventDefault`ed, so the run is simply dropped and the
    // composed text lands as an ordinary edit at the caret.
    if (selectModeRef.current && lineSelRef.current) {
      if (composing.current || it === "insertCompositionText") {
        exitSelectMode(false);
      } else {
        e.preventDefault();
        if (it.startsWith("delete")) deleteLineSelection();
        else if (it === "insertParagraph" || it === "insertLineBreak")
          replaceLineSelection("");
        else if (it.startsWith("insert"))
          replaceLineSelection(
            e.data ?? e.dataTransfer?.getData("text/plain") ?? "",
          );
        return;
      }
    }
    // Let the composition run; `onCompositionEnd` reads the result back.
    if (composing.current || it === "insertCompositionText") return;
    // Files are handled at the `paste` / `drop` events (which `preventDefault`),
    // so their `beforeinput` never carries usable data — leave it alone.
    if (it === "insertFromPaste" || it === "insertFromDrop") return;
    // The app owns undo/redo; native contenteditable history would desync it.
    if (it === "historyUndo" || it === "historyRedo") {
      e.preventDefault();
      return;
    }
    // A column of carets answers the keystroke at every one of them, from the
    // `inputType` alone — the target range the browser hands us describes only
    // its own selection. Refused first for the same reason every other edit is:
    // React owns these nodes.
    if (cursorsRef.current && cursorsRef.current.length > 1) {
      e.preventDefault();
      if (applyMultiEdit(it, e.data ?? "")) return;
      // An input type a column can't express (a formatting command, a
      // composition commit) ends the column rather than being applied to one
      // arbitrary caret, and the single-caret path below takes it from there.
      clearCursors();
    }
    // Refused *before* the mapping is consulted, and whether or not it
    // succeeds: React owns every node in this surface, so an edit we can't
    // express as a source splice must still not reach the browser. Letting one
    // through has it rewrite the surface behind React's back, and the next
    // render — reconciling against nodes that are no longer there — throws and
    // takes the whole app down.
    e.preventDefault();
    // An edit we can't map is refused above but must not simply vanish: for an
    // insertion, fall back to the last caret we tracked so the character still
    // lands. Refusing *and* dropping it is indistinguishable from a dead
    // keyboard — the user types and nothing at all happens, with no crash and
    // no way back. A delete gets no such fallback: guessing the span would
    // remove text the browser never pointed at.
    const pts =
      editPoints(e) ?? (it.startsWith("insert") ? lastCaretSpan() : null);
    if (!pts) {
      log.warn("unmapped edit refused", it);
      return;
    }
    if (it === "insertParagraph" || it === "insertLineBreak") {
      // A quote or a list item carries its marker onto the row the split opens,
      // so pressing Enter keeps writing the same construct; Shift+Enter opens a
      // plain row inside the item instead (see `newlineFor`).
      const line = pts.start.line;
      const edit = newlineFor(
        blocksRef.current,
        line,
        pts.start.col,
        takeSoftBreak(),
      );
      // Emptying the row is a bare-caret answer (Enter on an empty list item);
      // with a range to delete, Enter splits like any other press.
      if (edit.kind === "replaceLine" && pointsEqual(pts.start, pts.end)) {
        replaceSelection(
          { line, col: 0 },
          { line, col: (linesRef.current[line] ?? "").length },
          edit.line,
        );
      } else {
        replaceSelection(
          pts.start,
          pts.end,
          edit.kind === "insert" ? edit.text : "\n",
        );
      }
    } else if (it.startsWith("insert")) {
      const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
      // A second space at the end of a word ends the sentence instead: the
      // space already there is swallowed and `". "` written over it.
      const period =
        text === " " && pointsEqual(pts.start, pts.end)
          ? autoPeriodAt(pts.start)
          : null;
      if (period) {
        replaceSelection(
          { line: pts.start.line, col: period.from },
          pts.end,
          period.text,
        );
        unlock("fullStop");
      } else {
        // The first letter of a sentence goes in capitalised. Unlike the full
        // stop above this also applies over a selection — what sits *after* the
        // caret has no say in whether a sentence starts there.
        const capital = autoCapitalAt(pts.start, text);
        replaceSelection(pts.start, pts.end, capital ?? text);
        if (capital) unlock("capitalIdea");
      }
    } else if (it.startsWith("delete")) {
      // A ranged target (a selection, or a word/line delete the browser scoped
      // for us) deletes exactly that span. A collapsed one is a single
      // Backspace/Delete: derive the one-character-or-boundary span from the
      // caret and direction (also the fallback where `getTargetRanges` is
      // absent).
      const span = pointsEqual(pts.start, pts.end)
        ? collapsedDeletion(it, pts.start)
        : pts;
      if (span) replaceSelection(span.start, span.end, "");
    }
    // Any other input type (formatting commands etc.) is simply swallowed.
  };

  // Whether the space now being inserted at `at` should end the sentence
  // instead (see `doubleSpacePeriod`), and where the rewrite starts.
  //
  // The shortcut belongs to the same family as the platform's autocorrect and
  // auto-capitalisation — it *is* that shortcut, re-applied here because
  // intercepting every insertion takes the keystroke out of the platform's
  // reach — so the one switch that turns those off turns this off too. Code is
  // the exception the platform can't make: a fenced block is verbatim text
  // where two spaces are two spaces, so it is left alone whatever the setting.
  function autoPeriodAt(
    at: SourcePoint,
  ): { from: number; text: string } | null {
    if (disableAutocorrect) return null;
    const kind = blocksRef.current[at.line]?.kind;
    if (kind === "code" || kind === "fence") return null;
    return doubleSpacePeriod(linesRef.current[at.line] ?? "", at.col);
  }

  // The capitalised form of the letter now being inserted at `at`, when it
  // starts a sentence (see `sentenceCapital`), or null to insert it as typed.
  //
  // Same family, same exceptions as the full stop above: **Disable auto
  // correct** turns it off along with the platform behaviour it stands in for,
  // and a fenced code block is verbatim text — `const x` must not become
  // `Const x` — so it is left alone whatever the settings say.
  function autoCapitalAt(at: SourcePoint, typed: string): string | null {
    if (disableAutocorrect || !capitaliseSentences) return null;
    const kind = blocksRef.current[at.line]?.kind;
    if (kind === "code" || kind === "fence") return null;
    return sentenceCapital(linesRef.current[at.line] ?? "", at.col, typed);
  }

  // The last caret we tracked, as a collapsed span clamped to the current
  // source — the landing spot for an edit whose own position the DOM couldn't
  // give up. Null before the caret has ever been placed, where there is
  // genuinely nowhere to put the edit.
  function lastCaretSpan(): { start: SourcePoint; end: SourcePoint } | null {
    const at = lastCaret.current;
    if (!at) return null;
    const cur = linesRef.current;
    const line = Math.min(Math.max(at.line, 0), cur.length - 1);
    const col = Math.min(Math.max(at.col, 0), (cur[line] ?? "").length);
    return { start: { line, col }, end: { line, col } };
  }

  // The span a collapsed Backspace / Delete removes: the character on the
  // relevant side of the caret, or — at a line edge — the newline joining it to
  // the neighbouring line (a merge).
  function collapsedDeletion(
    inputType: string,
    p: SourcePoint,
  ): { start: SourcePoint; end: SourcePoint } | null {
    const curLines = linesRef.current;
    const lineLen = (i: number) => (curLines[i] ?? "").length;
    if (inputType.toLowerCase().includes("backward")) {
      if (p.col > 0) return { start: { line: p.line, col: p.col - 1 }, end: p };
      if (p.line > 0)
        return {
          start: { line: p.line - 1, col: lineLen(p.line - 1) },
          end: p,
        };
      return null; // start of document
    }
    if (p.col < lineLen(p.line))
      return { start: p, end: { line: p.line, col: p.col + 1 } };
    if (p.line < curLines.length - 1)
      return { start: p, end: { line: p.line + 1, col: 0 } };
    return null; // end of document
  }

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const listener = (e: Event) => beforeInputRef.current(e as InputEvent);
    // Native listener: React's synthetic `onBeforeInput` has unreliable
    // `inputType` / `getTargetRanges` coverage across browsers.
    el.addEventListener("beforeinput", listener);
    return () => el.removeEventListener("beforeinput", listener);
  }, []);

  // Reconcile the active line after an IME composition (the one edit the browser
  // applies itself): read the raw line's text back into the source and restore
  // the caret to where composition left it.
  //
  // The line is *always* remounted, whether or not the text ended up different.
  // Composition is the one path where the browser writes into the line itself,
  // so React's picture of that line's children is stale the moment it starts —
  // on an empty line it swaps out the `<br>` React put there, and reconciling in
  // place then tries to remove a node that is no longer a child, which throws
  // and takes the whole app down. This is not the niche IME case it reads like:
  // a **dead key** composes too, so on the Nordic layouts (where `` ` `` and `´`
  // are dead keys) typing a plain backtick crashed the editor.
  function readBackComposition() {
    const el = activeElRef.current;
    const root = rootRef.current;
    const i = activeRef.current.index;
    if (!el || root === null || i === null) return;
    const raw = el.textContent ?? "";
    const sel = window.getSelection();
    const col =
      sel && sel.rangeCount > 0
        ? (sourcePointFromDom(
            root,
            blocksRef.current,
            sel.focusNode!,
            sel.focusOffset,
          )?.col ?? raw.length)
        : raw.length;
    const next = [...linesRef.current];
    if (next[i] === raw) {
      // Nothing to write back (a composition that resolved to what was already
      // there, or one the user cancelled) — but the browser still touched the
      // line, so it must be rebuilt rather than left for React to reconcile.
      activate(i, col, true);
      return;
    }
    next[i] = raw;
    commit(next, { line: i, col }, true);
  }

  // --- Selection-driven active line ----------------------------------------
  //
  // Moving the caret is a browser affair; we just observe where it ends up. A
  // collapsed caret on a new line makes that line active (raw) at the mapped
  // column. A ranged selection is left exactly as the browser drew it — the raw
  // active line maps to source the same as a formatted one (see
  // `markdown-selection.ts`), so there's no need to disturb it mid-selection.
  //
  // Whether a selection is up is reported out to the host as it changes (never
  // per caret move), so the header can offer the actions that operate on one.
  // Deduped through a ref: `selectionchange` fires on every keystroke, and the
  // answer is the same for nearly all of them.
  const selected = useRef(false);
  const wholeLines = useRef(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onWholeLineSelectionRef = useRef(onWholeLineSelection);
  onWholeLineSelectionRef.current = onWholeLineSelection;
  // `whole` rides along on the same call because the two answers always change
  // together — every path that gains or loses a selection knows, in the same
  // breath, whether the thing it gained covers whole lines. A selection that is
  // going away can't cover anything, so `on: false` settles both.
  function reportSelection(on: boolean, whole = false) {
    const covers = on && whole;
    if (selected.current !== on) {
      selected.current = on;
      onSelectionChangeRef.current?.(on);
    }
    if (wholeLines.current !== covers) {
      wholeLines.current = covers;
      onWholeLineSelectionRef.current?.(covers);
    }
  }
  // A selection this editor no longer owns is nobody's: a surface going away
  // (a note switch, Markdown turned off) has to take its report with it, or the
  // header keeps offering actions on a selection that isn't there.
  const reportSelectionRef = useRef(reportSelection);
  reportSelectionRef.current = reportSelection;
  useEffect(() => () => reportSelectionRef.current(false), []);

  const selChangeRef = useRef<() => void>(() => {});
  selChangeRef.current = () => {
    if (settingSel.current || composing.current) return;
    // Select mode paints its own run and keeps only a hidden collapsed caret;
    // there is nothing here for the browser's selection to say.
    if (selectModeRef.current) return;
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return reportSelection(false);
    if (!sel.anchorNode || !root.contains(sel.anchorNode))
      return reportSelection(false);
    const cur = activeRef.current.index;

    if (!sel.isCollapsed) {
      // A selection is drawn between two columns the user chose, so whatever a
      // vertical run was aiming for before it is gone.
      dropGoalColumn();
      // Both ends have to be in here for the source mapping to work — a drag
      // that ran out of the surface is left to the browser (see
      // `selectionSource`), so it isn't offered the header's actions either.
      const inside = !!sel.focusNode && root.contains(sel.focusNode);
      // A drag is left exactly as the browser is drawing it — but the toolbar
      // still wants to know what it covers, so selecting a bolded word lights
      // Bold. Reading the endpoints doesn't disturb the selection.
      const pts = selectionPoints();
      reportSelection(inside, inside && wholeLineSpan(pts) !== null);
      if (!pts) return;
      if (pts.start.line === pts.end.line)
        markCaret(pts.start.line, pts.start.col, pts.end.col);
      else clearCaretSpan();
      return;
    }
    reportSelection(false);

    const lineEl = lineElementOf(root, sel.anchorNode);
    const L = lineIndexOf(lineEl);
    if (L === null) return;
    // The caret moved out from under a column of carets by some route the
    // editor doesn't own — every gesture that *should* end a column already
    // does so at the press, so this is the backstop for the ones that can't be
    // enumerated (an assistive technology placing the caret, caret browsing).
    // Our own placements land on the focus cursor's line and are guarded by
    // `settingSel` besides, so this never fires on them.
    const column = cursorsRef.current;
    if (column && column.length > 1) {
      const focus = column[column.length - 1]!;
      if (focus.head.line !== L) clearCursors();
    }
    // Map the caret to a source column. Remember it even for a move *within* the
    // active line (which never re-enters `commit` / `activate`), so an arrow /
    // click that repositions the caret still updates the spot the unmount
    // handler saves for the session.
    const pt = sourcePointFromDom(
      root,
      blocksRef.current,
      sel.anchorNode,
      sel.anchorOffset,
    );
    if (pt) {
      lastCaret.current = pt;
      // Within-line moves matter too: stepping the caret out of a `**` run
      // must put Bold out, and that never re-enters `activate` below.
      markCaret(pt.line, pt.col, pt.col);
    }
    if (L === cur || locked) return;
    // The caret entered a different line: make that line active (raw) at the
    // column the browser mapped it to — or, mid vertical run, at the column the
    // run is aiming for, clamped to what this line actually has. Clamping and
    // *not* forgetting is the whole behaviour: a short line in the middle of the
    // run parks the caret at its end, and the next press picks the goal back up.
    //
    // Which visual *row* of the line that column is counted from can only be
    // settled once the line has rendered raw, so the effect that places the
    // caret finishes the job; this is the un-wrapped answer it starts from.
    const goal = goalCol.current;
    if (goal === null) {
      activate(L, pt?.col ?? 0);
      return;
    }
    pendingRow.current = upwards.current ? "last" : "first";
    activate(L, Math.min(goal, (linesRef.current[L] ?? "").length));
  };

  // --- Clipboard: copy/cut verbatim source, paste through the engine --------
  const onCopyRef = useRef<(e: ClipboardEvent) => void>(() => {});
  onCopyRef.current = (e: ClipboardEvent) => {
    const source = columnSource() ?? columnLineSource() ?? selectionSource();
    if (source === null) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", source);
  };

  const onCutRef = useRef<(e: ClipboardEvent) => void>(() => {});
  onCutRef.current = (e: ClipboardEvent) => {
    const run = lineSelectionClipboard();
    if (run !== null) {
      e.preventDefault();
      e.clipboardData?.setData("text/plain", run);
      unlock("guillotine");
      deleteLineSelection();
      return;
    }
    const column = columnSource();
    if (column !== null) {
      e.preventDefault();
      e.clipboardData?.setData("text/plain", column);
      // Every selection goes; the carets stay, one where each was.
      const out = applyAtCursors(
        linesRef.current,
        cursorsRef.current!,
        (span) => ({ ...span, text: "" }),
      );
      if (out) commitCursors(out.lines, out.cursors);
      return;
    }
    // The same column with nothing selected takes whole lines, the way
    // Ctrl/Cmd+X on a bare caret does in VS Code — the lines the carets are on
    // go, and each caret rides down onto whatever moved up into its place.
    const columnLines = columnLineSource();
    if (columnLines !== null) {
      e.preventDefault();
      e.clipboardData?.setData("text/plain", columnLines);
      const out = cutBareCursorLines(linesRef.current, cursorsRef.current!);
      if (out) commitCursors(out.lines, out.cursors);
      return;
    }
    const pts = selectionPoints();
    const source = selectionSource();
    if (source === null || !pts || pts.collapsed) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", source);
    replaceSelection(pts.start, pts.end, "");
  };

  // What a column of carets puts on the clipboard: each selection's source, in
  // document order, one per line — which is exactly the shape a paste back into
  // the same column consumes (see `onPaste`). Null when there is no column, or
  // when it is holding nothing but bare carets.
  function columnSource(): string | null {
    const column = cursorsRef.current;
    if (!column || column.length < 2) return null;
    const raw = linesRef.current;
    const spans = column
      .map((c) => cursorSpan(raw, c))
      .sort((a, b) => a.from - b.from);
    if (spans.every((span) => span.to === span.from)) return null;
    const source = raw.join("\n");
    return spans.map((span) => source.slice(span.from, span.to)).join("\n");
  }

  // What a column holding nothing but bare carets puts there instead: the whole
  // line each caret sits on, newline-terminated. A column of carets down the
  // edge of a list is the shape this feature exists for, and a copy or cut that
  // did nothing at all because none of them had selected anything is the one
  // answer VS Code never gives. Null unless this really is a bare column — a
  // column holding selections copies those (`columnSource`), and a lone caret
  // is the browser's business.
  function columnLineSource(): string | null {
    const column = cursorsRef.current;
    if (!column || column.length < 2) return null;
    return bareCursorLineText(linesRef.current, column);
  }

  // The verbatim source a live-preview selection covers, or null when the
  // selection is empty or outside this editor (leave it to the browser).
  function selectionSource(): string | null {
    // The mode's run is this editor's selection while it is on — what the
    // header's copy button takes, and what a copy event puts on the clipboard.
    const run = lineSelectionClipboard();
    if (run !== null) return run;
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const { anchorNode, focusNode } = sel;
    if (!anchorNode || !focusNode) return null;
    if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;
    const start = sourcePointFromDom(
      root,
      blocksRef.current,
      anchorNode,
      sel.anchorOffset,
    );
    const end = sourcePointFromDom(
      root,
      blocksRef.current,
      focusNode,
      sel.focusOffset,
    );
    if (!start || !end) return null;
    // Order, then extend the start over any leading block marker so the copied
    // source includes the `# ` / `- ` / `> ` of the first selected line.
    const [lo, hi] = orderPoints(start, end);
    return extractSourceRange(
      linesRef.current,
      snapStartToLineEdge(blocksRef.current, lo, activeRef.current.index),
      hi,
    );
  }

  useEffect(() => {
    const copy = (e: ClipboardEvent) => onCopyRef.current(e);
    const cut = (e: ClipboardEvent) => onCutRef.current(e);
    const selChange = () => selChangeRef.current();
    const keydown = (e: KeyboardEvent) => selectModeKeyRef.current(e);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("selectionchange", selChange);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("selectionchange", selChange);
      document.removeEventListener("keydown", keydown);
    };
  }, []);

  // --- Attachments (paste / drop) ------------------------------------------
  function insertAttachments(atts: readonly Attachment[]) {
    if (atts.length === 0) return;
    // Where the caret is — and `lastCaret` is the one that survives a trip out
    // of the surface, which the toolbar's Image/file entry always takes: the
    // file browser blurs the editor, so by the time the files come back there
    // is no active line left. Falling back to the end of the note would drop
    // the attachment somewhere the user wasn't looking.
    const at = clampedIndex ?? lastCaret.current?.line ?? lines.length - 1;
    const i = Math.max(0, Math.min(at, lines.length - 1));
    const cur = lines[i] ?? "";
    const inserted = [...atts.map(attachmentMarkdown), ""];
    const next = [...lines];
    const base = cur.trim() === "" ? i : i + 1;
    next.splice(base, cur.trim() === "" ? 1 : 0, ...inserted);
    commit(next, { line: base + inserted.length - 1, col: 0 });
  }

  async function attachFiles(files: readonly File[]) {
    if (!canAttach || files.length === 0) return;
    const built = await Promise.all(files.map(fileToAttachment));
    const atts = built.filter((a): a is Attachment => a !== null);
    if (atts.length === 0) return;
    for (const a of atts) onAttach?.(a);
    insertAttachments(atts);
  }

  // So the imperative handle can reach the attach path without taking a
  // rebuilt-every-render closure as a dependency (see the other `*Ref`s).
  const attachFilesRef = useRef(attachFiles);
  attachFilesRef.current = attachFiles;

  function onPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    // Nothing lands in a locked note — not text, not a file.
    if (locked) {
      e.preventDefault();
      return;
    }
    const files = canAttach ? attachableFilesFrom(e.clipboardData) : [];
    if (files.length > 0) {
      e.preventDefault();
      void attachFiles(files);
      return;
    }
    // Route all text paste through the engine so a multi-line paste never edits
    // formatted DOM and the exact source is preserved.
    // Taken from the browser unconditionally, for the reason the `beforeinput`
    // interception above is: a paste it applies itself corrupts the DOM React
    // owns. An unmappable selection drops the paste rather than risking that.
    e.preventDefault();
    // `clipboardData` is typed nullable by the DOM (React's synthetic event
    // declared it always present); a paste event without one carries nothing
    // to insert, so an empty string is the right degradation.
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // A paste with a run taken lands over the whole of it, the same as typing.
    if (selectModeRef.current && lineSelRef.current) {
      replaceLineSelection(text);
      return;
    }
    const column = cursorsRef.current;
    if (column && column.length > 1) {
      // A clipboard holding exactly one line per caret is dealt out a line
      // each — the way a column is copied, so a column round-trips. Anything
      // else goes in whole at every caret.
      //
      // Whole lines are the second shape a column copies (a bare column takes
      // the lines it sits on, newline-terminated), and they deal out too, each
      // caret taking a whole line rather than a fragment of one. The two
      // readings can never both fit: dropping the terminator leaves one part
      // fewer, so a clipboard that deals as N fragments cannot also deal as N
      // lines.
      const parts = text.split("\n");
      const whole = text.endsWith("\n")
        ? text
            .slice(0, -1)
            .split("\n")
            .map((line) => `${line}\n`)
        : null;
      const deal =
        parts.length === column.length
          ? parts
          : whole?.length === column.length
            ? whole
            : null;
      const out = applyAtCursors(linesRef.current, column, (span, _src, i) => ({
        ...span,
        text: deal ? deal[i]! : text,
      }));
      if (out) commitCursors(out.lines, out.cursors);
      return;
    }
    const pts = selectionPoints();
    if (!pts) return;
    replaceSelection(pts.start, pts.end, text);
  }

  function onDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!canAttach || locked) return;
    const files = attachableFilesFrom(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    void attachFiles(files);
  }

  // --- Keyboard shortcuts we own -------------------------------------------
  //
  // Select-all must select the whole note, not just the caret's line. Select
  // from the first rendered line to the last — anchoring the range *inside*
  // the line elements (not at the contenteditable root) so both endpoints map
  // back to source, which a later delete/copy relies on. The raw active line
  // maps to source too, so it can stay put.
  function selectAllLines() {
    const root = rootRef.current;
    if (!root) return;
    // One selection over the whole note is the opposite of a column of carets.
    clearCursors();
    const lineEls = root.querySelectorAll("[data-line-index]");
    const first = lineEls[0];
    const last = lineEls[lineEls.length - 1];
    const sel = window.getSelection();
    if (!first || !last || !sel) return;
    // The document-level fallback arrives with focus elsewhere (or nowhere);
    // take it so the selection lives in the editing host and the next
    // keystroke replaces it / Ctrl+X cuts it. The ranged selection this sets
    // keeps the focus-time selectionchange from activating a line.
    if (document.activeElement !== root) root.focus();
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Tab on a bullet or numbered row nests it one step deeper (Shift+Tab pulls it
  // back out) — the keyboard twin of the styling toolbar's indent / outdent
  // buttons, so a sub-point is written without leaving the keyboard. Answers
  // false — leaving Tab to move focus on — when the selection holds no list row,
  // and when a Shift+Tab has nothing left to unindent, so the outer level of a
  // list is never a place the keyboard can't tab out of.
  function indentList(outdent: boolean): boolean {
    if (locked) return false;
    const pts = selectionPoints();
    const at = lastCaret.current;
    const span = pts ?? (at ? { start: at, end: at } : null);
    if (!span) return false;
    let onList = false;
    let indented = false;
    for (let i = span.start.line; i <= span.end.line; i += 1) {
      const kind = blocksRef.current[i]?.kind;
      if (kind === "ul" || kind === "ol") onList = true;
      if (/^[ \t]/.test(linesRef.current[i] ?? "")) indented = true;
    }
    if (!onList || (outdent && !indented)) return false;
    format({ kind: "indent", outdent });
    return true;
  }

  // Which caret move an arrow / Home / End press is asking a column of carets
  // for, or null when the key isn't one. The modifier vocabulary is the
  // platform's own: Alt (and Ctrl, where it isn't the command key) steps by
  // word, Cmd runs to the line's edge.
  function cursorMoveFor(
    e: ReactKeyboardEvent<HTMLDivElement>,
  ): CursorMove | null {
    const byWord = e.altKey || (e.ctrlKey && !e.metaKey);
    switch (e.key) {
      case "ArrowLeft":
        return e.metaKey ? "lineStart" : byWord ? "wordLeft" : "left";
      case "ArrowRight":
        return e.metaKey ? "lineEnd" : byWord ? "wordRight" : "right";
      case "ArrowUp":
        return "up";
      case "ArrowDown":
        return "down";
      case "Home":
        return "lineStart";
      case "End":
        return "lineEnd";
      default:
        return null;
    }
  }

  // A press a column of carets has no answer for, and which would move the
  // browser's one caret out from under them if it were let through. The column
  // ends and the press is handled as it always was.
  const COLUMN_ENDING_KEYS = new Set(["PageUp", "PageDown", "Tab"]);

  // Everything a column of carets answers itself, before the ordinary
  // single-caret handling below gets a look. Answers whether the press was
  // consumed.
  function onColumnKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): boolean {
    const mod = e.metaKey || e.ctrlKey;
    // Ctrl/Cmd+D — take the word under the caret, then each next occurrence of
    // it. Taken from the browser (which bookmarks the page) whenever the
    // editing surface holds focus.
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      selectNextOccurrence();
      return true;
    }
    // Ctrl/Cmd+Up / Down — a caret on the line above / below. Alt may ride
    // along, so VS Code's own Ctrl/Cmd+Alt+Up / Down lands here too.
    if (mod && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      addCursorLine(e.key === "ArrowUp" ? -1 : 1);
      return true;
    }
    const cur = cursorsRef.current;
    if (!cur) return false;
    // Escape ends the column even when it is a run of one (the state a first
    // Ctrl/Cmd+D leaves), so the next press starts a fresh search.
    if (e.key === "Escape") {
      e.preventDefault();
      // The editor is inside the app's Escape handling (closing the find bar,
      // a modal); a press that ended a column has been used up.
      e.stopPropagation();
      collapseToPrimary();
      return true;
    }
    if (cur.length < 2) return false;
    const move = cursorMoveFor(e);
    if (move) {
      e.preventDefault();
      applyCursors(moveCursors(linesRef.current, cur, move, e.shiftKey));
      return true;
    }
    if (COLUMN_ENDING_KEYS.has(e.key)) clearCursors();
    return false;
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Select mode answers the keyboard from the document (it is entered from a
    // header button, so the surface may not even hold focus); handling a press
    // here too would answer it twice.
    if (selectMode) return;
    // Alt+↑ / Alt+↓ shuffles the selected lines up and down the note — the
    // shortcut every code editor binds, and the keyboard twin of the header's
    // two chevrons. Read before the column handler and the vertical-run
    // bookkeeping below, both of which would otherwise treat it as a caret move.
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      moveSelectedLines(e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (onColumnKeyDown(e)) return;
    // Read before anything else consumes the press: the `beforeinput` this
    // keydown is about to produce asks for it (see `softBreak`).
    softBreak.current = e.key === "Enter" && e.shiftKey;
    // Open (or carry on) a vertical run: the first Up / Down of the run pins the
    // column it is aiming for, and every other key means the user has picked a
    // new one (see `goalCol`). Bare modifiers say nothing either way.
    if (VERTICAL_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Read every press, not just the run's first: a run is free to turn
      // around, and it is the *latest* direction that says which visual row of
      // the next line the caret arrives on.
      upwards.current = e.key === "ArrowUp" || e.key === "PageUp";
      if (goalCol.current === null) goalCol.current = rowRelativeCaretColumn();
    } else if (!MODIFIER_KEYS.has(e.key)) {
      dropGoalColumn();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAllLines();
    }
    // Ctrl/Cmd+K cuts at the caret — the keyboard twin of the header's cut
    // button. Taken from the browser (Chrome and Firefox aim it at the address
    // bar) only while the editing surface holds focus.
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "k"
    ) {
      e.preventDefault();
      cut();
    }
    // Tab indents a list row and otherwise hands focus on — the host places the
    // editor in the page's tab order (the surface itself is skipped by the
    // browser). Only when the caret is in the surface: an attachment thumbnail
    // inside the note is its own tab stop, and its Tab bubbles through here.
    if (e.key === "Tab" && e.target === e.currentTarget) {
      e.preventDefault();
      if (!indentList(e.shiftKey)) onTabOut(e.shiftKey);
    }
  }

  // Ctrl/Cmd+A pressed while the surface doesn't hold focus — the opening
  // state of an existing note — would otherwise fall through to the browser's
  // page-wide select-all (title and chrome included), which can't be typed
  // over or cut.
  useSelectAllShortcut(selectAllLines);

  // Open edit mode at the end of the note (its bottom blank line). Appends a
  // trailing blank line when the note doesn't already end in one — held locally,
  // never pushed through `onChange`, so placing the caret is not an edit and
  // doesn't bump `updatedAt`. Shared by the click-below handler and the
  // imperative `focus()` the title hands down.
  function placeCaretAtEnd() {
    // A locked note has nowhere to put a caret, so the gestures that ask for
    // one — a click in the empty space below the text, the title field handing
    // focus down — simply do nothing rather than focusing an inert surface.
    if (locked) return;
    clearCursors();
    dropGoalColumn();
    rootRef.current?.focus();
    const cur = linesRef.current;
    const last = cur.length - 1;
    if ((cur[last] ?? "") !== "") {
      const next = [...cur, ""];
      setValue(next.join("\n"));
      pendingCaret.current = 0;
      // The blank line just appended, not one past it: an out-of-range active
      // index survives rendering (`clampedIndex` clamps it) but is read raw by
      // everything that indexes the source off it — the composition read-back
      // would write a whole extra line.
      lastCaret.current = { line: next.length - 1, col: 0 };
      setActive((a) => ({ index: next.length - 1, key: a.key + 1 }));
      return;
    }
    activate(last, 0);
  }

  // --- Task items ----------------------------------------------------------
  //
  // Tick `lines[index]`'s checkbox off (or back on) by flipping its `[ ]` in
  // the source. Deliberately *not* routed through `commit`: the whole point of
  // the gesture is to check something off without opening the editor, so this
  // touches neither the active line nor the caret — no raw line appears, and
  // no soft keyboard comes up on a phone. That it can skip the caret entirely
  // is `toggleTaskLine`'s doing: `[ ]` and `[x]` are the same width, so every
  // column in the note still means what it did (see `domain/markdown.ts`).
  //
  // The arming a touch press did on the way in is dropped too — nothing here
  // moves the caret, so there is no line to reveal, and leaving it set would
  // yank the view on whatever the *next* tap happens to be.
  function toggleTask(index: number) {
    if (locked) return;
    const cur = linesRef.current;
    const flipped = toggleTaskLine(cur[index] ?? "");
    if (flipped === null) return;
    revealPending.current = false;
    const next = [...cur];
    next[index] = flipped;
    const joined = next.join("\n");
    setValue(joined);
    onChange(joined);
  }

  // --- Where a press lands the caret ---------------------------------------
  //
  // The browser's own placement is exact to the pixel, which is what a mouse
  // wants and what a fingertip cannot use: a tap covers about a word, so which
  // of the characters under it the browser picks is a coin toss. A touch press
  // therefore snaps forward to the end of the word it hit (`wordEndAt`) — an
  // aimable position, and the one Backspace works back from. A mouse press is
  // left exactly where it landed.
  //
  // Either way, a press on a line the browser can't anchor a caret in at all —
  // a horizontal rule is a lone `<hr>` with no text, so the caret falls to the
  // line's start or onto a neighbour — lands at the *end* of that line instead.
  // Without this a rule can't be removed on a phone at all: the caret sits
  // before it with nothing to Backspace, and there is no forward-delete key.
  //
  // Runs on `click` rather than `pointerup`: by then the browser has placed its
  // caret (so there is something to read and adjust), and the presses that must
  // not move the caret — dragging a selection handle, a long-press selection —
  // never produce one.
  function onSurfaceClick(e: ReactMouseEvent<HTMLElement>) {
    // Select mode takes its presses at `pointerdown` and lands no caret.
    if (selectModeRef.current) return;
    // A press on a task item's checkbox ticks it off instead of landing a
    // caret. Checked before the `defaultPrevented` bail below because the
    // checkbox itself cancels the press (that is what keeps the caret — and
    // the soft keyboard — away); the line is the one the box is drawn on.
    const box = (e.target as Element | null)?.closest?.(
      `[${TASK_TOGGLE_ATTR}]`,
    );
    if (box) {
      const onLine = lineIndexOf(
        box.closest("[data-line-index]") as HTMLElement | null,
      );
      if (onLine !== null) toggleTask(onLine);
      return;
    }
    // A press the content already answered (a link opened, an attachment
    // opened) or one no pointer made (a keyboard-synthesised click).
    if (e.defaultPrevented || e.detail === 0) return;
    // On a locked note a press reveals no raw line and lands no caret. The
    // browser has already handled what it *should* do — following a link,
    // starting a selection — and there is nothing for us to adjust.
    if (locked) return;
    const root = rootRef.current;
    const lineEl = (e.target as Element | null)?.closest?.("[data-line-index]");
    if (!root || !(lineEl instanceof HTMLElement) || !root.contains(lineEl))
      return;
    const line = lineIndexOf(lineEl);
    if (line === null) return;
    // A drag-select (or a double-click's word) that happens to end here keeps
    // exactly the range the browser drew.
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
    const raw = linesRef.current[line] ?? "";
    const pt =
      sel && sel.anchorNode
        ? sourcePointFromDom(
            root,
            blocksRef.current,
            sel.anchorNode,
            sel.anchorOffset,
          )
        : null;
    // Nothing to anchor in (the rule), or the browser anchored somewhere other
    // than the line that was pressed: take the end of the pressed line.
    if (!pt || pt.line !== line || (lineEl.textContent ?? "") === "") {
      activate(line, raw.length);
      return;
    }
    if (!touchPress.current) return;
    const col = wordEndAt(raw, pt.col);
    if (col !== pt.col) activate(line, col);
  }

  // --- The styling toolbar -------------------------------------------------
  //
  // A toolbar press arrives here with the caret and any selection untouched
  // (the buttons cancel their own mousedown, so focus never left the surface).
  // The span is resolved to source points, handed to the pure formatter, and
  // the result committed like any other edit — then the selection it asks for
  // is installed: a same-line result comes back *selected*, so bolding a word
  // leaves it highlighted and a second press unbolds it, while a result
  // spanning lines settles for a caret at its end.
  function format(action: FormatAction) {
    // Block and inline formatting are whole-line / whole-selection affairs the
    // format engine expresses over one span, so a column stands down first.
    clearCursors();
    if (locked) return;
    // A run taken by select mode is styled line by line and stays taken — see
    // `formatLineSelection`.
    if (selectModeRef.current && lineSelRef.current) {
      formatLineSelection(action);
      return;
    }
    // Marks up the source and hands the caret (or the span) back itself, so it
    // picks the column the same way an edit through `commit` does.
    dropGoalColumn();
    const pts = selectionPoints();
    const at = lastCaret.current ?? { line: 0, col: 0 };
    const sel = pts
      ? { start: pts.start, end: pts.end }
      : { start: at, end: at };
    const r = applyFormat(linesRef.current, sel, action);
    const next = r.lines.join("\n");
    setValue(next);
    onChange(next);
    lastCaret.current = r.end;
    if (r.start.line === r.end.line) {
      pendingRange.current = { from: r.start.col, to: r.end.col };
      pendingCaret.current = null;
      pendingLineSpan.current = null;
      markCaret(r.end.line, r.start.col, r.end.col);
      setActive((a) => ({ index: r.end.line, key: a.key + 1 }));
      return;
    }
    // A result spanning lines drops the raw active line — every line renders
    // formatted, and the selection is drawn across whole line elements, which
    // both maps back to source cleanly and shows the result of the press.
    clearCaretSpan();
    pendingRange.current = null;
    pendingCaret.current = null;
    pendingLineSpan.current = { from: r.start.line, to: r.end.line };
    setSpanLine(r.start.line);
    setActive((a) => (a.index === null ? a : { index: null, key: a.key + 1 }));
  }

  // --- Cutting -------------------------------------------------------------
  //
  // The header's cut button and its Ctrl/Cmd+K shortcut, applied through the
  // same pure engine and `commit` as every other structural edit — so the note
  // re-renders, the caret is re-placed where the cut left it, and the app's own
  // undo can put it back. What exactly goes is `cutLine`'s call (the selection,
  // the text after a mid-line caret, or the whole line); the text it took goes
  // on the clipboard, so this really is a cut and not just a delete.
  //
  // The clipboard write is fire-and-forget: it can fail (a denied permission,
  // an insecure origin the fallback can't rescue) and the edit still stands —
  // undo is right there, and holding the edit hostage to the clipboard would
  // make the button feel broken in the case that matters least.
  //
  // Until the caret has been placed at all — an existing note opened and not
  // yet tapped — there is no line to point at, so the press does nothing
  // rather than guess at one.
  function cut() {
    // A run taken by select mode is what the button cuts, whole lines and all.
    const run = lineSelectionClipboard();
    if (run !== null) {
      if (locked) return;
      void writeClipboard(run);
      unlock("guillotine");
      deleteLineSelection();
      return;
    }
    // While the mode is on, the run *is* what the verbs act on: with no line
    // taken there is no caret on screen either, so the invisible one the last
    // press left behind is not a line to cut instead.
    if (selectModeRef.current) return;
    // The cut engine works from one caret / selection; a column hands the note
    // back to it.
    clearCursors();
    if (locked) return;
    const pts = selectionPoints();
    const at = lastCaret.current;
    const span = pts ?? (at ? { start: at, end: at } : null);
    if (!span) return;
    const r = cutLine(linesRef.current, span.start, span.end);
    if (!r) return;
    void writeClipboard(r.text);
    unlock("guillotine");
    commit(r.lines, r.caret);
    // What was selected has just been taken out, so the header's selection
    // actions go with it — the collapsed caret `commit` installs is set by us,
    // which the `selectionchange` handler deliberately ignores.
    reportSelection(false);
  }

  // --- Moving lines ---------------------------------------------------------
  //
  // The header's two chevrons and the Alt+↑ / Alt+↓ every code editor binds:
  // the selected lines shuffle one row up or down, keeping hold of the lines
  // they started on so a second press carries on where the first left off.
  // What moves is decided by whichever selection is in play — the run select
  // mode is holding, or an ordinary selection that covers whole lines — and the
  // reorder itself is `moveLines`, which is shared with the plain-textarea
  // fallback (see `docs/overview.md#move-lines`).
  //
  // The two branches differ only in how the selection is put back afterwards.
  // Select mode paints its own run, so it re-takes the lines at their new
  // indices; an ordinary selection is the browser's, so the span is queued for
  // the layout effect below to redraw once the moved lines have rendered — the
  // same handover a multi-line block format does.
  function moveSelectedLines(direction: -1 | 1) {
    if (locked) return;
    const sel = lineSelRef.current;
    if (selectModeRef.current) {
      if (!sel) return;
      const r = moveLines(linesRef.current, sel.lines, direction);
      if (!r) return;
      unlock("shuffleUp");
      const next = r.lines.join("\n");
      setValue(next);
      onChange(next);
      const rows = r.selected;
      const head = rows[rows.length - 1]!;
      lastCaret.current = { line: head, col: (r.lines[head] ?? "").length };
      setLineSelection({ lines: rows, anchor: rows[0]!, head });
      scrollLineIntoView(rootRef.current, direction === -1 ? rows[0]! : head);
      return;
    }
    // One caret's worth of selection is what the move is measured from, so a
    // column of them hands the note back first.
    clearCursors();
    const pts = selectionPoints();
    // A caret alone moves the line it sits on and rides along with it — which
    // is what the shortcut does in the editors it is borrowed from, and the
    // press you make while writing. There is no button for this: a chevron
    // offered over an untouched note would be a control with nothing named on
    // screen for it to act on.
    const at = pts?.collapsed ? pts.start : pts ? null : lastCaret.current;
    if (at) {
      const r = moveLines(linesRef.current, [at.line], direction);
      if (!r) return;
      unlock("shuffleUp");
      commit(r.lines, { line: r.selected[0] ?? at.line, col: at.col });
      return;
    }
    // A selection that stops short of a line's edge still moves every line it
    // touches, and comes back drawn over those lines whole: the move is a
    // whole-line operation, so the highlight it leaves should say so rather
    // than keep pointing at columns the reorder was never measured in.
    const span = wholeLineSpan(pts) ?? lineSpanOfSelection(pts);
    if (!span) return;
    const rows: number[] = [];
    for (let n = span.from; n <= span.to; n++) rows.push(n);
    const r = moveLines(linesRef.current, rows, direction);
    if (!r) return;
    unlock("shuffleUp");
    const next = r.lines.join("\n");
    setValue(next);
    onChange(next);
    dropGoalColumn();
    const from = r.selected[0]!;
    const to = r.selected[r.selected.length - 1]!;
    // The moved lines are drawn as a whole-line span, so no single line is
    // active and none has columns for the toolbar to read — the same shape a
    // block format's multi-line result leaves behind.
    clearCaretSpan();
    setSpanLine(from);
    lastCaret.current = { line: to, col: (r.lines[to] ?? "").length };
    pendingCaret.current = null;
    pendingRange.current = null;
    pendingLineSpan.current = { from, to };
    setActive((a) => (a.index === null ? a : { index: null, key: a.key + 1 }));
  }

  // Draw a selection over whole source lines `[from, to]`. The endpoints are
  // anchored *inside* the line elements (not at the contenteditable root) so
  // both map back to source — the same shape `selectAllLines` relies on.
  function selectLineSpan(from: number, to: number) {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    const first = root.querySelector<HTMLElement>(
      `[data-line-index="${from}"]`,
    );
    const last = root.querySelector<HTMLElement>(`[data-line-index="${to}"]`);
    if (!first || !last) return;
    settingSel.current = true;
    // Taking focus with `preventScroll`, because the browser's own focus-time
    // reveal reveals *the host* — the whole note — not the span about to be
    // selected in it. On a note whose keyboard is still down (no line active
    // yet, which is the state select mode's handover arrives in) that throws
    // the view to the top of the note, nowhere near the span. What the view
    // should follow is the span, so the reveal is ours to do afterwards.
    const took = document.activeElement !== root;
    if (took) root.focus({ preventScroll: true });
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    sel.addRange(range);
    // Focus raises the soft keyboard, which shrinks the visual viewport *after*
    // this returns — so a span in the lower half would end up behind it.
    // `scrollFocusedIntoView` waits for the viewport to settle and then only
    // moves the view if the span really is covered, leaving one that is already
    // visible exactly where the user was reading.
    if (took) scrollFocusedIntoView(first, { ifHidden: true });
    queueMicrotask(() => {
      settingSel.current = false;
    });
  }

  useLayoutEffect(() => {
    const span = pendingLineSpan.current;
    if (!span) return;
    pendingLineSpan.current = null;
    selectLineSpan(span.from, span.to);
  });

  // Focus has genuinely left the surface: drop any selection still standing in
  // it. A selection the user can no longer see must not still be there.
  //
  // On a phone the two come apart. Dismissing the soft keyboard blurs the
  // surface, and the highlight goes with it — but the DOM range survives, so
  // the next tap on those lines hands the browser an existing selection to act
  // on: it repaints the row and raises the Cut / Copy / Paste bar instead of
  // placing the caret, and only the tap *after* that gets a caret back into a
  // line that looked idle. Most visible after select mode's handover, which
  // draws a whole-line span with no active line to blur out from under it.
  //
  // Desktop keeps the browser's own behaviour, where a selection that survives
  // a click elsewhere stays painted (greyed) and is the platform convention —
  // and where there is no soft keyboard to dismiss, so the invisible-selection
  // state this clears can't arise in the first place.
  function dropSelectionOnBlur(root: HTMLElement) {
    if (desktopPointer) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const { anchorNode, focusNode } = sel;
    if (!anchorNode || !focusNode) return;
    if (!root.contains(anchorNode) && !root.contains(focusNode)) return;
    sel.removeAllRanges();
    // The toolbar's stand-in for a whole-line span goes with the span itself —
    // it only ever spoke for a selection that is now gone.
    setSpanLine(null);
  }

  // Tell the toolbar what is already in effect at the caret, so the H2 /
  // bullet / quote button can light up — and, from `caretSpan`, so can Bold
  // when the caret sits inside a `**…**` run. Skipped entirely when nobody is
  // listening (the toolbar is closed), which is the common case. With a
  // whole-line selection drawn by a block press there is no active line, so the
  // *first* selected line stands in — otherwise bulleting three lines would
  // leave the bullet button dark and its own undo press unfindable.
  const reportIndex = clampedIndex ?? spanLine;
  const lineFormat =
    reportIndex === null ? null : (blocks[reportIndex] ?? null);
  // Only columns *on the reported line* say anything about the inline marks
  // there; a caret elsewhere (or a selection across lines) reports none.
  const inlineFrom = caretSpan?.line === reportIndex ? caretSpan.from : null;
  const inlineTo = caretSpan?.line === reportIndex ? caretSpan.to : null;
  useEffect(() => {
    if (!onLineFormat) return;
    const span =
      inlineFrom === null || inlineTo === null
        ? null
        : { from: inlineFrom, to: inlineTo };
    onLineFormat(lineFormat ? lineFormatOf(lineFormat, span) : null);
  }, [onLineFormat, lineFormat, inlineFrom, inlineTo]);

  // The stand-in above only holds while nothing is being edited; the moment
  // the caret lands on a line again, that line is the truth.
  useEffect(() => {
    if (active.index !== null) setSpanLine(null);
  }, [active.index]);

  const placeCaretAtEndRef = useRef(placeCaretAtEnd);
  placeCaretAtEndRef.current = placeCaretAtEnd;
  const formatRef = useRef(format);
  formatRef.current = format;
  const cutRef = useRef(cut);
  cutRef.current = cut;
  const selectionSourceRef = useRef(selectionSource);
  selectionSourceRef.current = selectionSource;
  const moveSelectedLinesRef = useRef(moveSelectedLines);
  moveSelectedLinesRef.current = moveSelectedLines;
  useImperativeHandle(
    handleRef ?? null,
    () => ({
      focus: () => placeCaretAtEndRef.current(),
      format: (action: FormatAction) => formatRef.current(action),
      cut: () => cutRef.current(),
      selection: () => selectionSourceRef.current(),
      deleteSelection: () => deleteLineSelectionRef.current(),
      moveLines: (direction: -1 | 1) => moveSelectedLinesRef.current(direction),
      attach: (files: readonly File[]) => void attachFilesRef.current(files),
    }),
    [],
  );

  // Feature-detect the friendlier `plaintext-only` mode (Chrome/Safari): it
  // stops the browser inserting rich markup (bold spans, nested divs) that our
  // read-back can't interpret. Firefox falls back to plain `true`, where our
  // beforeinput interception keeps edits line-clean.
  const editableMode = useMemo(() => supportsPlaintextOnly(), []);

  const widthStyle =
    maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" };
  // The line-number gutter reserves only as much room as the note's highest
  // number needs, so a nine-line note hands the writing column a digit's worth
  // more width than a ten-line one does. Measured in `ch` at the *surface's*
  // font, times the `0.75em` the numbers are drawn at (see `LineRow`), so the
  // reservation tracks the digits across every font family and font-scale
  // setting — which the fixed pixel gutter this replaced did not. The numbers
  // are right-aligned against the text, so any slack falls in the outer inset
  // where there is nothing to clip.
  //
  // Select mode needs the same inset even when the note isn't numbered: the
  // sweep rail is drawn in it (see `LineRow`), and a rail painted over the
  // first characters of every line would be a rail you can't read the note
  // through. With numbers on, the gutter they already reserve *is* the rail.
  const gutterWidth = lineNumbers
    ? `calc(1rem + ${String(blocks.length).length} * 0.75ch + ${GUTTER_GAP})`
    : selectMode
      ? `calc(1rem + ${SWEEP_RAIL_GAP})`
      : null;
  // The reservation is published as a custom property as well as consumed as
  // padding, because the rail and the numbers hang *outside* the line's own box
  // (`right-full`) and so have to measure themselves against it.
  const gutterStyle = gutterWidth
    ? { paddingLeft: gutterWidth, "--gutter": gutterWidth }
    : undefined;
  const surfaceStyle: CSSProperties | undefined =
    widthStyle || gutterStyle ? { ...widthStyle, ...gutterStyle } : undefined;
  const wrapClass = wordWrap
    ? "whitespace-pre-wrap break-words"
    : "whitespace-pre";

  return (
    <AttachmentsProvider
      attachments={attachments}
      note={note}
      placement={placement}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={scrollerRef}
        className={`relative min-h-0 flex-1 overscroll-contain ${wordWrap ? "overflow-y-auto" : "overflow-auto"}`}
        onScroll={(e) => {
          // Remember how far the note is scrolled so switching away and back
          // reopens at the same offset (saved on unmount).
          lastScrollTop.current = e.currentTarget.scrollTop;
        }}
        onPointerDown={(e) => {
          // Select mode takes the press whole: it picks lines, not carets.
          if (selectMode) {
            onSweepDown(e);
            return;
          }
          // And the gutter takes it even with the mode off: a press there is
          // the shorthand that turns the mode on with that line taken, and a
          // drag down it takes a run (see `onGutterDown`). With no host to ask
          // there is no mode to enter, so the press falls through to the caret
          // rather than doing nothing at all.
          if (onSelectModeChange && onGutter(e.target)) {
            onGutterDown(e);
            return;
          }
          // A touch (or pen) tap anywhere in the editor arms the reveal so the
          // line the caret lands on is scrolled clear of the soft keyboard; a
          // mouse never needs it (no keyboard steals the caret's space).
          if (e.pointerType !== "mouse") revealPending.current = true;
          // Remember what pressed, for the caret placement the click brings.
          touchPress.current =
            e.pointerType === "touch" || e.pointerType === "pen";
          // A press picks a column outright, so it ends any vertical run — and
          // it does so here, before the browser places its caret, so the
          // `selectionchange` that follows reads the cleared goal.
          dropGoalColumn();
          // It picks a single caret too: a press is how you leave a column of
          // them, the same way it is in VS Code.
          clearCursors();
        }}
        // Unconditional, because the sweep can outlive — and, from the gutter,
        // predate — the flag: `onGutterDown` starts one a render before the
        // host turns the mode on. Each of these is a no-op with no sweep live.
        onPointerMove={onSweepMove}
        onPointerUp={onSweepUp}
        onPointerCancel={endSweep}
        onMouseDown={(e) => {
          // Select mode lands no caret anywhere, so it cancels the press that
          // would place one — and this is the event that has to do it. The
          // press itself is answered at `pointerdown`, but a pointer event
          // born of a touch can't cancel the tap's default action (see
          // `onSweepDown`), so on a phone the browser would go on to focus the
          // editing host and raise the soft keyboard over the very lines being
          // picked. The compatibility `mousedown` the tap also produces *is*
          // cancellable on every pointer type, and cancelling it is what keeps
          // the caret — and with it the keyboard — away while the mode is on.
          // Focus the mode inherited (the keyboard was already up, or a
          // desktop took it on the way in) is left exactly where it is.
          if (selectMode) {
            e.preventDefault();
            return;
          }
          // A click in the empty space below the text lands the caret at the end
          // of the note rather than doing nothing.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            placeCaretAtEnd();
          }
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (canAttach && !locked && carriesFiles(e)) e.preventDefault();
        }}
      >
        {/* The "start writing" prompt for an empty note, drawn as an overlay
            *outside* the editing host rather than as a child of it.
            A `contenteditable={false}` island inside the host is a node the
            browser feels entitled to normalise around — and on an empty note it
            sits immediately before the caret at position 0, precisely where a
            Backspace at the start of the document aims. It is also a node React
            must remove again the moment a character is typed, so anything the
            browser did to it in the meantime surfaces as a `removeChild`
            `NotFoundError` that unmounts the app. Out here it is unreachable by
            either, and the host holds nothing but lines. It mirrors the host's
            padding and width so the prompt lands exactly where the first
            character will; the host's `aria-label` already announces it, hence
            `aria-hidden`. */}
        {value === "" && (
          <div
            aria-hidden="true"
            style={surfaceStyle}
            className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-4 text-muted/60 select-none"
          >
            {t("app.startWriting")}
          </div>
        )}
        {/* Painted *before* the editing host so a highlight sits behind the
            text it covers, exactly as the browser's own `::selection` does;
            each caret lifts itself back above with a `z-index` (see
            `MultiCursorOverlay`). Empty — and so free — whenever there is only
            one caret. */}
        <div
          ref={overlayRef}
          className="pointer-events-none absolute top-0 left-0"
        >
          <MultiCursorOverlay paint={paint} />
        </div>
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          aria-label={t("app.startWriting")}
          // Out of the browser's sequential tab order: the note body sits after
          // the header in the DOM, but belongs right after the title in the tab
          // order, which document order alone can't express. The host tabs into
          // it from the title and out of it via `onTabOut`, so the surface is
          // never reached twice (and never traps focus in the header).
          tabIndex={-1}
          // Locked: not editable at all, which is what keeps the caret out (and
          // with it the soft keyboard). The node stays a `textbox` so screen
          // readers still announce it as the note's text, marked read-only.
          contentEditable={locked ? "false" : editableMode}
          aria-readonly={locked || undefined}
          spellcheck={!disableSpellcheck}
          autoCorrect={disableAutocorrect ? "off" : "on"}
          // The editor writes the sentence capital itself (`autoCapitalAt`),
          // but the hint still goes out: a keyboard that acts on it shows the
          // Shift key already up, and the two agree on the answer. Turning the
          // setting off has to turn the platform's copy off with it.
          autoCapitalize={
            disableAutocorrect || !capitaliseSentences ? "off" : "sentences"
          }
          onKeyDown={onKeyDown}
          onClick={onSurfaceClick}
          onPaste={onPaste}
          onBlur={() => {
            // Focus left the editing surface (the title field, a header button,
            // the side menu). Drop the active raw line so the whole note renders
            // fully formatted — the same state as a freshly-opened note.
            // Otherwise the last line the caret sat on keeps showing its raw
            // markdown, so a trailing `-` stays a literal dash instead of
            // becoming a horizontal rule (and a heading/quote/list its markers).
            //
            // Deferred to a microtask and gated on where focus actually landed:
            // a cross-line edit momentarily removes the focused active line
            // (React remounts it) and the caret effect refocuses the root in the
            // same commit, which fires a transient blur we must ignore. By the
            // microtask, focus is back inside the root in that case, but truly
            // outside it on a real departure. Composition never clears.
            if (composing.current) return;
            queueMicrotask(() => {
              const root = rootRef.current;
              if (!root || root.contains(document.activeElement)) return;
              setActive((a) =>
                a.index === null ? a : { index: null, key: a.key + 1 },
              );
              // Focus really left: a vertical run cannot span a trip through the
              // find bar or the title, so its goal column goes with it — and so
              // does a column of carets, which has no caret left to stand on.
              dropGoalColumn();
              clearCursorsRef.current();
              dropSelectionOnBlur(root);
            });
          }}
          onCompositionStart={() => {
            composing.current = true;
            // IME composition runs natively on the one line the browser's
            // caret is in, so there is no way to compose at N places at once.
            // The column ends and the composition carries on as an ordinary
            // single-caret edit.
            clearCursors();
          }}
          onCompositionEnd={() => {
            composing.current = false;
            readBackComposition();
          }}
          className={`relative px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg outline-none ${wordWrap ? "" : "w-max min-w-full"} ${selectMode ? "line-select-mode" : ""}`}
          style={surfaceStyle}
        >
          {blocks.map((block, index) => {
            const edgeClass = codeBlockEdgeClass(codeEdges, index);
            if (index === clampedIndex) {
              return (
                <LineRow
                  key={index}
                  index={index}
                  numbered={lineNumbers}
                  current
                  selectable={selectMode}
                  selected={false}
                  label={t("app.selectLine", { n: index + 1 })}
                >
                  <ActiveLine
                    key={`active-${active.key}`}
                    index={index}
                    block={block}
                    setRef={(el) => {
                      activeElRef.current = el;
                    }}
                    className={`cursor-text ${wrapClass} ${lineTextClass(block)} ${edgeClass}`}
                  />
                </LineRow>
              );
            }
            // A line another cursor of the column sits on renders raw too —
            // the same verbatim source the active line shows, minus the ref and
            // the keyed remount, which belong to the one line the browser's
            // caret is in.
            if (cursorRawLines?.has(index)) {
              return (
                <LineRow
                  key={index}
                  index={index}
                  numbered={lineNumbers}
                  current
                  selectable={selectMode}
                  selected={false}
                  label={t("app.selectLine", { n: index + 1 })}
                >
                  <div
                    data-line-index={index}
                    data-raw=""
                    className={`cursor-text ${wrapClass} ${lineTextClass(block)} ${edgeClass}`}
                  >
                    <RawLine block={block} />
                  </div>
                </LineRow>
              );
            }
            // An at-end attachment reference is drawn in the collected block, not
            // in place; skip its line here. It stays in the source (so indices
            // and structural edits are unaffected) and reveals its raw markdown
            // when the caret lands on it (making it the active line). A hidden
            // line takes its number with it, the way a folded region does.
            if (hidden.has(index) || hiddenFences.has(index)) return null;
            const code = copyAnchors.get(index);
            return (
              <LineRow
                key={index}
                index={index}
                numbered={lineNumbers}
                current={false}
                selectable={selectMode}
                selected={selectedLines?.has(index) === true}
                label={t("app.selectLine", { n: index + 1 })}
              >
                <div
                  data-line-index={index}
                  className={`cursor-text ${wrapClass} ${code === undefined ? "" : "relative"}`}
                >
                  <RenderedLine
                    block={block}
                    shortenLinkChars={shortenLinkChars}
                    transforms={transforms}
                    highlights={highlightsByLine.get(index)}
                    edgeClass={edgeClass}
                    interactiveTasks={!locked}
                  />
                  {code !== undefined && (
                    <CodeCopyButton
                      code={code}
                      padded={codeEdges.top.has(index)}
                    />
                  )}
                </div>
              </LineRow>
            );
          })}
        </div>
        {/* The collected attachments block, drawn *after* the editing host
            rather than as its last child — the same reason the empty-note
            prompt above is: a `contenteditable={false}` island inside the host
            is a node the browser feels entitled to normalise around, and this
            one sat at the very end of the document, exactly where a caret on
            the last line forward-deletes into. React then has to remove or
            rebuild it whenever the placement setting or the note's attachments
            change, so anything WebKit did to it in the meantime surfaces as a
            `removeChild` `NotFoundError` that unmounts the app. Out here the
            host holds nothing but lines. It mirrors the host's horizontal
            padding and width so the block lines up with the text, and carries
            the bottom safe-area inset the host would otherwise have to. */}
        <div
          style={surfaceStyle}
          className="empty:hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <AttachmentsEndBlock />
        </div>
      </div>
    </AttachmentsProvider>
  );
}

// One line of the note, optionally carrying its number in the gutter.
//
// With numbering off this is the line element itself, so the default editor
// renders exactly the DOM it always has. With it on, the line is wrapped in a
// positioning context and the number hangs in the surface's left padding —
// deliberately a *sibling* of the `[data-line-index]` element rather than a
// child of it. Everything that reads the editor's text (`offsetWithin` on the
// active raw line, the caret walker in `placeCaret`, the composition read-back)
// measures that element's own text, so a digit inside it would shift every
// column by its width and corrupt each edit.
//
// The number shrink-wraps its digits and hangs off `right-full` — its right
// edge `GUTTER_GAP` clear of the line's first character — so the column is
// right-aligned against the text without anyone having to compute a width.
//
// The digit is **top-aligned**, beside the line's *first* wrapped row. A line
// that wraps to several rows (a paragraph on a phone is routinely taller than
// the screen) is a box whose middle can be anywhere, so a centred number
// drifts away from where the line starts and, on a long enough line, off the
// screen entirely — the number of the line you are reading is the one you
// can't see. Aligning to the first row is also what makes the column read as a
// list: each number sits where its line begins. The digit is drawn at
// `0.75em`, so it rides in a box exactly one *text* row tall (`h-[1lh]` at the
// surface's own font, the same trick the task checkbox uses) and centres
// there, rather than being flush with the row's top edge where it would sit
// above the text it numbers.
//
// The press target is the whole gutter column, not the digits: the button
// spans the row's full height and stretches from the line's first character
// out to the surface's left inset (`GUTTER_GAP` of it as padding on the right,
// the outer `1rem` inset as padding on the left). Two or three characters of
// digit at three-quarter size is far below the size of a fingertip — the
// gesture is "press to the left of the line", and the target has to be the
// band the finger actually lands in.
//
// **The gutter is a selection surface and nothing else.** A press in it enters
// [select mode](docs/overview.md#select-mode) with that line taken and a drag
// down it takes a run — the surface resolves both against the row's geometry
// (`onGutterDown` / `onSweepDown`), which is why the button carries a
// `data-line-gutter` marker rather than a handler of its own. `touch-none` is
// the other half of that: the one band of the note a finger can't scroll with,
// so a stroke starting here is always a selection and never has to be told
// apart from the start of a scroll. Its `mousedown` is cancelled for the usual
// reason — that is the event an editing host takes focus from, and the gutter
// lands no caret and raises no keyboard.
function LineRow({
  index,
  numbered,
  current,
  selectable,
  selected,
  label,
  children,
}: {
  index: number;
  numbered: boolean;
  /** This is the line the caret sits on — lit the way a code editor lights it. */
  current: boolean;
  /** Select mode is on, so every line needs the box a press is resolved
   *  against (`data-line-row`) whether or not it is numbered. */
  selectable: boolean;
  /** This line is part of the run select mode has taken. */
  selected: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!numbered && !selectable) return children;
  // The tint goes on *both* boxes — the number's and the text's — because they
  // are siblings, not one inside the other: the number hangs out in the
  // surface's left padding (`right-full`), so a background on the row alone
  // would stop dead at the first character. Together they tile edge to edge
  // into one band across the page, which is what a taken line has to look like.
  const tint = selected ? " line-selected" : "";
  return (
    <div data-line-row={index} className={`relative${tint}`}>
      {numbered && (
        <button
          type="button"
          data-line-gutter=""
          // Out of the tab order for the same reason the surface itself is: the
          // editor hands focus on via `onTabOut`, and one tab stop per line would
          // make tabbing out of a long note impossible.
          tabIndex={-1}
          contentEditable={false}
          aria-label={label}
          onMouseDown={(e) => {
            // Keep the browser from moving the caret / focus with the press —
            // the gesture is answered at `pointerdown` on the surface, and a
            // tap on a touch screen arrives here as a synthesized mousedown, so
            // this covers both pointer types.
            e.preventDefault();
          }}
          className={`absolute inset-y-0 right-full flex touch-none cursor-pointer items-start justify-end pl-4 select-none${tint} ${
            current || selected
              ? "text-fg-bright"
              : "text-muted/50 hover:text-muted"
          }`}
          style={{ paddingRight: GUTTER_GAP }}
        >
          {/* One text row tall at the surface's font — not the smaller one the
            digit is drawn at — so the number centres against the line's first
            row wherever that row's own text sits. */}
          <span className="flex h-[1lh] items-center">
            <span className="text-[0.75em] tabular-nums">{index + 1}</span>
          </span>
        </button>
      )}
      {/* The sweep rail's segment for this line. Drawn *after* the number so it
          sits over the tint the number's own box carries, and drawn for every
          line — lit for a taken one, a faint track for the rest — so the rail
          reads as one continuous edge down the note rather than as a mark that
          only appears where something is already selected. `pointer-events`
          are off: the press is resolved by the surface's own handler against
          the row's geometry (`lineRowAt`), and a target here would only get in
          the way of the number's button. It hangs in the reserved inset the
          same way the number does, offset by the gutter width the surface
          publishes, so it lands at the far left whether or not the note is
          numbered. */}
      {selectable && (
        <span
          aria-hidden="true"
          contentEditable={false}
          // Square, not rounded: the segments tile edge to edge, and a radius
          // on each one would notch the rail wherever two taken lines meet —
          // an unbroken run has to read as one unbroken bar.
          className={`pointer-events-none absolute inset-y-0 w-1 select-none ${
            selected ? "sweep-rail-on" : "sweep-rail"
          }`}
          style={{ left: "calc(-1 * var(--gutter, 1rem) + 0.375rem)" }}
        />
      )}
      {children}
    </div>
  );
}

// The active (raw) line: the one line rendered as verbatim source so it can be
// edited. React fully owns its DOM — every edit is intercepted in `beforeinput`
// and applied to the source, then this re-renders with the new text and the
// caret is re-placed — so the browser never mutates it behind React's back
// (which, left to its own devices, corrupts a contenteditable's structure). The
// keyed remount on activation gives a clean node when the caret rolls to a new
// line; within a line it just updates the text.
//
// Verbatim is not the same as unstyled: `RawLine` wears the line's Markdown
// over the source, delimiters and all, so stepping the caret onto a bolded word
// keeps it bold instead of dropping it back to plain text — the `**` simply
// come into view alongside it. Its text still concatenates to `block.raw`
// exactly, which is what keeps a DOM offset into this element readable as a
// source column.
function ActiveLine({
  index,
  block,
  className,
  setRef,
}: {
  index: number;
  block: LineBlock;
  className: string;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={setRef} data-line-index={index} data-raw="" className={className}>
      <RawLine block={block} />
    </div>
  );
}

// Bring the line at `index` into view within the editor's scroll container —
// the anchor an undo / redo scrolls to. Left alone when the line is already
// fully visible, so a small revert that's on screen doesn't jump the view; when
// it's off screen the line is centred, gliding unless reduced motion is asked
// for. `root` is the contenteditable; its parent is the `overflow-y-auto`
// scroller, and the only scrollable ancestor, so `scrollIntoView` stays
// contained to the note.
function scrollLineIntoView(root: HTMLElement | null, index: number): void {
  if (!root || index < 0) return;
  const line = root.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  const scroller = root.parentElement;
  if (!line || !scroller) return;
  const lineRect = line.getBoundingClientRect();
  const viewRect = scroller.getBoundingClientRect();
  if (lineRect.top >= viewRect.top && lineRect.bottom <= viewRect.bottom)
    return;
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  line.scrollIntoView({
    block: "center",
    behavior: reduceMotion ? "auto" : "smooth",
  });
}

// Where the line at `index` currently sits in the viewport — the top of its
// *first* wrapped row, which is the row a gutter press is aimed at. Undefined
// when the line isn't rendered (nothing to anchor to).
function lineTop(root: HTMLElement | null, index: number): number | undefined {
  const line = root?.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  return line?.getBoundingClientRect().top;
}

// Hold a pressed line exactly where the finger left it, `top` being the y it
// was measured at on the way in.
//
// A gutter press has no reveal to do — you can only press a number you can see
// — but the render that answers it can still slide the view out from under it.
// Entering select mode takes the active raw line back to formatted, and its raw
// markdown (a `#`, a `- `, a `**`) can wrap to one row more or fewer than the
// formatted line does, which reflows everything below it. That reads as the
// note jumping somewhere else under the finger, rather than as the line simply
// being taken where it already was.
//
// Re-anchoring the line's first row to the y it was pressed at cancels it, and
// costs nothing when nothing moved (the sub-pixel delta bails).
//
// Held for `frames` more frames rather than applied once, because a native
// reveal is run as part of updating the rendering — it can land a frame or two
// after the commit that provoked it, and correcting it a frame late is the
// difference between a flicker and a scroll the user has to undo by hand. The
// window is short enough (a handful of frames after a press that has only just
// been released) that no real scroll gesture can be underway inside it.
function holdLineAnchor(
  root: HTMLElement | null,
  index: number,
  top: number,
  frames: number,
): void {
  const apply = () => {
    const scroller = root?.parentElement;
    const now = lineTop(root, index);
    if (!scroller || now === undefined) return;
    const delta = now - top;
    if (Math.abs(delta) < 1) return;
    scroller.scrollTop = anchoredScrollTop(
      scroller.scrollTop,
      delta,
      scroller.clientHeight,
      scroller.scrollHeight,
    );
  };
  apply();
  let left = frames;
  const again = () => {
    apply();
    if (--left > 0) requestAnimationFrame(again);
  };
  if (left > 0) requestAnimationFrame(again);
}

// How long the anchor above holds the view, in frames. Held across several
// rather than applied once, because the reflow it corrects lands a frame or two
// after the press — the mode is entered by the host, so the re-render that
// drops the raw line is a render behind the gesture — and correcting it a frame
// late is the difference between a flicker and a scroll the user has to undo by
// hand. The window is short enough (a handful of frames after a press that has
// only just landed) that no real scroll gesture can be underway inside it.
const ANCHOR_FRAMES_FOCUSED = 8;

// Restore a scroll container's offset when reopening a note. A plain helper
// (rather than an inline `el.scrollTop = …` in the effect) so the value being
// mutated isn't one the effect closes over — which the immutability lint rule
// forbids — and so it degrades to a no-op assignment under jsdom.
function setScrollTop(el: HTMLElement | null | undefined, top: number): void {
  if (el) el.scrollTop = top;
}

// Whether a drag is carrying files (rather than dragged text) — the same
// `"Files"` type check the global import uses.
function carriesFiles(e: ReactDragEvent<HTMLElement>): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
}

// Keep the caret clear of the editor's top and bottom edges by a one-line
// buffer, so an edit that lands it at the foot of the viewport — pressing Enter
// on the bottom line — scrolls it back with a blank line of breathing room
// instead of tucking it against (or past) the edge, where the browser leaves it
// because we intercept the edit and re-place the caret ourselves (no native
// reveal). A caret already inside the buffered band leaves the view untouched,
// so ordinary mid-note typing never jumps. The geometry comes from the caret's
// own rect rather than the line's box (`revealRect`): a line that soft-wraps
// past the viewport is never "inside the band", so measuring the box would
// scroll on every keystroke and aim at the paragraph's middle. `root` is the
// contenteditable; its parent is the `overflow-y-auto` scroller and the only
// scrollable ancestor, so scrolling its `scrollTop` stays contained to the note.
function scrollCaretLineIntoView(
  root: HTMLElement | null,
  line: HTMLElement | null,
): void {
  if (!root || !line) return;
  const scroller = root.parentElement;
  if (!scroller) return;
  const caretRect = revealRect(line);
  const viewRect = scroller.getBoundingClientRect();
  const top = bufferedScrollTop(
    caretRect.top,
    caretRect.height,
    viewRect.top,
    scroller.scrollTop,
    scroller.clientHeight,
    scroller.scrollHeight,
    caretRect.height,
  );
  // Absolute target (not a relative nudge) so a call issued mid-animation
  // retargets the in-flight scroll instead of compounding onto it.
  if (Math.abs(top - scroller.scrollTop) < 1) return;
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  scroller.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
}

// `contenteditable="plaintext-only"` where supported (Chrome/Safari), else the
// plain boolean. Detected once by probing a throwaway element.
function supportsPlaintextOnly(): "plaintext-only" | true {
  if (typeof document === "undefined") return true;
  try {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "plaintext-only");
    return el.contentEditable === "plaintext-only" ? "plaintext-only" : true;
  } catch {
    return true;
  }
}
