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
   * regardless. Bound to the menu-activation control on the General tab.
   */
  showMenuButton: boolean;
  /** Persist the menu-activation (floating button vs. edge swipe) preference. */
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
  /**
   * Whether the docked sidebar is folded away to its edge rail, handing its
   * width to the note. Only meaningful while `pinned` — the phone drawer
   * closes instead of collapsing.
   */
  sidebarCollapsed: boolean;
  /** Fold the docked sidebar away to its rail, or bring it back. */
  toggleSidebar: () => void;
};

/** The docked sidebar panel's own width (`w-64`). */
export const SIDEBAR_PANEL_WIDTH = "16rem";
/**
 * The width of the collapse rail that sits on the panel's inner edge — the
 * only thing left of the sidebar once it is folded away (`w-4`). Wide enough
 * to hover and press without a precise aim, narrow enough to read as a gutter
 * rather than a second panel.
 */
export const SIDEBAR_RAIL_WIDTH = "1rem";

/**
 * How much horizontal space the side menu occupies on the edge it docks on,
 * for the overlays that inset themselves past it (the toasts). `undefined`
 * when there is no docked sidebar at all, so a caller can fall back to its
 * own edge gutter.
 */
export function dockedSidebarWidth(nav: NavContextValue): string | undefined {
  if (!nav.pinned) return undefined;
  if (nav.sidebarCollapsed) return SIDEBAR_RAIL_WIDTH;
  return `calc(${SIDEBAR_PANEL_WIDTH} + ${SIDEBAR_RAIL_WIDTH})`;
}

export const NavContext = createContext<NavContextValue | null>(null);

/** The shared nav state; throws if no provider is mounted above. */
export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("nav context used outside <NavContext.Provider>");
  return ctx;
}
