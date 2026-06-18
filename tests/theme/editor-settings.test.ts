// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_SETTINGS,
  editorMarginMaxWidth,
  isEditorMargin,
} from "../../src/theme/themes.ts";
import { getAppearance, replaceAppearance } from "../../src/theme/useTheme.ts";

describe("editor margin helpers", () => {
  it("recognises only the known margin ids", () => {
    expect(isEditorMargin("none")).toBe(true);
    expect(isEditorMargin("lg")).toBe(true);
    expect(isEditorMargin("huge")).toBe(false);
    expect(isEditorMargin(2)).toBe(false);
  });

  it("maps each margin to a max width, full-bleed for none", () => {
    expect(editorMarginMaxWidth("none")).toBe("none");
    expect(editorMarginMaxWidth("lg")).toBe("32rem");
  });

  it("defaults to a full-width, wrapping, Markdown-on editor", () => {
    expect(DEFAULT_EDITOR_SETTINGS).toEqual({
      margin: "none",
      wordWrap: true,
      renderMarkdown: true,
    });
  });
});

describe("appearance coercion of editor settings", () => {
  it("fills editor defaults when the stored document omits them", () => {
    replaceAppearance({ theme: "light" });
    expect(getAppearance().editor).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it("keeps valid editor fields and repairs invalid ones", () => {
    replaceAppearance({
      editor: { margin: "md", wordWrap: false, renderMarkdown: "yes" },
    });
    const { editor } = getAppearance();
    expect(editor.margin).toBe("md");
    expect(editor.wordWrap).toBe(false);
    // A non-boolean renderMarkdown falls back to the default.
    expect(editor.renderMarkdown).toBe(true);
  });
});
