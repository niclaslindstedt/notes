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

  it("applies a heading from the heading menu", () => {
    const { onChange } = renderEditor({ note: note({ body: "hello" }) });
    openToolbar();
    const body = screen.getByDisplayValue("hello") as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(2, 2);

    // The six levels live behind one trigger so the row fits a phone in a
    // single line; the menu rows name the level as well as drawing it.
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Heading 2" }));
    expect(onChange).toHaveBeenCalledWith("## hello");
  });

  it("closes the menu once a row is picked", () => {
    renderEditor({ note: note({ body: "hello" }) });
    openToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect(screen.getByRole("menu", { name: "Heading" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Heading 2" }));
    expect(screen.queryByRole("menu")).toBeNull();
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

  it("wears the applied construct on the menu's trigger", () => {
    renderEditor({ note: note({ body: "- milk" }) });
    openToolbar();
    const body = screen.getByDisplayValue("- milk") as HTMLTextAreaElement;
    body.focus();
    fireEvent.select(body, { target: { selectionStart: 3, selectionEnd: 3 } });

    // With a bullet under the caret the collapsed group names it rather than
    // the group — so the row still says what is applied.
    expect(screen.queryByRole("button", { name: "Block style" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Bullet list" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("marks the applied row inside the menu", () => {
    renderEditor({ note: note({ body: "- milk" }) });
    openToolbar();
    const body = screen.getByDisplayValue("- milk") as HTMLTextAreaElement;
    body.focus();
    fireEvent.select(body, { target: { selectionStart: 3, selectionEnd: 3 } });

    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Bullet list",
      "Numbered list",
      "Quote",
      "Code block",
    ]);
  });

  it("lights an inline button by its own state, not the line's", () => {
    renderEditor({ note: note({ body: "- milk" }) });
    openToolbar();
    // Bold has no line-level state to read, so it never claims to be pressed.
    expect(screen.getByRole("button", { name: "Bold" }).ariaPressed).toBeNull();
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
