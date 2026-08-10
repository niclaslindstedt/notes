// **Transforms**: user-defined regex rules that rewrite what a note's body
// *shows* without touching what it stores. A rule matches a run of source text
// and replaces it with a link (`#134` → the issue it names), with other text,
// or with a mask (`0761234123` → `076****123`). Pure functions over strings —
// no DOM, no I/O — so this stays in `domain/`.
//
// The rules are display-only, and deliberately so: the note on disk keeps the
// characters that were typed, the caret line renders raw (so the real text is
// always one press away), and a copied selection carries the source rather than
// the substitution (`data-len` on the rendered leaf, see `MarkdownLine.tsx`).
// That is what makes the `sensitive` kind safe to reach for — it hides a phone
// number from a shoulder-surfer, it does not redact the note.
//
// The pipeline is three steps, each its own export:
//
//   1. `compileTransforms` turns the persisted rules into `RegExp`s once,
//      dropping the ones that don't compile (a half-typed pattern in the
//      dialog must not throw on every keystroke of the note).
//   2. `transformHits` runs the compiled rules over one line and returns the
//      non-overlapping matches, each with its source span and what to show.
//   3. `applyTransforms` folds those hits into a parsed inline-node tree, so
//      the live-preview renderer gets `transform` nodes alongside its bold and
//      its links.

import type { InlineNode } from "./markdown.ts";

/** What a rule turns its match into. */
export const TRANSFORM_KINDS = ["link", "text", "sensitive"] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

/** The default a freshly-added rule starts on. */
export const DEFAULT_TRANSFORM_KIND: TransformKind = "link";

/**
 * How a `sensitive` rule hides its match:
 *
 * - `all` — every character becomes `*`, so the length still reads.
 * - `fixed` — always `MASK_FIXED_WIDTH` stars, so the length doesn't.
 * - `ends` — keep `MASK_EDGE` characters at each end (`076****123`).
 * - `last` — keep only the last `MASK_EDGE`.
 * - `first` — keep only the first `MASK_EDGE`.
 */
export const MASK_STYLES = ["all", "fixed", "ends", "last", "first"] as const;
export type MaskStyle = (typeof MASK_STYLES)[number];

export const DEFAULT_MASK_STYLE: MaskStyle = "ends";

const MASK_CHAR = "*";
/** Stars a `fixed` mask always draws, whatever the match's length. */
const MASK_FIXED_WIDTH = 8;
/** Characters an `ends` / `first` / `last` mask leaves in the clear. */
const MASK_EDGE = 3;

/** One persisted rule. Lives in the synced appearance document. */
export type TransformRule = {
  /** Stable id, used as the list key and by the edit dialog. */
  id: string;
  /** Optional human label. Falls back to the pattern in the list. */
  name: string;
  /** The regex source, as typed — no delimiters, no flags. */
  pattern: string;
  /** Match without regard to case. `g` is always applied; this is the only
   *  flag the dialog offers, because the rest change the meaning per line. */
  ignoreCase: boolean;
  kind: TransformKind;
  /** The substitution template: a URL for `link`, the shown text for `text`,
   *  and (optionally) the string to mask for `sensitive`. `$1`…`$99`, `$&`,
   *  `$<name>` and `$$` expand as in `String.replace`. */
  replacement: string;
  /** Which mask a `sensitive` rule draws. Ignored by the other kinds. */
  mask: MaskStyle;
  /** The sample text the rule was written against, kept so re-opening the
   *  dialog shows the example that proves the rule still does what it should. */
  sample: string;
  /** Rules can be parked without being deleted. */
  enabled: boolean;
};

/** A rule that compiled, paired with its `RegExp`. */
export type CompiledTransform = { rule: TransformRule; re: RegExp };

/** One rule's match on one line, resolved to what the renderer should draw. */
export type TransformHit = {
  /** Source columns the match covers, absolute within the original line. */
  from: number;
  to: number;
  kind: TransformKind;
  /** The text to display in place of the source. */
  text: string;
  /** Where a `link` hit points; null for every other kind. */
  href: string | null;
  /** The matched source, verbatim — shown as the title of a rendered hit. */
  source: string;
  /** The rule that produced this hit, for the preview's legend. */
  ruleId: string;
};

// A line is a line: a pathological rule (`a?` over a wall of text) shouldn't
// be able to spend unbounded time or memory building hits nobody can read.
const MAX_HITS_PER_LINE = 200;

/** A fresh rule id. Same generator the note model uses. */
export function newTransformId(): string {
  return crypto.randomUUID();
}

