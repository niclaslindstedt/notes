// Pure Markdown *formatting* transforms — the engine behind the styling
// toolbar. Where `line-edit.ts` splices arbitrary text into a note's source,
// this module knows what the Markdown constructs the app renders
// (`markdown.ts`) look like, and turns "make this a heading" / "bold this" /
// "indent this bullet" into a new line array plus the selection that should
// survive the change.
//
// Everything here is a string transform over a line array and a
// `{ start, end }` pair of `SourcePoint`s, with no DOM and no React, so both
// editing surfaces share one implementation: the live-preview
// `MarkdownEditor` (which speaks `SourcePoint` natively) and the plain
// textarea fallback (which converts through `editor-position.ts`).
//
// Every action toggles. Pressing **Bold** on already-bold text unbolds it,
// pressing **H2** on an H2 line makes it a paragraph again, pressing
// **Bullet list** on a list un-lists it — so one button covers both
// directions and the toolbar can light up to show what's already applied.

import {
  classifyLines,
  parseInline,
  type BlockKind,
  type InlineNode,
  type LineBlock,
} from "./markdown.ts";
import { orderPoints, type SourcePoint } from "./line-edit.ts";

/** A selection (or, when the two points are equal, a bare caret). */
export type FormatSelection = { start: SourcePoint; end: SourcePoint };

/** A new line array plus where the selection should land afterwards. */
export type FormatResult = FormatSelection & { lines: string[] };

/** The inline delimiters the toolbar can wrap a span in. */
export type InlineDelimiter = "**" | "*" | "~~" | "`";

/**
 * One toolbar press. Each maps to a Markdown construct the parser understands;
 * there is deliberately no action for anything `markdown.ts` can't render.
 */
export type FormatAction =
  /** `#`…`######` — toggles off when the line is already at that level. */
  | { kind: "heading"; level: number }
  /** `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``. */
  | { kind: "inline"; delimiter: InlineDelimiter }
  /** `- item` / `1. item` — toggles the selected lines in and out of a list. */
  | { kind: "list"; ordered: boolean }
  /**
   * `- [ ] item` — toggles the selected lines in and out of a **checklist**.
   * Its own action rather than a flag on `list`, because the box is a third
   * kind of list marker rather than a variation on the bullet: pressing
   * Bullet on a checklist row takes the box off and leaves the bullet.
   */
  | { kind: "task" }
  /** `> quoted`. */
  | { kind: "quote" }
  /** Two spaces of indentation on or off — how a bullet becomes a child. */
  | { kind: "indent"; outdent?: boolean }
  /** A ``` fence around the selected lines (or around a fresh empty line). */
  | { kind: "fence" }
  /** A `---` horizontal rule on its own line. */
  | { kind: "rule" }
  /** `[text](url)` — or `![alt](url)` when `image` is set. */
  | { kind: "link"; image?: boolean };

/** How much one indent step moves a line. Two spaces is the list convention. */
const INDENT = "  ";

/** The href placeholder a freshly-inserted link lands its selection on. */
const URL_PLACEHOLDER = "url";

const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

/**
 * Where the caret (or a selection) sits within one line, as source columns.
 * Null when the selection spans several lines — inline emphasis can't cross a
 * line boundary, so there is no single run to be inside of.
 */
export type ColumnSpan = { from: number; to: number };

/**
 * The formatting state at the caret, as the toolbar reads it to decide which
 * buttons are lit. Derived from the same parser the preview renders from, so
 * "the button is on" and "the line looks like that" can't disagree.
 */
export type LineFormat = {
  kind: BlockKind;
  /** Heading level 1–6, when `kind` is `heading`. */
  level?: number;
  /**
   * A task item's ticked state, when `kind` is `ul` and the row carries a
   * `[ ]` box; absent on a plain bullet. This is what splits one `ul` line
   * between the Bullet list and Checklist buttons, so exactly one of the two
   * lights up.
   */
  task?: boolean;
  /** Leading-indent width in characters — non-zero means a nested item. */
  indent: number;
  /**
   * The inline emphasis the caret sits *inside* — bold, italic, strikethrough,
   * inline code — so those buttons light up too and a press takes the mark back
   * off. Empty when the caret's position isn't known (nothing focused) or the
   * selection spans lines.
   */
  inline: InlineDelimiter[];
};

