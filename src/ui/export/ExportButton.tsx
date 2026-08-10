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
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import {
  CheckIcon,
  CopyIcon,
  ExportIcon,
  FileMarkdownIcon,
  FilePdfIcon,
  SpinnerIcon,
} from "../icons.tsx";

// The export button: the up arrow in the note header's action cluster, opening
// a menu of the three ways a note leaves the app.
//
//   * **Export to PDF** renders the note for paper with the user's
//     [PDF settings](../settings/ExportSection.tsx) and raises the print
//     dialog, where "Save as PDF" writes the file.
//   * **Export to MD** downloads the `.md` file the file backends would store,
//     front matter and all.
//   * **Copy to clipboard** puts the note on the clipboard, as much of it as
//     the copy-scope setting says. This is the *only* way to copy a note —
//     the menu is where someone looks for "get this note out of the app", and
//     a second header button doing one of its three jobs was one button too
//     many in a row that already holds four.
//
// **On a narrow screen the rows are glyphs alone**; from `sm:` up each glyph is
// followed by its label. That is a deliberate media-query decision rather than
// a CSS `hidden sm:inline`, because the floating panel is measured and
// positioned in JS — the panel has to know it is a strip of icons, or it would
// be sized for text that isn't drawn.
//
// The export work itself is loaded on the press, not at mount: the Markdown
// codec, the print renderer and its stylesheet are a few kilobytes nobody who
// never exports should download (see AGENTS.md, "the code-splitting seams").

const MENU_PLACEMENT_WIDE: FloatingPlacement = {
  width: { kind: "min", minPx: 208 },
  anchor: "right",
  coordinateSpace: "viewport",
};

const MENU_PLACEMENT_NARROW: FloatingPlacement = {
  width: { kind: "min", minPx: 56 },
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
   * The active display rules. Only the PDF honours them — see `PrintDocument`
   * in `domain/pdf-render.ts` for why the other two rows export the source.
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
  const withLabels = useMediaQuery("(min-width: 640px)");

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  async function exportPdf() {
    setBusy("pdf");
    try {
      const mod = await import("./export-note.ts");
      const ok = await mod.exportPdf(note, pdf, fetchAttachment, transforms);
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
    // export ends in a print dialog or a download, and a menu still hanging
    // over the note behind it reads as a stuck UI.
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
        placement={withLabels ? MENU_PLACEMENT_WIDE : MENU_PLACEMENT_NARROW}
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
              title={withLabels ? undefined : row.label}
              aria-label={withLabels ? undefined : row.label}
              className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-accent/15 ${
                withLabels ? "" : "justify-center"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {row.icon}
              </span>
              {withLabels && (
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
              )}
            </button>
          ))}
        </div>
      </FloatingPanel>
    </>
  );
}
