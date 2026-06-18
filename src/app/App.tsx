import { useEffect, useRef, useState } from "react";

import { BUILD_LABEL } from "../build-env.ts";
import { isBlank, noteTitle, notePreview, type Note } from "../domain/note.ts";
import { setTheme, useTheme, type ThemePreset } from "../theme/useTheme.ts";
import { UpdateToast } from "../ui/UpdateToast.tsx";
import { useNotes } from "./use-notes.ts";

// Root component. Two views — a list of notes and a full-screen editor —
// switched on `editingId` rather than a router, keeping the shell a single
// mounted tree (the simplest thing that reads well on a phone). The chrome
// here is deliberately minimal; richer surfaces (side menu, settings
// modal, sync status) are what the `copy-feature` skill brings over from
// checklist.

const THEME_ORDER: Record<ThemePreset, ThemePreset> = {
  dark: "light",
  light: "system",
  system: "dark",
};

const THEME_LABEL: Record<ThemePreset, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

export function App() {
  const theme = useTheme();
  const { notes, allNotes, create, update, remove } = useNotes();
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId
    ? (allNotes.find((n) => n.id === editingId) ?? null)
    : null;

  function openNew() {
    setEditingId(create());
  }

  function closeEditor() {
    // Drop a note left blank so abandoned "new note" taps don't pile up.
    if (editing && isBlank(editing)) remove(editing.id);
    setEditingId(null);
  }

  if (editing) {
    return (
      <Editor
        key={editing.id}
        note={editing}
        onChange={(body) => update(editing.id, body)}
        onClose={closeEditor}
        onDelete={() => {
          remove(editing.id);
          setEditingId(null);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-bold text-fg-bright">Notes</h1>
        <button
          type="button"
          onClick={() => setTheme(THEME_ORDER[theme])}
          className="rounded-[var(--radius)] border border-line px-2 py-1 text-xs text-muted hover:text-fg"
          title="Switch theme"
        >
          {THEME_LABEL[theme]}
        </button>
      </header>

      <main className="flex-1 px-4 py-3">
        {notes.length === 0 ? (
          <p className="mt-16 text-center text-muted">
            No notes yet. Tap <span className="text-accent">+</span> to write
            your first one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <NoteCard note={note} onOpen={() => setEditingId(note.id)} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="px-4 pb-2 text-center text-[10px] text-muted/70">
        {BUILD_LABEL}
      </footer>

      <button
        type="button"
        onClick={openNew}
        aria-label="New note"
        className="fixed bottom-0 right-0 z-20 m-[max(1rem,env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-3xl font-light text-page-bg shadow-lg active:scale-95"
      >
        +
      </button>

      <UpdateToast />
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
}: {
  note: Note;
  onChange: (body: string) => void;
  onClose: () => void;
  onDelete: () => void;
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
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius)] px-2 py-1 text-sm text-accent hover:text-fg-bright"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-[var(--radius)] px-2 py-1 text-sm text-danger hover:opacity-80"
        >
          Delete
        </button>
      </header>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="Start writing…"
        className="flex-1 resize-none bg-page-bg px-4 py-4 text-fg outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
