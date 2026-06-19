// A small, dependency-free Markdown parser. Pure functions over strings —
// no DOM, no I/O — so it stays in `domain/` and is cheap to unit-test. It
// powers the live-preview editor (`src/ui/MarkdownEditor.tsx`), which renders
// every line but the one the caret sits on, so the parser works one line at a
// time: `classifyLines` assigns each source line a block kind (heading, list,
// quote, …), and `parseInline` tokenises a line's text into inline nodes
// (bold, italic, code, links, …).
//
// This is intentionally a pragmatic subset of CommonMark, not a conformant
// implementation — it covers the constructs a note-taker reaches for and
// favours predictable behaviour over completeness. Every emitted leaf node
// carries the source-column `offset` of its first character so the editor can
// map a click on rendered text back to a caret position in the raw source.

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

export type BlockKind =
  | "blank"
  | "heading"
  | "ul"
  | "ol"
  | "quote"
  | "hr"
  | "fence"
  | "code"
  | "paragraph";

export type LineBlock = {
  kind: BlockKind;
  /** The full source line, verbatim. */
  raw: string;
  /** Heading level 1–6 (only on `heading`). */
  level?: number;
  /** Ordered-list marker, e.g. `"1."` (only on `ol`). */
  ordinal?: string;
  /** The text after any block marker — the part inline parsing runs over. */
  content: string;
  /** Column in `raw` where `content` begins (so leaf offsets stay absolute). */
  contentStart: number;
};

