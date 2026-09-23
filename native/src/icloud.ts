// WHAT THE WRAPPER DOES WITH AN iCLOUD REQUEST FROM THE PAGE.
//
// The page asks (see `icloudBridge.ts`), this answers. Its own job is the two
// things neither the bridge nor the native module should own:
//
//   • DEGRADING. The native module is loaded optionally and is Apple-only, so
//     an Android build, Expo Go or a bare `expo start` reports "unavailable"
//     and the web app simply does not offer the backend. iCloud is the one
//     storage backend this wrapper adds; it is not allowed to be the reason
//     the app fails to start.
//   • TURNING A THROW INTO AN ANSWER. Every failure crosses the bridge as
//     `{ ok: false, error }` rather than as a rejected promise, because the
//     channel carries strings. The page-side script turns it back into a
//     thrown `Error`, so the web app's sync engine sees an ordinary backend
//     failure and surfaces its usual fault.
//
// Nothing here is cached and nothing is logged: the payloads are somebody's
// notes (sealed already, when encryption is on), and the only place they
// belong is the container and the page that asked for them.

import type { ICloudMethod } from "./icloudBridge";
import type { ICloudEntry, ICloudResult, ICloudStatus } from "./icloudWire";

type Native = {
  isAvailable(): Promise<boolean>;
  list(): Promise<{ path: string; rev: string }[]>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<string | null>;
  writeBytes(path: string, base64: string): Promise<void>;
  remove(path: string): Promise<void>;
};

// `undefined` = not resolved yet; `null` = resolved to unavailable.
let cached: Native | null | undefined;

/** The native module, or null in a build that does not carry it. Memoised. */
function native(): Native | null {
  if (cached !== undefined) return cached;
  try {
    // Required lazily so a build without the module does not fail at import.
    const module = require("../modules/icloud-store") as {
      default?: Native | null;
      ICloudStore?: Native | null;
    };
    cached = module.ICloudStore ?? module.default ?? null;
  } catch {
    cached = null;
  }
  if (cached === null) {
    console.warn("[icloud] native module unavailable — iCloud sync is off");
  }
  return cached;
}

/** Whether the container can be used right now. Never throws: a device with no
 *  iCloud account is a state, not a failure. */
export async function icloudStatus(): Promise<ICloudStatus> {
  const module = native();
  if (!module) return "unavailable";
  try {
    return (await module.isAvailable()) ? "ready" : "signed-out";
  } catch {
    return "signed-out";
  }
}

/**
 * Run one request from the page and package the outcome.
 *
 * `args` arrives already narrowed to a string array (`isICloudRequest`), so
 * the only validation left is arity — a method called with the wrong number of
 * arguments is a bug in the page-side script, and answering it with a clear
 * error beats writing a file named `undefined`.
 */
export async function answerICloud(
  method: ICloudMethod,
  args: readonly string[],
): Promise<ICloudResult<unknown>> {
  try {
    if (method === "status") {
      return { ok: true, value: await icloudStatus() };
    }
    const module = native();
    if (!module) throw new Error("iCloud is not available on this device.");

    switch (method) {
      case "list": {
        const entries = await module.list();
        const value: ICloudEntry[] = entries.map((entry) => ({
          path: entry.path,
          rev: entry.rev,
        }));
        return { ok: true, value };
      }
      case "read":
        return {
          ok: true,
          value: await module.readText(need(args, 0, method)),
        };
      case "readBytes":
        return {
          ok: true,
          value: await module.readBytes(need(args, 0, method)),
        };
      case "write":
        await module.writeText(need(args, 0, method), need(args, 1, method));
        return { ok: true, value: null };
      case "writeBytes":
        await module.writeBytes(need(args, 0, method), need(args, 1, method));
        return { ok: true, value: null };
      case "remove":
        await module.remove(need(args, 0, method));
        return { ok: true, value: null };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** One required argument, or a named failure. */
function need(
  args: readonly string[],
  index: number,
  method: ICloudMethod,
): string {
  const value = args[index];
  if (typeof value !== "string") {
    throw new Error(`iCloud ${method}: argument ${index + 1} is missing.`);
  }
  return value;
}