/**
 * An inline construct enclosing a span of one line: which toolbar button owns
 * it, and the columns of the whole run in the source, delimiters included.
 */
export type InlineMark = ColumnSpan & { delimiter: InlineDelimiter };

/** Which toolbar button each marked-up inline node belongs to. */
const NODE_DELIMITER = {
  strong: "**",
  em: "*",
  strikethrough: "~~",
  code: "`",
} as const satisfies Partial<Record<InlineNode["type"], InlineDelimiter>>;

/**
 * Every inline construct enclosing `span` on `block`'s line, outermost first.
 * The line is tokenised by the same parser the preview renders from, so a run
 * the toolbar calls "bold" is exactly the run that renders bold — a caret in
 * `a **b *c* d** e` reports both the bold and the italic it sits in.
 *
 * A line inside a fenced code block reports nothing: it renders verbatim, so
 * there is no emphasis there to be inside of.
 */
export function inlineMarksAt(
  block: LineBlock,
  span: ColumnSpan,
): InlineMark[] {
  if (block.kind === "code" || block.kind === "fence") return [];
  const marks: InlineMark[] = [];
  const walk = (nodes: readonly InlineNode[]) => {
    for (const node of nodes) {
      if (
        node.type === "strong" ||
        node.type === "em" ||
        node.type === "strikethrough" ||
        node.type === "code"
      ) {
        if (node.span.from <= span.from && span.to <= node.span.to) {
          marks.push({ delimiter: NODE_DELIMITER[node.type], ...node.span });
        }
      }
      if ("children" in node) walk(node.children);
    }
  };
  walk(parseInline(block.content, block.contentStart));
  return marks;
}

/**
 * The toolbar's view of an already-classified line. `span` is where the caret
 * (or the selection) sits on it, which decides the inline marks; omit it when
 * that isn't known and only the block state is reported.
 */
export function lineFormatOf(
  block: LineBlock,
  span: ColumnSpan | null = null,
): LineFormat {
  return {
    kind: block.kind,
    level: block.level,
    task: block.task,
    indent: leadingWhitespace(block.raw).length,
    inline: span
      ? inlineMarksAt(block, span).map((mark) => mark.delimiter)
      : [],
  };
}

/**
 * Read the format state of `lines[index]`, classifying the document first. The
 * live-preview editor already holds a classification and calls
 * {@link lineFormatOf} directly; this is for callers (the plain-textarea
 * fallback) that don't.
 */
export function lineFormatAt(
  lines: readonly string[],
  index: number,
  span: ColumnSpan | null = null,
): LineFormat | null {
  const block = classifyLines(lines.join("\n"))[index];
  return block ? lineFormatOf(block, span) : null;
}

/**
 * What an Enter (or Shift+Enter) does to the source. Nearly every press splices
 * text in at the caret; the one that doesn't is Enter on an *empty* list item,
 * which rewrites that row instead — which is how a list is left.
 */
export type NewlineEdit =
  /** Splice `text` in over the selection — the ordinary split. */
  | { kind: "insert"; text: string }
  /** Replace the caret's whole line with `line`, caret at its end. */
  | { kind: "replaceLine"; line: string };

/** A list row as Enter reads it: its marker (indent included) and its text. */
type ListItem = { prefix: string; content: string; ordered: boolean };

// A row that is nothing but a bullet character *and the gap after it* — what
// Enter on a bullet writes, before anything is typed into it. The trailing
// space is the whole tell: it is the one thing a hand-typed `-` (the divider
// shorthand) never has, so requiring it keeps the two apart.
const LONE_BULLET_RE = /^[ \t]*[-*+][ \t]+$/;

