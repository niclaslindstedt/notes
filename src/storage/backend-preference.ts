// Per-device preferences that select which `StorageAdapter` backs the
// document — and the cloud access tokens that unlock the cloud backends.
// Kept in localStorage on purpose: putting the backend choice inside the
// document would be a chicken-and-egg loop (the bytes select the place that
// holds the bytes). A single-user model — notes has no accounts.

import { createLogger } from "../dev/logger.ts";

const log = createLogger("backend-pref");

export type BackendId = "browser" | "folder" | "dropbox" | "gdrive" | "notesd";

// Everything needed to reach and trust a paired notesd daemon, stored
// per-device (like the cloud tokens). `spkiPin` validates the daemon's
// self-signed TLS cert; `deviceKey` is this device's bearer credential.
export type NotesdConfig = {
  /** `https://host:port` base URL. */
  endpoint: string;
  /** Per-device bearer key minted at pairing. */
  deviceKey: string;
  /** SPKI pin, `sha256:<base64>`, passed to the native pinned fetch. */
  spkiPin: string;
  /** Daemon display name, for the backend list. */
  name: string;
};

// Whether stored bytes are wrapped in the AES-GCM envelope before being
// handed to the adapter. Defaults to "plaintext" — encryption is an explicit
// opt-in from Settings, and there are no accounts to inherit a password from.
export type EncryptionMode = "encrypted" | "plaintext";

const BACKEND_KEY = "notes:backend";
const DROPBOX_TOKEN_KEY = "notes:dropbox:token";
// Long-lived companion to the short-lived access token. Stored under its own
// key so a legacy install (access token only) round-trips unchanged.
const DROPBOX_REFRESH_KEY = "notes:dropbox:refresh";
const GDRIVE_TOKEN_KEY = "notes:gdrive:token";
const NOTESD_CONFIG_KEY = "notes:notesd:config";
const ENCRYPTION_KEY = "notes:encryption";

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
  if (raw === "gdrive") return "gdrive";
  if (raw === "folder") return "folder";
  if (raw === "notesd") return "notesd";
  // Any unknown / missing value falls through to the browser backend.
  return "browser";
}

export function setBackend(backend: BackendId): void {
  write(BACKEND_KEY, backend);
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

export function getGdriveToken(): string | null {
  return read(GDRIVE_TOKEN_KEY);
}

export function setGdriveToken(token: string): void {
  write(GDRIVE_TOKEN_KEY, token);
}

export function clearGdriveToken(): void {
  clear(GDRIVE_TOKEN_KEY);
}

export function getNotesdConfig(): NotesdConfig | null {
  const raw = read(NOTESD_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NotesdConfig>;
    if (
      typeof parsed.endpoint === "string" &&
      typeof parsed.deviceKey === "string" &&
      typeof parsed.spkiPin === "string" &&
      typeof parsed.name === "string"
    ) {
      return parsed as NotesdConfig;
    }
  } catch {
    // fall through to null on a corrupt blob
  }
  return null;
}

export function setNotesdConfig(config: NotesdConfig): void {
  write(NOTESD_CONFIG_KEY, JSON.stringify(config));
}

export function clearNotesdConfig(): void {
  clear(NOTESD_CONFIG_KEY);
}

export function getEncryption(): EncryptionMode {
  return read(ENCRYPTION_KEY) === "encrypted" ? "encrypted" : "plaintext";
}

export function setEncryption(mode: EncryptionMode): void {
  write(ENCRYPTION_KEY, mode);
}
