// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";

function renderEditor(body: string) {
  const onChange = vi.fn();
  const utils = render(
    <MarkdownEditor body={body} onChange={onChange} wordWrap maxWidth="none" />,
  );
  return { onChange, ...utils };
}

// The active line is the one the caret sits on; it's the only <textarea>.
function activeTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function caretAt(ta: HTMLTextAreaElement, pos: number) {
  ta.setSelectionRange(pos, pos);
}

describe("MarkdownEditor", () => {
  it("renders every non-active line as formatted Markdown", () => {
    // Two lines; the caret opens on the last, so the first renders formatted.
    renderEditor("**bold**\nplain");
    // The leaf text sits in a source-stamped span inside the <strong>.
    expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    // The active (last) line shows its raw source in the textarea.
    expect(activeTextarea().value).toBe("plain");
  });

  it("edits the active line and reports the whole body", () => {
    const { onChange } = renderEditor("hello");
    fireEvent.change(activeTextarea(), { target: { value: "hello!" } });
    expect(onChange).toHaveBeenLastCalledWith("hello!");
  });

  it("splits the line on Enter at the caret", () => {
    const { onChange } = renderEditor("hello");
    const ta = activeTextarea();
    caretAt(ta, 2);
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("merges into the previous line on Backspace at column 0", () => {
    const { onChange } = renderEditor("a\nb");
    const ta = activeTextarea();
    expect(ta.value).toBe("b"); // caret opens on the last line
    caretAt(ta, 0);
    fireEvent.keyDown(ta, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("does not hijack Backspace mid-line", () => {
    const { onChange } = renderEditor("a\nbc");
    const ta = activeTextarea();
    caretAt(ta, 1);
    fireEvent.keyDown(ta, { key: "Backspace" });
    // The browser handles the delete; we don't splice lines.
    expect(onChange).not.toHaveBeenCalled();
  });
});
