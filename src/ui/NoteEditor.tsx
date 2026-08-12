import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { unlock } from "../achievements/index.ts";
import { type Attachment } from "../domain/attachment.ts";
import { cutLine, firstChangedLine } from "../domain/line-edit.ts";
import {
  applyFormat,
  lineFormatAt,
  type ColumnSpan,
  type FormatAction,
  type LineFormat,
} from "../domain/markdown-format.ts";
import { findMatches, type NoteMatch } from "../domain/note-find.ts";
import { isBlank, type Note } from "../domain/note.ts";
import type { CompiledTransform } from "../domain/transform.ts";
import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import { CipherGlyph } from "./CipherGlyph.tsx";
import { writeClipboard } from "./clipboard.ts";
import { CutButton } from "./CutButton.tsx";
import {
  getEditorPosition,
  offsetToPoint,
  pointToOffset,
  setEditorPosition,
} from "./editor-position.ts";
import { ExportButton } from "./export/ExportButton.tsx";
import { FavoriteButton } from "./FavoriteButton.tsx";
import { FormatToolbar, FormatToolbarButton } from "./FormatToolbar.tsx";
import { useFindShortcut } from "./hooks/useFindShortcut.ts";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
import { useSelectAllShortcut } from "./hooks/useSelectAllShortcut.ts";
import { ArrowLeftIcon, MoreIcon, SpinnerIcon } from "./icons.tsx";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./MarkdownEditor.tsx";
import { NoteFindBar, NoteFindButton } from "./NoteFindBar.tsx";

// What counts as a tab stop inside the header's action cluster — enough to find
// the leftmost one, which is where the body hands focus to (and takes it back
// from on Shift+Tab).
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Whether the styling toolbar is up survives switching notes and reloading,
// under this key: someone who writes in Markdown wants it every time, and
// someone who doesn't should never have to dismiss it twice. Mirrored as a
// plain string, the same way the side menu remembers its collapsed footer.
const TOOLBAR_OPEN_KEY = "notes/format-toolbar";

function readToolbarOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(TOOLBAR_OPEN_KEY) === "true";
}

// Below this width the header stops trying to carry the note's name *and* the
// five action buttons at once and folds the cluster behind a single ⋯ toggle
// (see `MoreButton`). It is Tailwind's `sm` breakpoint from the other side: at
// 640px and up the row fits, and under it the title was being squeezed to a
// couple of words. A media query rather than the pane's own width because the
// editor is the full viewport at every size that collapses — the sidebar only
// docks at 768px, by which point the row fits again.
const COLLAPSE_QUERY = "(max-width: 639px)";

// How wide the folded-out cluster is allowed to grow. Only the animation reads
// it: the buttons size the box, and this cap is what the max-width transition
// travels to (a width of `auto` can't be transitioned). Kept a little above the
// real ~13.25rem so no button is ever clipped at rest — the cost is that the
// slide finishes a hair before the timer does.
const ACTIONS_MAX_WIDTH = "14rem";

// A stable empty hit list for the closed find bar, so the editing surfaces keep
// seeing the identical reference and their per-line memos bail out.
const NO_MATCHES: readonly NoteMatch[] = [];

// The same for a user with no Transform rules: one shared empty list keeps the
// per-line memos bailing out.
const NO_TRANSFORMS: readonly CompiledTransform[] = [];

/** What the plain-textarea fallback exposes, mirroring the live-preview one. */
type PlainEditorHandle = {
  format: (action: FormatAction) => void;
  cut: () => void;
};

