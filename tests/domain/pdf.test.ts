import { describe, expect, it } from "vitest";

import {
  bulletAt,
  coercePdfSettings,
  DEFAULT_PDF_SETTINGS,
  isPdfCodeBackground,
  pdfHeadingFamily,
  pdfPageNumberText,
  pdfPageSizePt,
  PDF_BULLETS,
} from "../../src/domain/pdf.ts";

describe("coercePdfSettings", () => {
  it("falls back to the defaults for a missing document", () => {
    expect(coercePdfSettings(undefined)).toEqual(DEFAULT_PDF_SETTINGS);
    expect(coercePdfSettings(null)).toEqual(DEFAULT_PDF_SETTINGS);
    expect(coercePdfSettings("nonsense")).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it("keeps the valid slots of a partial document", () => {
    const settings = coercePdfSettings({
      pageSize: "letter",
      fontSizePt: 14,
      includeTitle: false,
    });
    expect(settings.pageSize).toBe("letter");
    expect(settings.fontSizePt).toBe(14);
    expect(settings.includeTitle).toBe(false);
    // Everything else stays at its default.
    expect(settings.bodyFont).toBe(DEFAULT_PDF_SETTINGS.bodyFont);
    expect(settings.marginMm).toBe(DEFAULT_PDF_SETTINGS.marginMm);
  });

  it("drops values outside the offered sets", () => {
    const settings = coercePdfSettings({
      pageSize: "a0",
      orientation: "sideways",
      marginMm: 500,
      fontSizePt: 72,
      lineHeight: 9,
      codeFontScale: 3,
      bullet: "star",
      codeFont: "comic",
      pageNumberFormat: "roman",
      pageNumberAlign: "justified",
    });
    expect(settings).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it("numbers the pages the way it always did when the document predates the choice", () => {
    // Neither field existed before the footer was configurable, so a stored
    // document without them has to keep printing `1 / 7` in the middle.
    const settings = coercePdfSettings({ pageNumbers: true });
    expect(settings.pageNumberFormat).toBe("slash");
    expect(settings.pageNumberAlign).toBe("center");
  });

  it("retires a code font the writer can no longer produce", () => {
    // A document written when the export was a browser print job may name a
    // family only CSS could resolve. Those land on the default like any other
    // value that isn't offered; `dejavu` still means what it always did.
    expect(coercePdfSettings({ codeFont: "system" }).codeFont).toBe("courier");
    expect(coercePdfSettings({ codeFont: "consolas" }).codeFont).toBe(
      "courier",
    );
    expect(coercePdfSettings({ codeFont: "dejavu" }).codeFont).toBe("dejavu");
  });

  it("refuses a code background that isn't a colour", () => {
    // The value is written into the document as a fill, so anything but
    // `transparent` or a hex colour has to be thrown away.
    expect(isPdfCodeBackground("red;} body{display:none")).toBe(false);
    expect(isPdfCodeBackground("url(http://x)")).toBe(false);
    expect(isPdfCodeBackground("transparent")).toBe(true);
    expect(isPdfCodeBackground("#abc")).toBe(true);
    expect(isPdfCodeBackground("#f4f4f5")).toBe(true);
    expect(
      coercePdfSettings({ codeBackground: "red;}x{" }).codeBackground,
    ).toBe(DEFAULT_PDF_SETTINGS.codeBackground);
  });
});

describe("pdfPageNumberText", () => {
  it("writes each of the three forms", () => {
    expect(pdfPageNumberText("ofTotal", 2, 7)).toBe("2 of 7");
    expect(pdfPageNumberText("slash", 2, 7)).toBe("2 / 7");
    expect(pdfPageNumberText("plain", 2, 7)).toBe("2");
  });

  it("takes the connector from the caller, which is where the catalogue is", () => {
    expect(pdfPageNumberText("ofTotal", 2, 7, "av")).toBe("2 av 7");
    // Only the spelled-out form has one to translate.
    expect(pdfPageNumberText("slash", 2, 7, "av")).toBe("2 / 7");
  });
});

describe("bulletAt", () => {
  it("starts at the chosen bullet", () => {
    expect(bulletAt("disc", 0)).toBe("disc");
    expect(bulletAt("dash", 0)).toBe("dash");
  });

  it("rotates onward through the set as lists nest", () => {
    expect(bulletAt("disc", 1)).toBe("circle");
    expect(bulletAt("disc", 2)).toBe("square");
    // Past the end of the set the rotation wraps rather than running out.
    expect(bulletAt("disc", PDF_BULLETS.length)).toBe("disc");
  });
});

describe("pdfPageSizePt", () => {
  it("measures the paper in points", () => {
    expect(pdfPageSizePt(DEFAULT_PDF_SETTINGS)).toEqual({
      widthPt: 595.28,
      heightPt: 841.89,
    });
  });

  it("swaps the axes for landscape", () => {
    expect(
      pdfPageSizePt({
        ...DEFAULT_PDF_SETTINGS,
        pageSize: "letter",
        orientation: "landscape",
      }),
    ).toEqual({ widthPt: 792, heightPt: 612 });
  });
});

describe("pdfHeadingFamily", () => {
  it("follows the body font by default", () => {
    expect(
      pdfHeadingFamily({ ...DEFAULT_PDF_SETTINGS, bodyFont: "serif" }),
    ).toBe("times");
  });

  it("takes its own family when one is chosen", () => {
    expect(
      pdfHeadingFamily({
        ...DEFAULT_PDF_SETTINGS,
        bodyFont: "serif",
        headingFont: "sans",
      }),
    ).toBe("helvetica");
  });
});
