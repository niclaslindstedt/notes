import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/index.ts";
import { TrashIcon } from "./icons.tsx";
import { Toast } from "./Toast.tsx";

// Confirmation for ticking off a dropzone note. The floating checkmark
// deletes the note and drops the user back on the overview in the same press,
// which reads as "the note vanished" unless something says what happened — so
// this toast names the act, and carries an Undo button because the deletion is
// an ordinary `remove` on the shared timeline that one undo step brings back.
//
// It lives at the App level rather than in the editor: the editor unmounts in
// the same press that would show it. `seq` counts tick-offs (0 = never), so a
// second deletion while the toast is still up restarts the clock rather than
// stacking a second pill.
//
// The window is deliberately short. Undo here is the plain timeline `undo`,
// which restores whatever changed last — right after the press that is the
// deletion, but the longer the toast lingers the more room there is for
// another edit to slip in between and make the button lie.
export function DropzoneDeletedToast({
  seq,
  onUndo,
}: {
  /** Tick-off counter; each increment (re)shows the toast. 0 = never. */
  seq: number;
  onUndo: () => void;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (seq === 0) return;
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer.current);
  }, [seq]);

  if (!visible) return null;
  return (
    <Toast
      message={t("app.dropzone.deleted")}
      icon={<TrashIcon className="h-4 w-4 shrink-0 text-muted" />}
      action={{
        label: t("nav.undo"),
        onAction: () => {
          setVisible(false);
          onUndo();
        },
      }}
    />
  );
}
