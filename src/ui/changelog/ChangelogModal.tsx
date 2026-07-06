import { ChangelogModal as FrameworkChangelogModal } from "@niclaslindstedt/oss-framework/changelog";
import type { ChangelogEntryType } from "@niclaslindstedt/oss-framework/changelog";

import { useT } from "../../i18n/index.ts";
import { CHANGELOG } from "./data.ts";
import { FEATURE_DOCS } from "./feature-docs.ts";

// "What's new" dialog reached from the side menu. The framework modal owns
// the release list, the inline-markdown rendering, and the `feature:<slug>`
// "Learn more" drill-down; this wrapper feeds it the app's inlined
// CHANGELOG.md, its feature docs, the translated chrome strings, and the
// app's per-kind accents.

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
  return (
    <FrameworkChangelogModal
      open={open}
      onClose={onClose}
      releases={CHANGELOG}
      featureDocs={FEATURE_DOCS}
      typeColors={TYPE_COLOR}
      labels={{
        heading: t("changelog.heading"),
        empty: t("changelog.empty"),
        close: t("common.close"),
        back: t("common.back"),
      }}
    />
  );
}
