// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/preact";

import { useAttachmentErasure } from "../../src/app/use-attachment-erasure.ts";
import type { Attachment } from "../../src/domain/attachment.ts";
import type { Note } from "../../src/domain/note.ts";

const PIC: Attachment = { filename: "pic.png", mime: "image/png" };
const DOC: Attachment = { filename: "spec.pdf", mime: "application/pdf" };

const WITH_BOTH = "![pic](attachments/pic.png)\n[spec](attachments/spec.pdf)";

function note(body: string | undefined, attachments = [PIC, DOC]): Note {
  return {
    id: "n1",
    title: "",
    body,
    attachments,
    createdAt: 0,
    updatedAt: 0,
  };
}

// Mount the hook over a one-note document the test drives directly: `doc.note`
// is what `noteById` answers with, so a test can simulate the edit landing in
// the store before the settle timer fires.
function mount(stores = true) {
  const doc = { note: note(WITH_BOTH) };
  const pruned: { noteId: string; filenames: string[] }[] = [];
  const view = renderHook(() =>
    useAttachmentErasure({
      stores,
      noteById: (id) => (id === doc.note.id ? doc.note : undefined),
      prune: (noteId, filenames) =>
        pruned.push({ noteId, filenames: [...filenames] }),
    }),
  );
  // Apply a body edit the way `useNotes` does: swap the document, then report
  // the note as it stood before.
  const edit = (body: string) => {
    const before = doc.note;
    doc.note = { ...before, body };
    act(() => view.result.current.observe(before, body));
  };
  return { doc, pruned, view, edit, hook: () => view.result.current };
}

const settle = () => act(() => void vi.advanceTimersByTime(2000));

describe("useAttachmentErasure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks nothing until the note falls quiet", () => {
    const { hook, edit } = mount();
    edit("![pic](attachments/pic.png)");
    // Mid-erase: the reference is gone but the user is still typing.
    expect(hook().prompt).toBeNull();
    act(() => void vi.advanceTimersByTime(1000));
    expect(hook().prompt).toBeNull();
    settle();
    expect(hook().prompt?.attachments.map((a) => a.filename)).toEqual([
      "spec.pdf",
    ]);
  });

  it("never asks when the reference is put back before the note settles", () => {
    const { hook, edit } = mount();
    edit("![pic](attachments/pic.png)");
    act(() => void vi.advanceTimersByTime(1000));
    edit(WITH_BOTH);
    settle();
    expect(hook().prompt).toBeNull();
  });

  it("asks about every attachment one edit erased, in one question", () => {
    const { hook, edit } = mount();
    edit("nothing but words");
    settle();
    expect(hook().prompt?.attachments.map((a) => a.filename)).toEqual([
      "pic.png",
      "spec.pdf",
    ]);
  });

  it("prunes the attachment when the answer is yes", () => {
    const { hook, pruned, edit } = mount();
    edit("![pic](attachments/pic.png)");
    settle();
    act(() => hook().resolve(true));
    expect(pruned).toEqual([{ noteId: "n1", filenames: ["spec.pdf"] }]);
    expect(hook().prompt).toBeNull();
  });

  it("keeps the file — and never re-asks — when the answer is no", () => {
    const { hook, pruned, edit } = mount();
    edit("![pic](attachments/pic.png)");
    settle();
    act(() => hook().resolve(false));
    expect(pruned).toEqual([]);
    expect(hook().prompt).toBeNull();

    // The attachment stays on the note, unreferenced. Typing on around it must
    // not raise the same question a second time.
    edit("![pic](attachments/pic.png)\nmore text");
    settle();
    expect(hook().prompt).toBeNull();

    // …and pasting the reference back is an ordinary edit that asks nothing.
    edit(WITH_BOTH);
    settle();
    expect(hook().prompt).toBeNull();
  });

  it("does not delete a file whose reference came back before the answer", () => {
    const { hook, pruned, edit, doc } = mount();
    edit("![pic](attachments/pic.png)");
    settle();
    expect(hook().prompt).not.toBeNull();
    // An undo lands while the question is on screen.
    doc.note = { ...doc.note, body: WITH_BOTH };
    act(() => hook().resolve(true));
    expect(pruned).toEqual([]);
  });

  it("drops the record without asking on a backend that stores no files", () => {
    const { hook, pruned, edit } = mount(false);
    edit("![pic](attachments/pic.png)");
    settle();
    expect(hook().prompt).toBeNull();
    expect(pruned).toEqual([{ noteId: "n1", filenames: ["spec.pdf"] }]);
  });

  it("forgets a deleted note's pending question", () => {
    const { hook, edit } = mount();
    edit("![pic](attachments/pic.png)");
    settle();
    expect(hook().prompt).not.toBeNull();
    act(() => hook().forget("n1"));
    expect(hook().prompt).toBeNull();
  });

  it("ignores an edit to a deferred note", () => {
    const { hook, view, pruned } = mount();
    act(() => view.result.current.observe(note(undefined), "anything"));
    settle();
    expect(hook().prompt).toBeNull();
    expect(pruned).toEqual([]);
  });
});
