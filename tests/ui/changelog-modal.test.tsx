// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangelogModal } from "../../src/ui/changelog/ChangelogModal.tsx";

// Smoke-tests the modal end to end: it imports the real CHANGELOG.md (via
// `data.ts`) and the bundled feature docs (via `feature-docs.ts`), so a render
// exercises the parsers, the inline/block renderers, and the feature drill-down
// wiring together.

describe("ChangelogModal", () => {
  it("renders the release list with the latest shipped version", () => {
    render(<ChangelogModal open onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Changelog" })).toBeTruthy();
    // The repo's CHANGELOG ships at least the 0.2.0 release.
    expect(screen.getByText("0.2.0")).toBeTruthy();
  });

  it("drills into a feature doc via a Learn more link and back again", () => {
    render(<ChangelogModal open onClose={vi.fn()} />);
    // Several release notes now carry `[Learn more](feature:…)` links; clicking
    // any one drills into its feature doc, so take the first.
    const [learnMore] = screen.getAllByRole("button", { name: "Learn more" });
    fireEvent.click(learnMore!);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Changelog" })).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ChangelogModal open={false} onClose={vi.fn()} />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
