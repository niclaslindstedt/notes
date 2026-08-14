// @vitest-environment jsdom
import { useState } from "react";
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
      onToggleLock={vi.fn()}
      canAttach={false}
      onAttach={vi.fn()}
    />,
  );
}

// The replace half writes to the note, and the editor is controlled — so these
// tests need a host that actually holds the body, or every replace would land
// on a prop that snaps straight back.
function LiveEditor({ locked = false }: { locked?: boolean }) {
  const [body, setBody] = useState(BODY);
  return (
    <Editor
      note={note({ body, locked })}
      editor={PLAIN}
      onBack={vi.fn()}
      onChange={setBody}
      onReplace={setBody}
      onTitleChange={vi.fn()}
      onTitleSettle={vi.fn()}
      onToggleFavorite={vi.fn()}
      onToggleLock={vi.fn()}
      canAttach={false}
      onAttach={vi.fn()}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Start writing…") as HTMLTextAreaElement;
}

/** Open the find bar, unfold its replace row, and hand back both fields. */
function openReplace(): {
  find: HTMLInputElement;
  replace: HTMLInputElement;
} {
  const find = openFind();
  fireEvent.click(screen.getByRole("button", { name: "Show replace" }));
  return {
    find,
    replace: screen.getByRole("textbox", {
      name: "Replace with",
    }) as HTMLInputElement,
  };
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

// The bar's folded-away second half: the chevron, the replace field, the two
// buttons that write, and the preview that doesn't.
describe("find in note: replace", () => {
  // The search field's own magnifier is the disclosure — it costs the row no
  // width, and its face is the state: a magnifier while the bar only finds, the
  // replace arrows once it can also write.
  it("keeps the replace row folded away until the magnifier asks for it", () => {
    render(<LiveEditor />);
    openFind();
    expect(screen.queryByPlaceholderText("Replace with…")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show replace" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    const field = screen.getByPlaceholderText("Replace with…");
    // The press that revealed the field said what the user wants to type next.
    expect(document.activeElement).toBe(field);
    // Same control, now saying the opposite thing.
    expect(
      screen
        .getByRole("button", { name: "Hide replace" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Hide replace" }));
    expect(screen.queryByPlaceholderText("Replace with…")).toBeNull();
    expect(screen.getByRole("button", { name: "Show replace" })).toBeTruthy();
  });

  it("replaces the match the bar is parked on and steps to the next", () => {
    render(<LiveEditor />);
    const { replace } = openReplace();
    fireEvent.input(screen.getByRole("textbox", { name: "Find in note" }), {
      target: { value: "alpha" },
    });
    fireEvent.input(replace, { target: { value: "omega" } });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Replace this match" }));

    expect(textarea().value).toBe("omega beta\ngamma ALPHA\ndelta");
    // One hit left, and the bar is standing on it.
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });

  it("replaces every match in one press", () => {
    render(<LiveEditor />);
    const { find, replace } = openReplace();
    fireEvent.input(find, { target: { value: "alpha" } });
    fireEvent.input(replace, { target: { value: "omega" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Replace all matches" }),
    );

    expect(textarea().value).toBe("omega beta\ngamma omega\ndelta");
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("replaces from the field's own Enter, and all of them with Ctrl+Enter", () => {
    render(<LiveEditor />);
    const { find, replace } = openReplace();
    fireEvent.input(find, { target: { value: "alpha" } });
    fireEvent.input(replace, { target: { value: "x" } });

    fireEvent.keyDown(replace, { key: "Enter" });
    expect(textarea().value).toBe("x beta\ngamma ALPHA\ndelta");

    fireEvent.keyDown(replace, { key: "Enter", ctrlKey: true });
    expect(textarea().value).toBe("x beta\ngamma x\ndelta");
  });

  it("withholds the whole replace half on a locked note", () => {
    render(<LiveEditor locked />);
    openFind();
    expect(screen.queryByRole("button", { name: "Show replace" })).toBeNull();
    // Find itself still works there — reading a locked note is the point.
    expect(screen.getByRole("textbox", { name: "Find in note" })).toBeTruthy();
  });

  it("disables the replace buttons while nothing matches", () => {
    render(<LiveEditor />);
    const { find } = openReplace();
    fireEvent.input(find, { target: { value: "nothing here" } });

    for (const name of [
      "Replace this match",
      "Replace all matches",
      "Preview the replacement",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });
});

describe("find in note: the (.*) regex toggle", () => {
  function toggleRegex() {
    fireEvent.click(
      screen.getByRole("button", { name: "Use a regular expression" }),
    );
  }

  it("reads the query as a pattern only once it is switched on", () => {
    render(<LiveEditor />);
    const find = openFind();
    fireEvent.input(find, { target: { value: "a.pha" } });
    expect(screen.getByText("No matches")).toBeTruthy();

    toggleRegex();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("says so when the pattern doesn't compile", () => {
    render(<LiveEditor />);
    const find = openFind();
    toggleRegex();
    fireEvent.input(find, { target: { value: "(alpha" } });

    expect(screen.getByText("Invalid")).toBeTruthy();
    // The query the message is about stays visible — the sentence lives in the
    // hover title instead of squeezing the field to nothing.
    expect(find.value).toBe("(alpha");
    expect(
      (screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("feeds a pattern's captures to the replacement's $1", () => {
    render(<LiveEditor />);
    const { find, replace } = openReplace();
    toggleRegex();
    fireEvent.input(find, { target: { value: "(alpha) (beta)" } });
    fireEvent.input(replace, { target: { value: "$2-$1" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Replace all matches" }),
    );
    expect(textarea().value).toBe("beta-Alpha\ngamma ALPHA\ndelta");
  });
});

describe("find in note: the replacement preview", () => {
  function openPreview() {
    const fields = openReplace();
    fireEvent.input(fields.find, { target: { value: "alpha" } });
    fireEvent.input(fields.replace, { target: { value: "omega" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview the replacement" }),
    );
    return fields;
  }

  it("shows what would be written without touching the note", () => {
    render(<LiveEditor />);
    openPreview();

    const panel = screen.getByRole("region", { name: "Replacement preview" });
    expect(panel.textContent).toContain("Preview: 2 matches on 2 lines");
    // Each hit shown as what goes and what arrives, in the line's own context.
    expect(panel.textContent).toContain("Alpha");
    expect(panel.textContent).toContain("omega");
    // …and the note itself is exactly as it was.
    expect(textarea().value).toBe(BODY);
  });

  it("lists only the lines the replacement would touch", () => {
    render(<LiveEditor />);
    openPreview();

    const panel = screen.getByRole("region", { name: "Replacement preview" });
    // "delta" is on line 3 and holds no match, so it is not in the list.
    expect(panel.textContent).not.toContain("delta");
  });

  it("folds away with the replace row it belongs to", () => {
    render(<LiveEditor />);
    openPreview();
    expect(
      screen.getByRole("region", { name: "Replacement preview" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide replace" }));
    expect(
      screen.queryByRole("region", { name: "Replacement preview" }),
    ).toBeNull();

    // …and does not come back on its own when the row is unfolded again.
    fireEvent.click(screen.getByRole("button", { name: "Show replace" }));
    expect(
      screen.queryByRole("region", { name: "Replacement preview" }),
    ).toBeNull();
  });
});

// ⌘F / Ctrl+F is the keystroke everyone already presses to search what is in
// front of them; while a note is open it belongs to this bar rather than to the
// browser's "find on page", which searches the rendered page and can't be
// stepped from a phone.
describe("find in note: the ⌘F / Ctrl+F shortcut", () => {
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

  it("opens the bar with the field focused, and takes the key from the browser", () => {
    renderEditor();
    expect(screen.queryByPlaceholderText("Find in note…")).toBeNull();

    const e = pressFind({ metaKey: true });
    expect(e.defaultPrevented).toBe(true);

    const field = screen.getByRole("textbox", { name: "Find in note" });
    expect(document.activeElement).toBe(field);
  });

  it("answers Ctrl+F the same way", () => {
    renderEditor();
    pressFind({ ctrlKey: true });
    expect(screen.getByPlaceholderText("Find in note…")).toBeTruthy();
  });

  // Pressing it again is "search for something else", not "put the bar away" —
  // the toggle in the header is what closes it.
  it("re-focuses an open bar and selects the query rather than closing it", () => {
    renderEditor();
    const field = openFind();
    fireEvent.input(field, { target: { value: "alpha" } });
    expect(screen.getByText("1 of 2")).toBeTruthy();

    const body = screen.getByPlaceholderText("Start writing…");
    body.focus();
    expect(document.activeElement).toBe(body);

    pressFind({ metaKey: true });

    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("alpha");
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(5);
    // Still the same search, not a fresh bar.
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  // Shift widens the search to every note (the search modal, bound by
  // `SearchModalHost`), so the note's own bar must not answer it too.
  it("ignores the modified variants, Shift included", () => {
    renderEditor();
    expect(pressFind({ metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(pressFind({ metaKey: true, altKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(pressFind({}).defaultPrevented).toBe(false);
    expect(screen.queryByPlaceholderText("Find in note…")).toBeNull();
  });
});
