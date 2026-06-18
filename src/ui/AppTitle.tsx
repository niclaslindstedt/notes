import { type CSSProperties } from "react";

import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";

// The header "Notes" wordmark. While a new build's service worker
// downloads, the name fills with the accent colour from the bottom as a
// vertical progress bar (`progress`, see `usePwaUpdate`) — the visual
// hint that an update is on the way; `UpdateToast` takes over once the
// fill is full and the build is ready to apply. Idle, it is just the
// static app name.
export function AppTitle() {
  const { progress } = usePwaUpdate();
  const filling = progress !== null;

  return (
    <h1
      title={filling ? `Downloading update… ${progress}%` : undefined}
      className={`text-lg font-bold text-fg-bright ${
        filling ? "pwa-title-fill" : ""
      }`}
      style={
        filling
          ? ({ "--pwa-fill": String(progress) } as CSSProperties)
          : undefined
      }
    >
      Notes
    </h1>
  );
}
