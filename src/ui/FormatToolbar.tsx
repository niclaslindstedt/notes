import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type {
  FormatAction,
  InlineDelimiter,
  LineFormat,
} from "../domain/markdown-format.ts";
import { useT, type TFunction } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { FloatingPanel } from "./FloatingPanel.tsx";
import {
  BoldGlyph,
  BulletListGlyph,
  ChecklistGlyph,
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
import type { FloatingPlacement } from "./hooks/useFloatingPosition.ts";
import { ChevronDownIcon } from "./icons.tsx";

// The styling toolbar: every Markdown construct the app renders, reachable at
// the top of the note's content area. It is *in* the column, not floating over
// it — opening it pushes the text down rather than covering the line you were
// about to format — and the toggle lives in the editor header (see
// `FormatToolbarButton`).
//
// Twenty constructs would be twenty buttons, which wraps to three rows on a
// phone. So the ones that form a natural family collapse into a **menu**: the
// six heading levels, the five block styles (bullet / numbered / checklist,
// quote, code block), and the three inserts (link, image, divider). Each menu's trigger
// wears the glyph of whichever member is currently applied — so a caret on an H2
// line shows `H2`, lit — and its rows carry both the glyph and its name, which
// the bare icon buttons never could. That takes the row to nine controls, which
// fits one line at a phone width; the row still wraps if it has to.
//
// Two details make it usable rather than merely present:
//
//   * **It never takes focus.** Every button — and every menu row, and the
//     header toggle — cancels its own `mousedown`, so the caret (and any
//     selection) stays exactly where it was in the editing surface. Without
//     that, pressing "Bold" would blur the editor and there would be nothing
//     left to embolden.
//   * **It shows what is already applied.** The caret's position is classified
//     by the same parser the preview renders from — the line's block kind *and*
//     the inline runs the caret sits inside — so the heading / block button
//     lights up on such a line and Bold lights up anywhere within `**…**`.
//     Pressing a lit control takes that marker off again.
//
// `role="toolbar"` with a roving tabindex keeps the row one stop in the keyboard
// order rather than nine.

/** One control: what it inserts, how it is labelled, and when it is lit. */
type ToolbarItem = {
  id: string;
  action: FormatAction;
  label: string;
  glyph: ReactNode;
  /** Whether the caret already sits in (or on) this construct. */
  active?: (line: LineFormat | null) => boolean;
  /** Whether the press would do nothing (an outdent at the left margin). */
  disabled?: (line: LineFormat | null) => boolean;
};

/**
 * A cluster in the row: either its items side by side as icon buttons, or one
 * trigger that opens them as a named menu.
 */
type ToolbarGroup = {
  id: string;
  items: ToolbarItem[];
} & (
  | { kind: "buttons" }
  | {
      kind: "menu";
      /** Names the menu, and labels the trigger when nothing is applied. */
      label: string;
      /** The trigger's glyph while no member of the menu is in effect. */
      glyph: ReactNode;
    }
);

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

/** Whether the caret sits inside a run of `delim` — see `inlineMarksAt`. */
function wearing(line: LineFormat | null, delim: InlineDelimiter): boolean {
  return line?.inline.includes(delim) === true;
}

const ICON = "h-[18px] w-[18px]";

const MENU_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 200 },
  anchor: "left",
  coordinateSpace: "viewport",
};

