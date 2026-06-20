// The small binary-file contract a file-based backend implements so the
// directory adapter (`./directory-adapter.ts`) can store a note's pasted
// images as real image files, beside the markdown note files but in their own
// `attachments/` tree.
//
// This is the binary sibling of `./file-store.ts`: where that moves a note's
// UTF-8 markdown, this moves an image's bytes. Paths are POSIX-style and
// relative to the backend's `attachments/` root — `<note-name>/<filename>` —
// and each backend roots its own store there (the local folder's
// `attachments/` directory, Dropbox's `/attachments`, Drive's `attachments`
// app subfolder), the same way the settings / namespace stores root at the
// app-folder root.
//
// Attachments are content-addressed by a unique filename (a random prefix per
// paste), so a given path's bytes never change — which is why this contract
// needs no per-file conflict token the way the markdown store does: a save
// only ever *adds* new files or *removes* orphaned ones, it never rewrites one
// in place.

/** A stored attachment file: its path relative to the `attachments/` root. */
export type AttachmentEntry = {
  /** e.g. `groceries-1a2b3c/9f8e-photo.png`. */
  path: string;
};

export interface AttachmentStore {
  /** Every attachment file under the root, recursively (one per image). */
  list(): Promise<AttachmentEntry[]>;
  /** Read one attachment's bytes, or null when it doesn't exist. */
  read(path: string): Promise<Uint8Array | null>;
  /**
   * Write (create or overwrite) one attachment, tagged with its MIME type.
   * The bytes are `ArrayBuffer`-backed (not `SharedArrayBuffer`) so they pass
   * straight to a `fetch` body / `Blob` / file-system writer without a copy.
   */
  write(
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
  ): Promise<void>;
  /** Delete one attachment. A missing file is treated as already gone. */
  remove(path: string): Promise<void>;
}

// -- data: URL <-> bytes ----------------------------------------------
//
// In memory an attachment is a `data:` URL on the note; on disk it's raw
// bytes. These two converters are the seam, kept here (not in `domain/`)
// because they're a persistence concern and lean on `atob` / `btoa`.

/** Parsed pieces of a base64 `data:` URL. */
export type DataUrl = { mime: string; bytes: Uint8Array<ArrayBuffer> };

/**
 * Decode a base64 `data:` URL into its MIME type and bytes, or null when the
 * string isn't a base64 data URL (a remote `http(s)` image reference, say,
 * which has no bytes to externalise).
 */
export function dataUrlToBytes(dataUrl: string | undefined): DataUrl | null {
  if (!dataUrl) return null;
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || !match[2]) return null;
  const mime = match[1] || "application/octet-stream";
  try {
    const binary = atob(match[3]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** Encode bytes + MIME type into a base64 `data:` URL. */
export function bytesToDataUrl(mime: string, bytes: Uint8Array): string {
  let binary = "";
  // Chunked so a large image doesn't blow the argument limit of
  // `String.fromCharCode(...spread)`.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
