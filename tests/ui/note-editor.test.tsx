// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import { Editor } from "../../src/ui/NoteEditor.tsx";
import type { Note } from "../../src/domain/note.ts";
import { DEFAULT_EDITOR_SETTINGS } from "../../src/theme/themes.ts";
import { resetEditorPositions } from "../../src/ui/editor-position.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

// The "Copied" toast the copy button raises reads the nav state to dock past a
// pinned sidebar, so the editor needs a provider above it.
const nav: NavContextValue = {
  open: false,
  toggle: vi.fn(),
  close: vi.fn(),
  setDragging: vi.fn(),
  position: { side: "right", y: 0.5 },
  setPosition: vi.fn(),
  showMenuButton: true,
  setShowMenuButton: vi.fn(),
  showButton: true,
  pinned: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  const onChange = vi.fn();
  const onTitleChange = vi.fn();
  const onTitleSettle = vi.fn();
  const onToggleFavorite = vi.fn();
  const onToggleLock = vi.fn();
  const onAttach = vi.fn();
  render(
    <NavContext.Provider value={nav}>
      <Editor
        note={note()}
        editor={PLAIN}
        onBack={onBack}
        onChange={onChange}
        onTitleChange={onTitleChange}
        onTitleSettle={onTitleSettle}
        onToggleFavorite={onToggleFavorite}
        onToggleLock={onToggleLock}
        canAttach={false}
        onAttach={onAttach}
        {...props}
      />
    </NavContext.Provider>,
  );
  return {
    onBack,
    onChange,
    onTitleChange,
    onTitleSettle,
    onToggleFavorite,
    onToggleLock,
  };
}

