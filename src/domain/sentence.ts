// Sentence boundaries in a body of text — the granularity the undo timeline
// uses to break a continuous typing burst into sentence-sized steps.
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
