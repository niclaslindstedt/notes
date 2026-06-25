import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { useT } from "../i18n/index.ts";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
import { useSwipeReveal } from "./hooks/useSwipeReveal.ts";
import { RowActionMenu } from "./RowActionMenu.tsx";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./icons.tsx";
import { NOTE_DROP_ATTR } from "./note-drag-context.ts";

// The side menu's presentational row/section primitives — the dumb leaf
// components the `SideMenu` container composes. Each takes everything it needs
// via props (or reaches a context provider mounted above the whole app, like
// `useT`); none touches the container's drag / folder-expand / namespace state,
// which is what lets them live here as standalone, directly-testable units.

// Shared width of the trailing action strip a left swipe latches open — the
// single delete button on a note row (`SwipeToRemove`) and the split
// [edit | delete] strip on a folder row (`FolderRow`) are the same width.
export const REMOVE_ACTION_W = 96;

// A section label with an optional trailing action pinned to its trailing
// edge. For Notes the action is a "+" that starts a new note; for Namespaces
// it's a cogwheel that opens the manage dialog (passed via `addIcon`). The
// first section omits the top border; every later one draws one to separate
// it from the rows above.
export function SectionHeader({
  label,
  border = false,
  onAdd,
  addLabel,
  addIcon = <PlusIcon className="h-4 w-4" />,
  collapsible = false,
  collapsed = false,
  onToggle,
  toggleLabel,
}: {
  label: string;
  border?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  addIcon?: ReactNode;
  // When set, the heading becomes a button with a leading chevron that toggles
  // the section open/closed (used by Namespaces). The chevron sits to the left
  // of the label, matching the folder rows' affordance.
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  const labelEl = (
    <span className="text-xs font-semibold tracking-wide text-muted uppercase">
      {label}
    </span>
  );
  return (
    <div
      className={`flex items-center justify-between gap-2 px-5 pt-3 pb-1 ${
        border ? "border-t border-line" : ""
      }`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="-ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded py-0.5 pl-1 text-left text-muted hover:text-fg-bright"
        >
          {collapsed ? (
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
          )}
          {labelEl}
        </button>
      ) : (
        labelEl
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="-mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
        >
          {addIcon}
        </button>
      )}
    </div>
  );
}

