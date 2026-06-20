import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  type Attachment,
  type AttachmentPlacement,
  attachmentMarkdown,
  hiddenAttachmentLines,
  INLINE_PLACEMENT,
} from "../domain/attachment.ts";
import { classifyLines } from "../domain/markdown.ts";
import { useT } from "../i18n/index.ts";
import { AttachmentsEndBlock } from "./attachments/AttachmentsEndBlock.tsx";
import { AttachmentsProvider } from "./attachments/AttachmentsProvider.tsx";
import {
  attachableFilesFrom,
  fileToAttachment,
} from "./attachments/fromFile.ts";
import { lineTextClass } from "./markdown-line-class.ts";
import { RenderedLine } from "./MarkdownLine.tsx";

// Zero-width space — invisible, but a real character the keyboard can delete.
const SENTINEL = "​";

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
  /** Place the caret in the body on mount (false when the title takes focus). */
  focusOnMount?: boolean;
  /** The note's attachments, for resolving `[…](attachments/…)` references. */
  attachments?: Attachment[];
  /** Whether the active backend can store attachments (the file backends). */
  canAttach?: boolean;
  /** Persist a pasted / dropped file onto the note. */
  onAttach?: (attachment: Attachment) => void;
  /** Render images / files inline (default) or collected at the note's foot. */
  placement?: AttachmentPlacement;
};

