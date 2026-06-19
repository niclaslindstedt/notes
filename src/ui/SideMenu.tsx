import { useEffect, useId, useState, type ReactNode } from "react";

import { BUILD_LABEL } from "../build-env.ts";
import { noteTitle, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import type { Namespace } from "../storage/namespaces.ts";
import { APP_VIEWPORT_RECT } from "./appViewportRect.ts";
import { useNav } from "./nav-context.ts";
import { useDraggableMenuButton } from "./hooks/useDraggableMenuButton.ts";
import { useSwipeReveal } from "./hooks/useSwipeReveal.ts";
import {
  ArchiveIcon,
  CheckIcon,
  CodeIcon,
  CogIcon,
  HeartIcon,
  MenuIcon,
  NoteIcon,
  PlusIcon,
  RedoIcon,
  ShieldIcon,
  SparklesIcon,
  TrashIcon,
  UndoIcon,
} from "./icons.tsx";
import { useModalDispatch } from "./modal-bus.ts";
import { NamespaceGlyph } from "./NamespaceGlyph.tsx";

// The navigation drawer. On viewports narrower than the smallest iPad it
// collapses to a single floating button the user can drag to either side
// edge (its resting spot persists); pressing it slides the drawer in from
// that same side over a dimmed backdrop. From the smallest iPad up
// (`nav.pinned`) the same panel is instead docked open as a permanent
// sidebar beside the content — no button, no backdrop, no open/close — so
// wider screens always see the navigation. Both variants render the
// identical section list (`sections` below); only the framing differs.
//
// The drawer lists every note by its title (the switcher — tap to open it
// in the editor) with a "+" on the Notes heading that starts a fresh one.
// Pinned to the bottom is what was the top-right burger menu — settings and
// the project links (privacy, source with the app version as a subtitle,
// and an optional donate), in inverted order so the whole of it sits flush
// at the foot of the drawer. The open/position state comes from `useNav`;
// the footer actions `dispatch` a modal command on the bus. The note list
// and its verbs are passed as props from App, which owns the notes store.
//
// Note rows support swipe-to-remove: a left swipe latches open a trash
// button (see `useSwipeReveal`). A deletion is recorded on the undo timeline
// (the Edit section's Undo brings it back), but it still asks for a second
// confirming tap so a stray swipe doesn't silently drop a note.

// notes is open source; the "source" link points at its repository.
const SOURCE_URL = "https://github.com/niclaslindstedt/notes";

type Props = {
  /** Notes to list, in display order (most-recently-edited first). */
  notes: Note[];
  /** The note currently open in the editor, if any. */
  activeNoteId: string | null;
  /** Open a note in the editor. */
  onSelectNote: (id: string) => void;
  /** Start a fresh note and open it. */
  onAddNote: () => void;
  /** Delete a note permanently. */
  onRemoveNote: (id: string) => void;
  /** How many notes are archived — shown as a count on the Archive entry. */
  archivedCount: number;
  /** Revert the most recent recorded edit. */
  onUndo: () => void;
  /** Re-apply the most recently undone edit. */
  onRedo: () => void;
  /** Whether there is a recorded edit to revert. */
  canUndo: boolean;
  /** Whether there is an undone edit to re-apply. */
  canRedo: boolean;
  /** Namespaces known on this device, default first. */
  namespaces: Namespace[];
  /** The active namespace's slug. */
  activeNamespace: string;
  /** Make a namespace active (and leave the editor). */
  onSwitchNamespace: (slug: string) => void;
};

export function SideMenu({
  notes,
  activeNoteId,
  onSelectNote,
  onAddNote,
  onRemoveNote,
  archivedCount,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  namespaces,
  activeNamespace,
  onSwitchNamespace,
}: Props) {
  const t = useT();
  const dispatch = useModalDispatch();
  const drawerId = useId();
  const {
    open,
    toggle,
    close,
    setDragging,
    position,
    setPosition,
    showButton,
    pinned,
  } = useNav();
  const drag = useDraggableMenuButton(position, setPosition);

  // Mirror the live drag state up so the parent can gate competing global
  // gestures off while the button is being dragged.
  useEffect(() => {
    setDragging(drag.dragging);
  }, [drag.dragging, setDragging]);

  // Build-time env (string | undefined). A blank value disables the donate
  // entry entirely rather than linking nowhere.
  const donateUrl = import.meta.env.VITE_DONATE_URL?.trim();
  // BASE_URL carries the trailing slash, so this is `/privacy`,
  // `/preview/privacy`, … depending on the deploy slot.
  const privacyUrl = `${import.meta.env.BASE_URL}privacy`;

  // Footer actions open a modal, so close the drawer behind them.
  function pick(handler: () => void) {
    close();
    handler();
  }

  // Dismiss on Escape while open (the backdrop handles pointer dismissal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onRight = position.side === "right";

  // The drawer's body — identical whether it slides in over a backdrop
  // (narrow viewports) or sits docked as a permanent sidebar (pinned). Only
  // the framing `<nav>` differs between the two, so the rows live here once.
  const sections = (
    <>
      {/* Namespaces switcher: tap a row to switch which set of notes is
          shown; the heading's cogwheel opens the full manage dialog (add /
          rename / icon / delete) — a cog, not a "+", because it manages
          rather than adds inline. */}
      <SectionHeader
        label={t("nav.namespaces")}
        onAdd={() => pick(() => dispatch({ kind: "namespaces" }))}
        addLabel={t("nav.manageNamespaces")}
        addIcon={<CogIcon className="h-4 w-4" />}
      />
      {namespaces.map((ns) => {
        // A namespace that picked an icon or colour shows its own glyph,
        // tinted to that colour. One left untouched gets the plain check
        // (active) / folder (inactive) treatment so the active set reads at a
        // glance — the NamespaceGlyph fallback is itself a folder.
        const customised = Boolean(ns.glyph || ns.color);
        const icon = customised ? (
          <NamespaceGlyph
            name={ns.glyph}
            className="h-5 w-5"
            style={ns.color ? { color: ns.color } : undefined}
          />
        ) : ns.slug === activeNamespace ? (
          <CheckIcon className="h-5 w-5" />
        ) : (
          <NamespaceGlyph className="h-5 w-5" />
        );
        return (
          <NavItem
            key={ns.slug}
            icon={icon}
            label={ns.name}
            active={ns.slug === activeNamespace}
            onClick={() => {
              onSwitchNamespace(ns.slug);
              close();
            }}
          />
        );
      })}
      <SectionHeader
        label={t("nav.notes")}
        border
        onAdd={() => {
          onAddNote();
          close();
        }}
        addLabel={t("nav.newNote")}
      />
      {notes.length === 0 ? (
        <p className="px-5 py-[var(--density-row-py)] text-sm text-muted">
          {t("nav.notesEmpty")}
        </p>
      ) : (
        notes.map((note) => {
          const row = (
            <NavItem
              icon={
                note.id === activeNoteId ? (
                  <CheckIcon className="h-5 w-5" />
                ) : (
                  <NoteIcon className="h-5 w-5" />
                )
              }
              label={noteTitle(note)}
              active={note.id === activeNoteId}
              onClick={() => {
                onSelectNote(note.id);
                close();
              }}
            />
          );
          return (
            <SwipeToRemove
              key={note.id}
              actionLabel={t("nav.deleteNote")}
              confirmLabel={t("nav.confirmDelete")}
              onRemove={() => onRemoveNote(note.id)}
            >
              {row}
            </SwipeToRemove>
          );
        })
      )}
      <SectionHeader label={t("nav.edit")} border />
      {/* Undo / redo keep the drawer open so a burst of reverts can be
          applied without reopening it each time. */}
      <NavItem
        icon={<UndoIcon className="h-5 w-5" />}
        label={t("nav.undo")}
        active={false}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <NavItem
        icon={<RedoIcon className="h-5 w-5" />}
        label={t("nav.redo")}
        active={false}
        disabled={!canRedo}
        onClick={onRedo}
      />
      {/* The old top-right burger menu, pinned to the foot of the drawer
          with its order inverted so it reads bottom-up. */}
      <div className="mt-auto flex flex-col border-t border-line [padding-top:calc(1.25rem_-_var(--density-row-py))]">
        {donateUrl && (
          <MenuLink
            icon={<HeartIcon className="h-5 w-5 text-danger" />}
            label={t("menu.donate")}
            href={donateUrl}
            external
            onClick={close}
          />
        )}
        <MenuLink
          icon={<CodeIcon className="h-5 w-5" />}
          label={t("menu.source")}
          href={SOURCE_URL}
          external
          sublabel={BUILD_LABEL}
          onClick={close}
        />
        <MenuLink
          icon={<ShieldIcon className="h-5 w-5" />}
          label={t("menu.privacy")}
          href={privacyUrl}
          onClick={close}
        />
        <MenuButton
          icon={<ArchiveIcon className="h-5 w-5" />}
          label={t("nav.archive")}
          count={archivedCount}
          onClick={() => pick(() => dispatch({ kind: "archive" }))}
        />
        <MenuButton
          icon={<SparklesIcon className="h-5 w-5" />}
          label={t("menu.changelog")}
          onClick={() => pick(() => dispatch({ kind: "changelog" }))}
        />
        <MenuButton
          icon={<CogIcon className="h-5 w-5" />}
          label={t("menu.settings")}
          onClick={() => pick(() => dispatch({ kind: "settings" }))}
        />
      </div>
    </>
  );

  // Pinned: a permanent docked sidebar beside the content. No floating
  // button, no backdrop, no open/close — it's simply always there. App lays
  // it out as a flex sibling of the main view, so a fixed width and a single
  // inner border (on whichever edge faces the content) is all the framing it
  // needs. It docks on the same side the floating button rests on.
  if (pinned) {
    return (
      <nav
        aria-label={t("nav.label")}
        className={`relative flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-surface [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
          onRight ? "order-last border-l border-line" : "border-r border-line"
        }`}
      >
        {sections}
      </nav>
    );
  }

  return (
    <>
      {/* Floating toggle the user can drag to either edge; a plain press
          still toggles the drawer (the drag hook swallows the click that
          tails a real drag, and leaves keyboard activation untouched). */}
      {showButton && (
        <button
          type="button"
          onClick={() => {
            if (drag.consumeDragClick()) return;
            toggle();
          }}
          {...drag.handlers}
          style={drag.style}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? drawerId : undefined}
          aria-label={open ? t("nav.close") : t("nav.open")}
          className={`fixed z-40 flex h-11 w-11 touch-none items-center justify-center rounded-full border border-line bg-surface text-muted shadow-lg select-none hover:text-fg-bright ${
            drag.dragging
              ? "cursor-grabbing transition-none"
              : "cursor-grab transition-[left,top] duration-300 ease-out"
          }`}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div
          className={`fixed z-50 flex ${onRight ? "justify-end" : ""}`}
          style={APP_VIEWPORT_RECT}
        >
          <button
            type="button"
            aria-label={t("nav.close")}
            tabIndex={-1}
            onClick={close}
            className="drawer-backdrop absolute inset-0 cursor-default bg-black/50"
          />
          <nav
            id={drawerId}
            aria-label={t("nav.label")}
            className={`relative flex w-64 max-w-[80%] flex-col overflow-y-auto bg-surface shadow-xl [padding-bottom:max(env(safe-area-inset-bottom),calc(1.25rem_-_var(--density-row-py)))] [padding-top:env(safe-area-inset-top)] ${
              onRight
                ? "drawer-panel-right border-l border-line"
                : "drawer-panel-left border-r border-line"
            }`}
          >
            {sections}
          </nav>
        </div>
      )}
    </>
  );
}

