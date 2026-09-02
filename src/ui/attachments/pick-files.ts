// Open the platform's file browser and hand back what was chosen. The
// counterpart to the paste / drop routes into `fileToAttachment`: the styling
// toolbar's Image/file entry needs a way to *ask* for a file rather than
// waiting for one to arrive. Left unnarrowed, a phone's browser offers the
// photo library and the camera alongside the files — which is why one entry
// covers both; an `accept` of `image/*` would make it offer photos only.
//
// DOM-bound, so it lives beside the rest of the attachment plumbing in `ui/`.

/** What the picker should offer, and whether it takes more than one file. */
export type PickOptions = {
  /** An `accept` list — `"image/*"` for the photo browser, omitted for any file. */
  accept?: string;
  /** Whether several files can be taken in one go. Defaults to true. */
  multiple?: boolean;
};

// How long after the page comes back a choice can still arrive before the trip
// is read as a cancellation.
const CANCEL_GRACE_MS = 700;

/**
 * Show the file browser and resolve with the chosen files — an empty array when
 * the user backs out.
 *
 * The input is appended to the document rather than merely constructed: Safari
 * ignores a programmatic `click()` on a detached node. It is removed again as
 * soon as the choice (or the cancellation) arrives, so nothing is left behind.
 *
 * A browser without the `cancel` event says nothing at all when the user backs
 * out, so coming back to the page has to stand in for it: the promise settles
 * empty a moment after the window regains focus with no choice delivered.
 * Waiting matters — some platforms hand focus back *before* the `change` — and
 * so does settling at all, since the caller holds the editor's caret open for
 * the length of the trip and needs to be told when it ended.
 */
export function pickFiles({
  accept,
  multiple = true,
}: PickOptions = {}): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = multiple;
    // Out of the layout but still in the document, per the Safari note above.
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";

    let settled = false;
    function onWindowFocus() {
      window.setTimeout(() => done([]), CANCEL_GRACE_MS);
    }
    function done(files: File[]) {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onWindowFocus);
      input.remove();
      resolve(files);
    }

    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    window.addEventListener("focus", onWindowFocus, { once: true });
    document.body.append(input);
    input.click();
  });
}
