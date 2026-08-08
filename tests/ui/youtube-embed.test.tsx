// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { classifyLines } from "../../src/domain/markdown.ts";
import { RenderedLine } from "../../src/ui/MarkdownLine.tsx";

afterEach(cleanup);

const ID = "dQw4w9WgXcQ";

// Render one source line exactly as the live preview does.
function renderLine(source: string) {
  return render(<RenderedLine block={classifyLines(source)[0]!} />);
}

function poster(container: Element): HTMLImageElement | null {
  return container.querySelector("img");
}

function player(container: Element): HTMLIFrameElement | null {
  return container.querySelector("iframe");
}

describe("YouTube links in a rendered line", () => {
  it("renders a bare link as a player card, not an anchor", () => {
    const { container } = renderLine(
      `https://m.youtube.com/watch?v=${ID}&ra=m`,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(poster(container)?.src).toBe(
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    );
    // Nothing is loaded from YouTube until the video is actually played.
    expect(player(container)).toBeNull();
  });

  it("keeps the link's source span for click-to-caret and selection", () => {
    const url = `https://youtu.be/${ID}`;
    const { container } = renderLine(`- ${url}`);
    const card = container.querySelector("[data-len]")!;
    expect(card.getAttribute("data-src")).toBe("2");
    expect(card.getAttribute("data-len")).toBe(String(url.length));
  });

  it("loads the no-cookie player, from the timestamp, on play", () => {
    const { container } = renderLine(`https://youtu.be/${ID}?t=90`);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(player(container)?.src).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=90&rel=0&playsinline=1`,
    );
  });

  it("lifts the same player element into widescreen and back", () => {
    const { container } = renderLine(`https://youtu.be/${ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const iframe = player(container);
    fireEvent.click(screen.getByRole("button", { name: "Widescreen" }));
    const stage = container.querySelector(".fixed")!;
    expect(stage.className).toContain("backdrop-blur");
    // The very same node, so the video plays on through the transition.
    expect(player(container)).toBe(iframe);
    fireEvent.click(screen.getByRole("button", { name: "Exit widescreen" }));
    expect(container.querySelector(".fixed")).toBeNull();
    expect(player(container)).toBe(iframe);
  });

  it("closes widescreen on Escape and on a backdrop click", () => {
    const { container } = renderLine(`https://youtu.be/${ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Widescreen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".fixed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Widescreen" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(container.querySelector(".fixed")).toBeNull();
  });

  it("starts the video when it goes wide without having been played", () => {
    const { container } = renderLine(`https://youtu.be/${ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Widescreen" }));
    expect(player(container)).not.toBeNull();
  });

  it("leaves a labelled link, and a non-YouTube link, as anchors", () => {
    const labelled = renderLine(`[the song](https://youtu.be/${ID})`);
    expect(labelled.container.querySelector("a")?.textContent).toBe("the song");
    cleanup();
    const other = renderLine("https://example.com/watch?v=whatever");
    expect(other.container.querySelector("a")).not.toBeNull();
  });

  it("stays an anchor while the find bar has a hit on it", () => {
    const url = `https://youtu.be/${ID}`;
    const { container } = render(
      <RenderedLine
        block={classifyLines(url)[0]!}
        highlights={[{ from: 0, to: 5, active: true }]}
      />,
    );
    expect(container.querySelector("a")?.textContent).toBe(url);
  });
});
