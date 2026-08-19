import { describe, expect, it } from "vitest";

import {
  applyScopedSave,
  EMPTY_APPEARANCE_LAYERS,
  isUnscopedPath,
  narrowerScopes,
  resolveAppearanceLayers,
  resolveThroughScope,
  scopeHoldsSettings,
  writeToOwningScope,
  type AppearanceLayers,
} from "../../src/theme/appearance-scopes.ts";

const DEFAULTS = {
  theme: "dark",
  fontScale: 1,
  editor: { wordWrap: true, lineNumbers: false },
};

function layers(over: Partial<AppearanceLayers> = {}): AppearanceLayers {
  return { ...EMPTY_APPEARANCE_LAYERS, ...over };
}

describe("appearance scopes", () => {
  it("resolves narrowest-wins over the defaults", () => {
    const stack = layers({
      global: { theme: "light" },
      namespace: { theme: "monokai" },
      device: { fontScale: 1.2 },
    });
    expect(resolveAppearanceLayers(DEFAULTS, stack)).toEqual({
      theme: "monokai",
      fontScale: 1.2,
      editor: { wordWrap: true, lineNumbers: false },
    });
  });

  it("resolveThroughScope answers what a width falls back to", () => {
    const stack = layers({
      global: { theme: "light" },
      namespace: { theme: "monokai" },
      device: { theme: "excel" },
    });
    expect(resolveThroughScope(DEFAULTS, stack, "global")).toMatchObject({
      theme: "light",
    });
    expect(resolveThroughScope(DEFAULTS, stack, "namespace")).toMatchObject({
      theme: "monokai",
    });
  });

  it("orders the scopes widest first", () => {
    expect(narrowerScopes("global")).toEqual(["namespace", "device"]);
    expect(narrowerScopes("device")).toEqual([]);
  });

  it("reports whether a width holds anything — the Reset menu's gate", () => {
    const stack = layers({ namespace: { theme: "light" } });
    expect(scopeHoldsSettings(stack, "namespace")).toBe(true);
    expect(scopeHoldsSettings(stack, "global")).toBe(false);
  });

  describe("applyScopedSave", () => {
    const baseline = { ...DEFAULTS };

    it("writes only the leaves that actually moved", () => {
      // The whole point: saving globally must not republish every untouched
      // setting to everyone else on the account.
      const next = applyScopedSave(
        DEFAULTS,
        layers(),
        "global",
        { ...DEFAULTS, theme: "light" },
        baseline,
      );
      expect(next.global).toEqual({ theme: "light" });
    });

    it("descends into a branch rather than freezing its siblings", () => {
      const next = applyScopedSave(
        DEFAULTS,
        layers(),
        "device",
        { ...DEFAULTS, editor: { wordWrap: true, lineNumbers: true } },
        baseline,
      );
      expect(next.device).toEqual({ editor: { lineNumbers: true } });
    });

    it("drops a leaf that now equals the wider resolution", () => {
      // Reset-to-a-wider-scope followed by Save is how an override is given
      // up: the leaf matches what the wider layers say, so it stops being
      // stored at all.
      const stack = layers({
        global: { theme: "light" },
        device: { theme: "excel" },
      });
      const next = applyScopedSave(
        DEFAULTS,
        stack,
        "device",
        { ...DEFAULTS, theme: "light" },
        { ...DEFAULTS, theme: "excel" },
      );
      expect(next.device).toEqual({});
      expect(next.global).toEqual({ theme: "light" });
    });

    it("clears the saved leaves from narrower layers so the save takes effect", () => {
      const stack = layers({ device: { theme: "excel" } });
      const next = applyScopedSave(
        DEFAULTS,
        stack,
        "global",
        { ...DEFAULTS, theme: "light" },
        { ...DEFAULTS, theme: "excel" },
      );
      expect(next.global).toEqual({ theme: "light" });
      expect(next.device).toEqual({});
    });

    it("leaves wider layers, and untouched leaves, alone", () => {
      const stack = layers({
        global: { theme: "light", fontScale: 1.4 },
      });
      const next = applyScopedSave(
        DEFAULTS,
        stack,
        "device",
        {
          ...DEFAULTS,
          theme: "light",
          fontScale: 1.4,
          editor: { wordWrap: false, lineNumbers: false },
        },
        { ...DEFAULTS, theme: "light", fontScale: 1.4 },
      );
      expect(next.global).toEqual({ theme: "light", fontScale: 1.4 });
      expect(next.device).toEqual({ editor: { wordWrap: false } });
    });

    it("never scopes the unscoped keys", () => {
      expect(isUnscopedPath("transforms")).toBe(true);
      expect(isUnscopedPath("achievements.foo")).toBe(true);
      expect(isUnscopedPath("editor.wordWrap")).toBe(false);
      const next = applyScopedSave(
        DEFAULTS,
        layers(),
        "device",
        { ...DEFAULTS, transforms: [{ id: "a" }] },
        baseline,
      );
      expect(next.device).toEqual({});
    });
  });

  describe("writeToOwningScope", () => {
    it("keeps a setting at the width already managing it", () => {
      const stack = layers({ device: { theme: "excel" } });
      const next = writeToOwningScope(stack, "theme", "light");
      expect(next.device).toEqual({ theme: "light" });
      expect(next.global).toEqual({});
    });

    it("falls back to global when no layer has an opinion", () => {
      const next = writeToOwningScope(layers(), "theme", "light");
      expect(next.global).toEqual({ theme: "light" });
    });

    it("prefers the narrowest owner", () => {
      const stack = layers({
        global: { theme: "light" },
        namespace: { theme: "monokai" },
      });
      const next = writeToOwningScope(stack, "theme", "excel");
      expect(next.namespace).toEqual({ theme: "excel" });
      expect(next.global).toEqual({ theme: "light" });
    });
  });
});
