// Sentence shape in a body of text: where one ends (the granularity the undo
// timeline breaks a continuous typing burst into), how one is ended (the
// double-space-to-period shortcut the editor applies as you type), and how one
// starts (the capital the editor writes for the first letter of a sentence).
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

// --- Starting a sentence with a capital -------------------------------------

// What may sit in front of the caret for it to still count as the *start* of a
// line: indentation, quote and heading markers, a bullet or numbered list
// marker, and a checkbox — the markup that opens a row rather than text written
// on it. So `- ` and `> ## ` and `1. [ ] ` are all sentence starts, while a
// half-typed `*` (an emphasis run, not a bullet — it has no space after it) is
// not. Written as a flat sequence rather than a repeated alternation so it
// matches in one pass.
const LINE_LEAD = /^[\s>#]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?$/u;

// What may sit in front of the caret for it to count as the start of the *next*
// sentence on a line already being written: a run of sentence-ending
// punctuation (the same terminators `SENTENCE_BOUNDARY` counts), any closing
// quotes or brackets, and then the space that moved past it. Requiring that
// trailing space is what keeps a decimal (`3.5`) and a filename (`a.png`) —
// where the letter follows the dot immediately — from being read as a new
// sentence. An abbreviation (`e.g. `) is read as one; that is the same
// harmless over-reach every platform keyboard makes.
const SENTENCE_GAP = /[.!?…]+["'”’)\]]*[ \t]+$/u;

/**
 * The capitalised form of `typed` when inserting it at column `col` of `line`
 * starts a sentence, or `null` when the character should go in as typed.
 *
 * This is the capital iOS, macOS and most Android keyboards write for you at
 * the start of a sentence. The live-preview editor intercepts every insertion
 * and applies it to the source itself (`MarkdownEditor.tsx`), which puts the
 * keystroke out of reach of the platform's own substitution — so the capital
 * "falls away" mid-note unless the editor writes it, exactly as it owns the
 * double-space full stop above. Owning it also means it reads the same on a
 * desktop browser, where no platform offers it at all.
 *
 * Only a single lowercase letter is ever rewritten: a paste, an autocorrect
 * replacement, or a digit goes in untouched. A letter whose uppercase form is
 * more than one character (`ß` → `SS`) is left alone too — growing the text
 * would shift the caret out from under the typist.
 */
export function sentenceCapital(
  line: string,
  col: number,
  typed: string,
): string | null {
  if (!/^\p{Ll}$/u.test(typed)) return null;
  const upper = typed.toUpperCase();
  if (upper === typed || upper.length !== typed.length) return null;
  const before = line.slice(0, Math.max(col, 0));
  if (!LINE_LEAD.test(before) && !SENTENCE_GAP.test(before)) return null;
  return upper;
}
