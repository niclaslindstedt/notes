import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { noteTitle, type Folder, type Note } from "../../domain/note.ts";
import { useT } from "../../i18n/index.ts";
import { useAppearance } from "../../theme/useTheme.ts";
import { AppTitle } from "../AppTitle.tsx";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useSwipeReveal } from "../hooks/useSwipeReveal.ts";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
} from "../icons.tsx";
import { NoteDragItem } from "../note-drag.tsx";
import {
  NOTE_DROP_ATTR,
  NOTE_DROP_ROOT,
  useNoteDragAbort,
  useNoteDropKey,
} from "../note-drag-context.ts";
import { RowActionMenu } from "../RowActionMenu.tsx";
import { SwipeableNoteCard } from "./NoteCard.tsx";

// The dataTransfer MIME used when dragging a note card onto a folder with the
// desktop HTML5 path. The touch path (see `note-drag.tsx`) and the ungrouped
// drop sentinel (`NOTE_DROP_ROOT`) are shared from there.
const NOTE_DND_TYPE = "application/x-notes-note-id";

export function NoteList({
  notes,
  loading = false,
  folders,
  onOpen,
  onNew,
  onArchive,
  onDelete,
  onMoveNote,
  onRenameFolder,
  onRemoveFolder,
  syncSlot,
  encStatus,
  uploadingIds,
}: {
  notes: Note[];
  /** The active namespace's first load is still in flight with nothing seeded. */
  loading?: boolean;
  folders: Folder[];
  onOpen: (id: string) => void;
  onNew: (folderId?: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  /** Move a note into `folderId`, or out of any folder when `null`. */
  onMoveNote: (id: string, folderId: string | null) => void;
  /** Rename a folder. */
  onRenameFolder: (id: string, name: string) => void;
  /** Delete a folder (its notes fall back to the top level). */
  onRemoveFolder: (id: string) => void;
  syncSlot: ReactNode;
  encStatus?: Map<string, "encrypted" | "pending">;
  /** Ids of notes whose file is being uploaded to the backend right now. */
  uploadingIds?: ReadonlySet<string>;
}) {
  const t = useT();
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  // The bare file-explorer listing wants its rows packed tight, like files in a
  // tree; cards and rows keep the roomier gap that suits their chrome.
  const listGap = useAppearance().listLayout === "list" ? "gap-0.5" : "gap-1.5";
  // The folder under the finger during a touch long-press drag (the desktop
  // path uses `dropTarget` below); either lights up the matching section.
  const activeDropKey = useNoteDropKey();
  const dragAbort = useNoteDragAbort();
  // Collapsed folders (default expanded) and the desktop drag-to-file state —
  // mirrors the side menu, so a note can be dropped onto a folder here too.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Which folder (if any) is being renamed in place — swaps its header for the
  // inline name editor, mirroring the side menu. View-local, like `collapsed`.
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [draggingNote, setDraggingNote] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // The desktop HTML5 path leans on `dragend` to clear the lift, but the
  // browser skips `dragend` when the dragged row unmounts mid-drag (a sync
  // conflict surfacing, a background reload swapping the list) — which would
  // strand the row dimmed. The abort signal (bumped by `NoteDragProvider`)
  // clears it instead. Idle on mount and whenever nothing is lifted.
  useEffect(() => {
    setDraggingNote(null);
    setDropTarget(null);
  }, [dragAbort]);

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function startDrag(e: ReactDragEvent, id: string) {
    e.dataTransfer.setData(NOTE_DND_TYPE, id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingNote(id);
  }
  function endDrag() {
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
    endDrag();
    if (id) onMoveNote(id, folderId);
  }

  // With no notes yet, pressing Enter (a physical keyboard, so desktop) starts
  // the first note — the empty state's primary action without a tap. Suppressed
  // while the namespace is still loading: there's no empty state to act on yet,
  // and a fresh note would land in a document the in-flight load is about to
  // replace.
  const empty = notes.length === 0 && folders.length === 0;
  useEffect(() => {
    if (!empty || loading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      e.preventDefault();
      onNew();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [empty, loading, onNew]);

  const folderIds = new Set(folders.map((f) => f.id));
  const ungrouped = notes.filter(
    (n) => !n.folderId || !folderIds.has(n.folderId),
  );

  function renderCard(note: Note) {
    return (
      <li key={note.id}>
        <NoteDragItem
          noteId={note.id}
          title={noteTitle(note)}
          enabled={!isDesktop}
          draggable={isDesktop}
          dragging={draggingNote === note.id}
          onDragStart={isDesktop ? (e) => startDrag(e, note.id) : undefined}
          onDragEnd={isDesktop ? endDrag : undefined}
        >
          <SwipeableNoteCard
            note={note}
            onOpen={() => onOpen(note.id)}
            onPrimary={() => onArchive(note.id)}
            onDelete={() => onDelete(note.id)}
            primaryLabel={t("app.archive")}
            primaryIcon={<ArchiveIcon className="h-4 w-4" />}
            encrypted={encStatus?.get(note.id) === "encrypted"}
            uploading={uploadingIds?.has(note.id) ?? false}
          />
        </NoteDragItem>
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col select-none">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <AppTitle />
        <div className="flex items-center gap-2">{syncSlot}</div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto overscroll-none px-4 pt-3 pb-24 md:pb-3">
        {empty ? (
          loading ? (
            <p className="mt-16 flex items-center justify-center gap-2 text-center text-muted">
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              {t("app.loading")}
            </p>
          ) : (
            <p className="mt-16 text-center text-muted">{t("app.empty")}</p>
          )
        ) : folders.length === 0 ? (
          <ul className={`flex flex-col ${listGap}`}>
            {notes.map(renderCard)}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            {/* One section per folder — a header that collapses it and doubles
                as a drop target, with the folder's cards and a "New note"
                shortcut nested under it. */}
            {folders.map((folder) => {
              const folderNotes = notes.filter((n) => n.folderId === folder.id);
              const expanded = !collapsed.has(folder.id);
              return (
                <section
                  key={folder.id}
                  {...{ [NOTE_DROP_ATTR]: folder.id }}
                  onDragOver={(e) => allowDropOn(e, folder.id)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => dropOn(e, folder.id)}
                  className={`rounded-[var(--radius)] p-1.5 ${
                    dropTarget === folder.id || activeDropKey === folder.id
                      ? "bg-accent/10 ring-1 ring-accent/40"
                      : ""
                  }`}
                >
                  {renamingFolderId === folder.id ? (
                    <FolderRenameRow
                      initial={folder.name}
                      placeholder={t("nav.folderName")}
                      onCommit={(name) => {
                        onRenameFolder(folder.id, name);
                        setRenamingFolderId(null);
                      }}
                      onCancel={() => setRenamingFolderId(null)}
                    />
                  ) : (
                    <OverviewFolderHeader
                      name={folder.name}
                      count={folderNotes.length}
                      expanded={expanded}
                      renameLabel={t("nav.renameFolder")}
                      deleteLabel={t("nav.deleteFolder")}
                      addNoteLabel={t("nav.newNote")}
                      actionsLabel={t("nav.folderActions")}
                      onToggle={() => toggleFolder(folder.id)}
                      onAddNote={() => onNew(folder.id)}
                      onRename={() => setRenamingFolderId(folder.id)}
                      onDelete={() => onRemoveFolder(folder.id)}
                    />
                  )}
                  {expanded && folderNotes.length > 0 && (
                    <ul className={`flex flex-col ${listGap} pt-1 pl-3`}>
                      {folderNotes.map(renderCard)}
                    </ul>
                  )}
                </section>
              );
            })}

            {/* Ungrouped notes — also the drop zone that takes a note OUT of a
                folder. The label only shows once at least one folder exists. */}
            <section
              {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ROOT }}
              onDragOver={(e) => allowDropOn(e, NOTE_DROP_ROOT)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => dropOn(e, null)}
              className={`rounded-[var(--radius)] p-1.5 ${
                dropTarget === NOTE_DROP_ROOT ||
                activeDropKey === NOTE_DROP_ROOT
                  ? "bg-accent/10 ring-1 ring-accent/40"
                  : ""
              }`}
            >
              <p className="px-1 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                {t("nav.noFolder")}
              </p>
              {ungrouped.length > 0 && (
                <ul className={`flex flex-col ${listGap}`}>
                  {ungrouped.map(renderCard)}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {/* The "new note" affordance. On narrow viewports — where the side menu
          is a floating drawer — it's a circular floating action button centred
          at the bottom of the screen, thumb-reachable and hard to miss. From
          the `md` breakpoint up, where the side menu docks as a permanent
          sidebar (`nav.pinned`, see `use-nav.ts`), it relaxes into a normal,
          clearly-styled accent button in flow under the list — the floating
          puck reads as awkward beside a pinned chrome. */}
      <button
        type="button"
        onClick={() => onNew()}
        aria-label={t("app.newNote")}
        className="
          fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-20
          flex h-14 w-14 -translate-x-1/2 cursor-pointer items-center justify-center gap-0
          rounded-full bg-accent text-3xl leading-none font-light text-page-bg
          shadow-lg transition-all duration-200 active:scale-95
          md:static md:mx-auto md:mt-3 md:h-auto md:w-auto md:translate-x-0
          md:gap-2 md:rounded-md md:bg-accent/10 md:px-4 md:py-2 md:text-base md:font-semibold
          md:text-accent md:shadow-none md:hover:bg-accent/20
        "
      >
        <span aria-hidden className="-mt-0.5 md:mt-0">
          +
        </span>
        <span className="hidden md:inline">{t("app.newNote")}</span>
      </button>
    </div>
  );
}

// The overview folder header's rename + delete actions stay hidden until
// summoned, mirroring the side menu's `FolderRow`: a LEFT swipe latches open an
// `[edit | delete]` strip on touch, and a RIGHT-CLICK opens the same two
// actions on a computer (`RowActionMenu`). A folder has no archive analogue, so
// — like the side-menu row — `useSwipeReveal` gets no `onArchive` and a right
// swipe is inert. The width of the two-button strip matches the side menu.
const FOLDER_ACTION_W = 96;

function OverviewFolderHeader({
  name,
  count,
  expanded,
  renameLabel,
  deleteLabel,
  addNoteLabel,
  actionsLabel,
  onToggle,
  onAddNote,
  onRename,
  onDelete,
}: {
  name: string;
  count: number;
  expanded: boolean;
  renameLabel: string;
  deleteLabel: string;
  addNoteLabel: string;
  actionsLabel: string;
  onToggle: () => void;
  onAddNote: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  const swipe = useSwipeReveal(FOLDER_ACTION_W);

  // The expand toggle and the trailing "+" (new note in this folder) are
  // siblings, not nested buttons — the same shape the inline header had before
  // the swipe / right-click wrappers were added around it.
  const header = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--radius)] px-1 py-1.5 text-left text-sm font-semibold text-fg-bright hover:bg-surface-2"
      >
        <span className="text-muted">
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </span>
        <span className="text-accent">
          {expanded ? (
            <FolderOpenIcon className="h-5 w-5" />
          ) : (
            <FolderIcon className="h-5 w-5" />
          )}
        </span>
        <span className="flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {count}
        </span>
      </button>
      <button
        type="button"
        onClick={onAddNote}
        aria-label={addNoteLabel}
        title={addNoteLabel}
        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );

  // On a computer the swipe gives way to a right-click menu of the same actions
  // (see `RowActionMenu`); a plain click still toggles the folder.
  if (isDesktop) {
    return (
      <RowActionMenu
        ariaLabel={actionsLabel}
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
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)]">
      {/* Edit + Delete — the trailing strip a left swipe latches open. Hidden
          until the row is swiped left. */}
      <div
        aria-hidden={swipe.offset >= 0}
        className={`absolute inset-0 flex items-center justify-end ${
          swipe.offset < 0 ? "" : "invisible"
        }`}
      >
        <div className="flex h-full" style={{ width: FOLDER_ACTION_W }}>
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
            className="flex h-full flex-1 items-center justify-center rounded-r-[var(--radius)] bg-danger text-white"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        {...swipe.handlers}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={`relative bg-page-bg [touch-action:pan-y] ${
          swipe.animating ? "transition-transform duration-200" : ""
        }`}
      >
        {header}
      </div>
    </div>
  );
}

// The inline folder-name editor the overview swaps a folder header for while
// it's being renamed — the overview counterpart of the side menu's
// `FolderEditRow`. Commits on Enter or blur with a non-empty trimmed name;
// Escape (or an empty name) cancels. The `committed` latch stops the blur that
// trails an Enter from firing the commit twice.
function FolderRenameRow({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [committed, setCommitted] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
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
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span className="text-accent">
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
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-fg-bright outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
