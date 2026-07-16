import {
  usePwaUpdate as useFrameworkPwaUpdate,
  type PwaUpdate,
} from "@niclaslindstedt/oss-framework/pwa";

// Service-worker update lifecycle. The singleton engine (registration,
// download progress, the waiting-build prompt state, SKIP_WAITING reload)
// lives in @niclaslindstedt/oss-framework; this adapter binds it to the
// app's deploy-slot config so call sites keep the historical no-argument
// hook.
export type {
  PwaUpdate,
  PwaUpdateState,
  PwaUpdateCheckResult,
} from "@niclaslindstedt/oss-framework/pwa";

// Slot-specific Workbox precache cache id. Must stay in sync with the
// `CACHE_ID` derived from `VITE_BASE` in `vite.config.ts`.
function cacheIdForBase(base: string): string {
  if (base === "/preview/") return "notes-preview";
  if (base === "/branch/") return "notes-branch";
  return "notes";
}

export function usePwaUpdate(): PwaUpdate {
  const base = import.meta.env.BASE_URL ?? "/";
  return useFrameworkPwaUpdate({
    base,
    cacheId: cacheIdForBase(base),
    // No service worker exists in the native WebView build (VitePWA is
    // disabled there), so never try to register one.
    enabled: !import.meta.env.DEV && !__NATIVE__,
  });
}
