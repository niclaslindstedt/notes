import { useRef, useState, type ReactNode } from "react";

import { BUILD_LABEL } from "../build-env.ts";
import { useT } from "../i18n/index.ts";
import { useModalDispatch } from "./modal-bus.ts";
import { FloatingPanel } from "./FloatingPanel.tsx";
import type { FloatingPlacement } from "./hooks/useFloatingPosition.ts";
import { AchievementsMenuItem } from "./achievements/AchievementsMenuItem.tsx";
import {
  CodeIcon,
  CogIcon,
  HeartIcon,
  HelpCircleIcon,
  ShieldIcon,
  SparklesIcon,
} from "./icons.tsx";

// notes is open source; the "source" link points at its repository.
const SOURCE_URL = "https://github.com/niclaslindstedt/notes";

// The footer "About" dropdown opens "up and to the left" of its trigger:
// `useFloatingPosition` flips it above automatically (there is no room below
// at the foot of the drawer), and it widens to at least the trigger.
const ABOUT_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 200 },
  anchor: "left",
  coordinateSpace: "viewport",
};

// The relocated burger menu, pinned to the foot of the drawer: an optional
// Donate, the trophy (achievements), an "About" dropdown that folds away the
// project links (What's new / source with the app version as a subtitle /
// privacy), and Settings pinned last under the thumb. Self-contained — the only
// thing it borrows from the drawer is the `onClose` that retracts it behind a
// modal; the About dropdown's open state lives here.
export function SideMenuFooter({ onClose }: { onClose: () => void }) {
  const t = useT();
  const dispatch = useModalDispatch();

  // The footer "About" dropdown (What's new / source / privacy), opened against
  // `aboutRef` and flipped upward by `FloatingPanel`.
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutRef = useRef<HTMLButtonElement>(null);

  // Build-time env (string | undefined). A blank value disables the donate
  // entry entirely rather than linking nowhere.
  const donateUrl = import.meta.env.VITE_DONATE_URL?.trim();
  // BASE_URL carries the trailing slash, so this is `/privacy`,
  // `/preview/privacy`, … depending on the deploy slot.
  const privacyUrl = `${import.meta.env.BASE_URL}privacy`;

  return (
    <>
      <div className="flex flex-col border-t border-line [padding-top:calc(1.25rem_-_var(--density-row-py))] [padding-bottom:calc(1.25rem_-_var(--density-row-py))]">
        {donateUrl && (
          <MenuLink
            icon={<HeartIcon className="h-5 w-5 text-danger" />}
            label={t("menu.donate")}
            href={donateUrl}
            external
            onClick={onClose}
          />
        )}
        <AchievementsMenuItem onClose={onClose} />
        {/* About: a single row that reveals the project links in an upward-
            flipping dropdown (there's no room below at the foot of the drawer).
            It reads as a plain footer row — no chevron — and just toggles the
            panel open and shut. */}
        <button
          ref={aboutRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
        >
          <span className="text-muted">
            <HelpCircleIcon className="h-5 w-5" />
          </span>
          <span className="flex-1">{t("menu.about")}</span>
        </button>
        <MenuButton
          icon={<CogIcon className="h-5 w-5" />}
          label={t("menu.settings")}
          onClick={() => {
            onClose();
            dispatch({ kind: "settings" });
          }}
        />
      </div>
      <FloatingPanel
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        triggerRef={aboutRef}
        placement={ABOUT_PLACEMENT}
        className="py-1"
      >
        <MenuButton
          icon={<SparklesIcon className="h-5 w-5" />}
          label={t("menu.changelog")}
          onClick={() => {
            setAboutOpen(false);
            onClose();
            dispatch({ kind: "changelog" });
          }}
        />
        <MenuLink
          icon={<CodeIcon className="h-5 w-5" />}
          label={t("menu.source")}
          href={SOURCE_URL}
          external
          sublabel={BUILD_LABEL}
          onClick={() => {
            setAboutOpen(false);
            onClose();
          }}
        />
        <MenuLink
          icon={<ShieldIcon className="h-5 w-5" />}
          label={t("menu.privacy")}
          href={privacyUrl}
          onClick={() => {
            setAboutOpen(false);
            onClose();
          }}
        />
      </FloatingPanel>
    </>
  );
}

// Footer rows reuse the NavItem geometry (px-5, the density vertical
// padding, gap-3, h-5 icons) so the relocated burger menu reads as one
// continuous list with the rows above it. A plain button for in-app
// actions, an anchor for the links.
function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
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
