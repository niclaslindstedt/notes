// Ephemeral in-memory storage backend preloaded with the sample document
// (`buildSeedSnapshot` in `src/dev/seed.ts`), backing the developer "Fake
// data" toggle. Never persisted: the bytes live in a closure for the lifetime
// of the adapter instance, edits during the dev session round-trip through
// `save`, and the whole thing is discarded when the toggle flips off (or the
// page reloads), at which point `App` feeds the real adapter back and the sync
// engine's reload repopulates the screen with the user's untouched data.
//
// This is the sibling of the env-driven `dev/seed.ts` seeding: that one writes
// the sample dataset into the real localStorage keys (several namespaces) for
// debugging across reloads; this one never touches storage at all, so the
// toggle can preview fake data without disturbing the notes already on the
// device. Ported from checklist's `storage/dev-seed`.
//
// DELIBERATELY NO `loadSync` capability. This adapter is only ever swapped in
// MID-SESSION (the toggle is off at mount), never the initial adapter, so it
// has no first-paint fast path to serve — the async `load()` path handles the
// swap and repopulates state. Advertising `loadSync` would risk the seed never
// replacing real data on screen.

import { buildSeedSnapshot } from "../../dev/seed.ts";
import type { StorageAdapter, StoredSnapshot } from "../adapter.ts";
import { serialize } from "../serialize.ts";

export function createDevSeedAdapter(): StorageAdapter {
  // Seed once on creation. A fresh adapter (fresh seed) is built each time the
  // toggle is turned on, so every enable starts from a pristine sample.
  let text = serialize(buildSeedSnapshot());

  return {
    // The contract's id union has no "dev" member; "browser" is the closest
    // and is harmless here — this adapter is only handed to the note-document
    // engine, never to the per-backend settings/auth keying.
    id: "browser",
    label: "Developer (fake data)",
    saveDebounceMs: 0,
    // No capabilities — async-only, no sync fast path (see header).
    capabilities: new Set(),

    async load(): Promise<StoredSnapshot | null> {
      return { text };
    },

    async save(next: string): Promise<StoredSnapshot> {
      text = next;
      return { text };
    },
  };
}