function buildGroups(t: TFunction): ToolbarGroup[] {
  return [
    {
      kind: "menu",
      id: "heading",
      label: t("app.format.headings"),
      glyph: <HeadingGlyph level={1} className="text-[17px]" />,
      items: HEADING_LEVELS.map((level) => ({
        id: `h${level}`,
        action: { kind: "heading", level } as const,
        label: t("app.format.heading", { level }),
        glyph: <HeadingGlyph level={level} className="text-[17px]" />,
        active: (line: LineFormat | null) =>
          line?.kind === "heading" && line.level === level,
      })),
    },
    {
      kind: "buttons",
      id: "inline",
      items: [
        {
          id: "bold",
          action: { kind: "inline", delimiter: "**" },
          label: t("app.format.bold"),
          glyph: <BoldGlyph className={ICON} />,
          active: (line) => wearing(line, "**"),
        },
        {
          id: "italic",
          action: { kind: "inline", delimiter: "*" },
          label: t("app.format.italic"),
          glyph: <ItalicGlyph className={ICON} />,
          active: (line) => wearing(line, "*"),
        },
        {
          id: "strikethrough",
          action: { kind: "inline", delimiter: "~~" },
          label: t("app.format.strikethrough"),
          glyph: <StrikethroughGlyph className={ICON} />,
          active: (line) => wearing(line, "~~"),
        },
        {
          id: "code",
          action: { kind: "inline", delimiter: "`" },
          label: t("app.format.code"),
          glyph: <InlineCodeGlyph className={ICON} />,
          active: (line) => wearing(line, "`"),
        },
      ],
    },
    {
      kind: "menu",
      id: "block",
      label: t("app.format.blocks"),
      glyph: <BulletListGlyph className={ICON} />,
      items: [
        {
          id: "ul",
          action: { kind: "list", ordered: false },
          label: t("app.format.bulletList"),
          glyph: <BulletListGlyph className={ICON} />,
          // A checklist row is a `ul` too, so the box is what splits the two
          // buttons — exactly one of them is ever lit, and pressing this one
          // on a checklist row converts it to a plain bullet.
          active: (line) => line?.kind === "ul" && line.task === undefined,
        },
        {
          id: "ol",
          action: { kind: "list", ordered: true },
          label: t("app.format.numberedList"),
          glyph: <OrderedListGlyph className={ICON} />,
          active: (line) => line?.kind === "ol",
        },
        {
          id: "task",
          action: { kind: "task" },
          label: t("app.format.checklist"),
          glyph: <ChecklistGlyph className={ICON} />,
          active: (line) => line?.kind === "ul" && line.task !== undefined,
        },
        {
          id: "quote",
          action: { kind: "quote" },
          label: t("app.format.quote"),
          glyph: <QuoteGlyph className={ICON} />,
          active: (line) => line?.kind === "quote",
        },
        {
          id: "fence",
          action: { kind: "fence" },
          label: t("app.format.codeBlock"),
          glyph: <CodeBlockGlyph className={ICON} />,
          active: (line) => line?.kind === "code" || line?.kind === "fence",
        },
      ],
    },
    {
      kind: "buttons",
      id: "nesting",
      items: [
        {
          id: "outdent",
          action: { kind: "indent", outdent: true },
          label: t("app.format.outdent"),
          glyph: <OutdentGlyph className={ICON} />,
          disabled: (line) => line !== null && line.indent === 0,
        },
        {
          id: "indent",
          action: { kind: "indent" },
          label: t("app.format.indent"),
          glyph: <IndentGlyph className={ICON} />,
        },
      ],
    },
    {
      kind: "menu",
      id: "insert",
      label: t("app.format.inserts"),
      glyph: <LinkGlyph className={ICON} />,
      items: [
        {
          id: "link",
          action: { kind: "link" },
          label: t("app.format.link"),
          glyph: <LinkGlyph className={ICON} />,
        },
        {
          id: "image",
          action: { kind: "link", image: true },
          label: t("app.format.image"),
          glyph: <ImageGlyph className={ICON} />,
        },
        {
          id: "rule",
          action: { kind: "rule" },
          label: t("app.format.rule"),
          glyph: <RuleGlyph className={ICON} />,
        },
      ],
    },
  ];
}

