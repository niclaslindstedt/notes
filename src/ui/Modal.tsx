import { useEffect, useRef, type ReactNode } from "react";

import { APP_VIEWPORT_RECT } from "./appViewportRect.ts";

// Minimal accessible modal: a dimmed backdrop with a centered card. Closes
// on Escape and backdrop click, locks body scroll while open, and moves
// focus into the card on open / restores it on close. Ported from
// checklist's `Modal`, pared to what the settings dialog needs (no portal —
// the app has a single root and no competing stacking contexts).

// A stack of the currently-open modals. Escape only dismisses the one on
// top, so a confirmation dialog opened over another modal swallows the
// Escape that closes it without also tearing down the modal underneath.
// Backdrop clicks need no equivalent guard: the topmost modal's backdrop
// covers the whole viewport, so a click can only ever reach it.
const modalStack: symbol[] = [];

type Props = {
  open: boolean;
  onClose: () => void;
  // id of the heading element that names the dialog (aria-labelledby).
  labelledBy: string;
  // `"alertdialog"` for destructive confirmations so assistive tech
  // announces them as an interruption; defaults to `"dialog"`.
  role?: "dialog" | "alertdialog";
  // When true the modal renders as a compact centered card on every
  // viewport size instead of filling the screen on mobile. Use it for
  // short content that opens no soft keyboard — confirmations, pickers —
  // where a full-screen sheet would leave a sea of dead space.
  centered?: boolean;
  // Tailwind max-width class for the card. Only meaningful with `centered`
  // (the default full-screen shell caps its own width). Defaults to
  // `max-w-md`.
  size?: string;
  children: ReactNode;
};

export function Modal({
  open,
  onClose,
  labelledBy,
  role = "dialog",
  centered = false,
  size = "max-w-md",
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const tokenRef = useRef<symbol>(Symbol("modal"));

  // Hold the latest onClose in a ref so the focus/keydown effect can depend
  // on `open` alone. Callers commonly pass an inline arrow (`onClose={() =>
  // …}`) that is a fresh identity every render; keying the effect on it
  // would tear down and re-run on every parent re-render, and the re-run
  // calls `cardRef.current?.focus()` — stealing focus from whatever input
  // the user is typing into and dismissing the soft keyboard on mobile.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    modalStack.push(token);
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the modal on top of the stack reacts, so Escape peels one
      // layer at a time rather than collapsing every open modal at once.
      if (modalStack[modalStack.length - 1] !== token) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      const i = modalStack.lastIndexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // The dimming backdrop is a real <button> so dismiss-on-click carries an
  // interactive role (and a label) without piling event handlers onto a
  // non-interactive element; the dialog itself is a plain focusable
  // container layered above it.
  const wrapperClass = centered
    ? "fixed z-50 flex items-center justify-center p-4"
    : "fixed z-50 flex items-stretch justify-center sm:items-center sm:p-4";
  const cardClass = centered
    ? `relative flex max-h-[85svh] w-full ${size} flex-col overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-xl outline-none`
    : "relative flex h-full w-full flex-col overflow-hidden bg-surface text-fg shadow-xl outline-none sm:h-[min(90svh,42rem)] sm:max-w-3xl sm:rounded-lg sm:border sm:border-line";

  return (
    <div className={wrapperClass} style={APP_VIEWPORT_RECT}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cardClass}
      >
        {/* iOS PWA safe-area: the full-screen mobile layout reaches the top
            of the viewport, so reserve room for the status bar / Dynamic
            Island above the header. Coloured to match the modal headers
            (bg-surface-3) so it reads as an extension of the header bar.
            Centered cards float clear of the inset, so they skip it. */}
        {!centered && (
          <div
            aria-hidden="true"
            className="h-[env(safe-area-inset-top)] shrink-0 bg-surface-3 sm:hidden"
          />
        )}
        {children}
      </div>
    </div>
  );
}
