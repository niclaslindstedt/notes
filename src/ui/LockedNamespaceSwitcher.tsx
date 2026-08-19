import { useT } from "../i18n/index.ts";
import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
import { LockIcon } from "./icons.tsx";
import { NamespaceGlyph } from "./NamespaceGlyph.tsx";

// The way out of a locked namespace.
//
// Both gates that can take over the whole screen — the encryption unlock gate
// and the PIN gate — are statements about *one* namespace, because both locks
// are per namespace. A namespace shared through one login is exactly the one
// somebody else may seal with a passphrase you were never given, and without
// this bar their lock would take the whole app down with it, including the
// namespaces that are entirely yours. So each gate carries this: every other
// namespace, its own lock state marked, one press to switch. The gate then
// either falls away (that namespace is open) or re-asks about that one
// instead.
//
// Renders above the gate's own `z-50` and pinned to the bottom, so it never
// competes with the centred form for the middle of the screen. The safe-area
// inset keeps it clear of the iOS home indicator, the way the settings footer
// does.

export function LockedNamespaceSwitcher({
  storage,
}: {
  storage: UseStorageBackend;
}) {
  const t = useT();
  const others = storage.namespaces.filter(
    (n) => n.slug !== storage.activeNamespace,
  );
  if (others.length === 0) return null;

  return (
    <nav
      aria-label={t("namespace.switchTitle")}
      className="fixed inset-x-0 bottom-0 z-60 border-t border-line bg-surface-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <p className="mb-2 text-xs text-muted">{t("namespace.switchHint")}</p>
      <div className="flex flex-wrap gap-2">
        {others.map((ns) => {
          const locked =
            storage.isNamespaceLocked(ns.slug) ||
            storage.isNamespacePinLocked(ns.slug);
          return (
            <button
              key={ns.slug}
              type="button"
              onClick={() => storage.switchNamespace(ns.slug)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg hover:bg-surface-3"
            >
              <NamespaceGlyph
                name={ns.glyph}
                className="h-3.5 w-3.5 shrink-0"
                style={ns.color ? { color: ns.color } : undefined}
              />
              <span className="min-w-0 truncate">{ns.name}</span>
              {locked && (
                <LockIcon
                  className="h-3 w-3 shrink-0 text-muted"
                  aria-label={t("namespace.stillLocked")}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
