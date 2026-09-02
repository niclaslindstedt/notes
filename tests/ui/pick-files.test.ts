// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { pickFiles } from "../../src/ui/attachments/pick-files.ts";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The input `pickFiles` put in the document, caught at its `click()`. */
function catchInput(): Promise<HTMLInputElement> {
  return new Promise((resolve) => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      resolve(this);
    });
  });
}

/** Install `files` on the input the way a real pick would, then announce it. */
function choose(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("pickFiles", () => {
  it("opens the photo browser for images and resolves with the choice", async () => {
    const opened = catchInput();
    const picked = pickFiles({ accept: "image/*" });
    const input = await opened;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
    // In the document, not merely constructed: Safari ignores a click on a
    // detached input.
    expect(input.isConnected).toBe(true);

    const file = new File(["x"], "cat.png", { type: "image/png" });
    choose(input, [file]);
    expect(await picked).toEqual([file]);
    // And it tidies up after itself.
    expect(input.isConnected).toBe(false);
  });

  it("offers every file type when no accept is given", async () => {
    const opened = catchInput();
    const picked = pickFiles();
    const input = await opened;
    expect(input.accept).toBe("");
    choose(input, []);
    expect(await picked).toEqual([]);
  });

  it("resolves empty — and cleans up — when the picker is backed out of", async () => {
    const opened = catchInput();
    const picked = pickFiles();
    const input = await opened;
    input.dispatchEvent(new Event("cancel"));
    expect(await picked).toEqual([]);
    expect(input.isConnected).toBe(false);
  });
});