describe("Editor", () => {
  it("stars the note from the header, and labels the button by state", () => {
    const { onToggleFavorite } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it("shows the star as pressed on a note already favorited", () => {
    renderEditor({ note: note({ favorite: true }) });
    const star = screen.getByRole("button", { name: "Remove from favorites" });
    expect(star.getAttribute("aria-pressed")).toBe("true");
  });

  it("locks the note from the header, and labels the button by state", () => {
    const { onToggleLock } = renderEditor();
    const padlock = screen.getByRole("button", { name: "Lock note" });
    expect(padlock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(padlock);
    expect(onToggleLock).toHaveBeenCalledTimes(1);
  });

  it("shows the padlock as pressed on a note already locked", () => {
    renderEditor({ note: note({ locked: true }) });
    const padlock = screen.getByRole("button", { name: "Unlock note" });
    expect(padlock.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the title and body and fires onBack from the header", () => {
    const { onBack } = renderEditor();

    expect(screen.getByDisplayValue("My note")).toBeTruthy();
    expect(screen.getByDisplayValue("the body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("buffers title edits and commits the trimmed title on blur, then settles", () => {
    const { onTitleChange, onTitleSettle } = renderEditor();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    title.focus();

    fireEvent.input(title, { target: { value: "  Renamed  " } });
    // Buffered locally — nothing pushed up yet.
    expect(onTitleChange).not.toHaveBeenCalled();

    // Blur for real rather than dispatching a synthetic `blur`: Preact maps
    // `onBlur` onto the bubbling `focusout` (React's semantics), and only the
    // DOM's own `blur()` emits that pair the way a browser does.
    title.blur();
    expect(onTitleChange).toHaveBeenCalledWith("Renamed");
    expect(onTitleSettle).toHaveBeenCalled();
  });

  it("pushes body edits up on each keystroke", () => {
    const { onChange } = renderEditor();
    const body = screen.getByDisplayValue("the body");

    fireEvent.input(body, { target: { value: "the body!" } });
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
    // The fallback must not yank focus (or the selection) into the body. The
    // body holds a caret, never a range — a select-all would have spread it
    // across the whole value. (Asserting a specific offset would instead pin
    // down where a freshly mounted textarea parks its caret, which is the
    // renderer's business, not this shortcut's.)
    expect(document.activeElement).toBe(title);
    expect(body.selectionStart).toBe(body.selectionEnd);
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
    renderEditor();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    body.focus();

    fireEvent.keyDown(body, { key: "Tab" });
    // The leftmost action in the header cluster — the favorite star.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add to favorites" }),
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

  it("keeps the header free of a folder control — filing is a side-menu drag", () => {
    renderEditor();
    expect(screen.queryByLabelText("Move to folder")).toBeNull();
  });
});

describe("the cut button", () => {
  // The note body, which a multi-line value can't be found by: the display-value
  // query collapses whitespace, so "one\ntwo" never matches.
  const bodyField = () =>
    screen.getByPlaceholderText("Start writing…") as HTMLTextAreaElement;

  // jsdom ships no Clipboard API, so stand one in and watch what the cut hands
  // it. Configurable, so `afterEach`'s cleanup can drop it again.
  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("cuts the line the caret sits on", () => {
    const { onChange } = renderEditor({
      note: note({ body: "one\ntwo\nthree" }),
    });
    const body = bodyField();
    body.focus();
    body.setSelectionRange(4, 4); // start of "two"

    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(onChange).toHaveBeenCalledWith("one\nthree");
  });

  it("cuts only what follows a mid-line caret", () => {
    const { onChange } = renderEditor({
      note: note({ body: "keep this. drop this." }),
    });
    const body = screen.getByDisplayValue(
      "keep this. drop this.",
    ) as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(11, 11);

    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(onChange).toHaveBeenCalledWith("keep this. ");
    // The caret stays put so typing carries straight on.
    expect(body.selectionStart).toBe(11);
  });

  it("cuts exactly the selection when there is one", () => {
    const writeText = stubClipboard();
    const { onChange } = renderEditor({
      note: note({ body: "one\ntwo\nthree" }),
    });
    const body = bodyField();
    body.focus();
    body.setSelectionRange(4, 7); // "two", without its newline

    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    // The selected text goes and the line it sat on stays behind, empty.
    expect(onChange).toHaveBeenCalledWith("one\n\nthree");
    expect(writeText).toHaveBeenCalledWith("two");
  });

  it("puts what it took on the clipboard", () => {
    const writeText = stubClipboard();
    renderEditor({ note: note({ body: "one\ntwo\nthree" }) });
    const body = bodyField();
    body.focus();
    body.setSelectionRange(4, 4);

    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    // A whole line goes with its newline, so pasting it back makes a line.
    expect(writeText).toHaveBeenCalledWith("two\n");
  });

  it("answers Ctrl+K in the body the same way", () => {
    const { onChange } = renderEditor({ note: note({ body: "one\ntwo" }) });
    const body = bodyField();
    body.focus();
    body.setSelectionRange(0, 0);

    fireEvent.keyDown(body, { key: "k", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("keeps the caret in the body — the press must not blur the editor", () => {
    renderEditor({ note: note({ body: "one\ntwo" }) });
    const body = bodyField();
    body.focus();

    const button = screen.getByRole("button", { name: "Cut" });
    const down = fireEvent.mouseDown(button);
    // A cancelled mousedown is what leaves focus (and the caret) where it is.
    expect(down).toBe(false);
  });

  it("is withheld while the note is still decrypting", () => {
    renderEditor({ loading: true });
    expect(screen.queryByRole("button", { name: "Cut" })).toBeNull();
  });

  // The button is a touch affordance: a mouse and a keyboard already reach the
  // same edit through Ctrl/Cmd+K and the browser's right-click Cut, so the
  // header doesn't spend a glyph on it there.
  function stubDesktopPointer() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((media: string) => ({
        matches: media.includes("pointer: fine"),
        media,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );
  }

  it("is left out of the header on a desktop pointer", () => {
    stubDesktopPointer();
    renderEditor();
    expect(screen.queryByRole("button", { name: "Cut" })).toBeNull();
    // The rest of the cluster is untouched.
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  });

  it("still answers Ctrl+K where the button is gone", () => {
    stubDesktopPointer();
    const { onChange } = renderEditor({ note: note({ body: "one\ntwo" }) });
    const body = bodyField();
    body.focus();
    body.setSelectionRange(0, 0);

    fireEvent.keyDown(body, { key: "k", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("two");
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
      "Checklist",
      "Quote",
      "Code block",
    ]);
  });

  it("lights an inline button when the caret sits inside its run", () => {
    renderEditor({ note: note({ body: "say **hello** now" }) });
    openToolbar();
    const body = screen.getByDisplayValue(
      "say **hello** now",
    ) as HTMLTextAreaElement;
    body.focus();

    // Inside `**hello**` — Bold is on, and a press would take it back off.
    body.setSelectionRange(7, 7);
    fireEvent.mouseUp(body);
    expect(screen.getByRole("button", { name: "Bold" }).ariaPressed).toBe(
      "true",
    );
    // Italic is not: a `**` run wears one mark, not two.
    expect(screen.getByRole("button", { name: "Italic" }).ariaPressed).toBe(
      "false",
    );

    // Stepping out of the run puts it out again.
    body.setSelectionRange(15, 15);
    fireEvent.mouseUp(body);
    expect(screen.getByRole("button", { name: "Bold" }).ariaPressed).toBe(
      "false",
    );
  });

  it("takes the whole run off when a lit inline button is pressed", () => {
    const onChange = vi.fn();
    renderEditor({ note: note({ body: "say **hello** now" }), onChange });
    openToolbar();
    const body = screen.getByDisplayValue(
      "say **hello** now",
    ) as HTMLTextAreaElement;
    body.focus();
    // A bare caret mid-word: the lit button unbolds the phrase it lit for.
    body.setSelectionRange(7, 7);
    fireEvent.mouseUp(body);

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith("say hello now");
    expect(screen.getByRole("button", { name: "Bold" }).ariaPressed).toBe(
      "false",
    );
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

// The narrow header folds its five action buttons behind a single ⋯ toggle.
// jsdom carries no stylesheet, so "folded away" is asserted through the two
// things that live in the markup rather than in the cascade: the inline
// max-width the slide animates, and the `hidden` class the title wears while
// the cluster stands in its place.
describe("Editor (narrow header)", () => {
  // The framework's `useMediaQuery` reads `window.matchMedia`, which jsdom
  // doesn't implement; stub it to answer "yes, this is a phone".
  function stubNarrow(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((media: string) => ({
        matches: media.includes("max-width") ? matches : false,
        media,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );
  }

  // The box that carries the five buttons — the star's parent, which is what
  // the open / closed transition animates.
  function cluster() {
    return screen.getByRole("button", { name: "Add to favorites" })
      .parentElement as HTMLElement;
  }

  // Whether the title field is out of the row. Matched as a whole class rather
  // than a substring — the field is also `overflow-hidden`.
  function titleHidden() {
    return screen
      .getByDisplayValue("My note")
      .className.split(/\s+/)
      .includes("hidden");
  }

  it("keeps every action in the row on a wide header", () => {
    stubNarrow(false);
    renderEditor();
    expect(screen.queryByRole("button", { name: "Note actions" })).toBe(null);
    expect(cluster().style.maxWidth).toBe("");
  });

  it("folds the cluster away behind a ⋯ toggle, title still showing", () => {
    stubNarrow(true);
    renderEditor();

    const more = screen.getByRole("button", { name: "Note actions" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(cluster().style.maxWidth).toBe("0px");
    expect(titleHidden()).toBe(false);
  });

  it("unfolds the cluster over the title when the ⋯ is pressed", () => {
    stubNarrow(true);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));

    expect(cluster().style.maxWidth).toBe("17rem");
    expect(
      screen
        .getByRole("button", { name: "Hide note actions" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(titleHidden()).toBe(true);
  });

  it("folds back when the note takes focus again", () => {
    stubNarrow(true);
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
    expect(cluster().style.maxWidth).toBe("17rem");

    // Tapping into the body is the end of the detour — the title comes back
    // without a second press on the toggle.
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    fireEvent.pointerDown(body);

    expect(cluster().style.maxWidth).toBe("0px");
    expect(titleHidden()).toBe(false);
  });
});

// Selecting text on a narrow screen unfolds the same cluster on its own,
// carrying the three actions that operate on a selection — so the ⋯ is a
// detour you don't have to take for the thing you just highlighted.
describe("Editor (selection actions)", () => {
  function stubNarrow(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((media: string) => ({
        matches: media.includes("max-width") ? matches : false,
        media,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );
  }

  // The box the buttons ride in — reached through whichever of them is out, so
  // the helper works in both the selection set and the full one.
  function cluster() {
    return screen.getByRole("button", { name: "Cut" })
      .parentElement as HTMLElement;
  }

  // Highlight part of the body. The plain textarea emits `select` for a real
  // range, which is what the editor reports its selection from.
  function selectBody(from: number, to: number) {
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    body.setSelectionRange(from, to);
    fireEvent.select(body);
    return body;
  }

  function stubClipboard(writeText: () => Promise<void>) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: spy },
      configurable: true,
    });
    return spy;
  }

  afterEach(() => Reflect.deleteProperty(navigator, "clipboard"));

  it("unfolds formatting, cut and copy when text is selected", () => {
    stubNarrow(true);
    renderEditor();
    expect(cluster().style.maxWidth).toBe("0px");

    selectBody(0, 3);

    expect(cluster().style.maxWidth).toBe("9rem");
    expect(cluster().dataset.cluster).toBe("open");
    expect(screen.getByRole("button", { name: "Copy selection" })).toBeTruthy();
    // Only the three that act on a selection: the star, the export menu and
    // find stay behind the ⋯.
    expect(screen.queryByRole("button", { name: "Add to favorites" })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "Export" })).toBe(null);
  });

  it("folds away again when the selection collapses", () => {
    stubNarrow(true);
    renderEditor();
    selectBody(0, 3);
    expect(cluster().style.maxWidth).toBe("9rem");

    selectBody(3, 3);

    expect(cluster().style.maxWidth).toBe("0px");
    expect(screen.queryByRole("button", { name: "Copy selection" })).toBe(null);
  });

  it("widens into the full row when the ⋯ is pressed over a selection", () => {
    stubNarrow(true);
    renderEditor();
    selectBody(0, 3);

    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));

    expect(cluster().style.maxWidth).toBe("17rem");
    expect(
      screen.getByRole("button", { name: "Add to favorites" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy selection" })).toBe(null);
  });

  it("copies only the selected text", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    stubNarrow(true);
    renderEditor();
    selectBody(4, 8);

    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
    await screen.findByRole("status");

    expect(writeText).toHaveBeenCalledWith("body");
  });

  it("leaves a wide header's row alone — every action is already in it", () => {
    stubNarrow(false);
    renderEditor();
    selectBody(0, 3);

    expect(cluster().style.maxWidth).toBe("");
    expect(
      screen.getByRole("button", { name: "Add to favorites" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy selection" })).toBe(null);
  });
});

// A locked note is read-only: no caret, no soft keyboard, no edit — and none of
// the header buttons that would rewrite it. Everything that only reads the note
// stays exactly where it was.
describe("Editor (locked)", () => {
  function locked(over: Partial<Note> = {}) {
    return renderEditor({ note: note({ locked: true, ...over }) });
  }

  it("makes the body read-only without a caret", () => {
    locked();
    const body = screen.getByDisplayValue("the body") as HTMLTextAreaElement;
    expect(body.readOnly).toBe(true);
    // `readOnly` alone keeps the soft keyboard down but still paints a caret on
    // a desktop, so the caret colour is taken too.
    expect(body.className).toContain("caret-transparent");
  });

  it("makes the title read-only too", () => {
    locked();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    expect(title.readOnly).toBe(true);
    expect(title.className).toContain("caret-transparent");
  });

  it("refuses a title edit that reaches the field anyway", () => {
    const { onTitleChange } = locked();
    const title = screen.getByDisplayValue("My note") as HTMLTextAreaElement;
    title.focus();
    title.blur();
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it("drops the two buttons that would rewrite the note", () => {
    locked();
    expect(screen.queryByRole("button", { name: "Formatting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cut" })).toBeNull();
  });

  it("keeps every button that only reads it", () => {
    locked({ favorite: true });
    expect(
      screen.getByRole("button", { name: "Remove from favorites" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find in note" })).toBeTruthy();
  });

  it("keeps the styling toolbar off the screen without forgetting the setting", () => {
    // The toolbar is remembered across notes and reloads, so a locked note
    // opened by a Markdown writer would otherwise carry a bar of dead buttons.
    localStorage.setItem("notes/format-toolbar", "true");
    try {
      locked();
      expect(screen.queryByRole("toolbar")).toBeNull();
      cleanup();
      renderEditor();
      expect(screen.getByRole("toolbar")).toBeTruthy();
    } finally {
      localStorage.removeItem("notes/format-toolbar");
    }
  });
});
