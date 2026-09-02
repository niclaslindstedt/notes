// Nextcloud-backed `StorageAdapter`. Talks WebDAV to the user's own Nextcloud
// server (`remote.php/dav/files/<user>/…`) and stores the notes as individual
// markdown files under an app folder in that account, so the whole folder opens
// as plain notes in the Files app, on any device the user syncs it to, and in
// any editor.
//
// ## A directory backend, like folder / Dropbox / Drive / notesd
//
// The markdown <-> snapshot conversion, per-file at-rest encryption, attachment
// externalisation, and conflict detection all live in the shared directory
// adapter (`../directory-adapter.ts`); this module only implements the small
// `FileStore` / `AttachmentStore` that move one file's bytes at a time, over
// the WebDAV verbs in `./webdav.ts`. The on-disk layout is the same one the
// folder backend writes (`<ns>/notes/*.md`, `<ns>/attachments/<stem>/*`), so a
// Nextcloud folder synced down by the desktop client can be opened directly by
// the local-folder backend.
//
// ## Credentials
//
// There is no OAuth here. A Nextcloud is a server the *user* runs, so the
// connection is a server URL plus an **app password** — the per-client
// credential Nextcloud mints under Settings → Security, revocable on its own
// without touching the account password, and the credential Nextcloud
// documents for third-party clients. It is sent as HTTP Basic on every
// request and stored per device beside the other backends' tokens (see
// `../backend-preference.ts`). Because it never expires on its own there is no
// silent-refresh path: a 401 means the password was revoked or changed, and
// `AuthError` sends the user back to the connect form.
//
// ## Cross-origin access
//
// A browser reaching a Nextcloud on another origin needs that server to answer
// the preflight — Nextcloud does not send CORS headers for WebDAV out of the
// box. That is a server-side setting the user (who administers the server)
// makes once; `verifyNextcloudConnection` runs at connect time precisely so the
// failure is explained there, once, instead of surfacing later as a silent
// "offline".

import { createLogger } from "../../dev/logger.ts";
import { AuthError, type StorageAdapter } from "../adapter.ts";
import type { AttachmentEntry, AttachmentStore } from "../attachment-store.ts";
import type { NextcloudConfig } from "../backend-preference.ts";
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
import { nextcloudError } from "./errors.ts";
import {
  type DavEntry,
  basicAuth,
  encodePath,
  filesRootUrl,
  PROPFIND_BODY,
  normalizeEtag,
  parseMultistatus,
} from "./webdav.ts";

const log = createLogger("nextcloud");

export type FetchImpl = typeof fetch;

/** The backend's display name. Not a listing coordinate — it names a product. */
export const NEXTCLOUD_LABEL = "Nextcloud";

// 1-second coalescing window, matching the other network backends: rapid edits
// within a single gesture collapse into one WebDAV round trip.
const SAVE_DEBOUNCE_MS = 1000;

// ---- Paths ----------------------------------------------------------

/**
 * The path a namespace's whole folder lives at, relative to the app folder
 * (empty for the default namespace, `<slug>` otherwise). Used to delete a
 * namespace wholesale; the note files themselves sit in its `notes/` subfolder.
 */
export function nextcloudNamespacePath(namespace: string): string {
  return namespaceCloudFolder(namespace);
}

/**
 * The account-root-relative path of a namespace's notes folder — also what the
 * sync details dialog shows as the location, since it is the path the user sees
 * in the Files app.
 */
export function nextcloudNotesPath(
  config: NextcloudConfig,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): string {
  return joinPath(config.folder, namespaceNotesFolder(namespace));
}

/** A URL that opens the namespace's notes folder in the Nextcloud web UI. */
export function nextcloudWebUrl(
  config: NextcloudConfig,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): string {
  const dir = `/${nextcloudNotesPath(config, namespace)}`;
  return `${config.endpoint}/index.php/apps/files/?dir=${encodeURIComponent(dir)}`;
}

function joinPath(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("/");
}

function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

// ---- The WebDAV client ----------------------------------------------