// A folder header row: tap the label to expand/collapse. Its edit and delete
// actions stay hidden until summoned, the way a note's do — a left swipe
// latches open an [edit | delete] strip (sharing the width of a note's single
// delete button, split in two) on touch, and a right-click opens the same two
// actions on a computer. The whole row is a drop target — dropping a note onto
// it files the note into the folder (the highlight follows `isDropTarget`).
// Deleting a folder is undoable and only ungroups its notes, so — like a note
// delete — it needs no confirm beat.
export function FolderRow({
  name,
  count,
  expanded,
  containsActiveNote,
  isDropTarget,
  renameLabel,
  deleteLabel,
  addNoteLabel,
  onToggle,
  onRename,
  onDelete,
  onAddNote,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  name: string;
  count: number;
  expanded: boolean;
  /** The currently open note is filed in this folder — tints the glyph accent. */
  containsActiveNote: boolean;
  isDropTarget: boolean;
  renameLabel: string;
  deleteLabel: string;
  addNoteLabel: string;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddNote: () => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
}) {
  const t = useT();
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  // No archive analogue for a folder, so a right swipe is inert — only the
  // left swipe latches the edit/delete strip open.
  const swipe = useSwipeReveal(REMOVE_ACTION_W);

  const header = (
    // The toggle and the "+" are siblings, not nested buttons: tapping the
    // label expands the folder; the far-right "+" starts a note filed inside
    // it. Both sit inside the swipe / right-click wrappers below.
    <div className="flex w-full min-w-0 items-center">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[var(--density-row-py)] pr-1 pl-3 text-left text-fg hover:text-fg-bright"
      >
        <span className="text-muted">
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </span>
        <span className={containsActiveNote ? "text-accent" : "text-muted"}>
          {expanded ? (
            <FolderOpenIcon className="h-5 w-5" />
          ) : (
            <FolderIcon className="h-5 w-5" />
          )}
        </span>
        <span className="flex-1 truncate">{name}</span>
        {count > 0 && (
          <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted tabular-nums">
            {count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddNote();
        }}
        aria-label={addNoteLabel}
        title={addNoteLabel}
        className="mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );

  if (isDesktop) {
    return (
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`text-sm ${
          isDropTarget
            ? "bg-accent/15 ring-1 ring-accent/40 ring-inset"
            : "hover:bg-surface-2"
        }`}
      >
        <RowActionMenu
          ariaLabel={t("nav.folderActions")}
          actions={[
            {
              label: renameLabel,
              icon: <PencilIcon className="h-5 w-5" />,
              onSelect: onRename,
            },
            {
              label: deleteLabel,
              icon: <TrashIcon className="h-5 w-5" />,
              onSelect: onDelete,
              danger: true,
            },
          ]}
        >
          {header}
        </RowActionMenu>
      </div>
    );
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative overflow-hidden text-sm"
    >
      {/* Edit + Delete — the trailing strip a left swipe latches open. Hidden
          until the row is swiped left. */}
      <div
        aria-hidden={swipe.offset >= 0}
        className={`absolute inset-0 flex items-center justify-end ${
          swipe.offset < 0 ? "" : "invisible"
        }`}
      >
        <div className="flex h-full" style={{ width: REMOVE_ACTION_W }}>
          <button
            type="button"
            onClick={() => {
              swipe.close();
              onRename();
            }}
            aria-label={renameLabel}
            className="flex h-full flex-1 items-center justify-center bg-surface-3 text-fg-bright"
          >
            <PencilIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              swipe.close();
              onDelete();
            }}
            aria-label={deleteLabel}
            className="flex h-full flex-1 items-center justify-center bg-danger text-white"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        {...swipe.handlers}
        data-drawer-swipe-ignore
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={`relative [touch-action:pan-y] ${
          swipe.animating ? "transition-transform duration-200" : ""
        } ${
          isDropTarget
            ? "bg-accent/15 ring-1 ring-accent/40 ring-inset"
            : "bg-surface"
        }`}
      >
        {header}
      </div>
    </div>
  );
}

// The inline folder name editor, used both for creating a folder (empty) and
// renaming one (seeded with its name). Committing on Enter or blur with a
// non-empty trimmed name; an empty name (or Escape) cancels — which is what
// makes a freshly-added, never-named folder simply vanish on defocus. The
// `committed` latch stops the blur that follows an Enter from firing twice.
export function FolderEditRow({
  initial = "",
  placeholder,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [committed, setCommitted] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Focus (and select) on mount without the a11y-flagged `autoFocus` prop —
  // the row only appears on an explicit "new folder" / "rename" action, so it
  // takes focus, the way the editor's title field does for a fresh note.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  function finish() {
    if (committed) return;
    setCommitted(true);
    const name = value.trim();
    if (name) onCommit(name);
    else onCancel();
  }
  return (
    <div className="flex items-center gap-2 py-[var(--density-row-py)] pr-2 pl-3">
      {/* An empty chevron-sized spacer (no chevron — a brand-new folder can't
          be expanded) keeps the folder glyph aligned with the existing
          folders' glyphs, which sit one notch right of their chevron. */}
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-muted">
        <FolderIcon className="h-5 w-5" />
      </span>
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setCommitted(true);
            onCancel();
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-fg-bright outline-none placeholder:text-muted/60"
      />
    </div>
  );
}

