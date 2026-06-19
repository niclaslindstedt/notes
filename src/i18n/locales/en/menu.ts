import type { Widen } from "./_widen.ts";

// Strings for the footer of the side drawer — settings, the changelog
// dialog, and the project links.

const menu = {
  settings: "Settings",
  changelog: "What's new",
  privacy: "Privacy",
  source: "Source",
  donate: "Donate",
} as const;

export type MenuCatalog = Widen<typeof menu>;

export default menu;
