import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  ModalBusContext,
  type ModalBus,
  type ModalCommand,
} from "./modal-bus.ts";

// Owns the single "which bus modal is open" state and supplies it through
// `ModalBusContext`. Lives in its own file (not alongside the context) so
// React Fast Refresh keeps a stable component boundary. Mount once near the
// root, above every `dispatch` caller and every modal host.
export function ModalBusProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ModalCommand | null>(null);
  const dispatch = useCallback((command: ModalCommand) => {
    setActive(command);
  }, []);
  const close = useCallback(() => setActive(null), []);
  const value = useMemo<ModalBus>(
    () => ({ dispatch, active, close }),
    [dispatch, active, close],
  );
  return (
    <ModalBusContext.Provider value={value}>
      {children}
    </ModalBusContext.Provider>
  );
}
