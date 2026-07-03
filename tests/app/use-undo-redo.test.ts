// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  DOC_SCOPE,
  mergeDocSnapshot,
  nextEditRun,
  useUndoRedo,
  type EditRun,
} from "../../src/app/use-undo-redo.ts";
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

// Mount the hook with an `apply` that records the (scope, snapshot) pairs it's
// handed, mirroring how `useNotes` feeds stepped-to entries back into the sync
// engine. `activeScope` is a rerenderable prop so a test can "switch notes".
function mount(activeScope: string = DOC_SCOPE) {
  const applied: { scope: string; snapshot: Snapshot }[] = [];
  const view = renderHook(
    (scope: string) =>
      useUndoRedo({
        activeScope: scope,
        apply: (s, snapshot) => applied.push({ scope: s, snapshot }),
      }),
    { initialProps: activeScope },
  );
  const last = () => applied[applied.length - 1]!;
  const rec = (
    scope: string,
    before: Snapshot,
    after: Snapshot,
    label = "Edited note",
    mergeKey: string | null = null,
  ) =>
    act(() =>
      view.result.current.record({ scope, before, after, label, mergeKey }),
    );
  return { view, applied, last, rec };
}

describe("useUndoRedo", () => {
  it("starts with nothing to undo or redo", () => {
    const { view } = mount();
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("undoes a recorded edit back to the prior snapshot", () => {
    const { view, last, rec } = mount();
    rec(DOC_SCOPE, snap("a"), snap("a", "b"), "New note");
    expect(view.result.current.canUndo).toBe(true);
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual(["a"]);
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(true);
  });

  it("returns the label of the action it reverted / re-applied", () => {
    const { view, rec } = mount();
    rec(DOC_SCOPE, snap("a"), snap(), "Deleted note “a”");
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
    const { view } = mount();
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
    const { view, applied, rec } = mount();
    rec(DOC_SCOPE, snap("a"), snap("a", "b"), "New note");
    act(() => view.result.current.undo());
    act(() => view.result.current.redo());
    expect(applied.map((a) => tagsOf(a.snapshot))).toEqual([["a"], ["a", "b"]]);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("drops the redo branch when a new edit is recorded after an undo", () => {
    const { view, rec } = mount();
    rec(DOC_SCOPE, snap("a"), snap("a", "b"), "New note");
    act(() => view.result.current.undo());
    expect(view.result.current.canRedo).toBe(true);
    rec(DOC_SCOPE, snap("a"), snap("a", "c"), "New note");
    expect(view.result.current.canRedo).toBe(false);
  });

  it("reset drops every timeline", () => {
    const { view, rec } = mount();
    rec(DOC_SCOPE, snap("a"), snap("a", "b"), "New note");
    act(() => view.result.current.reset());
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(false);
  });

  it("coalesces continuous edits sharing a merge key into one undo step", () => {
    const { view, last, rec } = mount("a");
    // Three keystrokes in note "a": each records with the same key, so they
    // collapse to a single timeline entry rather than three.
    rec("a", snap("a"), snap("ab"), "Edited note", "edit:a:0:0");
    rec("a", snap("ab"), snap("abc"), "Edited note", "edit:a:0:0");
    rec("a", snap("abc"), snap("abcd"), "Edited note", "edit:a:0:0");
    expect(view.result.current.canUndo).toBe(true);
    // A single undo jumps straight back past the whole editing session.
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual(["a"]);
    expect(view.result.current.canUndo).toBe(false);
  });

  it("scopes undo/redo per note — switching notes switches the timeline", () => {
    const { view, last, rec } = mount("a");
    // Edit note "a", then note "b" (each on its own scope's timeline).
    rec("a", snap("a0"), snap("a1"), "Edited note");
    rec("b", snap("a1"), snap("b1"), "Edited note");
    // Looking at "a": undo walks a's timeline back to its seed.
    expect(view.result.current.canUndo).toBe(true);
    act(() => view.result.current.undo());
    expect(last().scope).toBe("a");
    expect(tagsOf(last().snapshot)).toEqual(["a0"]);
    // a is now exhausted, but b's timeline is untouched.
    expect(view.result.current.canUndo).toBe(false);
    // Switch to note "b": its own history is available again.
    view.rerender("b");
    expect(view.result.current.canUndo).toBe(true);
    act(() => view.result.current.undo());
    expect(last().scope).toBe("b");
    expect(tagsOf(last().snapshot)).toEqual(["a1"]);
  });

  it("walks a paragraph back sentence by sentence via per-sentence keys", () => {
    // Mirrors how `useNotes.update` composes `edit:<id>:<run>:<sentence-count>`:
    // the key holds steady while a sentence is typed (those records coalesce)
    // and changes once it's finished, so each completed sentence is its own step.
    const { view, last, rec } = mount("x");
    let prev = snap("");
    const type = (body: string, sentences: number) => {
      const after = snap(body);
      rec("x", prev, after, "Edited note", `edit:x:0:${sentences}`);
      prev = after;
    };
    type("One", 0);
    type("One.", 0);
    type("One. ", 1); // first sentence finished — new checkpoint
    type("One. Two", 1);
    type("One. Two.", 1);
    type("One. Two. ", 2); // second sentence finished
    type("One. Two. Three", 2);

    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual(["One. Two."]);
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual(["One."]);
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual([""]);
    expect(view.result.current.canUndo).toBe(false);
  });

  it("keeps type → erase → retype as three undo steps (the run counter)", () => {
    // End-to-end shape of the reported bug: composing the merge key the way
    // `useNotes.update` does (run counter from `nextEditRun` + sentence count)
    // means erasing what you typed is its own checkpoint, so a later edit can't
    // swallow it.
    const { view, last, rec } = mount("x");
    let prev = snap("");
    let run: EditRun | undefined;
    const edit = (body: string) => {
      run = nextEditRun(run, body.length);
      const after = snap(body);
      rec("x", prev, after, "Edited note", `edit:x:${run.run}:0`);
      prev = after;
    };
    // Type "hello", erase it all, then type "world".
    for (const b of ["h", "he", "hel", "hell", "hello"]) edit(b);
    for (const b of ["hell", "hel", "he", "h", ""]) edit(b);
    for (const b of ["w", "wo", "wor", "worl", "world"]) edit(b);

    // Undo peels back "world", then the erase (to empty), then "hello".
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual([""]);
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual(["hello"]);
    act(() => view.result.current.undo());
    expect(tagsOf(last().snapshot)).toEqual([""]);
  });

  it("has nothing to undo in a note that hasn't been edited this session", () => {
    const { view, rec } = mount("a");
    rec("a", snap("a0"), snap("a1"), "Edited note");
    // Open a different, untouched note: its timeline is empty, so undo is inert.
    view.rerender("untouched");
    expect(view.result.current.canUndo).toBe(false);
    act(() => view.result.current.undo());
    expect(view.result.current.canRedo).toBe(false);
  });
});

describe("nextEditRun", () => {
  const run = (...lens: number[]): EditRun[] => {
    const out: EditRun[] = [];
    let prev: EditRun | undefined;
    for (const len of lens) {
      prev = nextEditRun(prev, len);
      out.push(prev);
    }
    return out;
  };

  it("keeps one run for an uninterrupted typing burst", () => {
    // Growing length throughout: one run, so keystrokes coalesce.
    expect(run(1, 2, 3, 4).map((r) => r.run)).toEqual([0, 0, 0, 0]);
  });

  it("keeps one run while erasing", () => {
    expect(run(5, 4, 3, 2).map((r) => r.run)).toEqual([0, 0, 0, 0]);
  });

  it("bumps the run when typing reverses to erasing and back", () => {
    // type (1→3), erase (3→0), retype (0→2): three runs, so the erase can't be
    // swallowed into the surrounding typing — the reported bug.
    expect(run(1, 2, 3, 2, 1, 0, 1, 2).map((r) => r.run)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2,
    ]);
  });

  it("treats a same-length replace as a continuation", () => {
    expect(run(3, 4, 4, 5).map((r) => r.run)).toEqual([0, 0, 0, 0]);
  });
});

describe("mergeDocSnapshot", () => {
  it("restores a deleted note from the target while keeping current bodies", () => {
    // Undo of "delete B" after A was edited afterwards: B comes back, but A
    // keeps the body it has now rather than reverting to the delete-time one.
    const cur: Snapshot = {
      notes: [{ ...note("x"), id: "A", body: "A-edited" }],
    };
    const target: Snapshot = {
      notes: [
        { ...note("x"), id: "A", body: "A-old" },
        { ...note("x"), id: "B", body: "B" },
      ],
    };
    const merged = mergeDocSnapshot(cur, target);
    expect(merged.notes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(merged.notes.find((n) => n.id === "A")!.body).toBe("A-edited");
    expect(merged.notes.find((n) => n.id === "B")!.body).toBe("B");
  });

  it("restores structural fields (archived / folderId) from the target", () => {
    const cur: Snapshot = {
      notes: [{ ...note("x"), id: "A", archived: true, folderId: "f1" }],
    };
    const target: Snapshot = {
      notes: [{ ...note("x"), id: "A", archived: false }],
    };
    const merged = mergeDocSnapshot(cur, target);
    const a = merged.notes.find((n) => n.id === "A")!;
    expect(a.archived).toBe(false);
    expect(a.folderId).toBeUndefined();
  });

  it("drops a note that exists only in the current doc (undo of a create)", () => {
    const cur: Snapshot = { notes: [note("A"), note("new")] };
    const target: Snapshot = { notes: [note("A")] };
    expect(mergeDocSnapshot(cur, target).notes.map((n) => n.body)).toEqual([
      "A",
    ]);
  });
});