/** A blank rule for the "add" dialog to start from. */
export function emptyTransformRule(
  id: string = newTransformId(),
): TransformRule {
  return {
    id,
    name: "",
    pattern: "",
    ignoreCase: false,
    kind: DEFAULT_TRANSFORM_KIND,
    replacement: "",
    mask: DEFAULT_MASK_STYLE,
    sample: "",
    enabled: true,
  };
}

export function isTransformKind(v: unknown): v is TransformKind {
  return (TRANSFORM_KINDS as readonly unknown[]).includes(v);
}

export function isMaskStyle(v: unknown): v is MaskStyle {
  return (MASK_STYLES as readonly unknown[]).includes(v);
}

/**
 * Compile `pattern` with the app's fixed flag set, or return null when the
 * regex engine rejects it. The one place a `new RegExp` is allowed to throw.
 */
export function compilePattern(
  pattern: string,
  ignoreCase: boolean,
): RegExp | null {
  if (pattern === "") return null;
  try {
    return new RegExp(pattern, ignoreCase ? "giu" : "gu");
  } catch {
    // `u` mode is strict about escapes a hand-typed pattern may well use
    // (`\d` is fine, `\-` is not), so fall back to the lenient dialect rather
    // than rejecting a rule the user could reasonably expect to work.
    try {
      return new RegExp(pattern, ignoreCase ? "gi" : "g");
    } catch {
      return null;
    }
  }
}

/** The regex-engine error for `pattern`, or null when it compiles. */
export function patternError(
  pattern: string,
  ignoreCase: boolean,
): string | null {
  if (pattern === "") return null;
  if (compilePattern(pattern, ignoreCase)) return null;
  try {
    new RegExp(pattern, ignoreCase ? "gi" : "g");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Compile the enabled rules, in order, dropping the ones whose pattern the
 * regex engine rejects. Order is significant: an earlier rule claims its match
 * and a later one can't overlap it.
 */
export function compileTransforms(
  rules: readonly TransformRule[],
): CompiledTransform[] {
  const compiled: CompiledTransform[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const re = compilePattern(rule.pattern, rule.ignoreCase);
    if (re) compiled.push({ rule, re });
  }
  return compiled;
}

/**
 * Expand a `String.replace`-style template against `match`. Supports `$$`
 * (a literal `$`), `$&` (the whole match), `$1`…`$99`, and `$<name>` for a
 * named group. An unmatched group expands to the empty string; a reference to
 * a group that doesn't exist is left as typed, so a bare `$` in a URL survives.
 */
export function expandReplacement(
  template: string,
  match: RegExpExecArray,
): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const at = template.indexOf("$", i);
    if (at === -1 || at === template.length - 1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, at);
    const next = template.charAt(at + 1);

    if (next === "$") {
      out += "$";
      i = at + 2;
      continue;
    }
    if (next === "&") {
      out += match[0];
      i = at + 2;
      continue;
    }
    if (next === "<") {
      const close = template.indexOf(">", at + 2);
      const name = close === -1 ? "" : template.slice(at + 2, close);
      const groups = match.groups;
      if (close !== -1 && groups && name in groups) {
        out += groups[name] ?? "";
        i = close + 1;
        continue;
      }
      out += "$";
      i = at + 1;
      continue;
    }
    if (next >= "0" && next <= "9") {
      // Prefer the two-digit group when one exists (`$12` over `$1` + "2"),
      // matching `String.replace`.
      const two = template.slice(at + 1, at + 3);
      const twoIdx = /^\d\d$/.test(two) ? Number(two) : NaN;
      if (!Number.isNaN(twoIdx) && twoIdx > 0 && twoIdx < match.length) {
        out += match[twoIdx] ?? "";
        i = at + 3;
        continue;
      }
      const oneIdx = Number(next);
      if (oneIdx > 0 && oneIdx < match.length) {
        out += match[oneIdx] ?? "";
        i = at + 2;
        continue;
      }
    }
    out += "$";
    i = at + 1;
  }
  return out;
}

/** Draw `style`'s mask over `text`. */
export function maskText(text: string, style: MaskStyle): string {
  const chars = [...text];
  const stars = (n: number) => MASK_CHAR.repeat(Math.max(n, 0));
  switch (style) {
    case "fixed":
      return stars(MASK_FIXED_WIDTH);
    case "ends": {
      if (chars.length <= MASK_EDGE * 2) return stars(chars.length);
      return (
        chars.slice(0, MASK_EDGE).join("") +
        stars(chars.length - MASK_EDGE * 2) +
        chars.slice(chars.length - MASK_EDGE).join("")
      );
    }
    case "last": {
      if (chars.length <= MASK_EDGE) return stars(chars.length);
      return (
        stars(chars.length - MASK_EDGE) +
        chars.slice(chars.length - MASK_EDGE).join("")
      );
    }
    case "first": {
      if (chars.length <= MASK_EDGE) return stars(chars.length);
      return (
        chars.slice(0, MASK_EDGE).join("") + stars(chars.length - MASK_EDGE)
      );
    }
    case "all":
      return stars(chars.length);
  }
}

