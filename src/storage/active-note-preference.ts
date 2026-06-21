// Per-device, per-namespace cursor remembering which note was open in the
// editor, so a reload or a PWA upgrade lands back on the same note instead of
// dropping to the overview. Like the active-namespace pointer (see
// `namespaces.ts`) and the backend choice (`backend-preference.ts`), this is a
// local cursor — where *you* were looking, not shared document state — so it
// lives in localStorage rather than in the synced snapshot.
//
// Keyed by namespace slug because a note id only ever names a note in its own
// namespace's document; a cursor from one namespace must never be applied while
// another is active. A `null` value means "no note open" (the overview).

import { createLogger } from "../dev/logger.ts";

const log = createLogger("active-note-pref");

const KEY_PREFIX = "notes:active-note:";

function keyFor(namespaceSlug: string): string {
  return `${KEY_PREFIX}${namespaceSlug}`;
}

/** The note id that was open in the given namespace, or `null` if none. */
export function getActiveNote(namespaceSlug: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(keyFor(namespaceSlug));
  } catch {
    return null;
  }
}

/**
 * Remember the open note for a namespace. Passing `null` clears the cursor so
 * the namespace reopens on the overview.
 */
export function setActiveNote(namespaceSlug: string, id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const key = keyFor(namespaceSlug);
    if (id === null) localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  } catch (err) {
    log.warn(`write failed for ${namespaceSlug}`, err);
  }
}
