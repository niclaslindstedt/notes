import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
} from "./icons.tsx";

// Find in note: a one-line search bar for the note that is open, sitting *in*
// the content column directly under the editor header — the same place (and the
// same unfolding animation) the styling toolbar uses, so opening it pushes the
// text down rather than covering the line you were looking for. The two are
// independent; both can be up at once, and the find bar sits above.
//
// It is deliberately not the cross-note search modal: that one answers "which
// note mentions this", takes wildcards and regexes, and opens a list. This one
// answers "where in *this* note", matching the typed characters verbatim and
// case-insensitively, painting every hit in the note and stepping between them.
//
// The browser's own find bar (⌘F / the "find on page" menu item) can't be
// opened, positioned, or read from a web page — there is no API for it, and no
// way to put its prev/next arrows on a phone's keyboard accessory bar — so this
// is the app's own. What it *can* borrow is the platform behaviour a soft
// keyboard keys off: `inputMode="search"` and `enterKeyHint="next"` label the
// virtual keyboard's action key, and Enter / Shift+Enter step the matches from
// it without the field ever losing focus.

export function NoteFindBar({
  query,
  onQueryChange,
  total,
  /** 0-based index of the hit the bar is parked on, or -1 when there are none. */
  current,
  onNext,
  onPrevious,
  onClose,
  maxWidth,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  total: number;
  current: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** The writing column's width, so the bar lines up with the text. */
  maxWidth: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field the moment the bar mounts. A layout effect (rather than a
  // passive one) keeps the focus inside the tap that opened the bar — the host
  // opens it through `flushSync`, and that pairing is the only context in which
  // iOS raises the soft keyboard for a programmatic focus.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  const none = total === 0;

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    // Enter walks the matches without leaving the field, so a phone can step
    // through the note from the keyboard's own action key.
    e.preventDefault();
    if (none) return;
    if (e.shiftKey) onPrevious();
    else onNext();
  }

  return (
    <div className="format-toolbar-in border-b border-line bg-surface">
      <div
        className="mx-auto flex w-full items-center gap-2 px-4 py-2"
        style={maxWidth === "none" ? undefined : { maxWidth }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 ring-1 ring-line ring-inset focus-within:ring-accent">
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("app.find.placeholder")}
            aria-label={t("app.find.bar")}
            inputMode="search"
            enterKeyHint="next"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-muted/60"
          />
          {/* The counter says which hit you're on and how many there are, so
              stepping past the last one and wrapping to the first is legible
              rather than a mystery. It holds its width (tabular figures) so the
              field doesn't twitch as the count changes on every keystroke. */}
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {query === ""
              ? ""
              : none
                ? t("app.find.none")
                : t("app.find.count", { index: current + 1, total })}
          </span>
        </div>
        <FindBarButton
          label={t("app.find.previous")}
          disabled={none}
          onClick={onPrevious}
        >
          <ChevronUpIcon className="h-[18px] w-[18px]" />
        </FindBarButton>
        <FindBarButton
          label={t("app.find.next")}
          disabled={none}
          onClick={onNext}
        >
          <ChevronDownIcon className="h-[18px] w-[18px]" />
        </FindBarButton>
        <FindBarButton label={t("app.find.close")} onClick={onClose}>
          <CloseIcon className="h-[18px] w-[18px]" />
        </FindBarButton>
      </div>
    </div>
  );
}

/**
 * One control in the bar. Like the styling toolbar's buttons these cancel their
 * own `mousedown`, but for the opposite reason: focus must stay in the *find
 * field*, so stepping through the matches on a phone never drops the keyboard.
 */
function FindBarButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onClick();
      }}
      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg transition-colors duration-100 hover:bg-accent/15 hover:text-accent active:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * The bar's toggle, sitting in the editor header beside the formatting, copy
 * and cut glyphs. Pressing it opens the bar (which takes focus and
 * raises the keyboard); pressing it again puts it away. It reads as "on" while
 * the bar is up, so the header says which state you're in.
 *
 * Unlike its neighbours this one does *not* cancel its `mousedown`: the press
 * is meant to move focus out of the note and into the find field, and the
 * editing surface dropping its raw active line on blur is what lets every line
 * — including the one the caret was on — render its highlights.
 */
export function NoteFindButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = open ? t("app.find.hide") : t("app.find.show");
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={open}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        open
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      <SearchIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