export function MarkdownEditor({
  body,
  onChange,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
  focusOnMount = true,
  attachments,
  canAttach = false,
  onAttach,
  placement = INLINE_PLACEMENT,
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

  // The line currently being edited as raw text. Starts on the last line so
  // opening an existing note continues where it left off.
  const [active, setActive] = useState(() =>
    Math.max(0, value.split("\n").length - 1),
  );

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open — without disturbing the user's own typing. Our own
  // keystrokes echo back through `onChange` to the identical string, so a
  // `body` that differs from the local value can only be another writer's edit
  // (the upstream live-pull quiet window guarantees it never arrives
  // mid-keystroke). Clamp the active line so the caret stays in range against
  // the freshly pulled, possibly shorter document.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (body === valueRef.current) return;
    setValue(body);
    setActive((a) => Math.min(a, body.split("\n").length - 1));
  }, [body]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Caret column to install the next time the textarea (re)focuses — set
  // whenever we move the active line programmatically. Null on mount when the
  // body shouldn't grab focus (a new note focuses its title field instead);
  // clicks / arrow keys still set it, so the body stays fully editable.
  const pendingCaret = useRef<number | null>(
    focusOnMount ? value.length : null,
  );

  const clampedActive = Math.min(active, lines.length - 1);

  // An empty active line below the first one carries an invisible zero-width
  // sentinel inside its textarea. A soft keyboard only fires the `beforeinput`
  // delete event when there is something *before* the caret to delete; an
  // empty textarea therefore swallows Backspace, so holding it would erase a
  // line down to its start and then stop instead of merging into the line
  // above. The sentinel gives that Backspace something to bite on, which we
  // intercept and turn into a merge. It never reaches the source string — the
  // textarea shows it but `value`/`onChange` only ever see the real line.
  const activeLine = lines[clampedActive] ?? "";
  const useSentinel = clampedActive > 0 && activeLine === "";
  const caretOffset = useSentinel ? SENTINEL.length : 0;

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

  // Insert one attachment reference per line at the active line, followed by an
  // empty line to keep typing on. Replaces the active line when it's blank so a
  // paste into an empty note doesn't leave a stray gap above the attachment.
  function insertAttachments(atts: readonly Attachment[]) {
    if (atts.length === 0) return;
    const i = clampedActive;
    const cur = lines[i] ?? "";
    const inserted = [...atts.map(attachmentMarkdown), ""];
    const next = [...lines];
    const base = cur.trim() === "" ? i : i + 1;
    next.splice(base, cur.trim() === "" ? 1 : 0, ...inserted);
    commit(next, base + inserted.length - 1, 0);
  }

  // Read each file into an attachment, persist it onto the note, and drop its
  // reference into the body. A no-op when the backend can't store files or
  // nothing in the payload was attachable.
  async function attachFiles(files: File[]) {
    if (!canAttach || files.length === 0) return;
    const built = await Promise.all(files.map(fileToAttachment));
    const atts = built.filter((a): a is Attachment => a !== null);
    if (atts.length === 0) return;
    for (const a of atts) onAttach?.(a);
    insertAttachments(atts);
  }

  function onPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!canAttach) return;
    const files = attachableFilesFrom(e.clipboardData);
    if (files.length === 0) return; // let normal text paste through
    e.preventDefault();
    void attachFiles(files);
  }

  function onDrop(e: ReactDragEvent<HTMLDivElement>) {
    if (!canAttach) return;
    const files = attachableFilesFrom(e.dataTransfer);
    if (files.length === 0) return; // nothing to attach — leave it to import
    // Claim the drop so the global markdown-import handler ignores it and the
    // browser doesn't navigate to the dropped file.
    e.preventDefault();
    e.stopPropagation();
    void attachFiles(files);
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
      const col =
        caretOffset + Math.min(pendingCaret.current, activeLine.length);
      ta.focus();
      ta.setSelectionRange(col, col);
      pendingCaret.current = null;
    } else if (
      useSentinel &&
      document.activeElement === ta &&
      ta.selectionStart < caretOffset
    ) {
      // Keep the caret *after* the sentinel so a Backspace deletes the sentinel
      // (which we turn into a merge) rather than landing before it and no-op-ing
      // — the case that previously left the caret stuck at the line start.
      ta.setSelectionRange(caretOffset, caretOffset);
    }
  }, [
    clampedActive,
    value,
    wordWrap,
    useSentinel,
    caretOffset,
    activeLine.length,
  ]);

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
    // Work in source-line columns: subtract the sentinel so column 0 of an
    // empty line is detected whether or not the textarea carries the sentinel.
    const start = ta.selectionStart - caretOffset;
    const end = ta.selectionEnd - caretOffset;
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

  function onTextChange(ta: HTMLTextAreaElement) {
    const raw = ta.value;
    // The sentinel was deleted, leaving the field empty: that Backspace is the
    // one a soft keyboard would otherwise have swallowed. Merge into the line
    // above (this only fires below the first line, where the sentinel lives).
    if (useSentinel && raw === "") {
      mergeWithPrev();
      return;
    }
    // Strip the sentinel back out so the source string never sees it, and
    // shift the queued caret to match the removed character.
    const hadSentinel = raw.startsWith(SENTINEL);
    const text = hadSentinel ? raw.slice(SENTINEL.length) : raw;
    if (hadSentinel) {
      pendingCaret.current = Math.max(0, ta.selectionStart - SENTINEL.length);
    }
    const next = [...lines];
    next[clampedActive] = text;
    const joined = next.join("\n");
    setValue(joined);
    onChange(joined);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    // Source-line columns (see the `beforeinput` handler): the sentinel sits in
    // front of the caret on an empty line, so discount it before comparing.
    const start = ta.selectionStart - caretOffset;
    const end = ta.selectionEnd - caretOffset;
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

  // A click anywhere in the empty note space (the scroll container or the
  // padding around the lines) drops the caret on a blank line at the very
  // bottom of the note and opens the editor. When the document doesn't already
  // end in an empty line, append one and put the caret there — otherwise the
  // click would roll the editing textarea onto the last *content* line, turning
  // a rendered image (or any formatted line) back into raw source just to give
  // the caret somewhere to land. Creating the trailing newline keeps the caret
  // below the content, where the user expects to keep typing.
  function activateEnd(e: ReactMouseEvent) {
    e.preventDefault();
    const last = lines.length - 1;
    if (lines[last] !== "") {
      // Append the blank line locally so the caret has somewhere to land, but
      // *don't* push it through `onChange` — placing the caret is not an edit,
      // and persisting this newline would bump `updatedAt` and jump the note to
      // the top of the list just for entering edit mode. The empty line becomes
      // part of the document only once the user actually types onto it.
      const next = [...lines, ""];
      setValue(next.join("\n"));
      setActive(next.length - 1);
      pendingCaret.current = 0;
      return;
    }
    // The document already ends in a blank line; just land the caret on it.
    // When that blank line is already the active line — the single empty-line
    // case — `setActive` would be a no-op, so the layout effect that installs
    // the caret never runs; focus the textarea directly here so editing always
    // starts, regardless of how tall the document is.
    if (last === clampedActive) {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
      }
      return;
    }
    moveTo(last, 0);
  }

  const widthStyle =
    maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" };
  const wrapClass = wordWrap
    ? "whitespace-pre-wrap break-words"
    : "whitespace-pre";

  return (
    <AttachmentsProvider attachments={attachments} placement={placement}>
      {/* This is one editing widget, not a set of independent controls: the
        textarea is the focusable, keyboard-driven surface, and the line
        <div>s are non-interactive visual proxies for source the textarea
        edits. Clicking one only repositions the caret (keyboard users move it
        with the arrow keys), so the static-interaction a11y rule doesn't apply. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={`min-h-0 flex-1 ${wordWrap ? "overflow-y-auto" : "overflow-auto"}`}
        onMouseDown={(e) => {
          // A click in the empty area below the text drops the caret at the end
          // of the note rather than doing nothing.
          if (e.target === e.currentTarget) activateEnd(e);
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          // A drag carrying files must have its default prevented for a drop to
          // fire at all; the drop handler then decides whether it's an image to
          // attach or something to leave to the global markdown import.
          if (canAttach && carriesFiles(e)) e.preventDefault();
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className={`px-4 py-4 ${wordWrap ? "" : "w-max min-w-full"}`}
          style={widthStyle}
          onMouseDown={(e) => {
            // Clicks landing on the content wrapper itself — its padding or the
            // gaps around the lines — count as the empty note space too.
            if (e.target === e.currentTarget) activateEnd(e);
          }}
        >
          {lines.map((line, index) => {
            if (index === clampedActive) {
              return (
                <textarea
                  key="active"
                  ref={taRef}
                  rows={1}
                  wrap={wordWrap ? "soft" : "off"}
                  value={useSentinel ? SENTINEL : line}
                  spellCheck={!disableSpellcheck}
                  autoCorrect={disableAutocorrect ? "off" : "on"}
                  autoCapitalize={disableAutocorrect ? "off" : "sentences"}
                  placeholder={
                    lines.length === 1 ? t("app.startWriting") : undefined
                  }
                  onChange={(e) => onTextChange(e.currentTarget)}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-fg outline-none placeholder:text-muted/60 ${wrapClass} ${lineTextClass(
                    blocks[clampedActive]!,
                  )}`}
                />
              );
            }
            // A line that is just an attachment reference rendered in the
            // collected end-of-note block instead is hidden in place. It's
            // still walked (as nothing) so the line indices the editor keys its
            // caret off stay aligned with the source; navigating onto it makes
            // it the active line, which reveals its raw source.
            if (hidden.has(index)) return null;
            return (
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
            );
          })}
          <AttachmentsEndBlock />
        </div>
      </div>
    </AttachmentsProvider>
  );
}

// Whether a drag is carrying files (rather than, say, dragged text) — the same
// `"Files"` type check the global import uses, so the editor only claims file
// drags and leaves selection drags to the textarea.
function carriesFiles(e: ReactDragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
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
