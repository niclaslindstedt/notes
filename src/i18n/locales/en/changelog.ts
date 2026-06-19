import type { Widen } from "./_widen.ts";

// Strings for the "What's new" changelog dialog opened from the side menu.
// Section labels (Added / Changed / …) come straight from the
// Keep-a-Changelog source and are intentionally not translated.

const changelog = {
  heading: "Changelog",
  empty: "No releases yet.",
} as const;

export type ChangelogCatalog = Widen<typeof changelog>;

export default changelog;
