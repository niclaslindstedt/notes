// @vitest-environment jsdom
//
// Deleting and cutting an image, through the notes store the editor binds to.
// The two gestures make the same edit to the text and opposite promises about
// the file: Delete takes it now, Cut holds it for the paste and — if the paste
// never comes — takes it at the next start. Neither ever raises the "remove it
// from <backend> too?" question, because picking one of them *is* the answer.

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";

import { pendingCuts } from "../../src/app/attachment-cuts.ts";
import { useNotes } from "../../src/app/use-notes.ts";
import type { Attachment } from "../../src/domain/attachment.ts";
import type { Note, Snapshot } from "../../src/domain/note.ts";
import type { StorageAdapter } from "../../src/storage/adapter.ts";
import { serialize } from "../../src/storage/serialize.ts";

const PIC: Attachment = {
  filename: "pic.png",
  mime: "image/png",
  data: "data:image/png;base64,AAA",
};
const REF = "![pic](attachments/pic.png)";
/** Comfortably past the erasure hook's 1.5s quiet period. */
const SETTLE_WAIT_MS = 1700;

function seedNote(): Note {
  return {
    id: "n1",
    title: "Trip",
    body: `intro\n${REF}\n\nend`,
    attachments: [PIC],
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * A backend that keeps attachment files and remembers what it was handed, so a
 * second mount reads back whatever the first one saved — which is what "the
 * next time you open the app" means here.
 */
function backend() {
  let stored = serialize({ notes: [seedNote()] } satisfies Snapshot);
  const adapter: StorageAdapter = {
    id: "dropbox",
    label: "mem",
    capabilities: new Set(["loadSync", "attachments"] as const),
    loadSync: () => ({ text: stored, revision: "r1" }),
    load: async () => ({ text: stored, revision: "r1" }),
    save: async (text: string) => {
      stored = text;
      return { text, revision: "r2" };
    },
    saveDebounceMs: 0,
  };
  return { adapter, saved: () => stored };
}

function mount(adapter: StorageAdapter) {
  // With the note open, undo acts on the note's own timeline — which is what
  // the editor does whenever an image can be selected in the first place.
  const view = renderHook(() => useNotes(adapter, undefined, "n1"));
  const store = () => view.result.current;
  const note = () => store().allNotes.find((n) => n.id === "n1");
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
    });
  const tick = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  return { view, store, note, settle, tick };
}

describe("useNotes — deleting an attachment", () => {
  beforeEach(() => localStorage.clear());

  it("takes the reference and the record in one step, asking nothing", async () => {
    const { adapter } = backend();
    const { store, note, settle } = mount(adapter);
    act(() => store().deleteAttachment("n1", "pic.png"));

    expect(note()?.body).toBe("intro\nend");
    expect(note()?.attachments).toBeUndefined();
    await settle();
    expect(store().erasedAttachments).toBeNull();
  });

  it("undoes as a single step, text and attachment together", async () => {
    const { adapter } = backend();
    const { store, note } = mount(adapter);
    act(() => store().deleteAttachment("n1", "pic.png"));
    act(() => store().undo());

    expect(note()?.body).toBe(`intro\n${REF}\n\nend`);
    expect(note()?.attachments).toEqual([PIC]);
  });
});

describe("useNotes — cutting an attachment", () => {
  beforeEach(() => localStorage.clear());

  it("takes the reference but keeps the file, and asks nothing", async () => {
    const { adapter } = backend();
    const { store, note, settle } = mount(adapter);
    act(() => store().cutAttachment("n1", "pic.png"));

    expect(note()?.body).toBe("intro\nend");
    // The record stays — which is what keeps the file on the backend, so the
    // paste has something to land on.
    expect(note()?.attachments).toEqual([PIC]);
    expect(pendingCuts().map((c) => c.filename)).toEqual(["pic.png"]);

    await settle();
    expect(store().erasedAttachments).toBeNull();
  });

  it("forgets the cut once the reference is pasted back", async () => {
    const { adapter } = backend();
    const { store, note } = mount(adapter);
    act(() => store().cutAttachment("n1", "pic.png"));
    act(() => store().update("n1", `intro\n${REF}\nend`));

    expect(pendingCuts()).toEqual([]);
    expect(note()?.attachments).toEqual([PIC]);
  });

  it("asks again if the pasted-back reference is then erased by hand", async () => {
    const { adapter } = backend();
    const { store, settle } = mount(adapter);
    act(() => store().cutAttachment("n1", "pic.png"));
    act(() => store().update("n1", `intro\n${REF}\nend`));
    act(() => store().update("n1", "intro\nend"));

    await settle();
    expect(
      store().erasedAttachments?.attachments.map((a) => a.filename),
    ).toEqual(["pic.png"]);
  });

  it("deletes a cut nothing claimed, at the next start", async () => {
    const { adapter } = backend();
    const first = mount(adapter);
    act(() => first.store().cutAttachment("n1", "pic.png"));
    await first.tick();
    first.view.unmount();

    // Next start: the mark is still there, the note still doesn't reference
    // the picture — so the file the cut was holding on to goes.
    expect(pendingCuts()).toHaveLength(1);
    const second = mount(adapter);
    await second.tick();
    expect(second.note()?.attachments).toBeUndefined();
    expect(pendingCuts()).toEqual([]);
  });
});
