import { useState } from "react";

import {
  emptyTransformRule,
  type TransformKind,
  type TransformRule,
} from "../../domain/transform.ts";
import { useT } from "../../i18n/index.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { Button } from "../form/Button.tsx";
import { Checkbox } from "../form/Checkbox.tsx";
import { PencilIcon, PlusIcon, TrashIcon } from "../icons.tsx";
import { Section } from "./shared.tsx";
import { TransformRuleModal } from "./TransformRuleModal.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

// The **Transform** settings tab: the user's list of regex rules that rewrite
// what a note body *shows* without touching what it stores (see
// `src/domain/transform.ts`). Each row is one rule — its label, the pattern it
// matches, what kind of replacement it makes — with a switch to park it, and
// buttons to edit or delete it. "Add transform" and the edit button both open
// the same dialog (`TransformRuleModal`), which carries the sample-and-output
// pane that proves the regex before it is saved.
//
// Order is significant and shown as such: the rules run top to bottom, and the
// first one to claim a run of text wins, so a broad rule below a narrow one
// never swallows it. New rules land at the end.
//
// Like every other appearance tab this edits the settings dialog's `draft` —
// nothing is persisted until Save, and Cancel drops the whole list edit.
export function TransformSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const t = useT();
  const rules = appearance.transforms;
  // The rule the dialog is editing, or null when it's closed. A rule that
  // isn't in `rules` yet is a new one — Save appends it.
  const [editing, setEditing] = useState<TransformRule | null>(null);

  const kindLabel: Record<TransformKind, string> = {
    link: t("settings.transform.kindLink"),
    text: t("settings.transform.kindText"),
    sensitive: t("settings.transform.kindSensitive"),
  };

  function save(rule: TransformRule): void {
    const exists = rules.some((r) => r.id === rule.id);
    onUpdate(
      "transforms",
      exists
        ? rules.map((r) => (r.id === rule.id ? rule : r))
        : [...rules, rule],
    );
    setEditing(null);
  }

  function remove(id: string): void {
    onUpdate(
      "transforms",
      rules.filter((r) => r.id !== id),
    );
  }

  function setEnabled(id: string, enabled: boolean): void {
    onUpdate(
      "transforms",
      rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
    );
  }

  return (
    <>
      <Section title={t("settings.transform.rulesTitle")}>
        <p className="text-xs text-muted">{t("settings.transform.blurb")}</p>

        {rules.length === 0 ? (
          <p className="text-xs text-muted">{t("settings.transform.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-2"
              >
                <Checkbox
                  checked={rule.enabled}
                  onChange={(v) => setEnabled(rule.id, v)}
                  ariaLabel={t("settings.transform.toggleAria", {
                    name: ruleLabel(rule),
                  })}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm ${
                      rule.enabled ? "text-fg-bright" : "text-muted"
                    }`}
                  >
                    {ruleLabel(rule)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-accent">
                      {kindLabel[rule.kind]}
                    </span>
                    <code className="min-w-0 truncate font-mono">
                      {rule.pattern}
                    </code>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  aria-label={t("settings.transform.editAria", {
                    name: ruleLabel(rule),
                  })}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-surface-3 hover:text-fg"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(rule.id)}
                  aria-label={t("settings.transform.deleteAria", {
                    name: ruleLabel(rule),
                  })}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-danger/15 hover:text-danger"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="primary"
          onClick={() => setEditing(emptyTransformRule())}
        >
          <span className="inline-flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            {t("settings.transform.add")}
          </span>
        </Button>

        {rules.length > 1 && (
          <p className="text-xs text-muted">
            {t("settings.transform.orderHint")}
          </p>
        )}
      </Section>

      <TransformRuleModal
        open={editing !== null}
        rule={editing}
        onSave={save}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

// What the list calls a rule: its name when it has one, its pattern otherwise —
// an unnamed rule is still recognisable by the regex the user typed.
function ruleLabel(rule: TransformRule): string {
  return rule.name.trim() === "" ? rule.pattern : rule.name;
}
