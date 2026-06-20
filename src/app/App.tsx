import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { unlock, useAchievementWatcher } from "../achievements/index.ts";
import { useDevSeed } from "../dev/useDevSeed.ts";
import {
  type Attachment,
  hiddenAttachmentLines,
} from "../domain/attachment.ts";
import { classifyLines } from "../domain/markdown.ts";
import {
  defaultNoteTitle,
  isBlank,
  noteTitle,
  notePreview,
  notePreviewBlock,
  type Note,
  type SaveFormatting,
} from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { isStandaloneMobile } from "../pwa/standalone.ts";
import { createDevSeedAdapter } from "../storage/dev-seed/index.ts";
import { useStorageBackend } from "../storage/useStorageBackend.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import {
  unlockAchievements,
  useAppearance,
  useApplyAppearance,
} from "../theme/useTheme.ts";
import { AppTitle } from "../ui/AppTitle.tsx";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../ui/MarkdownEditor.tsx";
import { ConflictModal } from "../ui/ConflictModal.tsx";
import { DropOverlay } from "../ui/DropOverlay.tsx";
import { useEdgeSwipeOpen } from "../ui/hooks/useEdgeSwipeOpen.ts";
import { useFileDrop } from "../ui/hooks/useFileDrop.ts";
import { useMediaQuery } from "../ui/hooks/useMediaQuery.ts";
import { usePullToRefresh } from "../ui/hooks/usePullToRefresh.ts";
import { useRowSwipe } from "../ui/hooks/useRowSwipe.ts";
import { useSuppressSwipeNavigation } from "../ui/hooks/useSuppressSwipeNavigation.ts";
import { useUndoRedoShortcuts } from "../ui/hooks/useUndoRedoShortcuts.ts";
import { useViewportHeight } from "../ui/hooks/useViewportHeight.ts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  LockIcon,
  NotesMarkIcon,
  RestoreIcon,
  SpinnerIcon,
  TrashIcon,
} from "../ui/icons.tsx";
import { CopyNoteButton } from "../ui/CopyNoteButton.tsx";
import { RowActionMenu } from "../ui/RowActionMenu.tsx";
import { RenderedLine } from "../ui/MarkdownLine.tsx";
import { AttachmentsEndBlock } from "../ui/attachments/AttachmentsEndBlock.tsx";
import { AttachmentsProvider } from "../ui/attachments/AttachmentsProvider.tsx";
import { AttachmentFetchContext } from "../ui/attachments/fetch-context.ts";
import { ModalBusProvider } from "../ui/ModalBusProvider.tsx";
import {
  applyFaviconHref,
  namespaceFaviconHref,
} from "../ui/namespace-favicon.ts";
import { NavContext, useNav } from "../ui/nav-context.ts";
import { APP_VIEWPORT_RECT } from "../ui/appViewportRect.ts";
import { SideMenu } from "../ui/SideMenu.tsx";
import { PullToRefreshIndicator } from "../ui/PullToRefreshIndicator.tsx";
import { SyncIndicator } from "../ui/SyncIndicator.tsx";
import { UnlockGate } from "../ui/UnlockGate.tsx";
import { UpdateToast } from "../ui/UpdateToast.tsx";
import { AchievementsModalHost } from "./modals/AchievementsModalHost.tsx";
import { AchievementsUnlockModalHost } from "./modals/AchievementsUnlockModalHost.tsx";
import { ChangelogModalHost } from "./modals/ChangelogModalHost.tsx";
import { NamespacesModalHost } from "./modals/NamespacesModalHost.tsx";
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
  const {
    notes,
    allNotes,
    archived,
    create,
    importFiles,
    update,
    attach,
    retitle,
    remove,
    archive,
    restore,
    undo,
    redo,
    canUndo,
    canRedo,
    sync,
  } = useNotes(seedAdapter ?? storage.adapter, formatting);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which list the main area shows when nothing is open in the editor / reader.
  const [view, setView] = useState<"notes" | "archive">("notes");
  // An archived note opened read-only (tapped from the archive page). Distinct
  // from `editingId` so the editor stays the editable surface and the reader
  // the read-only one.
  const [readingId, setReadingId] = useState<string | null>(null);
  const nav = useNavState();

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
      notes: sync.doc.notes,
      getStatus: storage.getEncryptionStatus,
      migrateNote: storage.migrateNote,
      demigrateNote: storage.demigrateNote,
      splitLegacyBlob: storage.splitLegacyBlob,
      onDisableComplete: storage.finishDisableEncryption,
    });

  // Per-note upload progress for the sync spinner: the ids of notes whose file
  // is being pushed to the backend right now. Empty on the local backend, which
  // has no per-note upload to watch.
  const uploadingIds = useUploadStatus(storage.adapter);

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

  // Switch namespace and leave the editor — the note that was open belongs to
  // the namespace we're leaving, so the new namespace's list is what should
  // show.
  function switchNamespace(slug: string) {
    storage.switchNamespace(slug);
    setEditingId(null);
    setReadingId(null);
    setView("notes");
  }

  const editing = editingId
    ? (allNotes.find((n) => n.id === editingId) ?? null)
    : null;
  const reading = readingId
    ? (allNotes.find((n) => n.id === readingId) ?? null)
    : null;

  // A note the user never committed to — empty body and either no title or the
  // still-untouched auto-assigned default — is dropped when we leave it, so
  // abandoned "new note" taps (and their throwaway default titles) don't pile
  // up. The default-title scheme means a fresh note is no longer simply blank,
  // so we remember the title it was born with to tell "never touched" apart
  // from "deliberately named".
  const pristineNew = useRef<{ id: string; title: string } | null>(null);

  function discardable(note: Note): boolean {
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
        !editing && !reading && !nav.open && storage.backend !== "browser",
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

  function openNew() {
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
    const id = create(title);
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
    return <UnlockGate storage={storage} />;
  }

  const syncSlot = <SyncIndicator sync={sync} storage={storage} />;

  return (
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
          <div className="fixed flex overflow-hidden" style={APP_VIEWPORT_RECT}>
            <SideMenu
              notes={notes}
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
                  onChange={(body) => update(editing.id, body)}
                  onTitleChange={(title) => retitle(editing.id, title)}
                  onTitleSettle={sync.releaseSaves}
                  syncSlot={syncSlot}
                  uploading={uploadingIds.has(editing.id)}
                  canAttach={storage.adapter.capabilities.has("attachments")}
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
                  onOpen={(id) => switchTo(id)}
                  onNew={openNew}
                  onArchive={archiveNote}
                  onDelete={removeNote}
                  syncSlot={syncSlot}
                  encStatus={encStatus}
                  uploadingIds={uploadingIds}
                />
              )}
            </main>
          </div>

          <SettingsModalHost storage={storage} conversion={encConversion} />
          <NamespacesModalHost storage={storage} />
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
  );
}

