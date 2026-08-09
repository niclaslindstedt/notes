// Sentence shape in a body of text: where one ends (the granularity the undo
// timeline breaks a continuous typing burst into) and how one is ended (the
// double-space-to-period shortcut the editor applies as you type).
//
// --- Sentence boundaries ----------------------------------------------------
//
// A note's body is edited one keystroke at a time, so the undo timeline
// coalesces a run of edits sharing a merge key into a single step (see
// `use-undo-redo.ts`). Suffixing that key with the number of *completed*
// sentences turns "one note = one undo step" into "one sentence = one undo
// step": while the caret is inside the sentence being typed the count holds
// steady and the keystrokes coalesce, and the moment a sentence is finished
// the count ticks up, the key changes, and the finished sentence locks in as
// its own checkpoint. Undo then walks a long paragraph back sentence by
// sentence rather than deleting the whole thing at once.
//
// A boundary is a run of sentence-ending punctuation (`.`, `!`, `?`, `…`),
// allowing trailing closing quotes/brackets, that is *followed by
// whitespace*. Requiring the trailing whitespace is deliberate: it keeps the
// terminator of the last, still-being-typed sentence attached to its own
// step (no checkpoint until you move past it with a space or newline), and it
// means a `.` inside a path or number — `attachments/a.png`, `3.5` — never
// counts, since it isn't followed by whitespace. Abbreviations like "e.g. "
// do count; that only ever splits an undo step one word early, which is
// harmless.
const SENTENCE_BOUNDARY = /[.!?…]+["'”’)\]]*\s/gu;

// The live-preview editor keeps a trailing empty line, so a note's body reaches
// us as `"This?\n"` while you're still typing the last sentence. That trailing
// newline is whitespace, so without stripping it the final terminator would
// match the boundary rule the instant you type it — the last, in-progress
// sentence would checkpoint a keystroke early and undo would peel just its
// terminator off (`This?` → `This`). Trailing newlines are the editor's
// structural padding, not the user moving past the sentence, so drop them
// before counting. A trailing *space* is left intact: that one the user typed
// to start the next sentence, and it should still lock the checkpoint.
const TRAILING_NEWLINES = /\n+$/u;

/** How many completed sentences `text` contains (see the boundary rule above). */
export function sentenceBoundaryCount(text: string): number {
  const matches = text.replace(TRAILING_NEWLINES, "").match(SENTENCE_BOUNDARY);
  return matches ? matches.length : 0;
}

// --- Ending a sentence with two spaces --------------------------------------

// What must sit in front of the space for a second space to end a sentence: a
// letter, a digit, or a closing quote / bracket — the tail of a word. Anything
// else leaves the two spaces exactly as typed, which is what keeps the two
// habits that look like this from growing a stray dot: double-spacing *after* a
// full stop (`Done.  ` — the character before the space is `.`) and lining
// something up with a run of spaces (the character before is another space).
const SENTENCE_TAIL = /[\p{L}\p{N}"'”’)\]]/u;

/**
 * The rewrite a space typed at column `col` of `line` should turn into, or
 * `null` when it is an ordinary space.
 *
 * Tapping space twice at the end of a word ends the sentence: the first space
 * is replaced by `". "`, so `Hello ` + space reads `Hello. ` with the caret
 * still at the end and the next sentence ready to type. This is the shortcut
 * iOS and macOS apply inside any ordinary text field — the live-preview editor
 * intercepts every insertion and applies it to the source itself
 * (`MarkdownEditor.tsx`), which takes the keystroke out of the reach of the
 * platform's own substitution, so the editor owns the rule instead. Doing it
 * here rather than leaning on the OS also means it reads the same on a desktop
 * browser and on Android, where the shortcut is a keyboard's option rather
 * than the system's.
 *
 * `from` is the column the replacement starts at (the space being consumed);
 * the caller splices `[from, col)` out for `text`.
 */
export function doubleSpacePeriod(
  line: string,
  col: number,
): { from: number; text: string } | null {
  // Needs a space to consume and a word character in front of it, so a space
  // at (or one past) the start of the line is always just a space.
  if (col < 2) return null;
  if (line[col - 1] !== " ") return null;
  if (!SENTENCE_TAIL.test(line[col - 2] ?? "")) return null;
  return { from: col - 1, text: ". " };
}
