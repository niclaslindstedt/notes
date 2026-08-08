// @vitest-environment jsdom
import { renderHook } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUndoRedoShortcuts } from "../../src/ui/hooks/useUndoRedoShortcuts.ts";

// jsdom implements neither `isContentEditable` nor the editing behaviour behind
// it, so fabricate the one property the guard reads — this is what tells the
// hook apart from a host that stands down on every contenteditable.
function contentEditableHost(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("contenteditable", "true");
  Object.defineProperty(el, "isContentEditable", { value: true });
  document.body.append(el);
  return el;
}

function press(
  target: EventTarget,
  key: string,
  mods: { shiftKey?: boolean } = {},
): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(e);
  return e;
}

function mount(overrides: Partial<Parameters<typeof useUndoRedoShortcuts>[0]>) {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  renderHook(() =>
    useUndoRedoShortcuts({
      canUndo: true,
      canRedo: true,
      onUndo,
      onRedo,
      ...overrides,
    }),
  );
  return { onUndo, onRedo };
}

describe("useUndoRedoShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The regression this hook exists for: the live-preview editor swallows the
  // browser's native contenteditable undo, so if the shortcut also stood down
  // there, ⌘Z would be dead while the caret sits in a note — working only once
  // the Undo button had moved focus out of the editor.
  it("answers ⌘Z inside the live-preview editor's contenteditable", () => {
    const { onUndo } = mount({});
    const e = press(contentEditableHost(), "z");
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("answers ⌘⇧Z and ⌘Y inside the contenteditable", () => {
    const { onRedo } = mount({});
    const host = contentEditableHost();
    press(host, "z", { shiftKey: true });
    press(host, "y");
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it.each(["input", "textarea", "select"])(
    "stands down inside a plain <%s> so its native undo wins",
    (tag) => {
      const { onUndo } = mount({});
      const field = document.createElement(tag);
      document.body.append(field);
      const e = press(field, "z");
      expect(onUndo).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    },
  );

  it("stays out of the way at the ends of the timeline", () => {
    const { onUndo, onRedo } = mount({ canUndo: false, canRedo: false });
    const host = contentEditableHost();
    const undo = press(host, "z");
    press(host, "y");
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(undo.defaultPrevented).toBe(false);
  });

  it("leaves the shortcut to whatever modal is on top", () => {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    const { onUndo } = mount({});
    press(contentEditableHost(), "z");
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("ignores a bare Z (no modifier)", () => {
    const { onUndo } = mount({});
    const e = new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
      cancelable: true,
    });
    contentEditableHost().dispatchEvent(e);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("unbinds on unmount", () => {
    const onUndo = vi.fn();
    const { unmount } = renderHook(() =>
      useUndoRedoShortcuts({
        canUndo: true,
        canRedo: true,
        onUndo,
        onRedo: vi.fn(),
      }),
    );
    unmount();
    press(contentEditableHost(), "z");
    expect(onUndo).not.toHaveBeenCalled();
  });
});
