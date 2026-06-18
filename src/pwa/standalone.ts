import { useState } from "react";

// Detects the one context where hiding chrome / offering edge gestures is
// safe: the app launched as an installed PWA (standalone display mode) on a
// touch phone / tablet (Android or iOS). Ported verbatim from checklist —
// it's platform plumbing with no app-specific coupling.

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  // iOS Safari predates the display-mode media query for home-screen apps
  // and reports the installed state on `navigator` instead.
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayModeStandalone || iosStandalone;
}

function isMobileOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return true;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS reports a desktop Safari user agent; a Mac-like UA with a
  // multi-touch screen is really an iPad.
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** True when running as an installed PWA on Android or iOS. */
export function isStandaloneMobile(): boolean {
  return isStandalone() && isMobileOS();
}

/**
 * The standalone-mobile flag as a hook. It can't change within a session
 * (you can't move from a tab to an installed window without a reload), so
 * it's read once into state and never updated.
 */
export function useStandaloneMobile(): boolean {
  return useState(isStandaloneMobile)[0];
}