/**
 * The list item `blocks[index]` is, or null when that line isn't one. Almost
 * always just the classified block — the exception is a row emptied down to a
 * `- `, which classifies as a **divider** (`hr`, the shorthand a note-taker
 * reaches for without counting out three dashes) and only really is one when
 * no list is open above it. Under a list it is instead the empty bullet the
 * previous Enter opened, so Enter there ends the list rather than leaving a
 * stray rule behind.
 *
 * The trailing space decides it, before the line above is even consulted: Enter
 * on a bullet writes the marker *with* its gap (`- `), while someone typing a
 * divider types a bare `-`. So a hand-typed `-` stays a divider wherever it
 * lands — including straight under a list, which is exactly where a note-taker
 * wants a rule and where reading it as an empty bullet would silently eat the
 * character they just typed.
 */
function listItemAt(
  blocks: readonly LineBlock[],
  index: number,
): ListItem | null {
  const block = blocks[index];
  if (!block) return null;
  if (block.kind === "ul" || block.kind === "ol") {
    const prefix = block.raw.slice(0, block.contentStart);
    return {
      // A task item's marker carries its `[ ]` box onto the next row — but
      // always an *empty* one. Carrying the tick over would hand every fresh
      // item a state nobody put there.
      prefix: block.task === true ? prefix.replace(/\[[xX]\]/, "[ ]") : prefix,
      content: block.content,
      ordered: block.kind === "ol",
    };
  }
  if (block.kind !== "hr" || !LONE_BULLET_RE.test(block.raw)) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const kind = blocks[i]?.kind;
    if (kind === "blank") continue;
    if (kind !== "ul" && kind !== "ol") return null;
    return { prefix: block.raw, content: "", ordered: false };
  }
  return null;
}

/**
 * What an Enter at column `col` of `blocks[index]` should do — `soft` for
 * Shift+Enter. A bare newline on an ordinary line; on the block kinds that
 * carry a leading marker, the marker travels so the construct can be written
 * straight through rather than re-marked row by row:
 *
 * - **A quote** carries its own `> ` (indent and exact spelling included).
 *   Quote mode is deliberately **sticky**: an empty quote row continues into
 *   another one rather than dropping out, so leaving a quote is an explicit
 *   act — press Quote to unmark the row, or put the caret on a row that isn't
 *   quoted.
 * - **A bullet** carries its own `- ` / `* ` / `+ `, at its own indent.
 * - **A task item** carries its `- [ ] ` box too, always unticked, so a
 *   checklist is written straight through and each new row starts open.
 * - **A numbered item** carries its number bumped by one (`2. ` → `3. `), so
 *   the source reads the way it renders; the preview renumbers regardless.
 *
 * Lists, unlike quotes, are **not** sticky — an endless column of empty bullets
 * is nobody's intent. Enter on an empty item pulls a nested one back out a
 * level, and clears a top-level one to a blank line, so repeated Enter walks
 * out of the list the same way it walked in.
 *
 * **Shift+Enter** opens another row *inside* the item rather than a new item:
 * a plain line padded out to the item's text column, so it hangs under the
 * words above it (and `classifyLines` reads it as a continuation, keeping the
 * list's numbering and nesting going). In a quote it still carries the `> ` —
 * a quote row without the marker isn't in the quote at all. On an **empty**
 * item it does nothing of the sort: there is no content for a continuation row
 * to hang under, so leaving the list wins over the modifier.
 *
 * A caret still inside the marker isn't *in* the construct — Enter there pushes
 * the whole row down, exactly as on any other line.
 */
