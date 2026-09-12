// @vitest-environment jsdom
//
// The whole loop the "Remove attachment from <backend> too?" prompt exists for,
// driven through the notes store the editor actually binds to: erase the
// reference → get asked → keep the file → paste the reference back and have the
// attachment work again.

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";

import { useNotes } from "../../src/app/use-notes.ts";
import {
  referencedAttachments,
  type Attachment,
} from "../../src/domain/attachment.ts";
import type { Note, Snapshot } from "../../src/domain/note.ts";
import type { StorageAdapter } from "../../src/storage/adapter.ts";
import { serialize } from "../../src/storage/serialize.ts";

const PIC: Attachment = {
  filename: "pic.png",
  mime: "image/png",
  data: "data:image/png;base64,AAA",
};
const REF = "![pic](attachments/pic.png)";
// Comfortably past the hook's 1.5s quiet period.
const SETTLE_WAIT_MS = 1700;

function seedNote(): Note {
  return {
    id: "n1",
    title: "Trip",
    body: `intro\n${REF}`,
    attachments: [PIC],
    createdAt: 0,
    updatedAt: 0,
  };
}

// A backend that holds attachment files (the folder / cloud shape) unless the
// test asks for one that doesn't (the local "This device" shape).
function adapterFor(stores: boolean, saves: string[]): StorageAdapter {
  const snapshot: Snapshot = { notes: [seedNote()] };
  return {
    id: stores ? "dropbox" : "browser",
    label: "mem",
    capabilities: new Set(
      stores ? (["loadSync", "attachments"] as const) : (["loadSync"] as const),
    ),
    loadSync: () => ({ text: serialize(snapshot), revision: "r1" }),
    load: async () => ({ text: serialize(snapshot), revision: "r1" }),
    save: async (text: string) => {
      saves.push(text);
      return { text, revision: "r2" };
    },
    saveDebounceMs: 0,
  };
}

function mount(stores = true) {
  const saves: string[] = [];
  // One adapter instance for the life of the hook — a fresh object per render
  // would re-run the sync engine's effects forever.
  const adapter = adapterFor(stores, saves);
  const view = renderHook(() => useNotes(adapter));
  const store = () => view.result.current;
  const note = () => store().allNotes.find((n) => n.id === "n1")!;
  const type = (body: string) => act(() => store().update("n1", body));
  // Real time, not a fake clock: the sync engine behind `useNotes` runs its own
  // timers, and winding those forward spins its poll loop.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
    });
  return { saves, store, note, type, settle };
}

describe("useNotes — erasing an attachment", () => {
  it("keeps the attachment on the note and asks once the note falls quiet", async () => {
    const { store, note, type, settle } = mount();
    type("intro");
    // The keystroke itself neither asks nor drops anything.
    expect(store().erasedAttachments).toBeNull();
    expect(note().attachments).toEqual([PIC]);

    await settle();
    expect(store().erasedAttachments?.noteId).toBe("n1");
    expect(
      store().erasedAttachments?.attachments.map((a) => a.filename),
    ).toEqual(["pic.png"]);
  });

  it("answering “keep” leaves the file alone and a re-pasted link works", async () => {
    const { store, note, type, settle } = mount();
    type("intro");
    await settle();
    act(() => store().resolveErasedAttachments(false));

    // The record survives, unreferenced — which is what keeps the file on the
    // backend — but nothing in the note resolves to it.
    expect(note().attachments).toEqual([PIC]);
    expect(
      referencedAttachments(note().body ?? "", note().attachments),
    ).toEqual([]);

    // Pasting the reference back is an ordinary edit, and the attachment is
    // there to resolve — bytes and all — without a reload or a re-upload.
    type(`intro\n${REF}`);
    expect(
      referencedAttachments(note().body ?? "", note().attachments),
    ).toEqual([PIC]);
    await settle();
    expect(store().erasedAttachments).toBeNull();
  });

  it("answering “remove” drops the record so the save reconciles the file away", async () => {
    const { store, note, type, settle } = mount();
    type("intro");
    await settle();
    const stampedByTheEdit = note().updatedAt;
    act(() => store().resolveErasedAttachments(true));

    expect(note().attachments).toBeUndefined();
    expect(store().erasedAttachments).toBeNull();
    // Answering a question about a file is not an edit of the text, so the note
    // keeps its place in the most-recently-edited ordering.
    expect(note().updatedAt).toBe(stampedByTheEdit);
  });

  it("asks nothing on a backend that stores no attachment files", async () => {
    const { store, note, type, settle } = mount(false);
    type("intro");
    await settle();
    expect(store().erasedAttachments).toBeNull();
    expect(note().attachments).toBeUndefined();
  });
});