const HR_RE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const UL_RE = /^(\s*)([-*+])(\s+)(.*)$/;
const OL_RE = /^(\s*)(\d+[.)])(\s+)(.*)$/;
const QUOTE_RE = /^(\s*>\s?)(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Split `body` into one `LineBlock` per line, tracking fenced-code state so
 * lines inside a ``` fence are classed as `code` rather than reparsed as
 * Markdown. A trailing empty document still yields a single blank block.
 */
export function classifyLines(body: string): LineBlock[] {
  const lines = body.split("\n");
  const blocks: LineBlock[] = [];
  let inFence = false;
  for (const raw of lines) {
    if (FENCE_RE.test(raw)) {
      // The fence delimiter line itself — toggles in/out of the code block.
      inFence = !inFence;
      blocks.push({ kind: "fence", raw, content: raw, contentStart: 0 });
      continue;
    }
    if (inFence) {
      blocks.push({ kind: "code", raw, content: raw, contentStart: 0 });
      continue;
    }
    blocks.push(classifyLine(raw));
  }
  return blocks;
}

function classifyLine(raw: string): LineBlock {
  if (raw.trim() === "") {
    return { kind: "blank", raw, content: "", contentStart: 0 };
  }
  if (HR_RE.test(raw)) {
    return { kind: "hr", raw, content: "", contentStart: 0 };
  }
  const heading = HEADING_RE.exec(raw);
  if (heading) {
    const hashes = heading[1]!;
    const gap = heading[2]!;
    const content = heading[3]!;
    return {
      kind: "heading",
      raw,
      level: hashes.length,
      content,
      contentStart: hashes.length + gap.length,
    };
  }
  const quote = QUOTE_RE.exec(raw);
  if (quote) {
    const marker = quote[1]!;
    return {
      kind: "quote",
      raw,
      content: quote[2]!,
      contentStart: marker.length,
    };
  }
  const ul = UL_RE.exec(raw);
  if (ul) {
    const indent = ul[1]!;
    const bullet = ul[2]!;
    const gap = ul[3]!;
    return {
      kind: "ul",
      raw,
      content: ul[4]!,
      contentStart: indent.length + bullet.length + gap.length,
    };
  }
  const ol = OL_RE.exec(raw);
  if (ol) {
    const indent = ol[1]!;
    const ordinal = ol[2]!;
    const gap = ol[3]!;
    return {
      kind: "ol",
      raw,
      ordinal,
      content: ol[4]!,
      contentStart: indent.length + ordinal.length + gap.length,
    };
  }
  return { kind: "paragraph", raw, content: raw, contentStart: 0 };
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

export type InlineNode =
  | { type: "text"; text: string; offset: number }
  | { type: "code"; text: string; offset: number }
  | { type: "link"; text: string; href: string; offset: number }
  | { type: "image"; alt: string; href: string; offset: number }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "strikethrough"; children: InlineNode[] };

/**
 * Tokenise `text` into inline nodes. `base` is the source column of `text[0]`
 * so every leaf node's `offset` is absolute within the original line — the
 * editor uses it to translate a click on rendered text into a caret column.
 */
export function parseInline(text: string, base = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let textStart = 0;

  const flush = (end: number) => {
    if (end > textStart) {
      nodes.push({
        type: "text",
        text: text.slice(textStart, end),
        offset: base + textStart,
      });
    }
  };

  while (i < text.length) {
    const c = text.charAt(i);

    if (c === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flush(i);
        nodes.push({
          type: "code",
          text: text.slice(i + 1, close),
          offset: base + i + 1,
        });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    if (c === "!" && text.charAt(i + 1) === "[") {
      // `![alt](href)` — an image. Reuses the link matcher one char along, so
      // the `!` and the bracket pair are consumed together.
      const link = matchLink(text, i + 1);
      if (link) {
        flush(i);
        nodes.push({
          type: "image",
          alt: link.text,
          href: link.href,
          offset: base + i,
        });
        i = link.end;
        textStart = i;
        continue;
      }
    }

    if (c === "[") {
      const link = matchLink(text, i);
      if (link) {
        flush(i);
        nodes.push({
          type: "link",
          text: link.text,
          href: link.href,
          offset: base + i + 1,
        });
        i = link.end;
        textStart = i;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      const emphasis = matchEmphasis(text, i, base);
      if (emphasis) {
        flush(i);
        nodes.push(emphasis.node);
        i = emphasis.end;
        textStart = i;
        continue;
      }
    }

    i++;
  }

  flush(text.length);
  return nodes;
}

function matchLink(
  text: string,
  open: number,
): { text: string; href: string; end: number } | null {
  const closeBracket = text.indexOf("]", open + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== "(") return null;
  const closeParen = text.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  return {
    text: text.slice(open + 1, closeBracket),
    href: text.slice(closeBracket + 2, closeParen),
    end: closeParen + 1,
  };
}

function matchEmphasis(
  text: string,
  start: number,
  base: number,
): { node: InlineNode; end: number } | null {
  const ch = text.charAt(start);

  // Strikethrough is the only `~` construct, and it takes exactly two.
  if (ch === "~") {
    if (text.charAt(start + 1) !== "~") return null;
    const open = start + 2;
    const close = text.indexOf("~~", open);
    if (close === -1 || close === open) return null;
    return {
      node: {
        type: "strikethrough",
        children: parseInline(text.slice(open, close), base + open),
      },
      end: close + 2,
    };
  }

  // Count the run of `*` / `_`; 1 → em, 2 → strong, 3 → strong+em.
  let run = 1;
  while (text.charAt(start + run) === ch) run++;
  const len = Math.min(run, 3);
  const delim = ch.repeat(len);
  const open = start + len;

  // `_` only opens emphasis at a word boundary, so it doesn't fire inside
  // snake_case identifiers. `*` has no such restriction.
  if (ch === "_" && /\w/.test(text.charAt(start - 1))) return null;
  // The opening run must be followed by content, not whitespace.
  if (open >= text.length || /\s/.test(text.charAt(open))) return null;

  const close = findClosingDelim(text, open, delim);
  if (close === -1) return null;
  const inner = text.slice(open, close);
  if (inner.length === 0) return null;

  const children = parseInline(inner, base + open);
  let node: InlineNode;
  if (len === 1) node = { type: "em", children };
  else if (len === 2) node = { type: "strong", children };
  else node = { type: "strong", children: [{ type: "em", children }] };
  return { node, end: close + len };
}

// Find the index of `delim` closing an emphasis run opened at `from`. The
// closer can't sit right after whitespace (`a ** b` doesn't close), matching
// the no-leading-space rule on the open side.
function findClosingDelim(text: string, from: number, delim: string): number {
  let i = from;
  while (i < text.length) {
    const at = text.indexOf(delim, i);
    if (at === -1) return -1;
    if (at > from && !/\s/.test(text.charAt(at - 1))) return at;
    i = at + 1;
  }
  return -1;
}