export function newlineFor(
  blocks: readonly LineBlock[],
  index: number,
  col: number,
  soft = false,
): NewlineEdit {
  const plain = { kind: "insert", text: "\n" } as const;
  const block = blocks[index];
  if (!block || col < block.contentStart) return plain;
  if (block.kind === "quote") {
    return {
      kind: "insert",
      text: `\n${block.raw.slice(0, block.contentStart)}`,
    };
  }
  const item = listItemAt(blocks, index);
  if (!item) return plain;
  // An **empty item ends the list, Shift or not.** Shift+Enter's job is to open
  // another row *inside* the item you are on — but an empty item has no content
  // for that row to hang under, so the gesture has nothing to mean there, while
  // "let me out of this list" is exactly what a second Enter on a blank row is
  // asking for. Deciding this ahead of `soft` also makes the way out immune to
  // a Shift the user never pressed: iOS auto-capitalises at the start of a line,
  // which leaves the on-screen keyboard's shift engaged, and its Return reports
  // `shiftKey` — so on a phone the empty row is *always* the case where the
  // modifier is least trustworthy and the way out matters most.
  if (item.content === "") {
    const outdented = outdentLine(item.prefix);
    return {
      kind: "replaceLine",
      line: outdented === item.prefix ? "" : outdented,
    };
  }
  // The marker blanked out to spaces, leaving the line's own indent verbatim —
  // so a tab-indented item's continuation row is tab-indented too.
  if (soft) {
    return { kind: "insert", text: `\n${item.prefix.replace(/\S/g, " ")}` };
  }
  const marker = item.ordered
    ? item.prefix.replace(/\d+/, (n) => String(Number.parseInt(n, 10) + 1))
    : item.prefix;
  return { kind: "insert", text: `\n${marker}` };
}

/**
 * Apply `action` to `lines` over the span `sel` covers, returning the new
 * source and the selection to restore. The endpoints may arrive in any order
 * (a backwards drag) and are ordered here; a collapsed selection is a bare
 * caret and every action has a sensible answer for it (wrap the word under
 * the caret, re-mark the caret's line, open an empty construct to type into).
 */
export function applyFormat(
  lines: readonly string[],
  sel: FormatSelection,
  action: FormatAction,
): FormatResult {
  const [start, end] = orderPoints(
    clampPoint(lines, sel.start),
    clampPoint(lines, sel.end),
  );
  switch (action.kind) {
    case "heading":
      return applyBlockMarker(lines, start, end, {
        kind: "heading",
        level: action.level,
      });
    case "quote":
      return applyBlockMarker(lines, start, end, { kind: "quote" });
    case "list":
      return applyBlockMarker(lines, start, end, {
        kind: action.ordered ? "ol" : "ul",
      });
    case "task":
      return applyBlockMarker(lines, start, end, { kind: "task" });
    case "indent":
      return applyIndent(lines, start, end, action.outdent === true);
    case "inline":
      return applyInline(lines, start, end, action.delimiter);
    case "fence":
      return applyFence(lines, start, end);
    case "rule":
      return applyRule(lines, end);
    case "link":
      return applyLink(lines, start, end, action.image === true);
  }
}

// ---------------------------------------------------------------------------
// Block markers: headings, quotes, lists
// ---------------------------------------------------------------------------

type BlockTarget =
  | { kind: "heading"; level: number }
  | { kind: "quote" }
  | { kind: "ul" }
  | { kind: "ol" }
  | { kind: "task" };

/**
 * Re-mark every line the selection touches. The decision is made once, from
 * whether *all* of them already carry the target marker, so a mixed selection
 * moves as one block (everything becomes a bullet) rather than each line
 * flipping its own way.
 */
function applyBlockMarker(
  lines: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
  target: BlockTarget,
): FormatResult {
  const blocks = classifyLines(lines.join("\n"));
  const span = rangeOf(start, end);
  const removing = span.every((i) => matchesTarget(blocks[i], target));
  const next = [...lines];
  // Ordered items are numbered as they are written so the source reads the way
  // it renders; the preview renumbers anyway, but a hand-edited file shouldn't
  // be a column of `1.`.
  let ordinal = 1;
  for (const i of span) {
    const { indent, content } = splitMarker(lines[i] ?? "", blocks[i]?.kind);
    if (removing) {
      next[i] = indent + content;
      continue;
    }
    next[i] = indent + markerFor(target, ordinal) + content;
    ordinal += 1;
  }
  return reselect(lines, next, start, end);
}

