// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EditorSection } from "../../src/ui/settings/EditorSection.tsx";
import { DEFAULT_APPEARANCE } from "../../src/theme/useTheme.ts";

describe("EditorSection", () => {
  it("renders the margin, word-wrap, and Markdown controls", () => {
    render(
      <EditorSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "None" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Large" })).toBeTruthy();
    expect(screen.getByLabelText("Word wrap")).toBeTruthy();
    expect(screen.getByLabelText("Render Markdown")).toBeTruthy();
  });

  it("commits a margin change through onUpdate, preserving the rest", () => {
    const onUpdate = vi.fn();
    render(
      <EditorSection appearance={DEFAULT_APPEARANCE} onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(onUpdate).toHaveBeenCalledWith("editor", {
      ...DEFAULT_APPEARANCE.editor,
      margin: "lg",
    });
  });

  it("toggles word wrap off", () => {
    const onUpdate = vi.fn();
    render(
      <EditorSection appearance={DEFAULT_APPEARANCE} onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByLabelText("Word wrap"));
    expect(onUpdate).toHaveBeenCalledWith("editor", {
      ...DEFAULT_APPEARANCE.editor,
      wordWrap: false,
    });
  });
});