export function Editor({
  note,
  editor,
  transforms = NO_TRANSFORMS,
  onBack,
  onChange,
  onTitleChange,
  onTitleSettle,
  onToggleFavorite,
  undoScrollSeq = 0,
  uploading = false,
  loading = false,
  canAttach,
  onAttach,
}: {
  note: Note;
  editor: EditorSettings;
  /** The user's compiled **Transform** rules, applied to the preview for
   *  display only (`domain/transform.ts`). */
  transforms?: readonly CompiledTransform[];
  /** Leave the editor and return to the overview (the header back button). */
  onBack: () => void;
  onChange: (body: string) => void;
  onTitleChange: (title: string) => void;
  onTitleSettle: () => void;
  /** Star / unstar the note — the header's leading star button. */
  onToggleFavorite: () => void;
  /** Ticks when undo / redo swaps the body — cues the editor to scroll the
   *  reverted / re-applied region back into view. */
  undoScrollSeq?: number;
  /** The open note's file is being uploaded — swap the glyph for a spinner. */
  uploading?: boolean;
  /** The note's body is still being decrypted (lazy encrypted backend) — show a
   *  placeholder and withhold the editor so a keystroke can't overwrite it. */
  loading?: boolean;
  canAttach: boolean;
  onAttach: (attachment: Attachment) => void;
}) {
  const t = useT();
  const maxWidth = editorMarginMaxWidth(editor.margin);
  // A brand-new note opens with the caret in the title so it's ready to be
  // named; opening an existing note focuses nothing, so the soft keyboard
  // stays down until the user taps where they want to type. Captured once for
  // mount — typing the title doesn't re-route focus mid-session.
  const titleFirst = useRef(isBlank(note)).current;
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // The header's action cluster (favorite, formatting, cut, export, find),
  // which the body hands focus on to — see `firstAction`.
  const actionsRef = useRef<HTMLDivElement>(null);
  // The ⋯ toggle the cluster folds into on a narrow screen; held so the tab
  // order can point at it while the cluster itself is away.
  const moreRef = useRef<HTMLButtonElement>(null);
  // Handle on the live-preview editor so the title can hand focus down into the
  // body even when no line is active yet (the body has no textarea until then).
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const plainEditorRef = useRef<PlainEditorHandle>(null);
  // The header centres a single-line title against the glyph and the action
  // buttons, and top-aligns once the title wraps so those stay pinned to the
  // first line (the title field reports the transition as it grows).
  const [titleMultiline, setTitleMultiline] = useState(false);

  // The styling toolbar: whether it is up (remembered across notes and
  // reloads), and the block state of the line the caret sits on, which the
  // open toolbar reads to light the buttons already in effect. The editing
  // surface only reports that state while the toolbar is open, so a closed
  // toolbar costs nothing.
  const [toolbarOpen, setToolbarOpen] = useState(readToolbarOpen);
  const [lineFormat, setLineFormat] = useState<LineFormat | null>(null);

  // Find in note: whether the bar is up, what is typed in it, and which hit it
  // is parked on. Deliberately *not* remembered across notes the way the
  // styling toolbar is — a query is about the note you were reading, so opening
  // the next note starts clean.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  // Bumped to pull focus back into an already-open bar — see `openFind`.
  const [findFocusSignal, setFindFocusSignal] = useState(0);

  // The header's action cluster on a narrow screen: five buttons and a note
  // title don't both fit, and the title is what you need to see while reading,
  // so the buttons fold behind a ⋯ toggle and slide back out on a press —
  // taking the title's place while they are out (it is the thing they cover,
  // and the note itself is right below to say which note this is).
  //
  // It is *not* remembered the way the styling toolbar is: the actions are a
  // detour from writing, so every note — and every return to the note — opens
  // with the title showing.
  const narrow = useMediaQuery(COLLAPSE_QUERY);
  const [actionsOpen, setActionsOpen] = useState(false);
  // Folded away: narrow, and not currently held open. The wide header never
  // folds, so it is never "collapsed" no matter what the flag says.
  const collapsed = narrow && !actionsOpen;

  // A window grown past the breakpoint puts every action back in the row on its
  // own, which leaves the held-open flag meaning nothing — drop it, so shrinking
  // back down starts from the title again rather than from a row of buttons.
  useEffect(() => {
    if (!narrow) setActionsOpen(false);
  }, [narrow]);

  function toggleActions() {
    if (!actionsOpen) unlock("elbowRoom");
    setActionsOpen(!actionsOpen);
  }

  // Going back to the note puts the title back: the cluster is a detour, and
  // the press (or the caret) that returns to the body is the end of it. Wired to
  // the body's focus *and* pointer-down, because on a phone a tap into the
  // live-preview surface can land on a line that is already focused.
  function collapseActions() {
    if (actionsOpen) setActionsOpen(false);
  }

  // Every hit in the note, recomputed as the query (or the note) changes. A
  // closed bar matches nothing, so nothing downstream pays for it.
  const matches = useMemo<readonly NoteMatch[]>(
    () => (findOpen ? findMatches(note.body ?? "", query) : NO_MATCHES),
    [findOpen, note.body, query],
  );
  // The cursor is clamped rather than corrected: editing the note (or the
  // query) can shrink the list under it, and clamping keeps the bar on the
  // last hit instead of flipping it back to the first.
  const activeMatch =
    matches.length === 0 ? -1 : Math.min(matchCursor, matches.length - 1);

  function stepMatch(delta: number) {
    if (matches.length === 0) return;
    setMatchCursor((activeMatch + delta + matches.length) % matches.length);
  }

  function openFind() {
    // Already up: don't reopen it (which would throw the query away), just put
    // the caret back in the field with the old query selected — what pressing
    // ⌘F a second time does everywhere else.
    if (findOpen) {
      // Flushed for the same reason the open path below is: the refocus has to
      // land inside the gesture that asked for it, or a soft keyboard won't
      // come back up for it.
      flushSync(() => setFindFocusSignal((n) => n + 1));
      return;
    }
    unlock("pinpoint");
    setMatchCursor(0);
    // Open synchronously *inside this tap* so the bar's mount-time focus (a
    // layout effect) runs within the user gesture — the only context in which
    // iOS raises the soft keyboard for a programmatic focus. The same trick the
    // side menu uses to open the cross-note search modal.
    flushSync(() => setFindOpen(true));
  }

  function toggleFind() {
    if (findOpen) {
      setFindOpen(false);
      return;
    }
    openFind();
  }

  // ⌘F / Ctrl+F is the app's, not the browser's, while a note is open.
  useFindShortcut(openFind);

  function toggleToolbar() {
    setToolbarOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(TOOLBAR_OPEN_KEY, String(next));
      } catch {
        // Storage denied (private mode); the toolbar simply won't be
        // remembered past this session.
      }
      return next;
    });
  }

  // Route a toolbar press to whichever surface is mounted — the live-preview
  // editor, or the plain textarea when Markdown rendering is switched off.
  // Both apply the same pure formatter, so the two agree on what a press does.
  function runFormat(action: FormatAction) {
    unlock("stylist");
    if (editor.renderMarkdown) markdownEditorRef.current?.format(action);
    else plainEditorRef.current?.format(action);
  }

  // The cut button, routed to whichever surface is mounted the same way a
  // toolbar press is. Both apply the same pure `cutLine` and put what it took
  // on the clipboard, so the button and the Ctrl/Cmd+K the surfaces bind
  // themselves cut identically.
  function runCut() {
    if (editor.renderMarkdown) markdownEditorRef.current?.cut();
    else plainEditorRef.current?.cut();
  }

  // Move focus from the title field into the body's editing surface, used when
  // the user presses Enter or Arrow-Down in the title. The live-preview editor
  // opens with no active line (so the note renders fully formatted), so there
  // may be no textarea to focus yet — ask the editor to open one at the end via
  // its handle. The plain editor always has a textarea, so fall back to that.
  function focusBody() {
    const ta = bodyRef.current?.querySelector("textarea");
    if (ta) {
      ta.focus();
      return;
    }
    markdownEditorRef.current?.focus();
  }

  // The editor's tab order is spelled out by hand as back → title → body →
  // favorite / formatting / cut / export / find, because that's the order you
  // work in: name
  // the note, write it, and only then reach for the toolbar. Document order
  // can't say that — the header (and its buttons) precede the body — so the
  // two editing surfaces are kept out of the browser's sequential order
  // (`tabIndex={-1}`) and focus is moved here instead: Tab in the title drops
  // into the body, Tab in the body climbs to the first header action, and both
  // are reversible with Shift+Tab. Nothing tabs back into the body from the
  // toolbar, so tabbing on past the last action leaves the editor for good.
  function firstAction(): HTMLElement | null {
    // Folded away, the cluster's buttons are `visibility: hidden` — nothing in
    // there is a tab stop, so the ⋯ toggle is the header's first action.
    if (collapsed) return moreRef.current;
    return actionsRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  }

  function onBodyTab(backwards: boolean) {
    if (backwards) titleRef.current?.focus();
    else firstAction()?.focus();
  }

  function onActionsKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !e.shiftKey || e.target !== firstAction()) return;
    e.preventDefault();
    focusBody();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The title heads the page, prefixed by a back button — pressing it
          leaves the editor and returns to the overview (the side menu is
          reached the usual ways). The button box matches the title's
          first-line height (leading-tight on text-lg) and centres the icon
          within it, so the two stay vertically aligned even when a long title
          wraps and the header top-aligns the rest. A single-line title centres
          the whole row; once it wraps the header top-aligns so the button and
          the copy/sync buttons stay pinned to the first line. */}
      <header
        className={`sticky top-0 z-10 flex gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))] ${titleMultiline && !actionsOpen ? "items-start" : "items-center"}`}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={t("app.back")}
          title={t("app.back")}
          className="flex h-[1.40625rem] shrink-0 cursor-pointer items-center text-accent outline-none"
        >
          {/* While the open note is being written to the backend, the back
              glyph becomes a spinner so the note you're editing shows its own
              sync state (the header cloud glyph means "any sync", this one
              means "this note"). The button still goes back. */}
          {uploading ? (
            <SpinnerIcon className="h-6 w-6 animate-spin text-muted" />
          ) : (
            <ArrowLeftIcon className="h-6 w-6" />
          )}
        </button>
        <TitleField
          fieldRef={titleRef}
          value={note.title}
          onChange={onTitleChange}
          onSettle={onTitleSettle}
          onFocusBody={focusBody}
          focusOnMount={titleFirst}
          onMultilineChange={setTitleMultiline}
          hidden={actionsOpen}
          disableSpellcheck={editor.disableSpellcheck}
          disableAutocorrect={editor.disableAutocorrect}
          capitaliseSentences={editor.capitaliseSentences}
        />
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
            the handler only redirects Shift+Tab back into the body; the actions
            themselves are the interactive elements. */}
        <div
          ref={actionsRef}
          onKeyDown={onActionsKeyDown}
          className={`ml-auto flex shrink-0 items-center ${narrow ? "" : "gap-2"}`}
        >
          {/* The star leads the cluster — it says something about the note
              itself, so it sits closest to the title — and Find is pinned to
              the far right, past the actions that operate on the note, because
              it opens a bar rather than changing anything.

              On a narrow screen the whole cluster lives in a box that travels
              between 0 and its natural width, clipping what doesn't fit yet, so
              the buttons appear to unfold leftwards out of the ⋯ toggle (the
              box is right-anchored, so growing it walks its content left). The
              third transitioned property is `visibility`, which is what keeps
              the folded-away buttons out of the tab order and off screen
              readers: it flips to hidden only at the *end* of the transition,
              so the closing slide is still visible while it plays. */}
          <div
            className={
              narrow
                ? `flex min-w-0 items-center gap-2 overflow-hidden pr-2 transition-[max-width,opacity,visibility] duration-200 ease-out ${actionsOpen ? "opacity-100" : "invisible opacity-0"}`
                : "flex items-center gap-2"
            }
            style={
              narrow
                ? { maxWidth: actionsOpen ? ACTIONS_MAX_WIDTH : "0px" }
                : undefined
            }
          >
            <FavoriteButton
              favorite={note.favorite === true}
              onToggle={onToggleFavorite}
            />
            <FormatToolbarButton open={toolbarOpen} onToggle={toggleToolbar} />
            {!loading && <CutButton onCut={runCut} />}
            <ExportButton
              note={note}
              copyScope={editor.copyScope}
              transforms={transforms}
            />
            <NoteFindButton open={findOpen} onToggle={toggleFind} />
          </div>
          {narrow && (
            <MoreButton
              buttonRef={moreRef}
              open={actionsOpen}
              onToggle={toggleActions}
            />
          )}
        </div>
      </header>

      {/* Coming back to the note folds the header's action cluster away again —
          see `collapseActions`. Captured on the way down so it fires whichever
          part of the content area was reached (the find bar and the styling
          toolbar both live in here too, and both are a way back to writing). */}
      <div
        ref={bodyRef}
        onFocusCapture={collapseActions}
        onPointerDownCapture={collapseActions}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* The toolbar sits *in* the content column rather than floating over
            it: opening it pushes the note's text down, so the line you are
            about to format is never the line it covers. */}
        {/* The find bar sits above the styling toolbar and below the header —
            closest to the top bar its button lives in. Both can be up at once;
            each pushes the note's text down rather than covering it. */}
        {findOpen && !loading && (
          <NoteFindBar
            query={query}
            onQueryChange={(next) => {
              setQuery(next);
              // A fresh query starts at the first hit; keeping the old cursor
              // would park the bar somewhere arbitrary in the new list.
              setMatchCursor(0);
            }}
            total={matches.length}
            current={activeMatch}
            onNext={() => stepMatch(1)}
            onPrevious={() => stepMatch(-1)}
            onClose={() => setFindOpen(false)}
            maxWidth={maxWidth}
            focusSignal={findFocusSignal}
          />
        )}
        {toolbarOpen && !loading && (
          <FormatToolbar
            line={lineFormat}
            onAction={runFormat}
            maxWidth={maxWidth}
          />
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted">
            <CipherGlyph className="shrink-0 text-accent" />
            {t("app.decrypting")}
          </div>
        ) : editor.renderMarkdown ? (
          <MarkdownEditor
            handleRef={markdownEditorRef}
            body={note.body ?? ""}
            onChange={onChange}
            undoScrollSeq={undoScrollSeq}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            capitaliseSentences={editor.capitaliseSentences}
            maxWidth={maxWidth}
            focusOnMount={false}
            note={note}
            noteId={note.id}
            attachments={note.attachments}
            canAttach={canAttach}
            onAttach={onAttach}
            placement={{
              imagesAtEnd: editor.imagesAtEnd,
              filesAtEnd: editor.filesAtEnd,
            }}
            shortenLinkChars={editor.shortenLinkChars}
            transforms={transforms}
            lineNumbers={editor.lineNumbers}
            onTabOut={onBodyTab}
            onLineFormat={toolbarOpen ? setLineFormat : undefined}
            matches={matches}
            activeMatch={activeMatch}
          />
        ) : (
          <PlainEditor
            handleRef={plainEditorRef}
            body={note.body ?? ""}
            onChange={onChange}
            onTabOut={onBodyTab}
            onLineFormat={toolbarOpen ? setLineFormat : undefined}
            undoScrollSeq={undoScrollSeq}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            capitaliseSentences={editor.capitaliseSentences}
            maxWidth={maxWidth}
            focusOnMount={false}
            noteId={note.id}
            matches={matches}
            activeMatch={activeMatch}
          />
        )}
      </div>
    </div>
  );
}

