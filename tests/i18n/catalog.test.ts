import { describe, expect, it } from "vitest";

import {
  bcp47,
  detectInitialLanguage,
  ensureCatalog,
  SUPPORTED_LANGS,
  tFor,
} from "../../src/i18n/index.ts";
import { en } from "../../src/i18n/locales/en/index.ts";
import { sv } from "../../src/i18n/locales/sv/index.ts";

// Flatten a nested catalog into a sorted list of `dotted.path → value` pairs,
// mirroring the runtime's own flattening so the test sees exactly what `t()`
// would resolve.
function flatten(obj: unknown, prefix = "", out = new Map<string, string>()) {
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (typeof v === "string") out.set(path, v);
    else flatten(v, path, out);
  }
  return out;
}

const flatEn = flatten(en);
const flatSv = flatten(sv);

describe("i18n catalogs", () => {
  it("Swedish covers exactly the same keys as English", () => {
    const enKeys = [...flatEn.keys()].sort();
    const svKeys = [...flatSv.keys()].sort();
    const missingInSv = enKeys.filter((k) => !flatSv.has(k));
    const extraInSv = svKeys.filter((k) => !flatEn.has(k));
    expect(missingInSv).toEqual([]);
    expect(extraInSv).toEqual([]);
  });

  it("has no empty strings in either catalog", () => {
    for (const [key, value] of flatEn) {
      expect(value.trim(), `en.${key}`).not.toBe("");
    }
    for (const [key, value] of flatSv) {
      expect(value.trim(), `sv.${key}`).not.toBe("");
    }
  });

  it("keeps every {param} placeholder consistent between languages", () => {
    const placeholders = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, enValue] of flatEn) {
      const svValue = flatSv.get(key);
      expect(svValue).toBeDefined();
      expect(placeholders(svValue!), `placeholders in ${key}`).toEqual(
        placeholders(enValue),
      );
    }
  });
});

describe("i18n runtime", () => {
  it("resolves a known English key synchronously", () => {
    expect(tFor("en", "common.close")).toBe("Close");
  });

  it("substitutes {param} interpolation", () => {
    // `tFor` runs the same `formatString` path `t()` uses; pick any key that
    // carries a placeholder so a regression in interpolation is caught.
    const withParam = [...flatEn.entries()].find(([, v]) => v.includes("{"));
    expect(
      withParam,
      "expected at least one parameterised string",
    ).toBeTruthy();
    const [key, template] = withParam!;
    const param = [...template.matchAll(/\{(\w+)\}/g)][0]![1]!;
    const out = tFor("en", key as never, { [param]: "XYZZY" });
    expect(out).toContain("XYZZY");
    expect(out).not.toContain(`{${param}}`);
  });

  it("loads the Swedish catalog on demand", async () => {
    await ensureCatalog("sv");
    // Once resident, `tFor` resolves Swedish rather than falling back to en.
    expect(tFor("sv", "common.close")).toBe("Stäng");
  });

  it("maps language codes to concrete BCP-47 locales", () => {
    expect(bcp47("en")).toBe("en-GB");
    expect(bcp47("sv")).toBe("sv-SE");
  });

  it("detects a supported initial language", () => {
    expect(SUPPORTED_LANGS).toContain(detectInitialLanguage());
  });
});
