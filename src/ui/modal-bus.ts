import { createContext, useContext } from "react";

// Modal command-bus, sized down from checklist's. It decouples *who opens a
// modal* (any button in the tree calls `dispatch`) from *who owns its
// open/close state* (a host component reads `useModalState`). Adding a modal
// is then a new host file + one arm on `ModalCommand` — no new `useState` in
// the app root and no opener prop threaded through `SideMenu`.
//
// Only one bus modal is open at a time (opening another replaces it), which
// matches the UX — each opens over the full screen.
//
// The `ModalBusProvider` component lives in its own file so React Fast
// Refresh keeps a stable boundary.

/** A request to open one of the app's modals. */
export type ModalCommand = { kind: "settings" };

export type ModalKind = ModalCommand["kind"];

export type ModalBus = {
  dispatch: (command: ModalCommand) => void;
  /** The currently-open command, or `null` when no bus modal is open. */
  active: ModalCommand | null;
  /** Close whatever bus modal is open. */
  close: () => void;
};

export const ModalBusContext = createContext<ModalBus | null>(null);

function useModalBus(): ModalBus {
  const bus = useContext(ModalBusContext);
  if (!bus) throw new Error("modal bus used outside <ModalBusProvider>");
  return bus;
}

/** Returns `dispatch` for opening a modal from anywhere in the tree. */
export function useModalDispatch(): (command: ModalCommand) => void {
  return useModalBus().dispatch;
}

/**
 * For a modal host: the command opening this `kind` (or `null` when it's
 * closed, which also carries the command's payload) plus a `close` to
 * dismiss it.
 */
export function useModalState<K extends ModalKind>(
  kind: K,
): {
  command: Extract<ModalCommand, { kind: K }> | null;
  close: () => void;
} {
  const { active, close } = useModalBus();
  const command =
    active?.kind === kind
      ? (active as Extract<ModalCommand, { kind: K }>)
      : null;
  return { command, close };
}

/** Whether any bus modal owns the screen (used to gate global gestures). */
export function useAnyModalOpen(): boolean {
  return useModalBus().active !== null;
}
