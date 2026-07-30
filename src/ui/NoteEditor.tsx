import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { unlock } from "../achievements/index.ts";
import { type Attachment } from "../domain/attachment.ts";
import { firstChangedLine } from "../domain/line-edit.ts";
import {
  applyFormat,
  lineFormatAt,
  type FormatAction,
  type LineFormat,
} from "../domain/markdown-format.ts";
import { isBlank, type Folder, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import { CipherGlyph } from "./CipherGlyph.tsx";
import { CopyNoteButton } from "./CopyNoteButton.tsx";
import {
  getEditorPosition,
  offsetToPoint,
  pointToOffset,
  setEditorPosition,
} from "./editor-position.ts";
import { FormatToolbar, FormatToolbarButton } from "./FormatToolbar.tsx";
import { SelectPicker } from "./form/SelectPicker.tsx";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
import { useSelectAllShortcut } from "./hooks/useSelectAllShortcut.ts";
import { ArrowLeftIcon, FolderIcon, SpinnerIcon } from "./icons.tsx";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./MarkdownEditor.tsx";

// A compact folder picker for the editor header — the cross-platform way to
// file the open note (drag-to-folder works on a pointer device; this works
// anywhere, including touch). Built on the shared `SelectPicker`; the trigger
// shows the folder glyph plus the current folder's name (or "No folder").
function FolderPicker({
  folders,
  value,
  onChange,
}: {
  folders: Folder[];
  value: string;
  onChange: (folderId: string) => void;
}) {
  const t = useT();
  // The folder name eats scarce header width on a narrow viewport; there, show
  // just the icon. Once the window is wide enough the label comes back.
  const wideEnough = useMediaQuery("(min-width: 640px)");
  const options = [
    { value: "", label: <span className="italic">{t("nav.noFolder")}</span> },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];
  // A note that's in a folder lights its icon up in the accent colour; "no
  // folder" stays muted grey so the filed-vs-unfiled state reads at a glance.
  const filed = value !== "";
  return (
    <SelectPicker
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={t("nav.moveToFolder")}
      renderValue={(o) => (
        <span className="flex items-center gap-1.5">
          <FolderIcon
            className={`h-4 w-4 shrink-0 ${filed ? "text-accent" : "text-muted"}`}
          />
          {wideEnough && (
            <span className="truncate">{o?.label ?? t("nav.noFolder")}</span>
          )}
        </span>
      )}
      triggerClassName={`flex h-9 cursor-pointer items-center gap-1 rounded-[var(--radius)] border border-line bg-transparent px-2 text-left text-sm text-fg hover:border-accent focus-visible:border-accent focus-visible:outline-none ${wideEnough ? "max-w-[9rem]" : ""}`}
      panelClassName="max-h-64 overflow-y-auto"
    />
  );
}

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

/** What the plain-textarea fallback exposes, mirroring the live-preview one. */
type PlainEditorHandle = {
  format: (action: FormatAction) => void;
};

export function Editor({
  note,
  editor,
  folders,
  onBack,
  onMoveFolder,
  onChange,
  onTitleChange,
  onTitleSettle,
  undoScrollSeq = 0,
  syncSlot,
  uploading = false,
  loading = false,
  canAttach,
  onAttach,
}: {
  note: Note;
  editor: EditorSettings;
  /** Folders the note can be filed into, for the header folder picker. */
  folders: Folder[];
  /** Leave the editor and return to the overview (the header back button). */
  onBack: () => void;
  /** File the open note into `folderId`, or out of any folder when `null`. */
  onMoveFolder: (folderId: string | null) => void;
  onChange: (body: string) => void;
  onTitleChange: (title: string) => void;
  onTitleSettle: () => void;
  /** Ticks when undo / redo swaps the body — cues the editor to scroll the
   *  reverted / re-applied region back into view. */
  undoScrollSeq?: number;
  syncSlot: ReactNode;
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
  // The header's action cluster (folder picker, copy, sync), which the body
  // hands focus on to — see `firstAction`.
  const actionsRef = useRef<HTMLDivElement>(null);
  // Handle on the live-preview editor so the title can hand focus down into the
  // body even when no line is active yet (the body has no textarea until then).
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const plainEditorRef = useRef<PlainEditorHandle>(null);
  // The header centres a single-line title against the glyph and the copy/sync
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
  // folder / copy / sync, because that's the order you actually work in: name
  // the note, write it, and only then reach for the toolbar. Document order
  // can't say that — the header (and its buttons) precede the body — so the
  // two editing surfaces are kept out of the browser's sequential order
  // (`tabIndex={-1}`) and focus is moved here instead: Tab in the title drops
  // into the body, Tab in the body climbs to the first header action, and both
  // are reversible with Shift+Tab. Nothing tabs back into the body from the
  // toolbar, so tabbing on past the sync glyph leaves the editor for good.
  function firstAction(): HTMLElement | null {
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
        className={`sticky top-0 z-10 flex gap-2 border-b border-line bg-page-bg/90 px-4 py-3 backdrop-blur pt-[max(0.75rem,env(safe-area-inset-top))] ${titleMultiline ? "items-start" : "items-center"}`}
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
          disableSpellcheck={editor.disableSpellcheck}
          disableAutocorrect={editor.disableAutocorrect}
        />
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
            the handler only redirects Shift+Tab back into the body; the actions
            themselves are the interactive elements. */}
        <div
          ref={actionsRef}
          onKeyDown={onActionsKeyDown}
          className="flex shrink-0 items-center gap-2"
        >
          {folders.length > 0 && (
            <FolderPicker
              folders={folders}
              value={note.folderId ?? ""}
              onChange={(id) => onMoveFolder(id || null)}
            />
          )}
          <FormatToolbarButton open={toolbarOpen} onToggle={toggleToolbar} />
          <CopyNoteButton note={note} copyScope={editor.copyScope} />
          {syncSlot}
        </div>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {/* The toolbar sits *in* the content column rather than floating over
            it: opening it pushes the note's text down, so the line you are
            about to format is never the line it covers. */}
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
            ref={markdownEditorRef}
            body={note.body ?? ""}
            onChange={onChange}
            undoScrollSeq={undoScrollSeq}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
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
            onTabOut={onBodyTab}
            onLineFormat={toolbarOpen ? setLineFormat : undefined}
          />
        ) : (
          <PlainEditor
            ref={plainEditorRef}
            body={note.body ?? ""}
            onChange={onChange}
            onTabOut={onBodyTab}
            onLineFormat={toolbarOpen ? setLineFormat : undefined}
            undoScrollSeq={undoScrollSeq}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={false}
            noteId={note.id}
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
  disableSpellcheck,
  disableAutocorrect,
}: {
  /** Held by the editor, which hands focus back here on Shift+Tab in the body. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (title: string) => void;
  onSettle: () => void;
  /** Leave the title for the note body — Enter, Arrow-Down, or Tab. */
  onFocusBody: () => void;
  focusOnMount: boolean;
  onMultilineChange: (multiline: boolean) => void;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
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
      spellCheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={disableAutocorrect ? "off" : "sentences"}
      placeholder={t("app.titlePlaceholder")}
      onChange={(e) => setDraft(e.target.value)}
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
      className="min-w-0 flex-1 resize-none appearance-none overflow-hidden border-0 bg-transparent p-0 font-[inherit] text-lg font-bold leading-tight text-fg-bright outline-none placeholder:font-bold placeholder:text-muted/60"
    />
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
  maxWidth,
  focusOnMount = true,
  noteId,
  onTabOut,
  onLineFormat,
  ref,
}: {
  body: string;
  onChange: (body: string) => void;
  /** Ticks when undo / redo swaps the body — see the live-preview editor. */
  undoScrollSeq?: number;
  wordWrap: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  maxWidth: string;
  focusOnMount?: boolean;
  /** Keys this note's session-remembered caret / scroll (see `editor-position.ts`). */
  noteId?: string;
  /** Tab / Shift+Tab in the body — see the tab-order note in `Editor`. */
  onTabOut: (backwards: boolean) => void;
  /** Report the caret's line to the styling toolbar; only passed while it's
   *  open, so a closed toolbar never pays for the classification. */
  onLineFormat?: (line: LineFormat | null) => void;
  /** Imperative handle so the toolbar can apply an action here. */
  ref?: Ref<PlainEditorHandle>;
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

  useImperativeHandle(ref, () => ({
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
      pendingSelection.current = {
        from: pointToOffset(next, result.start),
        to: pointToOffset(next, result.end),
      };
      lastOffset.current = pointToOffset(next, result.end);
    },
  }));

  // Keep the toolbar's lit buttons in step with the caret's line. Only runs
  // while the toolbar is open (`onLineFormat` is undefined otherwise), so the
  // Markdown-off editor doesn't parse Markdown for nothing.
  const [caretLine, setCaretLine] = useState(0);
  useEffect(() => {
    onLineFormat?.(lineFormatAt(value.split("\n"), caretLine));
  }, [onLineFormat, value, caretLine]);

  function trackCaret(el: HTMLTextAreaElement) {
    lastOffset.current = el.selectionStart;
    if (onLineFormat)
      setCaretLine(offsetToPoint(el.value, el.selectionStart).line);
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      wrap={wordWrap ? "soft" : "off"}
      spellCheck={!disableSpellcheck}
      autoCorrect={disableAutocorrect ? "off" : "on"}
      autoCapitalize={disableAutocorrect ? "off" : "sentences"}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
        trackCaret(e.target);
      }}
      onSelect={(e) => {
        // Track the caret so switching away and back restores it (and so the
        // styling toolbar knows which line's buttons to light).
        trackCaret(e.currentTarget);
      }}
      onKeyDown={(e) => {
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