/**
 * What one match renders as: the display text, and the href when the rule
 * makes a link. A `link` shows the matched source and points at the expanded
 * template; a `text` shows the expanded template; a `sensitive` masks the
 * expansion — or the whole match when no template was given, which is the
 * common case (match the number, hide the number).
 */
function resolveHit(
  rule: TransformRule,
  match: RegExpExecArray,
): { text: string; href: string | null } {
  const source = match[0];
  switch (rule.kind) {
    case "link": {
      const href = expandReplacement(rule.replacement, match);
      return { text: source, href };
    }
    case "text":
      return { text: expandReplacement(rule.replacement, match), href: null };
    case "sensitive": {
      const subject =
        rule.replacement === ""
          ? source
          : expandReplacement(rule.replacement, match);
      return { text: maskText(subject, rule.mask), href: null };
    }
  }
}

/**
 * Every hit the compiled rules land on `text`, sorted by source column and
 * never overlapping: rules are tried in order, and a later rule's match that
 * would straddle an earlier one's is dropped rather than nested.
 *
 * `base` is the source column of `text[0]`, so a hit's `from`/`to` stay
 * absolute within the original line (mirroring `parseInline`'s `base`).
 */
export function transformHits(
  text: string,
  compiled: readonly CompiledTransform[],
  base = 0,
): TransformHit[] {
  if (text === "" || compiled.length === 0) return [];
  const hits: TransformHit[] = [];
  const taken: { from: number; to: number }[] = [];

  for (const { rule, re } of compiled) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = re.exec(text)) !== null) {
      if (guard++ >= MAX_HITS_PER_LINE) break;
      const from = match.index;
      const to = from + match[0].length;
      // A zero-width match would spin `exec` forever and has nothing to show.
      if (to === from) {
        re.lastIndex += 1;
        continue;
      }
      const clashes = taken.some((r) => from < r.to && r.from < to);
      if (!clashes) {
        const { text: shown, href } = resolveHit(rule, match);
        hits.push({
          from: base + from,
          to: base + to,
          kind: rule.kind,
          text: shown,
          href,
          source: match[0],
          ruleId: rule.id,
        });
        taken.push({ from, to });
      }
    }
    if (hits.length >= MAX_HITS_PER_LINE) break;
  }

  return hits.sort((a, b) => a.from - b.from);
}

/**
 * Rewrite the text runs of a parsed inline tree into `transform` nodes where
 * the rules hit. Only `text` nodes are considered — a rule never fires inside
 * inline code, a link's label, or an image reference, all of which are markup
 * the note-taker meant literally. Emphasis wrappers are walked into, so a rule
 * still matches inside **bold**.
 */
export function applyTransforms(
  nodes: readonly InlineNode[],
  compiled: readonly CompiledTransform[],
): InlineNode[] {
  if (compiled.length === 0) return nodes as InlineNode[];
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(...splitTextNode(node.text, node.offset, compiled));
      continue;
    }
    if (
      node.type === "strong" ||
      node.type === "em" ||
      node.type === "strikethrough"
    ) {
      out.push({ ...node, children: applyTransforms(node.children, compiled) });
      continue;
    }
    out.push(node);
  }
  return out;
}

