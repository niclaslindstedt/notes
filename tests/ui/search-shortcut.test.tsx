// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../../src/domain/note.ts";
import { SearchModalHost } from "../../src/app/modals/SearchModalHost.tsx";
import { ModalBusProvider } from "../../src/ui/ModalBusProvider.tsx";

afterEach(cleanup);

const snapshot: Snapshot = {
  notes: [
    {
      id: "1",
      title: "Grocery list",
      body: "milk, eggs",
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

function mount() {
  render(
    <ModalBusProvider>
      <SearchModalHost snapshot={snapshot} onOpen={vi.fn()} />
    </ModalBusProvider>,
  );
}

function pressFind(mods: KeyboardEventInit) {
  const e = new KeyboardEvent("keydown", {
    key: "f",
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  (document.activeElement ?? window).dispatchEvent(e);
  return e;
}

// ⌘⇧F / Ctrl+Shift+F is the same question as ⌘F asked wider: search every note
// rather than the one in front of you. It is bound by the modal's host rather
// than by the editor, so it answers from the list and the archive too.
describe("the ⌘⇧F / Ctrl+Shift+F shortcut", () => {
  it("opens the cross-note search modal, taking the key from the browser", () => {
    mount();
    expect(screen.queryByRole("searchbox")).toBeNull();

    const e = pressFind({ metaKey: true, shiftKey: true });

    expect(e.defaultPrevented).toBe(true);
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  it("answers Ctrl+Shift+F the same way", () => {
    mount();
    pressFind({ ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  // The unshifted key belongs to the open note's own find bar; this host must
  // not answer it, or the modal would cover the note being searched.
  it("leaves the unshifted ⌘F to the note's find bar", () => {
    mount();
    const e = pressFind({ metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  // Once the modal is up it is what you're looking at — and it has its own
  // field with the cursor already in it, so a second press has nothing to do.
  it("stands down while the modal is already open", () => {
    mount();
    pressFind({ metaKey: true, shiftKey: true });
    expect(screen.getByRole("searchbox")).toBeTruthy();

    const again = pressFind({ metaKey: true, shiftKey: true });
    expect(again.defaultPrevented).toBe(false);
  });
});
