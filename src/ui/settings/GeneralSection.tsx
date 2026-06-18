import { useStandaloneMobile } from "../../pwa/standalone.ts";
import { useNav } from "../nav-context.ts";
import { Section, ToggleRow } from "./shared.tsx";

// The landing settings tab. A short note on where the app keeps its data,
// plus — only in the installed PWA on a phone / tablet — the toggle that
// hides the floating menu button in favour of an inward edge swipe. Ported
// from checklist's General tab, pared to what notes carries (no toasts,
// achievements, or developer mode yet); appearance and storage live on their
// own tabs.
export function GeneralSection() {
  const standaloneMobile = useStandaloneMobile();
  const { showMenuButton, setShowMenuButton } = useNav();
  return (
    <Section title="General">
      <p className="text-xs text-muted">
        notes is a local-first app — your notes live in this browser unless you
        connect a folder or cloud. Appearance settings are saved on this device.
      </p>
      {standaloneMobile && (
        <ToggleRow
          label="Show menu button"
          hint="When off, swipe in from the edge of the screen to open the menu."
          checked={showMenuButton}
          onChange={setShowMenuButton}
        />
      )}
    </Section>
  );
}
