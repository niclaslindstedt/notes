// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileAttachment } from "../../src/ui/attachments/FileAttachment.tsx";

// A file attachment's chip saves the file through the framework's `saveFile`:
// a download in a browser, the share sheet in the phone app, where following
// the chip's `data:` link would go nowhere.

const attachment = {
  filename: "offer.pdf",
  mime: "application/pdf",
  data: "data:application/pdf;base64,JVBERi0=",
};

type ShellWindow = Window & {
  ReactNativeWebView?: { postMessage: (m: string) => void };
  __ossShell?: unknown;
};
const win = window as ShellWindow;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete win.ReactNativeWebView;
  delete win.__ossShell;
});

describe("FileAttachment", () => {
  it("downloads the file in a browser", () => {
    const clicked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:page/1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    render(<FileAttachment attachment={attachment} srcOffset={0} />);
    const chip = screen.getByTitle("offer.pdf");
    // After the chip is on the page: the framework's download clicks a
    // transient anchor of its own, and that is the click recorded.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    const followed = fireEvent.click(chip);
    // The chip's own navigation is cancelled either way.
    expect(followed).toBe(false);
    expect(clicked).toEqual(["offer.pdf"]);
  });

  it("hands the file to the share sheet in the phone app", async () => {
    const posted: string[] = [];
    win.ReactNativeWebView = { postMessage: (m) => posted.push(m) };
    win.__ossShell = { version: 1, capabilities: ["save-file"] };
    render(<FileAttachment attachment={attachment} srcOffset={0} />);
    fireEvent.click(screen.getByTitle("offer.pdf"));
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(posted[0]!)).toMatchObject({
      type: "oss-framework/save-file",
      filename: "offer.pdf",
      mimeType: "application/pdf",
      base64: "JVBERi0=",
    });
  });
});
