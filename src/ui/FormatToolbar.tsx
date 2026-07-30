import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { FormatAction, LineFormat } from "../domain/markdown-format.ts";
import { useT, type TFunction } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import {
  BoldGlyph,
  BulletListGlyph,
  CodeBlockGlyph,
  FormatIcon,
  HeadingGlyph,
  ImageGlyph,
  IndentGlyph,
  InlineCodeGlyph,
  ItalicGlyph,
  LinkGlyph,
  OrderedListGlyph,
  OutdentGlyph,
  QuoteGlyph,
  RuleGlyph,
  StrikethroughGlyph,
} from "./format-glyphs.tsx";

// The styling toolbar: every Markdown construct the app renders, one button
// each, sitting at the top of the note's content area. It is *in* the column,
// not floating over it — opening it pushes the text down rather than covering
// the line you were about to format — and the toggle lives in the editor
// header (see `FormatToolbarButton`).
//
// Two details make it usable rather than merely present:
//
//   * **It never takes focus.** Every button cancels its own `mousedown`, so
//     the caret (and any selection) stays exactly where it was in the editing
//     surface. Without that, pressing "Bold" would blur the editor and there
//     would be nothing left to embolden.
//   * **It shows what is already applied.** The caret's line is classified by
//     the same parser the preview renders from, so the H2 / bullet / quote
//     button lights up when the caret is on such a line, and pressing a lit
//     button takes the marker off again.
//
// The buttons are grouped into pills — headings, inline emphasis, blocks,
// nesting, inserts — and the row wraps, so the whole set is reachable on a
// phone without a horizontal scroll. `role="toolbar"` with a roving tabindex
// keeps it one stop in the keyboard order rather than nineteen.

/** One button: what it inserts, how it is labelled, and when it is lit. */
type ToolbarItem = {
  id: string;
  action: FormatAction;
  label: string;
  glyph: ReactNode;
  /** Whether the caret's line already carries this construct. */
  active?: (line: LineFormat | null) => boolean;
  /** Whether the press would do nothing (an outdent at the left margin). */
  disabled?: (line: LineFormat | null) => boolean;
};

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

function buildGroups(t: TFunction): ToolbarItem[][] {
  return [
    HEADING_LEVELS.map((level) => ({
      id: `h${level}`,
      action: { kind: "heading", level } as const,
      label: t("app.format.heading", { level }),
      glyph: <HeadingGlyph level={level} className="text-[17px]" />,
      active: (line: LineFormat | null) =>
        line?.kind === "heading" && line.level === level,
    })),
    [
      {
        id: "bold",
        action: { kind: "inline", delimiter: "**" },
        label: t("app.format.bold"),
        glyph: <BoldGlyph className="h-[18px] w-[18px]" />,
      },
      {
        id: "italic",
        action: { kind: "inline", delimiter: "*" },
        label: t("app.format.italic"),
        glyph: <ItalicGlyph className="h-[18px] w-[18px]" />,
      },
      {
        id: "strikethrough",
        action: { kind: "inline", delimiter: "~~" },
        label: t("app.format.strikethrough"),
        glyph: <StrikethroughGlyph className="h-[18px] w-[18px]" />,
      },
      {
        id: "code",
        action: { kind: "inline", delimiter: "`" },
        label: t("app.format.code"),
        glyph: <InlineCodeGlyph className="h-[18px] w-[18px]" />,
      },
    ],
    [
      {
        id: "ul",
        action: { kind: "list", ordered: false },
        label: t("app.format.bulletList"),
        glyph: <BulletListGlyph className="h-[18px] w-[18px]" />,
        active: (line) => line?.kind === "ul",
      },
      {
        id: "ol",
        action: { kind: "list", ordered: true },
        label: t("app.format.numberedList"),
        glyph: <OrderedListGlyph className="h-[18px] w-[18px]" />,
        active: (line) => line?.kind === "ol",
      },
      {
        id: "quote",
        action: { kind: "quote" },
        label: t("app.format.quote"),
        glyph: <QuoteGlyph className="h-[18px] w-[18px]" />,
        active: (line) => line?.kind === "quote",
      },
      {
        id: "fence",
        action: { kind: "fence" },
        label: t("app.format.codeBlock"),
        glyph: <CodeBlockGlyph className="h-[18px] w-[18px]" />,
        active: (line) => line?.kind === "code" || line?.kind === "fence",
      },
    ],
    [
      {
        id: "outdent",
        action: { kind: "indent", outdent: true },
        label: t("app.format.outdent"),
        glyph: <OutdentGlyph className="h-[18px] w-[18px]" />,
        disabled: (line) => line !== null && line.indent === 0,
      },
      {
        id: "indent",
        action: { kind: "indent" },
        label: t("app.format.indent"),
        glyph: <IndentGlyph className="h-[18px] w-[18px]" />,
      },
    ],
    [
      {
        id: "link",
        action: { kind: "link" },
        label: t("app.format.link"),
        glyph: <LinkGlyph className="h-[18px] w-[18px]" />,
      },
      {
        id: "image",
        action: { kind: "link", image: true },
        label: t("app.format.image"),
        glyph: <ImageGlyph className="h-[18px] w-[18px]" />,
      },
      {
        id: "rule",
        action: { kind: "rule" },
        label: t("app.format.rule"),
        glyph: <RuleGlyph className="h-[18px] w-[18px]" />,
      },
    ],
  ];
}

