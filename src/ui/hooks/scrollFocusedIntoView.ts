// Bring a freshly-focused field into view *after* the soft keyboard has taken
// its space.
//
// On mobile the browser runs its native "reveal the focused field" pass at
// focus time — before the on-screen keyboard finishes animating in and
// shrinking the visual viewport. A field that sits low inside a
// `position: fixed` modal (the encryption passphrase at the bottom of
// Settings → Storage) is still fully visible at that instant, so nothing
// scrolls; the keyboard then slides up and covers it. `useViewportHeight`
// already shrinks the modal to the post-keyboard viewport, but the scroll
// container's position doesn't change on its own, so the field stays hidden
// behind the keyboard.
//
// Re-run the scroll once the viewport has actually shrunk: wait for the
// `visualViewport` to change (the keyboard settling), then centre the field in
// its scroll container.
//
// The keyboard doesn't arrive in one step. iOS animates it in and emits a
// *burst* of `resize` (and `scroll`) events on the visual viewport as it
// settles, each reporting an intermediate height. Revealing on only the first
// one centres the line against a viewport that is still shrinking, so the last
// line — which can't scroll any further up once the container clamps — slides
// back behind the keyboard as the remaining events land, and nothing scrolls
// it clear again. Re-run the reveal on *every* event until the viewport has
// been quiet for a beat, then stop listening (so a later user scroll never
// yanks the view). A timeout backstops platforms that fire no event (desktop
// focus, or a focus that opens no keyboard — where the element is already on
// screen and centring is harmless).
export function scrollFocusedIntoView(el: HTMLElement): void {
  const reveal = () => {
    if (el.isConnected) el.scrollIntoView({ block: "center" });
  };

  const vv = window.visualViewport;
  if (!vv) {
    reveal();
    return;
  }

  let sawEvent = false;
  let quietTimer = 0;
  const stop = () => {
    window.clearTimeout(quietTimer);
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
  const onChange = () => {
    sawEvent = true;
    reveal();
    // Once the settling burst goes quiet, tear down so a later user scroll of
    // the same viewport doesn't re-centre the line under them.
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(stop, 250);
  };
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  // If the keyboard never moved the viewport, reveal once and stop; if it did,
  // the quiet-timer above already owns teardown, so leave the burst alone.
  window.setTimeout(() => {
    if (sawEvent) return;
    reveal();
    stop();
  }, 350);
}
