import { useEffect, useState } from "react";

// An "encryptish" progress indicator used in place of a spinner for the
// encryption status bars (the storage tab and the unlock gate). A short run of
// monospace cipher glyphs that continuously re-scramble, evoking bytes being
// enciphered — it animates without rotating. The scramble is gentle (a couple
// of cells shift per tick, not a full-row strobe) so it reads as a flowing
// cipher and stays easy on photosensitive eyes.
//
// Honours reduce-motion both ways: the OS `prefers-reduced-motion` preference
// (never starts the timer) and the in-app toggle the theme engine mirrors onto
// `<html data-reduce-motion="true">` (freezes mid-flight). When motion is off
// it simply holds a static frame, which still reads as encrypted bytes.

const CIPHER_CHARS = "0123456789ABCDEF#$%&";
const CELL_COUNT = 5;
const TICK_MS = 110;

const randCell = () =>
  CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
const randCells = () => Array.from({ length: CELL_COUNT }, randCell);
const randIndex = () => Math.floor(Math.random() * CELL_COUNT);

type Props = {
  className?: string;
};

export function CipherGlyph({ className }: Props) {
  const [cells, setCells] = useState(randCells);

  useEffect(() => {
    const prefersReduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduce) return;

    const id = window.setInterval(() => {
      if (document.documentElement.dataset.reduceMotion === "true") return;
      setCells((prev) => {
        const next = prev.slice();
        next[randIndex()] = randCell();
        next[randIndex()] = randCell();
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      aria-hidden
      className={`font-mono tabular-nums tracking-tight select-none ${className ?? ""}`}
    >
      {cells.join("")}
    </span>
  );
}
