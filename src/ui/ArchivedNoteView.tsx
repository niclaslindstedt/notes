import { type ReactNode } from "react";

import { hiddenAttachmentLines } from "../domain/attachment.ts";
import { classifyLines } from "../domain/markdown.ts";
import { type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import { AttachmentsEndBlock } from "./attachments/AttachmentsEndBlock.tsx";
import { AttachmentsProvider } from "./attachments/AttachmentsProvider.tsx";
import { CopyNoteButton } from "./CopyNoteButton.tsx";
import { ArrowLeftIcon, RestoreIcon, TrashIcon } from "./icons.tsx";
import { RenderedLine } from "./MarkdownLine.tsx";
import { SwipeableNoteCard } from "./note-list/NoteCard.tsx";

// The archive page — the notes overview filtered to archived notes. A real
// view (not a modal) so the side menu's edge-swipe-to-open still works over
// it. Mirrors the overview's swipeable cards, but swipe-right restores instead
// of archives, and there's no "new note" button. Tapping a card opens the note
// read-only (see `ReadOnlyNote`). A back button returns to the overview.
export function ArchiveList({
  notes,
  onOpen,
  onRestore,
  onDelete,
  onBack,
  syncSlot,
}: {
  notes: Note[];
  onOpen: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  syncSlot: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            title={t("app.back")}
            aria-label={t("app.back")}
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
          >
            <ArrowLeftIcon className="h-[18px] w-[18px]" />
          </button>
          <h1 className="truncate text-lg font-bold tracking-wide text-fg-bright">
            {t("nav.archiveHeading")}
          </h1>
        </div>
        <div className="flex items-center gap-2">{syncSlot}</div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-3">
        {notes.length === 0 ? (
          <p className="mt-16 text-center text-muted">
            {t("nav.archiveEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <SwipeableNoteCard
                  note={note}
                  onOpen={() => onOpen(note.id)}
                  onPrimary={() => onRestore(note.id)}
                  onDelete={() => onDelete(note.id)}
                  primaryLabel={t("nav.restore")}
                  primaryIcon={<RestoreIcon className="h-4 w-4" />}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// A read-only view of an archived note, opened by tapping it on the archive
// page. The body is rendered formatted (the same line renderer the live
// editor uses for inactive lines) but nothing is editable. Two floating
// actions — styled after checklist's bulk archive/delete buttons — sit at the
// foot: Restore (unarchives the note and reopens it editable straight away)
// and Delete (removes it for good — undoable, so no confirm beat).
export function ReadOnlyNote({
  note,
  editor,
  onBack,
  onRestore,
  onDelete,
  syncSlot,
}: {
  note: Note;
  editor: EditorSettings;
  onBack: () => void;
  onRestore: () => void;
  onDelete: () => void;
  syncSlot: ReactNode;
}) {
  const t = useT();
  const maxWidth = editorMarginMaxWidth(editor.margin);
  const widthStyle =
    maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" };
  const title = note.title.trim();
  // The body is fetched on open, but guard against a deferred note that hasn't
  // resolved yet so the reader renders empty rather than crashing.
  const body = note.body ?? "";
  // Respect the Markdown-rendering preference: formatted lines when on, the
  // raw source otherwise — matching how the same note reads in the editor.
  const blocks = editor.renderMarkdown ? classifyLines(body) : null;
  const placement = {
    imagesAtEnd: editor.imagesAtEnd,
    filesAtEnd: editor.filesAtEnd,
  };
  // Lines whose attachment renders in the collected end block instead.
  const hidden = blocks
    ? hiddenAttachmentLines(body, placement)
    : new Set<number>();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          title={t("app.back")}
          aria-label={t("app.back")}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </button>
        <div className="flex items-center gap-2">
          <CopyNoteButton note={note} copyScope={editor.copyScope} />
          {syncSlot}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 pt-4 pb-28" style={widthStyle}>
          {title && (
            <h1 className="mb-3 text-2xl font-bold text-fg-bright">{title}</h1>
          )}
          {blocks ? (
            <AttachmentsProvider
              attachments={note.attachments}
              note={note}
              placement={placement}
            >
              {blocks.map((block, i) =>
                hidden.has(i) ? null : (
                  <div
                    key={i}
                    className="text-fg break-words whitespace-pre-wrap"
                  >
                    <RenderedLine block={block} />
                  </div>
                ),
              )}
              <AttachmentsEndBlock />
            </AttachmentsProvider>
          ) : (
            <pre className="text-fg font-[inherit] break-words whitespace-pre-wrap">
              {note.body}
            </pre>
          )}
        </div>
      </div>

      {/* Floating actions, after checklist's bulk archive/delete buttons:
          tinted, rounded, free-standing — Restore (accent/link) and Delete
          (danger). Restore reopens the note editable; delete is undoable. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onRestore}
          className="bg-link/10 text-link hover:bg-link/20 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-[filter,background-color] active:brightness-90"
        >
          <RestoreIcon className="h-5 w-5" />
          {t("nav.restore")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="bg-danger/10 text-danger hover:bg-danger/20 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-[filter,background-color] active:brightness-90"
        >
          <TrashIcon className="h-5 w-5" />
          {t("app.delete")}
        </button>
      </div>
    </div>
  );
}
