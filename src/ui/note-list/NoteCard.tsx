import { useCallback, type ReactNode } from "react";

import {
  noteTitle,
  notePreview,
  notePreviewBlock,
  type Note,
} from "../../domain/note.ts";
import { useT } from "../../i18n/index.ts";
import { useAppearance } from "../../theme/useTheme.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useRowSwipe } from "../hooks/useRowSwipe.ts";
import { RowActionMenu } from "../RowActionMenu.tsx";
import { LockIcon, NoteIcon, SpinnerIcon, TrashIcon } from "../icons.tsx";

function NoteLock({ loaded }: { loaded: boolean }) {
  const t = useT();
  return (
    <>
      <LockIcon
        className={`h-3.5 w-3.5 shrink-0 ${loaded ? "text-accent" : "text-muted"}`}
      />
      <span className="sr-only">
        {t(loaded ? "app.encryptedNoteLoaded" : "app.encryptedNote")}
      </span>
    </>
  );
}

export function NoteCard({
  note,
  onOpen,
  encrypted = false,
  uploading = false,
}: {
  note: Note;
  onOpen: () => void;
  /** Show the lock — the note + all its attachments are encrypted at rest (green
   * once the body is loaded, gray while still deferred). */
  encrypted?: boolean;
  /** Show the sync spinner — the note's file is being uploaded right now. */
  uploading?: boolean;
}) {
  const t = useT();
  // The overview's three looks (Settings → Appearance → Note list): `cards` is
  // the roomier, multi-line treatment; `rows` is the compact one-line list with
  // a title and a one-line excerpt; `list` is the bare file-explorer listing —
  // a file glyph and the title only, no excerpt and no card chrome.
  const layout = useAppearance().listLayout;
  const cards = layout === "cards";
  const list = layout === "list";

  // The lock glyph for an encrypted note. With lazy decryption every note is
  // sealed at rest, so the lock's *colour* reports whether its body has been
  // decrypted this session: green (accent) once it's been opened/warmed (body
  // loaded), gray (muted) while it's still deferred and would need decrypting on
  // open. `note.body === undefined` is the deferred marker (distinct from "").
  const lock = encrypted ? <NoteLock loaded={note.body !== undefined} /> : null;

  // The file-explorer listing: just a document glyph and the title, dense and
  // chrome-free so a folder's notes read like files in a tree. No excerpt, and
  // the lock / upload glyphs still ride alongside the title.
  if (list) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left text-sm text-fg-bright transition-colors hover:bg-surface-2"
      >
        <NoteIcon className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate">{noteTitle(note)}</span>
        {uploading ? (
          <>
            <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
            <span className="sr-only">{t("app.uploadingNote")}</span>
          </>
        ) : (
          lock
        )}
      </button>
    );
  }

  const preview = cards ? notePreviewBlock(note) : notePreview(note);
  // Only fade the tail when there's plausibly more text below the clamp — a
  // short note shouldn't have its one line dimmed. A cheap content heuristic
  // (line count or length) stands in for measuring the clamped overflow.
  const fade =
    cards && (preview.length > 150 || preview.split("\n").length > 4);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-[var(--radius)] border border-line bg-surface text-left transition-colors hover:bg-surface-2 ${
        cards ? "px-4 py-3" : "px-4 py-2.5"
      }`}
    >
      <p className="flex items-center gap-1.5 font-medium text-fg-bright">
        <span className="truncate">{noteTitle(note)}</span>
        {/* The transient upload spinner takes precedence over the lock: a note
            being written isn't settled at rest yet, so showing both would
            misread. The lock returns once the write (and any encryption) is
            done. */}
        {uploading ? (
          <>
            <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
            <span className="sr-only">{t("app.uploadingNote")}</span>
          </>
        ) : (
          lock
        )}
      </p>
      {preview &&
        (cards ? (
          <p
            className="mt-1 max-h-[6.5rem] overflow-hidden text-sm leading-snug whitespace-pre-line text-muted"
            style={
              fade
                ? {
                    maskImage:
                      "linear-gradient(to bottom, #000 65%, transparent)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, #000 65%, transparent)",
                  }
                : undefined
            }
          >
            {preview}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
        ))}
    </button>
  );
}

// A note card with two swipe outcomes behind a sliding foreground (see
// `useRowSwipe`): swiping right uncovers the primary backdrop and fires it
// once past the threshold — archive in the overview, restore on the archive
// page; swiping left latches a Delete button open. Both are recorded on the
// undo timeline, so a stray swipe is one Undo away — which is why delete here
// needs no confirmation. A plain tap still opens the note; the hook swallows
// the click that trails a real drag.
export function SwipeableNoteCard({
  note,
  onOpen,
  onPrimary,
  onDelete,
  primaryLabel,
  primaryIcon,
  encrypted = false,
  uploading = false,
}: {
  note: Note;
  onOpen: () => void;
  /** The swipe-right outcome — archive in the overview, restore in the archive. */
  onPrimary: () => void;
  onDelete: () => void;
  /** Backdrop label revealed by the swipe-right gesture. */
  primaryLabel: string;
  /** Backdrop icon revealed by the swipe-right gesture. */
  primaryIcon: ReactNode;
  /** Show the lock — the note is encrypted at rest (green once its body is
   * loaded, gray while still deferred). */
  encrypted?: boolean;
  /** Show the sync spinner — the note's file is being uploaded right now. */
  uploading?: boolean;
}) {
  const t = useT();
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  const primary = useCallback(() => onPrimary(), [onPrimary]);
  const swipe = useRowSwipe(primary);

  // On a computer, swipe gestures give way to a right-click menu of the same
  // actions (see `RowActionMenu`); the card itself opens on a plain click.
  if (isDesktop) {
    return (
      <RowActionMenu
        ariaLabel={t("app.noteActions")}
        actions={[
          { label: primaryLabel, icon: primaryIcon, onSelect: onPrimary },
          {
            label: t("app.delete"),
            icon: <TrashIcon className="h-4 w-4" />,
            onSelect: onDelete,
            danger: true,
          },
        ]}
      >
        <NoteCard note={note} onOpen={onOpen} uploading={uploading} />
      </RowActionMenu>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)]">
      {/* Primary action — uncovered by swiping the card right. Hidden unless
          the foreground is sliding right so the slide-off never bares it. */}
      <div
        aria-hidden={swipe.offset <= 0}
        className={`absolute inset-0 flex items-center justify-start gap-2 rounded-[var(--radius)] bg-accent/15 pl-4 text-xs font-semibold tracking-wide text-accent uppercase ${
          swipe.offset > 0 ? "" : "invisible"
        }`}
      >
        {primaryIcon}
        {primaryLabel}
      </div>

      {/* Delete — uncovered by swiping the card left. Kept hidden while the
          card slides right so it's never exposed on slide-off. */}
      <div
        aria-hidden={swipe.offset >= 0}
        className={`absolute inset-0 flex items-center justify-end ${
          swipe.offset < 0 ? "" : "invisible"
        }`}
      >
        <button
          type="button"
          onClick={onDelete}
          className="h-full w-24 rounded-r-[var(--radius)] bg-danger text-xs font-semibold tracking-wide text-white uppercase"
        >
          {t("app.delete")}
        </button>
      </div>

      {/* Sliding foreground — the card itself. */}
      <div
        {...swipe.handlers}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={`relative [touch-action:pan-y] ${
          swipe.animating ? "transition-transform duration-200" : ""
        }`}
      >
        <NoteCard note={note} onOpen={onOpen} encrypted={encrypted} />
      </div>
    </div>
  );
}
