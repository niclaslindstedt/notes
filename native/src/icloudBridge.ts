// THE iCLOUD BRIDGE: how the page reads and writes the app's iCloud Drive
// container.
//
// The web app never learns it is running inside this wrapper. What it does is
// look for an iCLOUD PROVIDER on `window` — a capability, not an identity —
// and this is the script that installs one (see `src/platform/icloud-host.ts`
// at the repository root for the other side of the contract). A browser has no
// such provider and the whole backend, down to its entry in the storage
// picker, simply is not there.
//
// It rides beside the wrapper's other bridge (`bridge/on-message.ts`, whose
// envelopes carry `v` / `type` and are answered through `__NOTES_NATIVE__`)
// rather than inside it, because it is a different kind of thing: those are
// requests the page makes knowing it is in the app; this is a provider the page
// merely finds. The message type below keeps the two from ever being confused.
//
// `react-native-webview` gives us one message channel in each direction: the
// page posts strings out, and the app injects scripts in. That is enough for
// request/response as long as each call carries an id, so this module is:
//
//   • a script that defines `window.__notesICloud`, whose methods post a
//     request out and return a promise;
//   • `isICloudRequest`, which narrows an inbound message; and
//   • `resolveScript`, which builds the one line of JavaScript that settles
//     the promise back in the page.
//
// The wrapper decides nothing about the notes. It moves opaque files between
// the page and a folder in iCloud Drive: which file a note lives in, how
// attachments are filed beside it, whether it is sealed before it leaves the
// page, what a conflict means and when a save is due are all the web app's, in
// its directory adapter (`src/storage/directory-adapter.ts`). A wrapper that
// parsed a note would be a second implementation of the app's storage — and
// one that could see a note the page had meant to encrypt.
//
// Like the other injected scripts, this file exports STRINGS. Keep the
// page-side code dependency-free and ES5-ish — it runs in the WebView, not in
// Metro's bundle, so nothing in it is transpiled or polyfilled.

// From `icloudWire.ts`, NOT from `icloud.ts`: this module is pure and is
// exercised by the root test suite, which runs against an install that has no
// `expo` in it. Importing the types from their reader — even as a type-only
// import — puts the native module back in the root's type graph and turns CI
// red on a machine where it passes.
import type { ICloudResult } from "./icloudWire";

/** The message the page posts to ask for something. Namespaced, and without
 *  the `v` field the other bridge's envelopes carry, so the two are never
 *  confused. */
export const ICLOUD_REQUEST_TYPE = "notes-native/icloud-request";

/** The seven things the page may ask for — mirrors `ICloudHost`.
 *
 *  Text and bytes are separate pairs on purpose. A note is markdown (or, sealed,
 *  base64 text already) and crosses as text; an attachment is binary and
 *  crosses as base64, which is the only lossless way through a `postMessage`
 *  string. Folding them into one pair would mean base64-ing every note too, for
 *  no gain. */
export type ICloudMethod =
  "status" | "list" | "read" | "write" | "readBytes" | "writeBytes" | "remove";

export type ICloudRequest = {
  type: string;
  /** Correlates the answer with the promise waiting for it. */
  id: string;
  method: ICloudMethod;
  /** The method's arguments, all strings: a path, and for a write its payload
   *  (UTF-8 text, or base64 for `writeBytes`). */
  args: string[];
};

/** The event the page-side seam listens for. Must match `ICLOUD_HOST_EVENT`
 *  in `src/platform/icloud-host.ts` — a mismatch is not an error, it is a
 *  storage backend that never appears. Exported for the root test that pins
 *  the two. */
export const HOST_EVENT = "notes:icloud-host";

/** Where the provider installs itself. Must match `icloud-host.ts`'s
 *  `ICLOUD_HOST_PROPERTY`, and for the same reason. */
export const HOST_PROPERTY = "__notesICloud";

/** The page-side function an answer is delivered to. */
const RESOLVE_PROPERTY = "__notesICloudResolve";

