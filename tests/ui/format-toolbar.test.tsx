// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import type { LineFormat } from "../../src/domain/markdown-format.ts";
import { FormatToolbar } from "../../src/ui/FormatToolbar.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The block state the toolbar lights its buttons from — what the editor
// reports for the line the caret sits on.
function lineFormat(overrides: Partial<LineFormat> = {}): LineFormat {
  return { kind: "paragraph", indent: 0, inline: [], ...overrides };
}

function renderToolbar(line: LineFormat | null = null, canAttach = false) {
  const onAction = vi.fn();
  render(
    <FormatToolbar
      line={line}
      onAction={onAction}
      maxWidth="none"
      canAttach={canAttach}
    />,
  );
  return { onAction };
}

// Open the block-style menu (bullet / numbered / checklist / quote / code).
// Its trigger wears the applied member's name, falling back to the group's
// own — so a caret on a task row makes the trigger read "Checklist".
function openBlockMenu(trigger = "Block style") {
  fireEvent.click(screen.getByRole("button", { name: trigger }));
}

describe("FormatToolbar — checklist", () => {
  it("offers Checklist alongside the other list styles", () => {
    renderToolbar();
    openBlockMenu();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      ["Bullet list", "Numbered list", "Checklist", "Quote", "Code block"],
    );
  });

  it("fires the task action when pressed", () => {
    const { onAction } = renderToolbar();
    openBlockMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Checklist" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "task" });
  });

  it("keeps the caret in the editor by cancelling its own press", () => {
    renderToolbar();
    openBlockMenu();
    const row = screen.getByRole("menuitem", { name: "Checklist" });
    expect(fireEvent.mouseDown(row)).toBe(false); // preventDefault()ed
  });

  it("lights Checklist — and not Bullet list — on a task row", () => {
    // Both are `ul` lines; the box is what tells them apart, so exactly one of
    // the two is ever lit.
    renderToolbar(lineFormat({ kind: "ul", task: false }));
    // The menu's trigger wears the applied member's name.
    expect(screen.getByRole("button", { name: "Checklist" })).toBeTruthy();
    openBlockMenu("Checklist");
    const rows = screen.getAllByRole("menuitem");
    const lit = rows.filter((el) => el.className.includes("text-accent"));
    expect(lit.map((el) => el.textContent)).toEqual(["Checklist"]);
  });

  it("lights Bullet list on a plain bullet", () => {
    renderToolbar(lineFormat({ kind: "ul" }));
    expect(screen.getByRole("button", { name: "Bullet list" })).toBeTruthy();
    openBlockMenu("Bullet list");
    const lit = screen
      .getAllByRole("menuitem")
      .filter((el) => el.className.includes("text-accent"));
    expect(lit.map((el) => el.textContent)).toEqual(["Bullet list"]);
  });
});

// Open the Insert menu (link / image-or-file / divider).
function openInsertMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));
}

describe("FormatToolbar — the Insert menu", () => {
  it("offers one Image/file row between Link and Divider where files can be attached", () => {
    // Pictures and files share a row: the browser it opens offers both, and
    // what comes back is told apart by its type.
    renderToolbar(null, true);
    openInsertMenu();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      ["Link", "Image/file", "Divider"],
    );
  });

  it("calls the row plain Image where the backend cannot hold an attachment", () => {
    // Nowhere for the bytes to go on the browser backend, so the label must
    // not promise a browser — the press writes the `![](url)` Markdown there.
    renderToolbar(null, false);
    openInsertMenu();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      ["Link", "Image", "Divider"],
    );
  });

  it("fires the attach action — the host decides what it means", () => {
    const { onAction } = renderToolbar(null, true);
    openInsertMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Image/file" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "attach" });
  });

  it("fires the same attach action from the plain Image row", () => {
    const { onAction } = renderToolbar(null, false);
    openInsertMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Image" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "attach" });
  });
});

// A pointer opens a menu on the press itself. The click that trails it on a
// phone is the half that goes missing — swallowed by another panel's
// dismissal, or hit-tested against geometry the soft keyboard is still
// animating — which read as "the menu won't open until I put the keyboard
// away first".
describe("FormatToolbar — opening a menu from a pointer", () => {
  function trigger() {
    return screen.getByRole("button", { name: "Insert" });
  }

  it("opens on the press", () => {
    renderToolbar(null, true);
    fireEvent.pointerDown(trigger());
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("keeps the caret in the editor by cancelling that press", () => {
    renderToolbar(null, true);
    expect(fireEvent.pointerDown(trigger())).toBe(false); // preventDefault()ed
  });

  it("stays open when the press's own click trails in", () => {
    renderToolbar(null, true);
    const button = trigger();
    fireEvent.pointerDown(button);
    // `detail` above 0 is what marks a click as a pointer's rather than a
    // keyboard activation — acting on it would shut the menu on opening.
    fireEvent.click(button, { detail: 1 });
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("still opens from a keyboard activation, which has no press", () => {
    renderToolbar(null, true);
    fireEvent.click(trigger(), { detail: 0 });
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});
