// The app's route model, its URL, and its bridge to the browser's session
// history.
//
// The shell still switches surfaces on a plain value (one mounted tree, no
// routing library) — this hook gives that value an address and a history
// entry, so:
//
// - the browser's Back / Forward (and Android's back button) walk the notes
//   you visited, and
// - an open note has a URL you can copy, bookmark, or send yourself.
//
// The URL rides in the **hash**, not the path. The app is served as static
// files from GitHub Pages under three deploy slots, so a `/note/<id>` path
// would 404 on a cold load (nothing rewrites it to `index.html`); a hash is
// never sent to the server, so `…/#/n/<ns>/<id>` resolves on any slot, from a
// file:// bundle inside the native wrapper, and offline from the service
// worker. It also stays out of every request, so a note id is never logged by
// a server the way a path would be.
//
//   (no hash)                overview
//   #/n/<namespace>/<id>     a note in the editor
//   #/archive                the archive page
//   #/archive/<ns>/<id>      an archived note, read-only
//
// A note id only names a note inside its own namespace's document, so the
// namespace slug is part of the link — following one switches namespace (see
// `App`), and a link naming a namespace this device doesn't have resolves to
// the overview rather than to the wrong note.
//
// `history.state` carries the same route as the hash. The hash is what makes a
// link work; the state is what survives a `replaceState` from elsewhere (the
// OAuth URL cleanup in `useCloudBackend` nulls it) and what tells a `popstate`
// where in the stack it landed. Either one alone can drive the app, and they
// are written together.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The four surfaces the main area shows, as a value one can navigate to. */
export type Route =
  | { kind: "list" }
  | { kind: "note"; ns: string; id: string }
  | { kind: "archive" }
  | { kind: "archived"; ns: string; id: string };

export const LIST_ROUTE: Route = { kind: "list" };
export const ARCHIVE_ROUTE: Route = { kind: "archive" };

/** The editor on `id` in `ns`, or the overview when there's no note to open. */
export function noteRoute(id: string | null, ns: string): Route {
  return id === null ? LIST_ROUTE : { kind: "note", ns, id };
}

/** The namespace a route's ids belong to — `null` for the two list surfaces. */
export function routeNamespace(route: Route): string | null {
  return route.kind === "note" || route.kind === "archived" ? route.ns : null;
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "note" || a.kind === "archived") {
    const other = b as Extract<Route, { ns: string }>;
    return a.id === other.id && a.ns === other.ns;
  }
  return true;
}

// ── The URL ────────────────────────────────────────────────────────────────

/** The hash for a route, `""` for the overview (which wears a clean URL). */
export function routeToHash(route: Route): string {
  const seg = (s: string) => encodeURIComponent(s);
  switch (route.kind) {
    case "note":
      return `#/n/${seg(route.ns)}/${seg(route.id)}`;
    case "archive":
      return "#/archive";
    case "archived":
      return `#/archive/${seg(route.ns)}/${seg(route.id)}`;
    case "list":
      return "";
  }
}

/**
 * The route a hash names, or `null` when it names nothing we recognise — a
 * hand-edited address, or a link from a future version. The caller leaves the
 * app where it is rather than guessing.
 */
export function hashToRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, "").replace(/^\//, "");
  if (path === "") return LIST_ROUTE;
  const parts = path.split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      // A malformed escape — keep the raw segment; it simply won't match a note.
      return p;
    }
  });
  const [head, ...rest] = parts;
  if (head === "n" && rest.length === 2 && rest[0] && rest[1])
    return { kind: "note", ns: rest[0], id: rest[1] };
  if (head === "archive") {
    if (rest.length === 0) return ARCHIVE_ROUTE;
    if (rest.length === 2 && rest[0] && rest[1])
      return { kind: "archived", ns: rest[0], id: rest[1] };
  }
  return null;
}

// The address to write for a route: this slot's path and query, the route's
// hash. Never touches the path, so every deploy slot stays self-contained.
function urlFor(route: Route): string {
  const { pathname, search } = window.location;
  return `${pathname}${search}${routeToHash(route)}`;
}

// ── The history entry ──────────────────────────────────────────────────────

// What we stash on each history entry. `seq` is the entry's position in the
// session's navigation stack, which is how a `popstate` tells us where the user
// landed — the event itself only says "somewhere else".
type HistoryEntry = { route: Route; seq: number };

const STATE_KEY = "notesRoute";

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false;
  const r = value as { kind?: unknown; ns?: unknown; id?: unknown };
  if (r.kind === "list" || r.kind === "archive") return true;
  if (r.kind === "note" || r.kind === "archived")
    return typeof r.id === "string" && typeof r.ns === "string";
  return false;
}

// Reads our slice back off a history entry. Anything else on the entry (an
// entry we never stamped, or state another surface wrote) reads as `null`.
function readEntry(state: unknown): HistoryEntry | null {
  if (!state || typeof state !== "object") return null;
  const slice = (state as Record<string, unknown>)[STATE_KEY];
  if (!slice || typeof slice !== "object") return null;
  const e = slice as { route?: unknown; seq?: unknown };
  if (!isRoute(e.route) || typeof e.seq !== "number") return null;
  return { route: e.route, seq: e.seq };
}

