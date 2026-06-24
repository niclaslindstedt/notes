// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useUndoRedo } from "../../src/app/use-undo-redo.ts";
import type { Note, Snapshot } from "../../src/domain/note.ts";

// A note whose body doubles as an easy-to-assert tag.
function note(tag: string): Note {
  return { id: tag, title: "", body: tag, createdAt: 0, updatedAt: 0 };
}

// A snapshot identified by the bodies of the notes it holds.
function snap(...tags: string[]): Snapshot {
  return { notes: tags.map(note) };
}

const tagsOf = (s: Snapshot): string[] => s.notes.map((n) => n.body ?? "");

// Mount the hook with a helper that records the latest snapshot pushed to
// `setData`, mirroring how `useNotes` feeds stepped-to documents back into
// the sync engine.
function mount(seed: Snapshot) {
  const applied: Snapshot[] = [];
  const view = renderHook(() =>
    useUndoRedo({ initialSeed: seed, setData: (s) => applied.push(s) }),
  );
  return { view, applied };
}

describe("useUndoRedo", () => {
  it("starts with nothing to undo or redo", () => {
    const { view } = mount(snap("a"));
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("undoes a recorded edit back to the prior snapshot", () => {
    const { view, applied } = mount(snap("a"));
    act(() => view.result.current.record(snap("a", "b"), "New note"));
    expect(view.result.current.canUndo).toBe(true);
    act(() => view.result.current.undo());
    expect(applied.map(tagsOf)).toEqual([["a"]]);
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(true);
  });

  it("returns the label of the action it reverted / re-applied", () => {
    const { view } = mount(snap("a"));
    act(() => view.result.current.record(snap(), "Deleted note “a”"));
    let undone: string | null = null;
    act(() => {
      undone = view.result.current.undo();
    });
    expect(undone).toBe("Deleted note “a”");
    let redone: string | null = null;
    act(() => {
      redone = view.result.current.redo();
    });
    expect(redone).toBe("Deleted note “a”");
  });

  it("returns null at the timeline edges (the no-op case)", () => {
    const { view } = mount(snap("a"));
    let undone: string | null = "x";
    let redone: string | null = "x";
    act(() => {
      undone = view.result.current.undo();
    });
    act(() => {
      redone = view.result.current.redo();
    });
    expect(undone).toBeNull();
    expect(redone).toBeNull();
  });

  it("redoes back to the undone snapshot", () => {
    const { view, applied } = mount(snap("a"));
    act(() => view.result.current.record(snap("a", "b"), "New note"));
    act(() => view.result.current.undo());
    act(() => view.result.current.redo());
    expect(applied.map(tagsOf)).toEqual([["a"], ["a", "b"]]);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("restores a note deleted by the recorded edit (undo brings it back)", () => {
    const { view, applied } = mount(snap("keep", "milk"));
    // User deletes "milk" — the post-edit snapshot has only "keep".
    act(() => view.result.current.record(snap("keep"), "Deleted note “milk”"));
    act(() => view.result.current.undo());
    expect(tagsOf(applied[0]!)).toEqual(["keep", "milk"]);
  });

  it("drops the redo branch when a new edit is recorded after an undo", () => {
    const { view } = mount(snap("a"));
    act(() => view.result.current.record(snap("a", "b"), "New note"));
    act(() => view.result.current.undo());
    expect(view.result.current.canRedo).toBe(true);
    act(() => view.result.current.record(snap("a", "c"), "New note"));
    expect(view.result.current.canRedo).toBe(false);
  });

  it("reset re-seeds the timeline and clears history", () => {
    const { view } = mount(snap("a"));
    act(() => view.result.current.record(snap("a", "b"), "New note"));
    act(() => view.result.current.reset(snap("z")));
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("coalesces continuous edits sharing a merge key into one undo step", () => {
    const { view, applied } = mount(snap("a"));
    // Three keystrokes in the same note: each records with the same key, so
    // they collapse to a single timeline entry rather than three.
    act(() => view.result.current.record(snap("ab"), "Edited note", "edit:a"));
    act(() => view.result.current.record(snap("abc"), "Edited note", "edit:a"));
    act(() =>
      view.result.current.record(snap("abcd"), "Edited note", "edit:a"),
    );
    expect(view.result.current.canUndo).toBe(true);
    // A single undo jumps straight back past the whole editing session.
    act(() => view.result.current.undo());
    expect(tagsOf(applied[applied.length - 1]!)).toEqual(["a"]);
    expect(view.result.current.canUndo).toBe(false);
  });

  it("does not coalesce edits to different keys", () => {
    const { view, applied } = mount(snap("a"));
    act(() => view.result.current.record(snap("ax"), "Edited note", "edit:a"));
    act(() => view.result.current.record(snap("ax", "b"), "New note"));
    act(() =>
      view.result.current.record(snap("ax", "by"), "Edited note", "edit:b"),
    );
    // Undo the "b" edit, then the "b" creation, then the "a" edit — three
    // distinct steps survive because the merge keys differ.
    act(() => view.result.current.undo());
    expect(tagsOf(applied[applied.length - 1]!)).toEqual(["ax", "b"]);
    act(() => view.result.current.undo());
    expect(tagsOf(applied[applied.length - 1]!)).toEqual(["ax"]);
    act(() => view.result.current.undo());
    expect(tagsOf(applied[applied.length - 1]!)).toEqual(["a"]);
    expect(view.result.current.canUndo).toBe(false);
  });

  it("is a no-op at the timeline edges", () => {
    const { applied, view } = mount(snap("a"));
    act(() => view.result.current.undo());
    act(() => view.result.current.redo());
    expect(applied).toHaveLength(0);
  });
});
