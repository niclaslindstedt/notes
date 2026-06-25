// Inline SVG glyph set for the achievements feature. The rest of the app
// inlines its icons in `src/ui/icons.tsx` rather than pulling a dependency;
// the achievements catalog needs a handful more, kept here so the catalog
// reads from one self-contained place — adding an achievement that needs a
// fresh glyph touches only this file and the catalog. Chrome icons the app
// already ships (plus / undo / code / cloud / refresh / palette) are
// re-exported from `icons.tsx` so the catalog has a single glyph import.

import type { ReactNode } from "react";

import {
  ArchiveIcon,
  CloudIcon,
  CodeIcon,
  CopyIcon,
  ImportIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  UndoIcon,
} from "../ui/icons.tsx";

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
      focusable={false}
      className={className}
    >
      {children}
    </svg>
  );
}

// ── Chrome glyphs (trophy button, tier headers, locked rows) ──────────────

export function TrophyGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </Svg>
  );
}

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

// ── Tier glyphs ───────────────────────────────────────────────────────────

export function SproutGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 20h10" />
      <path d="M12 20c0-6 0-8 0-10" />
      <path d="M12 10C12 6 9 4 5 4c0 4 3 6 7 6Z" />
      <path d="M12 10c0-3 2-5 6-5 0 3-2 5-6 5Z" />
    </Svg>
  );
}

export function CompassGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </Svg>
  );
}

export function WorkflowGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M7 10v4a2 2 0 0 0 2 2h5" />
    </Svg>
  );
}

export function WandGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m4 20 12-12" />
      <path d="m15 5 1.5 1.5" />
      <path d="M18 3v3M20.5 4.5H17.5" />
      <path d="M19 13v3M20.5 14.5H17.5" />
      <path d="M9 4v2M10 5H8" />
    </Svg>
  );
}

// ── Per-achievement glyphs ─────────────────────────────────────────────────

export function TypeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6V5h16v1" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
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
