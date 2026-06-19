import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { unlock, useAchievementWatcher } from "../achievements/index.ts";
import { isBlank, noteTitle, notePreview, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { isStandaloneMobile } from "../pwa/standalone.ts";
import { useStorageBackend } from "../storage/useStorageBackend.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import { unlockAchievements, useApplyAppearance } from "../theme/useTheme.ts";
import { TrophyButton } from "../ui/achievements/TrophyButton.tsx";
import { AppTitle } from "../ui/AppTitle.tsx";
import { MarkdownEditor } from "../ui/MarkdownEditor.tsx";
import { ConflictModal } from "../ui/ConflictModal.tsx";
import { useEdgeSwipeOpen } from "../ui/hooks/useEdgeSwipeOpen.ts";
import { useRowSwipe } from "../ui/hooks/useRowSwipe.ts";
import { useUndoRedoShortcuts } from "../ui/hooks/useUndoRedoShortcuts.ts";
import { useViewportHeight } from "../ui/hooks/useViewportHeight.ts";
import { ArchiveIcon, ArrowLeftIcon, TrashIcon } from "../ui/icons.tsx";
import { ModalBusProvider } from "../ui/ModalBusProvider.tsx";
import {
  applyFaviconHref,
  namespaceFaviconHref,
} from "../ui/namespace-favicon.ts";
import { NavContext } from "../ui/nav-context.ts";
import { SideMenu } from "../ui/SideMenu.tsx";
import { SyncIndicator } from "../ui/SyncIndicator.tsx";
import { UnlockGate } from "../ui/UnlockGate.tsx";
import { UpdateToast } from "../ui/UpdateToast.tsx";
import { AchievementsModalHost } from "./modals/AchievementsModalHost.tsx";
import { AchievementsUnlockModalHost } from "./modals/AchievementsUnlockModalHost.tsx";
import { ArchiveModalHost } from "./modals/ArchiveModalHost.tsx";
import { ChangelogModalHost } from "./modals/ChangelogModalHost.tsx";
import { NamespacesModalHost } from "./modals/NamespacesModalHost.tsx";
import { SettingsModalHost } from "./modals/SettingsModalHost.tsx";
import { useNavState } from "./use-nav.ts";
import { useNotes } from "./use-notes.ts";
import { useSettingsSync } from "./use-settings-sync.ts";

// Root component. The shell is a flex row — the side menu (a docked sidebar
// on wide viewports, a drag-out drawer on phones) beside a main area that
// shows either the list of notes or a full-screen editor, switched on
// `editingId` rather than a router so the tree stays a single mounted
// shell. `NavContext` carries the drawer state down to `SideMenu`;
// `ModalBusProvider` lets any button open the settings dialog without
// threading openers through the tree.

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
  const {
    notes,
    allNotes,
    archived,
    create,
    update,
    retitle,
    remove,
    archive,
    restore,
    undo,
    redo,
    canUndo,
    canRedo,
    sync,
  } = useNotes(storage.adapter);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nav = useNavState();

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

  // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z mirror the side-menu undo & redo. The hook
  // stands down while focus is in a text field so the editor's native undo
  // keeps working as you type.
  useUndoRedoShortcuts({ canUndo, canRedo, onUndo: undo, onRedo: redo });

  // Achievements: watch the note document + appearance for derived unlocks and
  // drain the manual-unlock bus, recording each into the synced appearance
  // store. The trophy button in the header surfaces what's been earned.
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
  }

  const editing = editingId
    ? (allNotes.find((n) => n.id === editingId) ?? null)
    : null;

  // Switch what's open in the editor, dropping the note we're leaving if it
  // was never typed into so abandoned "new note" taps don't pile up.
  function switchTo(id: string | null) {
    if (editing && isBlank(editing) && editing.id !== id) remove(editing.id);
    setEditingId(id);
  }

  function openNew() {
    if (editing && isBlank(editing)) remove(editing.id);
    setEditingId(create());
  }

  function removeNote(id: string) {
    remove(id);
    if (id === editingId) setEditingId(null);
  }

  // Archiving a note from the overview leaves the editor too if that note
  // happened to be the one open, so a stale editor never lingers on a note
  // that's no longer in the list.
  function archiveNote(id: string) {
    archive(id);
    if (id === editingId) setEditingId(null);
  }

  // Encryption on, no passphrase held this session — block the app behind the
  // unlock gate so the encrypted notes never render. The gate still wears the
  // user's theme (appearance settings are plaintext).
  if (storage.locked) {
    return <UnlockGate storage={storage} />;
  }

  const syncSlot = <SyncIndicator sync={sync} storage={storage} />;

  return (
    <NavContext.Provider value={nav}>
      <ModalBusProvider>
        <div className="flex h-dvh overflow-hidden">
          <SideMenu
            notes={notes}
            activeNoteId={editingId}
            onSelectNote={(id) => switchTo(id)}
            onAddNote={openNew}
            onRemoveNote={removeNote}
            archivedCount={archived.length}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            namespaces={storage.namespaces}
            activeNamespace={storage.activeNamespace}
            onSwitchNamespace={switchNamespace}
          />
          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            {editing ? (
              <Editor
                key={editing.id}
                note={editing}
                editor={editor}
                onChange={(body) => update(editing.id, body)}
                onTitleChange={(title) => retitle(editing.id, title)}
                onClose={() => switchTo(null)}
                onDelete={() => removeNote(editing.id)}
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
              />
            )}
          </main>
        </div>

        <SettingsModalHost storage={storage} />
        <NamespacesModalHost storage={storage} />
        <ArchiveModalHost
          notes={archived}
          onRestore={restore}
          onRemove={removeNote}
        />
        <ChangelogModalHost />
        <AchievementsModalHost />
        <AchievementsUnlockModalHost />
        <ConflictModal sync={sync} />
        <UpdateToast />
      </ModalBusProvider>
    </NavContext.Provider>
  );
}