// A section label with an optional trailing action pinned to its trailing
// edge. For Notes the action is a "+" that starts a new note; for Namespaces
// it's a cogwheel that opens the manage dialog (passed via `addIcon`). The
// first section omits the top border; every later one draws one to separate
// it from the rows above.
function SectionHeader({
  label,
  border = false,
  onAdd,
  addLabel,
  addIcon = <PlusIcon className="h-4 w-4" />,
}: {
  label: string;
  border?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  addIcon?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-5 pt-3 pb-1 ${
        border ? "border-t border-line" : ""
      }`}
    >
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="-mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
        >
          {addIcon}
        </button>
      )}
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  // Renders the row inert and dimmed — used by undo / redo at the timeline
  // ends, where there is nothing to revert or re-apply.
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm ${
        disabled
          ? "cursor-not-allowed text-muted opacity-40"
          : active
            ? "cursor-pointer bg-surface-2 font-semibold text-fg-bright"
            : "cursor-pointer text-fg hover:bg-surface-2 hover:text-fg-bright"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

// Wraps a drawer row so a left swipe latches it open to reveal a trailing
// trash button (see `useSwipeReveal`). The first tap on the trash arms a
// confirming state (the button reads `confirmLabel`) and only the second
// tap commits — a guard against a stray swipe, even though the deletion is
// itself undoable from the Edit section. The sliding foreground carries its
// own surface background so it covers the action while closed.
const REMOVE_ACTION_W = 96;

function SwipeToRemove({
  actionLabel,
  confirmLabel,
  onRemove,
  children,
}: {
  /** Accessible label for the trash button in its resting state. */
  actionLabel: string;
  /** Label the trash button reads while awaiting a confirming second tap. */
  confirmLabel: string;
  onRemove: () => void | Promise<void>;
  children: ReactNode;
}) {
  const swipe = useSwipeReveal(REMOVE_ACTION_W);
  const [confirming, setConfirming] = useState(false);

  // Closing the row (a tap on an open row, or a swipe back) disarms the
  // confirm step so it never lingers half-armed for the next open.
  useEffect(() => {
    if (!swipe.open) setConfirming(false);
  }, [swipe.open]);

  function act() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    swipe.close();
    void onRemove();
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-end">
        <button
          type="button"
          onClick={act}
          aria-label={confirming ? confirmLabel : actionLabel}
          style={{ width: REMOVE_ACTION_W }}
          className="flex h-full items-center justify-center bg-danger text-xs font-semibold tracking-wide text-white uppercase"
        >
          {confirming ? confirmLabel : <TrashIcon className="h-5 w-5" />}
        </button>
      </div>
      <div
        {...swipe.handlers}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        className={`relative bg-surface [touch-action:pan-y] ${
          swipe.animating ? "transition-transform duration-200" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Footer rows reuse the NavItem geometry (px-5, the density vertical
// padding, gap-3, h-5 icons) so the relocated burger menu reads as one
// continuous list with the rows above it. A plain button for in-app
// actions, an anchor for the links.
function MenuButton({
  icon,
  label,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  // Optional trailing tally (e.g. the number of archived notes). Hidden when
  // zero so an empty archive carries no badge.
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function MenuLink({
  icon,
  label,
  href,
  external,
  sublabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  href: string;
  external?: boolean;
  /** Secondary line beneath the label (e.g. the app version). */
  sublabel?: string;
  onClick?: () => void;
}) {
  return (
    <a
      role="menuitem"
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span>{label}</span>
        {sublabel && (
          <span className="text-xs text-muted tabular-nums">{sublabel}</span>
        )}
      </span>
    </a>
  );
}
