// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { LineComment } from "../../src/domain/note-comment.ts";
import { LineCommentModal } from "../../src/ui/LineCommentModal.tsx";
import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";

const editorProps = {
  wordWrap: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  maxWidth: "none",
  onTabOut: () => {},
  focusOnMount: false,
} as const;

const BODY = "alpha\nbravo\ncharlie";

function comment(over: Partial<LineComment> = {}): LineComment {
  return {
    id: "c1",
    lines: [1],
    text: "Needs a source",
    createdAt: 10,
    updatedAt: 10,
    ...over,
  };
}

describe("the comment gutter", () => {
  it("draws a bubble only on the lines that carry a comment", () => {
    const { container } = render(
      <MarkdownEditor
        body={BODY}
        onChange={() => {}}
        comments={[comment()]}
        onOpenComments={() => {}}
        {...editorProps}
      />,
    );
    const bubbles = container.querySelectorAll("[data-line-comment]");
    expect(bubbles).toHaveLength(1);
    expect(
      bubbles[0]!.closest("[data-line-row]")?.getAttribute("data-line-row"),
    ).toBe("1");
  });

  it("draws nothing, and reserves no column, on a note with no comments", () => {
    const { container } = render(
      <MarkdownEditor body={BODY} onChange={() => {}} {...editorProps} />,
    );
    expect(container.querySelector("[data-line-comment]")).toBeNull();
    expect(container.querySelector("[data-line-row]")).toBeNull();
  });

  it("asks the host to open the dialog for the line it was pressed on", () => {
    const onOpenComments = vi.fn();
    const { container } = render(
      <MarkdownEditor
        body={BODY}
        onChange={() => {}}
        comments={[comment({ lines: [2] })]}
        onOpenComments={onOpenComments}
        {...editorProps}
      />,
    );
    fireEvent.click(container.querySelector("[data-line-comment]")!);
    expect(onOpenComments).toHaveBeenCalledWith([2]);
  });

  it("keeps the bubble's press away from select mode's sweep", () => {
    const onSelectModeChange = vi.fn();
    const onOpenComments = vi.fn();
    const { container } = render(
      <MarkdownEditor
        body={BODY}
        onChange={() => {}}
        selectMode
        onSelectModeChange={onSelectModeChange}
        comments={[comment()]}
        onOpenComments={onOpenComments}
        {...editorProps}
      />,
    );
    const bubble = container.querySelector("[data-line-comment]")!;
    fireEvent.pointerDown(bubble, { clientX: 4, clientY: 4, pointerId: 1 });
    fireEvent.click(bubble);
    // The press opened the comment rather than painting the line.
    expect(onOpenComments).toHaveBeenCalledWith([1]);
    expect(container.querySelectorAll(".line-selected")).toHaveLength(0);
  });
});

describe("the comment dialog", () => {
  function open(extra?: Record<string, unknown>) {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <LineCommentModal
        open
        lines={[1]}
        comments={[]}
        compose
        onChange={onChange}
        onClose={onClose}
        {...extra}
      />,
    );
    return { onChange, onClose };
  }

  it("commits a written comment once, as it closes", () => {
    const { onChange, onClose } = open();
    fireEvent.input(screen.getByPlaceholderText(/what needs saying/i), {
      target: { value: "  check this  " },
    });
    // Nothing is written while it is being typed.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
    const [next] = onChange.mock.calls[0] as [LineComment[]];
    expect(next).toHaveLength(1);
    expect(next[0]!.text).toBe("check this");
    expect(next[0]!.lines).toEqual([1]);
  });

  it("writes nothing for a dialog opened and closed untouched", () => {
    const { onChange } = open({ comments: [comment()] });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the comments already on the line, and rewrites one on close", () => {
    const { onChange } = open({ comments: [comment()], compose: false });
    const field = screen.getByDisplayValue("Needs a source");
    fireEvent.input(field, { target: { value: "still true?" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const [next] = onChange.mock.calls[0] as [LineComment[]];
    expect(next[0]!.text).toBe("still true?");
    expect(next[0]!.id).toBe("c1");
  });

  it("deletes on the press, without waiting for the close", () => {
    const { onChange } = open({ comments: [comment()], compose: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete this comment" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clears the composer on Done, so the next close writes nothing", () => {
    // The host keeps the dialog mounted and only toggles `open`, so state that
    // survives a close comes back on the next one: reading a comment and
    // dismissing the dialog used to commit the previous composer's text again.
    const onChange = vi.fn();
    const onClose = vi.fn();
    const props = {
      lines: [1],
      comments: [] as LineComment[],
      compose: true,
      onChange,
      onClose,
    };
    const { rerender } = render(<LineCommentModal open {...props} />);
    fireEvent.input(screen.getByPlaceholderText(/what needs saying/i), {
      target: { value: "check this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledTimes(1);

    // Reopened — on the comment that was just written — and dismissed untouched.
    rerender(<LineCommentModal open={false} {...props} />);
    rerender(
      <LineCommentModal
        open
        {...props}
        compose={false}
        comments={[comment()]}
      />,
    );
    expect(
      (screen.getByPlaceholderText(/what needs saying/i) as HTMLTextAreaElement)
        .value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <LineCommentModal
        open={false}
        lines={[1]}
        comments={[comment()]}
        compose={false}
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
