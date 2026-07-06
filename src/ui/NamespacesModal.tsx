import { NamespacesModal as FrameworkNamespacesModal } from "@niclaslindstedt/oss-framework/namespaces";

import { useT } from "../i18n/index.ts";
import type { Namespace, NamespaceAppearance } from "../storage/namespaces.ts";
import { NAMESPACE_GLYPH_NAMES } from "./glyphs.ts";
import { NAMESPACE_COLORS } from "./namespace-colors.ts";

// Namespace management dialog: create a namespace, switch the active one,
// rename a namespace's display name, change its icon / colour, and delete
// one (with its data in the active backend). The framework modal owns the
// whole surface; this wrapper feeds it the app's pinned glyph/colour
// palettes and translated strings. Presentational — App owns the namespace
// state via `useStorageBackend` and passes the operations down.

type Props = {
  open: boolean;
  onClose: () => void;
  namespaces: Namespace[];
  activeNamespace: string;
  onSwitch: (slug: string) => void;
  onCreate: (name: string, appearance?: NamespaceAppearance) => void;
  onRename: (slug: string, name: string) => void;
  onSetAppearance: (slug: string, patch: NamespaceAppearance) => void;
  onRemove: (slug: string) => Promise<void>;
};

export function NamespacesModal(props: Props) {
  const t = useT();
  return (
    <FrameworkNamespacesModal
      {...props}
      glyphs={NAMESPACE_GLYPH_NAMES}
      colors={NAMESPACE_COLORS}
      labels={{
        heading: t("namespace.heading"),
        blurb: t("namespace.blurb"),
        newAction: t("namespace.newLabel"),
        namePlaceholder: t("namespace.namePlaceholder"),
        nameLabel: t("namespace.nameLabel"),
        create: t("common.create"),
        nameRequired: t("namespace.nameRequired"),
        colorLabel: t("namespace.colorLabel"),
        glyphLabel: t("namespace.glyphLabel"),
        glyphNone: t("namespace.noIcon"),
        save: t("common.save"),
        cancel: t("common.cancel"),
        renameAction: t("namespace.rename"),
        deleteAction: t("namespace.deleteAction"),
        delete: t("common.confirm"),
        deleteConfirm: (name) => t("namespace.deleteConfirm", { name }),
        switchTo: (name) => t("namespace.switchTo", { name }),
        defaultBadge: t("namespace.defaultBadge"),
        close: t("common.close"),
      }}
    />
  );
}
