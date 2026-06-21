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
import { useAppearance } from "../theme/useTheme.ts";
import type { NoteSortKey } from "../theme/themes.ts";
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
import { NoteDragItem } from "./note-drag.tsx";
import {
  NOTE_DROP_ARCHIVE,
  NOTE_DROP_ATTR,
  NOTE_DROP_ROOT,
  noteDropNamespaceKey,
  useNoteDropKey,
} from "./note-drag-context.ts";
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
// in the editor). Notes can be grouped into folders: the action bar's New
// folder button creates one inline, and each folder row expands to reveal its
// notes. A "+" pinned to the far right of a folder row starts a new note filed
// into that folder. A note can be dragged onto a folder (or onto the ungrouped
// zone to leave one) to file it.
//
// Two side-menu layout preferences ride on the appearance store: folders can
// be pinned above the loose notes (`folderPlacement: "top"`) or interleaved
// with them in sort order (`"mixed"`), and the list sorts by last-modified or
// by name (`noteSortKey`). New note, New folder, Show all, and Archive share
// one compact four-up button row (saving vertical space) just below the note
// list.
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

// The dataTransfer MIME used when dragging a note onto a folder with the
// desktop HTML5 path. The touch path and the ungrouped-zone sentinel
// (`NOTE_DROP_ROOT`) are shared from `note-drag.tsx`.
const NOTE_DND_TYPE = "application/x-notes-note-id";

