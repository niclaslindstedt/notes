import {
  PDF_BODY_FONTS,
  PDF_BULLETS,
  PDF_HEADING_FONTS,
  PDF_CODE_BACKGROUND_NONE,
  PDF_CODE_BACKGROUNDS,
  PDF_CODE_FONTS,
  PDF_CODE_SCALES,
  PDF_FONT_SIZES_PT,
  PDF_HEADING_SCALES,
  PDF_LINE_HEIGHTS,
  PDF_MARGINS_MM,
  PDF_ORIENTATIONS,
  PDF_PAGE_NUMBER_ALIGNS,
  PDF_PAGE_NUMBER_FORMATS,
  PDF_PAGE_SIZES,
  pdfPageNumberText,
  type PdfBodyFont,
  type PdfBullet,
  type PdfCodeFont,
  type PdfHeadingFont,
  type PdfOrientation,
  type PdfPageNumberAlign,
  type PdfPageNumberFormat,
  type PdfPageSize,
  type PdfSettings,
} from "../../theme/themes.ts";
import { useT, type TFunction } from "../../i18n/index.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { SelectPicker } from "../form/SelectPicker.tsx";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

// The Export settings tab — everything about how the [export
// function](../export/ExportButton.tsx)'s PDF renderer lays a note out on
// paper. Grouped by what each control affects: the sheet (size, orientation,
// margins), the body text (font, size, leading, heading scale), code (its own
// monospaced family, size and background fill), lists (the bullet glyph), and
// what the page carries beyond the body.
//
// Only the PDF path reads these. The Markdown export is the file the storage
// backends already write, and the clipboard export is plain text — neither has
// anything to style.
//
// Like the other appearance tabs, each control edits the dialog's `draft` and
// only takes effect on Save.
export function ExportSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const t = useT();
  const pdf = appearance.pdf;
  // The connector the `1 of 7` form spells out, in the reader's language — the
  // same string the export hands the pure typesetter (`PdfLayoutInput`).
  const ofWord = t("app.export.pageNumberOf");

  function update<K extends keyof PdfSettings>(
    key: K,
    value: PdfSettings[K],
  ): void {
    onUpdate("pdf", { ...pdf, [key]: value });
  }

  const pageSizeLabel: Record<PdfPageSize, string> = {
    a4: "A4",
    letter: t("settings.export.pageLetter"),
    legal: t("settings.export.pageLegal"),
  };

  const orientationLabel: Record<PdfOrientation, string> = {
    portrait: t("settings.export.portrait"),
    landscape: t("settings.export.landscape"),
  };

  const bodyFontLabel: Record<PdfBodyFont, string> = {
    sans: t("settings.export.fontSans"),
    serif: t("settings.export.fontSerif"),
    mono: t("settings.export.fontMono"),
  };

  const headingFontLabel: Record<PdfHeadingFont, string> = {
    body: t("settings.export.headingFontBody"),
    sans: t("settings.export.fontSans"),
    serif: t("settings.export.fontSerif"),
    mono: t("settings.export.fontMono"),
  };

  const codeFontLabel: Record<PdfCodeFont, string> = {
    courier: "Courier",
    dejavu: "DejaVu Sans Mono",
  };

  const alignLabel: Record<PdfPageNumberAlign, string> = {
    left: t("settings.export.alignLeft"),
    center: t("settings.export.alignCenter"),
    right: t("settings.export.alignRight"),
  };

  const bulletLabel: Record<PdfBullet, string> = {
    disc: t("settings.export.bulletDisc"),
    circle: t("settings.export.bulletCircle"),
    square: t("settings.export.bulletSquare"),
    dash: t("settings.export.bulletDash"),
    arrow: t("settings.export.bulletArrow"),
  };

  return (
    <>
      <Section title={t("settings.export.pageTitle")}>
        <p className="text-xs text-muted">{t("settings.export.blurb")}</p>
        <Field label={t("settings.export.pageSize")}>
          <SegmentedRow<PdfPageSize>
            ariaLabel={t("settings.export.pageSize")}
            value={pdf.pageSize}
            options={PDF_PAGE_SIZES.map((p) => ({
              value: p.id,
              label: pageSizeLabel[p.id],
            }))}
            onChange={(v) => update("pageSize", v)}
          />
        </Field>
        <Field label={t("settings.export.orientation")}>
          <SegmentedRow<PdfOrientation>
            ariaLabel={t("settings.export.orientation")}
            value={pdf.orientation}
            options={PDF_ORIENTATIONS.map((o) => ({
              value: o,
              label: orientationLabel[o],
            }))}
            onChange={(v) => update("orientation", v)}
          />
        </Field>
        <Field label={t("settings.export.margins")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.export.margins")}
            value={pdf.marginMm}
            options={PDF_MARGINS_MM.map((mm) => ({
              value: mm,
              label: marginLabel(t, mm),
            }))}
            onChange={(v) => update("marginMm", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.marginsHint")}
          </p>
        </Field>
      </Section>

      <Section title={t("settings.export.textTitle")}>
        <Field label={t("settings.export.bodyFont")}>
          <SegmentedRow<PdfBodyFont>
            ariaLabel={t("settings.export.bodyFont")}
            value={pdf.bodyFont}
            options={PDF_BODY_FONTS.map((f) => ({
              value: f.id,
              label: bodyFontLabel[f.id],
            }))}
            onChange={(v) => update("bodyFont", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.bodyFontHint")}
          </p>
        </Field>
        <Field label={t("settings.export.fontSize")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.export.fontSize")}
            value={pdf.fontSizePt}
            options={PDF_FONT_SIZES_PT.map((pt) => ({
              value: pt,
              label: `${pt} pt`,
            }))}
            onChange={(v) => update("fontSizePt", v)}
          />
        </Field>
        <Field label={t("settings.export.lineHeight")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.export.lineHeight")}
            value={pdf.lineHeight}
            options={PDF_LINE_HEIGHTS.map((n) => ({
              value: n,
              label: n.toFixed(1),
            }))}
            onChange={(v) => update("lineHeight", v)}
          />
        </Field>
        <Field label={t("settings.export.headingScale")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.export.headingScale")}
            value={pdf.headingScale}
            options={PDF_HEADING_SCALES.map((n) => ({
              value: n,
              label: headingScaleLabel(t, n),
            }))}
            onChange={(v) => update("headingScale", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.headingScaleHint")}
          </p>
        </Field>
        <Field label={t("settings.export.headingFont")}>
          <SegmentedRow<PdfHeadingFont>
            ariaLabel={t("settings.export.headingFont")}
            value={pdf.headingFont}
            options={PDF_HEADING_FONTS.map((f) => ({
              value: f,
              label: headingFontLabel[f],
            }))}
            onChange={(v) => update("headingFont", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.headingFontHint")}
          </p>
        </Field>
      </Section>

      <Section title={t("settings.export.codeTitle")}>
        <Field label={t("settings.export.codeFont")}>
          <SegmentedRow<PdfCodeFont>
            ariaLabel={t("settings.export.codeFont")}
            value={pdf.codeFont}
            options={PDF_CODE_FONTS.map((f) => ({
              value: f.id,
              label: codeFontLabel[f.id],
            }))}
            onChange={(v) => update("codeFont", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.codeFontHint")}
          </p>
        </Field>
        <Field label={t("settings.export.codeSize")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.export.codeSize")}
            value={pdf.codeFontScale}
            options={PDF_CODE_SCALES.map((n) => ({
              value: n,
              label: `${Math.round(n * 100)}%`,
            }))}
            onChange={(v) => update("codeFontScale", v)}
          />
        </Field>
        <Field label={t("settings.export.codeBackground")}>
          <CodeBackgroundPicker
            value={pdf.codeBackground}
            onChange={(v) => update("codeBackground", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.codeBackgroundHint")}
          </p>
        </Field>
      </Section>

      <Section title={t("settings.export.listsTitle")}>
        <Field label={t("settings.export.bullet")}>
          <SegmentedRow<PdfBullet>
            ariaLabel={t("settings.export.bullet")}
            value={pdf.bullet}
            options={PDF_BULLETS.map((b) => ({
              value: b.id,
              label: b.glyph,
            }))}
            onChange={(v) => update("bullet", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.export.bulletHint", {
              name: bulletLabel[pdf.bullet],
            })}
          </p>
        </Field>
      </Section>

      <Section title={t("settings.export.contentTitle")}>
        <ToggleRow
          label={t("settings.export.includeTitle")}
          hint={t("settings.export.includeTitleHint")}
          checked={pdf.includeTitle}
          onChange={(v) => update("includeTitle", v)}
        />
        <ToggleRow
          label={t("settings.export.pageNumbers")}
          hint={t("settings.export.pageNumbersHint")}
          checked={pdf.pageNumbers}
          onChange={(v) => update("pageNumbers", v)}
        />
        {/* Both only mean anything while there is a number to write, so they
            follow the toggle rather than sitting greyed out beneath it. */}
        {pdf.pageNumbers && (
          <>
            <Field label={t("settings.export.pageNumberFormat")}>
              <SelectPicker<PdfPageNumberFormat>
                value={pdf.pageNumberFormat}
                options={PDF_PAGE_NUMBER_FORMATS.map((f) => ({
                  value: f,
                  // The option *is* the footer: the same pure formatter the
                  // typesetter calls, on a two-page document, so what you pick
                  // is literally what gets printed.
                  label: pdfPageNumberText(f, 1, 2, ofWord),
                }))}
                onChange={(v) => update("pageNumberFormat", v)}
                ariaLabel={t("settings.export.pageNumberFormat")}
              />
              <p className="text-xs text-muted">
                {t("settings.export.pageNumberFormatHint")}
              </p>
            </Field>
            <Field label={t("settings.export.pageNumberAlign")}>
              <SegmentedRow<PdfPageNumberAlign>
                ariaLabel={t("settings.export.pageNumberAlign")}
                value={pdf.pageNumberAlign}
                options={PDF_PAGE_NUMBER_ALIGNS.map((a) => ({
                  value: a,
                  label: alignLabel[a],
                }))}
                onChange={(v) => update("pageNumberAlign", v)}
              />
              <p className="text-xs text-muted">
                {t("settings.export.pageNumberAlignHint")}
              </p>
            </Field>
          </>
        )}
      </Section>
    </>
  );
}

// Margins are named the way a word processor names them, with the measurement
// alongside — "Normal" alone says nothing, and "12.7 mm" alone is a riddle.
function marginLabel(t: TFunction, mm: number): string {
  const name =
    mm < 15
      ? t("settings.export.marginNarrow")
      : mm > 22
        ? t("settings.export.marginWide")
        : t("settings.export.marginNormal");
  // Whole millimetres print without a decimal; 12.7mm (one inch) keeps its.
  const measure = Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
  return `${name} · ${measure} mm`;
}

function headingScaleLabel(t: TFunction, scale: number): string {
  if (scale <= 0.6) return t("settings.export.headingScaleFlat");
  if (scale <= 0.8) return t("settings.export.headingScaleSmall");
  if (scale >= 1.3) return t("settings.export.headingScaleLarge");
  return t("settings.export.headingScaleNormal");
}

// The fill behind code blocks and inline code: the preset swatches, "none",
// and a native colour input for anything else. Native is the right call here
// for the same reason the custom-theme editor uses it — the OS picker already
// carries hex entry and an eyedropper.
function CodeBackgroundPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const none = value === PDF_CODE_BACKGROUND_NONE;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PDF_CODE_BACKGROUNDS.map((color) => {
        const isNone = color === PDF_CODE_BACKGROUND_NONE;
        const active = value === color;
        return (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            aria-pressed={active}
            title={isNone ? t("settings.export.codeBackgroundNone") : color}
            aria-label={
              isNone ? t("settings.export.codeBackgroundNone") : color
            }
            style={isNone ? undefined : { background: color }}
            className={`h-7 w-7 cursor-pointer rounded border ${
              active ? "border-accent ring-2 ring-accent/40" : "border-line"
            } ${isNone ? "bg-transparent text-muted" : ""}`}
          >
            {/* The "none" swatch is a diagonal slash, the universal
                no-fill mark — an empty square would read as white. */}
            {isNone && (
              <svg
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
                focusable="false"
                className="h-full w-full p-1"
              >
                <path d="M4 20 20 4" />
              </svg>
            )}
          </button>
        );
      })}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
        <input
          type="color"
          // A colour input has no "transparent"; while none is selected it
          // shows the default fill rather than an arbitrary black.
          value={none ? "#f4f4f5" : value}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={t("settings.export.codeBackgroundCustom")}
          className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent p-0"
        />
        <span>{t("settings.export.codeBackgroundCustom")}</span>
      </label>
    </div>
  );
}
