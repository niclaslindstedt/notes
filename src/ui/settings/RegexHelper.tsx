import { useId, useRef, useState } from "react";

import { REGEX_TOKEN_GROUPS, type RegexToken } from "../../domain/transform.ts";
import { useT, type MessageKey } from "../../i18n/index.ts";
import { FloatingPanel } from "../FloatingPanel.tsx";
import type { FloatingPlacement } from "../hooks/useFloatingPosition.ts";
import { ChevronDownIcon } from "../icons.tsx";

// The **regex helper**: a dropdown under the pattern field in the Transform
// rule dialog that types a construct into it and says, in words, what that
// construct does. Regex is the one part of a transform rule you can't discover
// by poking at it — this is the reference, right where it's needed, instead of
// a trip to a search engine.
//
// It wears the app's dropdown, not one of its own: a full-width trigger cut to
// the same size, border and type as `SelectPicker`'s (the mask picker further
// down the same dialog is one, and the two must not read as different
// controls), over a portalled `FloatingPanel` with the row metrics every other
// menu in the app uses.
//
// Pressing a row types the snippet at the caret (the modal owns the field and
// does the insert, see `insertRegexToken`); the press is taken on `mousedown`
// so focus never leaves the input, which is what lets the caret land exactly
// where the insert put it — and the trigger takes its press the same way, so
// merely opening the reference doesn't cost the caret either. The panel stays
// open afterwards — building `#(\d+)` is three presses, and closing after each
// one would make that a chore.

const PANEL_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 200 },
  anchor: "left",
  coordinateSpace: "viewport",
};

export function RegexHelper({
  onInsert,
}: {
  onInsert: (token: RegexToken) => void;
}) {
  const t = useT();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t("settings.transform.helperToggle");

  return (
    <div className="w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-left text-sm text-fg hover:border-accent focus-visible:border-accent focus-visible:outline-none"
      >
        <span className="flex-1 truncate">{label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>

      <FloatingPanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement={PANEL_PLACEMENT}
        className="py-1"
      >
        <div id={menuId} role="menu" aria-label={label}>
          {REGEX_TOKEN_GROUPS.map((group) => {
            const headingId = `${menuId}-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={headingId}>
                <h4
                  id={headingId}
                  className="px-3 pt-2 pb-1 text-[0.65rem] font-bold tracking-wide text-muted uppercase"
                >
                  {t(`settings.transform.tokenGroup.${group.id}` as MessageKey)}
                </h4>
                {group.tokens.map((token) => {
                  const description = t(
                    `settings.transform.token.${token.id}` as MessageKey,
                  );
                  return (
                    <button
                      key={token.id}
                      type="button"
                      role="menuitem"
                      // The snippet and its description are separate elements
                      // and would otherwise read as one run-on word ("\\dAny
                      // digit"), so the accessible name is spelled out here.
                      aria-label={`${token.label} ${description}`}
                      // Take the press before it can move focus: the field
                      // keeps its selection, so the insert lands at the caret
                      // the user left there.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onInsert(token)}
                      className="flex w-full cursor-pointer items-baseline gap-3 px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-accent/15"
                    >
                      <code className="shrink-0 font-mono text-accent">
                        {token.label}
                      </code>
                      {/* A `FloatingPanel` is as wide as its widest row (never
                          narrower than its trigger, never wider than the
                          viewport allows), and the longest few descriptions
                          would otherwise run it well past the dialog card
                          behind it. The cap is the dialog's own width less a
                          row's chrome, so on a desktop the panel lands exactly
                          on the field it dropped from and those rows wrap
                          instead; on a phone the viewport clamp takes over, as
                          it does for every other dropdown in the app. Purely
                          cosmetic — a drifting dialog width only leaves the
                          panel slightly wider or narrower than the field. */}
                      <span className="min-w-0 flex-1 max-w-[21rem] text-xs text-muted">
                        {description}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </FloatingPanel>
    </div>
  );
}
