import { useEffect, useRef, useState } from "react";

import { unlock } from "../achievements/index.ts";
import { COPY_SCOPES, type CopyScope, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { getAppearance, updateAppearance } from "../theme/useTheme.ts";
import { buildCopyText } from "./copy-note.ts";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons.tsx";

// Header split-button that copies the open note to the clipboard. The left half
// is one tap: it copies in the saved `copyScope` (the body alone by default).
// The right caret opens a menu to pick a different scope for this copy — the
// title and body, or the whole `.md` file with its YAML frontmatter — and
// remembers the pick as the new default (it writes through the synced editor
// setting). Used in the editor and the read-only archived-note view, left of
// the sync glyph. A brief check-mark confirms the write.

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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // Dismiss the menu on Escape or a press outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const scopeLabel: Record<CopyScope, string> = {
    body: t("app.copy.body"),
    titleBody: t("app.copy.titleBody"),
    frontMatter: t("app.copy.frontMatter"),
  };

  async function runCopy(scope: CopyScope) {
    const ok = await writeClipboard(buildCopyText(note, scope));
    if (!ok) return;
    unlock("copycat");
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  // A menu pick copies that scope and adopts it as the saved default, so the
  // left half repeats the choice with a single tap next time.
  async function choose(scope: CopyScope) {
    setOpen(false);
    const cur = getAppearance();
    if (cur.editor.copyScope !== scope)
      updateAppearance("editor", { ...cur.editor, copyScope: scope });
    await runCopy(scope);
  }

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <div className="inline-flex h-9 items-center rounded-[var(--radius)] border border-accent/40 text-accent">
        <button
          type="button"
          onClick={() => void runCopy(copyScope)}
          title={copied ? t("app.copy.copied") : t("app.copy.label")}
          aria-label={copied ? t("app.copy.copied") : t("app.copy.label")}
          className="inline-flex h-full w-9 cursor-pointer items-center justify-center rounded-l-[var(--radius)] hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          {copied ? (
            <CheckIcon className="h-[18px] w-[18px]" />
          ) : (
            <CopyIcon className="h-[18px] w-[18px]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t("app.copy.menuLabel")}
          aria-label={t("app.copy.menuLabel")}
          className="inline-flex h-full w-6 cursor-pointer items-center justify-center rounded-r-[var(--radius)] border-l border-accent/30 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label={t("app.copy.menuLabel")}
          className="absolute top-full right-0 z-40 mt-1 min-w-[12rem] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1 shadow-lg"
        >
          {COPY_SCOPES.map((scope) => {
            const active = scope === copyScope;
            return (
              <button
                key={scope}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => void choose(scope)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 ${
                  active ? "text-accent" : "text-fg"
                }`}
              >
                <span>{scopeLabel[scope]}</span>
                {active && <CheckIcon className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
