// Hands a rendered HTML document to the platform's print engine, which is where
// the PDF actually gets written.
//
// The app ships no PDF library and has no backend to render on (see AGENTS.md);
// every surface it runs on — browser, the native WebView, Electron — already
// carries a production-grade PDF writer behind `print()`, reachable from the
// print dialog's "Save as PDF" (or, on iOS, the share sheet). So the export
// builds the page (`src/domain/pdf-render.ts`) and this module puts it in front
// of that engine.
//
// It prints from an **off-screen iframe** rather than the app's own window
// because the app window is a full-height flex shell with a fixed header, a
// virtualised body and a service worker: printing it would print the chrome,
// not the note. A `srcdoc` iframe is same-origin, so its `contentWindow.print()`
// is reachable directly, and the document is entirely self-contained (one
// inline `<style>`, images as `data:` URLs), so there is nothing to fetch.

const logScope = "export";

/**
 * Show the print dialog for a self-contained HTML document.
 *
 * Resolves once the dialog has been raised, **not** once the user has saved —
 * `print()` blocks in some engines and returns immediately in others, and no
 * browser tells a page whether a print was completed or cancelled. Callers
 * should treat this as fire-and-forget.
 */
export async function printHtmlDocument(html: string): Promise<boolean> {
  if (typeof document === "undefined") return false;

  const frame = document.createElement("iframe");
  // Not `display:none` and not zero-sized: an iframe with no layout box is
  // never laid out, and an unlaid-out document prints blank in WebKit. It is
  // given a real (small) box, parked off-screen where nothing can see it.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none;";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.title = "";

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  document.body.appendChild(frame);
  frame.srcdoc = html;

  try {
    await loaded;
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return false;
    }
    // Give the engine the two things that decide the first page's layout:
    // the webfont metrics and the decoded images. Without this an image-bearing
    // note prints with a blank hole where the picture will be a frame later.
    await settle(win, frame.contentDocument);
    win.focus();
    win.print();
    scheduleTeardown(win, frame);
    return true;
  } catch (err) {
    console.warn(`[${logScope}] print failed`, err);
    frame.remove();
    return false;
  }
}

// Wait for the print document to be ready to lay out: fonts resolved and every
// image decoded. Bounded — a stuck image must delay the dialog, not cancel the
// export — so the worst case is one picture printing at its intrinsic box.
async function settle(win: Window, doc: Document | null): Promise<void> {
  if (!doc) return;
  const fonts = doc.fonts?.ready;
  const images = Array.from(doc.images).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
  );
  await Promise.race([
    Promise.all([fonts, ...images]),
    new Promise((resolve) => win.setTimeout(resolve, 5000)),
  ]);
}

// Remove the iframe once the dialog is done with it. Chrome and Firefox fire
// `afterprint`; WebKit is unreliable about it, so a long timer backs it up.
// Removing the frame early cancels an in-flight print, which is why the
// fallback is generous rather than tight.
function scheduleTeardown(win: Window, frame: HTMLIFrameElement): void {
  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    frame.remove();
  };
  win.addEventListener("afterprint", teardown, { once: true });
  window.setTimeout(teardown, 120_000);
}
