// Standalone marketing / showcase homepage, served at `/home` (see
// `app/main.tsx`'s path switch and the `emit-home-alias` plugin in
// `vite.config.ts`). This is the public landing page a first-time visitor —
// or a Google OAuth verification reviewer — sees without installing or
// signing into anything: it names the app, describes everything it does,
// states plainly why it ever asks for access to a cloud account, and links
// to the privacy policy. It is English-only by design, mirroring
// `PrivacyPage`.
import { ArrowLeftIcon } from "./icons.tsx";

export function HomePage() {
  // BASE_URL carries the trailing slash, so these resolve per deploy slot:
  // `/` + … in production, `/preview/` + … in the preview slot, etc.
  const appUrl = import.meta.env.BASE_URL;
  const privacyUrl = `${import.meta.env.BASE_URL}privacy`;
  return (
    <div className="h-full overflow-y-auto bg-page-bg px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-fg">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 leading-relaxed">
        <header className="flex flex-col gap-4">
          <a
            href={appUrl}
            className="inline-flex items-center gap-1.5 self-start text-xs text-link hover:underline"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Open the app
          </a>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-fg-bright">notes</h1>
            <p className="text-base text-muted">
              A local-first, open-source note-taking app that works great on
              mobile and desktop — hosted at{" "}
              <span className="text-fg-bright">notes.niclaslindstedt.se</span>.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={appUrl}
              className="rounded-md bg-accent px-4 py-2 font-semibold text-page-bg hover:opacity-90"
            >
              Launch notes
            </a>
            <a
              href={privacyUrl}
              className="rounded-md border border-line px-4 py-2 font-semibold text-fg hover:bg-surface-2 hover:text-fg-bright"
            >
              Privacy policy
            </a>
          </div>
        </header>

        <Section title="What notes is">
          <p>
            <span className="text-fg-bright">notes</span> is a free, open-source
            Progressive Web App (PWA) for writing and organising notes. It runs
            entirely in your browser and can be installed to your home screen so
            it opens like a native app and works fully offline. There is no
            account to create and nothing to pay for — open the page and start
            writing.
          </p>
          <p>
            It is <span className="text-fg-bright">local-first</span>: by
            default your notes live only on the device you wrote them on, inside
            your browser&apos;s own storage. The project is developed in the
            open; you can read every line of its source on{" "}
            <a
              href="https://github.com/niclaslindstedt/notes"
              className="text-link hover:underline"
            >
              GitHub
            </a>
            .
          </p>
        </Section>

        <Section title="What you can do with it">
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              Write, edit, and organise plain-text notes — each with its own
              editable title (heading the page beside the app glyph) and a
              Markdown body that formats as you type. New notes can be named
              automatically by date and time or with a running number, and each
              note is tidied as it's saved — trailing spaces trimmed and a
              closing newline added, both optional in Settings.
            </li>
            <li>
              Swipe a note right — in the overview or the side menu — to{" "}
              <em>archive</em> it: it leaves the list without being deleted, and
              you can restore it from the Archive view. Swipe left to uncover a
              quick Delete.
            </li>
            <li>
              Undo and redo your changes — bring back a deleted or archived note
              or step back through your edits, with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>
              +<kbd>Z</kbd> or the side menu.
            </li>
            <li>
              On a computer, drag and drop Markdown files anywhere onto the app
              to <em>import</em> them — each file becomes a note, with its
              filename as the title. The files are read in your browser and
              never uploaded anywhere.
            </li>
            <li>
              Attach images and files to a note — paste (<kbd>Ctrl</kbd>/
              <kbd>⌘</kbd>+<kbd>V</kbd>) or drag a file into the editor. An
              image appears as a clickable thumbnail; any other file (a PDF, an
              archive, a spreadsheet…) appears as a chip you can click to
              download. They are saved as ordinary files in an{" "}
              <em>attachments</em> folder beside your notes, so this is
              available when you sync to a local folder, Dropbox, or Google
              Drive (see below). You can choose in Settings to collect images
              and files in a block at the end of the note instead of inline.
            </li>
            <li>
              <em>Copy</em> a note to your clipboard with the button beside the
              sync glyph — by default just the body, or, if you choose so in
              Settings, the title and body or the whole Markdown file with its
              frontmatter. It stays on your device; the clipboard is written
              locally.
            </li>
            <li>
              Group notes into separate <em>namespaces</em> — independent
              buckets you can switch between, each with its own icon and colour.
            </li>
            <li>
              Pick a theme and appearance that suits you; your preferences are
              remembered on the device.
            </li>
            <li>
              Use the app in <em>English</em> or <em>Swedish</em> — it follows
              your device language by default and remembers your choice.
            </li>
            <li>
              Earn <em>achievements</em> as you discover features — an optional,
              for-fun tour of everything the app can do, which you can switch
              off whenever you like.
            </li>
            <li>
              Install it as an app and keep using it offline — no connection
              required once it has loaded.
            </li>
            <li>
              Optionally sync your notes to a location you control: a local
              folder on your computer, your own Dropbox, or your own Google
              Drive (see below).
            </li>
            <li>
              With a folder or cloud backend connected, edits made on one device
              show up on your others on their own — notes checks the backend for
              changes every few seconds and pulls them in while you read, even
              with a note open. It waits for a pause in your typing first, so it
              never overwrites what you&apos;re writing.
            </li>
          </ul>
        </Section>

        <Section title="Why notes might ask for access to your cloud storage">
          <p>
            By default, notes never talks to any server beyond fetching its own
            static files. Cloud sync is an{" "}
            <span className="text-fg-bright">entirely optional</span> feature
            you turn on yourself, only if you want the same notes on more than
            one device. When you choose a cloud backend, the app asks{" "}
            <em>your</em> cloud provider for permission so it can read and write{" "}
            <span className="text-fg-bright">your own notes</span> as ordinary
            files in <span className="text-fg-bright">your own account</span>:
          </p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>
              <span className="text-fg-bright">Google Drive.</span> notes
              requests only the{" "}
              <code className="text-fg-bright">drive.file</code> scope, which
              lets the app see and manage{" "}
              <em>only the files it itself creates</em> — a single{" "}
              <code className="text-fg-bright">notes/</code> folder of your
              notes. It cannot see, read, or touch any other file in your Drive.
            </li>
            <li>
              <span className="text-fg-bright">Dropbox.</span> notes uses an
              app-scoped folder, so it can only read and write inside its own
              dedicated folder — never the rest of your Dropbox.
            </li>
          </ul>
          <p>
            In every case the data the app reads or writes is{" "}
            <span className="text-fg-bright">your notes and nothing else</span>,
            it stays in your account, and the project authors never receive it.
            The notes are stored as plain markdown files you can open, edit, or
            delete yourself with any tool. Revoke access at any time from your
            provider&apos;s security settings and the app simply stops syncing.
          </p>
        </Section>

        <Section title="Your privacy">
          <p>
            notes sets no cookies, loads no analytics or tracking scripts, and
            shows no ads. There is no backend of our own collecting anything
            about you. For the full details — what is stored, where, and why —
            read the{" "}
            <a href={privacyUrl} className="text-link hover:underline">
              privacy policy
            </a>
            .
          </p>
        </Section>

        <Section title="Contact &amp; source">
          <p>
            notes is open source. Browse the code, report a bug, or ask a
            question at{" "}
            <a
              href="https://github.com/niclaslindstedt/notes"
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
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="text-base font-bold tracking-wide text-fg-bright">
        {title}
      </h2>
      {children}
    </section>
  );
}
