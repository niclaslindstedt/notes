// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/preact";
import { useRef } from "react";

import { useEdgeHover } from "../../src/ui/hooks/useEdgeHover.ts";

afterEach(cleanup);

// jsdom lays nothing out, so the probe declares the band it occupies itself.
const BAND = { left: 240, right: 256, top: 0, bottom: 800 };

function Probe({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const hovering = useEdgeHover(ref, enabled);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) el.getBoundingClientRect = () => BAND as DOMRect;
      }}
      data-testid="probe"
    >
      {hovering ? "revealed" : "hidden"}
    </div>
  );
}

// The hook coalesces to one measurement per frame, so every move has to be
// followed by the frame that reads it.
async function move(x: number, y = 100, pointerType = "mouse") {
  await act(async () => {
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: x, clientY: y, pointerType }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

function state() {
  return screen.getByTestId("probe").textContent;
}

describe("useEdgeHover", () => {
  it("reveals only while the cursor is inside the watched band", async () => {
    render(<Probe />);
    expect(state()).toBe("hidden");

    await move(100);
    expect(state()).toBe("hidden");

    await move(248);
    expect(state()).toBe("revealed");

    // Well clear of the band — past the hysteresis slop — hides it again.
    await move(400);
    expect(state()).toBe("hidden");
  });

  it("keeps a cursor resting on the boundary from flickering", async () => {
    render(<Probe />);
    await move(248);
    expect(state()).toBe("revealed");
    // Two pixels outside the box: inside the entered band's grace, so the
    // control stays put rather than blinking out from under the pointer.
    await move(258);
    expect(state()).toBe("revealed");
  });

  it("ignores touch, which has no hover to leave", async () => {
    render(<Probe />);
    await move(248, 100, "touch");
    expect(state()).toBe("hidden");
  });

  it("stays hidden when disabled", async () => {
    render(<Probe enabled={false} />);
    await move(248);
    expect(state()).toBe("hidden");
  });

  it("forgets the cursor when it leaves the document", async () => {
    render(<Probe />);
    await move(248);
    expect(state()).toBe("revealed");
    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerleave"));
    });
    expect(state()).toBe("hidden");
  });
});
