import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";

import {
  type Attachment,
  type AttachmentPlacement,
  attachmentMarkdown,
  hiddenAttachmentLines,
  INLINE_PLACEMENT,
} from "../domain/attachment.ts";
import {
  orderPoints,
  pointsEqual,
  replaceRange,
  type SourcePoint,
} from "../domain/line-edit.ts";
import { classifyLines } from "../domain/markdown.ts";
import type { Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
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
} from "./contenteditable-caret.ts";
import { lineTextClass } from "./markdown-line-class.ts";
import { RenderedLine } from "./MarkdownLine.tsx";
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
  /** Wrap long lines, or keep them on one line and scroll horizontally. */
  wordWrap: boolean;
  /** Turn off browser/OS spell check (the red squiggles). */
  disableSpellcheck: boolean;
  /** Turn off mobile autocorrect and auto-capitalisation. */
  disableAutocorrect: boolean;
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
  /** Imperative handle so the title field can hand focus down into the body. */
  ref?: Ref<MarkdownEditorHandle>;
};

/** What the editor exposes to its parent: a way to start editing from outside. */
export type MarkdownEditorHandle = {
  /** Place the caret at the end of the note and start editing there. */
  focus: () => void;
};

// The active line's identity: which source line is being edited as raw text, and
// a monotonically-rising key bumped only when the caret rolls onto a *different*
// line, so React remounts a clean node then but merely updates the text in place
// while the user types within one line.
type Active = { index: number | null; key: number };