function NoteList({
  notes,
  onOpen,
  onNew,
  onArchive,
  onDelete,
  syncSlot,
  encStatus,
  uploadingIds,
}: {
  notes: Note[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  syncSlot: ReactNode;
  encStatus?: Map<string, "encrypted" | "pending">;
  /** Ids of notes whose file is being uploaded to the backend right now. */
  uploadingIds?: ReadonlySet<string>;
}) {
  const t = useT();
  // With no notes yet, pressing Enter (a physical keyboard, so desktop) starts
  // the first note — the empty state's primary action without a tap.
  const empty = notes.length === 0;
  useEffect(() => {
    if (!empty) return;
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
  }, [empty, onNew]);

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <AppTitle />
        <div className="flex items-center gap-2">{syncSlot}</div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pt-3 pb-24 md:pb-3">
        {notes.length === 0 ? (
          <p className="mt-16 text-center text-muted">{t("app.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
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
              </li>
            ))}
          </ul>
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
        onClick={onNew}
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

function NoteCard({
  note,
  onOpen,
  encrypted = false,
  uploading = false,
}: {
  note: Note;
  onOpen: () => void;
  /** Show the green lock — the note + all its attachments are encrypted at rest. */
  encrypted?: boolean;
  /** Show the sync spinner — the note's file is being uploaded right now. */
  uploading?: boolean;
}) {
  const t = useT();
  // The overview's two looks (Settings → Appearance → Note list): `cards` is
  // the roomier, multi-line treatment; `rows` is the compact one-line list.
  const cards = useAppearance().listLayout === "cards";
  const preview = cards ? notePreviewBlock(note) : notePreview(note);
  // Only fade the tail when there's plausibly more text below the clamp — a
  // short note shouldn't have its one line dimmed. A cheap content heuristic
  // (line count or length) stands in for measuring the clamped overflow.
  const fade =
    cards && (preview.length > 180 || preview.split("\n").length > 5);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-[var(--radius)] border border-line bg-surface text-left transition-colors hover:bg-surface-2 ${
        cards ? "px-4 py-3.5" : "px-4 py-3"
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
          encrypted && (
            <>
              <LockIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="sr-only">{t("app.encryptedNote")}</span>
            </>
          )
        )}
      </p>
      {preview &&
        (cards ? (
          <p
            className="mt-1.5 max-h-[8.5rem] overflow-hidden text-sm leading-relaxed whitespace-pre-line text-muted"
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
function SwipeableNoteCard({
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
  /** Show the green lock — the note is encrypted at rest. */
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

// The archive page — the notes overview filtered to archived notes. A real
// view (not a modal) so the side menu's edge-swipe-to-open still works over
// it. Mirrors the overview's swipeable cards, but swipe-right restores instead
// of archives, and there's no "new note" button. Tapping a card opens the note
// read-only (see `ReadOnlyNote`). A back button returns to the overview.
function ArchiveList({
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
function ReadOnlyNote({
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
  // Respect the Markdown-rendering preference: formatted lines when on, the
  // raw source otherwise — matching how the same note reads in the editor.
  const blocks = editor.renderMarkdown ? classifyLines(note.body) : null;
  const placement = {
    imagesAtEnd: editor.imagesAtEnd,
    filesAtEnd: editor.filesAtEnd,
  };
  // Lines whose attachment renders in the collected end block instead.
  const hidden = blocks
    ? hiddenAttachmentLines(note.body, placement)
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

function Editor({
  note,
  editor,
  onChange,
  onTitleChange,
  onTitleSettle,
  syncSlot,
  uploading = false,
  canAttach,
  onAttach,
}: {
  note: Note;
  editor: EditorSettings;
  onChange: (body: string) => void;
  onTitleChange: (title: string) => void;
  onTitleSettle: () => void;
  syncSlot: ReactNode;
  /** The open note's file is being uploaded — swap the glyph for a spinner. */
  uploading?: boolean;
  canAttach: boolean;
  onAttach: (attachment: Attachment) => void;
}) {
  const t = useT();
  const nav = useNav();
  const maxWidth = editorMarginMaxWidth(editor.margin);
  // A brand-new note opens with the caret in the title so it's ready to be
  // named; opening an existing note focuses nothing, so the soft keyboard
  // stays down until the user taps where they want to type. Captured once for
  // mount — typing the title doesn't re-route focus mid-session.
  const titleFirst = useRef(isBlank(note)).current;
  const bodyRef = useRef<HTMLDivElement>(null);
  // Handle on the live-preview editor so the title can hand focus down into the
  // body even when no line is active yet (the body has no textarea until then).
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  // The header centres a single-line title against the glyph and the copy/sync
  // buttons, and top-aligns once the title wraps so those stay pinned to the
  // first line (the title field reports the transition as it grows).
  const [titleMultiline, setTitleMultiline] = useState(false);

  // Move focus from the title field into the body's editing surface, used when
  // the user presses Enter or Arrow-Down in the title. The live-preview editor
  // opens with no active line (so the note renders fully formatted), so there
  // may be no textarea to focus yet — ask the editor to open one at the end via
  // its handle. The plain editor always has a textarea, so fall back to that.
  function focusBody() {
    const ta = bodyRef.current?.querySelector("textarea");
    if (ta) {
      ta.focus();
      return;
    }
    markdownEditorRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The title heads the page, prefixed by the app glyph — the editable
          document title, the way checklist heads each list with its name and
          icon. Pressing the glyph opens the side menu, so it doubles as the
          page's menu button; there is no Back button — the menu's "Show all"
          returns to the overview. The glyph box matches the title's first-line
          height (leading-tight on text-lg) and centres the icon within it, so
          the two stay vertically aligned even when a long title wraps and the
          header top-aligns the rest. A single-line title centres the whole row;
          once it wraps the header top-aligns so the glyph and the copy/sync
          buttons stay pinned to the first line. */}
      <header
        className={`sticky top-0 z-10 flex gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))] ${titleMultiline ? "items-start" : "items-center"}`}
      >
        <button
          type="button"
          onClick={nav.toggle}
          aria-label={t("nav.open")}
          className="flex h-[1.40625rem] shrink-0 cursor-pointer items-center text-accent outline-none"
        >
          {/* While the open note is being written to the backend, the brand
              glyph becomes a spinner so the note you're editing shows its own
              sync state (the header cloud glyph means "any sync", this one
              means "this note"). The button still opens the menu. */}
          {uploading ? (
            <SpinnerIcon className="h-6 w-6 animate-spin text-muted" />
          ) : (
            <NotesMarkIcon className="h-6 w-6" />
          )}
        </button>
        <TitleField
          value={note.title}
          onChange={onTitleChange}
          onSettle={onTitleSettle}
          onEnter={focusBody}
          focusOnMount={titleFirst}
          onMultilineChange={setTitleMultiline}
          disableSpellcheck={editor.disableSpellcheck}
          disableAutocorrect={editor.disableAutocorrect}
        />
        <div className="flex shrink-0 items-center gap-2">
          <CopyNoteButton note={note} copyScope={editor.copyScope} />
          {syncSlot}
        </div>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {editor.renderMarkdown ? (
          <MarkdownEditor
            ref={markdownEditorRef}
            body={note.body}
            onChange={onChange}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={false}
            note={note}
            attachments={note.attachments}
            canAttach={canAttach}
            onAttach={onAttach}
            placement={{
              imagesAtEnd: editor.imagesAtEnd,
              filesAtEnd: editor.filesAtEnd,
            }}
            shortenLinkChars={editor.shortenLinkChars}
          />
        ) : (
          <PlainEditor
            body={note.body}
            onChange={onChange}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={false}
          />
        )}
      </div>
    </div>
  );
}

// The note's title: an auto-growing textarea that heads the editor page,
// sitting inline in the header beside the app glyph so it reads like the
// document's own title (the way checklist heads a list with its name). A long
// title wraps onto further lines and the field grows to fit rather than
// scrolling out of view; a single-line title is centred against the glyph and
// the copy/sync buttons, and once it wraps the header top-aligns so those stay
// pinned to the first line (the field reports the transition via
// onMultilineChange). It is *not* part of the body, so
// backspacing at the start of the body never reaches it. Enter / Arrow-Down
// hand focus down to the body (and so the field never holds a literal newline).
function TitleField({
  value,
  onChange,
  onSettle,
  onEnter,
  focusOnMount,
  onMultilineChange,
  disableSpellcheck,
  disableAutocorrect,
}: {
  value: string;
  onChange: (title: string) => void;
  onSettle: () => void;
  onEnter: () => void;
  focusOnMount: boolean;
  onMultilineChange: (multiline: boolean) => void;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);

  // The title is a textarea, not an input, so a long title wraps onto further
  // lines instead of scrolling out of view. It carries no manual resize grip;
  // we grow it to fit its content after every change — collapse to one row,
  // then stretch to the wrapped height — so it reads as a borderless heading
  // that simply gets taller. Enter is still intercepted to hand focus to the
  // body (see onKeyDown), so the field never actually holds a newline.
  const onMultilineRef = useRef(onMultilineChange);
  onMultilineRef.current = onMultilineChange;
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const { scrollHeight } = el;
    el.style.height = `${scrollHeight}px`;
    // Tell the header whether the title now spans more than one line so it can
    // switch from centring the row to top-aligning it. p-0 means scrollHeight is
    // pure line height, so anything past ~1.5 lines is a genuine wrap.
    const lineHeight =
      parseFloat(getComputedStyle(el).lineHeight) || scrollHeight;
    onMultilineRef.current(scrollHeight > lineHeight * 1.5);
  }, []);
  useLayoutEffect(resize, [draft, resize]);

  // Title edits are buffered locally and only pushed upward — which schedules a
  // save and, on the file/cloud backends, *renames* the note's file (the
  // filename is a slug of the title) — when the field loses focus or the editor
  // closes. Pushing on every keystroke renamed the file once per character, and
  // a mid-rename network blip left the directory half-written, which the sync
  // layer then read back as a remote edit and surfaced as a phantom conflict.
  // One rename per editing session keeps the file churn (and the conflicts) away
  // without changing that the filename still tracks the title.
  const committed = useRef(value);
  const latest = useRef(draft);
  latest.current = draft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flush = useCallback(() => {
    if (latest.current === committed.current) return;
    committed.current = latest.current;
    onChangeRef.current(latest.current);
  }, []);

  // The title settling — losing focus, or the editor tearing down — both
  // commits the buffered title *and* signals that it's now safe to write the
  // file (the save was held while the title was in flux so a fresh note's file
  // is born with the right name). Flush first so the committed title is in the
  // document before the held save drains.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const settle = useCallback(() => {
    flush();
    onSettleRef.current();
  }, [flush]);

  // Focus the title on mount for a fresh note (without the a11y-flagged
  // focusOnMount attribute) and select its default title, so the first
  // keystroke replaces it — a new note opens ready to be named.
  useEffect(() => {
    if (!focusOnMount) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusOnMount]);

  // Clicking (or tabbing) into the title selects the whole thing, so it can be
  // renamed by just typing — no manual drag-select or erase first. The browser
  // otherwise collapses the focus-time selection to the caret on the click's
  // mouseup, so we suppress that one mouseup (only the click that *gained*
  // focus, leaving later clicks free to reposition the caret as usual). A fresh
  // note's mount-focus selects the default title the same way, so it opens
  // ready to be typed over.
  const focusingClick = useRef(false);

  // Settle the buffered title when the editor unmounts — the Back button and
  // switching notes both tear it down, and on those paths a blur doesn't
  // reliably fire first.
  useEffect(() => settle, [settle]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      spellCheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={disableAutocorrect ? "off" : "sentences"}
      placeholder={t("app.titlePlaceholder")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={settle}
      onMouseDown={(e) => {
        if (document.activeElement !== e.currentTarget)
          focusingClick.current = true;
      }}
      onFocus={(e) => e.currentTarget.select()}
      onMouseUp={(e) => {
        if (focusingClick.current) {
          e.preventDefault();
          focusingClick.current = false;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="min-w-0 flex-1 resize-none appearance-none overflow-hidden border-0 bg-transparent p-0 font-[inherit] text-lg font-bold leading-tight text-fg-bright outline-none placeholder:font-bold placeholder:text-muted/60"
    />
  );
}

// The Markdown-off fallback: a single full-height textarea. Still honours the
// margin (writing-column width) and word-wrap preferences.
function PlainEditor({
  body,
  onChange,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
  focusOnMount = true,
}: {
  body: string;
  onChange: (body: string) => void;
  wordWrap: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  maxWidth: string;
  focusOnMount?: boolean;
}) {
  const t = useT();
  const [value, setValue] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open. Our own keystrokes echo back through `onChange` to the
  // same string, so a `body` that differs from the local value can only be
  // another writer's edit arriving during the live-pull quiet window.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (body !== valueRef.current) setValue(body);
  }, [body]);

  // Focus the editor on open without the focusOnMount prop (which a11y
  // linting flags) — placing the caret at the end so editing an existing
  // note continues where it left off. Skipped when the title field takes
  // focus instead (a brand-new note).
  useEffect(() => {
    if (!focusOnMount) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusOnMount]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      wrap={wordWrap ? "soft" : "off"}
      spellCheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={disableAutocorrect ? "off" : "sentences"}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      placeholder={t("app.startWriting")}
      style={maxWidth === "none" ? undefined : { maxWidth }}
      className={`mx-auto w-full flex-1 resize-none bg-page-bg px-4 py-4 text-fg outline-none placeholder:text-muted/60 ${
        wordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
      }`}
    />
  );
}
