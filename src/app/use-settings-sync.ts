// Reconciles the appearance settings with the backend files that hold them.
//
// Two of the three widths the appearance store stacks live on the backend
// (see `src/theme/appearance-scopes.ts`):
//
//   - **global** → `settings.json` at the app-folder root. Everyone on the
//     account, in every namespace.
//   - **namespace** → `namespace-settings.json` inside the active namespace's
//     own folder. Only the people who share that namespace.
//
// The third — **device** — is deliberately not here: it never leaves
// localStorage, which is exactly what makes it usable on a login several
// people share.
//
// Each width reconciles the same two ways, mirroring checklist's `useSettings`:
//   - On mount / backend / namespace switch: adopt the backend's file when it
//     exists (someone else wrote it), otherwise seed it from this device.
//   - On every local edit: write that layer back.
//
// The browser backend supplies no stores (it keeps everything in
// localStorage), so this hook is a no-op there. The localStorage mirror in the
// appearance store keeps first paint flash-free regardless of the backend, and
// any backend failure (offline / malformed) silently leaves the local copy in
// place. Appearance is plaintext even when the notes are encrypted, so the
// unlock gate can still render in the user's theme.
//
// Writes are compared against what was last seen for that layer before being
// sent. Both layers are subscribed to the same store, so without that guard a
// device-layer edit would re-upload the global and namespace files untouched —
// and on a shared login that is a write race between people over bytes nobody
// changed.

import { useEffect } from "react";

import type { NamespaceSettingsStore } from "../storage/namespace-settings-store.ts";
import type { SettingsStore } from "../storage/settings-store.ts";
import {
  getAppearanceLayer,
  replaceAppearanceLayer,
  setAppearanceNamespace,
  subscribeAppearance,
} from "../theme/useTheme.ts";
import type { SettingsScope } from "../theme/appearance-scopes.ts";

/** The half of a backend store this hook needs — both stores share the shape. */
type LayerStore = {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
};

export function useSettingsSync(
  settingsStore: SettingsStore | null,
  namespaceSettingsStore: NamespaceSettingsStore | null,
  activeNamespace: string,
): void {
  // Point the namespace layer at the active namespace *before* its file is
  // reconciled, so switching namespaces immediately swaps to that namespace's
  // cached settings instead of leaving the previous one's applied while the
  // network resolves.
  useEffect(() => {
    setAppearanceNamespace(activeNamespace);
  }, [activeNamespace]);

  useLayerSync("global", settingsStore);
  // Keyed on the namespace as well: a switch has to re-reconcile against the
  // new namespace's file, not keep pushing into the old one's.
  useLayerSync("namespace", namespaceSettingsStore, activeNamespace);
}

function useLayerSync(
  scope: SettingsScope,
  store: LayerStore | null,
  key = "",
): void {
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    // What this layer last looked like on the backend, so a local edit to
    // *another* layer doesn't re-upload this one.
    let lastSeen: string | null = null;

    void (async () => {
      try {
        const raw = await store.load();
        if (cancelled) return;
        if (raw === null) {
          lastSeen = JSON.stringify(getAppearanceLayer(scope));
          await store.save(lastSeen);
          return;
        }
        replaceAppearanceLayer(scope, JSON.parse(raw));
        // Normalised, not the raw text: key order or whitespace differing from
        // what `JSON.stringify` produces would otherwise read as a change and
        // push the file straight back — a pointless write, and on a shared
        // login a pointless race.
        lastSeen = JSON.stringify(getAppearanceLayer(scope));
      } catch {
        // Backend unreachable / malformed — keep the local cache.
      }
    })();

    // Write local edits through. Best-effort: a failed write leaves the local
    // cache, which the next reconcile or edit re-pushes.
    const unsubscribe = subscribeAppearance(() => {
      const text = JSON.stringify(getAppearanceLayer(scope));
      if (text === lastSeen) return;
      lastSeen = text;
      void Promise.resolve(store.save(text)).catch(() => {
        // best-effort
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // `key` re-runs the effect when the namespace changes even though the
    // store identity may be memo-stable.
  }, [store, scope, key]);
}
