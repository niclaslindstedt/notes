// Coordinates the note-filing pointer drag with the document-level
// pull-to-refresh gesture, which would otherwise misread it.
//
// Filing a note into a folder / namespace / the archive (`useTouchNoteDrag`)
// is a pointer drag that travels down the screen. Pull-to-refresh
// (`usePullToRefresh`) watches the same downward travel at the document level,
// so without coordination a drag downward would arm a refresh at the same
// time. The drag reports `true` on pick-up and `false` on drop through this
// context; the app root holds the boolean and folds it into the
// pull-to-refresh `enabled` gate — the same way the floating menu-button drag
// already does.
//
// The default no-op lets a drag source mount outside the provider (e.g. a
// component rendered in isolation by a test).

import { createContext, useContext } from "react";

export const ReportDragActivityContext = createContext<
  (active: boolean) => void
>(() => {});

/** Report whether a note-filing pointer drag is currently in progress. */
export function useReportDragActivity(): (active: boolean) => void {
  return useContext(ReportDragActivityContext);
}
