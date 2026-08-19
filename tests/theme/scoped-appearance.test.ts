// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  appearanceThroughScope,
  commitAppearance,
  DEFAULT_APPEARANCE,
  getAppearance,
  getAppearanceLayer,
  getAppearanceLayers,
  replaceAppearanceLayer,
  setAppearanceNamespace,
  updateAppearance,
} from "../../src/theme/useTheme.ts";

// The store is module state seeded once from localStorage, so each test
// re-seeds it by replacing every layer rather than reloading the module.
function resetLayers() {
  localStorage.clear();
  setAppearanceNamespace("default");
  replaceAppearanceLayer("global", {});
  replaceAppearanceLayer("namespace", {});
  replaceAppearanceLayer("device", {});
}

describe("the layered appearance store", () => {
  beforeEach(resetLayers);

  it("resolves narrowest-wins across the three widths", () => {
    replaceAppearanceLayer("global", { theme: "light" });
    expect(getAppearance().theme).toBe("light");
    replaceAppearanceLayer("namespace", { theme: "monokai" });
    expect(getAppearance().theme).toBe("monokai");
    replaceAppearanceLayer("device", { theme: "excel" });
    expect(getAppearance().theme).toBe("excel");
  });

  it("falls through to the wider width for a setting the narrow one skips", () => {
    replaceAppearanceLayer("global", { theme: "light", fontScale: 1.25 });
    replaceAppearanceLayer("device", { theme: "excel" });
    expect(getAppearance().theme).toBe("excel");
    expect(getAppearance().fontScale).toBe(1.25);
  });

  it("mirrors each layer to its own localStorage key, device never shared", () => {
    replaceAppearanceLayer("global", { theme: "light" });
    replaceAppearanceLayer("device", { theme: "excel" });
    expect(
      JSON.parse(localStorage.getItem("notes/appearance") ?? "{}"),
    ).toEqual({ theme: "light" });
    expect(
      JSON.parse(localStorage.getItem("notes/appearance:device") ?? "{}"),
    ).toEqual({ theme: "excel" });
  });

  it("swaps the namespace layer when the active namespace changes", () => {
    replaceAppearanceLayer("namespace", { theme: "monokai" });
    localStorage.setItem(
      "notes/appearance:ns:work",
      JSON.stringify({ theme: "light" }),
    );
    setAppearanceNamespace("work");
    expect(getAppearance().theme).toBe("light");
    setAppearanceNamespace("default");
    expect(getAppearance().theme).toBe("monokai");
  });

  describe("commitAppearance", () => {
    it("writes only what moved, at the chosen width", () => {
      const baseline = getAppearance();
      commitAppearance({ ...baseline, theme: "light" }, baseline, "device");
      expect(getAppearanceLayer("device")).toEqual({ theme: "light" });
      expect(getAppearanceLayer("global")).toEqual({});
    });

    it("descends into a nested group instead of freezing its siblings", () => {
      const baseline = getAppearance();
      commitAppearance(
        { ...baseline, editor: { ...baseline.editor, lineNumbers: true } },
        baseline,
        "namespace",
      );
      expect(getAppearanceLayer("namespace")).toEqual({
        editor: { lineNumbers: true },
      });
    });

    it("clears a narrower override so a wider save takes effect", () => {
      replaceAppearanceLayer("device", { theme: "excel" });
      const baseline = getAppearance();
      expect(baseline.theme).toBe("excel");
      commitAppearance({ ...baseline, theme: "light" }, baseline, "global");
      expect(getAppearanceLayer("global")).toEqual({ theme: "light" });
      expect(getAppearanceLayer("device")).toEqual({});
      expect(getAppearance().theme).toBe("light");
    });

    it("drops an override that now matches the wider width", () => {
      replaceAppearanceLayer("global", { theme: "light" });
      replaceAppearanceLayer("device", { theme: "excel" });
      const baseline = getAppearance();
      // What "Reset → Everyone's settings" then Save-on-device does.
      commitAppearance({ ...baseline, theme: "light" }, baseline, "device");
      expect(getAppearanceLayer("device")).toEqual({});
      expect(getAppearance().theme).toBe("light");
    });

    it("keeps the live achievement progress the dialog can't edit", () => {
      replaceAppearanceLayer("global", { achievements: { first: 1 } });
      const baseline = getAppearance();
      commitAppearance(
        { ...baseline, achievements: {}, theme: "light" },
        baseline,
        "device",
      );
      expect(getAppearance().achievements).toEqual({ first: 1 });
    });
  });

  it("keeps a quick toggle at the width already managing that setting", () => {
    replaceAppearanceLayer("global", { theme: "light" });
    replaceAppearanceLayer("device", { fontScale: 1.25 });
    updateAppearance("theme", "monokai");
    expect(getAppearanceLayer("global")).toEqual({ theme: "monokai" });
    updateAppearance("fontScale", 1.2);
    expect(getAppearanceLayer("device")).toEqual({ fontScale: 1.2 });
  });

  it("appearanceThroughScope answers what a Reset would load", () => {
    replaceAppearanceLayer("global", { theme: "light" });
    replaceAppearanceLayer("namespace", { theme: "monokai" });
    replaceAppearanceLayer("device", { theme: "excel" });
    expect(appearanceThroughScope("global").theme).toBe("light");
    expect(appearanceThroughScope("namespace").theme).toBe("monokai");
    expect(appearanceThroughScope("device").theme).toBe("excel");
  });

  it("coerces a stale or hostile remote layer instead of crashing", () => {
    replaceAppearanceLayer("global", {
      theme: "not-a-theme",
      fontScale: "big",
    });
    expect(getAppearance().theme).toBe(DEFAULT_APPEARANCE.theme);
    expect(getAppearance().fontScale).toBe(DEFAULT_APPEARANCE.fontScale);
    replaceAppearanceLayer("global", "nonsense");
    expect(getAppearanceLayers().global).toEqual({});
  });
});
