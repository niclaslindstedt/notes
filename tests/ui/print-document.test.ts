// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { printHtmlDocument } from "../../src/ui/export/print-document.ts";

const DOC = [
  "<!doctype html>",
  "<html><head><title>My Note</title></head>",
  "<body><h1>My Note</h1><p>hello world</p></body></html>",
].join("");

type Printed = { url: string; body: string };

// Watch the one iframe `printHtmlDocument` inserts: what `srcdoc` it carried at
// the moment it was inserted, and what document each `print()` call actually
// saw. Insertion is the interesting moment — an iframe inserted without a
// `srcdoc` gets an initial `about:blank` document that fires a `load` of its
// own (synchronously, in Chromium), which is what used to be printed instead of
// the note.
function watchFrame(printed: Printed[]): {
  srcdocAtInsert: () => string | null;
} {
  let atInsert: string | null = null;
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) {
      atInsert = node.getAttribute("srcdoc");
      const win = node.contentWindow;
      if (win) {
        win.print = () => {
          printed.push({
            url: win.location.href,
            body: win.document.body?.innerHTML ?? "",
          });
        };
      }
    }
    return result;
  });
  return { srcdocAtInsert: () => atInsert };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("printHtmlDocument", () => {
  it("gives the frame its document before inserting it", () => {
    const frame = watchFrame([]);

    void printHtmlDocument(DOC);

    expect(frame.srcdocAtInsert()).toContain("hello world");
  });

  it("never prints the frame's initial blank document", async () => {
    const printed: Printed[] = [];
    watchFrame(printed);

    const pending = printHtmlDocument(DOC);
    // Long enough for the blank document's `load` to have been delivered.
    await vi.advanceTimersByTimeAsync(50);

    expect(printed).toEqual([]);

    // jsdom does not navigate a `srcdoc` frame at all, so the wait runs out —
    // which must report failure rather than fall back to printing the blank
    // page it is still sitting on.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe(false);
    expect(printed).toEqual([]);
  });
});
