// Per-device preferences that select which `StorageAdapter` backs the
// document — and the cloud access tokens that unlock the cloud backends.
// Kept in localStorage on purpose: putting the backend choice inside the
// document would be a chicken-and-egg loop (the bytes select the place that
// holds the bytes). A single-user model — notes has no accounts.

import { createLogger } from "../dev/logger.ts";

const log = createLogger("backend-pref");

export type BackendId =
  "browser" | "folder" | "dropbox" | "icloud" | "nextcloud";

// Everything needed to reach one Nextcloud account, stored per-device like the
// cloud tokens. There is no OAuth and no refresh: `appPassword` is the
// revocable per-client credential Nextcloud mints under Settings → Security,
// sent as HTTP Basic on every request.
export type NextcloudConfig = {
  /** `https://cloud.example.com` base URL, no trailing slash. */
  endpoint: string;
  /** The Nextcloud login name the app password belongs to. */
  username: string;
  /** The app password, used as the HTTP Basic secret. */
  appPassword: string;
  /** App-folder path at the account root, e.g. `notes` or `Apps/notes`. */
  folder: string;
};

// Whether a namespace's stored bytes are wrapped in the AES-GCM envelope
// before being handed to the adapter. Defaults to "plaintext" — encryption is
// an explicit opt-in from Settings, and there are no accounts to inherit a
// password from.
export type EncryptionMode = "encrypted" | "plaintext";

const BACKEND_KEY = "notes:backend";
const DROPBOX_TOKEN_KEY = "notes:dropbox:token";
// Long-lived companion to the short-lived access token. Stored under its own
// key so a legacy install (access token only) round-trips unchanged.
const DROPBOX_REFRESH_KEY = "notes:dropbox:refresh";
// Dropbox is gone as a backend. The key stays named so a token a device
// may still hold can be cleared rather than left sitting in storage.
const RETIRED_GDRIVE_TOKEN_KEY = "notes:gdrive:token";
const NEXTCLOUD_CONFIG_KEY = "notes:nextcloud:config";
// notesd, the self-hosted daemon, is gone as a backend. Both keys stay named
// so a device that was paired with one is cleared rather than left holding a
// device key: the stored choice and the pairing (endpoint, key, SPKI pin).
const RETIRED_NOTESD_BACKEND = "notesd";
const RETIRED_NOTESD_CONFIG_KEY = "notes:notesd:config";
// The account-wide encryption flag written before encryption became a
// per-namespace decision. Still read as the fallback for a namespace that has
// no setting of its own — see `getEncryption`.
const ENCRYPTION_KEY = "notes:encryption";
// Per-namespace encryption mode, suffixed by slug.
const ENCRYPTION_PREFIX = "notes:encryption:";

function read(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch (err) {
    log.warn(`write failed for ${key}`, err);
  }
}

function clear(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function getBackend(): BackendId {
  const raw = read(BACKEND_KEY);
  if (raw === "dropbox") return "dropbox";
  if (raw === "folder") return "folder";
  if (raw === "icloud") return "icloud";
  if (raw === "nextcloud") return "nextcloud";
  // A device that synced with notesd opens on this browser's own notes, as if
  // sync were off, and forgets the pairing it held.
  if (raw === RETIRED_NOTESD_BACKEND) forgetRetiredNotesd();
  // Any unknown / missing value falls through to the browser backend.
  return "browser";
}

/** Clear what a device paired with the retired notesd daemon still holds. */
export function forgetRetiredNotesd(): void {
  if (read(BACKEND_KEY) === RETIRED_NOTESD_BACKEND) clear(BACKEND_KEY);
  clear(RETIRED_NOTESD_CONFIG_KEY);
}

export function setBackend(backend: BackendId): void {
  write(BACKEND_KEY, backend);
}

/**
 * Whether the selected backend can carry a note to the user's **other
 * devices** — everything except the browser store, which never leaves this
 * install's `localStorage`. The [dropzone](../../docs/overview.md#dropzone) is
 * gated on this: a note whose only purpose is being picked up elsewhere is
 * meaningless when nothing else can read it, so the gesture that creates one
 * isn't offered at all on the local store.
 *
 * A picked folder counts. The app can't tell a plain directory from one a
 * desktop sync client is watching, and the folder backend is exactly how
 * people run notes over Dropbox/iCloud/Syncthing on the desktop — the same
 * reasoning that has pull-to-refresh armed on every non-browser backend.
 */
export function isSharedBackend(backend: BackendId): boolean {
  return backend !== "browser";
}

export function getDropboxToken(): string | null {
  return read(DROPBOX_TOKEN_KEY);
}

export function setDropboxToken(token: string): void {
  write(DROPBOX_TOKEN_KEY, token);
}

export function clearDropboxToken(): void {
  clear(DROPBOX_TOKEN_KEY);
}

export function getDropboxRefreshToken(): string | null {
  return read(DROPBOX_REFRESH_KEY);
}

export function setDropboxRefreshToken(token: string): void {
  write(DROPBOX_REFRESH_KEY, token);
}

export function clearDropboxRefreshToken(): void {
  clear(DROPBOX_REFRESH_KEY);
}

export function clearRetiredGdriveToken(): void {
  clear(RETIRED_GDRIVE_TOKEN_KEY);
}

export function getNextcloudConfig(): NextcloudConfig | null {
  const raw = read(NEXTCLOUD_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NextcloudConfig>;
    if (
      typeof parsed.endpoint === "string" &&
      typeof parsed.username === "string" &&
      typeof parsed.appPassword === "string" &&
      typeof parsed.folder === "string"
    ) {
      return parsed as NextcloudConfig;
    }
  } catch {
    // fall through to null on a corrupt blob
  }
  return null;
}

export function setNextcloudConfig(config: NextcloudConfig): void {
  write(NEXTCLOUD_CONFIG_KEY, JSON.stringify(config));
}

export function clearNextcloudConfig(): void {
  clear(NEXTCLOUD_CONFIG_KEY);
}

/**
 * Whether a namespace's bytes are encrypted at rest, as far as this device
 * knows. Encryption is **per namespace**: the whole point of a shared
 * namespace is that some of them are shared and some are not, so sealing the
 * one you keep your own things in must not seal — or lock you out of — the one
 * you share with four other people.
 *
 * The legacy account-wide key is the fallback rather than something migrated
 * on boot: a namespace with no explicit setting inherits it, and the first
 * explicit write for that namespace takes over for good. That keeps an
 * existing encrypted install reading exactly as it did without needing the
 * namespace list to be resolved before the encryption state can be answered
 * (it isn't, at boot).
 */
export function getEncryption(namespace: string): EncryptionMode {
  const own = read(`${ENCRYPTION_PREFIX}${namespace}`);
  if (own === "encrypted") return "encrypted";
  if (own === "plaintext") return "plaintext";
  return read(ENCRYPTION_KEY) === "encrypted" ? "encrypted" : "plaintext";
}

export function setEncryption(namespace: string, mode: EncryptionMode): void {
  write(`${ENCRYPTION_PREFIX}${namespace}`, mode);
}

/** Forget a namespace's encryption setting — part of deleting the namespace. */
export function clearEncryption(namespace: string): void {
  clear(`${ENCRYPTION_PREFIX}${namespace}`);
}