// Merge rather than overwrite: `useCloudBackend` and anything else that owns
// the URL may have stashed its own state on this entry.
function writeEntry(mode: "push" | "replace", entry: HistoryEntry): void {
  const existing = window.history.state as Record<string, unknown> | null;
  const state = { ...(existing ?? {}), [STATE_KEY]: entry };
  const url = urlFor(entry.route);
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

// ── The hook ───────────────────────────────────────────────────────────────

export type Navigation = {
  /** The surface showing right now. */
  route: Route;
  /**
   * Whether the route showing came from the address bar — a link opened cold,
   * or a hash edited/followed while the app was running — rather than from a
   * tap inside the app or a history step.
   */
  fromLink: boolean;
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
  /**
   * The route to start on when neither the address nor the history entry names
   * one (an ordinary cold start).
   */
  initial: () => Route;
  /**
   * Called after a step the app didn't initiate has been applied — a Back /
   * Forward, or an externally changed hash — with the route now showing. The
   * in-app navigations run through the caller's own handlers, so this is where
   * the same side effects (discarding an untouched new note, refreshing the
   * note being opened) get their chance.
   */
  onPop?: (next: Route) => void;
};

type Position = { route: Route; fromLink: boolean };

export function useRoute(options: UseRouteOptions): Navigation {
  const { initial, onPop } = options;

  const [position, setPosition] = useState<Position>(() => {
    if (typeof window === "undefined")
      return { route: initial(), fromLink: false };
    // A link wins: it's the most deliberate statement of where to land, and
    // it's the only one of the three a *different* device may have written.
    // Only a link that names something, though — a bare address is how the app
    // is opened normally, and shouldn't override the remembered note.
    const linked = hashToRoute(window.location.hash);
    if (linked && linked.kind !== "list")
      return { route: linked, fromLink: true };
    // Then the entry's own state — a reload resumes on the surface this tab
    // was showing, ahead of the remembered note, which is per-device and may
    // be a step or two behind.
    const stored = readEntry(window.history.state);
    if (stored) return { route: stored.route, fromLink: false };
    return { route: initial(), fromLink: false };
  });

  // The listeners below are mounted once, so everything they read that changes
  // over time rides a ref. `live` is written synchronously by every mutator
  // (React may not have re-rendered yet when the next event lands).
  const live = useRef(position.route);
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  // Our mirror of the session's navigation stack, indexed by `seq`. The
  // browser owns the real one and won't let us read it, and `backTo` needs to
  // know what sits behind us. Entries we can't place (a reload mid-stack, an
  // entry whose state was wiped) simply miss, and `backTo` navigates instead of
  // stepping — the lookup matches on the route, so a stale mirror can only cost
  // an extra entry, never a wrong destination.
  const stack = useRef<HistoryEntry[]>([]);
  const index = useRef(0);

  const settle = useCallback((next: Position) => {
    live.current = next.route;
    setPosition(next);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Stamp the entry we're already standing on, so it carries both the route
    // and an address — a cold start on a bare URL gets the note's link in the
    // address bar, and a later step back onto this entry knows where it goes.
    const seed = readEntry(window.history.state);
    const entry: HistoryEntry = { route: live.current, seq: seed?.seq ?? 0 };
    writeEntry("replace", entry);
    stack.current = [];
    stack.current[entry.seq] = entry;
    index.current = entry.seq;

    // A Back / Forward step. The entry's own state is authoritative; if it was
    // wiped (another surface called `replaceState` on it) the address still
    // says where we are, and reading it there is the same as reading a link.
    //
    // Some browsers also fire this for a fragment navigation (a hash typed
    // into the bar), where the fresh entry has no state — hence the guard
    // below, so whichever of the two events lands first wins and the other
    // reads as a no-op. Both agree on `fromLink`, so the pair is order-safe.
    const onPopState = (event: PopStateEvent) => {
      const popped = readEntry(event.state);
      const route = popped?.route ?? hashToRoute(window.location.hash);
      if (!route || sameRoute(route, live.current)) return;
      if (popped) {
        index.current = popped.seq;
        stack.current[popped.seq] = popped;
      } else {
        stack.current = [];
        index.current = 0;
        writeEntry("replace", { route, seq: 0 });
      }
      settle({ route, fromLink: popped === null });
      onPopRef.current?.(route);
    };

    // The address bar changed under us — a hash typed in, or a link to another
    // note followed from within the app. A history step fires this too, but
    // `popstate` has already applied that route, so it reads as a no-op here.
    const onHashChange = () => {
      const route = hashToRoute(window.location.hash);
      if (!route || sameRoute(route, live.current)) return;
      // The browser pushed an entry for the new hash; stamp it as ours so a
      // step back off it behaves like any other.
      const seq = index.current + 1;
      const entry: HistoryEntry = { route, seq };
      writeEntry("replace", entry);
      stack.current.length = seq;
      stack.current[seq] = entry;
      index.current = seq;
      settle({ route, fromLink: true });
      onPopRef.current?.(route);
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [settle]);

  const go = useCallback(
    (next: Route) => {
      if (sameRoute(live.current, next)) return;
      const seq = index.current + 1;
      const entry: HistoryEntry = { route: next, seq };
      if (typeof window !== "undefined") writeEntry("push", entry);
      // Navigating from the middle of the stack drops whatever was ahead of us,
      // exactly as the browser's own forward list does.
      stack.current.length = seq;
      stack.current[seq] = entry;
      index.current = seq;
      settle({ route: next, fromLink: false });
    },
    [settle],
  );

  const replace = useCallback(
    (next: Route) => {
      const entry: HistoryEntry = { route: next, seq: index.current };
      if (typeof window !== "undefined") writeEntry("replace", entry);
      stack.current[entry.seq] = entry;
      settle({ route: next, fromLink: false });
    },
    [settle],
  );

  const backTo = useCallback(
    (target: Route) => {
      const behind = stack.current[index.current - 1];
      if (behind && sameRoute(behind.route, target)) {
        window.history.back();
        return;
      }
      go(target);
    },
    [go],
  );

  return useMemo(
    () => ({
      route: position.route,
      fromLink: position.fromLink,
      go,
      replace,
      backTo,
    }),
    [position, go, replace, backTo],
  );
}
