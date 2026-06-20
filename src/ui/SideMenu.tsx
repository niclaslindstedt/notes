import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { BUILD_LABEL } from "../build-env.ts";
import { noteTitle, type Folder, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import type { Namespace } from "../storage/namespaces.ts";
import { APP_VIEWPORT_RECT } from "./appViewportRect.ts";
import { useNav } from "./nav-context.ts";
import { useDraggableMenuButton } from "./hooks/useDraggableMenuButton.ts";
import { useDrawerSwipeClose } from "./hooks/useDrawerSwipeClose.ts";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
import { useSwipeReveal } from "./hooks/useSwipeReveal.ts";
import { RowActionMenu } from "./RowActionMenu.tsx";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CogIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HeartIcon,
  ListIcon,
  LockIcon,
  MenuIcon,
  NoteIcon,
  PencilIcon,
  PlusIcon,
  RedoIcon,
  ShieldIcon,
  SparklesIcon,
  SpinnerIcon,
  TrashIcon,
  UndoIcon,
} from "./icons.tsx";
import { useModalDispatch } from "./modal-bus.ts";
import { AchievementsMenuItem } from "./achievements/AchievementsMenuItem.tsx";
import { NamespaceGlyph } from "./NamespaceGlyph.tsx";

// The navigation drawer. On viewports narrower than the smallest iPad it
// collapses to a single floating button the user can drag to either side
// edge (its resting spot persists); pressing it slides the drawer in from
// that same side over a dimmed backdrop. From the smallest iPad up
// (`nav.pinned`) the same panel is instead docked open as a permanent
// sidebar beside the content — no button, no backdrop, no open/close — so
// wider screens always see the navigation. Both variants render the
// identical section list (`sections` below); only the framing differs.
//
// The drawer lists every note by its title (the switcher — tap to open it
// in the editor). Notes can be grouped into folders: the Notes heading's
// action creates one inline (a folder glyph, not a "+"), each folder row
// expands to reveal its notes plus a per-folder "New note", and a "New note"
// row of its own sits just above "Show all". A note can be dragged onto a
// folder (or onto the ungrouped zone to leave one) to file it.
// Pinned to the bottom is what was the top-right burger menu — settings and
// the project links (privacy, source with the app version as a subtitle,
// and an optional donate), in inverted order so the whole of it sits flush
// at the foot of the drawer. The open/position state comes from `useNav`;
// the footer actions `dispatch` a modal command on the bus. The note list
// and its verbs are passed as props from App, which owns the notes store.
//
// Note rows support swipe-to-remove: a left swipe latches open a trash
// button (see `useSwipeReveal`), and tapping it deletes straight away. The
// deletion is recorded on the undo timeline (the Undo button at the foot of
// the drawer brings it back), so no confirming second tap is needed.

// notes is open source; the "source" link points at its repository.
const SOURCE_URL = "https://github.com/niclaslindstedt/notes";

// The drawer stays focused on what you're working on: it lists only the most
// recently edited notes and hides the rest behind the "Show all" entry, which
// opens the full overview. Tuned so the list never crowds out the menu below
// it on a phone.
const MAX_RECENT_NOTES = 6;

// The dataTransfer MIME used when dragging a note onto a folder, and the
// sentinel `dropTarget` value for the "ungrouped" drop zone (drop a note here
// to move it out of every folder).
const NOTE_DND_TYPE = "application/x-notes-note-id";
const ROOT_DROP = "__root__";

