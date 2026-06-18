// Local-first persistence: the notes live in `localStorage` under a single
// versioned key, serialized as JSON. This is the only place that touches
// `localStorage`, so swapping in IndexedDB or a synced backend later is a
// matter of implementing the same load/save pair behind it.
//
// The shape is validated defensively on read — a corrupt or
// foreign-version blob yields an empty list rather than throwing, so the
// app always boots.

import type { Note } from "../domain/note.ts";

const STORAGE_KEY = "notes/v1";

type Persisted = {
  version: 1;
  notes: Note[];
};

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.body === "string" &&
    typeof n.createdAt === "number" &&
    typeof n.updatedAt === "number"
  );
}

/** Read the persisted notes, or an empty array if nothing valid is stored. */
export function loadNotes(): Note[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (
      data &&
      typeof data === "object" &&
      (data as Persisted).version === 1 &&
      Array.isArray((data as Persisted).notes)
    ) {
      return (data as Persisted).notes.filter(isNote);
    }
  } catch {
    // Corrupt blob — fall through to an empty list rather than crash.
  }
  return [];
}

/** Persist the full note list, overwriting the previous snapshot. */
export function saveNotes(notes: readonly Note[]): void {
  if (typeof localStorage === "undefined") return;
  const payload: Persisted = { version: 1, notes: [...notes] };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled (private mode) — the app keeps
    // working from in-memory state; nothing else we can do here.
  }
}