/** The method names, spelled once so the script and the narrowing below cannot
 *  drift apart. */
export const METHODS: readonly ICloudMethod[] = [
  "status",
  "list",
  "read",
  "write",
  "readBytes",
  "writeBytes",
  "remove",
];

/**
 * The script that installs the provider.
 *
 * Injected before the page's own scripts run, so the provider is normally
 * already there on the app's first render. It still announces itself with an
 * event: the seam reads `window` once on mount and then listens, so if a
 * WebView ever runs it late the backend appears the moment it does rather than
 * never.
 *
 * A pending call is settled by `resolveScript` below. Nothing here times out:
 * a request that never comes back leaves a promise pending, which the sync
 * engine shows as a save still in flight rather than as a wrong answer — and
 * the only way one goes unanswered is the app being terminated mid-write.
 */
export const ICLOUD_SCRIPT = `(function () {
  if (window.${HOST_PROPERTY}) return;

  var pending = {};
  var next = 0;

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = "i" + (next += 1);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: ${JSON.stringify(ICLOUD_REQUEST_TYPE)},
          id: id,
          method: method,
          args: args || []
        }));
      } catch (e) {
        delete pending[id];
        // The bridge is gone: fail the call rather than hang. The sync engine
        // treats it as an ordinary backend failure and keeps the edit.
        reject(new Error("The iCloud bridge is unavailable."));
      }
    });
  }

  // Called by the app, through injectJavaScript, with the answer.
  window.${RESOLVE_PROPERTY} = function (id, result) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (result && result.ok) entry.resolve(result.value);
    else entry.reject(new Error((result && result.error) || "iCloud failed."));
  };

  window.${HOST_PROPERTY} = {
    version: 1,
    status: function () { return call("status", []); },
    list: function () { return call("list", []); },
    read: function (path) { return call("read", [path]); },
    write: function (path, text) { return call("write", [path, text]); },
    readBytes: function (path) { return call("readBytes", [path]); },
    writeBytes: function (path, base64) { return call("writeBytes", [path, base64]); },
    remove: function (path) { return call("remove", [path]); }
  };

  try {
    window.dispatchEvent(new Event(${JSON.stringify(HOST_EVENT)}));
  } catch (e) {
    // Very old WebViews: the app's own mount-time read still finds the
    // provider, it just does not get told about it.
  }
})(); true;`;

/** Narrow an arbitrary parsed `postMessage` body to an iCloud request. */
export function isICloudRequest(value: unknown): value is ICloudRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ICloudRequest>;
  if (message.type !== ICLOUD_REQUEST_TYPE) return false;
  if (typeof message.id !== "string" || message.id === "") return false;
  if (!METHODS.includes(message.method as ICloudMethod)) return false;
  return (
    Array.isArray(message.args) &&
    message.args.every((arg) => typeof arg === "string")
  );
}

/**
 * The line of JavaScript that settles one pending call.
 *
 * The answer is embedded as a JSON *string* and parsed in the page rather than
 * spliced in as a JavaScript literal, because the payload is somebody's notes:
 * a note is arbitrary user text, and text is exactly what breaks out of a
 * literal. `JSON.stringify` of the JSON text handles the
 * quoting; the two line separators below are the characters it does NOT escape
 * and which an older JavaScript parser treats as newlines, so they are escaped
 * by hand.
 */
export function resolveScript(
  id: string,
  result: ICloudResult<unknown>,
): string {
  const payload = escapeForScript(JSON.stringify({ id, result }));
  return `(function () {
    try {
      var answer = JSON.parse(${payload});
      if (window.${RESOLVE_PROPERTY}) {
        window.${RESOLVE_PROPERTY}(answer.id, answer.result);
      }
    } catch (e) {}
  })(); true;`;
}

/** A JavaScript string literal holding `text`, safe to splice into a script. */
function escapeForScript(text: string): string {
  return JSON.stringify(text)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
