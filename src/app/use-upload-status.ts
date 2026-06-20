// Subscribes to the active backend's per-note upload progress and returns the
// set of note ids whose file is currently being written to the backend. The
// note list and side menu read it to spin a sync glyph next to exactly the
// notes uploading right now — the per-note counterpart to the header's single
// cloud-sync glyph. The file backends drive it through `adapter.watchUploads`
// (see `directory-adapter.ts`); a backend without that method (the local
// browser store) yields a permanently-empty set, so no spinner ever shows.

import { useEffect, useState } from "react";

import type { StorageAdapter } from "../storage/adapter.ts";

const EMPTY: ReadonlySet<string> = new Set<string>();

export function useUploadStatus(adapter: StorageAdapter): ReadonlySet<string> {
  const [uploading, setUploading] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    // Re-subscribe whenever the adapter instance changes (backend / namespace
    // swap, encryption unlock). A backend with no upload tracking clears the
    // set so a stale spinner from the previous backend can't linger.
    if (!adapter.watchUploads) {
      setUploading(EMPTY);
      return;
    }
    return adapter.watchUploads(setUploading);
  }, [adapter]);

  return uploading;
}
