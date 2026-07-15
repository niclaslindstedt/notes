import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { unlock, useAchievementWatcher } from "../achievements/index.ts";
import { useDevSeed } from "../dev/useDevSeed.ts";
import {
  defaultNoteTitle,
  type Note,
  type SaveFormatting,
} from "../domain/note.ts";
import { isStandaloneMobile } from "../pwa/standalone.ts";
import { createDevSeedAdapter } from "../storage/dev-seed/index.ts";
import { useStorageBackend } from "../storage/useStorageBackend.ts";
import {
  getActiveNote,
  setActiveNote,
} from "../storage/active-note-preference.ts";
import { unlockAchievements, useApplyAppearance } from "../theme/useTheme.ts";
import { ConflictModal } from "../ui/ConflictModal.tsx";
import { DropOverlay } from "../ui/DropOverlay.tsx";
import { useEdgeSwipeOpen } from "../ui/hooks/useEdgeSwipeOpen.ts";
import { useFileDrop } from "../ui/hooks/useFileDrop.ts";
import { useMediaQuery } from "../ui/hooks/useMediaQuery.ts";
import { usePullToRefresh } from "../ui/hooks/usePullToRefresh.ts";
import { useSuppressSwipeNavigation } from "../ui/hooks/useSuppressSwipeNavigation.ts";
import { useUndoRedoShortcuts } from "../ui/hooks/useUndoRedoShortcuts.ts";
import { useViewportHeight } from "../ui/hooks/useViewportHeight.ts";
import { ReportDragActivityContext } from "../ui/drag-activity.ts";
import { NoteDragProvider } from "../ui/note-drag.tsx";
import {
  NOTE_DROP_ARCHIVE,
  NOTE_DROP_NS_PREFIX,
  NOTE_DROP_ROOT,
  type DragItem,
} from "../ui/note-drag-context.ts";
import { AttachmentFetchContext } from "../ui/attachments/fetch-context.ts";
import { ModalBusProvider } from "../ui/ModalBusProvider.tsx";
import {
  applyFaviconHref,
  namespaceFaviconHref,
} from "../ui/namespace-favicon.ts";
import { NavContext } from "../ui/nav-context.ts";
import { APP_VIEWPORT_RECT } from "../ui/appViewportRect.ts";
import { ArchiveList, ReadOnlyNote } from "../ui/ArchivedNoteView.tsx";
import { Editor } from "../ui/NoteEditor.tsx";
import { NoteList } from "../ui/note-list/NoteList.tsx";
import { SideMenu } from "../ui/SideMenu.tsx";
import { PullToRefreshIndicator } from "../ui/PullToRefreshIndicator.tsx";
import { SyncIndicator } from "../ui/SyncIndicator.tsx";
import { UnlockGate } from "../ui/UnlockGate.tsx";
import { UpdateToast } from "../ui/UpdateToast.tsx";
import { AchievementsModalHost } from "./modals/AchievementsModalHost.tsx";
import { AchievementsUnlockModalHost } from "./modals/AchievementsUnlockModalHost.tsx";
import { ChangelogModalHost } from "./modals/ChangelogModalHost.tsx";
import { NamespacesModalHost } from "./modals/NamespacesModalHost.tsx";
import { SearchModalHost } from "./modals/SearchModalHost.tsx";
import { SettingsModalHost } from "./modals/SettingsModalHost.tsx";
import { useEncryptionMigration } from "./use-encryption-migration.ts";
import { useNavState } from "./use-nav.ts";
import { useNotes } from "./use-notes.ts";
import { useSettingsSync } from "./use-settings-sync.ts";
import { useUploadStatus } from "./use-upload-status.ts";

// Root component. The shell is a flex row — the side menu (a docked sidebar
// on wide viewports, a drag-out drawer on phones) beside a main area that
// shows one of four surfaces, switched on plain state rather than a router so
// the tree stays a single mounted shell: the notes overview, the archive page
// (the same overview filtered to archived notes — a real page, not a modal, so
// the side menu's edge-swipe still works over it), a full-screen editor
// (`editingId`), or a read-only view of an archived note (`readingId`).
// `NavContext` carries the drawer state down to `SideMenu`; `ModalBusProvider`
// lets any button open the settings dialog without threading openers through
// the tree.

