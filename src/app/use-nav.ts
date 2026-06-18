// Owns the top-level navigation state App feeds into `NavContext`: the
// drawer's open/close, whether the menu is pinned open as a docked sidebar
// (a media query), the live drag flag, and the floating button's resting
// position (persisted to localStorage so it survives reloads). The
// component tree reads this through `useNav`, never the raw state here —
// mirroring how `useTheme` owns the theme. The richer per-view navigation
// checklist carries (view switching, edge-swipe-to-open) can grow in here
// later via `copy-feature`.

import { useCallback, useMemo, useState } from "react";

import { useMediaQuery } from "../ui/hooks/useMediaQuery.ts";
import type { NavContextValue } from "../ui/nav-context.ts";
import type { MenuButtonPosition } from "../ui/sideMenuPosition.ts";

const STORAGE_KEY = "notes/menu-position";
const DEFAULT_POSITION: MenuButtonPosition = { side: "left", y: 0.5 };

function isPosition(value: unknown): value is MenuButtonPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (p.side === "left" || p.side === "right") && typeof p.y === "number";
}

function readStoredPosition(): MenuButtonPosition {
  if (typeof localStorage === "undefined") return DEFAULT_POSITION;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_POSITION;
  try {
    const data: unknown = JSON.parse(raw);
    if (isPosition(data)) return data;
  } catch {
    // Corrupt blob — fall back to the default resting spot.
  }
  return DEFAULT_POSITION;
}

export function useNavState(): NavContextValue {
  const [open, setOpen] = useState(false);
  const [, setDraggingState] = useState(false);
  const [position, setPositionState] =
    useState<MenuButtonPosition>(readStoredPosition);
  // From the smallest iPad up the menu docks open as a permanent sidebar
  // rather than a drawer (matches checklist's breakpoint).
  const pinned = useMediaQuery("(min-width: 768px)");

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const setDragging = useCallback((d: boolean) => setDraggingState(d), []);
  const setPosition = useCallback((next: MenuButtonPosition) => {
    setPositionState(next);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota exceeded or storage disabled — keep the in-memory value.
      }
    }
  }, []);

  return useMemo<NavContextValue>(
    () => ({
      open,
      toggle,
      close,
      setDragging,
      position,
      setPosition,
      // The floating button only exists in the un-pinned drawer layout; the
      // pinned sidebar renders no button at all.
      showButton: !pinned,
      pinned,
    }),
    [open, toggle, close, setDragging, position, setPosition, pinned],
  );
}
