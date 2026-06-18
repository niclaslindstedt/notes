// Reconciles the appearance settings with the active backend's root settings
// store (`settings.json` at the app-folder root). On the cloud / folder
// backends this makes the user's theme, font, and custom-theme choices travel
// with the synced/shared folder and land on every device that connects it.
//
// Two directions, mirroring checklist's `useSettings`:
//   - On mount / backend switch: adopt the backend's file when it exists
//     (another device wrote it), otherwise seed it from this device.
//   - On every local edit: write through to the backend file.
//
// The browser backend supplies no store (it keeps settings in localStorage),
// so this hook is a no-op there. The localStorage cache in the appearance
// store keeps first paint flash-free regardless of the backend, and any
// backend failure (offline / malformed) silently leaves the local copy in
// place. Appearance is plaintext even when the notes are encrypted, so the
// unlock gate can still render in the user's theme.

import { useEffect } from "react";

import type { SettingsStore } from "../storage/settings-store.ts";
import {
  getAppearance,
  replaceAppearance,
  subscribeAppearance,
} from "../theme/useTheme.ts";

export function useSettingsSync(settingsStore: SettingsStore | null): void {
  // Reconcile with the backend's settings file when a file backend is
  // (re)selected: the backend wins when it already holds one, otherwise seed
  // it from this device.
  useEffect(() => {
    if (!settingsStore) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await settingsStore.load();
        if (cancelled) return;
        if (raw === null) {
          await settingsStore.save(JSON.stringify(getAppearance()));
          return;
        }
        replaceAppearance(JSON.parse(raw));
      } catch {
        // Backend unreachable / malformed — keep the local cache.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsStore]);

  // Write local edits through to the backend file. Best-effort: a failed
  // write leaves the local cache, which the next reconcile or edit re-pushes.
  useEffect(() => {
    if (!settingsStore) return;
    return subscribeAppearance(() => {
      void Promise.resolve(
        settingsStore.save(JSON.stringify(getAppearance())),
      ).catch(() => {
        // best-effort
      });
    });
  }, [settingsStore]);
}
