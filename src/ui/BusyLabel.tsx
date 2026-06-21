import type { ReactNode } from "react";

import { SpinnerIcon } from "./icons.tsx";

// A button label that swaps in a leading spinner while a flow runs, so the
// button itself shows it's working — not just the status bar beside it. Shared
// by the encryption toggle and the unlock gate.
export function BusyLabel({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  if (!busy) return <>{children}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
      {children}
    </span>
  );
}
