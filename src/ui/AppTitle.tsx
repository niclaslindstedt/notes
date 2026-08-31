import { type CSSProperties } from "react";

import { APP_NAME } from "../build-env.ts";
import { useT } from "../i18n/index.ts";
import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";

// The header wordmark. While a new build's service worker
// downloads, the name fills with the accent colour from the bottom as a
// vertical progress bar (`progress`, see `usePwaUpdate`) — the visual
// hint that an update is on the way; `UpdateToast` takes over once the
// fill is full and the build is ready to apply. Idle, it is just the
// static app name — `APP_NAME`, baked in at build time, so the name is a
// build variable rather than a translated string (it is a proper noun; it
// does not change between languages).
export function AppTitle() {
  const t = useT();
  const { progress } = usePwaUpdate();
  const filling = progress !== null;

  return (
    <h1
      title={filling ? t("pwa.downloading", { percent: progress }) : undefined}
      className={`text-lg font-bold text-fg-bright ${
        filling ? "pwa-title-fill" : ""
      }`}
      style={
        filling
          ? ({ "--pwa-fill": String(progress) } as CSSProperties)
          : undefined
      }
    >
      {APP_NAME}
    </h1>
  );
}
