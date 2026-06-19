import { useEffect, useRef, useState } from "react";

import { unlock } from "../achievements/index.ts";
import type { CopyScope, Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { buildCopyText } from "./copy-note.ts";
import { CheckIcon, CopyIcon } from "./icons.tsx";

// Header button that copies the open note to the clipboard, left of the sync
// glyph in the editor and the read-only archived-note view. One tap; what it
// copies is the saved `copyScope` editor setting — the body alone by default,
// or (chosen in Settings → Editor) the title and body, or the whole `.md` file
// with its YAML frontmatter. A brief check-mark confirms the write.

// Best-effort clipboard write: the async Clipboard API on a secure origin,
// falling back to a hidden-textarea `execCommand` so it still works in an
// insecure context (e.g. a plain-HTTP LAN preview) where the API is absent.
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyNoteButton({
  note,
  copyScope,
}: {
  note: Note;
  copyScope: CopyScope;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  async function copy() {
    const ok = await writeClipboard(buildCopyText(note, copyScope));
    if (!ok) return;
    unlock("copycat");
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? t("app.copy.copied") : t("app.copy.label")}
      aria-label={copied ? t("app.copy.copied") : t("app.copy.label")}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      {copied ? (
        <CheckIcon className="h-[18px] w-[18px]" />
      ) : (
        <CopyIcon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
