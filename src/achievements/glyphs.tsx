// Inline SVG glyph set for the achievements feature. The rest of the app
// inlines its icons in `src/ui/icons.tsx` rather than pulling a dependency;
// the achievements catalog needs a handful more, kept here so the catalog
// reads from one self-contained place — adding an achievement that needs a
// fresh glyph touches only this file and the catalog. Chrome icons the app
// already ships (plus / undo / code / cloud / refresh / palette) are
// re-exported from `icons.tsx` so the catalog has a single glyph import.

import type { ReactNode } from "react";

export {
  TrophyGlyph,
  SproutGlyph,
  CompassGlyph,
  WorkflowGlyph,
  WandGlyph,
} from "@niclaslindstedt/oss-framework/achievements";

import {
  ArchiveIcon,
  CloudIcon,
  CodeIcon,
  CopyIcon,
  CutIcon,
  ExportIcon,
  FilePdfIcon,
  ImportIcon,
  MoreIcon,
  PaletteIcon,
  PlusIcon,
  PreviewIcon,
  RefreshIcon,
  ReplaceAllIcon,
  ScrollTextIcon,
  SearchIcon,
  UndoIcon,
} from "../ui/icons.tsx";
import {
  FormatIcon,
  IndentGlyph as IndentFormatIcon,
  LinkGlyph as LinkFormatIcon,
  QuoteGlyph as QuoteFormatIcon,
} from "../ui/format-glyphs.tsx";

// Every glyph is a function component taking an optional `className`, so a
// caller controls size and colour through Tailwind utilities (the strokes
// paint with `currentColor`). Matches `src/ui/icons.tsx`'s `IconProps`.
export type Glyph = (props: { className?: string }) => ReactNode;

type IconProps = { className?: string };

// Shared 24×24 stroked-icon frame so each glyph below is just its paths.
function Svg({ className, children }: IconProps & { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

// ── Chrome glyphs (trophy button, tier headers, locked rows) ──────────────

export function LockGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

// A shield with a check — every note sealed at rest (the green-lock milestone).
export function ShieldGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

// A key — the passphrase handed across devices (encryption enabled on one
// device asking to be unlocked on another).
// A door with a keypad: the namespace PIN. Distinct from `LockGlyph` (at-rest
// encryption) and `KeyGlyph` (the passphrase handoff) on purpose — the PIN is a
// gate you walk through, not a seal on the bytes.
export function DoorGlyph({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <circle cx="13" cy="12" r="1" />
    </svg>
  );
}

export function KeyGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8" />
      <path d="M16 16l2-2" />
      <path d="M18.5 18.5l1.5-1.5" />
    </Svg>
  );
}

// ── Tier glyphs ───────────────────────────────────────────────────────────

// ── Per-achievement glyphs ─────────────────────────────────────────────────

// An open eye — the editor's read-only lock, which is about looking without
// touching rather than about secrecy. The padlock `LockGlyph` is spoken for by
// encryption at rest (its trophy is Paranoid mode), and the two must not be
// mistaken for each other.
export function EyeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7s-9-4.5-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function TypeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6V5h16v1" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </Svg>
  );
}

// A bold "B" — the emphasis marks the editor keeps painted on the line being
// typed, delimiters and all.
export function BoldGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </Svg>
  );
}

export function ScaleTextGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 17 7 7l4 10" />
      <path d="M4.5 14h5" />
      <path d="M15 19v-7M15 12l3-3 3 3" />
    </Svg>
  );
}

export function SmartphoneGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </Svg>
  );
}

export function ServerGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Svg>
  );
}

export function LayersGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  );
}

export function MoveGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3v18M5 10l-2 2 2 2M19 10l2 2-2 2M10 5l2-2 2 2M10 19l2 2 2-2" />
      <path d="M3 12h18" />
    </Svg>
  );
}

// A funnel — the "Local dialect" trophy for narrowing a transform rule down
// to a single namespace.
export function FunnelGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 4h18l-7 8v7l-4 2v-9z" />
    </Svg>
  );
}

export function BoxesGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function FolderGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

// A folder with notes filed inside it — the "Filing system" trophy for
// grouping notes into folders within a namespace.
export function FolderTreeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 4h4l1.5 2H21a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 11h8M8 15h5" />
    </Svg>
  );
}

export function MergeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="5" r="2" />
      <circle cx="7" cy="19" r="2" />
      <path d="M7 7v10" />
      <path d="M7 11h6a4 4 0 0 0 4-4V6" />
      <path d="M14 9l3-3 3 3" />
    </Svg>
  );
}

