import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { unlock } from "../achievements/index.ts";
import {
  favoriteNotes,
  groupFavoritesByFolder,
  mixTopLevel,
  noteTitle,
  sortFoldersBy,
  sortNotesBy,
  type Folder,
  type Note,
} from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import type { Namespace } from "../storage/namespaces.ts";
import { useAppearance } from "../theme/useTheme.ts";
import { APP_VIEWPORT_RECT } from "./appViewportRect.ts";
import {
  SIDEBAR_PANEL_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  useNav,
} from "./nav-context.ts";
import { useDraggableMenuButton } from "./hooks/useDraggableMenuButton.ts";
import { useDrawerSwipeClose } from "./hooks/useDrawerSwipeClose.ts";
import { useEdgeHover } from "./hooks/useEdgeHover.ts";
import { useDesktopPointer, useMediaQuery } from "./hooks/useMediaQuery.ts";
import {
  CogIcon,
  EyeIcon,
  LockIcon,
  MenuIcon,
  NoteIcon,
  SpinnerIcon,
} from "./icons.tsx";
import { useModalDispatch } from "./modal-bus.ts";
import { NoteDragItem } from "./note-drag.tsx";
import {
  NOTE_DROP_ARCHIVE,
  NOTE_DROP_ATTR,
  NOTE_DROP_ROOT,
  noteDropNamespaceKey,
  useNoteDragAbort,
  useNoteDragKind,
  useNoteDropKey,
} from "./note-drag-context.ts";
import { NamespaceGlyph } from "./NamespaceGlyph.tsx";
import { SideMenuActionBar } from "./SideMenuActionBar.tsx";
import { SideMenuFooter } from "./SideMenuFooter.tsx";
import {
  FolderEditRow,
  FolderLabelRow,
  FolderRow,
  FooterCollapseRail,
  NavItem,
  SectionHeader,
  SidebarCollapseRail,
  SwipeToRemove,
} from "./SideMenuRows.tsx";

// The navigation drawer. On viewports narrower than the smallest iPad it
// collapses to a single floating button the user can drag to either side
// edge (its resting spot persists); pressing it slides the drawer in from
// that same side over a dimmed backdrop. From the smallest iPad up
// (`nav.pinned`) the same panel is instead docked open as a permanent
// sidebar beside the content — no button, no backdrop, no open/close — so
// wider screens always see the navigation, unless they fold it away to the
// thin collapse rail on its inner edge (`nav.sidebarCollapsed`). Both variants
// render the identical section list (`sections` below); only the framing
// differs.
//
// The drawer lists every note by its title (the switcher — tap to open it
// in the editor). Notes can be grouped into folders: the action bar's New
// folder button creates one inline, and each folder row expands to reveal its
// notes. A "+" pinned to the far right of a folder row starts a new note filed
// into that folder. A note can be dragged onto a folder (or onto the ungrouped
// zone to leave one) to file it.
//
// Above the note list sits **Favorites** — the notes starred from the editor
// header's star button, listed flat so a favorite is one tap away regardless of
// where it is filed. The `favoritesShowFolders` appearance setting reproduces
// the folder structure there instead; the section hides itself entirely while
// nothing is starred.
//
// Two side-menu layout preferences ride on the appearance store: folders can
// be pinned above the loose notes (`folderPlacement: "top"`) or interleaved
// with them in sort order (`"mixed"`), and the list sorts by last-modified or
// by name (`noteSortKey`). New note, New folder, Show all, Archive and
// Undo / Redo share one bordered "button island" (saving vertical space) just
// below the note list — a top row of create/navigate actions and a bottom row
// of history actions, split by a divider so the six icon buttons read as one
// block.
// Pinned to the bottom is what was the top-right burger menu — an optional
// donate, the trophy (achievements), an "About" dropdown that folds away the
// project links (What's new, source with the app version as a subtitle,
// privacy), and settings pinned last — so the whole of it sits flush at the
// foot of the drawer. The open/position state comes from `useNav`;
// the footer actions `dispatch` a modal command on the bus. The note list
// and its verbs are passed as props from App, which owns the notes store.
//
// Note rows support swipe-to-remove: a left swipe latches open a trash
// button (see `useSwipeReveal`), and tapping it deletes straight away. The
// deletion is recorded on the undo timeline (the Undo button at the foot of
// the drawer brings it back), so no confirming second tap is needed.

