import type { Widen } from "./_widen.ts";

// Strings for the PWA update lifecycle — the "downloading" tooltip on the
// header wordmark and the update-ready toast — plus the pull-to-refresh
// indicator on the note list.

const pwa = {
  updateReady: "Update ready",
  updateVersion: "v{version}",
  updateAction: "Update",
  downloading: "Downloading update… {percent}%",
  dismiss: "Dismiss update notice",
  pullToRefresh: "Pull to refresh",
  releaseToRefresh: "Release to refresh",
  refreshing: "Refreshing…",
} as const;

export type PwaCatalog = Widen<typeof pwa>;

export default pwa;