// One text run, split at its hits into alternating text and transform nodes.
function splitTextNode(
  text: string,
  offset: number,
  compiled: readonly CompiledTransform[],
): InlineNode[] {
  const hits = transformHits(text, compiled, offset);
  if (hits.length === 0) return [{ type: "text", text, offset }];
  const out: InlineNode[] = [];
  let cursor = offset;
  for (const hit of hits) {
    if (hit.from > cursor) {
      out.push({
        type: "text",
        text: text.slice(cursor - offset, hit.from - offset),
        offset: cursor,
      });
    }
    out.push({
      type: "transform",
      kind: hit.kind,
      text: hit.text,
      href: hit.href,
      source: hit.source,
      offset: hit.from,
    });
    cursor = hit.to;
  }
  if (cursor < offset + text.length) {
    out.push({
      type: "text",
      text: text.slice(cursor - offset),
      offset: cursor,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The regex helper
// ---------------------------------------------------------------------------

/**
 * One entry in the rule dialog's **regex helper** — the dropdown that types a
 * regex construct into the pattern field and says, in words, what it does.
 *
 * `label` is the snippet as the list shows it (`\d`, `(…)`); `insert` is what
 * actually goes into the field. A token with a `close` is a **wrapping** one:
 * with a selection it goes around it (select `\d+`, press `(…)`, get
 * `(\d+)`), and without one the caret lands between the halves ready to type.
 *
 * The catalog is data only — every description lives in the `settings`
 * i18n namespace under `settings.transform.token.<id>`, the same split the
 * achievements catalog uses, so a new token is a row here plus its copy.
 */
export type RegexToken = {
  id: string;
  label: string;
  insert: string;
  close?: string;
};

export type RegexTokenGroup = { id: string; tokens: readonly RegexToken[] };

export const REGEX_TOKEN_GROUPS: readonly RegexTokenGroup[] = [
  {
    id: "match",
    tokens: [
      { id: "digit", label: "\\d", insert: "\\d" },
      { id: "word", label: "\\w", insert: "\\w" },
      { id: "space", label: "\\s", insert: "\\s" },
      { id: "any", label: ".", insert: "." },
      { id: "set", label: "[…]", insert: "[", close: "]" },
      { id: "notSet", label: "[^…]", insert: "[^", close: "]" },
      { id: "range", label: "a-z", insert: "a-z" },
    ],
  },
  {
    id: "repeat",
    tokens: [
      { id: "oneOrMore", label: "+", insert: "+" },
      { id: "zeroOrMore", label: "*", insert: "*" },
      { id: "optional", label: "?", insert: "?" },
      { id: "count", label: "{2,4}", insert: "{2,4}" },
    ],
  },
  {
    id: "group",
    tokens: [
      { id: "capture", label: "(…)", insert: "(", close: ")" },
      { id: "nonCapture", label: "(?:…)", insert: "(?:", close: ")" },
      { id: "alternate", label: "|", insert: "|" },
    ],
  },
  {
    id: "position",
    tokens: [
      { id: "lineStart", label: "^", insert: "^" },
      { id: "lineEnd", label: "$", insert: "$" },
      { id: "wordBoundary", label: "\\b", insert: "\\b" },
      { id: "escape", label: "\\", insert: "\\" },
    ],
  },
];

/** A pattern field after a helper token was typed into it. */
export type TokenInsertion = { value: string; caret: number };

/**
 * Type `token` into `value` at the field's selection, returning the new
 * pattern and where the caret should land.
 *
 * A wrapping token with a non-empty selection goes **around** it and leaves
 * the caret past the closing half, so the wrap can be repeated; with a
 * collapsed caret both halves are inserted and the caret sits between them.
 * A plain token replaces the selection and leaves the caret after itself.
 *
 * Out-of-range or reversed selection bounds are clamped and ordered, so a
 * field that has never been focused (`0, 0`) simply prepends.
 */
export function insertRegexToken(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  token: RegexToken,
): TokenInsertion {
  const lo = Math.max(
    0,
    Math.min(value.length, Math.min(selectionStart, selectionEnd)),
  );
  const hi = Math.max(
    0,
    Math.min(value.length, Math.max(selectionStart, selectionEnd)),
  );
  const before = value.slice(0, lo);
  const selected = value.slice(lo, hi);
  const after = value.slice(hi);

  if (token.close === undefined) {
    return {
      value: before + token.insert + after,
      caret: lo + token.insert.length,
    };
  }

  const wrapped = token.insert + selected + token.close;
  return {
    value: before + wrapped + after,
    caret: selected === "" ? lo + token.insert.length : lo + wrapped.length,
  };
}

/** A run of the sample text in the rule dialog's output preview. */
export type PreviewSegment =
  | { kind: "plain"; text: string }
  | { kind: TransformKind; text: string; href: string | null; source: string };

/**
 * Tile `sample` into the runs the dialog's output pane draws: untouched text
 * interleaved with what each hit renders as. Runs over the raw sample rather
 * than a parsed tree — the preview answers "does my regex do what I meant?",
 * which is a question about the rule, not about Markdown.
 */
export function previewSegments(
  sample: string,
  compiled: readonly CompiledTransform[],
): PreviewSegment[] {
  if (sample === "") return [];
  const hits = transformHits(sample, compiled);
  const out: PreviewSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.from > cursor) {
      out.push({ kind: "plain", text: sample.slice(cursor, hit.from) });
    }
    out.push({
      kind: hit.kind,
      text: hit.text,
      href: hit.href,
      source: hit.source,
    });
    cursor = hit.to;
  }
  if (cursor < sample.length) {
    out.push({ kind: "plain", text: sample.slice(cursor) });
  }
  return out;
}
