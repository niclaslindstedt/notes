// Tiny inline SVG icon set. The shared glyphs live in
// @niclaslindstedt/oss-framework (same Lucide-traced art this file used to
// inline); this module re-exports them under the app's historical import
// path and keeps only the icons the framework doesn't carry. Each takes a
// `className` so callers control size and colour through Tailwind
// utilities (icons paint with `currentColor`).
export {
  MenuIcon,
  CogIcon,
  CodeIcon,
  ScrollTextIcon,
  HeartIcon,
  ShieldIcon,
  HelpCircleIcon,
  SparklesIcon,
  ArrowLeftIcon,
  ArrowDownIcon,
  PlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  TrashIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  NoteIcon,
  ListIcon,
  PencilIcon,
  SlidersIcon,
  PaletteIcon,
  DatabaseIcon,
  SpinnerIcon,
  CloudIcon,
  CloudCheckIcon,
  CloudUploadIcon,
  CloudAlertIcon,
  CloudOffIcon,
  RefreshIcon,
  ExternalLinkIcon,
  UndoIcon,
  RedoIcon,
  ArchiveIcon,
  LockIcon,
  RestoreIcon,
  SearchIcon,
} from "@niclaslindstedt/oss-framework/components";

type IconProps = { className?: string };

/** A folder with a plus — create a folder. Not in the framework set. */
export function FolderPlusIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

/** A file with a down-arrow — import notes. Not in the framework set. */
export function ImportIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12V5a2 2 0 0 1 2-2h7l5 5v4" />
      <path d="M12 13v8" />
      <path d="m8 17 4 4 4-4" />
    </svg>
  );
}

/**
 * An arrow leaving a tray upward — the editor's export button. Deliberately the
 * mirror of `ImportIcon`'s direction: notes come *down* into the app and go
 * *up* out of it, so the pair reads as one axis. Not in the framework set.
 */
export function ExportIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/**
 * A **file-format badge**: a rounded outline holding the format's letters. The
 * shared frame behind `FilePdfIcon` and `FileMarkdownIcon`, so the two export
 * rows read as one family of format marks rather than as two unrelated
 * pictures.
 *
 * Three decisions here are all about legibility at the ~20px these render at:
 *
 *   * **The letters get the whole glyph.** A page-with-a-corner-fold plus tiny
 *     lettering under it was the obvious first draft and the wrong one — the
 *     letters were unreadable, and an unreadable "PDF" is just a generic page
 *     icon sitting next to a generic file icon.
 *   * **The frame is a hairline**, not the set's usual 2px. A 2px border on a
 *     24-unit box eats the interior, and the lettering ends up wedged against
 *     it. The box is also drawn nearly edge to edge for the same reason.
 *   * **The lettering is filled text**, not stroked paths, which turn to mush
 *     at this size. `fontSize` is per-badge because two letters can be set
 *     larger than three in the same width.
 *
 * Not in the framework set.
 */
function FormatBadge({
  className,
  letters,
  fontSize,
}: IconProps & { letters: string; fontSize: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <rect x="1" y="4.25" width="22" height="15.5" rx="3" />
      <text
        x="12"
        y="15.4"
        textAnchor="middle"
        stroke="none"
        fill="currentColor"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {letters}
      </text>
    </svg>
  );
}

/** The `PDF` format badge — the export menu's PDF row. */
export function FilePdfIcon({ className }: IconProps) {
  return <FormatBadge className={className} letters="PDF" fontSize={9} />;
}

/**
 * The `MD` format badge — the export menu's Markdown row. Spelled out rather
 * than drawn as Markdown's own `M▾` mark: the row it labels says "Export to
 * MD", and a glyph that repeats the row's own word is read instantly, where the
 * downward chevron of the official mark reads as "download" beside it.
 */
export function FileMarkdownIcon({ className }: IconProps) {
  return <FormatBadge className={className} letters="MD" fontSize={11} />;
}

/**
 * A cross inside a circle — the "empty this field" affordance. Deliberately
 * *not* the bare `CloseIcon`: a clear button usually sits a few pixels from a
 * dialog's close button, and two identical crosses side by side read as one
 * control repeated. The ring is what tells them apart at a glance.
 */
export function ClearFieldIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

/**
 * A pair of scissors, the editor's cut button — the one glyph that reads as
 * "take this text away *and* keep it" rather than as deleting it, which is what
 * the trash can already means everywhere else in the app.
 *
 * The blades cross at the same 12,12 centre the rest of the set is drawn
 * around, and the finger holes are hairline circles: at the 18px the header
 * renders it, filled bows would close up into two dots.
 */
export function CutIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.12 8.12 20 20" />
      <path d="M20 4 8.12 15.88" />
    </svg>
  );
}

/**
 * A solid play triangle — the inline YouTube player's press-to-play affordance.
 * Filled rather than stroked like the rest of the set: it sits at 28px on top
 * of a video poster frame, where an outlined triangle disappears into the
 * picture behind it.
 */
export function PlayIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

/** Four corners pushing outward — lift the video player into widescreen. */
export function WidescreenIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Four corners pulling inward — put the widescreen player back in the note. */
export function MinimizeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

/**
 * A wand throwing sparks — the **Transform** rules, which turn one piece of
 * text into another. Not in the framework set.
 */
export function WandIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="m14 6 4 4L7 21l-4-4L14 6Z" />
      <path d="m16 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
      <path d="M6 4v3M4.5 5.5h3" />
      <path d="M19 16v3M17.5 17.5h3" />
    </svg>
  );
}

/** The app's wordmark glyph — a dog-eared note sheet. App-specific. */
export function NotesMarkIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M20 16 H38 L46 24 V48 H20 Z" />
      <path d="M38 16 V24 H46" />
      <path d="M26 31 H40 M26 38 H40" />
    </svg>
  );
}
