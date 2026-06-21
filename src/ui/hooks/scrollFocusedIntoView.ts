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
// Re-run the scroll once the viewport has actually shrunk: wait for the next
// `visualViewport` resize (the keyboard settling), then centre the field in
// its scroll container. A timeout backstops platforms that fire no resize
// (desktop focus, or a focus that opens no keyboard — where the element is
// already on screen and centring is harmless).
export function scrollFocusedIntoView(el: HTMLElement): void {
  const reveal = () => {
    if (el.isConnected) el.scrollIntoView({ block: "center" });
  };

  const vv = window.visualViewport;
  if (!vv) {
    reveal();
    return;
  }

  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    vv.removeEventListener("resize", run);
    reveal();
  };
  vv.addEventListener("resize", run);
  window.setTimeout(run, 350);
}
