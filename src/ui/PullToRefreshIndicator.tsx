import { useT } from "../i18n/index.ts";
import type { PullToRefreshState } from "./hooks/usePullToRefresh.ts";
import { ArrowDownIcon, SpinnerIcon } from "./icons.tsx";

// Slide-down pill that surfaces the pull-to-refresh gesture. Pinned to the
// top edge of the visible viewport (below the iOS safe-area inset) and
// translated by `pullDistance` so it appears to emerge from behind the header
// as the user pulls. Shares the same border / surface tokens as `UpdateToast`
// so the two affordances feel like one chrome family.
//
// Three-state arrow + label:
//   pulling    → ↓ "Pull to refresh"
//   release    → ↑ (rotated) "Release to refresh"
//   refreshing → spinner "Refreshing…"

type Props = {
  state: PullToRefreshState;
  pullDistance: number;
};

export function PullToRefreshIndicator({ state, pullDistance }: Props) {
  const t = useT();
  if (state === "idle" && pullDistance === 0) return null;

  const label =
    state === "refreshing"
      ? t("pwa.refreshing")
      : state === "release"
        ? t("pwa.releaseToRefresh")
        : t("pwa.pullToRefresh");

  // The indicator slides from above the viewport into place. The -44px floor
  // matches the pill's approximate rendered height so it sits flush above the
  // page until pulled.
  const offset = Math.min(pullDistance, 70);
  const opacity = Math.min(1, pullDistance / 50);
  const rotated = state === "release" || state === "refreshing";
  // While refreshing, lock to the trigger position and ease the slide; during
  // the live drag, tracking must be 1:1 so the pull feels attached to the
  // finger.
  const smooth = state === "refreshing" || state === "idle";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[65] flex justify-center"
      style={{
        top: "env(safe-area-inset-top, 0px)",
        transform: `translateY(${offset - 44}px)`,
        opacity,
        transition: smooth
          ? "transform 200ms ease-out, opacity 200ms ease-out"
          : "none",
      }}
    >
      <div className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-fg shadow-md">
        {state === "refreshing" ? (
          <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowDownIcon
            className={`h-3.5 w-3.5 transition-transform duration-150 ${
              rotated ? "rotate-180" : ""
            }`}
          />
        )}
        <span>{label}</span>
      </div>
    </div>
  );
}
