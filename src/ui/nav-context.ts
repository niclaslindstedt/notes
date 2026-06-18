import { createContext, useContext } from "react";

import type { MenuButtonPosition } from "./sideMenuPosition.ts";

// Top-level navigation state — the drawer's open/close, the floating
// button's resting position and live drag flag, and whether the menu is
// pinned open as a docked sidebar — shared through context so `SideMenu`
// reads it instead of App threading the nav props down. Mirrors
// checklist's `nav-context`: the context and its consumer hook live in
// `ui/`, App owns the state and supplies the value.

export type NavContextValue = {
  /** Whether the navigation drawer is open. */
  open: boolean;
  /** Toggle the drawer open/closed. */
  toggle: () => void;
  /** Close the drawer. */
  close: () => void;
  /**
   * Report whether the floating button is mid-drag, so App can suppress
   * competing global gestures while dragging it around.
   */
  setDragging: (dragging: boolean) => void;
  /** Where the floating button rests. */
  position: MenuButtonPosition;
  /** Persist a new resting spot after the user drags the button. */
  setPosition: (next: MenuButtonPosition) => void;
  /**
   * The user's preference for whether the floating button is shown. Only
   * honoured in the installed PWA on a phone / tablet, where the inward edge
   * swipe can safely replace it; everywhere else the button always shows
   * regardless. Bound to the Show-menu-button toggle on the General tab.
   */
  showMenuButton: boolean;
  /** Persist the Show-menu-button preference. */
  setShowMenuButton: (next: boolean) => void;
  /**
   * Whether the floating menu button is actually rendered — the preference
   * resolved against the platform (always true unless this is a standalone
   * mobile PWA that opted to hide it).
   */
  showButton: boolean;
  /**
   * Whether the side menu is pinned open as a persistent docked sidebar
   * (true on viewports at least as wide as the smallest iPad). When pinned
   * the floating button, backdrop, and open/close gestures fall away — the
   * panel is simply always there beside the content.
   */
  pinned: boolean;
};

export const NavContext = createContext<NavContextValue | null>(null);

/** The shared nav state; throws if no provider is mounted above. */
export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("nav context used outside <NavContext.Provider>");
  return ctx;
}