type Props = {
  /** Notes to list, in display order (most-recently-edited first). */
  notes: Note[];
  /** The note currently open in the editor, if any. */
  activeNoteId: string | null;
  /** Open a note in the editor. */
  onSelectNote: (id: string) => void;
  /** Leave the editor and show the full overview of every note. */
  onShowAll: () => void;
  /** Whether the overview (rather than a note or the archive) is showing. */
  showAllActive: boolean;
  /** Start a fresh note and open it. A `folderId` files it into that folder. */
  onAddNote: (folderId?: string) => void;
  /** Delete a note permanently. */
  onRemoveNote: (id: string) => void;
  /** Archive a note (a right swipe files it into the Archive view). */
  onArchiveNote: (id: string) => void;
  /** How many notes are archived — shown as a count on the Archive entry. */
  archivedCount: number;
  /** Open the archive page (the list of archived notes). */
  onOpenArchive: () => void;
  /** Whether the archive page is the view currently shown. */
  archiveActive: boolean;
  /** Revert the most recent recorded edit. */
  onUndo: () => void;
  /** Re-apply the most recently undone edit. */
  onRedo: () => void;
  /** Whether there is a recorded edit to revert. */
  canUndo: boolean;
  /** Whether there is an undone edit to re-apply. */
  canRedo: boolean;
  /** Folders defined in the active namespace, in stable creation order. */
  folders: Folder[];
  /** Move a note into `folderId`, or out of any folder when `null`. */
  onMoveNote: (id: string, folderId: string | null) => void;
  /** Create a folder; returns its id so the new folder can auto-expand. */
  onCreateFolder: (name: string) => string;
  /** Rename a folder. */
  onRenameFolder: (id: string, name: string) => void;
  /** Delete a folder (its notes fall back to the top level). */
  onRemoveFolder: (id: string) => void;
  /** Namespaces known on this device, default first. */
  namespaces: Namespace[];
  /** The active namespace's slug. */
  activeNamespace: string;
  /** Make a namespace active (and leave the editor). */
  onSwitchNamespace: (slug: string) => void;
  /** Per-note at-rest encryption status, for the green lock on a note row. */
  encStatus?: Map<string, "encrypted" | "pending">;
  /** Ids of notes whose file is being uploaded now, for the sync spinner. */
  uploadingIds?: ReadonlySet<string>;
};

