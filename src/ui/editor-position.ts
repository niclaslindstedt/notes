// Session-scoped memory of where the caret sat and how far the editor was
// scrolled in each note, so switching away and back lands you exactly where you
// left off — same caret column, same scroll offset — rather than at the top of
// the note with no caret placed.
//
// It is deliberately in-memory only (a plain module-level Map, never
// localStorage): it remembers *where you were looking this session*, transient
// view state that should reset on a fresh load — unlike the persisted note
// document, or the per-namespace [active-note cursor](active-note-preference.ts)
// which does survive a reload. Keyed by note id, which only ever names a note in
// its own namespace's document, so a stale id (a deleted note) simply never
// matches and its entry is harmless.
//
// The caret is a source `(line, column)` — the same `SourcePoint` the
// live-preview editor speaks — so both editors (the contenteditable
// `MarkdownEditor` and the plain `PlainEditor` textarea) share one shape; the
// textarea converts to/from a flat character offset with the pure helpers below.

import type { SourcePoint } from "../domain/line-edit.ts";

export type EditorPosition = {
  /** The caret as a source `(line, column)`, or null when no caret was placed
   *  (the note was only viewed, never edited, this visit) — then only the
   *  scroll offset is restored and the note stays fully formatted. */
  caret: SourcePoint | null;
  /** The editor scroll container's `scrollTop` when we left the note. */
  scrollTop: number;
};

const positions = new Map<string, EditorPosition>();

/** Where the caret / scroll were when this note was last left this session. */
export function getEditorPosition(noteId: string): EditorPosition | null {
  return positions.get(noteId) ?? null;
}

/** Remember the caret / scroll for a note as its editor unmounts. */
export function setEditorPosition(noteId: string, pos: EditorPosition): void {
  positions.set(noteId, pos);
}

/** Drop every remembered position (test-only — the map is session-scoped). */
export function resetEditorPositions(): void {
  positions.clear();
}

/**
 * A flat character offset into `text` as a source `(line, column)`. The line is
 * the count of newlines before the offset; the column is the distance from the
 * start of that line. Pure so it can be unit-tested without a DOM.
 */
export function offsetToPoint(text: string, offset: number): SourcePoint {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const nl = before.lastIndexOf("\n");
  let line = 0;
  for (let i = 0; i < clamped; i++) if (text.charCodeAt(i) === 10) line++;
  return { line, col: clamped - (nl + 1) };
}

/**
 * The inverse of {@link offsetToPoint}: a source `(line, column)` back to a flat
 * character offset into `text`. Line and column are clamped into range so a
 * point saved against a body that has since changed can never point past the
 * end.
 */
export function pointToOffset(text: string, point: SourcePoint): number {
  const lines = text.split("\n");
  const line = Math.max(0, Math.min(point.line, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i]!.length + 1;
  return offset + Math.max(0, Math.min(point.col, lines[line]!.length));
}
