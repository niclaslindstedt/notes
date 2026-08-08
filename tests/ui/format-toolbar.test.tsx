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

function renderToolbar(line: LineFormat | null = null) {
  const onAction = vi.fn();
  render(<FormatToolbar line={line} onAction={onAction} maxWidth="none" />);
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
