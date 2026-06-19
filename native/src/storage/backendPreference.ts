// Which storage backend this device uses, persisted across launches. The
// native counterpart of the web app's backend picker, collapsed to the only
// choice the native app currently offers (on-device vs iCloud) and backed by
// AsyncStorage instead of localStorage.
//
// The choice is kept on-device on purpose: putting "which place holds the
// document" inside the document would be a chicken-and-egg loop. It lives in
// AsyncStorage even when the selected backend is iCloud, so a device that
// signs out of iCloud still remembers the preference and can recover.

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_BACKEND_ID,
  availableBackends,
  type NativeBackendId,
} from "./backends.ts";

const BACKEND_KEY = "notes:native:backend";

/**
 * The persisted backend choice, clamped to what this platform actually
 * offers. A stored `icloud` on a device that is no longer iOS (or a corrupt
 * value) falls back to the on-device default rather than selecting a backend
 * that can't be built.
 */
export async function loadBackendPreference(): Promise<NativeBackendId> {
  try {
    const raw = await AsyncStorage.getItem(BACKEND_KEY);
    const offered = availableBackends().some((b) => b.id === raw);
    return offered ? (raw as NativeBackendId) : DEFAULT_BACKEND_ID;
  } catch {
    return DEFAULT_BACKEND_ID;
  }
}

export async function saveBackendPreference(
  id: NativeBackendId,
): Promise<void> {
  try {
    await AsyncStorage.setItem(BACKEND_KEY, id);
  } catch {
    // Best-effort: a failed write just means the choice isn't remembered
    // across launches, not that the current session breaks.
  }
}
