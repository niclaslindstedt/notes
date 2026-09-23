// iCloud Drive-backed `StorageAdapter`, over a host that offers the capability
// (`../../platform/icloud-host.ts`) — in practice the iOS app, whose wrapper
// files each note into the app's own iCloud Drive container.
//
// ## A directory backend, like folder / Dropbox / Nextcloud
//
// iCloud Drive is a folder, not a service with an API, so this backend is the
// picked-folder backend with a different transport underneath. The markdown
// <-> snapshot conversion, per-file at-rest encryption, attachment
// externalisation and conflict detection all live in the shared directory
// adapter (`../directory-adapter.ts`); this module only implements the small
// `FileStore` / `AttachmentStore` that move one file's bytes at a time. The
// on-disk layout is the one every other file backend writes (`<ns>/notes/*.md`,
// `<ns>/attachments/<stem>/*`, `settings.json` and `namespaces.json` at the
// root), filed under the container's document folder, so it shows up in the
// Files app as an ordinary folder of markdown notes.
//
// ## Encryption
//
// Exactly as for Dropbox: the injected `DirectoryCrypto` makes the directory
// adapter seal each note and attachment (gzip + AES-GCM) *before* it reaches
// the store below, so with encryption on the host — and so the wrapper and
// iCloud — only ever sees `.enc` ciphertext under opaque names. The appearance
// settings and the namespace list stay plaintext JSON, as they do on every
// file backend, so the unlock screen can wear the user's theme.
//
// ## What this layer owns
//
//   • PATHS. The host lists the whole container; each store here is rooted at
//     one folder of it and sees only the files under that folder, relative to
//     it — the same shape the Dropbox and Nextcloud stores give the adapter.
//   • BASE64. The bridge to a host is a string channel, so attachment bytes
//     cross as base64 and are decoded here. Notes do not: they are text (a
//     sealed note is base64 text already) and cross as themselves.
//   • NO OFFLINE MIRROR. The container is a folder on the device's own disk and
//     iCloud syncs it underneath on its own schedule, so — like the picked
//     folder, unlike Dropbox — there is no network to be offline from and no
//     local cache to keep.

import { createLogger } from "../../dev/logger.ts";
import type { ICloudHost } from "../../platform/icloud-host.ts";
import { parseICloudEntries } from "../../platform/icloud-host.ts";
import type { StorageAdapter } from "../adapter.ts";
import type { AttachmentEntry, AttachmentStore } from "../attachment-store.ts";
import {
  type DirectoryCrypto,
  createDirectoryAdapter,
} from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceAttachmentsFolder,
  namespaceCloudFolder,
  namespaceNotesFolder,
} from "../namespaces.ts";
import {
  fileNamespaceStore,
  type NamespaceRegistryStore,
} from "../namespace-store.ts";
import {
  fileNamespaceSettingsStore,
  type NamespaceSettingsStore,
} from "../namespace-settings-store.ts";
import { fileSettingsStore, type SettingsStore } from "../settings-store.ts";
import { ICLOUD_LABEL } from "./constants.ts";

export {
  ICLOUD_FOLDER_NAME,
  ICLOUD_LABEL,
  icloudNotesPath,
} from "./constants.ts";

const log = createLogger("icloud");

// Half a second, matching the picked folder: a write is a local file write,
// and iCloud batches the upload itself.
const SAVE_DEBOUNCE_MS = 500;

// ---- Paths ----------------------------------------------------------

function joinPath(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("/");
}

/**
 * The files under `root`, with paths relative to it. `recursive` keeps files in
 * subfolders (a note filed into a folder, an attachment under its note's
 * folder); otherwise only the files directly in `root` are kept — the settings
 * and namespace stores at the container root must not see every namespace's
 * notes.
 */
function filesUnder(
  entries: readonly FileEntry[],
  root: string,
  recursive: boolean,
): FileEntry[] {
  const prefix = root ? `${root}/` : "";
  const out: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const path = entry.path.slice(prefix.length);
    if (!path || (!recursive && path.includes("/"))) continue;
    out.push(entry.rev === undefined ? { path } : { path, rev: entry.rev });
  }
  return out;
}

// ---- The stores -----------------------------------------------------

/**
 * A `FileStore` rooted at one container-relative folder. `recursive` is set for
 * the notes store so a note filed into a
 * [folder](../../../docs/overview.md#folders-sidecar) subdirectory is found.
 *
 * `write` reports no revision: the host answers a write with nothing, so the
 * directory adapter re-lists to stamp the post-save revision — cheap here,
 * since the listing is a walk of a folder on the device's own disk.
 */