export function NavItem({
  icon,
  label,
  active,
  disabled = false,
  indent = false,
  badge,
  trailing,
  onClick,
  dropId,
  isDropTarget = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  // Renders the row inert and dimmed — used by undo / redo at the timeline
  // ends, where there is nothing to revert or re-apply.
  disabled?: boolean;
  // Indents the row one level — used for notes (and the "New note" row) nested
  // under an expanded folder so the hierarchy reads at a glance.
  indent?: boolean;
  // Optional trailing count pill (e.g. the number of archived notes). The
  // caller hides it at zero by passing `undefined`.
  badge?: number;
  // Optional trailing element (e.g. the green encryption lock on a note row).
  trailing?: ReactNode;
  onClick: () => void;
  // Drop-target wiring: a `data-note-drop` key (so the touch drag layer
  // hit-tests it) plus the desktop HTML5 handlers and a highlight flag. Used
  // to make a namespace row or the Archive row accept a dragged note.
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
      disabled={disabled}
      onClick={onClick}
      {...(dropId !== undefined ? { [NOTE_DROP_ATTR]: dropId } : {})}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex w-full items-center gap-3 py-[var(--density-row-py)] text-left text-sm ${
        indent ? "pr-5 pl-11" : "px-5"
      } ${
        disabled
          ? "cursor-not-allowed text-muted opacity-40"
          : isDropTarget
            ? "cursor-pointer bg-accent/15 text-fg-bright ring-1 ring-accent/40 ring-inset"
            : active
              ? "cursor-pointer bg-accent/20 font-semibold text-fg-bright shadow-[inset_3px_0_0_var(--color-accent)]"
              : "cursor-pointer text-fg hover:bg-surface-2 hover:text-fg-bright"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
      {badge !== undefined && (
        <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

// Wraps a drawer row with the same two-outcome swipe as the overview card:
// a LEFT swipe latches it open to reveal a trailing trash button, and a RIGHT
// swipe archives the note (see `useSwipeReveal`). Tapping the trash deletes
// straight away — no confirming second tap, because the deletion is itself
// undoable from the Undo button. Archiving fires straight from the gesture
// too: it's undoable as well, and the note merely moves to the Archive view,
// so it needs no confirm. The sliding foreground carries its own surface
// background so it covers both actions while closed.
export function SwipeToRemove({
  actionLabel,
  archiveLabel,
  onRemove,
  onArchive,
  children,
}: {
  /** Accessible label for the trash button. */
  actionLabel: string;
  /** Label shown on the archive backdrop a right swipe uncovers. */
  archiveLabel: string;
  onRemove: () => void | Promise<void>;
  onArchive: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  const swipe = useSwipeReveal(REMOVE_ACTION_W, onArchive);

  function act() {
    swipe.close();
    void onRemove();
  }

  // On a computer the swipe gestures give way to a right-click menu of the
  // same actions (see `RowActionMenu`); a plain click still selects the note.
  if (isDesktop) {
    return (
      <RowActionMenu
        ariaLabel={t("app.noteActions")}
        actions={[
          {
            label: archiveLabel,
            icon: <ArchiveIcon className="h-5 w-5" />,
            onSelect: onArchive,
          },
          {
            label: actionLabel,
            icon: <TrashIcon className="h-5 w-5" />,
            onSelect: () => void onRemove(),
            danger: true,
          },
        ]}
      >
        {children}
      </RowActionMenu>
    );
  }

  return (
    <div className="relative overflow-hidden">
      {/* Archive backdrop — uncovered by swiping the row right. Hidden unless
          the foreground is sliding right so the slide-off never bares it. */}
      <div
        aria-hidden={swipe.offset <= 0}
        className={`absolute inset-0 flex items-center justify-start gap-2 bg-accent/15 pl-5 text-xs font-semibold tracking-wide text-accent uppercase ${
          swipe.offset > 0 ? "" : "invisible"
        }`}
      >
        <ArchiveIcon className="h-5 w-5" />
        {archiveLabel}
      </div>
      {/* Delete — the trailing trash button a left swipe latches open. Kept
          hidden while the row slides right so the archive slide-off never
          bares it alongside the archive backdrop. */}
      <div
        aria-hidden={swipe.offset >= 0}
        className={`absolute inset-0 flex items-center justify-end ${
          swipe.offset < 0 ? "" : "invisible"
        }`}
      >
        <button
          type="button"
          onClick={act}
          aria-label={actionLabel}
          style={{ width: REMOVE_ACTION_W }}
          className="flex h-full items-center justify-center bg-danger text-xs font-semibold tracking-wide text-white uppercase"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
      <div
        {...swipe.handlers}
        data-drawer-swipe-ignore
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={`relative bg-surface [touch-action:pan-y] ${
          swipe.animating ? "transition-transform duration-200" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
