import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { type Attachment } from "../domain/attachment.ts";
import { isBlank, type Folder, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { editorMarginMaxWidth, type EditorSettings } from "../theme/themes.ts";
import { CipherGlyph } from "./CipherGlyph.tsx";
import { CopyNoteButton } from "./CopyNoteButton.tsx";
import { SelectPicker } from "./form/SelectPicker.tsx";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
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

export function Editor({
  note,
  editor,
  folders,
  onBack,
  onMoveFolder,
  onChange,
  onTitleChange,
  onTitleSettle,
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
  // Handle on the live-preview editor so the title can hand focus down into the
  // body even when no line is active yet (the body has no textarea until then).
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  // The header centres a single-line title against the glyph and the copy/sync
  // buttons, and top-aligns once the title wraps so those stay pinned to the
  // first line (the title field reports the transition as it grows).
  const [titleMultiline, setTitleMultiline] = useState(false);

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
          value={note.title}
          onChange={onTitleChange}
          onSettle={onTitleSettle}
          onEnter={focusBody}
          focusOnMount={titleFirst}
          onMultilineChange={setTitleMultiline}
          disableSpellcheck={editor.disableSpellcheck}
          disableAutocorrect={editor.disableAutocorrect}
        />
        <div className="flex shrink-0 items-center gap-2">
          {folders.length > 0 && (
            <FolderPicker
              folders={folders}
              value={note.folderId ?? ""}
              onChange={(id) => onMoveFolder(id || null)}
            />
          )}
          <CopyNoteButton note={note} copyScope={editor.copyScope} />
          {syncSlot}
        </div>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
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
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={false}
            note={note}
            attachments={note.attachments}
            canAttach={canAttach}
            onAttach={onAttach}
            placement={{
              imagesAtEnd: editor.imagesAtEnd,
              filesAtEnd: editor.filesAtEnd,
            }}
            shortenLinkChars={editor.shortenLinkChars}
          />
        ) : (
          <PlainEditor
            body={note.body ?? ""}
            onChange={onChange}
            wordWrap={editor.wordWrap}
            disableSpellcheck={editor.disableSpellcheck}
            disableAutocorrect={editor.disableAutocorrect}
            maxWidth={maxWidth}
            focusOnMount={false}
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
// backspacing at the start of the body never reaches it. Enter / Arrow-Down
// hand focus down to the body (and so the field never holds a literal newline).
function TitleField({
  value,
  onChange,
  onSettle,
  onEnter,
  focusOnMount,
  onMultilineChange,
  disableSpellcheck,
  disableAutocorrect,
}: {
  value: string;
  onChange: (title: string) => void;
  onSettle: () => void;
  onEnter: () => void;
  focusOnMount: boolean;
  onMultilineChange: (multiline: boolean) => void;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
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
  }, []);
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
  }, [focusOnMount]);

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
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          onEnter();
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
  wordWrap,
  disableSpellcheck,
  disableAutocorrect,
  maxWidth,
  focusOnMount = true,
}: {
  body: string;
  onChange: (body: string) => void;
  wordWrap: boolean;
  disableSpellcheck: boolean;
  disableAutocorrect: boolean;
  maxWidth: string;
  focusOnMount?: boolean;
}) {
  const t = useT();
  const [value, setValue] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Adopt an out-of-band change to this note's body — a live cloud pull while
  // the note is open. Our own keystrokes echo back through `onChange` to the
  // same string, so a `body` that differs from the local value can only be
  // another writer's edit arriving during the live-pull quiet window.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (body !== valueRef.current) setValue(body);
  }, [body]);

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
      }}
      placeholder={t("app.startWriting")}
      style={maxWidth === "none" ? undefined : { maxWidth }}
      className={`mx-auto w-full flex-1 resize-none bg-page-bg px-4 py-4 text-fg outline-none placeholder:text-muted/60 ${
        wordWrap ? "whitespace-pre-wrap" : "whitespace-pre"
      }`}
    />
  );
}
