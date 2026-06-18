// The repository's CHANGELOG.md, inlined by Vite as a raw string at build
// time and parsed once into the typed release list the modal renders.
// `?raw` keeps the markdown out of the JS module graph until here; the file
// lives at the repo root, three levels above `src/ui/changelog/`.
import changelogMarkdown from "../../../CHANGELOG.md?raw";

import { type ChangelogRelease, parseChangelog } from "./parse.ts";

export const CHANGELOG: readonly ChangelogRelease[] =
  parseChangelog(changelogMarkdown);
