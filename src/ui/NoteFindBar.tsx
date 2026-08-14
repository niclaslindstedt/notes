import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type { PreviewLine } from "../domain/note-replace.ts";
import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  PreviewIcon,
  ReplaceAllIcon,
  ReplaceIcon,
  SearchIcon,
} from "./icons.tsx";

// Find in note: a search bar for the note that is open, sitting *in* the
// content column directly under the editor header — the same place (and the
// same unfolding animation) the styling toolbar uses, so opening it pushes the
// text down rather than covering the line you were looking for. The two are
// independent; both can be up at once, and the find bar sits above.
//
// It is deliberately not the cross-note search modal: that one answers "which
// note mentions this" and opens a list. This one answers "where in *this*
// note", matching the typed characters verbatim and case-insensitively,
// painting every hit in the note and stepping between them.
//
// The bar has a second, folded-away half. The chevron at its head opens the
// **replace row**: a second field, and the three buttons that act on it —
// replace the hit you are parked on, replace every hit, and *preview*, which
// writes nothing and unfolds a panel showing what the other two would do, line
// by line. Both halves share one query, so the search you already typed is the
// one replace acts on; nothing has to be re-entered to cross over. The `.*`
// toggle beside the search field reads that query as a regular expression
// instead of literal text, which is also what makes `$1` in a replacement mean
// anything (see `domain/note-replace.ts`).
//
// Replace is withheld entirely on a locked (read-only) note — no chevron, no
// row. Find still works there, because reading a locked note is the point of
// locking it.
//
// The browser's own find bar (the "find on page" menu item) can't be opened,
// positioned, or read from a web page — there is no API for it, and no way to
// put its prev/next arrows on a phone's keyboard accessory bar — so this is the
// app's own, and ⌘F / Ctrl+F is taken from the browser and routed here (see
// `useFindShortcut`). What it *can* borrow is the platform behaviour a soft
// keyboard keys off: `inputMode="search"` and `enterKeyHint` label the virtual
// keyboard's action key, and Enter / Shift+Enter step the matches from it
// without the field ever losing focus.

/**
 * How many changed lines the preview panel draws before it stops and says how
 * many more there are. A replace-all over a long note can touch hundreds of
 * lines, and a panel that long is a wall rather than an answer — the count
 * above it is what actually tells you the scope.
 */
const PREVIEW_LIMIT = 40;

