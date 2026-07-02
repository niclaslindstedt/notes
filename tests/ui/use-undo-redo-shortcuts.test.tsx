// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useUndoRedoShortcuts } from "../../src/ui/hooks/useUndoRedoShortcuts.ts";

// Mount the hook and expose the spies for the four callbacks.
function mount(over?: Partial<Parameters<typeof useUndoRedoShortcuts>[0]>) {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const params = {
    canUndo: true,
    canRedo: true,
    onUndo,
    onRedo,
    ...over,
  };
  const view = renderHook((p: typeof params) => useUndoRedoShortcuts(p), {
    initialProps: params,
  });
  return { onUndo, onRedo, view };
}

// Dispatch a keydown on `target` (defaulting to a bare div) and report whether
// the browser default was prevented, mirroring the real bubble to `window`.
function press(
  key: string,
  opts: { shift?: boolean; target?: Element } = {},
): boolean {
  const target = opts.target ?? document.createElement("div");
  if (!target.isConnected) document.body.appendChild(target);
  const e = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

// A live-preview-editor-style host: a focusable contenteditable surface.
function contenteditable(): HTMLElement {
  const el = document.createElement("div");
  el.contentEditable = "true";
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useUndoRedoShortcuts", () => {
  it("fires undo on Cmd/Ctrl+Z and redo on Cmd/Ctrl+Y", () => {
    const { onUndo, onRedo } = mount();
    expect(press("z")).toBe(true);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(press("y")).toBe(true);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("treats Cmd/Ctrl+Shift+Z as redo", () => {
    const { onUndo, onRedo } = mount();
    press("z", { shift: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  // The regression: the live-preview editor disables native contenteditable
  // undo, so the shortcut must still act while the caret sits in a note.
  it("fires inside the live-preview editor's contenteditable", () => {
    const { onUndo } = mount();
    expect(press("z", { target: contenteditable() })).toBe(true);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("stands down inside a plain input so native field undo wins", () => {
    const { onUndo } = mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(press("z", { target: input })).toBe(false);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("stays a no-op at the ends of the timeline", () => {
    const { onUndo, onRedo } = mount({ canUndo: false, canRedo: false });
    expect(press("z")).toBe(false);
    expect(press("y")).toBe(false);
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });
});
