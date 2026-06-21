// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOLDER_PLACEMENT,
  DEFAULT_NOTE_SORT_KEY,
  isFolderPlacement,
  isNoteSortKey,
} from "../../src/theme/themes.ts";
import { getAppearance, replaceAppearance } from "../../src/theme/useTheme.ts";

describe("sidebar layout helpers", () => {
  it("recognises only the known folder placements", () => {
    expect(isFolderPlacement("top")).toBe(true);
    expect(isFolderPlacement("mixed")).toBe(true);
    expect(isFolderPlacement("bottom")).toBe(false);
    expect(isFolderPlacement(1)).toBe(false);
  });

  it("recognises only the known sort keys", () => {
    expect(isNoteSortKey("modified")).toBe(true);
    expect(isNoteSortKey("name")).toBe(true);
    expect(isNoteSortKey("created")).toBe(false);
  });

  it("defaults folders on top, sorted by last modified", () => {
    expect(DEFAULT_FOLDER_PLACEMENT).toBe("top");
    expect(DEFAULT_NOTE_SORT_KEY).toBe("modified");
  });
});

describe("appearance coercion of sidebar settings", () => {
  it("fills the defaults when the stored document omits them", () => {
    replaceAppearance({ theme: "light" });
    expect(getAppearance().folderPlacement).toBe(DEFAULT_FOLDER_PLACEMENT);
    expect(getAppearance().noteSortKey).toBe(DEFAULT_NOTE_SORT_KEY);
  });

  it("keeps valid values and repairs invalid ones", () => {
    replaceAppearance({ folderPlacement: "mixed", noteSortKey: "name" });
    expect(getAppearance().folderPlacement).toBe("mixed");
    expect(getAppearance().noteSortKey).toBe("name");
    replaceAppearance({ folderPlacement: "sideways", noteSortKey: "size" });
    expect(getAppearance().folderPlacement).toBe(DEFAULT_FOLDER_PLACEMENT);
    expect(getAppearance().noteSortKey).toBe(DEFAULT_NOTE_SORT_KEY);
  });
});