function matchesTarget(
  block: { kind: BlockKind; level?: number; task?: boolean } | undefined,
  target: BlockTarget,
): boolean {
  if (!block) return false;
  if (target.kind === "heading")
    return block.kind === "heading" && block.level === target.level;
  // A checklist row and a plain bullet are both `ul`, so the box is what tells
  // them apart. Keeping them distinct is what makes Bullet on a checklist row
  // *convert* it (box off, bullet kept) instead of un-listing it outright —
  // and what lets exactly one of the two buttons light up.
  if (target.kind === "task")
    return block.kind === "ul" && block.task !== undefined;
  if (target.kind === "ul")
    return block.kind === "ul" && block.task === undefined;
  return block.kind === target.kind;
}

function markerFor(target: BlockTarget, ordinal: number): string {
  switch (target.kind) {
    case "heading":
      return `${"#".repeat(clamp(target.level, 1, 6))} `;
    case "quote":
      return "> ";
    case "ul":
      return "- ";
    case "ol":
      return `${ordinal}. `;
    case "task":
      // A fresh checklist row always opens unticked, the same reason Enter's
      // continuation does (see `newlineFor`).
      return "- [ ] ";
  }
}

/**
 * Split a line into its leading indent and the text after any block marker, so
 * a new marker can replace the old one instead of stacking on top of it (a
 * bullet asked to become a heading is `# item`, never `# - item`). Only the
 * markers this module writes are stripped; a rule, a fence, or code inside a
 * fence keeps its text verbatim.
 */
function splitMarker(
  line: string,
  kind: BlockKind | undefined,
): { indent: string; content: string } {
  const indent = leadingWhitespace(line);
  if (kind === "blank") return { indent: "", content: "" };
  if (
    kind === "heading" ||
    kind === "quote" ||
    kind === "ul" ||
    kind === "ol"
  ) {
    const block = classifyLines(line)[0]!;
    return { indent, content: line.slice(block.contentStart) };
  }
  return { indent, content: line.slice(indent.length) };
}

// ---------------------------------------------------------------------------
// Indentation — how a bullet becomes a child bullet
// ---------------------------------------------------------------------------

function applyIndent(
  lines: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
  outdent: boolean,
): FormatResult {
  const next = [...lines];
  for (const i of rangeOf(start, end)) {
    const line = lines[i] ?? "";
    if (!outdent) {
      // A blank line has nothing to nest under; indenting it would only leave
      // trailing whitespace the save formatter strips again.
      next[i] = line.trim() === "" ? line : INDENT + line;
      continue;
    }
    next[i] = outdentLine(line);
  }
  return reselect(lines, next, start, end);
}

// Remove one indent step: a tab, or up to `INDENT.length` spaces.
function outdentLine(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  let removed = 0;
  while (removed < INDENT.length && line.charAt(removed) === " ") removed += 1;
  return line.slice(removed);
}

// ---------------------------------------------------------------------------
// Inline emphasis
// ---------------------------------------------------------------------------

/**
 * Wrap (or unwrap) the selected span in `delim`. A collapsed caret takes the
 * word it sits in, so bolding mid-word needs no selection; with no word under
 * it — an empty line, a run of spaces — an empty pair is opened and the caret
 * lands between the delimiters, ready to type into.
 *
 * Unwrapping comes first, and asks the parser rather than the characters
 * either side of the selection: whatever run the toolbar lit for this position
 * is exactly the run a press takes off, however much of it was selected. So a
 * caret anywhere inside `**bold text**` unbolds the whole phrase, and a
 * `***x***` gives up one mark at a time.
 *
 * A selection spanning several lines wraps each line's share separately, since
 * Markdown emphasis doesn't cross a line boundary.
 */