// Sort notes for the drawer by the active key: most-recently-edited first, or
// alphabetically by title (case-insensitive). Never mutates the input.
function sortNotesBy(notes: readonly Note[], key: NoteSortKey): Note[] {
  if (key === "name") {
    return [...notes].sort((a, b) =>
      noteTitle(a).localeCompare(noteTitle(b), undefined, {
        sensitivity: "base",
      }),
    );
  }
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

// A folder's effective "modified" time: the newest `updatedAt` among the notes
// filed in it, falling back to its own creation time when it's empty. Lets a
// folder sort by recency against loose notes under `mixed` placement.
function folderModifiedAt(folder: Folder, notes: readonly Note[]): number {
  let max = folder.createdAt;
  for (const n of notes) {
    if (n.folderId === folder.id && n.updatedAt > max) max = n.updatedAt;
  }
  return max;
}

// Folders ordered by the active key — alphabetically by name, or by their
// most-recently-edited note. Never mutates the input.
function sortFoldersBy(
  folders: readonly Folder[],
  notes: readonly Note[],
  key: NoteSortKey,
): Folder[] {
  if (key === "name") {
    return [...folders].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }
  return [...folders].sort(
    (a, b) => folderModifiedAt(b, notes) - folderModifiedAt(a, notes),
  );
}

// `mixed` placement: one interleaved run of folders and loose notes, sorted by
// the active key so a folder sits among the notes by its name or its newest
// note. `allNotes` is the full note set (used for a folder's modified time);
// `folders` and `loose` are the already-filtered, display-ordered inputs.
type TopLevelItem =
  | { kind: "folder"; folder: Folder }
  | { kind: "note"; note: Note };

function mixTopLevel(
  folders: readonly Folder[],
  loose: readonly Note[],
  allNotes: readonly Note[],
  key: NoteSortKey,
): TopLevelItem[] {
  const items: TopLevelItem[] = [
    ...folders.map((folder) => ({ kind: "folder" as const, folder })),
    ...loose.map((note) => ({ kind: "note" as const, note })),
  ];
  items.sort((a, b) => {
    if (key === "name") {
      const an = a.kind === "folder" ? a.folder.name : noteTitle(a.note);
      const bn = b.kind === "folder" ? b.folder.name : noteTitle(b.note);
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    }
    const am =
      a.kind === "folder"
        ? folderModifiedAt(a.folder, allNotes)
        : a.note.updatedAt;
    const bm =
      b.kind === "folder"
        ? folderModifiedAt(b.folder, allNotes)
        : b.note.updatedAt;
    return bm - am;
  });
  return items;
}

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
  /** Move a note into another namespace (drop onto its row). */
  onMoveNoteToNamespace: (id: string, slug: string) => void;
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
  onMoveNoteToNamespace,
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

  // Side-menu layout preferences (synced via the appearance store): whether
  // folders pin above the loose notes or sort in among them, and the sort key
  // applied to both notes and (under `mixed`) folders.
  const { folderPlacement, noteSortKey } = useAppearance();

  // Folder UI state: which folders are expanded, whether the inline "new
  // folder" input is showing, and which folder (if any) is being renamed in
  // place. All view-local — the persisted registry lives in the notes store.
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // Desktop HTML5 drag-to-file state. `draggingNote` gates the drop targets (so
  // a stray dragover from outside doesn't light them up) and `dropTarget`
  // drives the hover highlight — a folder id, or `NOTE_DROP_ROOT` for "out of
  // any folder". The touch long-press path reports its target via
  // `activeDropKey`.
  const [draggingNote, setDraggingNote] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const activeDropKey = useNoteDropKey();

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
    // Folders now nest inside the ungrouped root drop zone, so stop the
    // hover from bubbling up and lighting the root highlight at the same time.
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== key) setDropTarget(key);
  }
  function dropOn(e: ReactDragEvent, folderId: string | null) {
    e.preventDefault();
    // A drop on a folder must not also bubble to the root zone (which would
    // immediately move the note back out to the top level).
    e.stopPropagation();
    const id = e.dataTransfer.getData(NOTE_DND_TYPE) || draggingNote;
    endNoteDrag();
    if (id) onMoveNote(id, folderId);
  }
  function dropOnNamespace(e: ReactDragEvent, slug: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DND_TYPE) || draggingNote;
    endNoteDrag();
    if (id) onMoveNoteToNamespace(id, slug);
  }
  function dropOnArchive(e: ReactDragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_DND_TYPE) || draggingNote;
    endNoteDrag();
    if (id) onArchiveNote(id);
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

  // The loose notes the drawer actually shows, sorted by the active key and
  // capped so the list never crowds out the menu below. Folders are sorted by
  // the same key — by name, or by their most-recently-edited note (`mixed`
  // placement interleaves the two runs; `top` keeps folders above the notes).
  const recentUngrouped = sortNotesBy(ungrouped, noteSortKey).slice(
    0,
    MAX_RECENT_NOTES,
  );
  const sortedFolders = sortFoldersBy(folders, notes, noteSortKey);

  // One note row: the swipe/right-click wrapper around a NavItem, made
  // draggable so it can be dropped onto a folder to file it — HTML5 drag on
  // desktop, a press-and-hold gesture on touch (see `note-drag.tsx`).
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
      <NoteDragItem
        key={note.id}
        noteId={note.id}
        title={noteTitle(note)}
        enabled={!isDesktop}
        draggable={isDesktop}
        dragging={draggingNote === note.id}
        onDragStart={isDesktop ? (e) => startNoteDrag(e, note.id) : undefined}
        onDragEnd={isDesktop ? endNoteDrag : undefined}
      >
        <SwipeToRemove
          actionLabel={t("nav.deleteNote")}
          archiveLabel={t("nav.archive")}
          onRemove={() => onRemoveNote(note.id)}
          onArchive={() => onArchiveNote(note.id)}
        >
          {row}
        </SwipeToRemove>
      </NoteDragItem>
    );
  }

  // One folder: its header row (a drop target for filing a dragged note) plus,
  // when expanded, the notes filed inside it — sorted by the active key. The
  // header carries a far-right "+" that starts a new note inside the folder.
  function renderFolder(folder: Folder) {
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
    const folderNotes = sortNotesBy(
      notes.filter((n) => n.folderId === folder.id),
      noteSortKey,
    );
    const expanded = expandedFolders.has(folder.id);
    return (
      <div key={folder.id} {...{ [NOTE_DROP_ATTR]: folder.id }}>
        <FolderRow
          name={folder.name}
          count={folderNotes.length}
          expanded={expanded}
          isDropTarget={dropTarget === folder.id || activeDropKey === folder.id}
          renameLabel={t("nav.renameFolder")}
          deleteLabel={t("nav.deleteFolder")}
          addNoteLabel={t("nav.newNote")}
          onToggle={() => toggleFolder(folder.id)}
          onRename={() => setRenamingFolderId(folder.id)}
          onDelete={() => onRemoveFolder(folder.id)}
          onAddNote={() => {
            onAddNote(folder.id);
            close();
          }}
          onDragOver={(e) => allowDropOn(e, folder.id)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => dropOn(e, folder.id)}
        />
        {expanded && (
          <div>{folderNotes.map((note) => renderNoteRow(note, true))}</div>
        )}
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
        // Every namespace but the active one is a drop target: dropping a note
        // onto it moves the note into that namespace.
        const droppable = ns.slug !== activeNamespace;
        const nsKey = noteDropNamespaceKey(ns.slug);
        return (
          <NavItem
            key={ns.slug}
            icon={icon}
            label={ns.name}
            active={ns.slug === activeNamespace}
            dropId={droppable ? nsKey : undefined}
            isDropTarget={
              droppable && (dropTarget === nsKey || activeDropKey === nsKey)
            }
            onDragOver={droppable ? (e) => allowDropOn(e, nsKey) : undefined}
            onDragLeave={droppable ? () => setDropTarget(null) : undefined}
            onDrop={droppable ? (e) => dropOnNamespace(e, ns.slug) : undefined}
            onClick={() => {
              onSwitchNamespace(ns.slug);
              close();
            }}
          />
        );
      })}
      {/* Both add actions — New note and New folder — live on the action bar
          below the list, so the heading carries no trailing "+". A new folder
          drops an inline, unnamed folder input into the list; defocusing it
          empty discards it (see FolderEditRow). */}
      <SectionHeader label={t("nav.notes")} border />
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
      {/* The top-level list: folders (each expandable, a "+" on its far right
          starts a note inside it) and the loose recent notes, ordered by the
          active sort key. Under `top` placement the folders stay pinned above
          the notes; under `mixed` the two runs interleave in sort order. The
          whole region is the root drop zone — dropping a note here (outside any
          folder) returns it to the top level. */}
      <div
        {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ROOT }}
        onDragOver={(e) => allowDropOn(e, NOTE_DROP_ROOT)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => dropOn(e, null)}
        className={
          dropTarget === NOTE_DROP_ROOT || activeDropKey === NOTE_DROP_ROOT
            ? "rounded-sm bg-accent/10"
            : undefined
        }
      >
        {sortedFolders.length === 0 && recentUngrouped.length === 0 ? (
          <p className="px-5 py-[var(--density-row-py)] text-sm text-muted">
            {t("nav.notesEmpty")}
          </p>
        ) : folderPlacement === "mixed" ? (
          mixTopLevel(sortedFolders, recentUngrouped, notes, noteSortKey).map(
            (item) =>
              item.kind === "folder"
                ? renderFolder(item.folder)
                : renderNoteRow(item.note),
          )
        ) : (
          <>
            {sortedFolders.map(renderFolder)}
            {recentUngrouped.map((note) => renderNoteRow(note))}
          </>
        )}
      </div>
      {/* New note / New folder / Show all / Archive share one compact button
          row to save vertical space (the way Undo / Redo do at the foot). The
          four cells split the width evenly so the bar reads symmetric. Show all
          and Archive light up (accent) when their view is showing; Archive
          carries the archived-note count and accepts a dragged note as a drop
          target. New folder drops the inline name input into the list above. */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex divide-x divide-line overflow-hidden rounded-md border border-line">
          <BarButton
            icon={<PlusIcon className="h-5 w-5" />}
            label={t("nav.newNote")}
            onClick={() => {
              onAddNote();
              close();
            }}
          />
          <BarButton
            icon={<FolderIcon className="h-5 w-5" />}
            label={t("nav.newFolder")}
            onClick={() => setCreatingFolder(true)}
          />
          <BarButton
            icon={<ListIcon className="h-5 w-5" />}
            label={t("nav.showAll")}
            active={showAllActive}
            onClick={() => {
              onShowAll();
              close();
            }}
          />
          <BarButton
            icon={<ArchiveIcon className="h-5 w-5" />}
            label={t("nav.archive")}
            active={archiveActive}
            badge={archivedCount > 0 ? archivedCount : undefined}
            dropId={NOTE_DROP_ARCHIVE}
            isDropTarget={
              dropTarget === NOTE_DROP_ARCHIVE ||
              activeDropKey === NOTE_DROP_ARCHIVE
            }
            onDragOver={(e) => allowDropOn(e, NOTE_DROP_ARCHIVE)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={dropOnArchive}
            onClick={() => {
              onOpenArchive();
              close();
            }}
          />
        </div>
      </div>
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
        className={`relative flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-surface select-none [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
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
            className={`relative flex w-64 max-w-[80%] flex-col overflow-y-auto bg-surface shadow-xl select-none [touch-action:pan-y] [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
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
// A folder header row: tap the label to expand/collapse. Its edit and delete
// actions stay hidden until summoned, the way a note's do — a left swipe
// latches open an [edit | delete] strip (sharing the width of a note's single
// delete button, split in two) on touch, and a right-click opens the same two
// actions on a computer. The whole row is a drop target — dropping a note onto
// it files the note into the folder (the highlight follows `isDropTarget`).
// Deleting a folder is undoable and only ungroups its notes, so — like a note
// delete — it needs no confirm beat.
function FolderRow({
  name,
  count,
  expanded,
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

// New note / New folder / Show all / Archive render as a compact four-up
// segmented bar instead of full-width rows, saving vertical space the way
// Undo / Redo do. The cells sit flush against one another (the parent owns the
// border, rounding, and inner `divide-x` dividers) and split the width evenly
// so the bar reads symmetric. The buttons are icon-only (the label rides on
// `aria-label` / `title`); the active view tints accent, and the Archive button
// doubles as a drop target with its count as a corner badge.
function BarButton({
  icon,
  label,
  active = false,
  badge,
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
      onClick={onClick}
      {...(dropId !== undefined ? { [NOTE_DROP_ATTR]: dropId } : {})}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex flex-1 cursor-pointer items-center justify-center py-2.5 ${
        isDropTarget
          ? "bg-accent/15 text-fg-bright"
          : active
            ? "bg-surface-2 text-fg-bright"
            : "text-fg hover:bg-surface-2 hover:text-fg-bright"
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
