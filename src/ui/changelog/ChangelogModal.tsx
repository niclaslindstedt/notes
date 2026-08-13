import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import {
  renderInlineMarkdown,
  renderMarkdownDoc,
} from "@niclaslindstedt/oss-framework/changelog";
import type { ChangelogEntryType } from "@niclaslindstedt/oss-framework/changelog";

import { useT } from "../../i18n/index.ts";
import { ArrowLeftIcon, CloseIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { CHANGELOG } from "./data.ts";
import { FEATURE_DOCS } from "./feature-docs.ts";

// "What's new" dialog reached from the side menu: every shipped release,
// newest first, with a `[Learn more](feature:<slug>)` bullet drilling into a
// feature doc in place.
//
// The shell is the app's own `Modal` — deliberately, rather than the
// framework's ready-made `ChangelogModal`. That one portals into a private
// overlay of its own instead of the shared modal, so on mobile it renders
// flush against the top edge and its header lands under the notch / status
// bar, and it also misses the visual-viewport rect, the stacked-Escape
// handling and swipe-down-to-close every other dialog here gets. Only the
// chrome is app-side: the Keep-a-Changelog parser and both Markdown
// renderers still come from the framework, so there is no forked parser to
// keep in sync. Drop this file for the framework component again once its
// modal sits on the shared `Modal`.

// One accent per Keep-a-Changelog kind, reusing notes' colour slots. notes
// has no dedicated positive/negative/success slots, so kinds that share a
// sentiment share a colour — the bold label text carries the distinction.
const TYPE_COLOR: Record<ChangelogEntryType, string> = {
  Added: "text-accent",
  Changed: "text-link",
  Fixed: "text-accent",
  Removed: "text-danger",
  Security: "text-danger",
  Deprecated: "text-muted",
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ChangelogModal({ open, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const [docSlug, setDocSlug] = useState<string | null>(null);
  // Where the release list was scrolled to when a "Learn more" was followed,
  // so coming back lands on the bullet that was tapped rather than the top.
  const listScrollRef = useRef(0);
  const listDivRef = useRef<HTMLDivElement | null>(null);
  const docDivRef = useRef<HTMLDivElement | null>(null);

  // A reopen always starts on the release list, however it was last closed.
  useEffect(() => {
    if (open) {
      setDocSlug(null);
      listScrollRef.current = 0;
    }
  }, [open]);

  const openFeature = (slug: string) => {
    if (!FEATURE_DOCS[slug]) return;
    listScrollRef.current =
      listDivRef.current?.scrollTop ?? listScrollRef.current;
    setDocSlug(slug);
  };

  useLayoutEffect(() => {
    if (docSlug) {
      if (docDivRef.current) docDivRef.current.scrollTop = 0;
    } else if (listDivRef.current) {
      listDivRef.current.scrollTop = listScrollRef.current;
    }
  }, [docSlug]);

  const activeDoc = docSlug ? FEATURE_DOCS[docSlug] : undefined;

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-3 px-4 py-3">
        {activeDoc ? (
          <button
            type="button"
            onClick={() => setDocSlug(null)}
            aria-label={t("common.back")}
            className="-ml-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        ) : null}
        <h2
          id={titleId}
          className="flex-1 truncate text-sm font-bold tracking-wide text-fg-bright"
        >
          {activeDoc ? activeDoc.title : t("changelog.heading")}
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

      {activeDoc ? (
        // Keyed by slug so a cross-link between two docs remounts the pane
        // (and the layout effect above scrolls the new one to the top).
        <div
          key={`doc-${docSlug}`}
          ref={docDivRef}
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 text-sm leading-relaxed text-fg"
        >
          {renderMarkdownDoc(activeDoc.body, { onOpenFeature: openFeature })}
        </div>
      ) : (
        <div
          key="list"
          ref={listDivRef}
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 text-sm"
        >
          {CHANGELOG.length === 0 ? (
            <p className="py-8 text-center text-muted">
              {t("changelog.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {CHANGELOG.map((release) => (
                <section key={release.version} className="flex flex-col gap-2">
                  <h3 className="flex items-baseline gap-2 border-b border-line pb-1">
                    <span className="font-bold text-fg-bright">
                      {release.version}
                    </span>
                    {release.date ? (
                      <span className="text-xs text-muted tabular-nums">
                        {release.date}
                      </span>
                    ) : null}
                  </h3>
                  {release.sections.map((section, si) => (
                    <div key={si} className="flex flex-col gap-1">
                      <p
                        className={`text-xs font-bold tracking-wide ${TYPE_COLOR[section.type]}`}
                      >
                        {section.type}
                      </p>
                      <ul className="ml-4 list-disc space-y-1 text-fg">
                        {section.items.map((item, i) => (
                          <li key={i}>
                            {renderInlineMarkdown(item, {
                              onOpenFeature: openFeature,
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
