import { useState, type FormEvent } from "react";

import { useT } from "../i18n/index.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  type Namespace,
  type NamespaceAppearance,
} from "../storage/namespaces.ts";
import { ColorPalette } from "./ColorPalette.tsx";
import { Button } from "./form/Button.tsx";
import { GlyphGrid } from "./GlyphGrid.tsx";
import { NAMESPACE_GLYPH_NAMES } from "./glyphs.ts";
import { NAMESPACE_COLORS } from "./namespace-colors.ts";
import { CheckIcon, CloseIcon, PencilIcon, TrashIcon } from "./icons.tsx";
import { Modal } from "./Modal.tsx";
import { NamespaceGlyph } from "./NamespaceGlyph.tsx";

// Namespace management dialog: create a namespace, switch the active one,
// rename a namespace's display name, change its icon / colour, and delete one
// (with its data in the active backend). The switcher in the side menu
// handles the common "switch namespace" path; this dialog is the full add /
// rename / appearance / delete surface. Presentational — App owns the
// namespace state via `useStorageBackend` and passes the operations down.

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

const INPUT_CLASS =
  "flex-1 rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

export function NamespacesModal({
  open,
  onClose,
  namespaces,
  activeNamespace,
  onSwitch,
  onCreate,
  onRename,
  onSetAppearance,
  onRemove,
}: Props) {
  const t = useT();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [newGlyph, setNewGlyph] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError(t("namespace.nameRequired"));
      return;
    }
    onCreate(trimmed, { glyph: newGlyph, color: newColor });
    setNewName("");
    setNewColor(null);
    setNewGlyph(null);
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="namespaces-title">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="namespaces-title"
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t("namespace.heading")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="mb-4 text-xs text-muted">{t("namespace.blurb")}</p>

        <ul className="flex flex-col gap-1">
          {namespaces.map((ns) => (
            <NamespaceRow
              key={ns.slug}
              namespace={ns}
              active={ns.slug === activeNamespace}
              onSwitch={() => onSwitch(ns.slug)}
              onRename={(name) => onRename(ns.slug, name)}
              onSetAppearance={(patch) => onSetAppearance(ns.slug, patch)}
              onRemove={() => onRemove(ns.slug)}
              t={t}
            />
          ))}
        </ul>

        <form onSubmit={submitCreate} className="mt-5 flex flex-col gap-2">
          <label
            htmlFor="namespace-new"
            className="text-xs font-semibold tracking-wide text-muted uppercase"
          >
            {t("namespace.newLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="namespace-new"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t("namespace.namePlaceholder")}
              aria-label={t("namespace.nameLabel")}
              className={INPUT_CLASS}
            />
            <Button type="submit" variant="primary">
              {t("common.create")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}

          {/* Pick the new namespace's colour and icon up front, so it lands
              already badged rather than as a bare folder the user has to open
              the editor to skin. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t("namespace.colorLabel")}
            </span>
            <ColorPalette
              colors={NAMESPACE_COLORS}
              value={newColor}
              onChange={setNewColor}
              ariaLabelPrefix={t("namespace.newColorPrefix")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t("namespace.glyphLabel")}
            </span>
            <GlyphGrid
              glyphs={NAMESPACE_GLYPH_NAMES}
              value={newGlyph}
              onChange={setNewGlyph}
              tintColor={newColor}
              noneLabel={t("namespace.newGlyphNone")}
              ariaLabelPrefix={t("namespace.newGlyphPrefix")}
            />
          </div>
        </form>
      </div>
    </Modal>
  );
}

function NamespaceRow({
  namespace,
  active,
  onSwitch,
  onRename,
  onSetAppearance,
  onRemove,
  t,
}: {
  namespace: Namespace;
  active: boolean;
  onSwitch: () => void;
  onRename: (name: string) => void;
  onSetAppearance: (patch: NamespaceAppearance) => void;
  onRemove: () => Promise<void>;
  t: ReturnType<typeof useT>;
}) {
  const isDefault = namespace.slug === DEFAULT_NAMESPACE_SLUG;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(namespace.name);
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onRename(trimmed);
    setEditing(false);
  };

  // The glyph tile shown beside the name: the chosen icon (or the default
  // folder) painted in the namespace's accent colour when it has one.
  const glyphTile = (
    <NamespaceGlyph
      name={namespace.glyph}
      className="h-4 w-4"
      style={namespace.color ? { color: namespace.color } : undefined}
    />
  );

  const confirmRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-3">
        <form onSubmit={submitRename} className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t("namespace.nameLabel")}
            className={INPUT_CLASS}
          />
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(namespace.name);
              setEditing(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        </form>

        {/* Appearance applies live as the user picks (it isn't gated behind
            Save, which only governs the name) so the side-menu glyph and the
            favicon update immediately. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t("namespace.colorLabel")}
          </span>
          <ColorPalette
            colors={NAMESPACE_COLORS}
            value={namespace.color ?? null}
            onChange={(color) => onSetAppearance({ color })}
            ariaLabelPrefix={t("namespace.colorLabel")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t("namespace.glyphLabel")}
          </span>
          <GlyphGrid
            glyphs={NAMESPACE_GLYPH_NAMES}
            value={namespace.glyph ?? null}
            onChange={(glyph) => onSetAppearance({ glyph })}
            tintColor={namespace.color}
            noneLabel={t("namespace.noIcon")}
            ariaLabelPrefix={t("namespace.glyphLabel")}
          />
        </div>
      </li>
    );
  }

  return (
    <li
      className={`flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2 ${
        active ? "border-accent bg-accent/10" : "border-line bg-surface-2"
      }`}
    >
      <button
        type="button"
        onClick={onSwitch}
        aria-current={active ? "true" : undefined}
        aria-label={t("namespace.switchTo", { name: namespace.name })}
        className="flex flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <span className="shrink-0">{glyphTile}</span>
        <span className="w-4 shrink-0 text-accent">
          {active && <CheckIcon className="h-4 w-4" />}
        </span>
        <span
          className={`flex-1 truncate text-sm ${
            active ? "font-bold text-accent" : "text-fg"
          }`}
        >
          {namespace.name}
        </span>
        {isDefault && (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
            {t("namespace.defaultBadge")}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(namespace.name);
          setEditing(true);
        }}
        aria-label={t("namespace.rename")}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-3 hover:text-fg"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
      {!isDefault &&
        (confirmingRemove ? (
          // Deleting a namespace destroys its whole document and isn't
          // undoable, so the trash asks for a second confirming tap rather
          // than firing on the first.
          <button
            type="button"
            onClick={() => void confirmRemove()}
            disabled={busy}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded bg-danger px-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.confirm")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            aria-label={t("namespace.deleteAction")}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded text-muted hover:bg-danger/15 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ))}
    </li>
  );
}
