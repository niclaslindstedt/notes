import { useEffect, useState } from "react";

// Subscribe a component to a CSS media query. Returns whether the query
// currently matches and re-renders when it flips. Reads the initial value
// synchronously so the first paint is already correct (no flash of the
// wrong layout), then tracks the `MediaQueryList`'s own `change` event —
// cheaper and more accurate than listening to `resize` and re-measuring.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // Re-sync in case the query changed (or matched) between render and effect.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
