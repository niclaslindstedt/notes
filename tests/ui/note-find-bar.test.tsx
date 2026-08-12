// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import { Editor } from "../../src/ui/NoteEditor.tsx";
import type { Note } from "../../src/domain/note.ts";
import { DEFAULT_EDITOR_SETTINGS } from "../../src/theme/themes.ts";
import { resetEditorPositions } from "../../src/ui/editor-position.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEditorPositions();
});

const BODY = "Alpha beta\ngamma ALPHA\ndelta";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "My note",
    body: BODY,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    ...overrides,
  };
}

// The plain (Markdown-off) surface: a textarea, so the find bar's own chrome is
// what's under test rather than the live-preview highlighter.
const PLAIN = { ...DEFAULT_EDITOR_SETTINGS, renderMarkdown: false };

function renderEditor() {
  render(
    <Editor
      note={note()}
      editor={PLAIN}
      onBack={vi.fn()}
      onChange={vi.fn()}
      onTitleChange={vi.fn()}
      onTitleSettle={vi.fn()}
      onToggleFavorite={vi.fn()}
      canAttach={false}
      onAttach={vi.fn()}
    />,
  );
}

function openFind(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: "Find in note" }));
  return screen.getByRole("textbox", {
    name: "Find in note",
  }) as HTMLInputElement;
}

describe("find in note", () => {
  it("opens from the header with the field focused, and closes again", () => {
    renderEditor();
    expect(screen.queryByPlaceholderText("Find in note…")).toBeNull();

    const field = openFind();
    expect(document.activeElement).toBe(field);

    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(screen.queryByPlaceholderText("Find in note…")).toBeNull();
  });

  it("counts the matches case-insensitively and steps through them", () => {
    renderEditor();
    const field = openFind();

    fireEvent.input(field, { target: { value: "alpha" } });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByText("2 of 2")).toBeTruthy();

    // Past the last hit it wraps back to the first rather than dead-ending.
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("steps from the field's own Enter / Shift+Enter", () => {
    renderEditor();
    const field = openFind();
    fireEvent.input(field, { target: { value: "alpha" } });

    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("2 of 2")).toBeTruthy();

    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("says so when nothing matches, and disables the arrows", () => {
    renderEditor();
    const field = openFind();
    fireEvent.input(field, { target: { value: "nothing here" } });

    expect(screen.getByText("No matches")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("selects the current match in the plain editor", () => {
    renderEditor();
    const field = openFind();
    const body = screen.getByPlaceholderText(
      "Start writing…",
    ) as HTMLTextAreaElement;

    fireEvent.input(field, { target: { value: "alpha" } });
    expect(body.selectionStart).toBe(0);
    expect(body.selectionEnd).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    // "gamma " on the second line, past "Alpha beta\n".
    expect(body.selectionStart).toBe(17);
    expect(body.selectionEnd).toBe(22);
  });

  it("closes on Escape in the field", () => {
    renderEditor();
    const field = openFind();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Find in note…")).toBeNull();
  });
});