export function NoteFindBar({
  query,
  onQueryChange,
  regex,
  onRegexToggle,
  patternInvalid,
  total,
  /** 0-based index of the hit the bar is parked on, or -1 when there are none. */
  current,
  onNext,
  onPrevious,
  onClose,
  canReplace,
  replaceOpen,
  onReplaceOpenToggle,
  replacement,
  onReplacementChange,
  onReplace,
  onReplaceAll,
  previewOpen,
  onPreviewToggle,
  preview,
  maxWidth,
  focusSignal = 0,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  /** Whether the query is read as a regular expression — the `.*` toggle. */
  regex: boolean;
  onRegexToggle: () => void;
  /** Regex mode is on and the pattern doesn't compile (a half-typed `(foo`). */
  patternInvalid: boolean;
  total: number;
  current: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /**
   * Whether replacing is offered at all. False on a locked note, which folds
   * the whole second half away — chevron included.
   */
  canReplace: boolean;
  replaceOpen: boolean;
  onReplaceOpenToggle: () => void;
  replacement: string;
  onReplacementChange: (replacement: string) => void;
  /** Rewrite the hit the bar is parked on and step to the next. */
  onReplace: () => void;
  /** Rewrite every hit in one go. */
  onReplaceAll: () => void;
  previewOpen: boolean;
  onPreviewToggle: () => void;
  /** What a replace-all would write — every affected line, host-computed. */
  preview: readonly PreviewLine[];
  /** The writing column's width, so the bar lines up with the text. */
  maxWidth: string;
  /**
   * Bumped by the host to pull focus back into the field on an already-open
   * bar — what ⌘F does when the bar is up but the caret has moved on.
   */
  focusSignal?: number;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  // Focus the field the moment the bar mounts, and again whenever the host
  // bumps `focusSignal`. A layout effect (rather than a passive one) keeps the
  // focus inside the tap that opened the bar — the host opens it through
  // `flushSync`, and that pairing is the only context in which iOS raises the
  // soft keyboard for a programmatic focus. The query is selected rather than
  // just focused, so re-pressing ⌘F over a bar that already holds a search
  // types a fresh one instead of appending to the old.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // `focus()` first and explicitly: `select()` alone is what raises the soft
    // keyboard in a browser, but jsdom implements only the selection half of
    // it, and the focus is the half every caller here depends on.
    input.focus();
    input.select();
  }, [focusSignal]);

  // Unfolding the replace row puts the caret in the field it just revealed —
  // the press that opened it said what the user wants to type next. Skipped on
  // the very first render, where the *search* field owns the focus even if the
  // row came up already open (the bar remembers it across openings).
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (replaceOpen) replaceRef.current?.focus();
  }, [replaceOpen]);

  const none = total === 0;
  const showReplace = canReplace && replaceOpen;
  const showPreview = showReplace && previewOpen;

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

  // The replace field answers the same two keys, but for the actions that are
  // under the caret there: Enter rewrites the current hit (so replacing a run
  // of them is one key held), and Ctrl/Cmd+Enter rewrites the lot — the
  // "bigger version of this" modifier, the same way it reads everywhere else.
  function onReplaceKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (none) return;
    if (e.metaKey || e.ctrlKey) onReplaceAll();
    else onReplace();
  }

  return (
    <div className="format-toolbar-in border-b border-line bg-surface">
      <div
        className="mx-auto w-full px-4 py-2"
        style={maxWidth === "none" ? undefined : { maxWidth }}
      >
        {/* Top-aligned rather than centred: the button cluster on the right
            carries the match counter slung underneath it, which makes it taller
            than everything beside it — centring would push the field and the
            chevron down against nothing. */}
        <div className="flex items-start gap-2">
          {/* The disclosure for the replace half. A chevron rather than a
              labelled button: it is the one control here that reveals more of
              the bar rather than acting on the note, and pointing it down when
              open is the only affordance that says so without words. */}
          {canReplace && (
            <FindBarButton
              label={
                replaceOpen
                  ? t("app.find.hideReplace")
                  : t("app.find.replaceRow")
              }
              pressed={replaceOpen}
              onClick={onReplaceOpenToggle}
            >
              <ChevronRightIcon
                className={`h-[18px] w-[18px] transition-transform duration-150 ${
                  replaceOpen ? "rotate-90" : ""
                }`}
              />
            </FindBarButton>
          )}
          <FieldPill invalid={patternInvalid}>
            <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder={t("app.find.placeholder")}
              aria-label={t("app.find.bar")}
              inputMode="search"
              enterKeyHint="next"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellcheck={false}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-muted/60"
            />
          </FieldPill>
          {/* The regex switch wears the pattern it turns on rather than a drawn
              glyph: `.*` is the smallest thing the feature *is*, and anyone who wants it
              recognises it on sight — while anyone who doesn't reads it as
              punctuation and leaves it alone. It sits beside the field rather
              than inside it, next to the field it governs but on the side of
              the row where everything is pressable: in the pill it read as part
              of the match counter it sat against, which is a readout, not a
              control. */}
          <FindBarButton
            label={t("app.find.regex")}
            pressed={regex}
            onClick={onRegexToggle}
          >
            <span className="font-mono text-xs leading-none">.*</span>
          </FindBarButton>
          {/* The stepping controls, with the match counter slung underneath
              them rather than sitting in the field. In the field it was the
              widest fixture in the pill and it never shrank, so on a phone the
              query — the thing you are actually typing and reading — was down
              to three or four characters. Under the arrows it costs the row no
              width at all, and it sits with the two buttons it describes. */}
          <div className="flex shrink-0 flex-col items-center">
            <div className="flex items-center gap-2">
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
            {/* The line is always rendered, empty query or not, so the bar
                doesn't grow by a row the moment the first character lands. */}
            <span
              title={patternInvalid ? t("app.find.invalidPattern") : undefined}
              className={`h-3.5 leading-none whitespace-nowrap tabular-nums ${
                patternInvalid ? "text-danger" : "text-muted"
              } text-[11px]`}
            >
              {patternInvalid
                ? t("app.find.invalid")
                : query === ""
                  ? ""
                  : none
                    ? t("app.find.none")
                    : t("app.find.count", { index: current + 1, total })}
            </span>
          </div>
        </div>

        {/* The replace row, indented past the chevron so its field lines up
            under the search field and the three buttons sit under the three
            above them — the column is what says the two rows are one control.  */}
        {showReplace && (
          <div className="mt-2 flex items-center gap-2 pl-10">
            <FieldPill>
              <ReplaceIcon className="h-4 w-4 shrink-0 text-muted" />
              <input
                ref={replaceRef}
                type="text"
                value={replacement}
                onChange={(e) => onReplacementChange(e.currentTarget.value)}
                onKeyDown={onReplaceKeyDown}
                placeholder={t("app.find.replacePlaceholder")}
                aria-label={t("app.find.replaceField")}
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellcheck={false}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-muted/60"
              />
            </FieldPill>
            <FindBarButton
              label={t("app.find.replace")}
              disabled={none}
              onClick={onReplace}
            >
              <ReplaceIcon className="h-[18px] w-[18px]" />
            </FindBarButton>
            <FindBarButton
              label={t("app.find.replaceAll")}
              disabled={none}
              onClick={onReplaceAll}
            >
              <ReplaceAllIcon className="h-[18px] w-[18px]" />
            </FindBarButton>
            <FindBarButton
              label={t("app.find.preview")}
              pressed={previewOpen}
              disabled={none}
              onClick={onPreviewToggle}
            >
              <PreviewIcon className="h-[18px] w-[18px]" />
            </FindBarButton>
          </div>
        )}

        {showPreview && <PreviewPanel preview={preview} total={total} />}
      </div>
    </div>
  );
}

