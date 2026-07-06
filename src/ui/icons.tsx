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
      focusable={false}
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
      focusable={false}
      className={className}
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12V5a2 2 0 0 1 2-2h7l5 5v4" />
      <path d="M12 13v8" />
      <path d="m8 17 4 4 4-4" />
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
      focusable={false}
      className={className}
    >
      <path d="M20 16 H38 L46 24 V48 H20 Z" />
      <path d="M38 16 V24 H46" />
      <path d="M26 31 H40 M26 38 H40" />
    </svg>
  );
}
