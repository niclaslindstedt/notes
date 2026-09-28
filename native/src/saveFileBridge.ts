// THE SAVE-FILE BRIDGE: how an export leaves the app.
//
// A browser export is a download — an anchor clicked at a `blob:` URL. Inside
// the WebView that click goes nowhere: the `blob:` URL exists only in the
// page, and the system has nothing to open it with. So the wrapper offers the
// framework's `save-file` contract (`docs/native-shell.md` in
// oss-framework): it lists "save-file" in `window.__ossShell.capabilities`
// before the page loads, and the framework's `saveFile` — which every export
// in `src/` goes through (`src/ui/export/export-note.ts`) — then posts the file
// here instead of downloading it. `saveFile.ts` writes it to the cache and
// opens the share sheet, where the user picks Files, Mail, another app or
// AirDrop.
//
// The wrapper decides nothing about the file: its name, type and bytes are the
// page's. It never keeps more than the latest export, and hands it to nothing
// but the share sheet.
//
// Same shape as `icloudBridge.ts`: this file holds the page-facing strings and
// the pure narrowing and settling helpers, is exercised from the root test
// suite (`tests/platform/save-file.test.ts`), and so imports nothing that
// reaches `expo`. The effect lives in `saveFile.ts`.

/** The message the page posts. The FRAMEWORK's name (`SAVE_FILE_MESSAGE` in
 *  `@niclaslindstedt/oss-framework/files`), not this app's. */
export const SAVE_FILE_TYPE = "oss-framework/save-file";

/** The window event that settles the page's promise (`SAVE_FILE_RESULT_EVENT`). */
export const SAVE_FILE_RESULT_EVENT = "oss-framework/save-file-result";

/** Injected BEFORE the page loads: the shell advertises the contract, merged
 *  into any descriptor another script set. */
export const SAVE_FILE_DESCRIPTOR = `(function () {
  var shell = window.__ossShell || { version: 1, capabilities: [] };
  if (!shell.capabilities) shell.capabilities = [];
  if (shell.capabilities.indexOf("save-file") < 0) shell.capabilities.push("save-file");
  window.__ossShell = shell;
})(); true;`;

export type SaveFileRequest = {
  type: string;
  version: number;
  id: string;
  filename: string;
  mimeType: string;
  base64: string;
};

export function isSaveFileRequest(value: unknown): value is SaveFileRequest {
  const m = value as Partial<SaveFileRequest> | null;
  return (
    typeof m === "object" &&
    m !== null &&
    m.type === SAVE_FILE_TYPE &&
    typeof m.version === "number" &&
    typeof m.id === "string" &&
    typeof m.filename === "string" &&
    typeof m.mimeType === "string" &&
    typeof m.base64 === "string"
  );
}

/** iOS picks share targets by UTI, not MIME type: one per type this app
 *  exports. */
export const UTI: Readonly<Record<string, string>> = {
  "application/json": "public.json",
  "application/octet-stream": "public.data",
  "application/pdf": "com.adobe.pdf",
  "application/zip": "public.zip-archive",
  "text/markdown": "net.daringfireball.markdown",
  "text/plain": "public.plain-text",
};

/** The last path component of the page's name, or `file` when that leaves
 *  nothing: the page already cleaned it, and the wrapper checks again. */
export function bareName(name: string): string {
  const last = name.split(/[\\/]/).pop()?.trim() ?? "";
  return last === "" || last === "." || last === ".." ? "file" : last;
}

/** The script that settles the page's promise for request `id`. */
export function saveFileResultScript(
  id: string,
  ok: boolean,
  error?: string,
): string {
  const detail = ok ? { id, ok } : { id, ok, error };
  // U+2028 / U+2029 are valid in JSON but end a line in an older parser.
  const literal = JSON.stringify(detail)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(
    SAVE_FILE_RESULT_EVENT,
  )}, { detail: ${literal} })); true;`;
}
