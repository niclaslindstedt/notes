// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../../src/domain/note.ts";
import { SearchModal } from "../../src/ui/SearchModal.tsx";

const snapshot: Snapshot = {
  notes: [
    {
      id: "1",
      title: "Grocery list",
      body: "milk, eggs",
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

describe("SearchModal", () => {
  it("focuses the search input when it opens", async () => {
    render(
      <SearchModal
        open
        onClose={vi.fn()}
        snapshot={snapshot}
        onOpen={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    // The Modal moves focus to its card first; the field claims it a frame
    // later, so wait for that to settle.
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <SearchModal
        open={false}
        onClose={vi.fn()}
        snapshot={snapshot}
        onOpen={vi.fn()}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
