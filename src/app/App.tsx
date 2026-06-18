import { useEffect, useRef, useState, type ReactNode } from "react";

import { BUILD_LABEL } from "../build-env.ts";
import { isBlank, noteTitle, notePreview, type Note } from "../domain/note.ts";
import { useStorageBackend } from "../storage/useStorageBackend.ts";
import {
  FAMILY_DEFAULT_THEME,
  FAMILY_LABELS,
  themeFamily,
  type ThemePreset,
} from "../theme/themes.ts";
import { setTheme, useApplyAppearance } from "../theme/useTheme.ts";
import { ConflictModal } from "../ui/ConflictModal.tsx";
import { ModalBusProvider } from "../ui/ModalBusProvider.tsx";
import { NavContext } from "../ui/nav-context.ts";
import { SideMenu } from "../ui/SideMenu.tsx";
import { SyncIndicator } from "../ui/SyncIndicator.tsx";
import { UnlockGate } from "../ui/UnlockGate.tsx";
import { UpdateToast } from "../ui/UpdateToast.tsx";
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

// The header button is a quick three-way toggle over the broad families;
// the full preset / variant / custom picker lives in Settings → Appearance.
// Cycling jumps to each family's default preset, so it stays well-defined
// even when the active theme is a variant (e.g. Dracula) or Custom.
const QUICK_CYCLE = ["dark", "light", "system"] as const;

function nextQuickTheme(theme: ThemePreset): ThemePreset {
  const family = themeFamily(theme);
  const idx = QUICK_CYCLE.indexOf(family as (typeof QUICK_CYCLE)[number]);
  const next = QUICK_CYCLE[(idx + 1) % QUICK_CYCLE.length] ?? "dark";
  return FAMILY_DEFAULT_THEME[next];
}

export function App() {
  const { theme } = useApplyAppearance();
  // The active storage backend (this device / a local folder / a cloud) and
  // its sync engine. Appearance settings reconcile against the same backend
  // so they travel with a synced folder too.
  const storage = useStorageBackend();
  useSettingsSync(storage.settingsStore);
  const { notes, allNotes, create, update, remove, sync } = useNotes(
    storage.adapter,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const nav = useNavState();

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
          />
          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            {editing ? (
              <Editor
                key={editing.id}
                note={editing}
                onChange={(body) => update(editing.id, body)}
                onClose={() => switchTo(null)}
                onDelete={() => removeNote(editing.id)}
                syncSlot={syncSlot}
              />
            ) : (
              <NoteList
                notes={notes}
                theme={theme}
                onOpen={(id) => switchTo(id)}
                onNew={openNew}
                syncSlot={syncSlot}
              />
            )}
          </main>
        </div>

        <SettingsModalHost storage={storage} />
        <ConflictModal sync={sync} />
        <UpdateToast />
      </ModalBusProvider>
    </NavContext.Provider>
  );
}

function NoteList({
  notes,
  theme,
  onOpen,
  onNew,
  syncSlot,
}: {
  notes: Note[];
  theme: ThemePreset;
  onOpen: (id: string) => void;
  onNew: () => void;
  syncSlot: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-bold text-fg-bright">Notes</h1>
        <div className="flex items-center gap-2">
          {syncSlot}
          <button
            type="button"
            onClick={() => setTheme(nextQuickTheme(theme))}
            className="rounded-[var(--radius)] border border-line px-2 py-1 text-xs text-muted hover:text-fg"
            title="Switch theme"
          >
            {FAMILY_LABELS[themeFamily(theme)]}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-3">
        {notes.length === 0 ? (
          <p className="mt-16 text-center text-muted">
            No notes yet. Tap <span className="text-accent">+</span> to write
            your first one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <NoteCard note={note} onOpen={() => onOpen(note.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="px-4 pb-2 text-center text-[10px] text-muted/70">
        {BUILD_LABEL}
      </footer>

      <button
        type="button"
        onClick={onNew}
        aria-label="New note"
        className="fixed bottom-0 right-0 z-20 m-[max(1rem,env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-3xl font-light text-page-bg shadow-lg active:scale-95"
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

function Editor({
  note,
  onChange,
  onClose,
  onDelete,
  syncSlot,
}: {
  note: Note;
  onChange: (body: string) => void;
  onClose: () => void;
  onDelete: () => void;
  syncSlot: ReactNode;
}) {
  const [body, setBody] = useState(note.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the editor on open without the autoFocus prop (which a11y
  // linting flags) — placing the caret at the end so editing an existing
  // note continues where it left off.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius)] px-2 py-1 text-sm text-accent hover:text-fg-bright"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          {syncSlot}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-[var(--radius)] px-2 py-1 text-sm text-danger hover:opacity-80"
          >
            Delete
          </button>
        </div>
      </header>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="Start writing…"
        className="mx-auto w-full max-w-2xl flex-1 resize-none bg-page-bg px-4 py-4 text-fg outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
