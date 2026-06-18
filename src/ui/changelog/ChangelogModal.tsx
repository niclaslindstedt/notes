import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ArrowLeftIcon, CloseIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { CHANGELOG } from "./data.ts";
import { FEATURE_DOCS } from "./feature-docs.ts";
import type { ChangelogEntryType } from "./parse.ts";
import { renderInlineMarkdown, renderMarkdownDoc } from "./render.tsx";

// "What's new" dialog reached from the side menu. Lists every shipped release
// parsed from CHANGELOG.md, newest first, rendering each bullet's inline
// markdown. A bullet carrying a `[Learn more](feature:<slug>)` link drills into
// the matching feature doc (`docs/features/<slug>.md`, inlined via
// `./feature-docs.ts`) in place, with a back button.

// One accent per Keep-a-Changelog kind, reusing notes' colour slots. notes has
// no positive/negative/success slots, so kinds that share a sentiment share a
// colour — the bold label text carries the distinction.
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
  // When set to a known slug the modal shows that feature doc in place of the
  // release list; the header grows a back button that clears it. A slug with no
  // bundled doc is ignored, so the link is inert rather than a dead end.
  const [docSlug, setDocSlug] = useState<string | null>(null);

  // The two views key their scroll containers apart (see the `key` props
  // below), so each is a fresh DOM node that starts at the top. We want a doc
  // to open at its top but Back to land on the exact release-list position the
  // reader left — so stash the list's scrollTop on the way in and restore it on
  // the way back.
  const listScrollRef = useRef(0);
  const listDivRef = useRef<HTMLDivElement>(null);
  const docDivRef = useRef<HTMLDivElement>(null);

  // Drop back to the release list whenever the modal reopens, so a later open
  // doesn't inherit the previous session's drill-down or scroll.
  useEffect(() => {
    if (open) {
      setDocSlug(null);
      listScrollRef.current = 0;
    }
  }, [open]);

  const openFeature = (slug: string) => {
    if (!FEATURE_DOCS[slug]) return;
    // Remember where the list was before swapping it for the doc. When
    // cross-linking doc→doc the list is already unmounted, so keep the saved
    // value rather than clobbering it with 0.
    listScrollRef.current =
      listDivRef.current?.scrollTop ?? listScrollRef.current;
    setDocSlug(slug);
  };

  // Land a freshly-opened doc at its top; restore the release list to its saved
  // position when Back returns to it. `useLayoutEffect` runs before paint, so
  // neither jump flickers.
  useLayoutEffect(() => {
    if (docSlug) {
      if (docDivRef.current) docDivRef.current.scrollTop = 0;
    } else if (listDivRef.current) {
      listDivRef.current.scrollTop = listScrollRef.current;
    }
  }, [docSlug]);

  const activeDoc = docSlug ? FEATURE_DOCS[docSlug] : undefined;

  if (activeDoc) {
    return (
      <Modal open={open} onClose={onClose} labelledBy="changelog-title">
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-3 px-2 py-3">
          <button
            type="button"
            onClick={() => setDocSlug(null)}
            aria-label="Back"
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h2
            id="changelog-title"
            className="flex-1 truncate text-sm font-bold tracking-wide text-fg-bright"
          >
            {activeDoc.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        {/* Key by slug so opening a doc (or cross-linking to a sibling) mounts
            a fresh scroll container, landing at the top instead of inheriting
            the release list's scroll position. */}
        <div
          key={`doc-${docSlug}`}
          ref={docDivRef}
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 text-sm leading-relaxed text-fg"
        >
          {renderMarkdownDoc(activeDoc.body, { onOpenFeature: openFeature })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="changelog-title">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="changelog-title"
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          Changelog
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div
        key="list"
        ref={listDivRef}
        className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 text-sm"
      >
        {CHANGELOG.length === 0 ? (
          <p className="py-8 text-center text-muted">No releases yet.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {CHANGELOG.map((release) => (
              <section key={release.version} className="flex flex-col gap-2">
                <h3 className="flex items-baseline gap-2 border-b border-line pb-1">
                  <span className="font-bold text-fg-bright">
                    {release.version}
                  </span>
                  {release.date && (
                    <span className="text-xs text-muted tabular-nums">
                      {release.date}
                    </span>
                  )}
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
    </Modal>
  );
}
