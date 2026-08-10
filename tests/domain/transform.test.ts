import { describe, expect, it } from "vitest";

import { parseInline } from "../../src/domain/markdown.ts";
import enSettings from "../../src/i18n/locales/en/settings.ts";
import {
  applyTransforms,
  compilePattern,
  compileTransforms,
  emptyTransformRule,
  expandReplacement,
  insertRegexToken,
  maskText,
  patternError,
  previewSegments,
  REGEX_TOKEN_GROUPS,
  transformHits,
  type TransformRule,
} from "../../src/domain/transform.ts";

function rule(patch: Partial<TransformRule>): TransformRule {
  return { ...emptyTransformRule(patch.id ?? "r1"), ...patch };
}

const ISSUE_RULE = rule({
  id: "issue",
  pattern: "#(\\d+)",
  kind: "link",
  replacement: "https://github.com/acme/repo/issues/$1",
});

const PHONE_RULE = rule({
  id: "phone",
  pattern: "\\b0\\d{2}\\d{7}\\b",
  kind: "sensitive",
  mask: "ends",
});

describe("compilePattern", () => {
  it("compiles a valid pattern with the global flag", () => {
    const re = compilePattern("a+", false);
    expect(re?.flags).toContain("g");
    expect(re?.ignoreCase).toBe(false);
  });

  it("honours the case-insensitive flag", () => {
    expect(compilePattern("a", true)?.ignoreCase).toBe(true);
  });

  it("returns null for an empty or broken pattern", () => {
    expect(compilePattern("", false)).toBeNull();
    expect(compilePattern("(unclosed", false)).toBeNull();
  });

  it("falls back off unicode mode for a lenient escape", () => {
    // `\-` is an identity escape: legal in the default dialect, an error
    // under `u`. A hand-typed rule shouldn't be rejected for it.
    expect(compilePattern("a\\-b", false)).not.toBeNull();
  });
});

describe("patternError", () => {
  it("is null when the pattern compiles", () => {
    expect(patternError("\\d+", false)).toBeNull();
    expect(patternError("", false)).toBeNull();
  });

  it("reports the engine's message when it doesn't", () => {
    expect(patternError("(unclosed", false)).toBeTruthy();
  });
});

describe("compileTransforms", () => {
  it("keeps enabled rules in order and drops broken ones", () => {
    const compiled = compileTransforms([
      ISSUE_RULE,
      rule({ id: "broken", pattern: "(" }),
      rule({ id: "off", pattern: "x", enabled: false }),
      PHONE_RULE,
    ]);
    expect(compiled.map((c) => c.rule.id)).toEqual(["issue", "phone"]);
  });
});

describe("expandReplacement", () => {
  const match = /(\d+)-(\w+)/.exec("id 42-abc")!;

  it("expands numbered groups", () => {
    expect(expandReplacement("/$1/$2", match)).toBe("/42/abc");
  });

  it("expands the whole match and a literal dollar", () => {
    expect(expandReplacement("[$&] $$", match)).toBe("[42-abc] $");
  });

  it("leaves a reference to a group that doesn't exist alone", () => {
    expect(expandReplacement("$7", match)).toBe("$7");
  });

  it("prefers the two-digit group when one exists", () => {
    const many = /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)/.exec("abcdefghijkl")!;
    expect(expandReplacement("$12", many)).toBe("l");
    expect(expandReplacement("$1", many)).toBe("a");
  });

  it("expands a named group", () => {
    const named = /(?<num>\d+)/.exec("no 7")!;
    expect(expandReplacement("n=$<num>", named)).toBe("n=7");
  });

  it("expands an unmatched optional group to nothing", () => {
    const opt = /a(b)?/.exec("a")!;
    expect(expandReplacement("[$1]", opt)).toBe("[]");
  });
});

describe("maskText", () => {
  it("masks every character", () => {
    expect(maskText("0761234123", "all")).toBe("**********");
  });

  it("uses a static width", () => {
    expect(maskText("0761234123", "fixed")).toBe("********");
    expect(maskText("ab", "fixed")).toBe("********");
  });

  it("keeps both ends", () => {
    expect(maskText("0761234123", "ends")).toBe("076****123");
  });

  it("keeps only the last or first characters", () => {
    expect(maskText("0761234123", "last")).toBe("*******123");
    expect(maskText("0761234123", "first")).toBe("076*******");
  });

  it("masks a short string entirely rather than leaking it", () => {
    expect(maskText("12345", "ends")).toBe("*****");
    expect(maskText("ab", "last")).toBe("**");
    expect(maskText("ab", "first")).toBe("**");
  });
});

