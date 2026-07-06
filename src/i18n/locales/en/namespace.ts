import type { Widen } from "./_widen.ts";

// Strings for the namespace management dialog — the named buckets that each
// hold their own note document. The switcher in the side menu handles the
// common "switch namespace" path; this modal is the full add / rename /
// appearance / delete surface. Generic verbs (close/cancel/save/create/
// confirm/delete) come from `common.*`.

const namespace = {
  heading: "Namespaces",
  blurb:
    "A namespace is a self-contained group of notes. Switch between them to keep, say, personal and shared notes apart. Each namespace can carry its own icon and colour.",
  newLabel: "New namespace",
  nameLabel: "Namespace name",
  namePlaceholder: "e.g. Work, Family",
  colorLabel: "Colour",
  glyphLabel: "Icon",
  switchTo: "Switch to {name}",
  rename: "Rename",
  deleteAction: "Delete namespace",
  deleteConfirm: "Delete “{name}” and all of its notes? This can't be undone.",
  nameRequired: "A name is required",
  defaultBadge: "Default",
  noIcon: "No icon",
  newColorPrefix: "New namespace colour",
  newGlyphNone: "New namespace, no icon",
  newGlyphPrefix: "New namespace icon",
} as const;

export type NamespaceCatalog = Widen<typeof namespace>;

export default namespace;
