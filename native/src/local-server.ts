// SERVES THE BUNDLED WEB BUILD TO THE WEBVIEW over a loopback HTTP server.
//
// Three decisions carry the whole design:
//
// WHY HTTP AND NOT `file://` — a `file://` page is an OPAQUE origin: its
// `localStorage` depends on where the app happens to be installed, no OAuth
// provider will redirect to it, a cross-origin request from it goes out as
// `Origin: null`, and WKWebView does not dependably allow it a dynamic
// `import()`. Served from `http://localhost:<port>` the page has a real,
// constant origin, and it is loaded exactly as the website is.
//
// WHY A FIXED PORT — a web origin is scheme + host + PORT, and `localStorage`
// is keyed by origin. Letting the server pick a free port (its default) would
// hand the WebView a brand-new origin on every launch, and with it an empty
// store: every note would appear to vanish. The port is therefore pinned, and
// the ladder below only exists so that something else holding it falls back to
// another DETERMINISTIC port rather than to a random one.
//
// WHY `localhost` AND NOT `127.0.0.1` — Apple DTS reports that App Transport
// Security blocks `http://127.0.0.1:…` from WKWebView while `http://localhost:…`
// is permitted, even with exception domains declared for both. The failure
// mode is a silent blank page on iOS.
//
// The build ships as one `assets/webroot.zip` (scripts/bundle-web.mjs), which
// is unzipped into the document directory on first launch with pure-JS fflate
// — no native unzip module and one code path on both platforms.

import { unzipSync } from "fflate";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import StaticServer from "@dr.pogodin/react-native-static-server";
import Constants from "expo-constants";

/** Deterministic ports, tried in order. See the header — the *stability* of
 *  the first one is what keeps the user's notes across launches.
 *
 *  Every wrapper in the fleet has its own ladder — calendar 8231, contacts
 *  8241, time 8251, calc 8261, paint 8271, meds 8281, cycle 8291, baby 8301,
 *  notes 8311, checklist 8791, the games 9006 / 9007 / 9033 — so no two
 *  contend for a port on a phone that has both. A new wrapper takes the next
 *  free ten. */
const PORT_LADDER = [8311, 8312, 8313] as const;

/** The hostname the WebView addresses the server as. Not `127.0.0.1`. */
const HOSTNAME = "localhost";

const WEBROOT_DIR = `${FileSystem.documentDirectory}webroot`;
const VERSION_MARKER = `${WEBROOT_DIR}/.bundle-version`;

const APP_VERSION = Constants.expoConfig?.version ?? "dev";

/** The static-server `fileDir` is a filesystem path, not a `file://` URI. */
const stripScheme = (uri: string) => uri.replace(/^file:\/\//, "");

// --- base64 <-> bytes (React Native has no Buffer; keep it dependency-free) --

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1]!);
    const c = B64.indexOf(clean[i + 2]!);
    const d = B64.indexOf(clean[i + 3]!);
    bytes[p++] = (a << 2) | (b >> 4);
    if (c >= 0 && i + 2 < clean.length) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0 && i + 3 < clean.length) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.subarray(0, p);
}

/**
 * Unpack `assets/webroot.zip` into the document directory, unless this exact
 * bundle is already there.
 *
 * The marker folds in Metro's content hash of the zip, not just the app
 * version: a development build regenerates the webroot far more often than the
 * version moves, and a version-only marker would keep serving the FIRST
 * extraction forever — new builds silently never reaching the WebView.
 */
async function ensureExtracted(): Promise<void> {
  const asset = Asset.fromModule(require("../assets/webroot.zip"));
  const stamp = `${APP_VERSION}:${asset.hash ?? "unhashed"}`;

  const marker = await FileSystem.getInfoAsync(VERSION_MARKER);
  if (marker.exists) {
    const stamped = await FileSystem.readAsStringAsync(VERSION_MARKER);
    if (stamped === stamp) return;
  }

  const dir = await FileSystem.getInfoAsync(WEBROOT_DIR);
  if (dir.exists) {
    await FileSystem.deleteAsync(WEBROOT_DIR, { idempotent: true });
  }
  await FileSystem.makeDirectoryAsync(WEBROOT_DIR, { intermediates: true });

  await asset.downloadAsync();
  const zipUri = asset.localUri ?? asset.uri;
  const zipB64 = await FileSystem.readAsStringAsync(zipUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const entries = unzipSync(base64ToBytes(zipB64));

  for (const [entryPath, bytes] of Object.entries(entries)) {
    if (entryPath.endsWith("/")) continue; // directory entries
    const dest = `${WEBROOT_DIR}/${entryPath}`;
    await FileSystem.makeDirectoryAsync(dest.slice(0, dest.lastIndexOf("/")), {
      intermediates: true,
    });
    await FileSystem.writeAsStringAsync(dest, bytesToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  await FileSystem.writeAsStringAsync(VERSION_MARKER, stamp);
}

export type LocalServer = {
  /** The origin to point the WebView at, e.g. `http://localhost:8311`. */
  origin: string;
  stop: () => Promise<void>;
};

async function startOnFirstFreePort(fileDir: string): Promise<StaticServer> {
  let lastError: unknown;
  for (const port of PORT_LADDER) {
    const server = new StaticServer({
      fileDir,
      port,
      // Loopback only — the bundle is never reachable from the LAN.
      nonLocal: false,
    });
    try {
      await server.start();
      return server;
    } catch (error) {
      lastError = error;
      await server.stop().catch(() => {});
    }
  }
  throw new Error(
    `Could not bind the embedded web server to any of ` +
      `${PORT_LADDER.join(", ")}: ${String(lastError)}`,
  );
}

/** Unpack the bundled build (once per build) and start the loopback server. */
export async function startLocalServer(): Promise<LocalServer> {
  await ensureExtracted();
  const server = await startOnFirstFreePort(stripScheme(WEBROOT_DIR));
  return {
    origin: `http://${HOSTNAME}:${server.port}`,
    stop: async () => {
      await server.stop();
    },
  };
}