// The note's title: an auto-growing textarea that heads the editor page,
// sitting inline in the header beside the app glyph so it reads like the
// document's own title (the way checklist heads a list with its name). A long
// title wraps onto further lines and the field grows to fit rather than
// scrolling out of view; a single-line title is centred against the glyph and
// the copy/sync buttons, and once it wraps the header top-aligns so those stay
// pinned to the first line (the field reports the transition via
// onMultilineChange). It is *not* part of the body, so
// backspacing at the start of the body never reaches it. Enter / Arrow-Down /
// Tab hand focus down to the body (and so the field never holds a literal
// newline).
function TitleField({
  fieldRef,
  value,
  onChange,
  onSettle,
  onFocusBody,
  focusOnMount,
  onMultilineChange,
  hidden = false,
  disableSpellcheck,
  disableAutocorrect,
  capitaliseSentences,
}: {
  /** Held by the editor, which hands focus back here on Shift+Tab in the body. */
  fieldRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (title: string) => void;
  onSettle: () => void;
  /** Leave the title for the note body — Enter, Arrow-Down, or Tab. */
  onFocusBody: () => void;
  focusOnMount: boolean;
  onMultilineChange: (multiline: boolean) => void;
  /**
   * The narrow header's folded-out action cluster is standing where the title
   * goes, so take it out of the row entirely (`display: none`, which also drops
   * it from the tab order and the accessibility tree) rather than covering it.
   * The field stays *mounted* through it: unmounting would settle the buffered
   * title, and renaming the note's file is not what pressing ⋯ asked for.
   */
  hidden?: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  capitaliseSentences: boolean;
}) {
  const t = useT();
  const ref = fieldRef;
  const [draft, setDraft] = useState(value);

  // The title is a textarea, not an input, so a long title wraps onto further
  // lines instead of scrolling out of view. It carries no manual resize grip;
  // we grow it to fit its content after every change — collapse to one row,
  // then stretch to the wrapped height — so it reads as a borderless heading
  // that simply gets taller. Enter is still intercepted to hand focus to the
  // body (see onKeyDown), so the field never actually holds a newline.
  const onMultilineRef = useRef(onMultilineChange);
  onMultilineRef.current = onMultilineChange;
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const { scrollHeight } = el;
    el.style.height = `${scrollHeight}px`;
    // Tell the header whether the title now spans more than one line so it can
    // switch from centring the row to top-aligning it. p-0 means scrollHeight is
    // pure line height, so anything past ~1.5 lines is a genuine wrap.
    const lineHeight =
      parseFloat(getComputedStyle(el).lineHeight) || scrollHeight;
    onMultilineRef.current(scrollHeight > lineHeight * 1.5);
  }, [ref]);
  useLayoutEffect(resize, [draft, resize]);

  // Title edits are buffered locally and only pushed upward — which schedules a
  // save and, on the file/cloud backends, *renames* the note's file (the
  // filename is a slug of the title) — when the field loses focus or the editor
  // closes. Pushing on every keystroke renamed the file once per character, and
  // a mid-rename network blip left the directory half-written, which the sync
  // layer then read back as a remote edit and surfaced as a phantom conflict.
  // One rename per editing session keeps the file churn (and the conflicts) away
  // without changing that the filename still tracks the title.
  const committed = useRef(value);
  const latest = useRef(draft);
  latest.current = draft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flush = useCallback(() => {
    // Trim on commit so a stored title never starts or ends with a space (the
    // domain enforces this too); spaces are still free to type mid-edit. Reflect
    // the trimmed value back into the field so it shows what was actually saved.
    const trimmed = latest.current.trim();
    if (trimmed === committed.current) return;
    committed.current = trimmed;
    if (trimmed !== latest.current) {
      latest.current = trimmed;
      setDraft(trimmed);
    }
    onChangeRef.current(trimmed);
  }, []);

  // The title settling — losing focus, or the editor tearing down — both
  // commits the buffered title *and* signals that it's now safe to write the
  // file (the save was held while the title was in flux so a fresh note's file
  // is born with the right name). Flush first so the committed title is in the
  // document before the held save drains.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const settle = useCallback(() => {
    flush();
    onSettleRef.current();
  }, [flush]);

  // Focus the title on mount for a fresh note (without the a11y-flagged
  // focusOnMount attribute) and select its default title, so the first
  // keystroke replaces it — a new note opens ready to be named.
  useEffect(() => {
    if (!focusOnMount) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusOnMount, ref]);

  // Clicking (or tabbing) into the title selects the whole thing, so it can be
  // renamed by just typing — no manual drag-select or erase first. The browser
  // otherwise collapses the focus-time selection to the caret on the click's
  // mouseup, so we suppress that one mouseup (only the click that *gained*
  // focus, leaving later clicks free to reposition the caret as usual). A fresh
  // note's mount-focus selects the default title the same way, so it opens
  // ready to be typed over.
  const focusingClick = useRef(false);

  // Settle the buffered title when the editor unmounts — the Back button and
  // switching notes both tear it down, and on those paths a blur doesn't
  // reliably fire first.
  useEffect(() => settle, [settle]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      spellcheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={
        disableAutocorrect || !capitaliseSentences ? "off" : "sentences"
      }
      placeholder={t("app.titlePlaceholder")}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={settle}
      onMouseDown={(e) => {
        if (document.activeElement !== e.currentTarget)
          focusingClick.current = true;
      }}
      onFocus={(e) => e.currentTarget.select()}
      onMouseUp={(e) => {
        if (focusingClick.current) {
          e.preventDefault();
          focusingClick.current = false;
        }
      }}
      onKeyDown={(e) => {
        // Tab leaves for the note itself, not the header's buttons: naming a
        // note and then writing it is one motion, and the toolbar is the tab
        // stop *after* the body (see the tab-order note in `Editor`).
        const tabbingOut = e.key === "Tab" && !e.shiftKey;
        if (e.key === "Enter" || e.key === "ArrowDown" || tabbingOut) {
          e.preventDefault();
          onFocusBody();
        }
      }}
      className={`min-w-0 flex-1 resize-none appearance-none overflow-hidden border-0 bg-transparent p-0 font-[inherit] text-lg font-bold leading-tight text-fg-bright outline-none placeholder:font-bold placeholder:text-muted/60 ${hidden ? "hidden" : ""}`}
    />
  );
}

