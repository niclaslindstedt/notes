import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { CheckIcon, CopyIcon } from "./icons.tsx";
import { Toast } from "./Toast.tsx";

// Header button that copies the selection — the note editor's
// [selection actions](NoteEditor.tsx), where it sits beside the cut button.
// It exists *because* something is selected: with nothing selected there is
// no copy button in the header at all, and copying the whole note stays where
// it has always been, in the export menu. So this one never takes more than
// what is highlighted.
//
// It confirms twice over — the glyph becomes a tick, and a `Toast` says
// "Copied" — because a copy is otherwise completely silent, and the glyph
// alone is easy to miss when your finger is over it.
export function CopyButton({ onCopy }: { onCopy: () => Promise<boolean> }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function run() {
    haptics.vibrate(8);
    if (!(await onCopy())) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  const label = copied ? t("app.copy.copied") : t("app.copy.selection");
  return (
    <>
      <button
        type="button"
        // Cancel the mousedown so the press doesn't blur the editing surface:
        // the selection has to survive the tap, or there is nothing to copy.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void run()}
        title={label}
        aria-label={label}
        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
      >
        {copied ? (
          <CheckIcon className="h-[18px] w-[18px]" />
        ) : (
          <CopyIcon className="h-[18px] w-[18px]" />
        )}
      </button>
      {copied && (
        <Toast
          message={t("app.copy.copied")}
          icon={<CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
        />
      )}
    </>
  );
}
