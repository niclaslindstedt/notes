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
  /** The ordered-list marker as typed, e.g. `"1."` (only on `ol`). */
  ordinal?: string;
  /**
   * Nesting depth (0-based) for `ul`/`ol`, derived from indentation in a
   * cross-line pass (`numberLists`). Drives the indent and which marker glyph /
   * numbering style the renderer picks.
   */
  depth?: number;
  /**
   * The display marker for an `ol` item, computed sequentially across the list
   * so `1.`/`1.` shows as `1.`/`2.`; the style rotates by `depth`
   * (numeric → alpha → roman). Falls back to `ordinal` when unset.
   */
  marker?: string;
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
  numberLists(blocks);
  return blocks;
}

// Second pass over the classified blocks: assign every `ul`/`ol` item a nesting
// `depth` from its indentation, and every `ol` item a sequential `marker`. The
// per-line classifier can't do this — the displayed number of `1.`/`1.` (→ `1.`
// then `2.`) and the nesting level both depend on the lines around it. A stack
// of `{ indent, count }` frames tracks the open lists: a deeper indent opens a
// child list, a shallower one closes back to the matching level, and an equal
// indent is the next sibling (its counter ticks up). Blank lines are ignored so
// a gap between items keeps the list going; any other non-list line ends it.
function numberLists(blocks: LineBlock[]): void {
  const stack: { indent: number; count: number }[] = [];
  for (const block of blocks) {
    if (block.kind !== "ul" && block.kind !== "ol") {
      if (block.kind !== "blank") stack.length = 0;
      continue;
    }
    const indent = leadingIndent(block.raw);
    while (stack.length > 0 && indent < stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      // A new (possibly nested) list: an `ol` starts at its own first number,
      // so `3.` opens the list at three; a `ul` start value is irrelevant.
      stack.push({ indent, count: startNumber(block.ordinal) });
    } else {
      top.count += 1;
    }
    const depth = stack.length - 1;
    block.depth = depth;
    if (block.kind === "ol") {
      block.marker = orderedMarker(stack[stack.length - 1]!.count, depth);
    }
  }
}

// Leading-whitespace width in columns (space = 1, tab advances to the next
// multiple of four). Only used for the relative depth comparison in
// `numberLists`, so the exact tab stop matters little — what matters is that a
// more-indented line always measures wider.
function leadingIndent(raw: string): number {
  let cols = 0;
  for (const ch of raw) {
    if (ch === " ") cols += 1;
    else if (ch === "\t") cols += 4 - (cols % 4);
    else break;
  }
  return cols;
}