export function FormatToolbar({
  line,
  onAction,
  maxWidth,
}: {
  /** The block state of the line the caret sits on, for the lit controls. */
  line: LineFormat | null;
  onAction: (action: FormatAction) => void;
  /** The writing column's width, so the toolbar lines up with the text. */
  maxWidth: string;
}) {
  const t = useT();
  const groups = buildGroups(t);
  const rowRef = useRef<HTMLDivElement>(null);

  // Roving tabindex: the toolbar is a single stop in the page's tab order and
  // the arrow keys walk it, per the ARIA toolbar pattern. The cursor counts the
  // controls *in the row* — a menu is one of them however many rows it holds,
  // and its own contents are portalled out, so `querySelectorAll` here can't
  // reach them.
  const [focusIndex, setFocusIndex] = useState(0);
  const controlCount = groups.reduce(
    (n, group) => n + (group.kind === "menu" ? 1 : group.items.length),
    0,
  );

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEP[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = clamp(
      step === "home"
        ? 0
        : step === "end"
          ? controlCount - 1
          : focusIndex + step,
      controlCount - 1,
    );
    setFocusIndex(next);
    rowRef.current?.querySelectorAll("button")[next]?.focus();
  }

  // The row-order index of each group's first control, so a group can hand each
  // of its buttons the right slot in the roving cursor.
  const groupStart = groups.map((_, g) =>
    groups
      .slice(0, g)
      .reduce(
        (n, group) => n + (group.kind === "menu" ? 1 : group.items.length),
        0,
      ),
  );

  return (
    <div className="format-toolbar-in border-b border-line bg-surface">
      <div
        ref={rowRef}
        role="toolbar"
        aria-label={t("app.format.toolbar")}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="mx-auto flex w-full flex-wrap items-center gap-0.5 px-4 py-2"
        style={maxWidth === "none" ? undefined : { maxWidth }}
      >
        {groups.map((group, g) => (
          <div
            key={group.id}
            className="flex items-center rounded-full bg-surface-2 p-0.5 ring-1 ring-line ring-inset"
          >
            {group.kind === "menu" ? (
              <FormatMenu
                group={group}
                line={line}
                onAction={onAction}
                tabIndex={groupStart[g] === focusIndex ? 0 : -1}
                onFocus={() => setFocusIndex(groupStart[g]!)}
              />
            ) : (
              group.items.map((item, i) => {
                const index = groupStart[g]! + i;
                return (
                  <ToolbarButton
                    key={item.id}
                    item={item}
                    line={line}
                    onAction={onAction}
                    tabIndex={index === focusIndex ? 0 : -1}
                    onFocus={() => setFocusIndex(index)}
                  />
                );
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One icon button in the row. */
function ToolbarButton({
  item,
  line,
  onAction,
  tabIndex,
  onFocus,
}: {
  item: ToolbarItem;
  line: LineFormat | null;
  onAction: (action: FormatAction) => void;
  tabIndex: number;
  onFocus: () => void;
}) {
  const lit = item.active?.(line) === true;
  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-pressed={item.active ? lit : undefined}
      disabled={item.disabled?.(line) === true}
      tabIndex={tabIndex}
      onFocus={onFocus}
      // Keep the caret (and any selection) in the editor: a mousedown that
      // isn't cancelled moves focus here, and the press would then have
      // nothing to format.
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
}

/**
 * A family of constructs behind one trigger — the six heading levels, the four
 * block styles, the three inserts. The trigger wears the glyph of whichever
 * member is currently applied (and lights up with it), falling back to the
 * group's own glyph; the panel lists every member with its glyph *and* its
 * name, which the bare icon buttons in the row can't show.
 */
function FormatMenu({
  group,
  line,
  onAction,
  tabIndex,
  onFocus,
}: {
  group: Extract<ToolbarGroup, { kind: "menu" }>;
  line: LineFormat | null;
  onAction: (action: FormatAction) => void;
  tabIndex: number;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const applied = group.items.find((item) => item.active?.(line) === true);

  // A pointer press must leave focus in the editor (see below), but a *keyboard*
  // one has to put it somewhere reachable or the rows can't be walked at all —
  // they are portalled out of the row, so Tab would sail straight past them.
  // A click with `detail === 0` is a keyboard activation; only then does the
  // first row take focus. The caret is safe either way: with focus off the
  // surface the editor formats from the caret it last saw.
  const [fromKeyboard, setFromKeyboard] = useState(false);
  useEffect(() => {
    if (!open || !fromKeyboard) return;
    menuRef.current?.querySelector("button")?.focus();
  }, [open, fromKeyboard]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={applied?.label ?? group.label}
        aria-label={applied?.label ?? group.label}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={tabIndex}
        onFocus={onFocus}
        // As with the plain buttons: opening the menu must not move focus out
        // of the editor, or there would be no selection left to act on.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          setFromKeyboard(e.detail === 0);
          setOpen((v) => !v);
        }}
        className={`inline-flex h-8 w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
          applied
            ? "bg-accent text-page-bg shadow-sm"
            : "text-fg hover:bg-accent/15 hover:text-accent active:bg-accent/25"
        }`}
      >
        {applied?.glyph ?? group.glyph}
        <ChevronDownIcon className="h-2.5 w-2.5 shrink-0 opacity-70" />
      </button>
      <FloatingPanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement={MENU_PLACEMENT}
        // The toolbar is pinned directly under the editor header, so there is
        // structurally nothing useful above it — and with the soft keyboard up
        // the viewport is short enough that the default would flip the menu
        // there and draw its first rows off the top of the screen. Down, and
        // scrolling inside its own box if it must (see `FloatingPanel`).
        drop="down"
        className="py-1"
      >
        <div ref={menuRef} role="menu" aria-label={group.label}>
          {group.items.map((item) => {
            const lit = item.active?.(line) === true;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled?.(line) === true}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  haptics.vibrate(8);
                  onAction(item.action);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/15 disabled:cursor-default disabled:opacity-40 ${
                  lit ? "text-accent" : "text-fg"
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {item.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {/* A dot rather than a tick: the row is a toggle, so "applied"
                    is a state to be turned back off, not a chosen value. */}
                {lit && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </FloatingPanel>
    </>
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
 * The toolbar's toggle, sitting top-right in the editor header beside the find,
 * cut and copy glyphs. Pressing it opens the toolbar; pressing it again takes it
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
