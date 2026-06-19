import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { classifyLines } from "../domain/markdown.ts";
import { useT } from "../i18n/index.ts";
import { lineTextClass } from "./markdown-line-class.ts";
import { RenderedLine } from "./MarkdownLine.tsx";

// An Obsidian-style live-preview Markdown editor. The document is rendered as
// a column of lines; every line shows its formatted Markdown except the one
// the caret sits on, which becomes a plain textarea showing the raw source.
// Moving the caret (arrows, click) "rolls" that single editable textarea from
// line to line, so editing always happens against the literal source while
// the rest of the note stays formatted.
//
// The source string is the single source of truth — we never read formatted
// DOM back. Each edit mutates the line array and re-derives the string;
// structural keys (Enter / Backspace / Delete at a boundary) splice lines
// explicitly. Clicks on a rendered line map back to a caret column via the
// `data-src` source offsets the renderer stamps on every leaf.

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
};

export function MarkdownEditor({
  body,
  onChange,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
}: Props) {
  const t = useT();
  // Local source of truth, seeded from the note. App keys the editor by note
  // id, so a different note remounts rather than reconciling mid-edit.
  const [value, setValue] = useState(body);
  const lines = useMemo(() => value.split("\n"), [value]);
  const blocks = useMemo(() => classifyLines(value), [value]);

  // The line currently being edited as raw text. Starts on the last line so
  // opening an existing note continues where it left off.
  const [active, setActive] = useState(() =>
    Math.max(0, value.split("\n").length - 1),
  );
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Caret column to install the next time the textarea (re)focuses — set
  // whenever we move the active line programmatically.
  const pendingCaret = useRef<number | null>(value.length);

  const clampedActive = Math.min(active, lines.length - 1);

  // Apply a line-array mutation: re-derive the source, move the active line,
  // and queue the caret column for the effect below to install.
  function commit(nextLines: string[], nextActive: number, caretCol: number) {
    const next = nextLines.join("\n");
    setValue(next);
    onChange(next);
    setActive(nextActive);
    pendingCaret.current = caretCol;
  }

  function moveTo(nextActive: number, caretCol: number) {
    setActive(nextActive);
    pendingCaret.current = caretCol;
  }

  // The three structural edits, shared by the desktop key handler and the
  // mobile `beforeinput` handler below. Each splices the line array and moves
  // the caret; callers decide *when* to fire them from their own event.
  function splitLine(start: number, end: number) {
    const text = lines[clampedActive] ?? "";
    const i = clampedActive;
    const next = [...lines];
    next.splice(i, 1, text.slice(0, start), text.slice(end));
    commit(next, i + 1, 0);
  }

  function mergeWithPrev() {
    const text = lines[clampedActive] ?? "";
    const i = clampedActive;
    const prev = lines[i - 1]!;
    const next = [...lines];
    next.splice(i - 1, 2, prev + text);
    commit(next, i - 1, prev.length);
  }

  function mergeWithNext() {
    const text = lines[clampedActive] ?? "";
    const i = clampedActive;
    const next = [...lines];
    next.splice(i, 2, text + lines[i + 1]!);
    commit(next, i, text.length);
  }

  // Size the textarea to its content (so it never scrolls internally) and
  // install any pending caret. Runs after every value / active-line change.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    if (wordWrap) {
      ta.style.width = "";
    } else {
      ta.style.width = "auto";
      ta.style.width = `${ta.scrollWidth}px`;
    }
    if (pendingCaret.current !== null) {
      const col = Math.min(pendingCaret.current, ta.value.length);
      ta.focus();
      ta.setSelectionRange(col, col);
      pendingCaret.current = null;
    }
  }, [clampedActive, value, wordWrap]);

  // Structural edits also arrive as `beforeinput` events, and on mobile this
  // is the *only* place they show up: soft keyboards (and IME composition)
  // deliver Enter / Backspace / Delete as `keyCode 229` "Unidentified"
  // keystrokes that never match the `onKeyDown` cases above, but they always
  // fire a `beforeinput` carrying a semantic `inputType`. We mirror the same
  // three edits here, keyed off `inputType` instead of `key`. On desktop the
  // key handler runs first and `preventDefault()`s, which suppresses the
  // matching `beforeinput`, so the two paths never both fire for one keystroke.
  //
  // Attached natively (not via React's synthetic `onBeforeInput`, whose
  // `inputType` coverage is unreliable) through a ref so the one-time listener
  // always sees current state. The textarea keeps a stable identity (`key=
  // "active"`) as the active line rolls, so binding once is enough.
  const handleBeforeInput = useRef<(e: InputEvent) => void>(() => {});
  handleBeforeInput.current = (e: InputEvent) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = lines[clampedActive] ?? "";
    const i = clampedActive;
    switch (e.inputType) {
      case "insertLineBreak":
      case "insertParagraph":
        e.preventDefault();
        splitLine(start, end);
        break;
      case "deleteContentBackward":
        if (start === 0 && end === 0 && i > 0) {
          e.preventDefault();
          mergeWithPrev();
        }
        break;
      case "deleteContentForward":
        if (
          start === text.length &&
          end === text.length &&
          i < lines.length - 1
        ) {
          e.preventDefault();
          mergeWithNext();
        }
        break;
    }
  };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const listener = (e: InputEvent) => handleBeforeInput.current(e);
    ta.addEventListener("beforeinput", listener);
    return () => ta.removeEventListener("beforeinput", listener);
  }, []);

  function onTextChange(text: string) {
    const next = [...lines];
    next[clampedActive] = text;
    const joined = next.join("\n");
    setValue(joined);
    onChange(joined);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = lines[clampedActive] ?? "";
    const i = clampedActive;

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      splitLine(start, end);
      return;
    }

    if (e.key === "Backspace" && start === 0 && end === 0 && i > 0) {
      e.preventDefault();
      mergeWithPrev();
      return;
    }

    if (
      e.key === "Delete" &&
      start === text.length &&
      end === text.length &&
      i < lines.length - 1
    ) {
      e.preventDefault();
      mergeWithNext();
      return;
    }

    if (e.key === "ArrowLeft" && start === 0 && end === 0 && i > 0) {
      e.preventDefault();
      moveTo(i - 1, lines[i - 1]!.length);
      return;
    }

    if (
      e.key === "ArrowRight" &&
      start === text.length &&
      end === text.length &&
      i < lines.length - 1
    ) {
      e.preventDefault();
      moveTo(i + 1, 0);
      return;
    }

    // Up / down cross to the adjacent line when the caret is already on the
    // textarea's first / last visual row (a single-row line always qualifies),
    // otherwise the textarea moves the caret within its own wrapped rows.
    if (e.key === "ArrowUp" && i > 0) {
      if (visualRows(ta) <= 1 || start === 0) {
        e.preventDefault();
        moveTo(i - 1, Math.min(start, lines[i - 1]!.length));
        return;
      }
    }
    if (e.key === "ArrowDown" && i < lines.length - 1) {
      if (visualRows(ta) <= 1 || end === text.length) {
        e.preventDefault();
        moveTo(i + 1, Math.min(start, lines[i + 1]!.length));
        return;
      }
    }
  }

  // Clicking a rendered line makes it active, placing the caret at the source
  // column nearest the pointer (resolved through the `data-src` offsets).
  function activateAt(e: ReactMouseEvent, index: number) {
    e.preventDefault();
    moveTo(index, columnFromPoint(e.clientX, e.clientY, blocks[index]!));
  }

  const widthStyle =
    maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" };
  const wrapClass = wordWrap
    ? "whitespace-pre-wrap break-words"
    : "whitespace-pre";

  return (
    // This is one editing widget, not a set of independent controls: the
    // textarea is the focusable, keyboard-driven surface, and the line
    // <div>s are non-interactive visual proxies for source the textarea
    // edits. Clicking one only repositions the caret (keyboard users move it
    // with the arrow keys), so the static-interaction a11y rule doesn't apply.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={`min-h-0 flex-1 ${wordWrap ? "overflow-y-auto" : "overflow-auto"}`}
      onMouseDown={(e) => {
        // A click in the empty area below the text drops the caret at the end
        // of the note rather than doing nothing.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          const last = lines.length - 1;
          moveTo(last, lines[last]!.length);
        }
      }}
    >
      <div
        className={`px-4 py-4 ${wordWrap ? "" : "w-max min-w-full"}`}
        style={widthStyle}
      >
        {lines.map((line, index) =>
          index === clampedActive ? (
            <textarea
              key="active"
              ref={taRef}
              rows={1}
              wrap={wordWrap ? "soft" : "off"}
              value={line}
              spellCheck={!disableSpellcheck}
              autoCorrect={disableAutocorrect ? "off" : "on"}
              autoCapitalize={disableAutocorrect ? "off" : "sentences"}
              placeholder={
                lines.length === 1 ? t("app.startWriting") : undefined
              }
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={onKeyDown}
              className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-fg outline-none placeholder:text-muted/60 ${wrapClass} ${lineTextClass(
                blocks[clampedActive]!,
              )}`}
            />
          ) : (
            // A visual proxy for one source line; clicking rolls the editing
            // textarea here. See the widget note above.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              key={index}
              onMouseDown={(e) => activateAt(e, index)}
              className={`cursor-text text-fg ${wrapClass}`}
            >
              <RenderedLine block={blocks[index]!} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// How many visual rows the textarea's content occupies — used to decide
// whether an up/down arrow should cross to the next line or move within a
// wrapped line.
function visualRows(ta: HTMLTextAreaElement): number {
  const cs = getComputedStyle(ta);
  let lh = parseFloat(cs.lineHeight);
  if (!lh) lh = parseFloat(cs.fontSize) * 1.5;
  return lh > 0 ? Math.max(1, Math.round(ta.scrollHeight / lh)) : 1;
}

type CaretHit = { node: Node; offset: number };

function caretFromPoint(x: number, y: number): CaretHit | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}

// Translate a pointer position over a rendered line into a source column,
// reading the `data-src` offset off the nearest stamped leaf. Falls back to
// the end of the line's content when the pointer doesn't land on text.
function columnFromPoint(
  x: number,
  y: number,
  block: { content: string; contentStart: number },
): number {
  const fallback = block.contentStart + block.content.length;
  const hit = caretFromPoint(x, y);
  if (!hit) return fallback;
  let el: Element | null =
    hit.node.nodeType === Node.TEXT_NODE
      ? hit.node.parentElement
      : (hit.node as Element);
  while (el && !(el instanceof HTMLElement && el.dataset.src !== undefined)) {
    el = el.parentElement;
  }
  if (el instanceof HTMLElement && el.dataset.src !== undefined) {
    const base = Number.parseInt(el.dataset.src, 10);
    const local = hit.node.nodeType === Node.TEXT_NODE ? hit.offset : 0;
    return base + local;
  }
  return fallback;
}