// The dataTransfer MIME used when dragging a note onto a folder with the
// desktop HTML5 path. The touch path and the ungrouped-zone sentinel
// (`NOTE_DROP_ROOT`) are shared from `note-drag.tsx`.
const NOTE_DND_TYPE = "application/x-notes-note-id";
// The sibling MIME for dragging a whole folder (onto a namespace row, to move
// it with all its notes). A distinct type so a namespace drop can tell a folder
// drag from a note drag.
const FOLDER_DND_TYPE = "application/x-notes-folder-id";

// The footer-collapse choice persists across reloads under this key. Read once
// on mount; every toggle mirrors the boolean back as a string.
const FOOTER_COLLAPSED_KEY = "notes/footer-collapsed";
function readFooterCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(FOOTER_COLLAPSED_KEY) === "true";
}

type Props = {
  /** Notes to list, in display order (most-recently-edited first). */
  notes: Note[];
  /**
   * The active namespace's first load is still in flight with nothing seeded
   * yet — so the list shows a "loading" hint rather than the empty-state text.
   */
  loading?: boolean;
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
  /** Copy a note's link — desktop right-click menu only. */
  onCopyNoteLink?: (id: string) => void;
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
  /** The cloud sync glyph, shown as the last cell of the button island. Null on
   *  the local backend, which has no remote to sync against. */
  syncSlot?: ReactNode;
  /** Folders defined in the active namespace, in stable creation order. */
  folders: Folder[];
  /** Move a note into `folderId`, or out of any folder when `null`. */
  onMoveNote: (id: string, folderId: string | null) => void;
  /** Move a note into another namespace (drop onto its row). */
  onMoveNoteToNamespace: (id: string, slug: string) => void;
  /** Move a folder — with every note in it — into another namespace (drop onto its row). */
  onMoveFolderToNamespace: (folderId: string, slug: string) => void;
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
  loading = false,
  activeNoteId,
  onSelectNote,
  onShowAll,
  showAllActive,
  onAddNote,
  onRemoveNote,
  onArchiveNote,
  onCopyNoteLink,
  archivedCount,
  onOpenArchive,
  archiveActive,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  syncSlot,
  folders,
  onMoveNote,
  onMoveNoteToNamespace,
  onMoveFolderToNamespace,
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
  const { folderPlacement, noteSortKey, favoritesShowFolders } =
    useAppearance();

  // Folder UI state: which folders are expanded, whether the inline "new
  // folder" input is showing, and which folder (if any) is being renamed in
  // place. All view-local — the persisted registry lives in the notes store.
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // Whether the Namespaces section is collapsed. Defaults to collapsed so the
  // drawer leads with the notes; the active namespace still shows while
  // collapsed (so you always see where you are), and tapping the heading
  // expands the full switcher. View-local, like the folder expand state.
  const [namespacesCollapsed, setNamespacesCollapsed] = useState(true);

  // Whether the footer (Donate / trophy / About / Settings) is folded away
  // behind the collapse rail. Unlike the view-local state above, this choice is
  // remembered across reloads, so it reads its initial value from localStorage
  // and mirrors every toggle back. Offered on every viewport — the phone drawer
  // gets the same control as the docked sidebar.
  const [footerCollapsed, setFooterCollapsed] = useState(readFooterCollapsed);
  const toggleFooter = () =>
    setFooterCollapsed((v) => {
      const next = !v;
      // Folding the footer away to buy the note list more room is "Space saver".
      if (next) unlock("spaceSaver");
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(FOOTER_COLLAPSED_KEY, String(next));
        } catch {
          // Ignore storage failures (private mode / quota) — the in-memory
          // state still drives the UI for this session.
        }
      }
      return next;
    });

  // Desktop HTML5 drag state. `dragItem` gates the drop targets (so a stray
  // dragover from outside doesn't light them up) and records what's being
  // dragged — a single note, or a whole folder (which only a namespace row
  // accepts). `dropTarget` drives the hover highlight. The touch long-press
  // path reports its target via `activeDropKey` and its kind via `touchDragKind`.
  const [dragItem, setDragItem] = useState<{
    kind: "note" | "folder";
    id: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const activeDropKey = useNoteDropKey();
  const touchDragKind = useNoteDragKind();
  const dragAbort = useNoteDragAbort();
  // Whether a notes-only target (a folder, the ungrouped root, the Archive row)
  // should paint its highlight: it must not while a *folder* is being dragged,
  // since a folder only drops onto a namespace. Desktop already gates that in
  // `allowDropOn`; this also covers the touch path's `activeDropKey`.
  const noteDropActive = (key: string): boolean =>
    dropTarget === key || (activeDropKey === key && touchDragKind !== "folder");

  // Clear the desktop drag's lift if the app aborts mid-drag (a sync conflict,
  // a background reload) — the row may unmount before `dragend` fires, which
  // would otherwise leave it stranded dimmed. See the overview's note on
  // `DragAbortContext`. Idle on mount and whenever nothing is lifted.
  useEffect(() => {
    setDragItem(null);
    setDropTarget(null);
  }, [dragAbort]);

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // `dataTransfer` is optional throughout: the DOM types it nullable (it is
  // only ever absent on a synthetic `DragEvent` built without one, which is
  // exactly what the tests construct), where React's synthetic event declared
  // it always present. The live `dragItem` below is the authoritative source
  // anyway — the MIME payload only exists so a drag can cross into another
  // window — so an absent transfer degrades to it rather than dropping the
  // gesture.
  function startNoteDrag(e: ReactDragEvent<HTMLElement>, id: string) {
    e.dataTransfer?.setData(NOTE_DND_TYPE, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    setDragItem({ kind: "note", id });
  }
  function startFolderDrag(e: ReactDragEvent<HTMLElement>, id: string) {
    e.dataTransfer?.setData(FOLDER_DND_TYPE, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    setDragItem({ kind: "folder", id });
  }
  function endDrag() {
    setDragItem(null);
    setDropTarget(null);
  }
  // `acceptFolder` marks the rare target (a namespace row) that also takes a
  // dragged folder; every other target accepts notes only, so a folder drag
  // over it is left inert.
  function allowDropOn(
    e: ReactDragEvent<HTMLElement>,
    key: string,
    acceptFolder = false,
  ) {
    if (!dragItem) return;
    if (dragItem.kind === "folder" && !acceptFolder) return;
    e.preventDefault();
    // Folders now nest inside the ungrouped root drop zone, so stop the
    // hover from bubbling up and lighting the root highlight at the same time.
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (dropTarget !== key) setDropTarget(key);
  }
  function dropOn(e: ReactDragEvent<HTMLElement>, folderId: string | null) {
    e.preventDefault();
    // A drop on a folder must not also bubble to the root zone (which would
    // immediately move the note back out to the top level).
    e.stopPropagation();
    const id =
      e.dataTransfer?.getData(NOTE_DND_TYPE) ||
      (dragItem?.kind === "note" ? dragItem.id : "");
    endDrag();
    if (id) onMoveNote(id, folderId);
  }
  function dropOnNamespace(e: ReactDragEvent<HTMLElement>, slug: string) {
    e.preventDefault();
    // A namespace row accepts either a note or a whole folder; the dataTransfer
    // MIME (or the live drag item) says which.
    const folderId =
      e.dataTransfer?.getData(FOLDER_DND_TYPE) ||
      (dragItem?.kind === "folder" ? dragItem.id : "");
    const noteId =
      e.dataTransfer?.getData(NOTE_DND_TYPE) ||
      (dragItem?.kind === "note" ? dragItem.id : "");
    endDrag();
    if (folderId) onMoveFolderToNamespace(folderId, slug);
    else if (noteId) onMoveNoteToNamespace(noteId, slug);
  }
  function dropOnArchive(e: ReactDragEvent<HTMLElement>) {
    e.preventDefault();
    const id =
      e.dataTransfer?.getData(NOTE_DND_TYPE) ||
      (dragItem?.kind === "note" ? dragItem.id : "");
    endDrag();
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
    sidebarCollapsed,
    toggleSidebar,
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

  // Sliding the drawer open should show you where you are. A note filed in a
  // folder sits behind that folder's collapsed header, so the active row — the
  // one thing the drawer is meant to orient you by — isn't on screen at all.
  // Spring its folder open as the drawer appears (and, on the docked sidebar
  // that is always open, as the active note changes).
  //
  // Keyed on the *folder*, not on the expanded set, so collapsing it by hand
  // afterwards sticks: this only runs again when the drawer reopens or the
  // active note moves to a different folder.
  const activeFolderId = activeNoteId
    ? (notes.find((n) => n.id === activeNoteId)?.folderId ?? null)
    : null;
  // A note pointing at a folder the registry no longer has renders ungrouped
  // (see the split below), so there is nothing to reveal for it either.
  const revealFolderId =
    activeFolderId && folders.some((f) => f.id === activeFolderId)
      ? activeFolderId
      : null;
  // The rows are only on screen when the drawer is open or the docked sidebar
  // is showing — a sidebar folded away to its rail renders none of them.
  const drawerShowing = open || (pinned && !sidebarCollapsed);
  useEffect(() => {
    if (!drawerShowing || !revealFolderId) return;
    setExpandedFolders((prev) =>
      prev.has(revealFolderId) ? prev : new Set(prev).add(revealFolderId),
    );
  }, [drawerShowing, revealFolderId]);

  const onRight = position.side === "right";

  // The docked sidebar's collapse rail gives its pixels back to the app and
  // only materialises when the pointer comes to that edge looking for it. A
  // click-through element can never match `:hover`, so the cursor is tracked
  // against the rail's own box instead. A device that can't hover would never
  // see it at all — and, once collapsed, would have no way back — so there the
  // rail simply stays up.
  const railRef = useRef<HTMLButtonElement>(null);
  const hoverCapable = useDesktopPointer();
  const railHovered = useEdgeHover(railRef, hoverCapable);
  const railRevealed = !hoverCapable || railHovered;

  // A folder can only be dragged somewhere meaningful — onto another namespace
  // row — so the drag affordance is only wired when a second namespace exists.
  const canMoveFolderToNamespace = namespaces.length > 1;

  // Notes split into their folder buckets plus the ungrouped remainder. A note
  // whose `folderId` points at a folder the registry no longer has is treated
  // as ungrouped, so a stale link never hides the note.
  const folderIds = new Set(folders.map((f) => f.id));
  const ungrouped = notes.filter(
    (n) => !n.folderId || !folderIds.has(n.folderId),
  );

  // Every loose note, ordered by the active key — the drawer lists them all and
  // scrolls when they overflow (see the scroll area in `sections`), rather than
  // showing a window of the newest few. Folders are sorted by the same key — by
  // name, or by their most-recently-edited note (`mixed` placement interleaves
  // the two runs; `top` keeps folders above the notes).
  const looseNotes = sortNotesBy(ungrouped, noteSortKey);
  const sortedFolders = sortFoldersBy(folders, notes, noteSortKey);

  // The Favorites section's contents. Uncapped, unlike the recents list below
  // it: these are the notes the user picked out by hand, so trimming the tail
  // would defeat the point. Flat by default — a favorite is a shortcut, so
  // where it is filed is exactly what the section sets aside — with the folder
  // structure reproduced when `favoritesShowFolders` is on.
  const favorites = favoriteNotes(notes);
  const favoriteGroups = favoritesShowFolders
    ? groupFavoritesByFolder(favorites, folders, noteSortKey)
    : [];
  const flatFavorites = favoritesShowFolders
    ? []
    : sortNotesBy(favorites, noteSortKey);

  // One note row: the swipe/right-click wrapper around a NavItem, made
  // draggable so it can be dropped onto a folder to file it — HTML5 drag on
  // desktop, a press-and-hold gesture on touch (see `note-drag.tsx`).
  function renderNoteRow(note: Note, indent = false) {
    const row = (
      <NavItem
        icon={
          // A locked note wears the editor header's eye in place of the
          // document glyph, so "you may look, not touch" is legible from the
          // list rather than only after opening the note and finding the caret
          // gone. The leading glyph rather than the trailing slot, because that
          // slot is already spoken for by the upload spinner and the encryption
          // lock — and a locked note is a different *kind* of note, which is
          // exactly what the leading glyph says on the folder rows too.
          note.locked ? (
            <EyeIcon className="h-5 w-5" />
          ) : (
            <NoteIcon className="h-5 w-5" />
          )
        }
        label={noteTitle(note)}
        active={note.id === activeNoteId}
        indent={indent}
        trailing={
          // The upload spinner wins over the lock: a note being written isn't
          // settled at rest yet (see the overview card). The lock is green once
          // the note's body is decrypted/loaded this session, gray while it's
          // still sealed-but-deferred (would decrypt on open).
          uploadingIds?.has(note.id) ? (
            <SpinnerIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
          ) : encStatus?.get(note.id) === "encrypted" ? (
            <LockIcon
              className={`h-3.5 w-3.5 shrink-0 ${note.body !== undefined ? "text-accent" : "text-muted"}`}
            />
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
        dragging={dragItem?.kind === "note" && dragItem.id === note.id}
        onDragStart={isDesktop ? (e) => startNoteDrag(e, note.id) : undefined}
        onDragEnd={isDesktop ? endDrag : undefined}
      >
        <SwipeToRemove
          actionLabel={t("nav.deleteNote")}
          archiveLabel={t("nav.archive")}
          onRemove={() => onRemoveNote(note.id)}
          onArchive={() => onArchiveNote(note.id)}
          onCopyLink={
            onCopyNoteLink ? () => onCopyNoteLink(note.id) : undefined
          }
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
    const containsActiveNote =
      activeNoteId != null && folderNotes.some((n) => n.id === activeNoteId);
    return (
      <div key={folder.id} {...{ [NOTE_DROP_ATTR]: folder.id }}>
        {/* The header is both a drop target (a dragged note files into it) and,
            when another namespace exists, a drag source — picking the folder up
            moves it, with every note in it, onto a namespace row. */}
        <NoteDragItem
          noteId={folder.id}
          title={folder.name}
          kind="folder"
          enabled={!isDesktop && canMoveFolderToNamespace}
          draggable={isDesktop && canMoveFolderToNamespace}
          dragging={dragItem?.kind === "folder" && dragItem.id === folder.id}
          onDragStart={
            isDesktop && canMoveFolderToNamespace
              ? (e) => startFolderDrag(e, folder.id)
              : undefined
          }
          onDragEnd={isDesktop ? endDrag : undefined}
        >
          <FolderRow
            name={folder.name}
            count={folderNotes.length}
            expanded={expanded}
            containsActiveNote={containsActiveNote}
            isDropTarget={noteDropActive(folder.id)}
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
        </NoteDragItem>
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
      {/* Everything above the button island scrolls as one region, so a long
          note list stays fully reachable without carrying the island and the
          footer off the bottom of the drawer with it. `min-h-0` is what lets
          this flex child shrink below its content and actually scroll (without
          it a flex item's floor is its content height, and the overflow would
          push the pinned rows off-screen instead). `flex-1` keeps the island at
          the foot of the drawer when the list is short, which is what the
          island's own `mt-auto` used to do on its own. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* Namespaces switcher: tap a row to switch which set of notes is
          shown; the heading's cogwheel opens the full manage dialog (add /
          rename / icon / delete) — a cog, not a "+", because it manages
          rather than adds inline. */}
        <SectionHeader
          label={t("nav.namespaces")}
          onAdd={() => pick(() => dispatch({ kind: "namespaces" }))}
          addLabel={t("nav.manageNamespaces")}
          addIcon={<CogIcon className="h-4 w-4" />}
          collapsible
          collapsed={namespacesCollapsed}
          onToggle={() => setNamespacesCollapsed((v) => !v)}
          toggleLabel={
            namespacesCollapsed
              ? t("nav.expandNamespaces")
              : t("nav.collapseNamespaces")
          }
        />
        {/* Collapsed, the switcher shows only the active namespace (so you always
          see where you are); expanded, it lists them all. */}
        {(namespacesCollapsed
          ? namespaces.filter((ns) => ns.slug === activeNamespace)
          : namespaces
        ).map((ns) => {
          // A namespace that picked an icon or colour shows its own glyph,
          // tinted to that colour. One left untouched gets the plain folder
          // fallback; the active set reads at a glance from the row's accent
          // highlight (and the icon's accent tint) rather than a swapped-in
          // checkmark.
          const customised = Boolean(ns.glyph || ns.color);
          const icon = customised ? (
            <NamespaceGlyph
              name={ns.glyph}
              className="h-5 w-5"
              style={ns.color ? { color: ns.color } : undefined}
            />
          ) : (
            <NamespaceGlyph className="h-5 w-5" />
          );
          // Every namespace but the active one is a drop target: dropping a note
          // — or a whole folder — onto it moves it into that namespace.
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
              onDragOver={
                droppable ? (e) => allowDropOn(e, nsKey, true) : undefined
              }
              onDragLeave={droppable ? () => setDropTarget(null) : undefined}
              onDrop={
                droppable ? (e) => dropOnNamespace(e, ns.slug) : undefined
              }
              onClick={() => onSwitchNamespace(ns.slug)}
            />
          );
        })}
        {/* Favorites: the notes starred with the editor header's star button,
          lifted above the ordinary list so they're one tap away wherever they
          are filed. The section only exists once something is starred — an
          empty heading would be noise in a drawer this dense, and the star
          button is where the feature is discovered. Each row is a full note row
          (swipe / right-click / drag all behave as they do below), so a
          favorite can be archived or refiled straight from here. */}
        {favorites.length > 0 && (
          <>
            <SectionHeader label={t("nav.favorites")} border />
            {favoritesShowFolders
              ? favoriteGroups.map((group) =>
                  group.folder ? (
                    <div key={group.folder.id}>
                      <FolderLabelRow
                        name={group.folder.name}
                        count={group.notes.length}
                      />
                      {group.notes.map((note) => renderNoteRow(note, true))}
                    </div>
                  ) : (
                    <div key="favorites-ungrouped">
                      {group.notes.map((note) => renderNoteRow(note))}
                    </div>
                  ),
                )
              : flatFavorites.map((note) => renderNoteRow(note))}
          </>
        )}
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
            noteDropActive(NOTE_DROP_ROOT)
              ? "rounded-sm bg-accent/10"
              : undefined
          }
        >
          {sortedFolders.length === 0 && looseNotes.length === 0 ? (
            loading ? (
              <p className="flex items-center gap-2 px-5 py-[var(--density-row-py)] text-sm text-muted">
                <SpinnerIcon className="h-4 w-4 shrink-0 animate-spin" />
                {t("nav.notesLoading")}
              </p>
            ) : (
              <p className="px-5 py-[var(--density-row-py)] text-sm text-muted">
                {t("nav.notesEmpty")}
              </p>
            )
          ) : folderPlacement === "mixed" ? (
            mixTopLevel(sortedFolders, looseNotes, notes, noteSortKey).map(
              (item) =>
                item.kind === "folder"
                  ? renderFolder(item.folder)
                  : renderNoteRow(item.note),
            )
          ) : (
            <>
              {sortedFolders.map(renderFolder)}
              {looseNotes.map((note) => renderNoteRow(note))}
            </>
          )}
        </div>
      </div>
      {/* The button island below the list — see `SideMenuActionBar`. Pinned
          outside the scroll area above, so it and the footer stay put however
          long the note list runs. The drawer owns the live drag state, so the
          Archive cell's drop-target wiring is threaded down; every other action
          is a plain callback (the ones that leave the drawer close it first). */}
      <SideMenuActionBar
        onNewNote={() => {
          onAddNote();
          close();
        }}
        onNewFolder={() => setCreatingFolder(true)}
        onSearch={() => {
          // Open synchronously *inside this tap* via flushSync, so the search
          // field's focus (a layout effect in `Modal`) runs within the user
          // gesture — the only context in which iOS raises the soft keyboard
          // for a programmatic focus. A plain bus dispatch defers the focus to
          // a later commit, outside the gesture, and the keyboard stays down.
          // Open before closing the drawer so the field is focused while the
          // tapped button is still mounted.
          flushSync(() => dispatch({ kind: "search" }));
          close();
        }}
        onShowAll={() => {
          onShowAll();
          close();
        }}
        showAllActive={showAllActive}
        onOpenArchive={() => {
          onOpenArchive();
          close();
        }}
        archiveActive={archiveActive}
        archivedCount={archivedCount}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        syncSlot={syncSlot}
        archiveIsDropTarget={noteDropActive(NOTE_DROP_ARCHIVE)}
        onArchiveDragOver={(e) => allowDropOn(e, NOTE_DROP_ARCHIVE)}
        onArchiveDragLeave={() => setDropTarget(null)}
        onArchiveDrop={dropOnArchive}
      />
      {/* Footer collapse rail — a thin, full-width chevron button seated just
          above the footer that folds it away (and back), handing the freed
          vertical space to the note list. Offered on every viewport, the phone
          drawer included. */}
      <FooterCollapseRail
        collapsed={footerCollapsed}
        label={
          footerCollapsed ? t("nav.expandFooter") : t("nav.collapseFooter")
        }
        onClick={toggleFooter}
      />
      {/* The relocated burger menu, pinned to the foot of the drawer: Donate,
          the trophy (achievements), an "About" dropdown that folds away the
          project links (What's new / source / privacy), and Settings pinned
          last under the thumb. Foldable away via the rail above. */}
      {!footerCollapsed && <SideMenuFooter onClose={close} />}
    </>
  );

  // Pinned: a permanent docked sidebar beside the content. No floating
  // button, no backdrop, no open/close gestures — it's simply always there.
  // App lays it out as a flex sibling of the main view, so a fixed width and a
  // single inner border is all the framing it needs. It docks on the same side
  // the floating button rests on.
  //
  // On desktop the panel isn't wanted every minute of the day, so a
  // `SidebarCollapseRail` rides its inner edge and folds it away entirely (the
  // choice persists — see `use-nav.ts`). The rail is an overlay straddling that
  // edge rather than a flex sibling, and it is invisible and click-through
  // until the pointer comes to the edge looking for it: collapsed, the sidebar
  // then costs the note nothing at all, and open, the rows' highlight runs the
  // panel's full width instead of stopping short of a permanent gutter. The
  // panel owns the border that separates the menu from the notes.
  //
  // The top padding drops the drawer's first section header a touch below the
  // safe-area inset so its small-caps label lines up with the vertically
  // centred buttons in the main content's sticky header (which sit a little
  // below that header's own top edge) instead of poking above them. It adds
  // 0.375rem to the inset and subtracts the section header's own `pt-3`
  // (0.75rem), so the first row's net top lands at
  // `max(1.125rem, env(safe-area-inset-top) + 0.375rem)`. Both nav variants
  // (docked and drawer) share the formula.
  if (pinned) {
    // The rail's band. Collapsed it hugs the viewport edge, where a cursor
    // thrown at the side of the screen lands on it without aiming. Open it
    // straddles the panel's inner edge (half the rail's width back from
    // `SIDEBAR_PANEL_WIDTH`), so it reads as a grip on the divider and leaves
    // the rows' trailing "+" — which stops a few pixels short of that edge —
    // clear of it.
    const railOffset = sidebarCollapsed
      ? "0px"
      : `calc(${SIDEBAR_PANEL_WIDTH} - ${SIDEBAR_RAIL_WIDTH} / 2)`;
    return (
      <>
        {!sidebarCollapsed && (
          <nav
            id={drawerId}
            aria-label={t("nav.label")}
            className={`relative flex h-full w-64 shrink-0 flex-col overflow-hidden bg-surface select-none [padding-top:max(0.375rem,calc(env(safe-area-inset-top)_-_0.375rem))] ${
              onRight
                ? "order-last border-l border-line"
                : "border-r border-line"
            }`}
          >
            {sections}
          </nav>
        )}
        <SidebarCollapseRail
          collapsed={sidebarCollapsed}
          side={onRight ? "right" : "left"}
          controls={sidebarCollapsed ? undefined : drawerId}
          label={sidebarCollapsed ? t("nav.showSidebar") : t("nav.hideSidebar")}
          offset={railOffset}
          revealed={railRevealed}
          elementRef={railRef}
          onClick={toggleSidebar}
        />
      </>
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
            // The framework's public types are written against `@types/react`,
            // where `RefObject<T>.current` is `T` and the nullability has to be
            // spelled out — so `panelRef` is declared `RefObject<HTMLElement |
            // null>`. Preact's `RefObject<T>.current` is already `T | null`, so
            // the two are the same shape with the union doubled up, and TS's
            // variance check on the alias rejects the assignment anyway.
            ref={swipeClose.panelRef as RefObject<HTMLElement>}
            aria-label={t("nav.label")}
            style={{ transform: `translateX(${swipeClose.offset}px)` }}
            className={`relative flex w-64 max-w-[80%] flex-col overflow-hidden bg-surface shadow-xl select-none [touch-action:pan-y] [padding-top:max(0.375rem,calc(env(safe-area-inset-top)_-_0.375rem))] ${
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
