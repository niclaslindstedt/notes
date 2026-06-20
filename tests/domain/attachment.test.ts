import { describe, expect, it } from "vitest";

import {
  attachmentFilename,
  attachmentFilenameFromHref,
  attachmentMarkdown,
  attachmentRef,
  extensionForMime,
  fileAttachmentFilename,
  hiddenAttachmentLines,
  isAttachableImageMime,
  isImageAttachment,
  isRelocatedAttachmentLine,
  mimeForFilename,
  referencedAttachments,
  relocatedAttachments,
  withAttachment,
  type Attachment,
} from "../../src/domain/attachment.ts";

function att(filename: string): Attachment {
  return { filename, mime: "image/png", data: "data:image/png;base64,AAA" };
}

function fileAtt(filename: string, mime = "application/pdf"): Attachment {
  return { filename, mime, data: `data:${mime};base64,AAA` };
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

  it("recovers common non-image mimes for file attachments", () => {
    expect(mimeForFilename("report.pdf")).toBe("application/pdf");
    expect(mimeForFilename("ARCHIVE.ZIP")).toBe("application/zip");
    expect(mimeForFilename("notes.txt")).toBe("text/plain");
  });

  it("classifies attachments as image or file by mime", () => {
    expect(isImageAttachment(att("a.png"))).toBe(true);
    expect(isImageAttachment(fileAtt("a.pdf"))).toBe(false);
  });
});

describe("fileAttachmentFilename", () => {
  it("keeps the original extension and slugs the stem", () => {
    expect(fileAttachmentFilename("Quarterly Report.PDF", "abcd1234")).toBe(
      "abcd1234-quarterly-report.pdf",
    );
  });

  it("keeps no extension when the original has none", () => {
    expect(fileAttachmentFilename("LICENSE", "ffff0000")).toBe(
      "ffff0000-license",
    );
  });

  it("falls back to 'file' when the stem has no usable characters", () => {
    expect(fileAttachmentFilename("___.dat", "ffff0000")).toBe(
      "ffff0000-file.dat",
    );
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

  it("inserts a file attachment as a plain link, not an image", () => {
    expect(attachmentMarkdown(fileAtt("abcd-report.pdf"))).toBe(
      "[abcd-report.pdf](attachments/abcd-report.pdf)",
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

  it("matches file-attachment links as well as image references", () => {
    const list = [att("a.png"), fileAtt("b.pdf"), fileAtt("c.zip")];
    const body =
      "![a](attachments/a.png)\n[b.pdf](attachments/b.pdf)\nsee [site](https://x.y)";
    expect(referencedAttachments(body, list).map((a) => a.filename)).toEqual([
      "a.png",
      "b.pdf",
    ]);
  });

  it("returns nothing for a body with no attachment references", () => {
    expect(referencedAttachments("just text", [att("a.png")])).toEqual([]);
  });
});

describe("attachment placement", () => {
  const both = { imagesAtEnd: true, filesAtEnd: true };

  it("detects a line that is a single relocated attachment reference", () => {
    expect(
      isRelocatedAttachmentLine("![a](attachments/a.png)", {
        imagesAtEnd: true,
        filesAtEnd: false,
      }),
    ).toBe(true);
    // A file reference is not relocated when only images are at the end.
    expect(
      isRelocatedAttachmentLine("[b.pdf](attachments/b.pdf)", {
        imagesAtEnd: true,
        filesAtEnd: false,
      }),
    ).toBe(false);
    // A normal link is never an attachment line.
    expect(isRelocatedAttachmentLine("[x](https://x.y)", both)).toBe(false);
    // Inline-with-text is not a whole-line reference, so it stays put.
    expect(isRelocatedAttachmentLine("see ![a](attachments/a.png)", both)).toBe(
      false,
    );
  });

  it("hides relocated lines and absorbs the trailing blank line", () => {
    const body =
      "intro\n![a](attachments/a.png)\n\n[b.pdf](attachments/b.pdf)\n\nend";
    expect(
      [...hiddenAttachmentLines(body, both)].sort((x, y) => x - y),
    ).toEqual([1, 2, 3, 4]);
    // With nothing relocated, nothing is hidden.
    expect(
      hiddenAttachmentLines(body, { imagesAtEnd: false, filesAtEnd: false })
        .size,
    ).toBe(0);
  });

  it("splits the relocated attachments into images and files", () => {
    const list = [att("a.png"), fileAtt("b.pdf"), att("c.png")];
    expect(
      relocatedAttachments(list, { imagesAtEnd: true, filesAtEnd: false }),
    ).toEqual({ images: [att("a.png"), att("c.png")], files: [] });
    expect(relocatedAttachments(list, both)).toEqual({
      images: [att("a.png"), att("c.png")],
      files: [fileAtt("b.pdf")],
    });
  });
});
