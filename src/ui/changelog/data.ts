// The repository's CHANGELOG.md, inlined by Vite as a raw string at build
// time and parsed once into the typed release list the modal renders.
// `?raw` keeps the markdown out of the JS module graph until here; the file
// lives at the repo root, three levels above `src/ui/changelog/`.
import changelogMarkdown from "../../../CHANGELOG.md?raw";

import { FEATURE_DOCS } from "./feature-docs.ts";
import { type ChangelogRelease, parseChangelog } from "./parse.ts";

// A release note's `[Learn more](feature:<slug>)` link, with the space before
// it. History stays as it was written, but a link to a feature doc this build
// leaves out (see `feature-docs.ts` — a removed feature, or one the phone and
// desktop builds don't have) would be a button that does nothing, so the link
// is dropped and the entry kept.
const FEATURE_LINK = /\s*\[[^\]]*\]\(feature:([^)\s]+)\)/g;

export function dropDeadFeatureLinks(
  item: string,
  docs: Readonly<Record<string, unknown>> = FEATURE_DOCS,
): string {
  return item.replace(FEATURE_LINK, (link, slug: string) =>
    docs[slug] ? link : "",
  );
}

export const CHANGELOG: readonly ChangelogRelease[] = parseChangelog(
  changelogMarkdown,
).map((release) => ({
  ...release,
  sections: release.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => dropDeadFeatureLinks(item)),
  })),
}));
