import { useT } from "../i18n/index.ts";
import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";
import { Button } from "./form/Button.tsx";
import { RestoreIcon } from "./icons.tsx";

// Soft "an update is ready" prompt. The new service worker has already
// downloaded and is parked in the `waiting` state; pressing the Update
// button applies it (the `controlling` listener in `usePwaUpdate` reloads
// the page). Surfacing this rather than auto-refreshing is deliberate — a
// silent swap would discard an in-progress edit. It pins above the
// safe-area inset, just under any future toast stack.
//
// The button carries the whole "apply it" affordance, so the message is a
// plain headline (plus the incoming version, truncated so a long
// `v0.2.0.103-pre+9789183` never wraps the toast onto two awkward lines) —
// we don't spell out "reload to apply" anymore.
export function UpdateToast() {
  const t = useT();
  const { needRefresh, incomingVersion, reload, dismiss } = usePwaUpdate();
  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-fg shadow-md"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{t("pwa.updateReady")}</span>
        {incomingVersion && (
          <span className="truncate text-xs text-muted tabular-nums">
            {t("pwa.updateVersion", { version: incomingVersion })}
          </span>
        )}
      </div>
      <Button
        variant="primary"
        className="inline-flex shrink-0 items-center gap-1.5"
        onClick={reload}
      >
        <RestoreIcon className="h-4 w-4" />
        {t("pwa.updateAction")}
      </Button>
      <button
        type="button"
        aria-label={t("pwa.dismiss")}
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:text-fg"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
