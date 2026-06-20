// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFileDrop } from "../../src/ui/hooks/useFileDrop.ts";

// Build a drag event whose data-transfer advertises the `Files` type, so the
// hook treats it as a genuine file-from-the-OS drag (jsdom has no DragEvent).
function fileDragEvent(type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: { types: ["Files"], files: [] },
  });
  return e;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFileDrop", () => {
  it("raises the overlay while a file drags over the window", () => {
    const { result } = renderHook(() =>
      useFileDrop({ enabled: true, onFiles: vi.fn() }),
    );
    expect(result.current.dragging).toBe(false);
    act(() => {
      document.dispatchEvent(fileDragEvent("dragenter"));
    });
    expect(result.current.dragging).toBe(true);
  });

  it("lowers the overlay even when a child claims the drop via stopPropagation", () => {
    // Mirrors the editor attaching a dropped image: its `onDrop` calls
    // `stopPropagation()`, which would otherwise stop the document-level drop
    // listener that clears the overlay. The capture-phase reset must still run.
    const { result } = renderHook(() =>
      useFileDrop({ enabled: true, onFiles: vi.fn() }),
    );
    const child = document.createElement("div");
    document.body.append(child);
    child.addEventListener("drop", (e) => e.stopPropagation());

    act(() => {
      child.dispatchEvent(fileDragEvent("dragenter"));
    });
    expect(result.current.dragging).toBe(true);

    act(() => {
      child.dispatchEvent(fileDragEvent("drop"));
    });
    expect(result.current.dragging).toBe(false);
  });

  it("lowers the overlay on an unclaimed drop", () => {
    const { result } = renderHook(() =>
      useFileDrop({ enabled: true, onFiles: vi.fn() }),
    );
    act(() => {
      document.dispatchEvent(fileDragEvent("dragenter"));
    });
    expect(result.current.dragging).toBe(true);
    act(() => {
      document.dispatchEvent(fileDragEvent("drop"));
    });
    expect(result.current.dragging).toBe(false);
  });
});
