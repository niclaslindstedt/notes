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

  it("tabs from the title straight into the body, not the header buttons", () => {
    renderEditor();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    title.focus();

    fireEvent.keyDown(title, { key: "Tab" });
    expect(document.activeElement).toBe(body);
  });

  it("tabs from the body up to the header actions, and back on Shift+Tab", () => {
    renderEditor({ syncSlot: <button type="button">Sync</button> });
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    body.focus();

    fireEvent.keyDown(body, { key: "Tab" });
    // The leftmost action in the header cluster — the styling toolbar's toggle,
    // with no folders to put a folder picker before it.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Formatting" }),
    );

    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(body);

    fireEvent.keyDown(body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(title);
  });

  it("keeps the editing surface out of the browser's own tab order", () => {
    // The body sits after the header in the DOM; it's reached by the handlers
    // above instead, so tabbing on past the last header action leaves the
    // editor rather than dropping back into the note.
    renderEditor();
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    expect(body.tabIndex).toBe(-1);
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

describe("the styling toolbar", () => {
  afterEach(() => localStorage.clear());

  function openToolbar() {
    fireEvent.click(screen.getByRole("button", { name: "Formatting" }));
  }

  it("stays closed until the header button asks for it", () => {
    renderEditor();
    expect(screen.queryByRole("toolbar")).toBeNull();
    openToolbar();
    expect(screen.getByRole("toolbar")).toBeTruthy();
  });

  it("puts itself above the note body rather than over it", () => {
    renderEditor();
    openToolbar();
    const toolbar = screen.getByRole("toolbar");
    const body = screen.getByDisplayValue("the body");
    // Document order is what pushes the text down — the toolbar is a sibling
    // ahead of the editing surface, not an overlay on top of it.
    expect(
      toolbar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("closes again on a second press, and remembers the choice", () => {
    renderEditor();
    openToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Hide formatting" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(localStorage.getItem("notes/format-toolbar")).toBe("false");

    cleanup();
    localStorage.setItem("notes/format-toolbar", "true");
    renderEditor();
    expect(screen.getByRole("toolbar")).toBeTruthy();
  });

  it("applies a heading to the caret's line", () => {
    const { onChange } = renderEditor({ note: note({ body: "hello" }) });
    openToolbar();
    const body = screen.getByDisplayValue("hello") as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(2, 2);

    fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    expect(onChange).toHaveBeenCalledWith("## hello");
  });

  it("wraps the selected text in bold and leaves it selected", () => {
    const { onChange } = renderEditor({ note: note({ body: "say hello" }) });
    openToolbar();
    const body = screen.getByDisplayValue("say hello") as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(4, 9);

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith("say **hello**");
    expect(body.value.slice(body.selectionStart, body.selectionEnd)).toBe(
      "**hello**",
    );
  });

  it("lights the button matching the line the caret is on", () => {
    renderEditor({ note: note({ body: "- milk" }) });
    openToolbar();
    const body = screen.getByDisplayValue("- milk") as HTMLTextAreaElement;
    body.focus();
    fireEvent.select(body, { target: { selectionStart: 3, selectionEnd: 3 } });

    expect(
      screen.getByRole("button", { name: "Bullet list" }).ariaPressed,
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Numbered list" }).ariaPressed,
    ).toBe("false");
  });

  it("disables outdent when the line is already at the left margin", () => {
    renderEditor({ note: note({ body: "- milk" }) });
    openToolbar();
    expect(
      (screen.getByRole("button", { name: "Outdent" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
