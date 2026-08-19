import { describe, expect, it } from "vitest";

import {
  changedPaths,
  deletePath,
  getPath,
  hasPath,
  isEmptyLayer,
  jsonEqual,
  leafPaths,
  mergeLayers,
  omitPaths,
  pickPaths,
  setPath,
} from "../../src/domain/settings-layers.ts";

describe("settings layers", () => {
  describe("mergeLayers", () => {
    it("lets a later layer win leaf by leaf", () => {
      expect(mergeLayers({ a: 1, b: 2 }, { b: 3 }, { c: 4 })).toEqual({
        a: 1,
        b: 3,
        c: 4,
      });
    });

    it("merges a branch present in both instead of replacing it", () => {
      // The whole point of sparse layers: a device opinion about one editor
      // toggle must not freeze every other editor setting.
      expect(
        mergeLayers(
          { editor: { wordWrap: true, lineNumbers: false } },
          { editor: { lineNumbers: true } },
        ),
      ).toEqual({ editor: { wordWrap: true, lineNumbers: true } });
    });

    it("treats an array as a value, not a branch", () => {
      expect(mergeLayers({ xs: [1, 2, 3] }, { xs: [9] })).toEqual({ xs: [9] });
    });

    it("does not mutate its inputs", () => {
      const base = { editor: { wordWrap: true } };
      mergeLayers(base, { editor: { wordWrap: false } });
      expect(base.editor.wordWrap).toBe(true);
    });
  });

  describe("leafPaths", () => {
    it("walks to the leaves, dotted", () => {
      expect(
        leafPaths({ theme: "dark", editor: { wordWrap: true } }).sort(),
      ).toEqual(["editor.wordWrap", "theme"]);
    });

    it("yields nothing for an empty branch — it holds no opinion", () => {
      expect(leafPaths({ editor: {} })).toEqual([]);
      expect(isEmptyLayer({ editor: {} })).toBe(true);
    });
  });

  describe("get / set / delete", () => {
    it("reads and writes through a dotted path", () => {
      const next = setPath({}, "editor.wordWrap", false);
      expect(next).toEqual({ editor: { wordWrap: false } });
      expect(getPath(next, "editor.wordWrap")).toBe(false);
      expect(getPath(next, "editor.missing")).toBeUndefined();
    });

    it("distinguishes a missing path from one set to undefined", () => {
      expect(
        hasPath({ editor: { wordWrap: undefined } }, "editor.wordWrap"),
      ).toBe(true);
      expect(hasPath({}, "editor.wordWrap")).toBe(false);
    });

    it("leaves siblings alone when setting", () => {
      const next = setPath(
        { editor: { wordWrap: true, lineNumbers: true } },
        "editor.wordWrap",
        false,
      );
      expect(next).toEqual({ editor: { wordWrap: false, lineNumbers: true } });
    });

    it("prunes the branch a delete empties, so the layer reads as empty", () => {
      const next = deletePath(
        { editor: { wordWrap: true } },
        "editor.wordWrap",
      );
      expect(next).toEqual({});
      expect(isEmptyLayer(next)).toBe(true);
    });

    it("keeps a branch that still has siblings", () => {
      expect(
        deletePath(
          { editor: { wordWrap: true, lineNumbers: true } },
          "editor.wordWrap",
        ),
      ).toEqual({ editor: { lineNumbers: true } });
    });

    it("is a no-op for a path that isn't there", () => {
      const layer = { theme: "dark" };
      expect(deletePath(layer, "editor.wordWrap")).toEqual(layer);
    });
  });

  describe("changedPaths", () => {
    it("names only the leaves that actually moved", () => {
      expect(
        changedPaths(
          { theme: "dark", editor: { wordWrap: true, lineNumbers: false } },
          { theme: "light", editor: { wordWrap: true, lineNumbers: false } },
        ),
      ).toEqual(["theme"]);
    });

    it("counts a leaf that appeared or disappeared", () => {
      expect(changedPaths({}, { theme: "dark" })).toEqual(["theme"]);
      expect(changedPaths({ theme: "dark" }, {})).toEqual(["theme"]);
    });

    it("compares arrays and objects structurally, not by identity", () => {
      expect(changedPaths({ xs: [1, 2] }, { xs: [1, 2] })).toEqual([]);
      expect(jsonEqual({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
      expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });
  });

  describe("pick / omit", () => {
    it("keeps only the named paths", () => {
      expect(
        pickPaths(
          { theme: "dark", editor: { wordWrap: true, lineNumbers: true } },
          ["theme", "editor.wordWrap", "nope"],
        ),
      ).toEqual({ theme: "dark", editor: { wordWrap: true } });
    });

    it("drops the named paths", () => {
      expect(
        omitPaths({ theme: "dark", editor: { wordWrap: true } }, [
          "editor.wordWrap",
        ]),
      ).toEqual({ theme: "dark" });
    });
  });
});
