// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { type Attachment } from "../../src/domain/attachment.ts";
import { ImageViewer } from "../../src/ui/attachments/ImageViewer.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ATTACHMENTS: Attachment[] = [
  { filename: "a.png", mime: "image/png", data: "data:image/png;base64,AAA" },
  { filename: "b.png", mime: "image/png", data: "data:image/png;base64,BBB" },
  { filename: "c.png", mime: "image/png", data: "data:image/png;base64,CCC" },
];

function renderViewer(index: number) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ImageViewer
      attachments={ATTACHMENTS}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />,
  );
  return { onIndexChange, onClose, ...utils };
}

describe("ImageViewer", () => {
  it("shows a 1-based counter against the total", () => {
    renderViewer(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("lays every image on one sliding track parked on the active index", () => {
    const { container } = renderViewer(1);
    // One slide per attachment, all rendered so the track can slide between
    // them rather than swapping the single visible image.
    expect(container.querySelectorAll("img").length).toBe(ATTACHMENTS.length);
    const track = container.querySelector<HTMLElement>(
      "[style*='translate3d']",
    );
    expect(track?.style.transform).toContain("-100%");
  });

  it("steps to the next image with the arrow key", () => {
    const { onIndexChange } = renderViewer(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("does not step past the last image", () => {
    const { onIndexChange } = renderViewer(ATTACHMENTS.length - 1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderViewer(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