// Everything the two stores need from the server, bound to one account. Paths
// handed to it are relative to the account's files root (so they include the
// app folder), which is also the level the collection cache and the MKCOL walk
// work at — a single `notes/work/notes` write creates every missing ancestor
// once, for every store sharing this client.
type DavClient = {
  /** Files under `path`, relative to it. Recurses into subcollections. */
  list(path: string, recursive: boolean): Promise<DavEntry[]>;
  read(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Write bytes, creating any missing parent collections. Returns the etag. */
  write(
    path: string,
    body: string | Uint8Array<ArrayBuffer>,
    contentType: string,
  ): Promise<string | undefined>;
  remove(path: string): Promise<void>;
  /** Create `path` and every missing ancestor. */
  ensureCollection(path: string): Promise<void>;
};

function createDavClient(
  config: NextcloudConfig,
  fetchImpl: FetchImpl,
): DavClient {
  const filesRoot = filesRootUrl(config.endpoint, config.username);
  const auth = basicAuth(config.username, config.appPassword);
  const url = (path: string): string =>
    path ? `${filesRoot}/${encodePath(path)}` : filesRoot;
  // Collections known to exist, so a burst of writes into one namespace pays
  // for the MKCOL walk once rather than per file. Only ever grows — nothing in
  // this app deletes a collection it then writes into again within a session,
  // and a stale entry is corrected by the PUT's own 409 retry.
  const collections = new Set<string>();
  // In-flight MKCOLs, keyed by path. The first save of a document writes every
  // note at once, so without this each of those concurrent writes would find
  // the folder missing and walk the same MKCOL chain before any of them landed.
  const creating = new Map<string, Promise<void>>();

  function mkcol(path: string): Promise<void> {
    let inFlight = creating.get(path);
    if (!inFlight) {
      inFlight = (async () => {
        const res = await fetchImpl(url(path), {
          method: "MKCOL",
          headers: { Authorization: auth },
        });
        // 405 is "it's already there" — the common case on every write but the
        // first. Anything else non-ok is real.
        if (!res.ok && res.status !== 405) {
          throw await nextcloudError("create folder", res);
        }
        collections.add(path);
      })();
      // A failed create is forgotten so the next write retries it rather than
      // re-awaiting a rejection forever.
      creating.set(
        path,
        inFlight.catch((err: unknown) => {
          creating.delete(path);
          throw err;
        }),
      );
    }
    return creating.get(path)!;
  }

  async function ensureCollection(path: string): Promise<void> {
    if (!path || collections.has(path)) return;
    let walked = "";
    for (const segment of path.split("/")) {
      walked = joinPath(walked, segment);
      if (collections.has(walked)) continue;
      await mkcol(walked);
    }
  }

  async function propfind(path: string): Promise<DavEntry[] | null> {
    const res = await fetchImpl(url(path), {
      method: "PROPFIND",
      headers: {
        Authorization: auth,
        // SabreDAV refuses `infinity`, so a recursive listing is a walk.
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
    });
    // Nothing has been written for this namespace yet — an empty listing, not
    // an error, exactly as the other backends report a missing folder.
    if (res.status === 404) return null;
    if (!res.ok) throw await nextcloudError("list", res);
    const rootPathname = new URL(url(path)).pathname;
    return parseMultistatus(await res.text(), decodeURIComponent(rootPathname));
  }

  async function list(path: string, recursive: boolean): Promise<DavEntry[]> {
    const entries = await propfind(path);
    if (entries === null) return [];
    if (!recursive) return entries;
    const nested = await Promise.all(
      entries
        .filter((entry) => entry.collection)
        .map(async (entry) => {
          collections.add(joinPath(path, entry.path));
          const children = await list(joinPath(path, entry.path), true);
          return children.map((child) => ({
            ...child,
            path: `${entry.path}/${child.path}`,
          }));
        }),
    );
    return [...entries, ...nested.flat()];
  }

  async function get(path: string): Promise<Response | null> {
    const res = await fetchImpl(url(path), {
      method: "GET",
      headers: { Authorization: auth },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await nextcloudError("read", res);
    return res;
  }

  return {
    list,

    async read(path: string): Promise<string | null> {
      const res = await get(path);
      return res === null ? null : res.text();
    },

    async readBytes(path: string): Promise<Uint8Array | null> {
      const res = await get(path);
      return res === null ? null : new Uint8Array(await res.arrayBuffer());
    },

    async write(
      path: string,
      body: string | Uint8Array<ArrayBuffer>,
      contentType: string,
    ): Promise<string | undefined> {
      const send = (): Promise<Response> =>
        fetchImpl(url(path), {
          method: "PUT",
          headers: { Authorization: auth, "Content-Type": contentType },
          body,
        });
      let res = await send();
      // A missing parent collection is the one failure worth retrying: it is
      // the normal state on the first write into a new namespace (or into a
      // note folder), and creating it up front on every save would cost a
      // round trip per write forever.
      if (res.status === 404 || res.status === 409) {
        await ensureCollection(parentPath(path));
        res = await send();
      }
      if (!res.ok) throw await nextcloudError("write", res);
      // Nextcloud returns the stored file's etag on the PUT — the same token a
      // PROPFIND reports for these bytes, so the directory adapter can stamp
      // the post-save revision without re-listing. Cross-origin it may be
      // absent (`ETag` is not a CORS-safelisted response header unless the
      // server exposes it), which the adapter handles by falling back to a
      // re-list.
      const etag = res.headers.get("ETag") ?? res.headers.get("OC-ETag");
      return etag === null ? undefined : normalizeEtag(etag);
    },

    async remove(path: string): Promise<void> {
      const res = await fetchImpl(url(path), {
        method: "DELETE",
        headers: { Authorization: auth },
      });
      if (res.status === 404) return; // already gone
      if (!res.ok) throw await nextcloudError("delete", res);
    },

    ensureCollection,
  };
}

// ---- The stores -----------------------------------------------------

/**
 * A `FileStore` rooted at one account-relative path. `recursive` is set for the
 * notes store so a note filed into a [folder](../../docs/overview.md#folders-sidecar)
 * subdirectory is found; the shallow root stores (`settings.json`,
 * `namespaces.json`) never list at all.
 */
function createNextcloudFileStore(
  client: DavClient,
  rootPath: string,
  recursive: boolean = false,
): FileStore {
  return {
    async list(): Promise<FileEntry[]> {
      const entries = await client.list(rootPath, recursive);
      return entries
        .filter((entry) => !entry.collection)
        .map((entry) => ({ path: entry.path, rev: entry.etag }));
    },
    read: (path) => client.read(joinPath(rootPath, path)),
    write: (path, text) =>
      client.write(
        joinPath(rootPath, path),
        text,
        "text/markdown; charset=utf-8",
      ),
    remove: (path) => client.remove(joinPath(rootPath, path)),
  };
}

/**
 * The binary sibling: a note's attachments under
 * `<namespace>/attachments/<note-stem>/`. Lists recursively (the tree nests one
 * note-name folder deep) and keeps only the nested files, so a stray file
 * sitting directly in `attachments/` is never mistaken for one.
 */
function createNextcloudAttachmentStore(
  client: DavClient,
  rootPath: string,
): AttachmentStore {
  return {
    async list(): Promise<AttachmentEntry[]> {
      const entries = await client.list(rootPath, true);
      return entries
        .filter((entry) => !entry.collection && entry.path.includes("/"))
        .map((entry) => ({ path: entry.path }));
    },
    read: (path) => client.readBytes(joinPath(rootPath, path)),
    async write(path, bytes): Promise<void> {
      // The MIME type rides the note JSON (plaintext) or the sealed blob header
      // (encrypted), so the bytes go up opaque.
      await client.write(
        joinPath(rootPath, path),
        bytes,
        "application/octet-stream",
      );
    },
    remove: (path) => client.remove(joinPath(rootPath, path)),
  };
}

/**
 * Build a Nextcloud adapter for one namespace. `crypto` is the injected session
 * passphrase, threaded into the directory adapter so notes and attachments are
 * sealed per file at rest — exactly like the folder / Dropbox / Drive backends.
 */
export function createNextcloudAdapter(
  config: NextcloudConfig,
  fetchImpl: FetchImpl = fetch,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  log.info(`adapter created ns=${namespace}`);
  const client = createDavClient(config, fetchImpl);
  const store = createNextcloudFileStore(
    client,
    joinPath(config.folder, namespaceNotesFolder(namespace)),
    true,
  );
  const attachments = createNextcloudAttachmentStore(
    client,
    joinPath(config.folder, namespaceAttachmentsFolder(namespace)),
  );
  return createDirectoryAdapter(
    store,
    {
      id: "nextcloud",
      label: NEXTCLOUD_LABEL,
      saveDebounceMs: SAVE_DEBOUNCE_MS,
    },
    attachments,
    crypto,
  );
}

/**
 * The root settings store — `settings.json` at the app-folder root, beside the
 * namespace folders, so appearance settings travel with the server and land on
 * every device signed into it.
 */
export function createNextcloudSettingsStore(
  config: NextcloudConfig,
  fetchImpl: FetchImpl = fetch,
): SettingsStore {
  return fileSettingsStore(
    createNextcloudFileStore(createDavClient(config, fetchImpl), config.folder),
  );
}

/**
 * The namespace-scoped settings store — `namespace-settings.json` inside the
 * namespace's own folder, so the settings the people sharing that namespace
 * agreed on travel with the folder they share.
 */
export function createNextcloudNamespaceSettingsStore(
  config: NextcloudConfig,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  fetchImpl: FetchImpl = fetch,
): NamespaceSettingsStore {
  return fileNamespaceSettingsStore(
    createNextcloudFileStore(
      createDavClient(config, fetchImpl),
      joinPath(config.folder, nextcloudNamespacePath(namespace)),
    ),
  );
}

/**
 * The root namespace-registry store — `namespaces.json` at the app-folder root,
 * beside `settings.json`, so the list of namespaces created on one device
 * appears on the others.
 */
export function createNextcloudNamespaceStore(
  config: NextcloudConfig,
  fetchImpl: FetchImpl = fetch,
): NamespaceRegistryStore {
  return fileNamespaceStore(
    createNextcloudFileStore(createDavClient(config, fetchImpl), config.folder),
  );
}

/**
 * Delete a namespace's whole folder from the server, used when a namespace is
 * removed while Nextcloud is the active backend. The default namespace has no
 * folder of its own — its files share the app-folder root — so it is never
 * passed here. A 404 (already gone) is treated as success.
 */
export async function deleteNextcloudNamespace(
  config: NextcloudConfig,
  namespace: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const path = nextcloudNamespacePath(namespace);
  if (!path) return;
  await createDavClient(config, fetchImpl).remove(
    joinPath(config.folder, path),
  );
}

/**
 * Check a connection before it is stored: prove the credentials against the
 * account's WebDAV root, then create the app folder if it isn't there yet.
 *
 * Runs on the connect gesture so the two failures that are really *setup*
 * problems are explained once, in the form, rather than surfacing later as an
 * unexplained "offline": a rejected app password, and a server that won't
 * answer this origin's cross-origin request at all.
 */
export async function verifyNextcloudConnection(
  config: NextcloudConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const filesRoot = filesRootUrl(config.endpoint, config.username);
  let res: Response;
  try {
    res = await fetchImpl(filesRoot, {
      method: "PROPFIND",
      headers: {
        Authorization: basicAuth(config.username, config.appPassword),
        Depth: "0",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
    });
  } catch (err) {
    // `fetch` rejects before there is a response for exactly two reasons that
    // matter here: the server isn't reachable, or it is reachable but declined
    // the cross-origin request. The browser deliberately won't say which, so
    // the message names both.
    log.warn("connection check failed before a response", err);
    throw new Error(
      `Couldn't reach ${config.endpoint}. Check the address, and that the ` +
        `server allows this app's origin to use its WebDAV API.`,
      { cause: err },
    );
  }
  if (res.status === 401) {
    throw new AuthError("Nextcloud rejected that username or app password.");
  }
  if (!res.ok) throw await nextcloudError("connect", res);
  // First connect on a fresh server: the app folder doesn't exist until
  // something creates it, and a save would otherwise be the first thing to try.
  await createDavClient(config, fetchImpl).ensureCollection(config.folder);
}

export {
  DEFAULT_NEXTCLOUD_FOLDER,
  normalizeFolder,
  normalizeServerUrl,
} from "./webdav.ts";
