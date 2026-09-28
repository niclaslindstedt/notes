// @vitest-environment jsdom
// The save-file bridge (`native/src/saveFileBridge.ts`) and the exports that
// use it: the note as `.md` or PDF (`src/ui/export/export-note.ts`), through
// the framework's `saveFile`.
//
// In a browser an export downloads; in the phone app, whose WebView cannot
// download, the shell's `save-file` capability sends it to the share sheet.
// Nothing here runs on a phone, and each failure is quiet — an export that
// does nothing — so both halves are pinned: the contract names against the
// framework's, and a whole round trip (the injected descriptor, the posted
// request, the injected answer) against this jsdom page. `saveFile.ts` (the
// expo half) stays out of reach of the root install, as `icloud.ts` does.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SAVE_FILE_MESSAGE,
  SAVE_FILE_RESULT_EVENT,
} from "@niclaslindstedt/oss-framework/files";

import {
  SAVE_FILE_DESCRIPTOR,
  SAVE_FILE_RESULT_EVENT as SHELL_RESULT_EVENT,
  SAVE_FILE_TYPE,
  UTI,
  bareName,
  isSaveFileRequest,
  saveFileResultScript,
} from "../native/src/saveFileBridge.ts";
import type { Note } from "../src/domain/note.ts";
import { noteToMarkdown } from "../src/storage/markdown/codec.ts";
import { downloadMarkdown, exportPdf } from "../src/ui/export/export-note.ts";
import { DEFAULT_PDF_SETTINGS } from "../src/domain/pdf.ts";

// The PDF writer is jsPDF, which jsdom cannot drive; what is under test is
// where its bytes go.
vi.mock("../src/ui/export/pdf-document.ts", () => ({
  buildPdf: vi.fn(() =>
    Promise.resolve(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
  ),
}));

const note: Note = {
  id: "n1",
  title: "Åka hem",
  body: "- [ ] milk\n- [x] bread",
  createdAt: 0,
  updatedAt: 0,
};

type ShellWindow = Window & {
  ReactNativeWebView?: { postMessage: (m: string) => void };
  __ossShell?: unknown;
};
const win = window as ShellWindow;

/** The phone app's WebView: the react-native-webview bridge, recording what
 *  the page posts, and (unless `advertise` is false) the shell's descriptor,
 *  injected the way the WebView does. */
function inShell({ advertise = true } = {}) {
  const posted: string[] = [];
  win.ReactNativeWebView = { postMessage: (m) => posted.push(m) };
  if (advertise) inject(SAVE_FILE_DESCRIPTOR);
  return posted;
}

function inject(script: string) {
  new Function(script)();
}

/** Record browser downloads: the anchor the framework clicks. */
function recordDownloads() {
  const clicked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:page/1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.download);
  });
  return clicked;
}

async function nextPost(posted: string[]) {
  await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
  const parsed: unknown = JSON.parse(posted[0]!);
  if (!isSaveFileRequest(parsed)) throw new Error("not a save-file request");
  return parsed;
}

function decode(base64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete win.ReactNativeWebView;
  delete win.__ossShell;
});

describe("the contract", () => {
  it("speaks the framework's message and event names", () => {
    expect(SAVE_FILE_TYPE).toBe(SAVE_FILE_MESSAGE);
    expect(SHELL_RESULT_EVENT).toBe(SAVE_FILE_RESULT_EVENT);
  });

  it("names a UTI for every type the app exports", () => {
    for (const mime of ["text/markdown", "application/pdf"]) {
      expect(UTI[mime]).toBeTruthy();
    }
  });

  it("keeps only the last path component of a name", () => {
    expect(bareName("../../notes/åka-hem.md")).toBe("åka-hem.md");
    expect(bareName("..")).toBe("file");
  });

  it("merges into a descriptor another script set, once", () => {
    win.__ossShell = { version: 1, capabilities: ["something-else"] };
    inject(SAVE_FILE_DESCRIPTOR);
    inject(SAVE_FILE_DESCRIPTOR);
    expect(win.__ossShell).toEqual({
      version: 1,
      capabilities: ["something-else", "save-file"],
    });
  });
});

describe("an export in a browser", () => {
  it("downloads the note as .md", async () => {
    const clicked = recordDownloads();
    await expect(downloadMarkdown(note)).resolves.toBe(true);
    expect(clicked).toEqual(["åka-hem.md"]);
  });

  it("downloads in a WebView that has not advertised save-file", async () => {
    const clicked = recordDownloads();
    const posted = inShell({ advertise: false });
    await expect(downloadMarkdown(note)).resolves.toBe(true);
    expect(clicked).toEqual(["åka-hem.md"]);
    expect(posted).toEqual([]);
  });
});

describe("an export in the phone app", () => {
  it("sends the .md to the share sheet and settles on the answer", async () => {
    const clicked = recordDownloads();
    const posted = inShell();
    const done = downloadMarkdown(note);
    const request = await nextPost(posted);
    expect(request).toMatchObject({
      type: SAVE_FILE_TYPE,
      version: 1,
      filename: "åka-hem.md",
      mimeType: "text/markdown",
    });
    expect(decode(request.base64)).toBe(noteToMarkdown(note));

    inject(saveFileResultScript(request.id, true));
    await expect(done).resolves.toBe(true);
    expect(clicked).toEqual([]);
  });

  it("sends the PDF to the share sheet", async () => {
    const posted = inShell();
    const done = exportPdf(note, DEFAULT_PDF_SETTINGS);
    const request = await nextPost(posted);
    expect(request).toMatchObject({
      filename: "åka-hem.pdf",
      mimeType: "application/pdf",
    });
    expect(decode(request.base64)).toBe("%PDF-1.7");
    inject(saveFileResultScript(request.id, true));
    await expect(done).resolves.toBe(true);
  });

  it("reports a failed share, so the button can say so", async () => {
    const posted = inShell();
    const done = downloadMarkdown(note);
    const request = await nextPost(posted);
    // An answer for another request is not this one's.
    inject(saveFileResultScript("someone-else", true));
    inject(
      // U+2028 in the message must not break the injected script.
      saveFileResultScript(request.id, false, "Sharing is unavailable."),
    );
    await expect(done).resolves.toBe(false);
  });
});
