import { useId } from "react";

import type { Attachment } from "../domain/attachment.ts";
import { useT } from "../i18n/index.ts";
import type { BackendId } from "../storage/backend-preference.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// The prompt an erased attachment raises (see
// `../../docs/overview.md#attachment-removal-prompt`).
//
// Deleting an attachment's reference out of a note is an edit of the text and
// takes effect at once. The *file* is a separate thing living in the user's own
// Dropbox / Drive / Nextcloud / notes folder, and this is the app asking
// permission before touching it — so the destructive answer is the secondary
// button and every way of dismissing the dialog (backdrop, Escape) keeps the
// file. Keeping it is not a deferral: the attachment stays on the note, so
// pasting the reference back resolves it again, bytes and all, and the app
// never asks about that attachment a second time.

export function AttachmentRemovalModal({
  attachments,
  backend,
  onResolve,
}: {
  /** The attachments whose references the edit erased. */
  attachments: readonly Attachment[];
  /** Which backend holds the files — named in the question. */
  backend: BackendId;
  /** `true` removes the files, `false` keeps them where they are. */
  onResolve: (remove: boolean) => void;
}) {
  const t = useT();
  const titleId = useId();
  const many = attachments.length > 1;
  // The backend's name as it reads mid-sentence, which is not the storage
  // picker's label ("Local folder", "Self-hosted") — those are list entries,
  // these have to survive "…remove it from ___ too?".
  const where = t(`app.attachmentRemoval.backend.${backend}`);
  return (
    <Modal open onClose={() => onResolve(false)} labelledBy={titleId}>
      <header className="flex shrink-0 items-center border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t(
            many
              ? "app.attachmentRemoval.titleMany"
              : "app.attachmentRemoval.title",
            { backend: where },
          )}
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-fg">
          {many
            ? t("app.attachmentRemoval.bodyMany", {
                count: attachments.length,
                backend: where,
              })
            : t("app.attachmentRemoval.body", {
                name: attachments[0]?.filename ?? "",
                backend: where,
              })}
        </p>
        {many && (
          <ul className="mt-2 space-y-1">
            {attachments.map((a) => (
              <li
                key={a.filename}
                className="truncate font-mono text-xs text-muted"
              >
                {a.filename}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          {t(
            many
              ? "app.attachmentRemoval.hintMany"
              : "app.attachmentRemoval.hint",
          )}
        </p>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="danger" onClick={() => onResolve(true)}>
          {t(
            many
              ? "app.attachmentRemoval.removeMany"
              : "app.attachmentRemoval.remove",
          )}
        </Button>
        <Button variant="primary" onClick={() => onResolve(false)}>
          {t(
            many
              ? "app.attachmentRemoval.keepMany"
              : "app.attachmentRemoval.keep",
          )}
        </Button>
      </footer>
    </Modal>
  );
}