// The number an `ol` item opens its list at: the digits of its typed marker
// (`"3."` → 3), or 1 when absent or unparseable.
function startNumber(ordinal?: string): number {
  const m = ordinal ? /\d+/.exec(ordinal) : null;
  const n = m ? Number.parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// The display marker for an ordered item at `n` and nesting `depth`. The style
// rotates every three levels — decimal, then lower-alpha, then lower-roman —
// mirroring the classic outline numbering (`1.` → `a.` → `i.`).
function orderedMarker(n: number, depth: number): string {
  switch (depth % 3) {
    case 1:
      return `${toAlpha(n)}.`;
    case 2:
      return `${toRoman(n)}.`;
    default:
      return `${n}.`;
  }
}

// Spreadsheet-style lower-alpha label: 1 → a … 26 → z, 27 → aa, ….
function toAlpha(n: number): string {
  if (n <= 0) return String(n);
  let out = "";
  let rem = n;
  while (rem > 0) {
    rem -= 1;
    out = String.fromCharCode(97 + (rem % 26)) + out;
    rem = Math.floor(rem / 26);
  }
  return out;
}

const ROMAN_NUMERALS: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

// Lowercase Roman numeral (1 → i, 4 → iv, 9 → ix …); non-positive input falls
// back to the plain number so an odd list never renders blank.
function toRoman(n: number): string {
  if (n <= 0) return String(n);
  let out = "";
  let rem = n;
  for (const [value, sym] of ROMAN_NUMERALS) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}

function classifyLine(raw: string): LineBlock {
  if (raw.trim() === "") {
    return { kind: "blank", raw, content: "", contentStart: 0 };
  }
  // `---`/`***`/`___`, and also a line that is just a single `-` — a quick
  // divider a note-taker reaches for without counting out three dashes.
  if (HR_RE.test(raw) || raw.trim() === "-") {
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
  | { type: "link"; text: string; href: string; offset: number; bare?: true }
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

    if (c === "h" || c === "H" || c === "w" || c === "W") {
      // A bare URL typed without `[…](…)` syntax — `http://…`, `https://…`, or
      // `www.…` — becomes a link so it renders and clicks through like an
      // explicit one. Unlike a markdown link the rendered text *is* the source,
      // so its offset starts at the URL's first character (no `[` to skip).
      const auto = matchAutolink(text, i);
      if (auto) {
        flush(i);
        nodes.push({
          type: "link",
          text: auto.text,
          href: auto.href,
          offset: base + i,
          // Flags a bare URL (no `[…](…)`) so the renderer may shorten its
          // displayed text — an explicit link's text is the user's own label
          // and must never be touched.
          bare: true,
        });
        i = auto.end;
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

// A bare URL starting at `start`: an `http(s)://` or `www.` run of non-space
// characters. Returns the displayed text (verbatim source) and the `href` to
// open (`www.` gets an `https://` prefix so it's a valid absolute URL), or
// null when `start` doesn't begin a URL.
const AUTOLINK_RE = /^(?:https?:\/\/|www\.)[^\s<>[\]]+/i;

function matchAutolink(
  text: string,
  start: number,
): { text: string; href: string; end: number } | null {
  // Only fire at a token boundary so "shttps://x" doesn't link from index 1.
  const prev = text.charAt(start - 1);
  if (prev && /[A-Za-z0-9]/.test(prev)) return null;
  const m = AUTOLINK_RE.exec(text.slice(start));
  if (!m) return null;
  const url = trimUrlTrailing(m[0]);
  // `www.` alone (or shorter) isn't a usable URL — require something after it.
  if (/^www\.$/i.test(url) || url.length === 0) return null;
  const href = /^www\./i.test(url) ? `https://${url}` : url;
  return { text: url, href, end: start + url.length };
}

// Strip trailing characters that read as sentence punctuation rather than part
// of the URL (`.,!?;:` and quotes), and an unbalanced closing paren — so
// "(see http://x.y)" and "visit http://x.y." don't swallow the `)`/`.`.
function trimUrlTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url.charAt(end - 1);
    if (".,!?;:'\"".includes(ch)) {
      end--;
      continue;
    }
    if (ch === ")") {
      const slice = url.slice(0, end);
      const opens = (slice.match(/\(/g) ?? []).length;
      const closes = (slice.match(/\)/g) ?? []).length;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

// The marker an elided URL middle is replaced with.
const URL_ELLIPSIS = "[...]";

// Shorten a bare URL for *display* (the source is never touched): keep the
// domain (scheme + host) plus the next `chars` characters, an elision marker,
// then the final `chars` characters — e.g. `https://site.com/a/b[...]xyz789`.
// `chars` of 0 disables shortening. Returns the URL unchanged when shortening
// wouldn't make it shorter — i.e. the kept head and tail would meet or overlap,
// or the elided middle is no longer than the marker itself — so a short URL is
// always shown in full and the result is never longer than the original.
export function shortenUrl(url: string, chars: number): string {
  if (chars <= 0) return url;
  const domain = /^(?:https?:\/\/)?[^/?#]*/i.exec(url)?.[0] ?? "";
  const head = url.slice(0, domain.length + chars);
  const tail = url.slice(url.length - chars);
  if (url.length <= head.length + URL_ELLIPSIS.length + tail.length) {
    return url;
  }
  return `${head}${URL_ELLIPSIS}${tail}`;
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