function applyInline(
  lines: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
  delim: InlineDelimiter,
): FormatResult {
  const span = rangeOf(start, end);
  const collapsed = start.line === end.line && start.col === end.col;

  if (start.line === end.line) {
    const line = lines[start.line] ?? "";
    const sel = collapsed
      ? { from: start.col, to: end.col }
      : trimSpan(line, start.col, end.col);
    const block = classifyLines(lines.join("\n"))[start.line];
    // The innermost run of this delimiter the selection sits in, so a nested
    // one comes off before the run around it. `inlineMarksAt` reports
    // outermost first, so the innermost is the last match.
    const enclosing = block
      ? inlineMarksAt(block, sel).filter((m) => m.delimiter === delim)
      : [];
    const mark = enclosing[enclosing.length - 1];
    if (mark) return stripMark(lines, start.line, mark, delim);
  }

  if (collapsed) {
    const line = lines[start.line] ?? "";
    const word = wordAround(line, start.col);
    const next = [...lines];
    if (!word) {
      next[start.line] =
        line.slice(0, start.col) + delim + delim + line.slice(start.col);
      const col = start.col + delim.length;
      return {
        lines: next,
        start: { line: start.line, col },
        end: { line: start.line, col },
      };
    }
    const edit = toggleWrap(line, word.from, word.to, delim);
    next[start.line] = edit.line;
    return {
      lines: next,
      start: { line: start.line, col: edit.from },
      end: { line: start.line, col: edit.to },
    };
  }

  // Which lines actually carry text inside the selection — a blank line, or a
  // line whose selected share is only whitespace, is left untouched so a
  // multi-paragraph selection doesn't sprout stray `**` on its empty lines.
  const targets = span
    .map((i) => {
      const line = lines[i] ?? "";
      const from = i === start.line ? start.col : 0;
      const to = i === end.line ? end.col : line.length;
      return { i, ...trimSpan(line, from, to) };
    })
    .filter((t) => t.to > t.from);

  const next = [...lines];
  if (targets.length === 0) return { lines: next, start, end };

  // One decision for the whole selection: if every share is already wrapped,
  // the press strips them all; otherwise it wraps them all.
  const mode: WrapMode = targets.every(
    (t) => wrapAround(lines[t.i] ?? "", t.from, t.to, delim) !== null,
  )
    ? "unwrap"
    : "wrap";
  // A multi-line selection keeps its ends *outside* the delimiters it just
  // gained (or lost), so the whole formatted run stays selected and a second
  // press strips exactly what the first press added.
  const delta = mode === "wrap" ? delim.length : 0;
  let first: SourcePoint | null = null;
  let last: SourcePoint | null = null;
  for (const t of targets) {
    const edit = toggleWrap(lines[t.i] ?? "", t.from, t.to, delim, mode);
    next[t.i] = edit.line;
    first ??= { line: t.i, col: edit.from - delta };
    last = { line: t.i, col: edit.to + delta };
  }
  return { lines: next, start: first!, end: last! };
}

/**
 * Take one mark off the run at `mark`, leaving its text selected so a second
 * press puts it straight back. Only this delimiter's own width goes from each
 * end, so the other marks on a run survive: `***x***` unbolds to `*x*` (and,
 * pressed with `*`, unitalicises to `**x**`).
 */
function stripMark(
  lines: readonly string[],
  index: number,
  mark: InlineMark,
  delim: InlineDelimiter,
): FormatResult {
  const line = lines[index] ?? "";
  const width = delim.length;
  const body = line.slice(mark.from + width, mark.to - width);
  const next = [...lines];
  next[index] = line.slice(0, mark.from) + body + line.slice(mark.to);
  return {
    lines: next,
    start: { line: index, col: mark.from },
    end: { line: index, col: mark.from + body.length },
  };
}

/** Whether a press decides for itself, or was told which way the block goes. */
type WrapMode = "toggle" | "wrap" | "unwrap";

