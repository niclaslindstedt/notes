// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import type { Attachment } from "../../src/domain/attachment.ts";
import { AttachmentRemovalModal } from "../../src/ui/AttachmentRemovalModal.tsx";

afterEach(cleanup);

const PIC: Attachment = { filename: "pic.png", mime: "image/png" };
const DOC: Attachment = { filename: "spec.pdf", mime: "application/pdf" };

function mount(attachments: Attachment[], backend: "dropbox" | "folder") {
  const onResolve = vi.fn();
  render(
    <AttachmentRemovalModal
      attachments={attachments}
      backend={backend}
      onResolve={onResolve}
    />,
  );
  return onResolve;
}

describe("AttachmentRemovalModal", () => {
  it("names the file and the backend holding it", () => {
    mount([PIC], "dropbox");
    expect(
      screen.getByText("Remove the attachment from Dropbox too?"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "“pic.png” is no longer used by this note, but the file is still in Dropbox.",
      ),
    ).toBeTruthy();
  });

  it("lists them and reads in the plural for several at once", () => {
    mount([PIC, DOC], "folder");
    expect(
      screen.getByText("Remove the attachments from your notes folder too?"),
    ).toBeTruthy();
    expect(screen.getByText("pic.png")).toBeTruthy();
    expect(screen.getByText("spec.pdf")).toBeTruthy();
  });

  it("answers yes only from the delete button", () => {
    const onResolve = mount([PIC], "dropbox");
    fireEvent.click(screen.getByRole("button", { name: "Delete the file" }));
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  it("keeps the file from the keep button", () => {
    const onResolve = mount([PIC], "dropbox");
    fireEvent.click(screen.getByRole("button", { name: "Keep the file" }));
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it("treats Escape as keeping the file, never as deleting it", () => {
    const onResolve = mount([PIC], "dropbox");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith(false);
    expect(onResolve).not.toHaveBeenCalledWith(true);
  });
});