export function FormatToolbar({
  line,
  onAction,
  maxWidth,
}: {
  /** The block state of the line the caret sits on, for the lit buttons. */
  line: LineFormat | null;
  onAction: (action: FormatAction) => void;
  /** The writing column's width, so the toolbar lines up with the text. */
  maxWidth: string;
}) {
  const t = useT();
  const groups = buildGroups(t);
  const rowRef = useRef<HTMLDivElement>(null);

  // Roving tabindex: the toolbar is a single stop in the page's tab order and
  // the arrow keys walk it, per the ARIA toolbar pattern — nineteen separate
  // tab stops between the note title and its body would be unusable.
  const [focusIndex, setFocusIndex] = useState(0);

  const items = groups.flat();

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEP[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = clamp(
      step === "home"
        ? 0
        : step === "end"
          ? items.length - 1
          : focusIndex + step,
      items.length - 1,
    );
    setFocusIndex(next);
    rowRef.current?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div className="format-toolbar-in border-b border-line bg-surface">
      <div
        ref={rowRef}
        role="toolbar"
        aria-label={t("app.format.toolbar")}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="mx-auto flex w-full flex-wrap items-center gap-1.5 px-4 py-2"
        style={maxWidth === "none" ? undefined : { maxWidth }}
      >
        {groups.map((group, g) => (
          <div
            key={g}
            className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5 ring-1 ring-line ring-inset"
          >
            {group.map((item) => {
              const index = items.indexOf(item);
              const lit = item.active?.(line) === true;
              const off = item.disabled?.(line) === true;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={item.active ? lit : undefined}
                  disabled={off}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(index)}
                  // Keep the caret (and any selection) in the editor: a
                  // mousedown that isn't cancelled moves focus here, and the
                  // press would then have nothing to format.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    haptics.vibrate(8);
                    onAction(item.action);
                  }}
                  className={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-30 ${
                    lit
                      ? "bg-accent text-page-bg shadow-sm"
                      : "text-fg hover:bg-accent/15 hover:text-accent active:bg-accent/25"
                  }`}
                >
                  {item.glyph}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// How each navigation key moves the roving focus.
const ARROW_STEP: Record<string, number | "home" | "end" | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: "home",
  End: "end",
};

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n));
}

/**
 * The toolbar's toggle, sitting top-right in the editor header beside the copy
 * and sync glyphs. Pressing it opens the toolbar; pressing it again takes it
 * away. It reads as "on" while the toolbar is up (filled with the accent
 * rather than merely outlined) so the header says which state you're in.
 */
export function FormatToolbarButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = open ? t("app.format.hide") : t("app.format.show");
  return (
    <button
      type="button"
      onClick={onToggle}
      // Cancel the mousedown so opening the toolbar doesn't blur the editor:
      // the caret stays put, which is what lets the toolbar light up for the
      // line you were on and act on the selection you already had.
      onMouseDown={(e) => e.preventDefault()}
      title={label}
      aria-label={label}
      aria-pressed={open}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        open
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      <FormatIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
