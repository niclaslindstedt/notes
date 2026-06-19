// Standalone privacy policy, served at `/privacy` (see `app/main.tsx`'s
// path switch and the `emit-privacy-alias` plugin in `vite.config.ts`).
// notes is local-first with no backend of our own, no accounts, and no
// analytics — by default everything stays in the browser. The one way data
// leaves the device is the opt-in sync backends (a picked local folder, the
// user's own Dropbox, the user's own Google Drive), which this policy
// describes in full because the Google Drive scope is verified against it.
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
            account, no cookies, and no analytics or tracking. By default your
            notes are stored only on your device and never leave it.
          </p>
          <p>
            You may <span className="text-fg-bright">optionally</span> turn on
            sync to a storage location <em>you</em> control — a local folder on
            your computer, your own Dropbox, or your own Google Drive — so the
            same notes appear on more than one device. Even then your notes go
            only to that location in your own account; the project authors never
            receive your notes in any configuration. The{" "}
            <a className="text-link hover:underline" href="#cloud-sync">
              Optional sync
            </a>{" "}
            section below explains exactly what is sent, where, and why.
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
              Any images you attach to a note. On a local folder or cloud
              backend these are written as ordinary image files in an{" "}
              <code className="text-fg-bright">attachments</code> folder beside
              your notes; they are read from your device when you paste or drop
              them and are never sent anywhere other than the sync backend you
              chose.
            </li>
            <li>
              Your <em>namespaces</em> — the named buckets you group notes into,
              with each one&apos;s label, icon, and colour.
            </li>
            <li>
              Per-device preferences — your chosen theme and appearance, where
              the floating menu button rests, and which in-app achievements you
              have unlocked.
            </li>
            <li>
              If you turn on an optional sync backend, the small amount of
              configuration it needs to reconnect (for example, which folder you
              picked or an access token your cloud provider issued to this
              browser).
            </li>
          </ul>
          <p>
            This data is stored as plain JSON on your own device. Clearing your
            browser&apos;s site data for this origin erases the local copy
            permanently — if you have not enabled sync, there is no copy
            elsewhere to restore from.
          </p>
        </Section>

        <Section title="Network requests">
          <p>
            With no sync backend enabled, the app makes no third-party network
            calls. The only requests your browser makes are to fetch the
            app&apos;s own static files (HTML, JavaScript, CSS, fonts, and
            icons) from its origin, and once loaded it works fully offline as an
            installed PWA. No fonts, analytics scripts, error-reporting
            services, or advertising networks are ever loaded.
          </p>
          <p>
            If you opt in to Dropbox or Google Drive sync, the app additionally
            talks directly from your browser to that provider&apos;s own API to
            sign you in and to read and write your notes. Those requests go to
            the provider, not to us. See <em>Optional sync</em> below.
          </p>
        </Section>

        <Section title="Optional sync" id="cloud-sync">
          <p>
            Sync is off until you choose a backend yourself. You can pick one of
            three places to keep a copy of your notes, and you can switch back
            to local-only at any time:
          </p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <span className="text-fg-bright">Local folder.</span> Using your
              browser&apos;s File System Access API, you grant the app access to
              a folder you pick on your own computer. Your notes are written
              there as ordinary <code className="text-fg-bright">.md</code>{" "}
              markdown files. Nothing is sent over the network; the data never
              leaves your machine.
            </li>
            <li>
              <span className="text-fg-bright">Google Drive.</span> The app
              requests only the{" "}
              <code className="text-fg-bright">drive.file</code> scope, which
              lets it see and manage <em>only the files it itself creates</em> —
              a single <code className="text-fg-bright">notes/</code> folder of
              your notes. It cannot see, read, or touch any other file in your
              Drive. Sign-in uses Google&apos;s OAuth flow, and the access token
              Google returns is held only in this browser.
            </li>
            <li>
              <span className="text-fg-bright">Dropbox.</span> The app uses an
              app-scoped folder, so it can only read and write inside its own
              dedicated folder — never the rest of your Dropbox. Sign-in uses
              Dropbox&apos;s OAuth flow (PKCE), and the resulting token is held
              only in this browser.
            </li>
          </ul>
          <p>
            In every case the data the app reads or writes is{" "}
            <span className="text-fg-bright">your notes and nothing else</span>,
            it stays in your account in your provider, and the project authors
            never receive it or hold any token for it. The notes are stored as
            plain markdown files you can open, edit, or delete yourself with any
            tool. Revoke the app&apos;s access at any time from your
            provider&apos;s security settings and it simply stops syncing.
          </p>
          <p>
            When a cloud backend is active the app also keeps an offline mirror
            of the synced bytes in this browser&apos;s storage, so you can read
            and edit while disconnected; it reconciles with your provider when
            the connection returns.
          </p>
        </Section>

        <Section title="Encryption">
          <p>
            You may optionally protect a synced note store with a passphrase.
            When enabled, your notes are encrypted in your browser with AES-GCM
            before they are written, so the bytes stored in the folder or cloud
            — and in the offline mirror — are ciphertext. The passphrase stays
            on your device and is never sent anywhere; if you lose it, the notes
            cannot be recovered.
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
            page reflects the most recent edit. Should a future version change
            what data is stored or sent, or add another place it can be sent,
            this policy will be updated to describe it before that change ships.
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
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-2 scroll-mt-10">
      <h2 className="text-sm font-bold tracking-wide text-fg-bright">
        {title}
      </h2>
      {children}
    </section>
  );
}
