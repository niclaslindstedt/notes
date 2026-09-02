// The small WebDAV client the Nextcloud backend is built on, plus the
// dependency-free multistatus parser it reads listings with.
//
// Nextcloud speaks plain WebDAV over `remote.php/dav/files/<user>/…`, so this
// module is the whole protocol surface: PROPFIND to list a collection, GET /
// PUT / DELETE to move one file, MKCOL to create a missing parent. Everything
// above it (`./index.ts`) is the same `FileStore` / `AttachmentStore` shape the
// other file backends implement.
//
// Two deliberate choices worth knowing before changing anything here:
//
//   - **`Depth: 1`, never `infinity`.** SabreDAV — which Nextcloud is built on
//     — refuses a `Depth: infinity` PROPFIND, so a recursive listing is a
//     breadth-first walk of one PROPFIND per collection (`listTree`), issued a
//     level at a time in parallel.
//   - **The parser is regex over the XML, not `DOMParser`.** The domain and
//     storage layers run under vitest's `node` environment where there is no
//     DOM, and the app ships no XML dependency. A multistatus body is a flat,
//     machine-generated shape, so pulling `<response>` blocks apart with
//     namespace-agnostic patterns is enough — and it keeps this testable
//     without a browser.

/**
 * The app folder created at the account root when the user doesn't name one.
 * Deliberately lowercase `notes` rather than `Notes`: the Nextcloud Notes app
 * owns a `Notes/` folder of flat markdown, and landing this app's namespace
 * subfolders inside it would look like a corruption of that one. It lives here
 * rather than beside the adapter so the connect form can show it as the
 * placeholder without pulling the adapter into the settings chunk.
 */
export const DEFAULT_NEXTCLOUD_FOLDER = "notes";

/** The `PROPFIND` body both the listing walk and the connection check send. */
export const PROPFIND_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  "<d:getetag/><d:resourcetype/>" +
  "</d:prop></d:propfind>";

/** One entry from a PROPFIND listing, relative to the URL it was rooted at. */
export type DavEntry = {
  /** Path relative to the listed root, POSIX-style, never leading-slashed. */
  path: string;
  /** The file's `getetag`, used as the per-file revision. */
  etag?: string;
  /** True for a collection (a directory), false for a file. */
  collection: boolean;
};

// Namespace prefixes vary by server (`d:`, `D:`, none), so every tag pattern
// below accepts any prefix — or none at all.
const ANY_PREFIX = "(?:[A-Za-z0-9_.-]+:)?";

const RESPONSE_RE = new RegExp(
  `<${ANY_PREFIX}response\\b[^>]*>([\\s\\S]*?)</${ANY_PREFIX}response>`,
  "g",
);

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${ANY_PREFIX}${tag}\\b[^>]*>([\\s\\S]*?)</${ANY_PREFIX}${tag}>`,
  );
  const m = re.exec(block);
  return m?.[1] ?? null;
}

function hasTag(block: string, tag: string): boolean {
  return new RegExp(`<${ANY_PREFIX}${tag}\\b[^>]*/?>`).test(block);
}

// The five predefined XML entities. A WebDAV href only ever carries `&amp;`
// in practice (everything else is percent-encoded), but decoding the full set
// costs nothing and stops a stray `&apos;` from corrupting a filename.
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The decoded pathname an `<href>` points at. Servers may answer with an
 * absolute URL or a rooted path; both reduce to the same pathname. A malformed
 * (or un-decodable) href yields null so the caller can skip the entry rather
 * than throwing the whole listing away.
 */
export function hrefPathname(href: string): string | null {
  const raw = decodeEntities(href.trim());
  if (!raw) return null;
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? (() => {
        try {
          return new URL(raw).pathname;
        } catch {
          return null;
        }
      })()
    : raw;
  if (path === null) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * Parse a `207 Multi-Status` body into entries relative to `rootPathname` (the
 * decoded pathname of the collection that was listed, with or without its
 * trailing slash). The collection itself comes back in its own listing and is
 * dropped, so the result is only what lives *inside* it.
 */
export function parseMultistatus(
  xml: string,
  rootPathname: string,
): DavEntry[] {
  const root = rootPathname.endsWith("/") ? rootPathname : `${rootPathname}/`;
  const entries: DavEntry[] = [];
  RESPONSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RESPONSE_RE.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const href = tagText(block, "href");
    if (href === null) continue;
    const pathname = hrefPathname(href);
    if (pathname === null || !pathname.startsWith(root)) continue;
    const collection = hasTag(
      tagText(block, "resourcetype") ?? "",
      "collection",
    );
    // A collection's href carries a trailing slash; strip it so a directory and
    // the files under it are described in the same shape.
    const relative = pathname.slice(root.length).replace(/\/$/, "");
    if (!relative) continue; // the listed collection itself
    const etag = tagText(block, "getetag");
    entries.push({
      path: relative,
      // Etags are quoted (`"abc"`, or `W/"abc"` on a weak validator). The value
      // is opaque to the directory adapter, but it must be *stable*, so the
      // quoting is normalised away rather than tracked.
      ...(etag === null ? {} : { etag: normalizeEtag(decodeEntities(etag)) }),
      collection,
    });
  }
  return entries;
}

/** Strip the `W/` prefix and surrounding quotes from an etag. */
export function normalizeEtag(raw: string): string {
  return raw.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

/** Percent-encode each segment, leaving the `/` separators intact. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Normalise a server URL the user typed: trim it, drop any trailing slashes,
 * and default a bare host to `https://`. Throws when what's left isn't a URL —
 * the connect form surfaces the message.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter your Nextcloud server address.");
  // The scheme is added before any trimming of trailing slashes, so a bare
  // `https://` fails to parse rather than becoming the host `https`.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`“${trimmed}” is not a valid server address.`);
  }
  if (!url.hostname) {
    throw new Error(`“${trimmed}” is not a valid server address.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Normalise the app-folder path the user typed: trim it, drop the slashes
 * around it, and collapse empty segments, so `/Apps/notes/` and `Apps/notes`
 * name the same folder. An empty value yields an empty string — the caller
 * supplies its own default. A `..` segment is rejected outright rather than
 * silently rewritten: it would point the app folder outside the account root
 * the rest of the backend assumes.
 */
export function normalizeFolder(raw: string): string {
  const segments = raw
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("A folder path can't contain “..”.");
  }
  return segments.join("/");
}

/**
 * The `Authorization` value for a username + app password. Encodes as UTF-8
 * first: `btoa` throws on anything above U+00FF, and an app password is
 * generated ASCII but a username need not be.
 */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** The WebDAV files root for one Nextcloud account. */
export function filesRootUrl(endpoint: string, username: string): string {
  return `${endpoint}/remote.php/dav/files/${encodeURIComponent(username)}`;
}
