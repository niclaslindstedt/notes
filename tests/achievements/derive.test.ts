import { describe, expect, it } from "vitest";

import { deriveUnlocks } from "../../src/achievements/derive.ts";
import { ACHIEVEMENTS } from "../../src/achievements/catalog.ts";
import type { AchState } from "../../src/achievements/types.ts";
import {
  createNote,
  emptySnapshot,
  type Snapshot,
} from "../../src/domain/note.ts";
import {
  DEFAULT_APPEARANCE,
  type Appearance,
} from "../../src/theme/useTheme.ts";

function state(
  snapshot: Snapshot,
  appearance: Appearance = DEFAULT_APPEARANCE,
): AchState {
  return { snapshot, appearance };
}

const noteWith = (body: string): Snapshot => ({
  notes: [{ ...createNote(0), body }],
});

describe("deriveUnlocks", () => {
  it("unlocks firstNote on the empty → first-note transition", () => {
    const fresh = deriveUnlocks(
      state(emptySnapshot()),
      state(noteWith("hello")),
      {},
    );
    expect(fresh).toContain("firstNote");
  });

  it("does not re-unlock something already in the unlocked map", () => {
    const fresh = deriveUnlocks(
      state(emptySnapshot()),
      state(noteWith("hello")),
      { firstNote: 1 },
    );
    expect(fresh).not.toContain("firstNote");
  });

  it("unlocks wordsmith only once a note spans two non-empty lines", () => {
    const oneLine = deriveUnlocks(
      state(emptySnapshot()),
      state(noteWith("just a title")),
      {},
    );
    expect(oneLine).not.toContain("wordsmith");

    const twoLines = deriveUnlocks(
      state(noteWith("just a title")),
      state(noteWith("title\nand a body")),
      { firstNote: 1 },
    );
    expect(twoLines).toContain("wordsmith");
  });

  it("unlocks interiorDesigner on a theme change", () => {
    const fresh = deriveUnlocks(
      state(emptySnapshot(), { ...DEFAULT_APPEARANCE, theme: "dark" }),
      state(emptySnapshot(), { ...DEFAULT_APPEARANCE, theme: "light" }),
      {},
    );
    expect(fresh).toContain("interiorDesigner");
  });

  it("skips appearance predicates when only the snapshot changed", () => {
    // Same appearance reference on both sides — the slices pre-check must keep
    // the theme/font predicates from firing on a note-only edit.
    const appearance = { ...DEFAULT_APPEARANCE };
    const fresh = deriveUnlocks(
      state(emptySnapshot(), appearance),
      state(noteWith("hello"), appearance),
      {},
    );
    expect(fresh).toContain("firstNote");
    expect(fresh).not.toContain("interiorDesigner");
    expect(fresh).not.toContain("fontFanatic");
  });

  it("unlocks collector when the note count crosses five", () => {
    const four: Snapshot = {
      notes: Array.from({ length: 4 }, () => createNote(0)),
    };
    const five: Snapshot = {
      notes: Array.from({ length: 5 }, () => createNote(0)),
    };
    const fresh = deriveUnlocks(state(four), state(five), { firstNote: 1 });
    expect(fresh).toContain("collector");
  });

  it("unlocks completionist once every other achievement is unlocked", () => {
    const others = ACHIEVEMENTS.filter((a) => a.id !== "completionist");
    const prevMap: Record<string, number> = {};
    for (const a of others.slice(0, others.length - 1)) prevMap[a.id] = 1;
    const nextMap: Record<string, number> = {};
    for (const a of others) nextMap[a.id] = 1;

    const fresh = deriveUnlocks(
      state(emptySnapshot(), { ...DEFAULT_APPEARANCE, achievements: prevMap }),
      state(emptySnapshot(), { ...DEFAULT_APPEARANCE, achievements: nextMap }),
      nextMap,
    );
    expect(fresh).toContain("completionist");
  });

  it("ignores manual-trigger achievements", () => {
    // homeScreen is manual — no state transition can derive it.
    const fresh = deriveUnlocks(
      state(emptySnapshot()),
      state(noteWith("hello")),
      {},
    );
    expect(fresh).not.toContain("homeScreen");
  });
});