export function BroadcastGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" />
    </Svg>
  );
}

export function AccessibilityGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="5" r="1.5" />
      <path d="M5 8h14" />
      <path d="M12 7v6" />
      <path d="m9 21 3-7 3 7" />
    </Svg>
  );
}

export function EyeOffGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.7 5.1A11 11 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.2 3.1" />
      <path d="M6.3 6.3A13 13 0 0 0 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </Svg>
  );
}

export function GlobeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </Svg>
  );
}

export function MedalGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 3 6 8M16 3l2 5" />
      <path d="M9 3h6l-2.5 6h-1z" />
      <circle cx="12" cy="15" r="6" />
      <path d="M12 12.5 13 14.5 15 14.7 13.5 16 14 18 12 17 10 18 10.5 16 9 14.7 11 14.5z" />
    </Svg>
  );
}

// A framed picture with a sun and a mountain — the image-attachment glyph.
export function ImageGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 22" />
    </Svg>
  );
}

// A screen with a play triangle — the inline video glyph (a YouTube link in a
// note renders as a player you can watch without leaving the note).
export function VideoGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M10 9.5v3l3-1.5z" />
      <path d="M8 21h8" />
    </Svg>
  );
}

// A broom sweeping — the format-on-save glyph (tidy a note as it's saved:
// trim trailing spaces, end with a newline).
export function BroomGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m21 3-7.5 7.5" />
      <path d="M12.5 9.5 6 16a3 3 0 0 0-1 2.5L4 21l2.5-1a3 3 0 0 0 2.5-1l6.5-6.5z" />
      <path d="m9 13 2 2" />
      <path d="m11.5 10.5 2 2" />
    </Svg>
  );
}

// A paperclip — the file-attachment glyph (paste or drop a non-image file
// into a note and it rides along as a downloadable attachment).
// A page with a question mark: a file in the notes folder the app can't match
// to a note, waiting on the user to say what it is.
export function FileQuestionGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 12.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.8-.8 1.4v.3" />
      <path d="M12 19h.01" />
    </Svg>
  );
}

export function PaperclipGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.234 20.252 21 12.3a4.243 4.243 0 0 0-6-6L5.764 15.7a2.829 2.829 0 0 0 4 4l7.07-7.071a1.414 1.414 0 0 0-2-2L7.93 17.5" />
    </Svg>
  );
}

// A panel with a filled foot — the "attachments at the end" glyph (collect a
// note's images / files into a block at the bottom rather than inline).
export function PanelBottomGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15h18" />
    </Svg>
  );
}

// A panel with a narrow left column and an arrow pointing back into it — the
// "fold the sidebar away" glyph (collapse the docked side menu to its rail).
export function PanelLeftGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M16 9l-3 3 3 3" />
    </Svg>
  );
}

// Two stacked panels — the note-list layout glyph (switch the overview between
// the compact rows and the taller, multi-line cards).
export function CardsGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
    </Svg>
  );
}

// A conical lab flask — the "Fake data" / holodeck glyph (a generated sample
// dataset to experiment with).
export function FlaskGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 2v6.292a2 2 0 0 1-.293 1.045L4.06 18.71A1 1 0 0 0 4.92 20.2h14.16a1 1 0 0 0 .86-1.49l-5.647-9.373A2 2 0 0 1 14 8.292V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </Svg>
  );
}

// A bookmark — the "pick up where you left off" glyph (a note reopens at the
// caret and scroll position you left it at this session).
export function BookmarkGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

// An arrow cursor — the desktop right-click menu glyph (the gesture that, on a
// computer, replaces the touch swipe on a note row).
export function MousePointerGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12.586 12.586 19 19" />
      <path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z" />
    </Svg>
  );
}

// A clock wound backwards — the browser-history glyph (Back / Forward stepping
// through the notes you visited).
export function HistoryGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

// A dashed frame with an I-beam through it — a run of selected text, which is
// what puts the editor's selection actions in the header.
export function TextSelectGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M21 19a2 2 0 0 1-2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h2" />
      <path d="M13 21h2" />
      <path d="M3 9v2" />
      <path d="M21 13v2" />
      <path d="M10 8h4" />
      <path d="M12 8v8" />
      <path d="M10 16h4" />
    </Svg>
  );
}

