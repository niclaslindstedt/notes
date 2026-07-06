import { PullToRefreshIndicator as FrameworkIndicator } from "@niclaslindstedt/oss-framework/components";
import type { PullToRefreshState } from "@niclaslindstedt/oss-framework/hooks";

import { useT } from "../i18n/index.ts";

// The framework's slide-down pull-to-refresh pill with the app's translated
// labels injected. Call sites keep the historical import path.
export function PullToRefreshIndicator({
  state,
  pullDistance,
}: {
  state: PullToRefreshState;
  pullDistance: number;
}) {
  const t = useT();
  return (
    <FrameworkIndicator
      state={state}
      pullDistance={pullDistance}
      labels={{
        pull: t("pwa.pullToRefresh"),
        release: t("pwa.releaseToRefresh"),
        refreshing: t("pwa.refreshing"),
      }}
    />
  );
}
