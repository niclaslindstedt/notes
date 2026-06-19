import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";

import { useDevMode } from "../../dev/useDevMode.ts";
import { useT, type MessageKey } from "../../i18n/index.ts";
import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { updateAppearance, useAppearance } from "../../theme/useTheme.ts";
import {
  CloseIcon,
  CodeIcon,
  CogIcon,
  DatabaseIcon,
  MenuIcon,
  PaletteIcon,
  PencilIcon,
  ScrollTextIcon,
  SlidersIcon,
} from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { DeveloperSection } from "./DeveloperSection.tsx";
import { EditorSection } from "./EditorSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { LogsSection } from "./LogsSection.tsx";
import { StorageSection } from "./StorageSection.tsx";

// Settings dialog. Lands on the General tab, with Appearance and Storage as
// their own tabs alongside it. Modelled on checklist's tabbed SettingsModal —
// a left rail of labelled, icon-marked tabs on desktop, collapsed into a
// burger menu in the header on mobile. Unlike checklist there's no draft /
// Save step: every control here applies live through its own store, so the
// dialog is just a chooser with a Close button and no footer.
//
// Developer and Logs are diagnostic tabs gated behind the device-local
// developer-mode flag: Developer appears once dev mode is on, and Logs appears
// only once log capture is turned on from there (turning dev mode off forces
// capture off, so the Logs tab can never outlive its data).

type TabId =
  | "general"
  | "appearance"
  | "editor"
  | "storage"
  | "developer"
  | "logs";

type IconComponent = ComponentType<{ className?: string }>;

type TabDef = { id: TabId; labelKey: MessageKey; Icon: IconComponent };

const BASE_TABS: readonly TabDef[] = [
  { id: "general", labelKey: "settings.tab.general", Icon: SlidersIcon },
  { id: "appearance", labelKey: "settings.tab.appearance", Icon: PaletteIcon },
  { id: "editor", labelKey: "settings.tab.editor", Icon: PencilIcon },
  { id: "storage", labelKey: "settings.tab.storage", Icon: DatabaseIcon },
];

const DEVELOPER_TAB: TabDef = {
  id: "developer",
  labelKey: "settings.tab.developer",
  Icon: CodeIcon,
};

const LOGS_TAB: TabDef = {
  id: "logs",
  labelKey: "settings.tab.logs",
  Icon: ScrollTextIcon,
};

type Props = {
  open: boolean;
  onClose: () => void;
  storage: UseStorageBackend;
};

export function SettingsModal({ open, onClose, storage }: Props) {
  const appearance = useAppearance();
  const { devMode, captureLogs } = useDevMode();
  const [activeTab, setActiveTab] = useState<TabId>("general");

  // Developer is gated on dev mode; Logs is gated on log capture (which can
  // only be on while dev mode is, so the Logs tab never outlives its data).
  const tabs = useMemo<readonly TabDef[]>(() => {
    const list = [...BASE_TABS];
    if (devMode) list.push(DEVELOPER_TAB);
    if (captureLogs) list.push(LOGS_TAB);
    return list;
  }, [devMode, captureLogs]);

  // Always reopen on the General tab — it's the landing tab. Resetting while
  // closed keeps the next open clean without a visible flash of the old tab.
  useEffect(() => {
    if (!open) setActiveTab("general");
  }, [open]);

  // If the active tab disappears (dev mode or capture turned off while it's
  // showing), fall back to General so the panel is never empty.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab("general");
  }, [tabs, activeTab]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="settings-title">
      <SettingsHeader
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onClose={onClose}
      />

      <div className="flex flex-1 overflow-hidden">
        <TabSidebar tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />

        <div
          role="tabpanel"
          id={`settings-tabpanel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4"
        >
          {/* The Section blocks self-space with `mt-3 first:mt-0`, so the
              wrapper adds no gap of its own. */}
          <div className="mx-auto w-full max-w-2xl">
            {activeTab === "general" && <GeneralSection />}
            {activeTab === "appearance" && (
              <AppearanceSection
                appearance={appearance}
                onUpdate={updateAppearance}
              />
            )}
            {activeTab === "editor" && (
              <EditorSection
                appearance={appearance}
                onUpdate={updateAppearance}
              />
            )}
            {activeTab === "storage" && <StorageSection storage={storage} />}
            {activeTab === "developer" && <DeveloperSection />}
            {activeTab === "logs" && <LogsSection />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Header. On mobile the burger + active-tab label form one toggle that opens
// the section menu; on desktop the sidebar owns selection and the header
// shows the static "Settings" title (the burger is hidden at `sm:` and up).
// The h2 stays mounted (sr-only on mobile) so `aria-labelledby` resolves.
function SettingsHeader({
  tabs,
  activeTab,
  onSelectTab,
  onClose,
}: {
  tabs: readonly TabDef[];
  activeTab: TabId;
  onSelectTab: (id: TabId) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeDef = tabs.find((tab) => tab.id === activeTab);
  const ActiveIcon = activeDef?.Icon ?? CogIcon;
  const activeLabel = activeDef ? t(activeDef.labelKey) : t("settings.title");

  return (
    <header className="relative flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative sm:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("settings.chooseSection")}
            className={`-ml-1 inline-flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-sm font-bold tracking-wide text-fg-bright ${
              menuOpen
                ? "border-accent bg-accent/15"
                : "border-transparent hover:border-line hover:bg-surface-2"
            }`}
          >
            <MenuIcon className="h-[18px] w-[18px] text-muted" />
            <span className="inline-flex shrink-0 text-accent">
              <ActiveIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">{activeLabel}</span>
          </button>
          {menuOpen && (
            <>
              {/* Transparent catch-all that dismisses the menu on an outside
                  tap. `fixed` escapes the Modal card's `overflow-hidden`. */}
              <button
                type="button"
                aria-label="Close section menu"
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="menu"
                className="absolute top-full left-0 z-50 mt-1 flex w-48 flex-col gap-0.5 rounded border border-line bg-surface-3 p-2 shadow-xl"
              >
                {tabs.map((tab) => {
                  const Icon = tab.Icon;
                  const isActive = tab.id === activeTab;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        onSelectTab(tab.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-surface ${
                        isActive ? "font-bold text-accent" : "text-fg"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{t(tab.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <h2
          id="settings-title"
          className="text-sm font-bold tracking-wide text-fg-bright sr-only sm:not-sr-only"
        >
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex shrink-0 text-accent">
              <CogIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">{t("settings.title")}</span>
          </span>
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("settings.close")}
        className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </header>
  );
}

// Desktop-only vertical tab rail (hidden below `sm`, where the burger takes
// over). A WAI-ARIA tablist with roving tabindex and arrow-key navigation;
// activation follows focus to match the mouse / touch behaviour.
function TabSidebar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: readonly TabDef[];
  activeTab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const t = useT();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) {
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "Home" &&
      e.key !== "End"
    )
      return;
    e.preventDefault();
    let next = idx;
    if (e.key === "ArrowUp") next = idx - 1;
    else if (e.key === "ArrowDown") next = idx + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    const wrapped = (next + tabs.length) % tabs.length;
    const nextDef = tabs[wrapped];
    if (!nextDef) return;
    onSelect(nextDef.id);
    buttonRefs.current[nextDef.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("settings.sections")}
      className="hidden w-40 shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain border-r border-line bg-surface-3 p-2 sm:flex"
    >
      {tabs.map((tab, idx) => {
        const Icon = tab.Icon;
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              buttonRefs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-controls={`settings-tabpanel-${tab.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
              active
                ? "bg-accent/15 font-bold text-accent"
                : "text-fg hover:bg-surface-2"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