function NoteList({
  notes,
  onOpen,
  onNew,
  onArchive,
  onDelete,
  syncSlot,
}: {
  notes: Note[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  syncSlot: ReactNode;
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
        <div className="flex items-center gap-2">
          <TrophyButton />
          {syncSlot}
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-3">
        {notes.length === 0 ? (
          <p className="mt-16 text-center text-muted">{t("app.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <SwipeableNoteCard
                  note={note}
                  onOpen={() => onOpen(note.id)}
                  onArchive={() => onArchive(note.id)}
                  onDelete={() => onDelete(note.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onNew}
        aria-label={t("app.newNote")}
        className="fixed inset-x-0 bottom-0 z-20 mx-auto mb-[max(1rem,env(safe-area-inset-bottom))] flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-accent text-3xl font-light text-page-bg shadow-lg active:scale-95"
      >
        +
      </button>
    </div>
  );
}

function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = notePreview(note);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <p className="truncate font-medium text-fg-bright">{noteTitle(note)}</p>
      {preview && (
        <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
      )}
    </button>
  );
}

// A note card with two swipe outcomes behind a sliding foreground (see
// `useRowSwipe`): swiping right uncovers an Archive backdrop and files the
// note away once past the threshold; swiping left latches a Delete button
// open. Both are recorded on the undo timeline, so a stray swipe is one Undo
// away — which is why delete here needs no confirmation. A plain tap still
// opens the note; the hook swallows the click that trails a real drag.
function SwipeableNoteCard({
  note,
  onOpen,
  onArchive,
  onDelete,
}: {
  note: Note;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const archive = useCallback(() => onArchive(), [onArchive]);
  const swipe = useRowSwipe(archive);

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)]">
      {/* Archive — uncovered by swiping the card right. Hidden unless the
          foreground is sliding right so the archive slide-off never bares it. */}
      <div
        aria-hidden={swipe.offset <= 0}
        className={`absolute inset-0 flex items-center justify-start gap-2 rounded-[var(--radius)] bg-accent/15 pl-4 text-xs font-semibold tracking-wide text-accent uppercase ${
          swipe.offset > 0 ? "" : "invisible"
        }`}
      >
        <ArchiveIcon className="h-4 w-4" />
        {t("app.archive")}
      </div>

      {/* Delete — uncovered by swiping the card left. Kept hidden while the
          card slides right to archive so it's never exposed on slide-off. */}
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
        <NoteCard note={note} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Editor({
  note,
  editor,
  onChange,
  onTitleChange,
  onClose,
  onDelete,
  syncSlot,
}: {
  note: Note;
  editor: EditorSettings;
  onChange: (body: string) => void;
  onTitleChange: (title: string) => void;
  onClose: () => void;
  onDelete: () => void;
  syncSlot: ReactNode;
}) {
  const t = useT();
  const maxWidth = editorMarginMaxWidth(editor.margin);
  // A brand-new note opens with the caret in the title; an existing note keeps
  // the body focused so editing continues where it left off. Captured once for
  // mount — typing the title doesn't re-route focus mid-session.
  const titleFirst = useRef(isBlank(note)).current;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Move focus from the title field into the body's editing surface (its
  // textarea), used when the user presses Enter or Arrow-Down in the title.
  function focusBody() {
    bodyRef.current?.querySelector("textarea")?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          title={t("app.back")}
          aria-label={t("app.back")}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </button>
        <div className="flex items-center gap-2">
          <TrophyButton />
          {syncSlot}
          <button
            type="button"
            onClick={onDelete}
            title={t("app.deleteNote")}
            aria-label={t("app.deleteNote")}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-danger/50 bg-transparent text-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
          >
            <TrashIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <TitleField
        value={note.title}
        onChange={onTitleChange}
        onEnter={focusBody}
        focusOnMount={titleFirst}
        disableSpellcheck={editor.disableSpellcheck}
        disableAutocorrect={editor.disableAutocorrect}
        maxWidth={maxWidth}
      />

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {editor.renderMarkdown ? (
          <MarkdownEditor
            body={note.body}
            onChange={onChange}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={!titleFirst}
          />
        ) : (
          <PlainEditor
            body={note.body}
            onChange={onChange}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={!titleFirst}
          />
        )}
      </div>
    </div>
  );
}

// The note's title: its own single-line input above the body, styled to read
// like the document's top heading (an H1 row) so it looks like part of the
// note rather than a separate form control. It is *not* part of the body, so
// backspacing at the start of the body never reaches it. Enter / Arrow-Down
// hand focus down to the body.
function TitleField({
  value,
  onChange,
  onEnter,
  focusOnMount,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
}: {
  value: string;
  onChange: (title: string) => void;
  onEnter: () => void;
  focusOnMount: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  maxWidth: string;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);

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

  // Focus the title on mount for a fresh note (without the a11y-flagged
  // focusOnMount attribute), placing the caret at the end.
  useEffect(() => {
    if (!focusOnMount) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusOnMount]);

  // Flush the buffered title when the editor unmounts — the Back button and
  // switching notes both tear it down, and on those paths a blur doesn't
  // reliably fire first.
  useEffect(() => flush, [flush]);

  return (
    <div
      className="w-full px-4 pt-4"
      style={maxWidth === "none" ? undefined : { maxWidth, margin: "0 auto" }}
    >
      <input
        ref={ref}
        type="text"
        value={draft}
        spellCheck={!disableSpellcheck}
        autoCorrect={disableAutocorrect ? "off" : "on"}
        autoCapitalize={disableAutocorrect ? "off" : "sentences"}
        placeholder={t("app.titlePlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-full appearance-none border-0 bg-transparent p-0 font-[inherit] text-2xl font-bold text-fg-bright outline-none placeholder:font-bold placeholder:text-muted/60"
      />
    </div>
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
