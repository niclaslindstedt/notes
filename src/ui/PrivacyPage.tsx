// Standalone privacy policy, served at `/privacy` (see `app/main.tsx`'s
// path switch and the `emit-privacy-alias` plugin in `vite.config.ts`).
// notes is local-first with no backend, no accounts, and no analytics —
// everything stays in the browser — so this policy is short and absolute.
// It is English-only by design (a legal page, not chrome), mirroring
// checklist's PrivacyPage.
import { ArrowLeftIcon } from "./icons.tsx";

// Last meaningful change to the policy text below. Bump this whenever the
// wording is edited — it renders verbatim at the top of the page and is the
// only line readers have to look at to see how fresh the policy is.
const LAST_UPDATED = "2026-06-18";

export function PrivacyPage() {
  // The deploy-slot root (`/`, `/preview/`, …) — the link back to the app.
  const homeUrl = import.meta.env.BASE_URL;
  return (
    <div className="h-full overflow-y-auto bg-page-bg px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-fg">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 text-sm leading-relaxed">
        <header className="flex flex-col gap-3">
          <a
            href={homeUrl}
            className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Back to notes
          </a>
          <h1 className="text-lg font-bold text-fg-bright">Privacy policy</h1>
          <p className="text-xs text-muted">Last updated: {LAST_UPDATED}</p>
        </header>

        <Section title="Summary">
          <p>
            <span className="text-fg-bright">notes</span> is a local-first
            note-taking app served as a static site at{" "}
            <span className="text-fg-bright">notes.niclaslindstedt.se</span>. It
            runs entirely in your browser. There is no backend of our own, no
            account, no cookies, and no analytics or tracking. Your notes are
            stored only on your device and never leave it. The project authors
            never receive your notes in any configuration.
          </p>
        </Section>

        <Section title="What the app stores">
          <p>
            On your device, inside your browser&apos;s{" "}
            <code className="text-fg-bright">localStorage</code> for the origin{" "}
            <span className="text-fg-bright">notes.niclaslindstedt.se</span>,
            the app keeps:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              The text of your notes and when each was created and edited.
            </li>
            <li>
              Per-device preferences — your chosen theme and where the floating
              menu button rests.
            </li>
          </ul>
          <p>
            This data is stored as plain JSON on your own device. Clearing your
            browser&apos;s site data for this origin erases it permanently —
            there is no copy elsewhere to restore from.
          </p>
        </Section>

        <Section title="Network requests">
          <p>
            The app makes no third-party network calls. The only requests your
            browser makes are to fetch the app&apos;s own static files (HTML,
            JavaScript, CSS, fonts, and icons) from its origin, and once loaded
            it works fully offline as an installed PWA. No fonts, analytics
            scripts, error-reporting services, or advertising networks are ever
            loaded.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            The app sets no cookies. All persistence uses{" "}
            <code className="text-fg-bright">localStorage</code>.
          </p>
        </Section>

        <Section title="Web analytics">
          <p>
            None. The app does not load any analytics or behavioural-tracking
            SDK, and the project authors collect no usage statistics from it.
          </p>
        </Section>

        <Section title="Server logs">
          <p>
            The static bundle is served by{" "}
            <strong className="text-fg-bright">GitHub Pages</strong>. GitHub may
            collect standard request metadata (IP address, user agent, request
            path) for operating the service. This is covered by{" "}
            <a
              href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
              className="text-link hover:underline"
            >
              GitHub&apos;s privacy statement
            </a>
            . The project authors do not run an additional logging service.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The app is a general-purpose note-taking tool and is not directed at
            children under 13.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            Material changes are tracked in the public commit history of the
            source repository. The <em>Last updated</em> date at the top of this
            page reflects the most recent edit. Should a future version add a
            feature that sends data anywhere, this policy will be updated to
            describe it before that feature ships enabled.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For everything, open an issue at{" "}
            <a
              href="https://github.com/niclaslindstedt/notes/issues"
              className="text-link hover:underline"
            >
              github.com/niclaslindstedt/notes
            </a>
            .
          </p>
        </Section>
      </article>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-bold tracking-wide text-fg-bright">
        {title}
      </h2>
      {children}
    </section>
  );
}
