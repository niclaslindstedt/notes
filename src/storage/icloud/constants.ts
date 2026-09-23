// The iCloud Drive backend's names, kept apart from `./index.ts` so the
// settings panel and the sync details can show them without pulling the
// directory adapter into their chunk (see `../remote-backends.ts`).

import { DEFAULT_NAMESPACE_SLUG, namespaceNotesFolder } from "../namespaces.ts";

/** The backend's display name. Not a listing coordinate — it names a product. */
export const ICLOUD_LABEL = "iCloud Drive";

/**
 * What the app's folder is called in the Files app — the
 * `NSUbiquitousContainerName` `native/app.config.js` declares for the
 * container. The root test suite pins the two together.
 */
export const ICLOUD_FOLDER_NAME = "Notes";

/**
 * Where a namespace's notes are, as the user finds them in the Files app —
 * shown by the sync details dialog.
 */
export function icloudNotesPath(
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): string {
  return `iCloud Drive/${ICLOUD_FOLDER_NAME}/${namespaceNotesFolder(namespace)}`;
}
