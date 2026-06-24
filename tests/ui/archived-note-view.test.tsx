// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ArchiveList, ReadOnlyNote } from "../../src/ui/ArchivedNoteView.tsx";
import type { Note } from "../../src/domain/note.ts";
import { DEFAULT_EDITOR_SETTINGS } from "../../src/theme/themes.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Old note",
    body: "archived body",
    createdAt: 0,
    updatedAt: 0,
    archived: true,
    ...overrides,
  };
}

describe("ArchiveList", () => {
  it("shows the empty-state copy when nothing is archived", () => {
    render(
      <ArchiveList
        notes={[]}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBack={vi.fn()}
        syncSlot={null}
      />,
    );
    expect(
      screen.getByText("Nothing archived. Swipe a note right to file it here."),
    ).toBeTruthy();
  });

  it("lists archived notes and fires onBack from the header", () => {
    const onBack = vi.fn();
    render(
      <ArchiveList
        notes={[note(), note({ id: "n2", title: "Second" })]}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onBack={onBack}
        syncSlot={null}
      />,
    );

    expect(screen.getByText("Old note")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ReadOnlyNote", () => {
  it("renders the title and body, and wires the restore / delete actions", () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    render(
      <ReadOnlyNote
        note={note()}
        editor={DEFAULT_EDITOR_SETTINGS}
        onBack={vi.fn()}
        onRestore={onRestore}
        onDelete={onDelete}
        syncSlot={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Old note" })).toBeTruthy();
    expect(screen.getByText("archived body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