export function MarkdownEditor({
  body,
  onChange,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
  focusOnMount = true,
  note = null,
  attachments,
  canAttach = false,
  onAttach,
  placement = INLINE_PLACEMENT,
  shortenLinkChars = 0,
  ref,
}: Props) {
  const t = useT();
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

  const [active, setActive] = useState<Active>(() => ({
    index: focusOnMount ? Math.max(0, body.split("\n").length - 1) : null,
    key: 0,
  }));

  // Refs so the document-level and native listeners below always read current
  // state without re-binding (they capture these, not the render closure).
  const rootRef = useRef<HTMLDivElement>(null);
  const activeElRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const linesRef = useRef(lines);
  const blocksRef = useRef(blocks);
  const activeRef = useRef(active);
  valueRef.current = value;
  linesRef.current = lines;
  blocksRef.current = blocks;
  activeRef.current = active;

  // The caret column to install after the active line (re)renders, or null when
  // the browser already left the caret where it belongs (a plain caret move).
  const pendingCaret = useRef<number | null>(
    focusOnMount ? Math.max(0, (lines[lines.length - 1] ?? "").length) : null,
  );
  // Guards so a caret we place programmatically doesn't re-enter the
  // `selectionchange` handler, and so IME composition isn't disturbed.
  const settingSel = useRef(false);
  const composing = useRef(false);

  const clampedIndex =
    active.index === null ? null : Math.min(active.index, lines.length - 1);

  // Mutate the source and move the caret. Re-derives the string and queues the
  // caret column for the effect below to install. The active node is remounted
  // (bumped key) only when the caret crosses onto a *different* line — a
  // same-line edit keeps the node, letting React update its text in place.
  function commit(nextLines: string[], caret: SourcePoint) {
    const next = nextLines.join("\n");
    setValue(next);
    onChange(next);
    pendingCaret.current = caret.col;
    setActive((a) => ({
      index: caret.line,
      key: a.index === caret.line ? a.key : a.key + 1,
    }));
  }

  // Move the active line without editing the source (a caret move that reveals a
  // new raw line). Remounts the active node so it renders that line's raw text.
  function activate(index: number, col: number) {
    pendingCaret.current = col;
    setActive((a) => ({ index, key: a.index === index ? a.key : a.key + 1 }));
  }

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open — without disturbing the user's own typing (our keystrokes
  // echo back to the identical string, so a differing `body` is another writer).
  useEffect(() => {
    if (body === valueRef.current) return;
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
    // pull must not steal focus into the body.
    pendingCaret.current = editing ? 0 : null;
  }, [body]);

  // Install the pending caret after the active line (re)renders. React owns the
  // line's DOM — the browser never mutates it (every edit is intercepted below)
  // — so after each edit the caret must be re-placed at the column the edit
  // left it. Runs whenever the value or active line changes; a null pending
  // caret (plain caret move the browser already handled) is a no-op.
  useLayoutEffect(() => {
    const el = activeElRef.current;
    if (active.index === null || !el || pendingCaret.current === null) return;
    settingSel.current = true;
    const root = rootRef.current;
    if (root && document.activeElement !== root) root.focus();
    placeCaret(el, pendingCaret.current);
    pendingCaret.current = null;
    // Let the selectionchange this fires settle, then re-arm the handler.
    queueMicrotask(() => {
      settingSel.current = false;
    });
  }, [active, value]);

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
    // A ranged selection that reaches a line's content start has visually taken
    // the whole line, so extend it over any leading block marker (so a copy /
    // cut / replace covers the `# `, `- `, `> ` too).
    return {
      start: sel.isCollapsed
        ? start
        : snapStartToLineEdge(blocksRef.current, start),
      end,
      collapsed: sel.isCollapsed,
    };
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
            : snapStartToLineEdge(blocksRef.current, start),
          end,
        };
      }
    }
    const pts = selectionPoints();
    return pts ? { start: pts.start, end: pts.end } : null;
  }

  // The single source of edits. Every mutation the browser proposes — typing,
  // autocorrect, delete, word/line delete, Enter — is intercepted here and
  // applied through the pure engine, so React fully owns the DOM and the browser
  // never inserts stray nodes at the contenteditable root (which it does, given
  // the chance). IME composition is the sole exception: it must run natively
  // (it can't be `preventDefault`ed), and is reconciled on `compositionend`.
  const beforeInputRef = useRef<(e: InputEvent) => void>(() => {});
  beforeInputRef.current = (e: InputEvent) => {
    const it = e.inputType;
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
    const pts = editPoints(e);
    if (!pts) return;
    e.preventDefault();
    if (it === "insertParagraph" || it === "insertLineBreak") {
      replaceSelection(pts.start, pts.end, "\n");
    } else if (it.startsWith("insert")) {
      replaceSelection(
        pts.start,
        pts.end,
        e.data ?? e.dataTransfer?.getData("text/plain") ?? "",
      );
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
    if (next[i] !== raw) {
      next[i] = raw;
      commit(next, { line: i, col });
    }
  }

  // --- Selection-driven active line ----------------------------------------
  //
  // Moving the caret is a browser affair; we just observe where it ends up. A
  // collapsed caret on a new line makes that line active (raw) at the mapped
  // column. A ranged selection is left exactly as the browser drew it — the raw
  // active line maps to source the same as a formatted one (see
  // `markdown-selection.ts`), so there's no need to disturb it mid-selection.
  const selChangeRef = useRef<() => void>(() => {});
  selChangeRef.current = () => {
    if (settingSel.current || composing.current) return;
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    if (!sel.anchorNode || !root.contains(sel.anchorNode)) return;
    const cur = activeRef.current.index;

    if (!sel.isCollapsed) return;

    const lineEl = lineElementOf(root, sel.anchorNode);
    const L = lineIndexOf(lineEl);
    if (L === null || L === cur) return;
    // The caret entered a formatted line: map its DOM position to a source
    // column, then make that line active (raw) at the same column.
    const pt = sourcePointFromDom(
      root,
      blocksRef.current,
      sel.anchorNode,
      sel.anchorOffset,
    );
    activate(L, pt?.col ?? 0);
  };

  // --- Clipboard: copy/cut verbatim source, paste through the engine --------
  const onCopyRef = useRef<(e: ClipboardEvent) => void>(() => {});
  onCopyRef.current = (e: ClipboardEvent) => {
    const source = selectionSource();
    if (source === null) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", source);
  };

  const onCutRef = useRef<(e: ClipboardEvent) => void>(() => {});
  onCutRef.current = (e: ClipboardEvent) => {
    const pts = selectionPoints();
    const source = selectionSource();
    if (source === null || !pts || pts.collapsed) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", source);
    replaceSelection(pts.start, pts.end, "");
  };

  // The verbatim source a live-preview selection covers, or null when the
  // selection is empty or outside this editor (leave it to the browser).
  function selectionSource(): string | null {
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
      snapStartToLineEdge(blocksRef.current, lo),
      hi,
    );
  }

  useEffect(() => {
    const copy = (e: ClipboardEvent) => onCopyRef.current(e);
    const cut = (e: ClipboardEvent) => onCutRef.current(e);
    const selChange = () => selChangeRef.current();
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("selectionchange", selChange);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("selectionchange", selChange);
    };
  }, []);

  // --- Attachments (paste / drop) ------------------------------------------
  function insertAttachments(atts: readonly Attachment[]) {
    if (atts.length === 0) return;
    const i = clampedIndex ?? lines.length - 1;
    const cur = lines[i] ?? "";
    const inserted = [...atts.map(attachmentMarkdown), ""];
    const next = [...lines];
    const base = cur.trim() === "" ? i : i + 1;
    next.splice(base, cur.trim() === "" ? 1 : 0, ...inserted);
    commit(next, { line: base + inserted.length - 1, col: 0 });
  }

  async function attachFiles(files: File[]) {
    if (!canAttach || files.length === 0) return;
    const built = await Promise.all(files.map(fileToAttachment));
    const atts = built.filter((a): a is Attachment => a !== null);
    if (atts.length === 0) return;
    for (const a of atts) onAttach?.(a);
    insertAttachments(atts);
  }

  function onPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    const files = canAttach ? attachableFilesFrom(e.clipboardData) : [];
    if (files.length > 0) {
      e.preventDefault();
      void attachFiles(files);
      return;
    }
    // Route all text paste through the engine so a multi-line paste never edits
    // formatted DOM and the exact source is preserved.
    const text = e.clipboardData.getData("text/plain");
    const pts = selectionPoints();
    if (!pts) return;
    e.preventDefault();
    replaceSelection(pts.start, pts.end, text);
  }

  function onDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!canAttach) return;
    const files = attachableFilesFrom(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    void attachFiles(files);
  }

  // --- Keyboard shortcuts we own -------------------------------------------
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Select-all must select the whole note, not just the caret's line. Select
    // from the first rendered line to the last — anchoring the range *inside*
    // the line elements (not at the contenteditable root) so both endpoints map
    // back to source, which a later delete/copy relies on. The raw active line
    // maps to source too, so it can stay put.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      const root = rootRef.current;
      if (!root) return;
      e.preventDefault();
      const lineEls = root.querySelectorAll("[data-line-index]");
      const first = lineEls[0];
      const last = lineEls[lineEls.length - 1];
      const sel = window.getSelection();
      if (!first || !last || !sel) return;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // Open edit mode at the end of the note (its bottom blank line). Appends a
  // trailing blank line when the note doesn't already end in one — held locally,
  // never pushed through `onChange`, so placing the caret is not an edit and
  // doesn't bump `updatedAt`. Shared by the click-below handler and the
  // imperative `focus()` the title hands down.
  function placeCaretAtEnd() {
    rootRef.current?.focus();
    const cur = linesRef.current;
    const last = cur.length - 1;
    if ((cur[last] ?? "") !== "") {
      const next = [...cur, ""];
      setValue(next.join("\n"));
      pendingCaret.current = 0;
      setActive((a) => ({ index: next.length, key: a.key + 1 }));
      return;
    }
    activate(last, 0);
  }
  const placeCaretAtEndRef = useRef(placeCaretAtEnd);
  placeCaretAtEndRef.current = placeCaretAtEnd;
  useImperativeHandle(
    ref,
    () => ({ focus: () => placeCaretAtEndRef.current() }),
    [],
  );

  // Feature-detect the friendlier `plaintext-only` mode (Chrome/Safari): it
  // stops the browser inserting rich markup (bold spans, nested divs) that our
  // read-back can't interpret. Firefox falls back to plain `true`, where our
  // beforeinput interception keeps edits line-clean.
  const editableMode = useMemo(() => supportsPlaintextOnly(), []);

  const widthStyle =
    maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" };
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
        className={`min-h-0 flex-1 ${wordWrap ? "overflow-y-auto" : "overflow-auto"}`}
        onMouseDown={(e) => {
          // A click in the empty space below the text lands the caret at the end
          // of the note rather than doing nothing.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            placeCaretAtEnd();
          }
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (canAttach && carriesFiles(e)) e.preventDefault();
        }}
      >
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          aria-label={t("app.startWriting")}
          tabIndex={0}
          contentEditable={editableMode}
          suppressContentEditableWarning
          spellCheck={!disableSpellcheck}
          autoCorrect={disableAutocorrect ? "off" : "on"}
          autoCapitalize={disableAutocorrect ? "off" : "sentences"}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            readBackComposition();
          }}
          className={`relative px-4 py-4 text-fg outline-none ${wordWrap ? "" : "w-max min-w-full"}`}
          style={widthStyle}
        >
          {value === "" && (
            <span
              contentEditable={false}
              className="pointer-events-none absolute text-muted/60 select-none"
            >
              {t("app.startWriting")}
            </span>
          )}
          {lines.map((line, index) => {
            if (index === clampedIndex) {
              return (
                <ActiveLine
                  key={`active-${active.key}`}
                  index={index}
                  text={line}
                  setRef={(el) => {
                    activeElRef.current = el;
                  }}
                  className={`cursor-text ${wrapClass} ${lineTextClass(blocks[index]!)}`}
                />
              );
            }
            // An at-end attachment reference is drawn in the collected block, not
            // in place; skip its line here. It stays in the source (so indices
            // and structural edits are unaffected) and reveals its raw markdown
            // when the caret lands on it (making it the active line).
            if (hidden.has(index)) return null;
            return (
              <div
                key={index}
                data-line-index={index}
                className={`cursor-text ${wrapClass}`}
              >
                <RenderedLine
                  block={blocks[index]!}
                  shortenLinkChars={shortenLinkChars}
                />
              </div>
            );
          })}
          <div contentEditable={false}>
            <AttachmentsEndBlock />
          </div>
        </div>
      </div>
    </AttachmentsProvider>
  );
}

// The active (raw) line: the one line rendered as verbatim source so it can be
// edited. React fully owns its DOM — every edit is intercepted in `beforeinput`
// and applied to the source, then this re-renders with the new text and the
// caret is re-placed — so the browser never mutates it behind React's back
// (which, left to its own devices, corrupts a contenteditable's structure). The
// keyed remount on activation gives a clean node when the caret rolls to a new
// line; within a line it just updates the text. A lone `<br>` keeps an empty
// line tall and focusable.
function ActiveLine({
  index,
  text,
  className,
  setRef,
}: {
  index: number;
  text: string;
  className: string;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={setRef}
      data-line-index={index}
      data-raw=""
      suppressContentEditableWarning
      className={className}
    >
      {text === "" ? <br /> : text}
    </div>
  );
}

// Whether a drag is carrying files (rather than dragged text) — the same
// `"Files"` type check the global import uses.
function carriesFiles(e: ReactDragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
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
