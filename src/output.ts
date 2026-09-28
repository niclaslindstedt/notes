// The central output module (OSS_SPEC §19.4): the semantic helpers a
// user-facing diagnostic line goes through instead of a bare `console.*`
// call. They write into the in-app logger (`src/dev/logger.ts`), which has no
// console sink and keeps a bounded buffer the Logs tab reads (mirrored to
// storage while "Capture logs" is on), so "what did the app just do?" is
// answerable on the device.

import { createLogger } from "./dev/logger.ts";

const out = createLogger("app");

/** A normal progress/state line ("Loaded 3 notes", "Backend connected"). */
export function status(message: string): void {
  out.info(message);
}

/** Supplementary detail a user only reads when digging. */
export function info(message: string): void {
  out.info(message);
}

/** Something odd but recoverable — the app continues. */
export function warn(message: string): void {
  out.warn(message);
}

/** A failure the user should know about. */
export function error(message: string): void {
  out.error(message);
}

/** A section marker used to group related lines in the log stream. */
export function header(message: string): void {
  out.info(`── ${message} ──`);
}
