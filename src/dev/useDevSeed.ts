// Hook backing the developer "Fake data" toggle. When active, `App` swaps the
// storage adapter for the ephemeral in-memory seed adapter
// (`src/storage/dev-seed/index.ts`), so the app shows a sample document
// without touching the real backend. Turning it off restores the real adapter
// and the user's untouched data reloads.
//
// The flag is deliberately IN-MEMORY ONLY — no localStorage write — so a page
// reload (or leaving the app) always drops back to the real backend. That
// makes reload the guaranteed escape hatch: fake data can never outlive the
// tab. State lives at module scope with a pub/sub layer (mirroring
// `useDevMode`) so the toggle in the Developer settings and the adapter swap
// in `App` see the same value in the same render. Ported from checklist's
// `useDevSeed`.

import { useEffect, useState } from "react";

import { unlock } from "../achievements/bus.ts";

let active = false;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // Subscriber errors must not break the notify loop.
    }
  }
}

function setActiveGlobal(next: boolean): void {
  if (active === next) return;
  active = next;
  if (next) unlock("holodeck");
  notify();
}

export function useDevSeed(): {
  active: boolean;
  setActive: (next: boolean) => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const cb = () => force((v) => v + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  return { active, setActive: setActiveGlobal };
}
