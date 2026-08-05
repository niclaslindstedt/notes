// Best-effort clipboard write, shared by the editor's copy button and the
// row menu's "Copy link": the async Clipboard API on a secure origin, falling
// back to a hidden-textarea `execCommand` so it still works in an insecure
// context (e.g. a plain-HTTP LAN preview) where the API is absent.

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  const ta = document.createElement("textarea");
  try {
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    // Always, even when `execCommand` threw: a stranded off-screen textarea
    // would sit in the document stealing queries (and the caret) forever.
    ta.remove();
  }
}