// The narrow header's ⋯ toggle: the editor's whole action cluster folded into
// one control, so a phone-width header can show the note's name instead of five
// glyphs. Pressed, it unfolds the cluster over the title; pressed again — or
// touched anywhere in the note — it folds back.
//
// It wears the same lit-when-open treatment as the formatting and find toggles,
// because that is what it is: a control that holds a surface open. And like
// them it cancels its own mousedown, so unfolding the row doesn't cost the caret
// the buttons behind it are about to act on.
function MoreButton({
  open,
  onToggle,
  buttonRef,
}: {
  open: boolean;
  onToggle: () => void;
  /** Named `buttonRef`, not `ref`: Preact reserves `ref` for the renderer. */
  buttonRef: RefObject<HTMLButtonElement>;
}) {
  const t = useT();
  const label = open ? t("app.actions.hide") : t("app.actions.show");
  return (
    <button
      ref={buttonRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onToggle();
      }}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        open
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      <MoreIcon className="h-[18px] w-[18px]" />
    </button>
  );
}

// The Markdown-off fallback: a single full-height textarea. Still honours the
// margin (writing-column width) and word-wrap preferences.
function PlainEditor({
  body,
  onChange,
  undoScrollSeq = 0,
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  capitaliseSentences,
  maxWidth,
  focusOnMount = true,
  noteId,
  onTabOut,
  onLineFormat,
  matches = NO_MATCHES,
  activeMatch = -1,
  handleRef,
}: {
  body: string;
  onChange: (body: string) => void;
  /** Ticks when undo / redo swaps the body — see the live-preview editor. */
  undoScrollSeq?: number;
  wordWrap: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  /** Ask the keyboard for a capital at the start of a sentence. A textarea is
   *  never intercepted, so here the platform's own shortcut still does the
   *  work — the setting only decides whether to ask for it. */
  capitaliseSentences: boolean;
  maxWidth: string;
  focusOnMount?: boolean;
  /** Keys this note's session-remembered caret / scroll (see `editor-position.ts`). */
  noteId?: string;
  /** Tab / Shift+Tab in the body — see the tab-order note in `Editor`. */
  onTabOut: (backwards: boolean) => void;
  /** Report the caret's line to the styling toolbar; only passed while it's
   *  open, so a closed toolbar never pays for the classification. */
  onLineFormat?: (line: LineFormat | null) => void;
  /** The find bar's hits. A textarea can't paint them, so only the one the bar
   *  is parked on shows — as the field's own selection (see below). */
  matches?: readonly NoteMatch[];
  /** Index into `matches` of the hit the bar is parked on, or -1 for none. */
  activeMatch?: number;
  /**
   * Imperative handle so the toolbar can apply an action here. Named
   * `handleRef`, not `ref`: Preact reserves `ref` for the renderer (it is
   * lifted off props before the component sees it) and only replays it as a
   * prop through `forwardRef`, so a handle passed as `ref` would never arrive.
   */
  handleRef?: Ref<PlainEditorHandle>;
}) {
  const t = useT();
  const [value, setValue] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Where the caret / scroll were the last time this note was left this session,
  // read once on mount (the editor is keyed by note id, so it remounts per note).
  const [saved] = useState(() => (noteId ? getEditorPosition(noteId) : null));
  // Latest caret offset / scroll, kept current so the unmount handler can stash
  // them for the next open.
  const lastOffset = useRef<number>(
    saved?.caret ? pointToOffset(body, saved.caret) : 0,
  );
  const lastScrollTop = useRef<number>(saved?.scrollTop ?? 0);

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open. Our own keystrokes echo back through `onChange` to the
  // same string, so a `body` that differs from the local value can only be
  // another writer's edit arriving during the live-pull quiet window.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (body !== valueRef.current) setValue(body);
  }, [body]);

  // Reveal the region an undo / redo changed. On a tick (a real content apply —
  // a timeline-edge no-op never fires), stash the first line that differs
  // between the incoming body and the text still on screen; the value effect
  // below scrolls the textarea to it once the new value has rendered. The
  // keyboard undo shortcut stands down inside a textarea, so a timeline undo
  // here only comes from the side-menu button, with the textarea unfocused.
  const lastUndoSeqRef = useRef(undoScrollSeq);
  const pendingScrollLineRef = useRef<number | null>(null);
  useEffect(() => {
    if (undoScrollSeq === lastUndoSeqRef.current) return;
    lastUndoSeqRef.current = undoScrollSeq;
    pendingScrollLineRef.current = firstChangedLine(valueRef.current, body);
  }, [undoScrollSeq, body]);
  useEffect(() => {
    const line = pendingScrollLineRef.current;
    if (line === null) return;
    pendingScrollLineRef.current = null;
    scrollTextareaToLine(textareaRef.current, line);
  }, [value]);

  // Focus the editor on open without the focusOnMount prop (which a11y
  // linting flags) — placing the caret at the end so editing an existing
  // note continues where it left off. Skipped when the title field takes
  // focus instead (a brand-new note).
  useEffect(() => {
    if (!focusOnMount) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusOnMount]);

  // Reopen the note where it was left this session: with a caret remembered,
  // place it (focusing the textarea raises the soft keyboard on phones so the
  // caret lands in the right spot); then restore the scroll offset. The textarea
  // owns its own caret reveal, so the browser keeps the caret clear of the
  // keyboard within the smaller viewport.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !saved) return;
    if (saved.caret) {
      const offset = pointToOffset(el.value, saved.caret);
      el.focus();
      el.setSelectionRange(offset, offset);
      unlock("whereYouLeftOff");
    }
    setScrollTop(el, saved.scrollTop);
  }, [saved]);

  // Stash the caret / scroll for this note as the editor unmounts — a note
  // switch remounts it, and the mount effect above reads this back.
  useEffect(() => {
    return () => {
      if (!noteId) return;
      setEditorPosition(noteId, {
        caret: offsetToPoint(valueRef.current, lastOffset.current),
        scrollTop: lastScrollTop.current,
      });
    };
  }, [noteId]);

  // Ctrl/Cmd+A pressed while the textarea doesn't hold focus — the opening
  // state of an existing note — would otherwise select the whole page (title
  // and chrome included) instead of the note body.
  useSelectAllShortcut(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  });

  // --- Find in note --------------------------------------------------------
  //
  // A textarea can't carry per-match markup, so the plain fallback shows the
  // hit the find bar is parked on as the field's *own* selection — which the
  // browser paints (greyed while the field is unfocused) — and scrolls it into
  // view. Every hit is still counted, so the bar's "3 of 12" is honest; only
  // the "all matches at once" tint is beyond a textarea.
  //
  // Focus is put back where it was afterwards: some browsers focus a field on
  // `setSelectionRange`, and stealing focus out of the find field mid-search
  // would drop the soft keyboard on a phone.
  const hit = activeMatch >= 0 ? matches[activeMatch] : undefined;
  const hitLine = hit?.line ?? null;
  const hitFrom = hit?.from ?? null;
  const hitTo = hit?.to ?? null;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || hitLine === null || hitFrom === null || hitTo === null) return;
    const focused = document.activeElement;
    el.setSelectionRange(
      pointToOffset(el.value, { line: hitLine, col: hitFrom }),
      pointToOffset(el.value, { line: hitLine, col: hitTo }),
    );
    if (focused instanceof HTMLElement && document.activeElement !== focused)
      focused.focus();
    scrollTextareaToLine(el, hitLine);
  }, [hitLine, hitFrom, hitTo]);

  // --- The styling toolbar -------------------------------------------------
  //
  // Markdown-off is still Markdown *source*, so the toolbar applies here too —
  // through the same pure formatter the live-preview editor uses, with the
  // caret and selection converted between the textarea's flat offsets and the
  // `(line, column)` points the formatter speaks. The selection it hands back
  // is installed once the new value has rendered, so wrapping a word leaves it
  // highlighted rather than dropping the caret at the end of the note.
  const pendingSelection = useRef<{ from: number; to: number } | null>(null);
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    const el = textareaRef.current;
    if (!sel || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel.from, sel.to);
  }, [value]);

  // The cut button and its Ctrl/Cmd+K shortcut, through the same pure engine
  // the live-preview editor uses — the textarea always has a real caret, so
  // there is always a line to point at. As there, the clipboard write is
  // fire-and-forget: a refused clipboard must not hold up the edit.
  function cut() {
    const el = textareaRef.current;
    if (!el) return;
    const source = el.value;
    const result = cutLine(
      source.split("\n"),
      offsetToPoint(source, el.selectionStart),
      offsetToPoint(source, el.selectionEnd),
    );
    if (!result) return;
    void writeClipboard(result.text);
    unlock("guillotine");
    const next = result.lines.join("\n");
    setValue(next);
    onChange(next);
    const caret = pointToOffset(next, result.caret);
    pendingSelection.current = { from: caret, to: caret };
    lastOffset.current = caret;
  }

  useImperativeHandle(handleRef ?? null, () => ({
    format: (action: FormatAction) => {
      const el = textareaRef.current;
      if (!el) return;
      const source = el.value;
      const result = applyFormat(
        source.split("\n"),
        {
          start: offsetToPoint(source, el.selectionStart),
          end: offsetToPoint(source, el.selectionEnd),
        },
        action,
      );
      const next = result.lines.join("\n");
      setValue(next);
      onChange(next);
      const from = pointToOffset(next, result.start);
      const to = pointToOffset(next, result.end);
      pendingSelection.current = { from, to };
      lastOffset.current = to;
      // Report the selection the press left behind rather than waiting for it
      // to be installed, so the button it lit (or put out) is right at once.
      if (onLineFormat) markCaret(next, from, to);
    },
    cut,
  }));

  // Keep the toolbar's lit buttons in step with the caret. The line decides the
  // block buttons; the columns decide the inline ones (Bold lights up inside a
  // `**…**` run), so a move *within* a line has to report too — hence the whole
  // selection rather than just its line. Only runs while the toolbar is open
  // (`onLineFormat` is undefined otherwise), so the Markdown-off editor doesn't
  // parse Markdown for nothing.
  const [caret, setCaret] = useState<{
    line: number;
    span: ColumnSpan | null;
  }>({ line: 0, span: { from: 0, to: 0 } });
  useEffect(() => {
    onLineFormat?.(lineFormatAt(value.split("\n"), caret.line, caret.span));
  }, [onLineFormat, value, caret]);

  // A selection across lines covers no single line's columns, so it reports the
  // line it starts on and no span — nothing inline can enclose it.
  function markCaret(source: string, from: number, to: number) {
    const start = offsetToPoint(source, from);
    const end = offsetToPoint(source, to);
    const next =
      start.line === end.line
        ? { line: start.line, span: { from: start.col, to: end.col } }
        : { line: start.line, span: null };
    setCaret((cur) =>
      cur.line === next.line &&
      cur.span?.from === next.span?.from &&
      cur.span?.to === next.span?.to
        ? cur
        : next,
    );
  }

  function trackCaret(el: HTMLTextAreaElement) {
    lastOffset.current = el.selectionStart;
    if (onLineFormat) markCaret(el.value, el.selectionStart, el.selectionEnd);
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      wrap={wordWrap ? "soft" : "off"}
      spellcheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={
        disableAutocorrect || !capitaliseSentences ? "off" : "sentences"
      }
      onChange={(e) => {
        setValue(e.currentTarget.value);
        onChange(e.currentTarget.value);
        trackCaret(e.currentTarget);
      }}
      // Track the caret so switching away and back restores it (and so the
      // styling toolbar knows which line's buttons to light). `select` alone
      // isn't enough: browsers emit it when a *range* is selected, not when a
      // click or an arrow key merely moves a collapsed caret. React papered
      // over that by synthesising `onSelect` from mouse/key activity; Preact
      // hands through the DOM event as-is, so the two gestures that move a
      // caret without selecting anything are listened for directly.
      onSelect={(e) => trackCaret(e.currentTarget)}
      onMouseUp={(e) => trackCaret(e.currentTarget)}
      onKeyUp={(e) => trackCaret(e.currentTarget)}
      onKeyDown={(e) => {
        // Ctrl/Cmd+K cuts at the caret — the keyboard twin of the header's
        // cut button, taken from the browser (which aims it at the address
        // bar) only while the note body holds focus.
        if (
          (e.metaKey || e.ctrlKey) &&
          !e.altKey &&
          !e.shiftKey &&
          e.key.toLowerCase() === "k"
        ) {
          e.preventDefault();
          cut();
          return;
        }
        // Tab moves on rather than indenting; the editor owns where to (see the
        // tab-order note in `Editor`).
        if (e.key !== "Tab") return;
        e.preventDefault();
        onTabOut(e.shiftKey);
      }}
      // Held out of the browser's sequential tab order — the title tabs into
      // it and `onTabOut` tabs out (see the tab-order note in `Editor`).
      tabIndex={-1}
      onScroll={(e) => {
        lastScrollTop.current = e.currentTarget.scrollTop;
      }}
      placeholder={t("app.startWriting")}
      style={maxWidth === "none" ? undefined : { maxWidth }}
      className={`mx-auto w-full flex-1 resize-none overscroll-contain bg-page-bg px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg outline-none placeholder:text-muted/60 ${
        wordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
      }`}
    />
  );
}

// Restore the textarea's scroll offset when reopening a note. A plain helper
// (rather than an inline `el.scrollTop = …` in the effect) keeps the value being
// mutated out of the effect's closure — which the immutability lint rule forbids
// — and degrades to a harmless assignment under jsdom, which has no layout.
function setScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

// Scroll a plain textarea so the source line at `index` is on screen — the
// anchor an undo / redo scrolls the fallback editor to. Left alone when the line
// already sits within the visible band so an on-screen revert doesn't jump; when
// it's off screen the line is centred. The offset is estimated from the line
// height (exact without word wrap; a soft-wrapped line lands close enough to
// bring the change into view), and reduced motion turns the glide into a jump.
function scrollTextareaToLine(
  el: HTMLTextAreaElement | null,
  index: number,
): void {
  if (!el || index < 0) return;
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
  const top = index * lineHeight;
  if (top >= el.scrollTop && top + lineHeight <= el.scrollTop + el.clientHeight)
    return;
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  el.scrollTo({
    top: Math.max(0, top - el.clientHeight / 2),
    behavior: reduceMotion ? "auto" : "smooth",
  });
}
