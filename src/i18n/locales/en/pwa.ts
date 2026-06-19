import type { Widen } from "./_widen.ts";

// Strings for the PWA update lifecycle — the "downloading" tooltip on the
// header wordmark and the "a new build is ready" reload toast — plus the
// pull-to-refresh indicator on the note list.

const pwa = {
  updateReady: "Updated to v{version} — reload to apply",
  updateReadyGeneric: "A new version is ready — reload to apply",
  downloading: "Downloading update… {percent}%",
  dismiss: "Dismiss update notice",
  pullToRefresh: "Pull to refresh",
  releaseToRefresh: "Release to refresh",
  refreshing: "Refreshing…",
} as const;

export type PwaCatalog = Widen<typeof pwa>;

export default pwa;
