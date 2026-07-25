import { useEffect, useId, useState } from "react";

import type { OrphansStore } from "../app/use-orphans.ts";
import type { OrphanFile } from "../storage/adapter.ts";
import { useT } from "../i18n/index.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// Unmatched-files prompt: opens after a load that turned up files in the notes
// folder which don't correspond to any note — a markdown file hand-authored in
// the synced folder (no frontmatter, so nothing links it to a note), or a file
// whose extension the app doesn't own.
//
// This is a safety net, not a cleanup tool. The storage layer deliberately
// refuses to delete these files on its own, so they sit untouched until the
// user answers here. Each row offers the three answers that exist: adopt it as
// a note, delete it, or leave it alone — the last either for now (dismiss) or
// for good (ignore), the latter for a file that legitimately lives in the
// folder, like a README.

type Props = {
  orphans: OrphansStore;
};

// How much of a file to show in the expanded preview. Long enough to recognise
// what it is, short enough that a huge file can't blow up the modal.
const PREVIEW_LIMIT = 2000;

export function OrphanFilesModal({ orphans }: Props) {
  const t = useT();
  const titleId = useId();
  if (!orphans.open) return null;

  return (
    <Modal open onClose={orphans.dismiss} labelledBy={titleId}>
      <header className="flex shrink-0 items-center border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t("sync.orphans.title")}
        </h2>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        <p className="text-sm text-fg">{t("sync.orphans.hint")}</p>
        <ul className="flex flex-col gap-2">
          {orphans.files.map((file) => (
            <OrphanRow key={file.path} file={file} orphans={orphans} />
          ))}
        </ul>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="secondary" onClick={orphans.dismiss}>
          {t("sync.orphans.later")}
        </Button>
      </footer>
    </Modal>
  );
}

function OrphanRow({
  file,
  orphans,
}: {
  file: OrphanFile;
  orphans: OrphansStore;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  // Guards the row's buttons while an action is in flight, so a double tap on a
  // slow connection can't fire two deletes (or adopt the same file twice).
  const [busy, setBusy] = useState(false);

  // Fetch the preview only when the row is opened — each one is a round-trip on
  // a cloud backend, and most rows are decided from the filename alone.
  useEffect(() => {
    if (!expanded || text !== null) return;
    let cancelled = false;
    void orphans.preview(file.path).then((body) => {
      if (!cancelled) setText(body ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, text, orphans, file.path]);

  const run = (action: () => void | Promise<void>) => () => {
    setBusy(true);
    void Promise.resolve(action()).finally(() => setBusy(false));
  };

  return (
    <li className="rounded border border-line bg-surface-2 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-fg-bright">
            {file.path}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {t(
              file.reason === "unreadable"
                ? "sync.orphans.reasonUnreadable"
                : "sync.orphans.reasonForeign",
            )}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted underline hover:text-fg"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {t(expanded ? "sync.orphans.hide" : "sync.orphans.peek")}
        </button>
      </div>
      {expanded ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-1 px-2 py-1 text-xs text-fg">
          {text === null
            ? t("sync.orphans.loading")
            : text.trim().length === 0
              ? t("sync.orphans.empty")
              : text.slice(0, PREVIEW_LIMIT)}
        </pre>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={run(() => orphans.adopt(file.path))}
        >
          {t("sync.orphans.adopt")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={run(() => orphans.discard(file.path))}
        >
          {t("sync.orphans.discard")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={run(() => orphans.ignore(file.path))}
        >
          {t("sync.orphans.ignore")}
        </Button>
      </div>
    </li>
  );
}
