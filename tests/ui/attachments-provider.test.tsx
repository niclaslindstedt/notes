// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";

import type { Attachment } from "../../src/domain/attachment.ts";
import { AttachmentsProvider } from "../../src/ui/attachments/AttachmentsProvider.tsx";
import { useAttachmentsContext } from "../../src/ui/attachments/context.ts";

afterEach(cleanup);

const PIC: Attachment = { filename: "pic.png", mime: "image/png" };
const DOC: Attachment = { filename: "spec.pdf", mime: "application/pdf" };

// Reports what the surrounding provider makes available, so a test can assert
// on the context rather than on rendered `<img>` plumbing.
function Probe() {
  const ctx = useAttachmentsContext();
  return (
    <>
      <span data-testid="listed">
        {(ctx?.attachments ?? []).map((a) => a.filename).join(",")}
      </span>
      <span data-testid="resolved">
        {ctx?.resolve("attachments/pic.png")?.filename ?? "—"}
      </span>
    </>
  );
}

function mount(body: string | undefined) {
  render(
    <AttachmentsProvider attachments={[PIC, DOC]} body={body}>
      <Probe />
    </AttachmentsProvider>,
  );
  return {
    listed: () => screen.getByTestId("listed").textContent,
    resolved: () => screen.getByTestId("resolved").textContent,
  };
}

describe("AttachmentsProvider", () => {
  it("offers only the attachments the body references", () => {
    const view = mount("![pic](attachments/pic.png)");
    expect(view.listed()).toBe("pic.png");
    expect(view.resolved()).toBe("pic.png");
  });

  it("hides an attachment the note keeps but no longer references", () => {
    // The user erased the reference and kept the file on the backend: the
    // record is still on the note, but there is nothing left to draw.
    const view = mount("just words now");
    expect(view.listed()).toBe("");
    expect(view.resolved()).toBe("—");
  });

  it("brings it straight back when the reference is pasted in again", () => {
    const view = mount(
      "![pic](attachments/pic.png)\n[spec](attachments/spec.pdf)",
    );
    expect(view.listed()).toBe("pic.png,spec.pdf");
    expect(view.resolved()).toBe("pic.png");
  });

  it("falls back to every declared attachment when given no body", () => {
    const view = mount(undefined);
    expect(view.listed()).toBe("pic.png,spec.pdf");
  });
});
