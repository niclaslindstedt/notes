import { useT } from "../i18n/index.ts";
import { ImportIcon } from "./icons.tsx";

// Full-screen overlay shown while a file is being dragged over the app window
// (see `useFileDrop`). Purely a visual affordance — it never intercepts the
// drag (the document-level listeners own that), so it's `pointer-events-none`
// to keep the drop landing on the real target underneath. A dashed inset
// frame + centred prompt reads as a single big drop zone covering the shell.

type Props = {
  visible: boolean;
};

export function DropOverlay({ visible }: Props) {
  const t = useT();
  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-page-bg/80 backdrop-blur-sm"
    >
      <div className="m-4 flex flex-1 flex-col items-center justify-center gap-4 self-stretch rounded-[var(--radius)] border-2 border-dashed border-accent/60 p-8 text-center">
        <ImportIcon className="h-12 w-12 text-accent" />
        <p className="text-lg font-semibold text-fg-bright">
          {t("app.dropTitle")}
        </p>
        <p className="max-w-sm text-sm text-muted">{t("app.dropHint")}</p>
      </div>
    </div>
  );
}
