import { useT } from "../i18n/index.ts";
import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";

// Soft "a new build is ready — reload to apply" prompt. The new service
// worker has already downloaded and is parked in the `waiting` state;
// clicking Reload applies it (the `controlling` listener in `usePwaUpdate`
// reloads the page). Surfacing this rather than auto-refreshing is
// deliberate — a silent swap would discard an in-progress edit. It pins
// above the safe-area inset, just under any future toast stack.
export function UpdateToast() {
  const t = useT();
  const { needRefresh, incomingVersion, reload, dismiss } = usePwaUpdate();
  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-fg shadow-md"
    >
      <span className="flex-1 text-sm">
        {incomingVersion
          ? t("pwa.updateReady", { version: incomingVersion })
          : t("pwa.updateReadyGeneric")}
      </span>
      <button
        type="button"
        className="cursor-pointer text-sm text-link hover:underline"
        onClick={reload}
      >
        {t("common.reload")}
      </button>
      <button
        type="button"
        aria-label={t("pwa.dismiss")}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:text-fg"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
