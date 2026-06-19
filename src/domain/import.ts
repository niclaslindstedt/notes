// Importing external markdown files into the note model: pure transforms, no
// DOM and no I/O (the file reading lives in the UI drop hook). Kept in
// `domain/` because turning a (filename, text) pair into a `Note` is a pure
// operation over the model — the same logic the future React Native app's
// "open file" path can reuse.

import { createNote, type Note } from "./note.ts";

// Markdown (and plain-text) extensions a dropped file may carry. The drop
// hook filters incoming files against this list so only text the app can read
// as a note is imported; everything else is ignored.
export const IMPORTABLE_EXTENSIONS: readonly string[] = [
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".mdtext",
  ".txt",
];

/** True when `name` ends in one of the importable markdown/text extensions. */
export function isImportableFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// The note title derived from a dropped file's name: drop any directory path
// (a folder drop reports `subdir/file.md`) and a single trailing markdown/text
// extension, leaving the bare stem. "Meeting Notes.md" → "Meeting Notes".
export function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  return base.replace(/\.[^.]+$/, "").trim();
}

// Turn a dropped file into a fresh note: its filename (sans extension) becomes
// the title and the file's contents become the body, stamped at `now`. The
// body is taken verbatim apart from normalising CRLF line endings and trimming
// trailing blank lines, so what was on disk is what the editor opens.
export function importedNote(
  name: string,
  text: string,
  now: number = Date.now(),
): Note {
  return {
    ...createNote(now),
    title: titleFromFilename(name),
    body: text.replace(/\r\n/g, "\n").replace(/\n+$/, ""),
  };
}
