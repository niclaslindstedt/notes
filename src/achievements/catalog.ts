// The achievement catalog — the single source of truth for which features
// are unlockable, what tier each sits in, which glyph it wears, how it reads,
// and how its unlock fires. Display copy (name / condition / learnMore) is
// inlined here rather than routed through an i18n layer, which notes doesn't
// have yet.

import type { Snapshot } from "../domain/note.ts";
import {
  AccessibilityGlyph,
  BoxesGlyph,
  CloudGlyph,
  CodeGlyph,
  EyeOffGlyph,
  FolderGlyph,
  LayersGlyph,
  LockGlyph,
  MedalGlyph,
  MergeGlyph,
  MoveGlyph,
  PaletteGlyph,
  PlusGlyph,
  RefreshGlyph,
  ScaleTextGlyph,
  SmartphoneGlyph,
  TypeGlyph,
  UndoGlyph,
  WandGlyph,
} from "./glyphs.tsx";
import type { Achievement } from "./types.ts";

// ── Pure predicate helpers over the persisted document ─────────────────────
// "First time" achievements derive as `!hasX(prev) && hasX(next)`. Kept inline
// so the catalog is the one file an agent reads when adding an entry.

const noteCount = (snap: Snapshot) => snap.notes.length;
const hasAnyNote = (snap: Snapshot) => noteCount(snap) > 0;