function createICloudFileStore(
  host: ICloudHost,
  root: string,
  recursive: boolean = false,
): FileStore {
  return {
    async list(): Promise<FileEntry[]> {
      return filesUnder(parseICloudEntries(await host.list()), root, recursive);
    },
    read: (path) => host.read(joinPath(root, path)),
    async write(path, text): Promise<string | undefined> {
      await host.write(joinPath(root, path), text);
      return undefined;
    },
    remove: (path) => host.remove(joinPath(root, path)),
  };
}

/**
 * The binary sibling: a note's attachments under
 * `<namespace>/attachments/<note-stem>/`. Keeps only the nested files, so a
 * stray file sitting directly in `attachments/` is never mistaken for one.
 */
function createICloudAttachmentStore(
  host: ICloudHost,
  root: string,
): AttachmentStore {
  return {
    async list(): Promise<AttachmentEntry[]> {
      return filesUnder(parseICloudEntries(await host.list()), root, true)
        .filter((entry) => entry.path.includes("/"))
        .map((entry) => ({ path: entry.path }));
    },
    async read(path): Promise<Uint8Array | null> {
      const base64 = await host.readBytes(joinPath(root, path));
      return base64 === null ? null : base64ToBytes(base64);
    },
    // The MIME type rides the note JSON (plaintext) or the sealed blob header
    // (encrypted), so the bytes go up opaque — a file in iCloud Drive carries
    // its type in its extension, exactly as one in a picked folder does.
    async write(path, bytes): Promise<void> {
      await host.writeBytes(joinPath(root, path), bytesToBase64(bytes));
    },
    remove: (path) => host.remove(joinPath(root, path)),
  };
}

/**
 * Build an iCloud Drive adapter for one namespace. `crypto` is the injected
 * session passphrase, threaded into the directory adapter so notes and
 * attachments are sealed per file before they reach the host — exactly like
 * the folder / Dropbox / Nextcloud backends.
 */
export function createICloudAdapter(
  host: ICloudHost,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  log.info(`adapter created ns=${namespace}`);
  return createDirectoryAdapter(
    createICloudFileStore(host, namespaceNotesFolder(namespace), true),
    { id: "icloud", label: ICLOUD_LABEL, saveDebounceMs: SAVE_DEBOUNCE_MS },
    createICloudAttachmentStore(host, namespaceAttachmentsFolder(namespace)),
    crypto,
  );
}

/**
 * The root settings store — `settings.json` at the container's document root,
 * beside the namespace folders, so appearance settings reach every device
 * signed in to the same Apple Account.
 */
export function createICloudSettingsStore(host: ICloudHost): SettingsStore {
  return fileSettingsStore(createICloudFileStore(host, ""));
}

/**
 * The namespace-scoped settings store — `namespace-settings.json` inside the
 * namespace's own folder.
 */
export function createICloudNamespaceSettingsStore(
  host: ICloudHost,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): NamespaceSettingsStore {
  return fileNamespaceSettingsStore(
    createICloudFileStore(host, namespaceCloudFolder(namespace)),
  );
}

/**
 * The root namespace-registry store — `namespaces.json` beside `settings.json`,
 * so the namespaces created on one device appear on the others.
 */
export function createICloudNamespaceStore(
  host: ICloudHost,
): NamespaceRegistryStore {
  return fileNamespaceStore(createICloudFileStore(host, ""));
}

/**
 * Delete a namespace's files from the container, used when a namespace is
 * removed while iCloud Drive is the active backend. The host removes files, not
 * folders, so this removes every file under the namespace's folder and leaves
 * the emptied folders for iCloud to tidy. The default namespace has no folder
 * of its own — its files share the root — so it is never passed here.
 */
export async function deleteICloudNamespace(
  host: ICloudHost,
  namespace: string,
): Promise<void> {
  const root = namespaceCloudFolder(namespace);
  if (!root) return;
  const files = filesUnder(parseICloudEntries(await host.list()), root, true);
  for (const file of files) await host.remove(joinPath(root, file.path));
  log.info(`namespace ${namespace}: removed ${files.length} file(s)`);
}

// ---- base64 ---------------------------------------------------------
//
// Chunked through `String.fromCharCode` rather than spread in one call: an
// attachment runs to a few million bytes, and spreading that many arguments
// overflows the call stack.

const CHUNK = 0x8000;

/** Base64 for a byte array. Exported for the tests that pin the round trip. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The bytes a base64 string holds. Exported alongside its inverse. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
