import { useState } from "react";

import {
  emptyTransformRule,
  transformAppliesTo,
  type TransformKind,
  type TransformRule,
} from "../../domain/transform.ts";
import { useT } from "../../i18n/index.ts";
import type { Namespace } from "../../storage/namespaces.ts";
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
// Rules are **namespace-scoped**: work and home want different rewrites, so a
// rule belongs to one namespace unless it is deliberately set to all of them.
// The list still shows every rule, whichever namespace it belongs to — hiding
// the others would leave a rule you wrote nowhere to be found once you
// switched namespace — with the ones that don't run here greyed out and
// wearing the name of the namespace they do run in. All of that machinery
// stays out of sight while the device has a single namespace: there is nothing
// to scope to, so new rules are global and no chip is drawn.
//
// Like every other appearance tab this edits the settings dialog's `draft` —
// nothing is persisted until Save, and Cancel drops the whole list edit.
export function TransformSection({
  appearance,
  onUpdate,
  namespaces,
  activeNamespace,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
  /** Namespaces known on this device, for the scope picker and the row chip. */
  namespaces: Namespace[];
  /** The namespace whose notes the rules would run over right now. */
  activeNamespace: string;
}) {
  const t = useT();
  const rules = appearance.transforms;
  // Scoping only means something once there is more than one namespace to
  // scope to.
  const scoped = namespaces.length > 1;
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
        {scoped && (
          <p className="text-xs text-muted">
            {t("settings.transform.scopeBlurb")}
          </p>
        )}

        {rules.length === 0 ? (
          <p className="text-xs text-muted">{t("settings.transform.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => {
              // A rule scoped elsewhere still lists, but reads as inert here:
              // it is a real rule of yours, it just isn't running over these
              // notes.
              const runsHere = transformAppliesTo(rule, activeNamespace);
              return (
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
                        rule.enabled && runsHere
                          ? "text-fg-bright"
                          : "text-muted"
                      }`}
                    >
                      {ruleLabel(rule)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span className="rounded bg-surface-3 px-1.5 py-0.5 text-accent">
                        {kindLabel[rule.kind]}
                      </span>
                      {scoped && (
                        <span
                          className={`rounded bg-surface-3 px-1.5 py-0.5 ${
                            runsHere ? "text-fg" : "text-muted"
                          }`}
                        >
                          {scopeLabel(rule)}
                        </span>
                      )}
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
              );
            })}
          </ul>
        )}

        <Button
          variant="primary"
          // A new rule starts in the namespace you are looking at — that is
          // what "different needs at work and at home" means in practice — and
          // the dialog's picker widens it back to all of them. With a single
          // namespace there is nothing to narrow to, so it starts global and
          // keeps working if a second namespace appears later.
          onClick={() =>
            setEditing(
              emptyTransformRule(undefined, scoped ? activeNamespace : null),
            )
          }
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
        namespaces={scoped ? namespaces : []}
        onSave={save}
        onClose={() => setEditing(null)}
      />
    </>
  );

  // What the row's scope chip says: the namespace the rule runs in, or that it
  // runs in all of them. A rule left behind by a deleted namespace falls back
  // to its bare slug rather than going nameless — it explains why the rule
  // stopped firing, and the dialog can be used to re-scope it.
  function scopeLabel(rule: TransformRule): string {
    if (rule.namespace === null) return t("settings.transform.scopeAll");
    return (
      namespaces.find((ns) => ns.slug === rule.namespace)?.name ??
      rule.namespace
    );
  }
}

// What the list calls a rule: its name when it has one, its pattern otherwise —
// an unnamed rule is still recognisable by the regex the user typed.
function ruleLabel(rule: TransformRule): string {
  return rule.name.trim() === "" ? rule.pattern : rule.name;
}
