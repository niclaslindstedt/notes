import { describe, expect, it } from "vitest";

import {
  bulletGlyphAt,
  coercePdfSettings,
  DEFAULT_PDF_SETTINGS,
  isPdfCodeBackground,
  pdfPageSizeCss,
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
    });
    expect(settings).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it("refuses a code background that isn't a colour", () => {
    // The value is interpolated straight into the print stylesheet, so
    // anything but `transparent` or a hex colour has to be thrown away.
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

describe("bulletGlyphAt", () => {
  it("starts at the chosen glyph", () => {
    expect(bulletGlyphAt("disc", 0)).toBe("•");
    expect(bulletGlyphAt("dash", 0)).toBe("–");
  });

  it("rotates onward through the set as lists nest", () => {
    expect(bulletGlyphAt("disc", 1)).toBe("◦");
    expect(bulletGlyphAt("disc", 2)).toBe("▪");
    // Past the end of the set the rotation wraps rather than running out.
    expect(bulletGlyphAt("disc", PDF_BULLETS.length)).toBe("•");
  });
});

describe("pdfPageSizeCss", () => {
  it("pairs the paper keyword with the orientation", () => {
    expect(pdfPageSizeCss(DEFAULT_PDF_SETTINGS)).toBe("A4 portrait");
    expect(
      pdfPageSizeCss({
        ...DEFAULT_PDF_SETTINGS,
        pageSize: "letter",
        orientation: "landscape",
      }),
    ).toBe("Letter landscape");
  });
});
