// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  NoteCard,
  SwipeableNoteCard,
} from "../../src/ui/note-list/NoteCard.tsx";
import type { Note } from "../../src/domain/note.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Groceries",
    body: "Milk\nEggs",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// Force the desktop / touch branch of `SwipeableNoteCard` (which reads
// `useMediaQuery("(hover: hover) and (pointer: fine)")`). jsdom has no
// `matchMedia`, so we stub it per test.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("NoteCard", () => {
  it("shows the title and a body preview, and opens on click", () => {
    const onOpen = vi.fn();
    render(<NoteCard note={note()} onOpen={onOpen} />);

    expect(screen.getByText("Groceries")).toBeTruthy();
    // Default layout is `cards`, so the multi-line block preview renders.
    expect(screen.getByText(/Milk/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders the at-rest lock for an encrypted, decrypted note", () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} encrypted />);
    // A loaded body reads as "decrypted"; the deferred state would read
    // "Encrypted at rest" without the suffix.
    expect(screen.getByText("Encrypted at rest, decrypted")).toBeTruthy();
  });

  it("shows the sync spinner instead of the lock while uploading", () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} encrypted uploading />);
    expect(screen.getByText("Syncing…")).toBeTruthy();
    // The spinner takes precedence — the lock label is suppressed.
    expect(screen.queryByText("Encrypted at rest, decrypted")).toBeNull();
  });
});

describe("SwipeableNoteCard", () => {
  it("offers a right-click menu of the primary + delete actions on desktop", () => {
    stubMatchMedia(true);
    const onPrimary = vi.fn();
    const onDelete = vi.fn();
    render(
      <SwipeableNoteCard
        note={note()}
        onOpen={vi.fn()}
        onPrimary={onPrimary}
        onDelete={onDelete}
        primaryLabel="Archive"
        primaryIcon={null}
      />,
    );

    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Groceries"));

    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Archive", "Delete"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("exposes the swipe backdrops and a delete button on touch devices", () => {
    stubMatchMedia(false);
    const onDelete = vi.fn();
    render(
      <SwipeableNoteCard
        note={note()}
        onOpen={vi.fn()}
        onPrimary={vi.fn()}
        onDelete={onDelete}
        primaryLabel="Restore"
        primaryIcon={null}
      />,
    );

    // No right-click menu on the touch path; the primary label rides the
    // swipe-right backdrop instead, and Delete is a tappable button. Both
    // backdrops start `aria-hidden` (the foreground hasn't slid), so query by
    // text rather than accessible role.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByText("Restore")).toBeTruthy();

    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
