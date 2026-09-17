import { useEffect, useId, useRef, useState } from "react";

import {
  addComment,
  commentsOnLine,
  formatCommentLines,
  newComment,
  removeComment,
  updateCommentText,
  type LineComment,
} from "../domain/note-comment.ts";
import { useT } from "../i18n/index.ts";
import { Button } from "./form/Button.tsx";
import { scrollFocusedIntoView } from "./hooks/scrollFocusedIntoView.ts";
import { TrashIcon } from "./icons.tsx";
import { Modal } from "./Modal.tsx";

const INPUT_CLASS =
  "w-full rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent resize-y";

// The dialog behind both halves of a [line comment](../../docs/overview.md#line-comments):
// the one the header's bubble writes against the lines select mode has picked,
// and the one the gutter's bubble opens to read what is already there.
//
// They are one dialog rather than two because they are one question — "what is
// said about these lines?" — and the answer is a list you can add to, rewrite,
// or empty. Opening it on a line that already carries comments shows them with
// an empty composer under them; opening it from the header on a fresh run shows
// the composer alone.
//
// **Every edit is committed once, when the dialog closes.** The textareas are
// local drafts until then, because the alternative is one entry on the note's
// undo timeline per keystroke typed into a comment — and because a comment
// half-typed when the phone rings is not something the note should have been
// rewritten for. Deleting is the exception: it takes effect on the press, since
// there is nothing left to be in a draft about.
export function LineCommentModal({
  open,
  lines,
  comments,
  compose,
  onChange,
  onClose,
}: {
  /** Whether the dialog is up. Renders nothing while closed, so the host can
   *  mount it unconditionally — see `app/modals/lazy-modal.tsx`. */
  open: boolean;
  /** The lines the dialog is about: the picked run, or the pressed line. */
  lines: readonly number[];
  /** The whole note's comments — the dialog narrows to the ones on `lines`. */
  comments: LineComment[];
  /** Opened to write a new one (the header button), so the composer takes focus. */
  compose: boolean;
  /** The note's new comment list, handed over once, as the dialog closes. */
  onChange: (next: LineComment[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // The comments this dialog is about: every one anchored to any of `lines`, in
  // note order. A comment spanning a run shows up on each of its lines, which
  // is the point — it is the same comment, reachable from wherever it applies.
  const shown = dedupe(lines.flatMap((line) => commentsOnLine(comments, line)));

  // The drafts. Keyed by comment id, holding only the entries actually typed
  // in, so a dialog opened and closed without an edit commits nothing at all.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState("");

  // `onClose` may be reached by the backdrop, Escape, or the swipe-down sheet
  // as well as by Done, and every one of those has to commit the drafts —
  // otherwise dismissing the dialog the way a phone user dismisses everything
  // would silently throw away what they just wrote. A ref so the flush always
  // sees the latest drafts without re-binding the handler.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    let next = comments;
    let changed = false;
    for (const [id, text] of Object.entries(drafts)) {
      const edited = updateCommentText(next, id, text);
      // `updateCommentText` hands back the identical list when the text is
      // unchanged, which is how a draft that was typed into and typed back out
      // of commits nothing.
      if (edited !== next) changed = true;
      next = edited;
    }
    const made = newComment(lines, fresh);
    if (made) {
      next = addComment(next, made);
      changed = true;
    }
    if (changed) onChange(next);
  };

  function close() {
    flushRef.current();
    // The drafts die with the dialog. The host mounts this component
    // unconditionally and only gates the render on `open`, so the state
    // outlives a close — without clearing it, the text just committed would
    // still be sitting in the composer, and the *next* close (opening a line's
    // bubble to read what is there, then dismissing it) would flush it a second
    // time as a fresh comment.
    setDrafts({});
    setFresh("");
    onClose();
  }

  // The same clear, for a close that never went through `close()`. Nothing does
  // today, but a leftover draft is a duplicate comment rather than a cosmetic
  // slip, so the open transition guarantees an empty composer.
  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setFresh("");
  }, [open]);

  // The composer takes focus when the dialog was opened to write something. A
  // frame late, so the modal's own focus trap has settled first.
  useEffect(() => {
    if (!compose) return;
    const id = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [compose]);

  function del(id: string) {
    // Drop the draft with it, or the flush on close would re-write the comment
    // that was just deleted back onto the note.
    setDrafts((d) =>
      Object.fromEntries(Object.entries(d).filter(([key]) => key !== id)),
    );
    onChange(removeComment(comments, id));
  }

  if (!open) return null;

  const where = formatCommentLines(lines);
  return (
    <Modal open onClose={close} labelledBy={titleId}>
      <header className="flex shrink-0 items-center border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t(
            lines.length > 1 ? "app.comments.titleMany" : "app.comments.title",
            {
              lines: where,
            },
          )}
        </h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {shown.map((comment) => (
          <div key={comment.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">
                {t(
                  comment.lines.length > 1
                    ? "app.comments.onMany"
                    : "app.comments.on",
                  { lines: formatCommentLines(comment.lines) },
                )}
              </span>
              <button
                type="button"
                onClick={() => del(comment.id)}
                title={t("app.comments.delete")}
                aria-label={t("app.comments.delete")}
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-danger/40 bg-transparent text-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={drafts[comment.id] ?? comment.text}
              onChange={(e) => {
                const text = e.currentTarget.value;
                setDrafts((d) => ({ ...d, [comment.id]: text }));
              }}
              onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
              aria-label={t("app.comments.edit")}
              rows={3}
              className={INPUT_CLASS}
            />
          </div>
        ))}

        <div className="space-y-1">
          <label
            className="block text-xs text-muted"
            htmlFor={`${titleId}-new`}
          >
            {shown.length > 0
              ? t("app.comments.another")
              : t("app.comments.new")}
          </label>
          <textarea
            id={`${titleId}-new`}
            ref={composerRef}
            value={fresh}
            onChange={(e) => setFresh(e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("app.comments.placeholder")}
            rows={3}
            className={INPUT_CLASS}
          />
        </div>

        <p className="text-xs text-muted">{t("app.comments.hint")}</p>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="primary" onClick={close}>
          {t("app.comments.done")}
        </Button>
      </footer>
    </Modal>
  );
}

// A comment anchored to several of the dialog's lines is one comment, listed
// once — `commentsOnLine` is asked per line, so a run picks the same entry up
// as many times as it covers.
function dedupe(list: readonly LineComment[]): LineComment[] {
  const seen = new Set<string>();
  const out: LineComment[] = [];
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
