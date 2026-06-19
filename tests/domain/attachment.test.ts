import { describe, expect, it } from "vitest";

import {
  attachmentFilename,
  attachmentFilenameFromHref,
  attachmentMarkdown,
  attachmentRef,
  extensionForMime,
  isAttachableImageMime,
  mimeForFilename,
  referencedAttachments,
  withAttachment,
  type Attachment,
} from "../../src/domain/attachment.ts";

function att(filename: string): Attachment {
  return { filename, mime: "image/png", data: "data:image/png;base64,AAA" };
}

describe("attachment mime helpers", () => {
  it("accepts known image types and maps them to extensions", () => {
    expect(isAttachableImageMime("image/png")).toBe(true);
    expect(isAttachableImageMime("image/jpeg")).toBe(true);
    expect(isAttachableImageMime("application/pdf")).toBe(false);
    expect(isAttachableImageMime("text/plain")).toBe(false);
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
  });

  it("recovers the mime from a filename's extension", () => {
    expect(mimeForFilename("abcd-photo.jpg")).toBe("image/jpeg");
    expect(mimeForFilename("x.PNG")).toBe("image/png");
    expect(mimeForFilename("x.unknown")).toBe("application/octet-stream");
  });
});

describe("attachmentFilename", () => {
  it("mints a unique, fs-safe name from the original and the mime", () => {
    const name = attachmentFilename(
      "image/png",
      "My Screenshot.PNG",
      "abcd1234",
    );
    expect(name).toBe("abcd1234-my-screenshot.png");
  });

  it("falls back to 'image' when there is no original name (a paste)", () => {
    expect(attachmentFilename("image/jpeg", undefined, "ffff0000")).toBe(
      "ffff0000-image.jpg",
    );
  });

  it("mints distinct names for repeated pastes of the same picture", () => {
    const a = attachmentFilename("image/png", "x.png");
    const b = attachmentFilename("image/png", "x.png");
    expect(a).not.toBe(b);
  });
});

describe("body references", () => {
  it("builds the in-memory flat reference and its markdown", () => {
    expect(attachmentRef("abcd-photo.png")).toBe("attachments/abcd-photo.png");
    expect(attachmentMarkdown(att("abcd-photo.png"))).toBe(
      "![abcd-photo.png](attachments/abcd-photo.png)",
    );
  });

  it("extracts the filename from both the flat and on-disk forms", () => {
    expect(attachmentFilenameFromHref("attachments/abcd-photo.png")).toBe(
      "abcd-photo.png",
    );
    expect(
      attachmentFilenameFromHref(
        "../attachments/groceries-1a2b/abcd-photo.png",
      ),
    ).toBe("abcd-photo.png");
    expect(attachmentFilenameFromHref("https://example.com/x.png")).toBeNull();
  });
});

describe("withAttachment", () => {
  it("appends and de-dupes by filename", () => {
    const one = withAttachment(undefined, att("a.png"));
    expect(one.map((a) => a.filename)).toEqual(["a.png"]);
    const two = withAttachment(one, att("b.png"));
    expect(two.map((a) => a.filename)).toEqual(["a.png", "b.png"]);
    const replaced = withAttachment(two, att("a.png"));
    expect(replaced.map((a) => a.filename)).toEqual(["b.png", "a.png"]);
  });
});

describe("referencedAttachments", () => {
  it("keeps only the attachments the body still references", () => {
    const list = [att("a.png"), att("b.png"), att("c.png")];
    const body = "intro\n![a](attachments/a.png)\nmid\n![c](attachments/c.png)";
    expect(referencedAttachments(body, list).map((a) => a.filename)).toEqual([
      "a.png",
      "c.png",
    ]);
  });

  it("returns nothing for a body with no image references", () => {
    expect(referencedAttachments("just text", [att("a.png")])).toEqual([]);
  });
});
