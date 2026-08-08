import { Suspense, lazy, type FunctionComponent } from "react";

// Code-splitting seam for the modals that open on demand.
//
// Every host in this directory renders its modal unconditionally and passes
// `open` down, because the modal itself returns `null` while closed. That
// costs nothing at runtime but it does mean the modal's code sits in the main
// bundle, downloaded and parsed on first paint by every user whether or not
// they ever open it — and the settings dialog alone is the largest single
// surface in the app.
//
// `lazyModal` moves that code into its own chunk and gates the *mount* on
// `open`, so the chunk is fetched the first time the modal is opened and comes
// from the HTTP (and, after the service worker's precache, the Cache API) on
// every later open. The `open` prop is still forwarded, so the modal's own
// closed-state handling is unchanged and a host reads exactly as before.
//
// **Only for modals reached by a deliberate, unhurried gesture** — a menu
// entry, a glyph, a row action. The one-frame gap while the chunk resolves is
// invisible there, but it is *not* free everywhere: the search modal opens
// inside a `flushSync` from the tap that requested it precisely so iOS ties
// the focus to that gesture and raises the keyboard, and an await in the
// middle of that breaks it. Leave that one, and anything else that has to
// render within the tap, statically imported.
// The loader resolves to the component itself rather than a `{ default }`
// module namespace: these modals are named exports, and `lazy` unwraps either
// (`exports.default || exports`). Handing it the component directly also keeps
// the props inferable — building a `{ default: … }` literal against a
// half-resolved contextual type collapses `P` to `never`.
export function lazyModal<P extends { open: boolean }>(
  load: () => Promise<FunctionComponent<P>>,
): FunctionComponent<P> {
  const Loaded = lazy<FunctionComponent<P>>(load);
  return function LazyModalGate(props: P) {
    if (!props.open) return null;
    // No fallback: the modal renders over the app, so there is nothing
    // sensible to show in its place for the frame before the chunk lands —
    // and a spinner that flashes for one frame reads as a glitch.
    return (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
  };
}
