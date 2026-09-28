// The save-file bridge's one effect: write the page's export to the cache and
// open the share sheet. The contract, the guard and the answer script are in
// the import-free `saveFileBridge.ts`; this is the half that needs `expo`.
// Not cached and not logged: the payload is the user's note.

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
  UTI,
  bareName,
  saveFileResultScript,
  type SaveFileRequest,
} from "./saveFileBridge";

/** Write the bytes to the cache, open the share sheet, answer the page once. */
export async function answerSaveFile(
  request: SaveFileRequest,
  inject: (script: string) => void,
): Promise<void> {
  if (request.version !== 1) {
    inject(saveFileResultScript(request.id, false, "Unsupported version."));
    return;
  }
  // One directory per request, so the file keeps exactly the name the user
  // sees in the sheet. The previous export's directory goes first: it is not
  // deleted when its sheet closes, because an Android target may still be
  // reading it after the chooser has returned.
  const root = `${FileSystem.cacheDirectory}exports/`;
  const dir = `${root}${request.id.replace(/[^\w-]/g, "_")}/`;
  const name = bareName(request.filename);
  const uri = dir + name;
  try {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is not available on this device.");
    }
    await FileSystem.deleteAsync(root, { idempotent: true });
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.writeAsStringAsync(uri, request.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(uri, {
      mimeType: request.mimeType,
      UTI: UTI[request.mimeType],
      dialogTitle: name,
    });
    inject(saveFileResultScript(request.id, true));
  } catch (error) {
    inject(
      saveFileResultScript(
        request.id,
        false,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}
