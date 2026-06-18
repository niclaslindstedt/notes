import { describe, expect, it } from "vitest";

import { parseFeatureDoc } from "../../src/ui/changelog/feature-docs.ts";
import { parseChangelog } from "../../src/ui/changelog/parse.ts";

describe("parseChangelog", () => {
  it("parses releases newest-first with their date and sections", () => {
    const md = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "## [0.2.0] - 2026-06-18",
      "",
      "### Added",
      "",
      "- A new feature.",
      "- Another one.",
      "",
      "### Fixed",
      "",
      "- A bug.",
      "",
      "## [0.1.0] - 2026-01-01",
      "",
      "### Added",
      "",
      "- Initial scaffold.",
    ].join("\n");

    const releases = parseChangelog(md);
    expect(releases.map((r) => r.version)).toEqual(["0.2.0", "0.1.0"]);

    const [latest] = releases;
    expect(latest!.date).toBe("2026-06-18");
    expect(latest!.sections).toEqual([
      { type: "Added", items: ["A new feature.", "Another one."] },
      { type: "Fixed", items: ["A bug."] },
    ]);
  });

  it("drops the empty Unreleased stub", () => {
    const releases = parseChangelog(
      "## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- Ship it.",
    );
    expect(releases.map((r) => r.version)).toEqual(["1.0.0"]);
  });

  it("keeps an Unreleased section that actually has content", () => {
    const releases = parseChangelog(
      "## [Unreleased]\n\n### Added\n\n- Pending change.",
    );
    expect(releases).toHaveLength(1);
    expect(releases[0]!.version).toBe("Unreleased");
    expect(releases[0]!.date).toBeNull();
  });

  it("joins a wrapped bullet's continuation lines", () => {
    const releases = parseChangelog(
      "## [1.0.0] - 2026-01-01\n\n### Added\n\n- A bullet that\n  wraps across lines.",
    );
    expect(releases[0]!.sections[0]!.items).toEqual([
      "A bullet that\nwraps across lines.",
    ]);
  });

  it("ignores unknown section headings", () => {
    const releases = parseChangelog(
      "## [1.0.0] - 2026-01-01\n\n### Bogus\n\n- Not a real kind.\n\n### Added\n\n- Real.",
    );
    expect(releases[0]!.sections).toEqual([
      { type: "Added", items: ["Real."] },
    ]);
  });
});

describe("parseFeatureDoc", () => {
  it("splits the leading H1 title from the body", () => {
    const doc = parseFeatureDoc(
      "storage",
      "# Storage backends\n\nPick where notes live.",
    );
    expect(doc).toEqual({
      slug: "storage",
      title: "Storage backends",
      body: "Pick where notes live.",
    });
  });

  it("skips leading blank lines before the title", () => {
    const doc = parseFeatureDoc("x", "\n\n# Title\n\nBody.");
    expect(doc.title).toBe("Title");
    expect(doc.body).toBe("Body.");
  });

  it("falls back to the slug when there is no leading heading", () => {
    const doc = parseFeatureDoc("namespaces", "Just prose, no heading.");
    expect(doc.title).toBe("namespaces");
    expect(doc.body).toBe("Just prose, no heading.");
  });

  it("normalises CRLF line endings", () => {
    const doc = parseFeatureDoc("x", "# Title\r\n\r\nLine one.\r\nLine two.");
    expect(doc.title).toBe("Title");
    expect(doc.body).toBe("Line one.\nLine two.");
  });
});
