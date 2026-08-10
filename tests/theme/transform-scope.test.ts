// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { getAppearance, replaceAppearance } from "../../src/theme/useTheme.ts";

// Transform rules carry the namespace they run in. The appearance document is
// shared by every namespace (one `settings.json` at the app-folder root), so
// this coercion is what keeps a rule pointed at the notes it was written for —
// and what makes a rule written before scoping existed keep running everywhere.
describe("appearance coercion of a transform rule's namespace", () => {
  it("reads a rule with no namespace as running everywhere", () => {
    replaceAppearance({
      transforms: [{ id: "r1", pattern: "#(\\d+)" }],
    });
    expect(getAppearance().transforms[0]!.namespace).toBeNull();
  });

  it("keeps the namespace a scoped rule names", () => {
    replaceAppearance({
      transforms: [{ id: "r1", pattern: "#(\\d+)", namespace: "work" }],
    });
    expect(getAppearance().transforms[0]!.namespace).toBe("work");
  });

  it("treats a blank or non-string namespace as every namespace", () => {
    replaceAppearance({
      transforms: [
        { id: "r1", pattern: "a", namespace: "" },
        { id: "r2", pattern: "b", namespace: 7 },
      ],
    });
    expect(getAppearance().transforms.map((r) => r.namespace)).toEqual([
      null,
      null,
    ]);
  });
});
