// The achievement catalog — the single source of truth for which features
// are unlockable, what tier each sits in, which glyph it wears, and how its
// unlock fires. Display copy (name / condition / optional learnMore) lives in
// the `achievements` i18n namespace (`src/i18n/locales/{en,sv}/achievements.ts`)
// under `achievements.catalog.<id>.*`; the renderer composes the lookup by id.
// `learnMore: true` flags entries that carry an expanded body.

import { isImageAttachment } from "../domain/attachment.ts";
import type { Snapshot } from "../domain/note.ts";
import {
  AccessibilityGlyph,
  ArchiveGlyph,
  BoxesGlyph,
  BroadcastGlyph,
  BroomGlyph,
  CloudGlyph,
  CodeGlyph,
  CopyGlyph,
  EyeOffGlyph,
  FlaskGlyph,
  FolderGlyph,
  GlobeGlyph,
  ImageGlyph,
  ImportGlyph,
  LayersGlyph,
  LockGlyph,
  MedalGlyph,
  MergeGlyph,
  MoveGlyph,
  PaletteGlyph,
  PanelBottomGlyph,
  PaperclipGlyph,
  PlusGlyph,
  RefreshGlyph,
  ScaleTextGlyph,
  ShieldGlyph,
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

// A note that has been given a title in its own field — the first time someone
// uses the dedicated title row rather than letting a note stay untitled.
const hasTitledNote = (snap: Snapshot) =>
  snap.notes.some((n) => n.title.trim() !== "");

// A note that has been swiped into the archive — the first time someone tidies
// a note away without deleting it.
const hasArchivedNote = (snap: Snapshot) => snap.notes.some((n) => n.archived);

// A note that carries an image attachment — the first time someone pastes or
// drops a picture into a note (only possible on a folder / cloud backend).
const hasAttachment = (snap: Snapshot) =>
  snap.notes.some((n) =>
    (n.attachments ?? []).some((a) => isImageAttachment(a)),
  );

// A note that carries a non-image file attachment — the first time someone
// pastes or drops a file (a PDF, an archive, …) into a note.
const hasFileAttachment = (snap: Snapshot) =>
  snap.notes.some((n) =>
    (n.attachments ?? []).some((a) => !isImageAttachment(a)),
  );

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ──────────────────────────────────────────────────────────────
  // Beginner — "I just opened the app. What do I do?"
  // ──────────────────────────────────────────────────────────────
  {
    id: "firstNote",
    tier: "beginner",
    glyph: PlusGlyph,
    learnMore: true,
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
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot],
      predicate: (prev, next) =>
        !hasMultiLineNote(prev.snapshot) && hasMultiLineNote(next.snapshot),
    },
  },
  {
    id: "headliner",
    tier: "beginner",
    glyph: TypeGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot.notes],
      predicate: (prev, next) =>
        !hasTitledNote(prev.snapshot) && hasTitledNote(next.snapshot),
    },
  },
  {
    id: "interiorDesigner",
    tier: "beginner",
    glyph: PaletteGlyph,
    learnMore: true,
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
    learnMore: true,
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
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "homeScreen",
    tier: "beginner",
    glyph: SmartphoneGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Intermediate — "Make it mine."
  // ──────────────────────────────────────────────────────────────
  {
    id: "collector",
    tier: "intermediate",
    glyph: LayersGlyph,
    learnMore: true,
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
    learnMore: true,
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
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.editor.renderMarkdown],
      predicate: (prev, next) =>
        prev.appearance.editor.renderMarkdown &&
        !next.appearance.editor.renderMarkdown,
    },
  },
  {
    id: "freehand",
    tier: "intermediate",
    glyph: TypeGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [
        s.appearance.editor.disableSpellcheck,
        s.appearance.editor.disableAutocorrect,
      ],
      predicate: (prev, next) =>
        (!prev.appearance.editor.disableSpellcheck &&
          next.appearance.editor.disableSpellcheck) ||
        (!prev.appearance.editor.disableAutocorrect &&
          next.appearance.editor.disableAutocorrect),
    },
  },
  {
    id: "namingConvention",
    tier: "intermediate",
    glyph: TypeGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.appearance.editor.defaultTitle],
      predicate: (prev, next) =>
        prev.appearance.editor.defaultTitle !==
        next.appearance.editor.defaultTitle,
    },
  },
  {
    id: "appendix",
    tier: "intermediate",
    glyph: PanelBottomGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [
        s.appearance.editor.imagesAtEnd,
        s.appearance.editor.filesAtEnd,
      ],
      predicate: (prev, next) =>
        (!prev.appearance.editor.imagesAtEnd &&
          next.appearance.editor.imagesAtEnd) ||
        (!prev.appearance.editor.filesAtEnd &&
          next.appearance.editor.filesAtEnd),
    },
  },
  {
    id: "tidyUp",
    tier: "intermediate",
    glyph: BroomGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [
        s.appearance.editor.trimTrailingSpaces,
        s.appearance.editor.trailingNewline,
      ],
      predicate: (prev, next) =>
        prev.appearance.editor.trimTrailingSpaces !==
          next.appearance.editor.trimTrailingSpaces ||
        prev.appearance.editor.trailingNewline !==
          next.appearance.editor.trailingNewline,
    },
  },
  {
    id: "archivist",
    tier: "intermediate",
    glyph: ArchiveGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot.notes],
      predicate: (prev, next) =>
        !hasArchivedNote(prev.snapshot) && hasArchivedNote(next.snapshot),
    },
  },
  {
    id: "compartments",
    tier: "intermediate",
    glyph: BoxesGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "polyglot",
    tier: "intermediate",
    glyph: GlobeGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "importer",
    tier: "intermediate",
    glyph: ImportGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "copycat",
    tier: "intermediate",
    glyph: CopyGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Pro — "Make it sync, take it everywhere."
  // ──────────────────────────────────────────────────────────────
  {
    id: "localVault",
    tier: "pro",
    glyph: FolderGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "cloudWalker",
    tier: "pro",
    glyph: CloudGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "freshPull",
    tier: "pro",
    glyph: RefreshGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "peacemaker",
    tier: "pro",
    glyph: MergeGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "pictureThis",
    tier: "pro",
    glyph: ImageGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot.notes],
      predicate: (prev, next) =>
        !hasAttachment(prev.snapshot) && hasAttachment(next.snapshot),
    },
  },
  {
    id: "paperTrail",
    tier: "pro",
    glyph: PaperclipGlyph,
    learnMore: true,
    trigger: {
      kind: "derived",
      slices: (s) => [s.snapshot.notes],
      predicate: (prev, next) =>
        !hasFileAttachment(prev.snapshot) && hasFileAttachment(next.snapshot),
    },
  },
  {
    id: "liveSync",
    tier: "pro",
    glyph: BroadcastGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },

  // ──────────────────────────────────────────────────────────────
  // Expert — "Bend the app to my exact workflow."
  // ──────────────────────────────────────────────────────────────
  {
    id: "paranoidMode",
    tier: "expert",
    glyph: LockGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "fortKnox",
    tier: "expert",
    glyph: ShieldGlyph,
    learnMore: true,
    // Fired when the background migration finishes sealing every note + all its
    // attachments at rest (the green lock on every note).
    trigger: { kind: "manual" },
  },
  {
    id: "themeWizard",
    tier: "expert",
    glyph: WandGlyph,
    learnMore: true,
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
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "underTheHood",
    tier: "expert",
    glyph: CodeGlyph,
    learnMore: true,
    trigger: { kind: "manual" },
  },
  {
    id: "holodeck",
    tier: "expert",
    glyph: FlaskGlyph,
    trigger: { kind: "manual" },
  },
  {
    id: "completionist",
    tier: "expert",
    glyph: MedalGlyph,
    learnMore: true,
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
