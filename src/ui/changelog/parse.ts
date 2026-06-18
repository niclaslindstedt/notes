// Keep-a-Changelog parser. Runs at module load over the raw `CHANGELOG.md`
// text Vite inlines (`?raw`) — the changelog is small and only the menu's
// "What's new" modal reads it, so a build-time codegen step would be more
// machinery than the feature warrants. Pure and DOM-free so it is trivially
// testable.

export type ChangelogEntryType =
  | "Added"
  | "Changed"
  | "Fixed"
  | "Removed"
  | "Security"
  | "Deprecated";

export interface ChangelogSection {
  type: ChangelogEntryType;
  items: string[];
}

export interface ChangelogRelease {
  // "Unreleased" or a semver like "0.2.0".
  version: string;
  // ISO date (YYYY-MM-DD) the release went out, or null for Unreleased.
  date: string | null;
  sections: ChangelogSection[];
}

const VERSION_RE = /^## \[([^\]]+)\](?:\s*[-—–]\s*(\d{4}-\d{2}-\d{2}))?/;
const SECTION_RE = /^### (Added|Changed|Fixed|Removed|Security|Deprecated)\s*$/;
const TYPES: ReadonlySet<ChangelogEntryType> = new Set([
  "Added",
  "Changed",
  "Fixed",
  "Removed",
  "Security",
  "Deprecated",
]);

export function parseChangelog(md: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let curRelease: ChangelogRelease | null = null;
  let curSection: ChangelogSection | null = null;
  let bullet: string[] = [];

  const flushBullet = () => {
    if (bullet.length && curSection) {
      curSection.items.push(bullet.join("\n").trim());
    }
    bullet = [];
  };
  const flushSection = () => {
    flushBullet();
    if (curSection && curRelease) curRelease.sections.push(curSection);
    curSection = null;
  };
  const flushRelease = () => {
    flushSection();
    if (curRelease) releases.push(curRelease);
    curRelease = null;
  };

  for (const line of md.split("\n")) {
    const vm = VERSION_RE.exec(line);
    if (vm) {
      flushRelease();
      // Group 1 is always present when VERSION_RE matches; `?? ""`
      // only satisfies `noUncheckedIndexedAccess`.
      curRelease = { version: vm[1] ?? "", date: vm[2] ?? null, sections: [] };
      continue;
    }
    const sm = SECTION_RE.exec(line);
    if (sm) {
      flushSection();
      const type = sm[1] as ChangelogEntryType;
      if (TYPES.has(type)) curSection = { type, items: [] };
      continue;
    }
    if (!curRelease) continue;
    if (/^- /.test(line)) {
      flushBullet();
      bullet = [line.replace(/^- /, "")];
      continue;
    }
    if (/^\s+\S/.test(line) && bullet.length) {
      bullet.push(line.trim());
      continue;
    }
    if (line.trim() === "") {
      flushBullet();
      continue;
    }
  }
  flushRelease();
  // Drop the empty "[Unreleased]" stub so the modal shows a clean
  // "no releases yet" state between releases instead of a bare heading.
  return releases.filter(
    (r) => !(r.version === "Unreleased" && r.sections.length === 0),
  );
}
