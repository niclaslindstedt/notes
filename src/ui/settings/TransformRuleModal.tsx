import { useEffect, useId, useMemo, useState } from "react";

import {
  compileTransforms,
  emptyTransformRule,
  MASK_STYLES,
  patternError,
  previewSegments,
  TRANSFORM_KINDS,
  type MaskStyle,
  type TransformKind,
  type TransformRule,
} from "../../domain/transform.ts";
import { useT } from "../../i18n/index.ts";
import { Button } from "../form/Button.tsx";
import { Checkbox } from "../form/Checkbox.tsx";
import { SelectPicker } from "../form/SelectPicker.tsx";
import { scrollFocusedIntoView } from "../hooks/scrollFocusedIntoView.ts";
import { CloseIcon, WandIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { Field, SegmentedRow } from "./shared.tsx";

// The add / edit dialog for one **Transform** rule, opened from the Transform
// settings tab. Top to bottom it is the shape the rule is written in: the
// pattern that matches, the kind of replacement it makes, the replacement
// itself (plus the mask style when the kind is `sensitive`), then a sample the
// user types and the live output that sample produces.
//
// The output pane is the point of the dialog: a regex is easy to get subtly
// wrong, and the only convincing check is seeing your own text go through it.
// It re-runs on every keystroke in any field — cheap, since it is one line of
// `previewSegments` over a sample the user chose the length of.
//
// The rule is edited as a local draft and handed back on Save, so Cancel drops
// it; the *list* is then committed with the rest of the settings dialog's
// draft, which is what makes Cancel there drop the whole edit too.

const INPUT_CLASS =
  "w-full rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

export function TransformRuleModal({
  open,
  rule,
  onSave,
  onClose,
}: {
  open: boolean;
  /** The rule being edited, or null when the dialog is closed. */
  rule: TransformRule | null;
  onSave: (rule: TransformRule) => void;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const [draft, setDraft] = useState<TransformRule>(
    () => rule ?? emptyTransformRule("draft"),
  );

  // Re-seed from the rule the tab handed over each time the dialog opens, so
  // editing a second rule never shows the first one's half-typed state.
  useEffect(() => {
    if (open && rule) setDraft(rule);
  }, [open, rule]);

  function update<K extends keyof TransformRule>(
    key: K,
    value: TransformRule[K],
  ): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const error = useMemo(
    () => patternError(draft.pattern, draft.ignoreCase),
    [draft.pattern, draft.ignoreCase],
  );

  // The preview runs the draft alone, enabled regardless of its own switch —
  // the question here is "does this rule do what I meant", not "is it on".
  const segments = useMemo(
    () =>
      previewSegments(
        draft.sample,
        compileTransforms([{ ...draft, enabled: true }]),
      ),
    [draft],
  );

  const kindLabel: Record<TransformKind, string> = {
    link: t("settings.transform.kindLink"),
    text: t("settings.transform.kindText"),
    sensitive: t("settings.transform.kindSensitive"),
  };

  const maskLabel: Record<MaskStyle, string> = {
    all: t("settings.transform.maskAll"),
    fixed: t("settings.transform.maskFixed"),
    ends: t("settings.transform.maskEnds"),
    last: t("settings.transform.maskLast"),
    first: t("settings.transform.maskFirst"),
  };

  const replacementLabel =
    draft.kind === "link"
      ? t("settings.transform.replacementLink")
      : draft.kind === "sensitive"
        ? t("settings.transform.replacementSensitive")
        : t("settings.transform.replacementText");

  const replacementHint =
    draft.kind === "link"
      ? t("settings.transform.replacementLinkHint")
      : draft.kind === "sensitive"
        ? t("settings.transform.replacementSensitiveHint")
        : t("settings.transform.replacementTextHint");

  const canSave =
    draft.pattern.trim() !== "" &&
    error === null &&
    (draft.kind !== "link" || draft.replacement.trim() !== "");

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} centered>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <WandIcon className="h-4 w-4 text-accent" />
          {t("settings.transform.ruleTitle")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        <Field label={t("settings.transform.name")}>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update("name", e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.transform.namePlaceholder")}
            aria-label={t("settings.transform.name")}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label={t("settings.transform.pattern")}>
          <input
            type="text"
            value={draft.pattern}
            onChange={(e) => update("pattern", e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.transform.patternPlaceholder")}
            aria-label={t("settings.transform.pattern")}
            aria-invalid={error !== null}
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            className={`${INPUT_CLASS} font-mono ${
              error === null ? "" : "border-danger focus:border-danger"
            }`}
          />
          {error === null ? (
            <p className="text-xs text-muted">
              {t("settings.transform.patternHint")}
            </p>
          ) : (
            <p role="alert" className="text-xs text-danger">
              {t("settings.transform.patternInvalid", { error })}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={draft.ignoreCase}
              onChange={(v) => update("ignoreCase", v)}
              ariaLabel={t("settings.transform.ignoreCase")}
            />
            <span className="text-xs text-muted">
              {t("settings.transform.ignoreCase")}
            </span>
          </div>
        </Field>

        <Field label={t("settings.transform.kind")}>
          <SegmentedRow<TransformKind>
            ariaLabel={t("settings.transform.kind")}
            value={draft.kind}
            options={TRANSFORM_KINDS.map((k) => ({
              value: k,
              label: kindLabel[k],
            }))}
            onChange={(v) => update("kind", v)}
          />
          <p className="text-xs text-muted">
            {t("settings.transform.kindHint")}
          </p>
        </Field>

        <Field label={replacementLabel}>
          <input
            type="text"
            value={draft.replacement}
            onChange={(e) => update("replacement", e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={
              draft.kind === "link"
                ? t("settings.transform.replacementLinkPlaceholder")
                : t("settings.transform.replacementTextPlaceholder")
            }
            aria-label={replacementLabel}
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="text-xs text-muted">{replacementHint}</p>
        </Field>

        {draft.kind === "sensitive" && (
          <Field label={t("settings.transform.mask")}>
            <SelectPicker<MaskStyle>
              value={draft.mask}
              options={MASK_STYLES.map((m) => ({
                value: m,
                label: maskLabel[m],
              }))}
              onChange={(v) => update("mask", v)}
              ariaLabel={t("settings.transform.mask")}
            />
            <p className="text-xs text-muted">
              {t("settings.transform.maskHint")}
            </p>
          </Field>
        )}

        <Field label={t("settings.transform.sample")}>
          <textarea
            value={draft.sample}
            onChange={(e) => update("sample", e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.transform.samplePlaceholder")}
            aria-label={t("settings.transform.sample")}
            rows={3}
            spellcheck={false}
            className={`${INPUT_CLASS} resize-y font-mono`}
          />
        </Field>

        <Field label={t("settings.transform.output")}>
          <output
            className="block w-full min-h-[3rem] rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm break-words whitespace-pre-wrap text-fg"
            aria-live="polite"
          >
            {segments.length === 0 ? (
              <span className="text-muted">
                {t("settings.transform.outputEmpty")}
              </span>
            ) : (
              segments.map((seg, i) => {
                if (seg.kind === "plain")
                  return <span key={i}>{seg.text}</span>;
                if (seg.kind === "link") {
                  return (
                    <span
                      key={i}
                      title={seg.href ?? undefined}
                      className="text-link underline decoration-dotted underline-offset-2"
                    >
                      {seg.text}
                    </span>
                  );
                }
                if (seg.kind === "sensitive") {
                  return (
                    <span key={i} className="text-muted">
                      {seg.text}
                    </span>
                  );
                }
                return (
                  <span key={i} className="text-accent">
                    {seg.text}
                  </span>
                );
              })
            )}
          </output>
          <p className="text-xs text-muted">
            {t("settings.transform.outputHint")}
          </p>
        </Field>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!canSave}
          onClick={() => onSave(draft)}
        >
          {t("common.save")}
        </Button>
      </footer>
    </Modal>
  );
}
