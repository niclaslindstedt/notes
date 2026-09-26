// The presentation demo: `VITE_SEED=demo` (`make demo`) boots the app onto one
// person's well-kept notebook — `buildDemo` in `./demoData.ts` — held entirely
// in memory. It is the live demo and what the App Store screenshots are taken
// of.
//
// **How it stays off the device.** Every piece of state the app keeps on this
// install goes through `localStorage`: the local backend's documents, the
// namespace registry, the active-namespace and active-note cursors, the
// appearance layers. So the demo swaps that one seam: before the app mounts,
// `bootDemo` puts an in-memory `Storage` in `window.localStorage`'s place,
// pre-filled with the demo notebook and pointed at the local backend. Every
// screen then runs the app's real code over the demo — the local adapter's
// synchronous first paint, namespace switching, folders, favorites, transforms
// — and every edit lands in memory and is gone on reload. Nothing of the
// demo is written to the device, and the device's notes are never read: the
// only thing carried over is this install's own look (theme, list layout,
// menu placement — see `carriesOver`), so a demo opens in the colours the
// person chose.
//
// Connecting a storage backend is refused while the demo runs
// (`useStorageBackend`), since the first sync would copy the demo into the
// reader's real folder or cloud.
//
// Dev tooling, not a shipped feature: the check below folds to `false` in any
// build without `VITE_SEED=demo`, so neither this module nor the notebook
// reaches the production bundle.

import { buildDemo } from "./demoData.ts";

/** True in a build made with `VITE_SEED=demo`; folds to `false` otherwise. */
export const DEMO = import.meta.env.VITE_SEED === "demo";

/** A `Storage` that lives and dies with the page. */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
}

/**
 * The keys a demo copies from the device: how this install looks, which
 * language it speaks and where its menu sits — never a note, a namespace, a
 * backend or a credential. That is the `notes/` family (appearance, layout,
 * language), less `notes/v1…`, which is the document itself, and the
 * per-namespace appearance layers, which belong to real namespaces. Every
 * data and credential key is `notes:`-prefixed and stays behind.
 */
export function carriesOver(key: string): boolean {
  if (!key.startsWith("notes/")) return false;
  return !key.startsWith("notes/v1") && !key.startsWith("notes/appearance:ns:");
}

/**
 * Build the in-memory store the demo runs on: this device's look (see
 * `carriesOver`), then the demo notebook over it. The demo's transform rules
 * join the global appearance layer unless the device already has rules of
 * its own.
 */
export function demoStorage(
  device: Storage | null,
  now: number = Date.now(),
): MemoryStorage {
  const memory = new MemoryStorage();
  if (device) {
    for (let i = 0; i < device.length; i++) {
      const key = device.key(i);
      if (key === null || !carriesOver(key)) continue;
      const value = device.getItem(key);
      if (value !== null) memory.setItem(key, value);
    }
  }
  const demo = buildDemo(now);
  for (const [key, value] of Object.entries(demo.storage)) {
    memory.setItem(key, value);
  }
  let appearance: Record<string, unknown> = {};
  try {
    const raw = memory.getItem(APPEARANCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      appearance = parsed as Record<string, unknown>;
    }
  } catch {
    // A corrupt layer is replaced by the demo's.
  }
  const hasRules =
    Array.isArray(appearance.transforms) && appearance.transforms.length > 0;
  if (!hasRules) {
    memory.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ ...appearance, transforms: demo.transforms }),
    );
  }
  return memory;
}

// The global appearance layer's key (`STORAGE_KEY` in `theme/useTheme.ts`).
const APPEARANCE_KEY = "notes/appearance";

/**
 * Swap `window.localStorage` for the demo's in-memory store. Called from
 * `main.tsx` before the app's first module loads, so no read ever reaches the
 * device's notes. Returns false (and changes nothing) where the property
 * can't be replaced.
 */
export function bootDemo(): boolean {
  let device: Storage | null = null;
  try {
    device = window.localStorage;
  } catch {
    // Storage blocked: the demo still runs, in the default look.
  }
  const memory = demoStorage(device);
  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => memory,
    });
  } catch {
    return false;
  }
  return window.localStorage === memory;
}
