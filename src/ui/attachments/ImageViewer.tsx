import { useEffect } from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { useT } from "../../i18n/index.ts";
import { CloseIcon } from "../icons.tsx";

// Full-size viewer for an attached image: a dim, full-screen overlay showing
// the original at its natural size (capped to the viewport). Opened by clicking
// an inline thumbnail; dismissed with Escape, a backdrop click, or the close
// button. Deliberately not the shared `Modal` — an image wants the whole
// screen, edge to edge, not a bordered card.

type Props = {
  attachment: Attachment;
  onClose: () => void;
};

export function ImageViewer({ attachment, onClose }: Props) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      {/* A full-bleed button behind the image is the backdrop: clicking (or
          tab+Enter) anywhere off the image closes the viewer, with no click
          handler on a non-interactive element. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute inset-0 cursor-zoom-out bg-transparent"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none pt-[max(0px,env(safe-area-inset-top))]"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
      <img
        src={attachment.data}
        alt={attachment.filename}
        className="relative max-h-full max-w-full object-contain"
      />
    </div>
  );
}