// A note with content on at least two separate lines — the first sign someone
// is writing prose, not just a one-line reminder.
const hasMultiLineNote = (snap: Snapshot) =>
  snap.notes.some(
    (n) => n.body.split("\n").filter((line) => line.trim() !== "").length >= 2,
  );

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ──────────────────────────────────────────────────────────────
  // Beginner — "I just opened the app. What do I do?"
  // ──────────────────────────────────────────────────────────────
  {
    id: "firstNote",
    tier: "beginner",
    glyph: PlusGlyph,
    name: "First note",
    condition: "Write your first note.",
    learnMore:
      "Tap the + button (or press Enter on the empty list) to start a note. Everything you type is saved automatically as you go.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot],
      predicate: (prev, next) =>
        !hasAnyNote(prev.snapshot) && hasAnyNote(next.snapshot),
    },
  },
  {
    id: "wordsmith",
    tier: "beginner",
    glyph: TypeGlyph,
    name: "Wordsmith",
    condition: "Write a note that runs to more than one line.",
    learnMore:
      "The first non-empty line becomes the note's title in the list; everything below it is the body. Notes render Markdown as you write.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot],
      predicate: (prev, next) =>
        !hasMultiLineNote(prev.snapshot) && hasMultiLineNote(next.snapshot),
    },
  },
  {
    id: "interiorDesigner",
    tier: "beginner",
    glyph: PaletteGlyph,
    name: "Interior designer",
    condition: "Switch to a different theme.",
    learnMore:
      "Settings → Appearance offers a range of light and dark editor themes. Your choice is saved on this device (and travels with cloud sync).",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.theme],
      predicate: (prev, next) =>
        prev.appearance.theme !== next.appearance.theme,
    },
  },
  {
    id: "biggerPicture",
    tier: "beginner",
    glyph: ScaleTextGlyph,
    name: "The bigger picture",
    condition: "Change the interface text size.",
    learnMore:
      "Settings → Appearance scales the whole UI up or down, so the app reads comfortably on any screen.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.fontScale],
      predicate: (prev, next) =>
        prev.appearance.fontScale !== next.appearance.fontScale,
    },
  },
  {
    id: "secondThoughts",
    tier: "beginner",
    glyph: UndoGlyph,
    name: "Second thoughts",
    condition: "Undo an edit.",
    learnMore:
      "Use the side menu's Undo (or Ctrl/Cmd+Z) to step back through your edits — creating, deleting, and writing are all reversible.",
    trigger: { kind: "manual" },
  },
  {
    id: "homeScreen",
    tier: "beginner",
    glyph: SmartphoneGlyph,
    name: "Home screen",
    condition: "Install the app to your device.",
    learnMore:
      "notes is a Progressive Web App: add it to your home screen or launcher and it opens full-screen and works offline, just like a native app.",
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Intermediate — "Make it mine."
  // ──────────────────────────────────────────────────────────────
  {
    id: "collector",
    tier: "intermediate",
    glyph: LayersGlyph,
    name: "Collector",
    condition: "Keep five notes at once.",
    learnMore:
      "There's no limit on how many notes you keep. The list sorts the most recently edited to the top so what you're working on stays in reach.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot.notes],
      predicate: (prev, next) =>
        noteCount(prev.snapshot) < 5 && noteCount(next.snapshot) >= 5,
    },
  },
  {
    id: "fontFanatic",
    tier: "intermediate",
    glyph: TypeGlyph,
    name: "Font fanatic",
    condition: "Pick a different font family.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.fontFamily],
      predicate: (prev, next) =>
        prev.appearance.fontFamily !== next.appearance.fontFamily,
    },
  },
  {
    id: "marginalia",
    tier: "intermediate",
    glyph: MoveGlyph,
    name: "Marginalia",
    condition: "Adjust the editor's writing-column margins.",
    learnMore:
      "Settings → Editor narrows the writing column for a more focused, page-like feel — or lets it run the full width of the screen.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.editor.margin],
      predicate: (prev, next) =>
        prev.appearance.editor.margin !== next.appearance.editor.margin,
    },
  },
  {
    id: "plainText",
    tier: "intermediate",
    glyph: CodeGlyph,
    name: "Plain and simple",
    condition: "Turn live Markdown rendering off.",
    learnMore:
      "Prefer raw text? Settings → Editor switches the live preview off so notes stay plain, unformatted source.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.editor.renderMarkdown],
      predicate: (prev, next) =>
        prev.appearance.editor.renderMarkdown &&
        !next.appearance.editor.renderMarkdown,
    },
  },
  {
    id: "compartments",
    tier: "intermediate",
    glyph: BoxesGlyph,
    name: "Compartments",
    condition: "Create a second namespace.",
    learnMore:
      "Namespaces are separate, self-contained sets of notes — work and home, say. Switch between them from the side menu; each can sync to its own folder.",
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Pro — "Make it sync, take it everywhere."
  // ──────────────────────────────────────────────────────────────
  {
    id: "localVault",
    tier: "pro",
    glyph: FolderGlyph,
    name: "Local vault",
    condition: "Connect a folder on your device.",
    learnMore:
      "Settings → Storage can keep each note as a plain Markdown file in a folder you pick, so your notes live as ordinary files you fully own.",
    trigger: { kind: "manual" },
  },
  {
    id: "cloudWalker",
    tier: "pro",
    glyph: CloudGlyph,
    name: "Cloud walker",
    condition: "Connect a cloud backend.",
    learnMore:
      "Connect Dropbox or Google Drive and your notes sync to your own cloud storage, so they follow you to every device you sign in on.",
    trigger: { kind: "manual" },
  },
  {
    id: "freshPull",
    tier: "pro",
    glyph: RefreshGlyph,
    name: "Fresh pull",
    condition: "Reload your notes from the backend.",
    learnMore:
      "The sync details dialog can re-read the document from the connected backend, pulling in edits another device made.",
    trigger: { kind: "manual" },
  },
  {
    id: "peacemaker",
    tier: "pro",
    glyph: MergeGlyph,
    name: "Peacemaker",
    condition: "Resolve a sync conflict.",
    learnMore:
      "When two devices edit the same notes while apart, the app surfaces the clash and lets you keep yours or take theirs — no edits silently lost.",
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Expert — "Bend the app to my exact workflow."
  // ──────────────────────────────────────────────────────────────
  {
    id: "paranoidMode",
    tier: "expert",
    glyph: LockGlyph,
    name: "Paranoid mode",
    condition: "Turn on at-rest encryption.",
    learnMore:
      "Settings → Storage encrypts your notes with a passphrase only you hold. They're sealed on disk and in the cloud until you unlock them.",
    trigger: { kind: "manual" },
  },
  {
    id: "themeWizard",
    tier: "expert",
    glyph: WandGlyph,
    name: "Theme wizard",
    condition: "Build your own custom theme.",
    learnMore:
      "The Custom theme in Settings → Appearance opens every colour, the corner radius, and the row density up to you for a look that's entirely your own.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.theme],
      predicate: (prev, next) =>
        prev.appearance.theme !== "custom" &&
        next.appearance.theme === "custom",
    },
  },
  {
    id: "stillness",
    tier: "expert",
    glyph: AccessibilityGlyph,
    name: "Stillness",
    condition: "Turn on reduced motion.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.customTheme.reduceMotion],
      predicate: (prev, next) =>
        !prev.appearance.customTheme.reduceMotion &&
        next.appearance.customTheme.reduceMotion,
    },
  },
  {
    id: "minimalist",
    tier: "expert",
    glyph: EyeOffGlyph,
    name: "Minimalist",
    condition: "Hide the floating menu button.",
    learnMore:
      "On the installed mobile app you can hide the floating menu button entirely and open the side menu with an inward swipe from the screen edge.",
    trigger: { kind: "manual" },
  },
  {
    id: "completionist",
    tier: "expert",
    glyph: MedalGlyph,
    name: "Completionist",
    condition: "Unlock every other achievement.",
    learnMore:
      "The last trophy on the board — earned the moment you've collected all the others.",
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.achievements],
      predicate: (prev, next) => {
        // Count against the catalog length minus one (this entry itself), so
        // unlocking every *other* achievement fires it without a
        // self-referential loop.
        const totalOthers = ACHIEVEMENTS.length - 1;
        const prevCount = Object.keys(prev.appearance.achievements).length;
        const nextCount = Object.keys(next.appearance.achievements).length;
        return prevCount < totalOthers && nextCount >= totalOthers;
      },
    },
  },
] as const;

// Catalog lookup by id. The watcher hands us ids from the bus and from
// `deriveUnlocks`; both consult this map to skip ids that don't match a known
// entry (forward compatibility for an older build reading newer data, or
// typo-guarding manual `unlock` callers).
export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, Achievement> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