export function SideMenu({
  notes,
  activeNoteId,
  onSelectNote,
  onShowAll,
  showAllActive,
  onAddNote,
  onRemoveNote,
  onArchiveNote,
  archivedCount,
  onOpenArchive,
  archiveActive,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  folders,
  onMoveNote,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  namespaces,
  encStatus,
  uploadingIds,
  activeNamespace,
  onSwitchNamespace,
}: Props) {
  const t = useT();
  const dispatch = useModalDispatch();
  const drawerId = useId();
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");

  // Folder UI state: which folders are expanded, whether the inline "new
  // folder" input is showing, and which folder (if any) is being renamed in
  // place. All view-local — the persisted registry lives in the notes store.
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // Drag-to-file state. `draggingNote` gates the drop targets (so a stray
  // dragover from outside doesn't light them up) and `dropTarget` drives the
  // hover highlight — a folder id, or `ROOT_DROP` for "out of any folder".
  const [draggingNote, setDraggingNote] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startNoteDrag(e: ReactDragEvent, id: string) {
    e.dataTransfer.setData(NOTE_DND_TYPE, id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingNote(id);
  }
  function endNoteDrag() {
    setDraggingNote(null);
    setDropTarget(null);
  }
  function allowDropOn(e: ReactDragEvent, key: string) {
    if (!draggingNote) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== key) setDropTarget(key);
  }
  function dropOn(e: ReactDragEvent, folderId: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DND_TYPE) || draggingNote;
    endNoteDrag();
    if (id) onMoveNote(id, folderId);
  }
  const {
    open,
    toggle,
    close,
    setDragging,
    position,
    setPosition,
    showButton,
    pinned,
  } = useNav();
  const drag = useDraggableMenuButton(position, setPosition);
  // Drag the open drawer back toward its resting edge to close it (the mobile
  // counterpart to the edge swipe that opens it). Pinned never opens this way.
  const swipeClose = useDrawerSwipeClose(position.side, open, close);

  // Mirror the live drag state up so the parent can gate competing global
  // gestures off while the button is being dragged.
  useEffect(() => {
    setDragging(drag.dragging);
  }, [drag.dragging, setDragging]);

  // Build-time env (string | undefined). A blank value disables the donate
  // entry entirely rather than linking nowhere.
  const donateUrl = import.meta.env.VITE_DONATE_URL?.trim();
  // BASE_URL carries the trailing slash, so this is `/privacy`,
  // `/preview/privacy`, … depending on the deploy slot.
  const privacyUrl = `${import.meta.env.BASE_URL}privacy`;

  // Footer actions open a modal, so close the drawer behind them.
  function pick(handler: () => void) {
    close();
    handler();
  }

  // Opening the drawer over the editor leaves the mobile soft keyboard up,
  // where it covers the note list and makes the drawer look empty. Blur the
  // focused field as the drawer opens so the keyboard retracts and the list
  // is visible. (Pinned never opens this way, so this is a no-op there.)
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [open]);

  // Dismiss on Escape while open (the backdrop handles pointer dismissal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onRight = position.side === "right";

  // Notes split into their folder buckets plus the ungrouped remainder. A note
  // whose `folderId` points at a folder the registry no longer has is treated
  // as ungrouped, so a stale link never hides the note.
  const folderIds = new Set(folders.map((f) => f.id));
  const ungrouped = notes.filter(
    (n) => !n.folderId || !folderIds.has(n.folderId),
  );

  // One note row: the swipe/right-click wrapper around a NavItem, made
  // draggable (desktop only) so it can be dropped onto a folder to file it.
  function renderNoteRow(note: Note, indent = false) {
    const row = (
      <NavItem
        icon={
          note.id === activeNoteId ? (
            <CheckIcon className="h-5 w-5" />
          ) : (
            <NoteIcon className="h-5 w-5" />
          )
        }
        label={noteTitle(note)}
        active={note.id === activeNoteId}
        indent={indent}
        trailing={
          // The upload spinner wins over the lock: a note being written isn't
          // settled at rest yet (see the overview card).
          uploadingIds?.has(note.id) ? (
            <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
          ) : encStatus?.get(note.id) === "encrypted" ? (
            <LockIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : undefined
        }
        onClick={() => {
          onSelectNote(note.id);
          close();
        }}
      />
    );
    return (
      <div
        key={note.id}
        draggable={isDesktop}
        onDragStart={isDesktop ? (e) => startNoteDrag(e, note.id) : undefined}
        onDragEnd={isDesktop ? endNoteDrag : undefined}
        className={isDesktop && draggingNote === note.id ? "opacity-40" : ""}
      >
        <SwipeToRemove
          actionLabel={t("nav.deleteNote")}
          archiveLabel={t("nav.archive")}
          onRemove={() => onRemoveNote(note.id)}
          onArchive={() => onArchiveNote(note.id)}
        >
          {row}
        </SwipeToRemove>
      </div>
    );
  }

  // The drawer's body — identical whether it slides in over a backdrop
  // (narrow viewports) or sits docked as a permanent sidebar (pinned). Only
  // the framing `<nav>` differs between the two, so the rows live here once.
  const sections = (
    <>
      {/* Namespaces switcher: tap a row to switch which set of notes is
          shown; the heading's cogwheel opens the full manage dialog (add /
          rename / icon / delete) — a cog, not a "+", because it manages
          rather than adds inline. */}
      <SectionHeader
        label={t("nav.namespaces")}
        onAdd={() => pick(() => dispatch({ kind: "namespaces" }))}
        addLabel={t("nav.manageNamespaces")}
        addIcon={<CogIcon className="h-4 w-4" />}
      />
      {namespaces.map((ns) => {
        // A namespace that picked an icon or colour shows its own glyph,
        // tinted to that colour. One left untouched gets the plain check
        // (active) / folder (inactive) treatment so the active set reads at a
        // glance — the NamespaceGlyph fallback is itself a folder.
        const customised = Boolean(ns.glyph || ns.color);
        const icon = customised ? (
          <NamespaceGlyph
            name={ns.glyph}
            className="h-5 w-5"
            style={ns.color ? { color: ns.color } : undefined}
          />
        ) : ns.slug === activeNamespace ? (
          <CheckIcon className="h-5 w-5" />
        ) : (
          <NamespaceGlyph className="h-5 w-5" />
        );
        return (
          <NavItem
            key={ns.slug}
            icon={icon}
            label={ns.name}
            active={ns.slug === activeNamespace}
            onClick={() => {
              onSwitchNamespace(ns.slug);
              close();
            }}
          />
        );
      })}
      {/* The Notes heading's trailing action is a folder-add (a "+" overlaid
          on a folder), not a plain "+": adding a note now has its own row
          below. Pressing it drops an inline, unnamed folder input into the
          list; defocusing it empty discards it (see FolderEditRow). */}
      <SectionHeader
        label={t("nav.notes")}
        border
        onAdd={() => setCreatingFolder(true)}
        addLabel={t("nav.newFolder")}
        addIcon={<FolderPlusIcon className="h-4 w-4" />}
      />
      {creatingFolder && (
        <FolderEditRow
          placeholder={t("nav.folderName")}
          onCommit={(name) => {
            const id = onCreateFolder(name);
            setCreatingFolder(false);
            setExpandedFolders((prev) => new Set(prev).add(id));
          }}
          onCancel={() => setCreatingFolder(false)}
        />
      )}
      {/* Folders, each expandable to reveal its notes plus a per-folder "New
          note" row, and a drop target for filing a dragged note. */}
      {folders.map((folder) => {
        const folderNotes = notes.filter((n) => n.folderId === folder.id);
        const expanded = expandedFolders.has(folder.id);
        if (renamingFolderId === folder.id) {
          return (
            <FolderEditRow
              key={folder.id}
              initial={folder.name}
              placeholder={t("nav.folderName")}
              onCommit={(name) => {
                onRenameFolder(folder.id, name);
                setRenamingFolderId(null);
              }}
              onCancel={() => setRenamingFolderId(null)}
            />
          );
        }
        return (
          <div key={folder.id}>
            <FolderRow
              name={folder.name}
              count={folderNotes.length}
              expanded={expanded}
              isDropTarget={dropTarget === folder.id}
              renameLabel={t("nav.renameFolder")}
              deleteLabel={t("nav.deleteFolder")}
              onToggle={() => toggleFolder(folder.id)}
              onRename={() => setRenamingFolderId(folder.id)}
              onDelete={() => onRemoveFolder(folder.id)}
              onDragOver={(e) => allowDropOn(e, folder.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => dropOn(e, folder.id)}
            />
            {expanded && (
              <div>
                {folderNotes.map((note) => renderNoteRow(note, true))}
                {folderNotes.length === 0 && (
                  <p className="py-[var(--density-row-py)] pr-5 pl-11 text-sm text-muted">
                    {t("nav.folderEmpty")}
                  </p>
                )}
                <NavItem
                  icon={<PlusIcon className="h-5 w-5" />}
                  label={t("nav.newNote")}
                  active={false}
                  indent
                  onClick={() => {
                    onAddNote(folder.id);
                    close();
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      {/* Ungrouped recent notes. Also the drop zone for moving a note OUT of a
          folder — drop one here and it returns to the top level. */}
      <div
        onDragOver={(e) => allowDropOn(e, ROOT_DROP)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => dropOn(e, null)}
        className={
          dropTarget === ROOT_DROP ? "rounded-sm bg-accent/10" : undefined
        }
      >
        {ungrouped.length === 0 ? (
          folders.length === 0 ? (
            <p className="px-5 py-[var(--density-row-py)] text-sm text-muted">
              {t("nav.notesEmpty")}
            </p>
          ) : null
        ) : (
          ungrouped
            .slice(0, MAX_RECENT_NOTES)
            .map((note) => renderNoteRow(note))
        )}
      </div>
      {/* "New note" — the add control that used to live as a "+" on the Notes
          heading, now its own row just above "Show all". */}
      <NavItem
        icon={<PlusIcon className="h-5 w-5" />}
        label={t("nav.newNote")}
        active={false}
        onClick={() => {
          onAddNote();
          close();
        }}
      />
      {/* "Show all" opens the full overview — and, with the Back button gone
          from the editor, it's how you return there. Active (accent) whenever
          the overview rather than a note or the archive is showing. */}
      <NavItem
        icon={<ListIcon className="h-5 w-5" />}
        label={t("nav.showAll")}
        active={showAllActive}
        onClick={() => {
          onShowAll();
          close();
        }}
      />
      {/* Archive lives at the foot of the notes list — a view onto the
          archived notes, not a section of its own. The count badge mirrors the
          number of archived notes (hidden when the archive is empty). */}
      <NavItem
        icon={<ArchiveIcon className="h-5 w-5" />}
        label={t("nav.archive")}
        active={archiveActive}
        badge={archivedCount > 0 ? archivedCount : undefined}
        onClick={() => {
          onOpenArchive();
          close();
        }}
      />
      {/* Undo / redo: a pair of side-by-side buttons pinned to the foot of
          the list (mt-auto), so they sit just above the footer's divider and
          fall under the thumb. Two columns share one row to save vertical
          space; each keeps the drawer open so a burst of reverts can be
          applied without reopening it. */}
      <div className="mt-auto flex gap-2 px-3 pt-3 pb-1">
        <EditButton
          icon={<UndoIcon className="h-5 w-5" />}
          label={t("nav.undo")}
          disabled={!canUndo}
          onClick={onUndo}
        />
        <EditButton
          icon={<RedoIcon className="h-5 w-5" />}
          label={t("nav.redo")}
          disabled={!canRedo}
          onClick={onRedo}
        />
      </div>
      {/* The old top-right burger menu, pinned to the foot of the drawer
          with its order inverted so it reads bottom-up. */}
      <div className="flex flex-col border-t border-line [padding-top:calc(1.25rem_-_var(--density-row-py))]">
        {donateUrl && (
          <MenuLink
            icon={<HeartIcon className="h-5 w-5 text-danger" />}
            label={t("menu.donate")}
            href={donateUrl}
            external
            onClick={close}
          />
        )}
        <MenuLink
          icon={<CodeIcon className="h-5 w-5" />}
          label={t("menu.source")}
          href={SOURCE_URL}
          external
          sublabel={BUILD_LABEL}
          onClick={close}
        />
        <MenuLink
          icon={<ShieldIcon className="h-5 w-5" />}
          label={t("menu.privacy")}
          href={privacyUrl}
          onClick={close}
        />
        <AchievementsMenuItem onClose={close} />
        <MenuButton
          icon={<SparklesIcon className="h-5 w-5" />}
          label={t("menu.changelog")}
          onClick={() => pick(() => dispatch({ kind: "changelog" }))}
        />
        <MenuButton
          icon={<CogIcon className="h-5 w-5" />}
          label={t("menu.settings")}
          onClick={() => pick(() => dispatch({ kind: "settings" }))}
        />
      </div>
    </>
  );

  // Pinned: a permanent docked sidebar beside the content. No floating
  // button, no backdrop, no open/close — it's simply always there. App lays
  // it out as a flex sibling of the main view, so a fixed width and a single
  // inner border (on whichever edge faces the content) is all the framing it
  // needs. It docks on the same side the floating button rests on.
  if (pinned) {
    return (
      <nav
        aria-label={t("nav.label")}
        className={`relative flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-surface [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
          onRight ? "order-last border-l border-line" : "border-r border-line"
        }`}
      >
        {sections}
      </nav>
    );
  }

  return (
    <>
      {/* Floating toggle the user can drag to either edge; a plain press
          still toggles the drawer (the drag hook swallows the click that
          tails a real drag, and leaves keyboard activation untouched). */}
      {showButton && (
        <button
          type="button"
          onClick={() => {
            if (drag.consumeDragClick()) return;
            toggle();
          }}
          {...drag.handlers}
          style={drag.style}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? drawerId : undefined}
          aria-label={open ? t("nav.close") : t("nav.open")}
          className={`fixed z-40 flex h-11 w-11 touch-none items-center justify-center rounded-full border border-line bg-surface text-muted shadow-lg select-none hover:text-fg-bright ${
            drag.dragging
              ? "cursor-grabbing transition-none"
              : "cursor-grab transition-[left,top] duration-300 ease-out"
          }`}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div
          className={`fixed z-50 flex ${onRight ? "justify-end" : ""}`}
          style={APP_VIEWPORT_RECT}
          {...swipeClose.handlers}
        >
          <button
            type="button"
            aria-label={t("nav.close")}
            tabIndex={-1}
            onClick={close}
            style={{ opacity: swipeClose.progress }}
            className={`drawer-backdrop absolute inset-0 cursor-default bg-black/50 [touch-action:none] ${
              swipeClose.animating ? "transition-opacity duration-200" : ""
            }`}
          />
          <nav
            id={drawerId}
            ref={swipeClose.panelRef}
            aria-label={t("nav.label")}
            style={{ transform: `translateX(${swipeClose.offset}px)` }}
            className={`relative flex w-64 max-w-[80%] flex-col overflow-y-auto bg-surface shadow-xl [touch-action:pan-y] [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
              swipeClose.animating ? "transition-transform duration-200" : ""
            } ${
              onRight
                ? "drawer-panel-right border-l border-line"
                : "drawer-panel-left border-r border-line"
            }`}
          >
            {sections}
          </nav>
        </div>
      )}
    </>
  );
}

// A section label with an optional trailing action pinned to its trailing
// edge. For Notes the action is a "+" that starts a new note; for Namespaces
// it's a cogwheel that opens the manage dialog (passed via `addIcon`). The
// first section omits the top border; every later one draws one to separate
// it from the rows above.
function SectionHeader({
  label,
  border = false,
  onAdd,
  addLabel,
  addIcon = <PlusIcon className="h-4 w-4" />,
}: {
  label: string;
  border?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  addIcon?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-5 pt-3 pb-1 ${
        border ? "border-t border-line" : ""
      }`}
    >
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
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

// A folder header row: tap the label to expand/collapse, with rename and
// delete affordances pinned to the trailing edge. The whole row is a drop
// target — dragging a note onto it files the note into the folder (the
// highlight follows `isDropTarget`). Deleting a folder is undoable and only
// ungroups its notes, so — like a note delete — it needs no confirm beat.
function FolderRow({
  name,
  count,
  expanded,
  isDropTarget,
  renameLabel,
  deleteLabel,
  onToggle,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  name: string;
  count: number;
  expanded: boolean;
  isDropTarget: boolean;
  renameLabel: string;
  deleteLabel: string;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex items-center text-sm ${
        isDropTarget
          ? "bg-accent/15 ring-1 ring-accent/40 ring-inset"
          : "hover:bg-surface-2"
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[var(--density-row-py)] pl-3 text-left text-fg hover:text-fg-bright"
      >
        <span className="text-muted">
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </span>
        <span className={expanded ? "text-accent" : "text-muted"}>
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
        onClick={onRename}
        aria-label={renameLabel}
        title={renameLabel}
        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted opacity-60 hover:bg-surface-3 hover:text-fg-bright hover:opacity-100"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        title={deleteLabel}
        className="mr-2 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted opacity-60 hover:bg-surface-3 hover:text-danger hover:opacity-100"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

// The inline folder name editor, used both for creating a folder (empty) and
// renaming one (seeded with its name). Committing on Enter or blur with a
// non-empty trimmed name; an empty name (or Escape) cancels — which is what
// makes a freshly-added, never-named folder simply vanish on defocus. The
// `committed` latch stops the blur that follows an Enter from firing twice.
function FolderEditRow({
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

function NavItem({
  icon,
  label,
  active,
  disabled = false,
  indent = false,
  badge,
  trailing,
  onClick,
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
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 py-[var(--density-row-py)] text-left text-sm ${
        indent ? "pr-5 pl-11" : "px-5"
      } ${
        disabled
          ? "cursor-not-allowed text-muted opacity-40"
          : active
            ? "cursor-pointer bg-surface-2 font-semibold text-fg-bright"
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

// Undo / redo render as a side-by-side pair rather than full-width rows so
// the two fit on one line at the foot of the drawer. Each is a self-contained
// bordered button (icon + label, centred) that dims and goes inert at the
// ends of the timeline, where there is nothing to revert or re-apply.
function EditButton({
  icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-md border border-line py-2.5 text-sm ${
        disabled
          ? "cursor-not-allowed text-muted opacity-40"
          : "cursor-pointer text-fg hover:bg-surface-2 hover:text-fg-bright"
      }`}
    >
      <span className={disabled ? "" : "text-muted"}>{icon}</span>
      <span>{label}</span>
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
const REMOVE_ACTION_W = 96;

function SwipeToRemove({
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

// Footer rows reuse the NavItem geometry (px-5, the density vertical
// padding, gap-3, h-5 icons) so the relocated burger menu reads as one
// continuous list with the rows above it. A plain button for in-app
// actions, an anchor for the links.
function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function MenuLink({
  icon,
  label,
  href,
  external,
  sublabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  href: string;
  external?: boolean;
  /** Secondary line beneath the label (e.g. the app version). */
  sublabel?: string;
  onClick?: () => void;
}) {
  return (
    <a
      role="menuitem"
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span>{label}</span>
        {sublabel && (
          <span className="text-xs text-muted tabular-nums">{sublabel}</span>
        )}
      </span>
    </a>
  );
}
