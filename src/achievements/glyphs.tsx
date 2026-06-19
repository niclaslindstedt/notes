// Inline SVG glyph set for the achievements feature. The rest of the app
// inlines its icons in `src/ui/icons.tsx` rather than pulling a dependency;
// the achievements catalog needs a handful more, kept here so the catalog
// reads from one self-contained place — adding an achievement that needs a
// fresh glyph touches only this file and the catalog. Chrome icons the app
// already ships (plus / undo / code / cloud / refresh / palette) are
// re-exported from `icons.tsx` so the catalog has a single glyph import.

import type { ReactNode } from "react";

import {
  CloudIcon,
  CodeIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
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

// Re-exports of the chrome icons reused as achievement glyphs, normalised to
// the `Glyph` signature so the catalog imports every glyph from one module.
export const PlusGlyph: Glyph = PlusIcon;
export const UndoGlyph: Glyph = UndoIcon;
export const CodeGlyph: Glyph = CodeIcon;
export const CloudGlyph: Glyph = CloudIcon;
export const RefreshGlyph: Glyph = RefreshIcon;
export const PaletteGlyph: Glyph = PaletteIcon;
