// Builds the text the editor's copy button writes to the clipboard for a given
// `CopyScope`. Pure (no DOM, no clipboard) so it's trivially testable; the
// button component owns the actual clipboard write.
//
// `frontMatter` reuses the file backends' codec (`noteToMarkdown`) so a copied
// note is byte-identical to the `.md` file those backends store — paste it into
// a folder/cloud-synced vault and it round-trips. `body` and `titleBody` are
// the lighter "just the prose" variants.

import type { CopyScope, Note } from "../domain/note.ts";
import { noteToMarkdown } from "../storage/markdown/codec.ts";

export function buildCopyText(note: Note, scope: CopyScope): string {
  // Copy acts on the open note, whose body is loaded; the `?? ""` only guards a
  // deferred note that hasn't resolved yet.
  const body = note.body ?? "";
  if (scope === "frontMatter") return noteToMarkdown(note);
  if (scope === "titleBody") {
    const title = note.title.trim();
    if (!title) return body;
    return body ? `# ${title}\n\n${body}` : `# ${title}`;
  }
  return body;
}
