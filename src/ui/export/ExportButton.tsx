import { useEffect, useRef, useState, type ReactNode } from "react";

import { unlock } from "../../achievements/index.ts";
import type { CopyScope, Note } from "../../domain/note.ts";
import type { CompiledTransform } from "../../domain/transform.ts";
import { useT } from "../../i18n/index.ts";
import { haptics } from "../../platform/native-bridge.ts";
import { useAppearance } from "../../theme/useTheme.ts";
import { useAttachmentFetcher } from "../attachments/fetch-context.ts";
import { writeClipboard } from "../clipboard.ts";
import { buildCopyText } from "../copy-note.ts";
import { FloatingPanel } from "../FloatingPanel.tsx";
import type { FloatingPlacement } from "../hooks/useFloatingPosition.ts";
import {
  CheckIcon,
  CopyIcon,
  ExportIcon,
  FileMarkdownIcon,
  FilePdfIcon,
  SpinnerIcon,
} from "../icons.tsx";
import { Toast } from "../Toast.tsx";

// The export button: the up arrow in the note header's action cluster, opening
// a menu of the three ways a note leaves the app.
//
//   * **Export to PDF** typesets the note for paper with the user's
//     [PDF settings](../settings/ExportSection.tsx) and downloads the file.
//   * **Export to MD** downloads the `.md` file the file backends would store,
//     front matter and all.
//   * **Copy to clipboard** puts the note on the clipboard, as much of it as
//     the copy-scope setting says. This is the *only* way to copy a note —
//     the menu is where someone looks for "get this note out of the app", and
//     a second header button doing one of its three jobs was one button too
//     many in a row that already holds four. It confirms with a **`Toast`**,
//     because the row swapping to a tick is confirmation nobody sees: the menu
//     closes on the press, and copying is the one row that finishes silently
//     with no download to show for itself.
//
// **Every row is a glyph and its label, at every width.** A phone has room for
// the labelled menu, and three unexplained icons stacked under the header is a
// guessing game — so the panel is sized for text on the narrowest screen too.
//
// The export work itself is loaded on the press, not at mount: the Markdown
// codec, the layout engine and — by far the biggest of them — the PDF writer
// are not something anyone who never exports should download (see AGENTS.md,
// "the code-splitting seams").

const MENU_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 208 },
  anchor: "right",
  coordinateSpace: "viewport",
};

/** Which row is mid-flight, so it can show a spinner / a confirming tick. */
type Busy = "pdf" | "md" | "copy" | null;

export function ExportButton({
  note,
  copyScope,
  transforms,
}: {
  note: Note;
  /** How much of the note the "Copy to clipboard" row takes — see `CopyScope`. */
  copyScope: CopyScope;
  /**
   * The active display rules. Only the PDF honours them — see `PdfLayoutInput`
   * in `domain/pdf-layout.ts` for why the other two rows export the source.
   */
  transforms?: readonly CompiledTransform[];
}) {
  const t = useT();
  const { pdf } = useAppearance();
  const fetchAttachment = useAttachmentFetcher();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  async function exportPdf() {
    setBusy("pdf");
    try {
      const mod = await import("./export-note.ts");
      const ok = await mod.exportPdf(
        note,
        pdf,
        fetchAttachment,
        transforms,
        // The one word the page furniture spells out — the typesetter is pure
        // and can't reach the catalogue itself.
        t("app.export.pageNumberOf"),
      );
      if (ok) unlock("printPress");
    } finally {
      setBusy(null);
    }
  }

  async function exportMarkdown() {
    setBusy("md");
    try {
      const mod = await import("./export-note.ts");
      mod.downloadMarkdown(note);
      unlock("takeaway");
    } finally {
      setBusy(null);
    }
  }

  async function copyToClipboard() {
    const ok = await writeClipboard(buildCopyText(note, copyScope));
    if (!ok) return;
    unlock("copycat");
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  function run(action: () => Promise<void>) {
    // The menu closes on the press rather than when the work finishes: an
    // export ends in a download, and a menu still hanging over the note behind
    // it reads as a stuck UI.
    setOpen(false);
    haptics.vibrate(8);
    void action();
  }

  const rows: {
    id: Exclude<Busy, null>;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
  }[] = [
    {
      id: "pdf",
      label: t("app.export.pdf"),
      icon: <FilePdfIcon className="h-5 w-5" />,
      onSelect: () => run(exportPdf),
    },
    {
      id: "md",
      label: t("app.export.markdown"),
      icon: <FileMarkdownIcon className="h-5 w-5" />,
      onSelect: () => run(exportMarkdown),
    },
    {
      id: "copy",
      label: copied ? t("app.copy.copied") : t("app.export.clipboard"),
      icon: copied ? (
        <CheckIcon className="h-5 w-5" />
      ) : (
        <CopyIcon className="h-5 w-5" />
      ),
      onSelect: () => run(copyToClipboard),
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("app.export.label")}
        aria-label={t("app.export.label")}
        className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border bg-transparent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
          open
            ? "border-accent bg-accent/10 text-accent"
            : "border-accent/40 text-accent hover:bg-accent/10"
        }`}
      >
        {busy ? (
          <SpinnerIcon className="h-[18px] w-[18px] animate-spin text-muted" />
        ) : (
          <ExportIcon className="h-[18px] w-[18px]" />
        )}
      </button>
      <FloatingPanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement={MENU_PLACEMENT}
        // The header is pinned to the top of the screen, so there is nothing
        // useful above it to flip into (see `FloatingPanel`).
        drop="down"
        className="py-1"
      >
        <div role="menu" aria-label={t("app.export.label")}>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              role="menuitem"
              // The note body keeps its caret and selection: opening the menu
              // from the header must not blur the editing surface.
              onMouseDown={(e) => e.preventDefault()}
              onClick={row.onSelect}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-accent/15"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
            </button>
          ))}
        </div>
      </FloatingPanel>
      {copied && (
        <Toast
          message={t("app.copy.copied")}
          icon={<CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
        />
      )}
    </>
  );
}
