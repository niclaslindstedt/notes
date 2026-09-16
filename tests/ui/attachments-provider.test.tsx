// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

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

// The selection a picture takes when it is clicked, and the keys that then act
// on it. Driven through the context rather than through a rendered thumbnail,
// so the test is about the rule and not about the markup.
function SelectionProbe() {
  const ctx = useAttachmentsContext();
  return (
    <>
      <span data-testid="selected">{ctx?.selected ?? "—"}</span>
      <span data-testid="editable">{String(ctx?.editable ?? false)}</span>
      <button type="button" onClick={() => ctx?.select("pic.png")}>
        select
      </button>
    </>
  );
}

function mountSelectable(opts: {
  body?: string;
  onDelete?: (filename: string) => void;
}) {
  const view = render(
    <AttachmentsProvider
      attachments={[PIC, DOC]}
      body={opts.body ?? "![pic](attachments/pic.png)"}
      onDelete={opts.onDelete}
    >
      <SelectionProbe />
    </AttachmentsProvider>,
  );
  const select = () => fireEvent.click(screen.getByText("select"));
  const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document, { key, ...init });
  return {
    view,
    select,
    press,
    selected: () => screen.getByTestId("selected").textContent,
    editable: () => screen.getByTestId("editable").textContent,
  };
}

describe("AttachmentsProvider — the selected image", () => {
  it("is only selectable where the note can be changed", () => {
    expect(mountSelectable({}).editable()).toBe("false");
    cleanup();
    expect(mountSelectable({ onDelete: vi.fn() }).editable()).toBe("true");
  });

  it("holds one image and lets Escape go of it", () => {
    const view = mountSelectable({ onDelete: vi.fn() });
    view.select();
    expect(view.selected()).toBe("pic.png");
    view.press("Escape");
    expect(view.selected()).toBe("—");
  });

  it("deletes on Delete and on Backspace, and stops holding it", () => {
    const onDelete = vi.fn();
    const view = mountSelectable({ onDelete });
    view.select();
    view.press("Delete");
    expect(onDelete).toHaveBeenCalledWith("pic.png");
    expect(view.selected()).toBe("—");

    view.select();
    view.press("Backspace");
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it("leaves Delete alone when nothing is selected", () => {
    const onDelete = vi.fn();
    const view = mountSelectable({ onDelete });
    view.press("Delete");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("goes back to writing when an ordinary key is pressed", () => {
    const view = mountSelectable({ onDelete: vi.fn() });
    view.select();
    view.press("a");
    expect(view.selected()).toBe("—");
  });

  it("stops holding a picture the note no longer shows", () => {
    const onDelete = vi.fn();
    const view = mountSelectable({ onDelete });
    view.select();
    expect(view.selected()).toBe("pic.png");
    view.view.rerender(
      <AttachmentsProvider attachments={[PIC, DOC]} body="" onDelete={onDelete}>
        <SelectionProbe />
      </AttachmentsProvider>,
    );
    expect(view.selected()).toBe("—");
  });
});