// A magnifier over a stack of text lines — finding text *inside* the open
// note, as opposed to the plain magnifier that searches across every note.
export function TextSearchGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 5h16" />
      <path d="M4 10h6" />
      <path d="M4 19h6" />
      <circle cx="15.5" cy="14.5" r="4" />
      <path d="M18.5 17.5 21.5 20.5" />
    </Svg>
  );
}

// A dot and an asterisk — the find bar's `.*` switch, which reads the search as
// a regular expression. The one glyph in the set that is a *quotation* of the
// feature rather than a picture of it, because the feature's own face is those
// two characters, here drawn large enough to read as artwork.
export function RegexGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="5.5" cy="17" r="1.8" fill="currentColor" stroke="none" />
      <path d="M15 5v13" />
      <path d="m9.4 8.2 11.2 6.6" />
      <path d="m20.6 8.2-11.2 6.6" />
    </Svg>
  );
}

// One box turning into another across an arrow — a Transform rule, which
// takes the text it matches and shows something else in its place.
export function ReplaceGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="7" height="6" rx="1" />
      <rect x="14" y="14" width="7" height="6" rx="1" />
      <path d="M6.5 10v5a2 2 0 0 0 2 2h2" />
      <path d="m8.5 15 2 2-2 2" />
      <path d="M17.5 14V9a2 2 0 0 0-2-2h-2" />
      <path d="m15.5 9-2-2 2-2" />
    </Svg>
  );
}

// Numbered rules down a left margin — the editor's line-number gutter.
export function ListOrderedGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 6h11" />
      <path d="M10 12h11" />
      <path d="M10 18h11" />
      <path d="M4 4h1v4" />
      <path d="M4 8h2" />
      <path d="M3.5 15a1.5 1.5 0 1 1 2.6 1L3.5 20H6.5" />
    </Svg>
  );
}

// A tick inside a box — a task item's checkbox, ticked off.
export function CheckSquareGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
      <path d="m8.5 11.5 3 3 8-8.5" />
    </Svg>
  );
}

// Three lines of prose, the last one stopped short by a fat dot — a sentence
// ended. The dot is a zero-length path: a round cap paints it as a circle, so
// it needs no fill in an otherwise stroke-only set.
export function FullStopGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h7" />
      <path d="M15 18h0" strokeWidth={3.5} />
    </Svg>
  );
}

// A capital A beside an arrow pointing up — a letter raised to upper case.
export function CapitalGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 18 7.5 7 12 18" />
      <path d="M4.4 14.5h6.2" />
      <path d="M17.5 19V9" />
      <path d="m14 12.5 3.5-3.5 3.5 3.5" />
    </Svg>
  );
}

// A five-point star — the favorites mark. Drawn here rather than re-exported
// from `icons.tsx` so the trophy wears the solid star (a badge for something
// earned), while the header button keeps the outline/filled pair that shows
// one note's state.
export function StarGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        fill="currentColor"
        d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"
      />
    </Svg>
  );
}

// Re-exports of the chrome icons reused as achievement glyphs, normalised to
// the `Glyph` signature so the catalog imports every glyph from one module.
export const ArchiveGlyph: Glyph = ArchiveIcon;
export const ImportGlyph: Glyph = ImportIcon;
export const PlusGlyph: Glyph = PlusIcon;
export const UndoGlyph: Glyph = UndoIcon;
export const CodeGlyph: Glyph = CodeIcon;
export const CloudGlyph: Glyph = CloudIcon;
export const RefreshGlyph: Glyph = RefreshIcon;
export const PaletteGlyph: Glyph = PaletteIcon;
export const CopyGlyph: Glyph = CopyIcon;
export const SearchGlyph: Glyph = SearchIcon;
// The two find-bar buttons wear their own trophies, so pressing the button and
// earning the trophy show the same picture.
export const ReplaceAllGlyph: Glyph = ReplaceAllIcon;
export const PreviewGlyph: Glyph = PreviewIcon;
export const ScrollTextGlyph: Glyph = ScrollTextIcon;
export const FormatGlyph: Glyph = FormatIcon;
export const LinkGlyph: Glyph = LinkFormatIcon;
export const QuoteGlyph: Glyph = QuoteFormatIcon;
export const IndentGlyph: Glyph = IndentFormatIcon;
export const CutGlyph: Glyph = CutIcon;
export const ExportGlyph: Glyph = ExportIcon;
export const PdfGlyph: Glyph = FilePdfIcon;
export const MoreGlyph: Glyph = MoreIcon;
