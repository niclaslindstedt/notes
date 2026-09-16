// A message that says itself once and then goes away — the state behind a
// `Toast` raised by something the user just did ("Image copied", "that
// attachment is gone"). The caller renders the pill; this owns only *whether*
// there is one and for how long, so every transient confirmation in the app
// times out the same way and a second message replaces the first rather than
// stacking a second pill over it.

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a message stays up. Long enough to read twice, short enough that
 *  it is gone before the next thought. */
const FLASH_MS = 3000;

export type FlashMessage = {
  /** The message to show, or null when there is nothing to say. */
  message: string | null;
  /** Say something (replacing whatever is up), or clear it with null. */
  say: (message: string | null) => void;
};

export function useFlashMessage(durationMs: number = FLASH_MS): FlashMessage {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const say = useCallback(
    (next: string | null) => {
      window.clearTimeout(timer.current);
      setMessage(next);
      if (next === null) return;
      timer.current = window.setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  return { message, say };
}
