// The app's route model and its bridge to the browser's session history.
//
// The shell still switches surfaces on plain state (one mounted tree, no
// routing library) — this hook just makes that state a *history* state, so the
// browser's Back / Forward (and Android's back button) walk the notes you
// visited instead of leaving the app. Open note A, then note B, and Back
// returns to A.
//
// The URL is deliberately left alone. The app is served as static files from
// GitHub Pages under three deploy slots, so a `/note/<id>` path would 404 on a
// cold load, and a note id only names a note inside its own namespace's
// document — it isn't a meaningful link. Everything therefore rides in the
// entry's `history.state`, which the browser restores on Back / Forward (and
// across a reload) without touching the address bar.
//
// Each entry carries the namespace its ids belong to, because the active
// namespace is a per-device cursor rather than part of the route: stepping back
// onto an entry from another namespace resolves to the overview instead of
// applying an id this namespace's document has never heard of.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The four surfaces the main area shows, as a value one can navigate to. */
export type Route =
  | { kind: "list" }
  | { kind: "note"; id: string }
  | { kind: "archive" }
  | { kind: "archived"; id: string };

export const LIST_ROUTE: Route = { kind: "list" };
export const ARCHIVE_ROUTE: Route = { kind: "archive" };

/** The editor on `id`, or the overview when there's no note to open. */
export function noteRoute(id: string | null): Route {
  return id === null ? LIST_ROUTE : { kind: "note", id };
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  return ("id" in a ? a.id : null) === ("id" in b ? b.id : null);
}

// What we stash on each history entry. `seq` is the entry's position in the
// session's navigation stack, which is how a `popstate` tells us where the user
// landed — the event itself only says "somewhere else".
type HistoryEntry = { route: Route; ns: string; seq: number };

const STATE_KEY = "notesRoute";

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false;
  const r = value as { kind?: unknown; id?: unknown };
  if (r.kind === "list" || r.kind === "archive") return true;
  if (r.kind === "note" || r.kind === "archived")
    return typeof r.id === "string";
  return false;
}

// Reads our slice back off a history entry. Anything else on the entry (an
// entry we never stamped, or state another surface wrote) reads as `null`.
function readEntry(state: unknown): HistoryEntry | null {
  if (!state || typeof state !== "object") return null;
  const slice = (state as Record<string, unknown>)[STATE_KEY];
  if (!slice || typeof slice !== "object") return null;
  const e = slice as { route?: unknown; ns?: unknown; seq?: unknown };
  if (!isRoute(e.route)) return null;
  if (typeof e.ns !== "string" || typeof e.seq !== "number") return null;
  return { route: e.route, ns: e.ns, seq: e.seq };
}

// Merge rather than overwrite: `useCloudBackend` and anything else that owns
// the URL may have stashed its own state on this entry. The URL argument is
// omitted throughout, which keeps the address bar exactly as it is.
function writeEntry(mode: "push" | "replace", entry: HistoryEntry): void {
  const existing = window.history.state as Record<string, unknown> | null;
  const state = { ...(existing ?? {}), [STATE_KEY]: entry };
  if (mode === "push") window.history.pushState(state, "");
  else window.history.replaceState(state, "");
}

export type Navigation = {
  /** The surface showing right now. */
  route: Route;
  /** Navigate, leaving a back step behind. A no-op if we're already there. */
  go: (next: Route) => void;
  /**
   * Navigate *without* a back step — for moves the user can't sensibly return
   * to (the open note was deleted, archived, or moved out of the namespace).
   */
  replace: (next: Route) => void;
  /**
   * An in-app "back" control: step the browser back when the entry behind us
   * is exactly `target`, otherwise navigate to it normally. Keeps
   * list → note → back → note from stacking a fresh entry each round.
   */
  backTo: (target: Route) => void;
};

export type UseRouteOptions = {
  /** The route to start on when the history entry carries none (first visit). */
  initial: () => Route;
  /** The active namespace — stamped on every entry, checked on every pop. */
  namespace: string;
  /**
   * Called after a Back / Forward step has been applied, with the route now
   * showing. The in-app navigations run through the caller's own handlers, so
   * this is where the same side effects (discarding an untouched new note,
   * refreshing the note being opened) get their chance on a history step.
   */
  onPop?: (next: Route) => void;
};

export function useRoute(options: UseRouteOptions): Navigation {
  const { namespace, initial, onPop } = options;

  const [route, setRoute] = useState<Route>(() => {
    // A reload keeps the entry's state, so the tab reopens on the surface it
    // was showing rather than falling back to the remembered note (which is
    // per-namespace and per-device, and may be a step or two behind).
    const stored =
      typeof window === "undefined" ? null : readEntry(window.history.state);
    if (stored && stored.ns === namespace) return stored.route;
    return initial();
  });

  // The popstate listener is mounted once, so everything it reads that changes
  // over time rides a ref.
  const routeRef = useRef(route);
  routeRef.current = route;
  const nsRef = useRef(namespace);
  nsRef.current = namespace;
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  // Our mirror of the session's navigation stack, indexed by `seq`. The
  // browser owns the real one and won't let us read it, and `backTo` needs to
  // know what sits behind us. A reload starts the mirror at whatever entry we
  // resumed on, so lookups below it simply miss and `backTo` navigates instead.
  const stack = useRef<HistoryEntry[]>([]);
  const index = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Stamp the entry we're already standing on, so a later step back onto it
    // carries a route.
    const seed = readEntry(window.history.state);
    const entry: HistoryEntry =
      seed && seed.ns === nsRef.current
        ? seed
        : { route: routeRef.current, ns: nsRef.current, seq: seed?.seq ?? 0 };
    writeEntry("replace", entry);
    stack.current = [];
    stack.current[entry.seq] = entry;
    index.current = entry.seq;

    const onPopState = (event: PopStateEvent) => {
      const popped = readEntry(event.state);
      // An entry we never stamped isn't ours to interpret — leave it be.
      if (!popped) return;
      index.current = popped.seq;
      stack.current[popped.seq] = popped;
      // An entry from another namespace names notes this one's document
      // doesn't hold. Land on the overview rather than applying a foreign id,
      // which would also poison the per-namespace open-note cursor.
      const next = popped.ns === nsRef.current ? popped.route : LIST_ROUTE;
      setRoute(next);
      onPopRef.current?.(next);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const go = useCallback((next: Route) => {
    if (sameRoute(routeRef.current, next)) return;
    const seq = index.current + 1;
    const entry: HistoryEntry = { route: next, ns: nsRef.current, seq };
    if (typeof window !== "undefined") writeEntry("push", entry);
    // Navigating from the middle of the stack drops whatever was ahead of us,
    // exactly as the browser's own forward list does.
    stack.current.length = seq;
    stack.current[seq] = entry;
    index.current = seq;
    setRoute(next);
  }, []);

  const replace = useCallback((next: Route) => {
    const entry: HistoryEntry = {
      route: next,
      ns: nsRef.current,
      seq: index.current,
    };
    if (typeof window !== "undefined") writeEntry("replace", entry);
    stack.current[entry.seq] = entry;
    setRoute(next);
  }, []);

  const backTo = useCallback(
    (target: Route) => {
      const behind = stack.current[index.current - 1];
      if (
        behind &&
        behind.ns === nsRef.current &&
        sameRoute(behind.route, target)
      ) {
        window.history.back();
        return;
      }
      go(target);
    },
    [go],
  );

  return useMemo(
    () => ({ route, go, replace, backTo }),
    [route, go, replace, backTo],
  );
}