/**
 * What a replace-all *would* write, and nothing else — the note is untouched
 * while this is up. One row per affected line, numbered the way the editor's
 * gutter numbers them, with the text each hit takes away struck through and the
 * text it puts there lit in the accent, in place, so the change reads in the
 * context of the line rather than as a pair of before/after blocks.
 */
function PreviewPanel({
  preview,
  total,
}: {
  preview: readonly PreviewLine[];
  total: number;
}) {
  const t = useT();
  const shown = preview.slice(0, PREVIEW_LIMIT);
  const hidden = preview.length - shown.length;
  return (
    <div
      role="region"
      aria-label={t("app.find.previewPanel")}
      className="mt-2 ml-10 rounded-[var(--radius)] border border-line bg-surface-2"
    >
      {/* The scope, above the detail: "how much of my note does this touch" is
          the question the preview exists to answer, and the count answers it
          even when the list below is truncated. There is no plural engine, so
          the one-of-each cases pick their own string. */}
      <p className="border-b border-line px-3 py-1.5 text-xs text-muted">
        {total === 1
          ? t("app.find.previewSummaryOne")
          : preview.length === 1
            ? t("app.find.previewSummaryOneLine", { matches: total })
            : t("app.find.previewSummary", {
                matches: total,
                lines: preview.length,
              })}
      </p>
      <div className="max-h-44 overflow-y-auto overscroll-contain px-3 py-1.5">
        {shown.map((line) => (
          <div key={line.line} className="flex gap-2 py-0.5 text-xs">
            <span className="w-7 shrink-0 pt-px text-right text-muted tabular-nums">
              {line.line + 1}
            </span>
            <span className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap">
              {line.segments.map((segment, i) => (
                <span
                  key={i}
                  className={
                    segment.kind === "removed"
                      ? "text-danger/80 line-through"
                      : segment.kind === "added"
                        ? "rounded-sm bg-accent/20 text-accent"
                        : "text-fg"
                  }
                >
                  {segment.text}
                </span>
              ))}
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <p className="pt-1 pl-9 text-xs text-muted italic">
            {hidden === 1
              ? t("app.find.previewMoreOne")
              : t("app.find.previewMore", { count: hidden })}
          </p>
        )}
      </div>
    </div>
  );
}

/** The rounded field both rows wear, so the two read as one control. */
function FieldPill({
  invalid = false,
  children,
}: {
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 ring-1 ring-inset ${
        invalid ? "ring-danger" : "ring-line focus-within:ring-accent"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * One control in the bar. Like the styling toolbar's buttons these cancel their
 * own `mousedown`, but for the opposite reason: focus must stay in the field
 * being typed in, so stepping through the matches — or replacing one — on a
 * phone never drops the keyboard.
 */
function FindBarButton({
  label,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Set on the two toggles (replace row, preview) so they read as lit. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onClick();
      }}
      // `min-w-8` rather than `w-8`: an icon still gets its 32px square, and the
      // one button whose face is text — `.*` — grows to fit instead of
      // clipping.
      className={`inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-full px-1 transition-colors duration-100 hover:bg-accent/15 hover:text-accent active:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-30 ${
        pressed ? "bg-accent/20 text-accent" : "text-fg"
      }`}
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
