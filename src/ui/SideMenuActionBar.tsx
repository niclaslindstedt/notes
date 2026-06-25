import type { DragEvent as ReactDragEvent, ReactNode } from "react";

import { useT } from "../i18n/index.ts";
import {
  ArchiveIcon,
  FolderIcon,
  ListIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from "./icons.tsx";
import { NOTE_DROP_ARCHIVE, NOTE_DROP_ATTR } from "./note-drag-context.ts";

// The button island: New note / New folder / Show all / Archive and Undo / Redo
// share one bordered block pinned to the foot of the list (mt-auto), so it falls
// under the thumb no matter how long the note list is. A top row of
// create/navigate actions and a bottom row of history actions are split by a
// divider, so the six icon buttons read as one coherent unit rather than
// competing widgets. Each cell splits its row's width evenly; the parent owns the
// border, rounding, and the inner dividers. Show all and Archive light up
// (accent) when their view is showing; Archive carries the archived-note count
// and accepts a dragged note as a drop target. New folder drops the inline name
// input into the list above. Undo / redo dim and go inert at the ends of the
// timeline but keep the drawer open so a burst of reverts can be applied without
// reopening it.
//
// Self-contained except for the Archive row's drop-target wiring, which the
// drawer owns (the live drag state lives in `SideMenu`) and threads down as the
// `archive*` props.
export function SideMenuActionBar({
  onNewNote,
  onNewFolder,
  onShowAll,
  showAllActive,
  onOpenArchive,
  archiveActive,
  archivedCount,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  archiveIsDropTarget,
  onArchiveDragOver,
  onArchiveDragLeave,
  onArchiveDrop,
}: {
  /** Start a fresh note and open it (the drawer closes behind it). */
  onNewNote: () => void;
  /** Drop the inline "new folder" name input into the list above. */
  onNewFolder: () => void;
  /** Leave the editor and show the full overview (the drawer closes behind it). */
  onShowAll: () => void;
  /** Whether the overview is the view currently showing. */
  showAllActive: boolean;
  /** Open the archive page (the drawer closes behind it). */
  onOpenArchive: () => void;
  /** Whether the archive page is the view currently showing. */
  archiveActive: boolean;
  /** How many notes are archived — shown as a corner badge on Archive. */
  archivedCount: number;
  /** Revert the most recent recorded edit. */
  onUndo: () => void;
  /** Re-apply the most recently undone edit. */
  onRedo: () => void;
  /** Whether there is a recorded edit to revert. */
  canUndo: boolean;
  /** Whether there is an undone edit to re-apply. */
  canRedo: boolean;
  /** Whether the Archive cell should paint its drag-hover highlight. */
  archiveIsDropTarget: boolean;
  onArchiveDragOver: (e: ReactDragEvent) => void;
  onArchiveDragLeave: (e: ReactDragEvent) => void;
  onArchiveDrop: (e: ReactDragEvent) => void;
}) {
  const t = useT();
  return (
    <div className="mt-auto px-3 pt-2 pb-3">
      <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
        <div className="flex divide-x divide-line">
          <BarButton
            icon={<PlusIcon className="h-5 w-5" />}
            label={t("nav.newNote")}
            onClick={onNewNote}
          />
          <BarButton
            icon={<FolderIcon className="h-5 w-5" />}
            label={t("nav.newFolder")}
            onClick={onNewFolder}
          />
          <BarButton
            icon={<ListIcon className="h-5 w-5" />}
            label={t("nav.showAll")}
            active={showAllActive}
            onClick={onShowAll}
          />
          <BarButton
            icon={<ArchiveIcon className="h-5 w-5" />}
            label={t("nav.archive")}
            active={archiveActive}
            badge={archivedCount > 0 ? archivedCount : undefined}
            dropId={NOTE_DROP_ARCHIVE}
            isDropTarget={archiveIsDropTarget}
            onDragOver={onArchiveDragOver}
            onDragLeave={onArchiveDragLeave}
            onDrop={onArchiveDrop}
            onClick={onOpenArchive}
          />
        </div>
        <div className="flex divide-x divide-line">
          <BarButton
            icon={<UndoIcon className="h-5 w-5" />}
            label={t("nav.undo")}
            disabled={!canUndo}
            onClick={onUndo}
          />
          <BarButton
            icon={<RedoIcon className="h-5 w-5" />}
            label={t("nav.redo")}
            disabled={!canRedo}
            onClick={onRedo}
          />
        </div>
      </div>
    </div>
  );
}

// New note / New folder / Show all / Archive and Undo / Redo render as compact
// segmented rows inside the button island instead of full-width rows, saving
// vertical space. The cells sit flush against one another (the parent owns the
// border, rounding, and inner `divide-x` / `divide-y` dividers) and split their
// row's width evenly so each row reads symmetric. The buttons are icon-only (the
// label rides on `aria-label` / `title`); the active view tints accent, the
// Archive button doubles as a drop target with its count as a corner badge, and
// undo / redo dim and go inert (`disabled`) at the ends of the timeline.
function BarButton({
  icon,
  label,
  active = false,
  badge,
  disabled = false,
  onClick,
  dropId,
  isDropTarget = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  onClick: () => void;
  dropId?: string;
  isDropTarget?: boolean;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: (e: ReactDragEvent) => void;
  onDrop?: (e: ReactDragEvent) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...(dropId !== undefined ? { [NOTE_DROP_ATTR]: dropId } : {})}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex flex-1 items-center justify-center py-2.5 ${
        disabled
          ? "cursor-not-allowed text-muted opacity-40"
          : isDropTarget
            ? "cursor-pointer bg-accent/15 text-fg-bright"
            : active
              ? "cursor-pointer bg-surface-2 text-fg-bright"
              : "cursor-pointer text-fg hover:bg-surface-2 hover:text-fg-bright"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      {badge !== undefined && (
        <span className="absolute top-0.5 right-0.5 rounded-full bg-surface-3 px-1 py-0.5 text-[10px] leading-none text-muted tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