/**
 * Wrap `[from, to)` of `line` in `delim`, or unwrap it when it is already
 * wrapped — either just inside the span (the user selected the delimiters too)
 * or just outside it (they selected only the text). Returns the new line and
 * the columns the *content* now occupies, so the selection stays on the text
 * and a second press toggles cleanly back.
 */
function toggleWrap(
  line: string,
  from: number,
  to: number,
  delim: InlineDelimiter,
  mode: WrapMode = "toggle",
): { line: string; from: number; to: number } {
  const existing = mode === "wrap" ? null : wrapAround(line, from, to, delim);
  if (existing) {
    const body = line.slice(
      existing.from + delim.length,
      existing.to - delim.length,
    );
    return {
      line: line.slice(0, existing.from) + body + line.slice(existing.to),
      from: existing.from,
      to: existing.from + body.length,
    };
  }
  const body = line.slice(from, to);
  return {
    line: line.slice(0, from) + delim + body + delim + line.slice(to),
    from: from + delim.length,
    to: to + delim.length,
  };
}

/**
 * The delimiter pair enclosing `[from, to)`, as the outer columns of the whole
 * `**…**` run — checking both the "delimiters inside the selection" and
 * "delimiters just outside it" spellings. Null when the span isn't wrapped.
 */
function wrapAround(
  line: string,
  from: number,
  to: number,
  delim: InlineDelimiter,
): { from: number; to: number } | null {
  const len = delim.length;
  const inner = line.slice(from, to);
  if (
    inner.length >= len * 2 &&
    inner.startsWith(delim) &&
    inner.endsWith(delim)
  ) {
    return { from, to };
  }
  if (
    line.slice(Math.max(0, from - len), from) === delim &&
    line.slice(to, to + len) === delim
  ) {
    return { from: from - len, to: to + len };
  }
  return null;
}

// The word the caret sits in or against, as `[from, to)` columns, or null when
// the caret is in whitespace. "Word" is deliberately loose — anything that
// isn't a space — so `snake_case`, `a.b`, and a bare URL all bold as one unit.
function wordAround(
  line: string,
  col: number,
): { from: number; to: number } | null {
  const isWord = (c: string) => c !== "" && !/\s/.test(c);
  let from = col;
  let to = col;
  while (from > 0 && isWord(line.charAt(from - 1))) from -= 1;
  while (to < line.length && isWord(line.charAt(to))) to += 1;
  return to > from ? { from, to } : null;
}

// Shrink `[from, to)` past leading and trailing whitespace, so wrapping a
// selection that overshoots a word puts the delimiters against the text (an
// opening `** ` doesn't parse as emphasis at all).
function trimSpan(
  line: string,
  from: number,
  to: number,
): { from: number; to: number } {
  let a = clamp(from, 0, line.length);
  let b = clamp(to, 0, line.length);
  while (a < b && /\s/.test(line.charAt(a))) a += 1;
  while (b > a && /\s/.test(line.charAt(b - 1))) b -= 1;
  return { from: a, to: b };
}

// ---------------------------------------------------------------------------
// Fenced code blocks and rules
// ---------------------------------------------------------------------------

const FENCE = "```";

/**
 * Put a ``` fence around the selected lines, or take an existing one away when
 * the selection is already sitting inside one. A caret on a blank line opens an
 * empty block and lands inside it, which is the common case: press the button,
 * then paste the snippet.
 */
function applyFence(
  lines: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
): FormatResult {
  const isFence = (i: number) => (lines[i] ?? "").trimStart().startsWith(FENCE);
  if (start.line > 0 && isFence(start.line - 1) && isFence(end.line + 1)) {
    const next = [
      ...lines.slice(0, start.line - 1),
      ...lines.slice(start.line, end.line + 1),
      ...lines.slice(end.line + 2),
    ];
    return {
      lines: next,
      start: { line: start.line - 1, col: start.col },
      end: { line: end.line - 1, col: end.col },
    };
  }
  const next = [
    ...lines.slice(0, start.line),
    FENCE,
    ...lines.slice(start.line, end.line + 1),
    FENCE,
    ...lines.slice(end.line + 1),
  ];
  return {
    lines: next,
    start: { line: start.line + 1, col: start.col },
    end: { line: end.line + 1, col: end.col },
  };
}