export function App() {
  // Pin every fixed overlay (the drawer, the modals) to the live visual
  // viewport so they fill the screen on the iOS standalone PWA, where bare
  // `100svh` comes up short. Sets the `--app-height` / `--app-top` vars that
  // `appViewportRect.ts` reads.
  useViewportHeight();
  const appearance = useApplyAppearance();
  const { editor } = appearance;
  // The active storage backend (this device / a local folder / a cloud) and
  // its sync engine. Appearance settings reconcile against the same backend
  // so they travel with a synced folder too.
  const storage = useStorageBackend();
  useSettingsSync(storage.settingsStore);
  // Developer "Fake data" toggle: while active, a fresh ephemeral in-memory
  // seed adapter overrides the real backend for the session (each enable
  // starts from a pristine sample), so fake data can be previewed without
  // touching the notes on the device. The flag is in-memory only, so a reload
  // drops straight back to the real adapter.
  const { active: fakeData } = useDevSeed();
  const seedAdapter = useMemo(
    () => (fakeData ? createDevSeedAdapter() : null),
    [fakeData],
  );
  // Format-on-save settings handed to the persistence engine: tidy each note's
  // body (trim trailing spaces, end with a newline) as it's written.
  const formatting = useMemo<SaveFormatting>(
    () => ({
      trimTrailingSpaces: editor.trimTrailingSpaces,
      trailingNewline: editor.trailingNewline,
    }),
    [editor.trimTrailingSpaces, editor.trailingNewline],
  );
  // Restore the note that was open in the active namespace before the last
  // reload / PWA upgrade, so a refresh lands back where you left off instead of
  // dropping to the overview. Once the (possibly async-loading) document
  // arrives, `editing` below resolves the id to the note; a stale id (the note
  // was deleted elsewhere) simply resolves to nothing and falls back to the
  // overview. Declared before `useNotes` so the open note scopes its undo
  // timeline (undo/redo act on the note you're looking at).
  const [editingId, setEditingId] = useState<string | null>(() =>
    getActiveNote(storage.activeNamespace),
  );
  const {
    notes,
    allNotes,
    archived,
    folders,
    create,
    importFiles,
    update,
    attach,
    retitle,
    remove,
    archive,
    restore,
    moveNote,
    createFolder,
    renameFolder,
    removeFolder,
    removeFolderWithNotes,
    ensureBody,
    undo,
    redo,
    canUndo,
    canRedo,
    undoScrollSeq,
    sync,
  } = useNotes(
    seedAdapter ?? storage.adapter,
    formatting,
    editingId,
    storage.adoptEncryptedRemote,
  );
  // Persist the open note per namespace so it survives a reload / upgrade. The
  // active-namespace pointer is itself per-device, so the pair stays consistent.
  useEffect(() => {
    setActiveNote(storage.activeNamespace, editingId);
  }, [storage.activeNamespace, editingId]);
  // Which list the main area shows when nothing is open in the editor / reader.
  const [view, setView] = useState<"notes" | "archive">("notes");
  // An archived note opened read-only (tapped from the archive page). Distinct
  // from `editingId` so the editor stays the editable surface and the reader
  // the read-only one.
  const [readingId, setReadingId] = useState<string | null>(null);
  const nav = useNavState();
  // True while a note is being picked up and dragged (the touch/pointer path),
  // reported up from `NoteDragProvider` so pull-to-refresh stands down for its
  // duration — dragging a note downward would otherwise arm a refresh too.
  const [dragActive, setDragActive] = useState(false);

  // Background encryption migration + per-note status for the green lock. When
  // encryption is on (file/cloud backend, unlocked), this seals each note's
  // files in the background — paced so it doesn't burst the cloud API — and
  // reports which notes are fully encrypted so the lock fills in note-by-note.
  const { status: encStatus, conversion: encConversion } =
    useEncryptionMigration({
      enabled:
        storage.encryption === "encrypted" &&
        !storage.locked &&
        storage.backend !== "browser",
      disabling: storage.encryptionDisabling,
      paused: sync.offline,
      notes: sync.doc.notes,
      getStatus: storage.getEncryptionStatus,
      migrateNote: storage.migrateNote,
      demigrateNote: storage.demigrateNote,
      splitLegacyBlob: storage.splitLegacyBlob,
      refreshIndex: storage.refreshIndex,
      onDisableComplete: storage.finishDisableEncryption,
    });

  // Per-note upload progress for the sync spinner: the ids of notes whose file
  // is being pushed to the backend right now. Empty on the local backend, which
  // has no per-note upload to watch.
  const uploadingIds = useUploadStatus(storage.adapter);

  // The active namespace's first load hasn't landed yet and we have nothing to
  // paint from the synchronous seed — so the list region shows a "loading"
  // hint instead of the misleading "No notes yet." Only the folder/cloud
  // backends ever sit in this state: their `load()` is a real round-trip, and a
  // never-visited namespace has no offline mirror for `loadSync` to seed from,
  // so switching into one would otherwise read as empty for the seconds the
  // fetch takes. The browser store loads synchronously, so an empty namespace
  // there is genuinely empty from the first frame and never "loading".
  const notesLoading =
    !sync.loaded &&
    storage.backend !== "browser" &&
    notes.length === 0 &&
    folders.length === 0;

  // When the floating button is hidden (only possible in the standalone
  // mobile PWA), an inward swipe from the drawer's resting edge opens it.
  // The hook itself stands down while a modal is open; we gate it off too
  // when the button is shown, the drawer is already open, or the sidebar is
  // pinned.
  useEdgeSwipeOpen({
    side: nav.position.side,
    enabled: !nav.showButton && !nav.pinned && !nav.open,
    onOpen: nav.toggle,
  });

  // Kill the browser's native edge-swipe history navigation (swipe in from the
  // left edge to go back / the right to go forward) so it stops hijacking the
  // side menu's own horizontal swipe gestures, which live on the same edges.
  useSuppressSwipeNavigation();

  // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z mirror the side-menu undo & redo. The hook
  // stands down while focus is in a text field so the editor's native undo
  // keeps working as you type.
  useUndoRedoShortcuts({ canUndo, canRedo, onUndo: undo, onRedo: redo });

  // Achievements: watch the note document + appearance for derived unlocks and
  // drain the manual-unlock bus, recording each into the synced appearance
  // store. The achievements row in the side menu surfaces what's been earned.
  useAchievementWatcher({
    snapshot: sync.doc,
    appearance,
    loaded: sync.loaded,
    enabled: !appearance.disableAchievements,
    record: unlockAchievements,
  });

  // Running as an installed PWA is the "Home screen" trophy — fire it once on
  // mount; the bus + record are idempotent, so a relaunch never re-badges it.
  useEffect(() => {
    if (isStandaloneMobile()) unlock("homeScreen");
  }, []);

  // Re-badge the browser-tab favicon to the active namespace's glyph (in its
  // accent colour) so a glance tells you which namespace you're in. A
  // namespace with no glyph keeps the bundled mark.
  const activeNs = storage.namespaces.find(
    (n) => n.slug === storage.activeNamespace,
  );
  const faviconHref = namespaceFaviconHref(activeNs);
  useEffect(() => {
    applyFaviconHref(faviconHref);
  }, [faviconHref]);

  // Switch namespace and reopen wherever you last were in the target — the note
  // that was open belongs to the namespace we're leaving, so we restore the new
  // namespace's own remembered note (or its overview if none), the same place a
  // reload would land.
  function switchNamespace(slug: string) {
    storage.switchNamespace(slug);
    setEditingId(getActiveNote(slug));
    setReadingId(null);
    setView("notes");
  }

  const editing = editingId
    ? (allNotes.find((n) => n.id === editingId) ?? null)
    : null;
  const reading = readingId
    ? (allNotes.find((n) => n.id === readingId) ?? null)
    : null;

  // Opening a note on a lazy encrypted backend finds its body deferred — decrypt
  // it on demand so the editor / reader shows real text. Until it resolves the
  // surface renders a "Decrypting…" placeholder (see below) rather than an empty
  // editable body, so a keystroke can't overwrite the not-yet-loaded body.
  const editingDeferred = editing != null && editing.body === undefined;
  const readingDeferred = reading != null && reading.body === undefined;
  useEffect(() => {
    if (editingId && editingDeferred) void ensureBody(editingId);
  }, [editingId, editingDeferred, ensureBody]);
  useEffect(() => {
    if (readingId && readingDeferred) void ensureBody(readingId);
  }, [readingId, readingDeferred, ensureBody]);

  // A note the user never committed to — empty body and either no title or the
  // still-untouched auto-assigned default — is dropped when we leave it, so
  // abandoned "new note" taps (and their throwaway default titles) don't pile
  // up. The default-title scheme means a fresh note is no longer simply blank,
  // so we remember the title it was born with to tell "never touched" apart
  // from "deliberately named".
  const pristineNew = useRef<{ id: string; title: string } | null>(null);

  function discardable(note: Note): boolean {
    // A deferred note (body not loaded) is a real persisted note, never a
    // pristine scratch note that can be silently discarded.
    if (note.body === undefined) return false;
    if (note.body.trim() !== "") return false;
    if (note.title.trim() === "") return true;
    return (
      pristineNew.current?.id === note.id &&
      pristineNew.current.title === note.title
    );
  }

  // Pull-to-refresh: a downward drag from the top of the note list pulls the
  // latest from the backend. Only on a list (not in the editor or the
  // read-only archived-note view), only on a remote backend (the local store
  // has no remote to refresh from), and the hook itself stands down while a
  // modal or the drawer owns the screen.
  const ptr = usePullToRefresh(
    async () => {
      await sync.refresh();
      // A deliberate pull is the "fresh pull" trophy, same as the reload
      // button — the automatic foreground / open-note refreshes don't count.
      unlock("freshPull");
    },
    {
      enabled:
        !editing &&
        !reading &&
        !nav.open &&
        !dragActive &&
        storage.backend !== "browser",
    },
  );

  // Desktop drag-and-drop import: dropping markdown files anywhere on the
  // window imports each as a note (its filename becomes the title). Dragging a
  // file from the OS is a pointer gesture, so it's gated to hover-capable
  // (non-touch) devices; `drop.dragging` drives the full-window drop overlay.
  const isDesktop = useMediaQuery("(hover: hover) and (pointer: fine)");
  const drop = useFileDrop({
    enabled: isDesktop,
    onFiles: (files) => importDropped(files),
  });

  // Switch what's open in the editor, dropping the note we're leaving if it
  // was never typed into so abandoned "new note" taps don't pile up. Opening a
  // note always lands on the overview behind it (editable notes are never
  // archived), so leaving the editor returns there, and pulls the latest from a
  // remote backend so you read its current contents — cheap (incremental) and a
  // no-op locally.
  function switchTo(id: string | null) {
    if (editing && discardable(editing) && editing.id !== id)
      remove(editing.id);
    setReadingId(null);
    if (id) setView("notes");
    setEditingId(id);
    if (id !== null) void sync.refresh();
  }

  // Open a fresh note. A `folderId` files it straight into that folder (the
  // per-folder "New note" rows in the side menu / overview pass one); omitted,
  // it lands ungrouped.
  function openNew(folderId?: string) {
    if (editing && discardable(editing)) remove(editing.id);
    setReadingId(null);
    setView("notes");
    const title = defaultNoteTitle(editor.defaultTitle, allNotes);
    // On a file/cloud backend, hold the save until the title is committed so
    // the note's file is created already bearing the user's title (the
    // filename is a slug of the title) instead of the throwaway default — no
    // born-as-default-then-rename churn. The title field releases the hold when
    // it loses focus. The local browser backend has no per-note filename, so it
    // keeps saving immediately.
    if (storage.backend !== "browser") sync.holdSaves();
    const id = create(title, folderId);
    pristineNew.current = { id, title };
    setEditingId(id);
  }

  // Land a batch of dropped markdown files in the library, then surface them:
  // drop the throwaway note if the editor was on a never-touched one, leave
  // the editor / reader, and show the overview where the imports now sit at
  // the top. No-op when the drop carried nothing importable.
  function importDropped(files: { name: string; text: string }[]) {
    const added = importFiles(files);
    if (added === 0) return;
    if (editing && discardable(editing)) remove(editing.id);
    setEditingId(null);
    setReadingId(null);
    setView("notes");
    unlock("importer");
  }

  // Leave the editor / reader and show the full overview of active notes —
  // wired to the side menu's "Show all".
  function showAll() {
    if (editing && discardable(editing)) remove(editing.id);
    setEditingId(null);
    setReadingId(null);
    setView("notes");
  }

  // Open the archive page — the same overview filtered to archived notes.
  // Leaves the editor / reader so the list is what shows.
  function openArchive() {
    if (editing && discardable(editing)) remove(editing.id);
    setEditingId(null);
    setReadingId(null);
    setView("archive");
  }

  // Open an archived note read-only (tapped from the archive page).
  function openRead(id: string) {
    setReadingId(id);
  }

  function removeNote(id: string) {
    remove(id);
    if (id === editingId) setEditingId(null);
    if (id === readingId) setReadingId(null);
  }

  // Archiving a note from the overview leaves the editor too if that note
  // happened to be the one open, so a stale editor never lingers on a note
  // that's no longer in the list.
  function archiveNote(id: string) {
    archive(id);
    if (id === editingId) setEditingId(null);
  }

  // Move a note into another namespace (sidebar drag): write it into the
  // target's document, then remove it from this one. Best-effort — if the
  // target write fails (offline cloud), the note is left where it is. If the
  // moved note was open, leave the editor since it's gone from this namespace.
  async function moveToNamespace(id: string, slug: string) {
    const note = allNotes.find((n) => n.id === id);
    if (!note) return;
    if (await storage.moveNoteToNamespace(note, slug)) {
      remove(id);
      if (id === editingId) setEditingId(null);
      if (id === readingId) setReadingId(null);
    }
  }

  // Move a whole folder into another namespace (sidebar drag): write the folder
  // and all the notes filed in it into the target's document, then clear both
  // from this one. Best-effort, like the per-note move — if the target write
  // fails (offline cloud) nothing is removed here. If the open note belonged to
  // the folder, leave the editor since it's gone from this namespace.
  async function moveFolderToNamespace(folderId: string, slug: string) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const folderNotes = allNotes.filter((n) => n.folderId === folderId);
    if (await storage.moveFolderToNamespace(folder, folderNotes, slug)) {
      removeFolderWithNotes(folderId);
      if (folderNotes.some((n) => n.id === editingId)) setEditingId(null);
      if (folderNotes.some((n) => n.id === readingId)) setReadingId(null);
    }
  }

  // The sidebar drag layer reports a drop by the dragged item and the target
  // key; resolve the pair to the right action. A folder only acts on a
  // namespace target (move it there with all its notes); every other key is
  // meaningless for a folder and ignored. Routed through a ref so the
  // provider's `onDrop` identity stays stable (it feeds a context every row
  // subscribes to) while still seeing the latest closures here.
  const dropHandlerRef = useRef<(item: DragItem, key: string) => void>(
    () => {},
  );
  dropHandlerRef.current = (item: DragItem, key: string) => {
    if (item.kind === "folder") {
      if (key.startsWith(NOTE_DROP_NS_PREFIX)) {
        void moveFolderToNamespace(
          item.id,
          key.slice(NOTE_DROP_NS_PREFIX.length),
        );
      }
      return;
    }
    const id = item.id;
    if (key === NOTE_DROP_ROOT) moveNote(id, null);
    else if (key === NOTE_DROP_ARCHIVE) archiveNote(id);
    else if (key.startsWith(NOTE_DROP_NS_PREFIX)) {
      void moveToNamespace(id, key.slice(NOTE_DROP_NS_PREFIX.length));
    } else moveNote(id, key);
  };
  const handleNoteDrop = useCallback((item: DragItem, key: string) => {
    dropHandlerRef.current(item, key);
  }, []);

  // Restore from the archive page's swipe gesture: the note leaves the archive
  // list and reappears in the overview, but we stay on the archive page.
  function restoreNote(id: string) {
    restore(id);
    if (id === readingId) setReadingId(null);
  }

  // Restore from the read-only view's Restore button: the note is unarchived
  // (it slides back into the overview) and immediately reopened in the
  // editable editor, so the user can keep writing without another tap.
  function restoreAndEdit(id: string) {
    restore(id);
    setReadingId(null);
    setView("notes");
    setEditingId(id);
  }

  // Encryption on, no passphrase held this session — block the app behind the
  // unlock gate so the encrypted notes never render. The gate still wears the
  // user's theme (appearance settings are plaintext).
  if (storage.locked) {
    return (
      <UnlockGate storage={storage} fromRemote={storage.encryptionFromRemote} />
    );
  }

  const syncSlot = (
    <SyncIndicator
      sync={sync}
      storage={storage}
      uploadingIds={uploadingIds}
      notes={sync.doc.notes}
      conversion={encConversion}
    />
  );

  return (
    <ReportDragActivityContext.Provider value={setDragActive}>
      <AttachmentFetchContext.Provider value={storage.fetchAttachment}>
        <NavContext.Provider value={nav}>
          <ModalBusProvider>
            {/* Pin the whole shell to the *visual* viewport (the band actually on
            screen) rather than the layout viewport (`h-dvh`). On iOS the soft
            keyboard shrinks the visual viewport and scrolls the layout viewport
            up to keep the caret in view — with an `h-dvh` shell that drag
            carries the sticky header off the top of the screen, so the toolbar
            appears to scroll away with the note. Sizing the shell to
            `--app-height`/`--app-top` (the vars `useViewportHeight` mirrors)
            keeps it filling the visible band, so the header stays frozen. */}
            <div
              className="fixed flex overflow-hidden"
              style={APP_VIEWPORT_RECT}
            >
              <NoteDragProvider
                onDrop={handleNoteDrop}
                aborted={sync.conflict !== null}
              >
                <SideMenu
                  notes={notes}
                  loading={notesLoading}
                  activeNoteId={editingId}
                  onSelectNote={(id) => switchTo(id)}
                  onShowAll={showAll}
                  showAllActive={view === "notes" && !editing && !reading}
                  onAddNote={openNew}
                  onRemoveNote={removeNote}
                  onArchiveNote={archiveNote}
                  archivedCount={archived.length}
                  onOpenArchive={openArchive}
                  archiveActive={view === "archive" && !editing}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  folders={folders}
                  onMoveNote={moveNote}
                  onMoveNoteToNamespace={moveToNamespace}
                  onMoveFolderToNamespace={moveFolderToNamespace}
                  onCreateFolder={createFolder}
                  onRenameFolder={renameFolder}
                  onRemoveFolder={removeFolder}
                  namespaces={storage.namespaces}
                  activeNamespace={storage.activeNamespace}
                  onSwitchNamespace={switchNamespace}
                  encStatus={encStatus}
                  uploadingIds={uploadingIds}
                />
                <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
                  {editing ? (
                    <Editor
                      key={editing.id}
                      note={editing}
                      editor={editor}
                      folders={folders}
                      onBack={showAll}
                      onMoveFolder={(folderId) =>
                        moveNote(editing.id, folderId)
                      }
                      onChange={(body) => update(editing.id, body)}
                      onTitleChange={(title) => retitle(editing.id, title)}
                      onTitleSettle={sync.releaseSaves}
                      undoScrollSeq={undoScrollSeq}
                      syncSlot={syncSlot}
                      uploading={uploadingIds.has(editing.id)}
                      loading={editingDeferred}
                      canAttach={storage.adapter.capabilities.has(
                        "attachments",
                      )}
                      onAttach={(attachment) => attach(editing.id, attachment)}
                    />
                  ) : reading ? (
                    <ReadOnlyNote
                      key={reading.id}
                      note={reading}
                      editor={editor}
                      onBack={() => setReadingId(null)}
                      onRestore={() => restoreAndEdit(reading.id)}
                      onDelete={() => removeNote(reading.id)}
                      syncSlot={syncSlot}
                    />
                  ) : view === "archive" ? (
                    <ArchiveList
                      notes={archived}
                      onOpen={openRead}
                      onRestore={restoreNote}
                      onDelete={removeNote}
                      onBack={() => setView("notes")}
                      syncSlot={syncSlot}
                    />
                  ) : (
                    <NoteList
                      notes={notes}
                      loading={notesLoading}
                      folders={folders}
                      onOpen={(id) => switchTo(id)}
                      onNew={openNew}
                      onArchive={archiveNote}
                      onDelete={removeNote}
                      onMoveNote={moveNote}
                      onRenameFolder={renameFolder}
                      onRemoveFolder={removeFolder}
                      syncSlot={syncSlot}
                      encStatus={encStatus}
                      uploadingIds={uploadingIds}
                    />
                  )}
                </main>
              </NoteDragProvider>
            </div>

            <SettingsModalHost storage={storage} conversion={encConversion} />
            <NamespacesModalHost storage={storage} />
            <SearchModalHost snapshot={sync.doc} onOpen={switchTo} />
            <ChangelogModalHost />
            <AchievementsModalHost />
            <AchievementsUnlockModalHost />
            <ConflictModal sync={sync} />
            <PullToRefreshIndicator
              state={ptr.state}
              pullDistance={ptr.pullDistance}
            />
            <DropOverlay visible={drop.dragging} />
            <UpdateToast />
          </ModalBusProvider>
        </NavContext.Provider>
      </AttachmentFetchContext.Provider>
    </ReportDragActivityContext.Provider>
  );
}
