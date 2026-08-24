import { useId } from "react";

import { useT } from "../i18n/index.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// The prompt a renamed [dropzone note](../../docs/overview.md#dropzone) raises.
//
// A dropzone note is born named after the moment it was created, and that name
// is the whole signal that it is temporary. Replacing it with a name of your
// own is therefore a statement — you don't title a scrap you're about to tick
// off — so the app asks the obvious question once, right there, instead of
// hiding the promotion in a menu.
//
// Dismissing it (backdrop, Escape, or "Keep in Dropzone") is a real answer, not
// a cancel: the note keeps the new name and stays in the Dropzone. The caller
// remembers that answer for the note so a second visit to the title field
// doesn't ask again.

export function DropzoneKeepModal({
  title,
  onKeep,
  onDismiss,
}: {
  /** The name the user gave the note — quoted back in the question. */
  title: string;
  /** Promote the note into the ordinary list. */
  onKeep: () => void;
  /** Leave it in the Dropzone, new name and all. */
  onDismiss: () => void;
}) {
  const t = useT();
  const titleId = useId();
  return (
    <Modal open onClose={onDismiss} labelledBy={titleId}>
      <header className="flex shrink-0 items-center border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t("app.dropzone.keepTitle")}
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-fg">
          {t("app.dropzone.keepBody", { title })}
        </p>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="secondary" onClick={onDismiss}>
          {t("app.dropzone.discard")}
        </Button>
        <Button variant="primary" onClick={onKeep}>
          {t("app.dropzone.keep")}
        </Button>
      </footer>
    </Modal>
  );
}