/**
 * Drop a `---` rule below the caret's line, followed by an empty line the caret
 * lands on — so the rule separates what came before from what is typed next. A
 * caret already on a blank line writes the rule there rather than leaving a
 * stray gap above it.
 */
function applyRule(lines: readonly string[], at: SourcePoint): FormatResult {
  const blank = (lines[at.line] ?? "").trim() === "";
  const head = blank ? at.line : at.line + 1;
  const next = [
    ...lines.slice(0, head),
    "---",
    "",
    ...lines.slice(blank ? at.line + 1 : head),
  ];
  const caret = { line: head + 1, col: 0 };
  return { lines: next, start: caret, end: caret };
}

// ---------------------------------------------------------------------------
// Links and images
// ---------------------------------------------------------------------------

/**
 * Turn the selection into `[text](url)` (or `![alt](url)`). The selection
 * becomes the label and the caret lands on the `url` placeholder, selected, so
 * the next paste or keystroke replaces it — unless the selected text is itself
 * a URL, in which case it becomes the href and the empty label is where the
 * caret goes instead.
 */
function applyLink(
  lines: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
  image: boolean,
): FormatResult {
  const bang = image ? "!" : "";
  const line = lines[start.line] ?? "";
  // A selection spanning lines has no sensible label; anchor on its first line
  // and treat it as a caret there rather than swallowing the other lines.
  const sameLine = start.line === end.line;
  const from = start.col;
  const to = sameLine ? end.col : start.col;
  const selected = line.slice(from, to);
  const next = [...lines];

  if (URL_RE.test(selected)) {
    next[start.line] =
      `${line.slice(0, from)}${bang}[](${selected})${line.slice(to)}`;
    const col = from + bang.length + 1;
    return {
      lines: next,
      start: { line: start.line, col },
      end: { line: start.line, col },
    };
  }

  next[start.line] =
    `${line.slice(0, from)}${bang}[${selected}](${URL_PLACEHOLDER})${line.slice(to)}`;
  // Select the placeholder itself so typing (or pasting) the address over it is
  // the natural next motion.
  const open = from + bang.length + selected.length + 3;
  return {
    lines: next,
    start: { line: start.line, col: open },
    end: { line: start.line, col: open + URL_PLACEHOLDER.length },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Carry the selection across an edit that only rewrote each line's leading
 * markers: every endpoint moves by however much its own line's prefix grew or
 * shrank, so the caret stays on the same character of the text it was in.
 *
 * The one exception is a *ranged* selection anchored at column 0 — dragging
 * from the very start of a line means "these whole lines", so its start stays
 * pinned there and the new marker lands inside the selection rather than
 * slipping out in front of it.
 */
function reselect(
  before: readonly string[],
  after: readonly string[],
  start: SourcePoint,
  end: SourcePoint,
): FormatResult {
  const shift = (p: SourcePoint): SourcePoint => {
    const delta = (after[p.line] ?? "").length - (before[p.line] ?? "").length;
    return {
      line: p.line,
      col: clamp(p.col + delta, 0, (after[p.line] ?? "").length),
    };
  };
  const ranged = start.line !== end.line || start.col !== end.col;
  return {
    lines: [...after],
    start: ranged && start.col === 0 ? start : shift(start),
    end: shift(end),
  };
}

function rangeOf(start: SourcePoint, end: SourcePoint): number[] {
  const out: number[] = [];
  for (let i = start.line; i <= end.line; i += 1) out.push(i);
  return out;
}

function clampPoint(lines: readonly string[], p: SourcePoint): SourcePoint {
  const line = clamp(p.line, 0, Math.max(0, lines.length - 1));
  return { line, col: clamp(p.col, 0, (lines[line] ?? "").length) };
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
