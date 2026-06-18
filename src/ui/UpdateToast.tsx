import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";

// The in-page "a new build is ready" prompt. The new service worker has
// already downloaded and is parked in the `waiting` state; clicking Reload
// applies it (the `controlling` listener in `usePwaUpdate` reloads the
// page). Surfacing this rather than auto-refreshing is deliberate — a
// silent swap would discard an in-progress edit.

export function UpdateToast() {
  const { needRefresh, incomingVersion, reload, dismiss } = usePwaUpdate();
  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-bright">
            A new version is ready
          </p>
          {incomingVersion && (
            <p className="truncate text-xs text-muted">v{incomingVersion}</p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-[var(--radius)] px-2 py-1 text-sm text-muted hover:text-fg"
        >
          Later
        </button>
        <button
          type="button"
          onClick={reload}
          className="rounded-[var(--radius)] bg-accent px-3 py-1 text-sm font-medium text-page-bg"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
