// Hook exposing the two device-local flags that drive the Developer and
// Logs settings tabs:
//
//   - `devMode`     — whether the Developer / Logs tabs are exposed
//   - `captureLogs` — whether the logger persists entries to localStorage
//                     so the Logs tab survives a reload
//
// Both are stored outside the appearance store so they don't travel with a
// synced `settings.json` — they're device-local diagnostics. Turning dev mode
// off forcibly turns capture off too, otherwise logs would keep landing in
// localStorage while the tabs are hidden.
//
// State is owned at module scope with a pub/sub layer so multiple instances of
// the hook stay in sync within the same render — flipping the toggle in the
// General tab needs to update the modal's tab list immediately, not on the
// next reload. (The browser only fires the `storage` event in *other* tabs.)
// Ported from checklist's `useDevMode`, minus its `useDevSeed` fake-data
// pairing — notes has no dev-seed backend.

import { useEffect, useState } from "react";

import { unlock } from "../achievements/bus.ts";
import { isCaptureEnabled, setCaptureEnabled } from "./logger.ts";

const DEV_MODE_KEY = "notes:dev:mode";

function readBool(key: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(key, "true");
    else localStorage.removeItem(key);
  } catch {
    // Best-effort; swallow quota / access errors.
  }
}

let devModeState = readBool(DEV_MODE_KEY);
let captureLogsState = isCaptureEnabled();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Subscriber errors must not break the dispatch loop.
    }
  }
}

function setDevModeGlobal(next: boolean): void {
  if (devModeState !== next) {
    devModeState = next;
    writeBool(DEV_MODE_KEY, next);
    if (next) unlock("underTheHood");
  }
  // Force capture off whenever dev mode flips off — otherwise logs would keep
  // landing in localStorage while the tabs are hidden.
  if (!next && captureLogsState) {
    captureLogsState = false;
    setCaptureEnabled(false);
  }
  notify();
}

function setCaptureLogsGlobal(next: boolean): void {
  if (captureLogsState === next) return;
  captureLogsState = next;
  // `setCaptureEnabled` handles writing the capture flag key itself.
  setCaptureEnabled(next);
  notify();
}

// Pick up writes from other tabs once, at module load, so a toggle in one
// window propagates to every open tab.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DEV_MODE_KEY) {
      const next = readBool(DEV_MODE_KEY);
      if (next !== devModeState) {
        devModeState = next;
        if (!next && captureLogsState) {
          captureLogsState = false;
          setCaptureEnabled(false);
        }
        notify();
      }
    }
  });
}

export function useDevMode(): {
  devMode: boolean;
  setDevMode: (next: boolean) => void;
  captureLogs: boolean;
  setCaptureLogs: (next: boolean) => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const cb = () => force((v) => v + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  return {
    devMode: devModeState,
    setDevMode: setDevModeGlobal,
    captureLogs: captureLogsState,
    setCaptureLogs: setCaptureLogsGlobal,
  };
}
