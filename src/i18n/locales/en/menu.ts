import type { Widen } from "./_widen.ts";

// Strings for the footer of the side drawer — settings, the changelog
// dialog, and the About links.

const menu = {
  settings: "Settings",
  about: "About",
  changelog: "What's new",
  privacy: "Privacy",
  donate: "Donate",
} as const;

export type MenuCatalog = Widen<typeof menu>;

export default menu;