describe("transformHits", () => {
  it("resolves a link rule to the matched text plus an href", () => {
    const [hit] = transformHits(
      "see #134 today",
      compileTransforms([ISSUE_RULE]),
    );
    expect(hit).toMatchObject({
      from: 4,
      to: 8,
      kind: "link",
      text: "#134",
      href: "https://github.com/acme/repo/issues/134",
      source: "#134",
    });
  });

  it("resolves a text rule to the expanded template", () => {
    const [hit] = transformHits(
      "TODO(nic): fix",
      compileTransforms([
        rule({
          pattern: "TODO\\((\\w+)\\)",
          kind: "text",
          replacement: "→ $1",
        }),
      ]),
    );
    expect(hit).toMatchObject({ kind: "text", text: "→ nic", href: null });
  });

  it("masks the whole match when a sensitive rule has no template", () => {
    const [hit] = transformHits(
      "call 0761234123 now",
      compileTransforms([PHONE_RULE]),
    );
    expect(hit).toMatchObject({ kind: "sensitive", text: "076****123" });
  });

  it("masks the expansion when a sensitive rule has one", () => {
    const [hit] = transformHits(
      "key sk-abcdef",
      compileTransforms([
        rule({
          pattern: "sk-(\\w+)",
          kind: "sensitive",
          replacement: "$1",
          mask: "all",
        }),
      ]),
    );
    expect(hit?.text).toBe("******");
  });

  it("offsets hits by the base column", () => {
    const [hit] = transformHits("#7", compileTransforms([ISSUE_RULE]), 10);
    expect(hit).toMatchObject({ from: 10, to: 12 });
  });

  it("finds every occurrence on the line", () => {
    const hits = transformHits("#1 and #2", compileTransforms([ISSUE_RULE]));
    expect(hits.map((h) => h.source)).toEqual(["#1", "#2"]);
  });

  it("returns hits sorted by column across rules", () => {
    const hits = transformHits(
      "0761234123 then #9",
      compileTransforms([ISSUE_RULE, PHONE_RULE]),
    );
    expect(hits.map((h) => h.kind)).toEqual(["sensitive", "link"]);
  });

  it("lets the first rule claim an overlap", () => {
    const hits = transformHits(
      "#134",
      compileTransforms([
        ISSUE_RULE,
        rule({ id: "second", pattern: "#\\d", kind: "text", replacement: "x" }),
      ]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.ruleId).toBe("issue");
  });

  it("ignores a zero-width match rather than looping on it", () => {
    expect(
      transformHits("abc", compileTransforms([rule({ pattern: "x*" })])),
    ).toEqual([]);
  });

  it("is empty with no rules or no text", () => {
    expect(transformHits("#1", [])).toEqual([]);
    expect(transformHits("", compileTransforms([ISSUE_RULE]))).toEqual([]);
  });
});

describe("applyTransforms", () => {
  const compiled = compileTransforms([ISSUE_RULE]);

  it("splits a text node around its hit", () => {
    const nodes = applyTransforms(parseInline("see #134 now"), compiled);
    expect(nodes.map((n) => n.type)).toEqual(["text", "transform", "text"]);
    expect(nodes[1]).toMatchObject({
      type: "transform",
      kind: "link",
      text: "#134",
      source: "#134",
      offset: 4,
    });
    expect(nodes[2]).toMatchObject({ text: " now", offset: 8 });
  });

  it("keeps source columns absolute under a base offset", () => {
    const nodes = applyTransforms(parseInline("#134", 6), compiled);
    expect(nodes[0]).toMatchObject({ type: "transform", offset: 6 });
  });

  it("never fires inside inline code", () => {
    const nodes = applyTransforms(parseInline("`#134`"), compiled);
    expect(nodes.map((n) => n.type)).toEqual(["code"]);
  });

  it("never fires inside a link's label", () => {
    const nodes = applyTransforms(parseInline("[#134](https://x.y)"), compiled);
    expect(nodes.map((n) => n.type)).toEqual(["link"]);
  });

  it("walks into emphasis", () => {
    const [strong] = applyTransforms(parseInline("**#134**"), compiled);
    expect(strong?.type).toBe("strong");
    expect(
      strong && "children" in strong ? strong.children[0]?.type : null,
    ).toBe("transform");
  });

  it("returns the tree untouched with no rules", () => {
    const nodes = parseInline("see #134");
    expect(applyTransforms(nodes, [])).toBe(nodes);
  });
});

describe("previewSegments", () => {
  it("tiles the sample into plain and transformed runs", () => {
    const segments = previewSegments(
      "fix #134 please",
      compileTransforms([ISSUE_RULE]),
    );
    expect(segments).toEqual([
      { kind: "plain", text: "fix " },
      {
        kind: "link",
        text: "#134",
        href: "https://github.com/acme/repo/issues/134",
        source: "#134",
      },
      { kind: "plain", text: " please" },
    ]);
  });

  it("is one plain run when nothing matches", () => {
    expect(previewSegments("nothing", compileTransforms([ISSUE_RULE]))).toEqual(
      [{ kind: "plain", text: "nothing" }],
    );
  });

  it("is empty for an empty sample", () => {
    expect(previewSegments("", compileTransforms([ISSUE_RULE]))).toEqual([]);
  });
});

describe("insertRegexToken", () => {
  const digit = { id: "digit", label: "\\d", insert: "\\d" };
  const capture = { id: "capture", label: "(…)", insert: "(", close: ")" };

  it("types a plain token at the caret", () => {
    expect(insertRegexToken("ab", 1, 1, digit)).toEqual({
      value: "a\\db",
      caret: 3,
    });
  });

  it("replaces the selection with a plain token", () => {
    expect(insertRegexToken("abc", 1, 3, digit)).toEqual({
      value: "a\\d",
      caret: 3,
    });
  });

  it("wraps a selection and lands the caret past the closing half", () => {
    expect(insertRegexToken("#\\d+", 1, 4, capture)).toEqual({
      value: "#(\\d+)",
      caret: 6,
    });
  });

  it("wraps nothing and lands the caret between the halves", () => {
    expect(insertRegexToken("#", 1, 1, capture)).toEqual({
      value: "#()",
      caret: 2,
    });
  });

  it("appends at the end of the field", () => {
    expect(insertRegexToken("\\d", 2, 2, digit)).toEqual({
      value: "\\d\\d",
      caret: 4,
    });
  });

  it("clamps and orders out-of-range or reversed bounds", () => {
    // A field that was never focused reports (0, 0) — prepend.
    expect(insertRegexToken("ab", 0, 0, digit).value).toBe("\\dab");
    expect(insertRegexToken("ab", 99, 99, digit).value).toBe("ab\\d");
    expect(insertRegexToken("abc", 3, 1, capture).value).toBe("a(bc)");
  });
});

describe("REGEX_TOKEN_GROUPS", () => {
  const copy = enSettings.transform as unknown as {
    token: Record<string, string>;
    tokenGroup: Record<string, string>;
  };

  it("has unique token ids", () => {
    const ids = REGEX_TOKEN_GROUPS.flatMap((g) => g.tokens.map((tk) => tk.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has copy for every group and every token", () => {
    // The renderer resolves these keys dynamically, so nothing but this test
    // catches a token added without its description.
    for (const group of REGEX_TOKEN_GROUPS) {
      expect(copy.tokenGroup[group.id], `group "${group.id}"`).toBeTruthy();
      for (const token of group.tokens) {
        expect(copy.token[token.id], `token "${token.id}"`).toBeTruthy();
      }
    }
  });

  it("compiles every token's snippet in the position it is typed into", () => {
    // A token is pressed with text around it, which is the shape that has to
    // hold: a plain one sits between characters, a wrapping one around them.
    // (`\\` is exactly why the trailing character matters — it escapes what
    // the user types next, and is a syntax error on its own.)
    for (const group of REGEX_TOKEN_GROUPS) {
      for (const token of group.tokens) {
        const source =
          token.close === undefined
            ? `a${token.insert}b`
            : `${token.insert}a${token.close}`;
        expect(() => new RegExp(source), `token "${token.id}"`).not.toThrow();
      }
    }
  });
});
