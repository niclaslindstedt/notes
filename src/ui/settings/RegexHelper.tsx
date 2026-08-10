import { useId, useState } from "react";

import { REGEX_TOKEN_GROUPS, type RegexToken } from "../../domain/transform.ts";
import { useT, type MessageKey } from "../../i18n/index.ts";
import { ChevronDownIcon, ChevronUpIcon } from "../icons.tsx";

// The **regex helper**: a dropdown under the pattern field in the Transform
// rule dialog that types a construct into it and says, in words, what that
// construct does. Regex is the one part of a transform rule you can't discover
// by poking at it — this is the reference, right where it's needed, instead of
// a trip to a search engine.
//
// Pressing a row types the snippet at the caret (the modal owns the field and
// does the insert, see `insertRegexToken`); the press is taken on `mousedown`
// so focus never leaves the input, which is what lets the caret land exactly
// where the insert put it. The panel stays open afterwards — building
// `#(\d+)` is three presses, and closing after each one would make that a
// chore.
//
// It expands **in flow** rather than floating: the dialog's body is a scroll
// container, so an absolutely-positioned menu would be clipped by it, and on a
// phone a panel that pushes the fields down is easier to hit than one hovering
// over them.
export function RegexHelper({
  onInsert,
}: {
  onInsert: (token: RegexToken) => void;
}) {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border px-2 py-1 text-xs ${
          open
            ? "border-accent bg-accent/15 text-accent"
            : "border-line bg-surface-2 text-fg hover:bg-surface-3"
        }`}
      >
        <span>{t("settings.transform.helperToggle")}</span>
        <Chevron className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-line bg-surface-2 p-2"
        >
          {REGEX_TOKEN_GROUPS.map((group) => (
            <div key={group.id} className="mb-2 last:mb-0">
              <h4 className="px-1 pb-1 text-[0.65rem] font-bold tracking-wide text-muted uppercase">
                {t(`settings.transform.tokenGroup.${group.id}` as MessageKey)}
              </h4>
              <ul className="flex flex-col">
                {group.tokens.map((token) => {
                  const description = t(
                    `settings.transform.token.${token.id}` as MessageKey,
                  );
                  return (
                    <li key={token.id}>
                      <button
                        type="button"
                        // The snippet and its description are separate elements
                        // and would otherwise read as one run-on word ("\\dAny
                        // digit"), so the accessible name is spelled out here.
                        aria-label={`${token.label} ${description}`}
                        // Take the press before it can move focus: the field
                        // keeps its selection, so the insert lands at the caret
                        // the user left there.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onInsert(token)}
                        className="flex w-full cursor-pointer items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-surface-3"
                      >
                        <code className="shrink-0 font-mono text-xs text-accent">
                          {token.label}
                        </code>
                        <span className="min-w-0 text-xs text-muted">
                          {description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
