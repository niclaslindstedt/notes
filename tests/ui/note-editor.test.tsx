// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Editor } from "../../src/ui/NoteEditor.tsx";
import type { Note } from "../../src/domain/note.ts";
import { DEFAULT_EDITOR_SETTINGS } from "../../src/theme/themes.ts";
import { resetEditorPositions } from "../../src/ui/editor-position.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The editor remembers each note's caret / scroll for the session in a
  // module-level store; drop it so one case's unmount never seeds the next.
  resetEditorPositions();
});

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "My note",
    body: "the body",
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    ...overrides,
  };
}

// Drive the Markdown-off (PlainEditor) path so the body is a plain textarea —
// the live-preview editor is exercised by its own suite.
const PLAIN = { ...DEFAULT_EDITOR_SETTINGS, renderMarkdown: false };

function renderEditor(props: Partial<Parameters<typeof Editor>[0]> = {}) {
  const onBack = vi.fn();
  const onMoveFolder = vi.fn();
  const onChange = vi.fn();
  const onTitleChange = vi.fn();
  const onTitleSettle = vi.fn();
  const onAttach = vi.fn();
  render(
    <Editor
      note={note()}
      editor={PLAIN}
      folders={[]}
      onBack={onBack}
      onMoveFolder={onMoveFolder}
      onChange={onChange}
      onTitleChange={onTitleChange}
      onTitleSettle={onTitleSettle}
      syncSlot={null}
      canAttach={false}
      onAttach={onAttach}
      {...props}
    />,
  );
  return { onBack, onMoveFolder, onChange, onTitleChange, onTitleSettle };
}

describe("Editor", () => {
  it("renders the title and body and fires onBack from the header", () => {
    const { onBack } = renderEditor();

    expect(screen.getByDisplayValue("My note")).toBeTruthy();
    expect(screen.getByDisplayValue("the body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("buffers title edits and commits the trimmed title on blur, then settles", () => {
    const { onTitleChange, onTitleSettle } = renderEditor();
    const title = screen.getByDisplayValue("My note");

    fireEvent.change(title, { target: { value: "  Renamed  " } });
    // Buffered locally — nothing pushed up yet.
    expect(onTitleChange).not.toHaveBeenCalled();

    fireEvent.blur(title);
    expect(onTitleChange).toHaveBeenCalledWith("Renamed");
    expect(onTitleSettle).toHaveBeenCalled();
  });

  it("pushes body edits up on each keystroke", () => {
    const { onChange } = renderEditor();
    const body = screen.getByDisplayValue("the body");

    fireEvent.change(body, { target: { value: "the body!" } });
    expect(onChange).toHaveBeenCalledWith("the body!");
  });

  it("routes Ctrl+A pressed with nothing focused into the body textarea", () => {
    // Opening an existing note focuses nothing, so the shortcut lands on the
    // body element; it must select the note body, not the whole page.
    renderEditor();
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(document.activeElement).toBe(body);
    expect(body.selectionStart).toBe(0);
    expect(body.selectionEnd).toBe(body.value.length);
  });

  it("keeps Ctrl+A field-scoped while the title holds focus", () => {
    renderEditor();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    title.focus();

    fireEvent.keyDown(title, { key: "a", ctrlKey: true });
    // The fallback must not yank focus (or the selection) into the body.
    expect(document.activeElement).toBe(title);
    expect(body.selectionEnd).toBe(0);
  });

  it("shows the decrypting placeholder and withholds the editor while loading", () => {
    renderEditor({ loading: true });

    expect(screen.getByText("Decrypting…")).toBeTruthy();
    expect(screen.queryByDisplayValue("the body")).toBeNull();
  });

  it("hides the folder picker when there are no folders", () => {
    renderEditor({ folders: [] });
    expect(screen.queryByLabelText("Move to folder")).toBeNull();
  });

  it("offers the folder picker when folders exist", () => {
    renderEditor({ folders: [{ id: "f1", name: "Work", createdAt: 0 }] });
    expect(screen.getByLabelText("Move to folder")).toBeTruthy();
  });
});
