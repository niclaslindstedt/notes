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
              editable title (heading the page beside a back button) and a
              Markdown body that formats as you type. New notes can be named
              automatically by date and time or with a running number, and each
              note is tidied as it's saved — trailing spaces trimmed and a
              closing newline added, both optional in Settings. Long pasted
              links can be shortened in the preview so they don't sprawl across
              the note — the full link is still saved and still opens. Tapping
              the text puts the cursor at the end of the word under your finger,
              which is something a fingertip can actually aim at, while a mouse
              click lands exactly where you point. Line numbers can be switched
              on down the editor's left edge, code-editor style, where pressing
              a number selects that whole line. While the app is open, hopping
              between notes drops you back at the exact spot and cursor position
              you left each one at.
            </li>
            <li>
              Reach for the formatting button at the top right of a note to open
              a styling toolbar above the text — headings, bold, italic,
              strikethrough, inline code, bullet and numbered lists (with indent
              and outdent for sub-points), quotes, code blocks, links, images,
              and dividers, one button each. It writes ordinary Markdown, so
              anything you reach for there you can just as well type by hand,
              and every button is a toggle — the toolbar lights up whatever the
              cursor is already sitting in, from the heading it's on to the bold
              or italic phrase around it, so pressing a lit button takes that
              formatting back off.
            </li>
            <li>
              Cut text out with the <em>scissors</em> button beside the copy
              button: it takes whatever you have selected, or — with nothing
              selected — the whole line the cursor is on, or just the text after
              it when the cursor is parked mid-sentence. What it takes goes on
              your clipboard, ready to paste back somewhere else.{" "}
              <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> does the same from the
              keyboard, and Undo puts it back.
            </li>
            <li>
              Swipe a note right — in the overview or the side menu — to{" "}
              <em>archive</em> it: it leaves the list without being deleted, and
              you can restore it from the Archive view. Swipe left to uncover a
              quick Delete. On a computer, right-click a note instead for a menu
              of the same actions.
            </li>
            <li>
              Undo and redo your changes — bring back a deleted or archived note
              or step back through your edits, with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>
              +<kbd>Z</kbd> or the side menu.
            </li>
            <li>
              Your browser&apos;s <em>Back</em> and <em>Forward</em> walk the
              notes you have visited — open one note, then another, and Back
              returns you to the first (Android&apos;s back gesture too).
            </li>
            <li>
              Every note has its own <em>address</em>, so you can copy the link
              — out of the address bar, or with <em>Copy link</em> in a
              note&apos;s right-click menu — and reopen that exact note later
              from a bookmark, a calendar entry, or a message to yourself. The
              address lives after the <code className="text-fg-bright">#</code>,
              so it is never sent to any server, and it only opens the note on a
              device that already has it — your notes are not published or
              shared by a link.
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
              Paste a <em>YouTube link</em> into a note and it becomes a video
              player right where you pasted it — every link shape works (the
              mobile site, <code className="text-fg-bright">youtu.be</code>,
              Shorts, an embed address), and the tracking parameters that ride
              along are trimmed off. Nothing is loaded from YouTube until you
              press play: the card shows the video&apos;s poster image until
              then, and the player itself is loaded from YouTube&apos;s
              cookie-free address. The button in the player&apos;s corner lifts
              it into <em>widescreen</em> — the note blurs away behind it and
              the video fills the screen, without losing your place in it — and
              puts it back again.
            </li>
            <li>
              <em>Find text inside the note you have open</em> — the magnifier
              in a note's header drops a search bar under the top bar, lights up
              every match as you type, and steps between them with arrows (or
              Enter) while telling you which of how many you are on. It reads
              only the note in front of you, and never leaves your device.
            </li>
            <li>
              <em>Copy</em> a note to your clipboard with the button in its
              header — by default just the body, or, if you choose so in
              Settings, the title and body or the whole Markdown file with its
              frontmatter. It stays on your device; the clipboard is written
              locally.
            </li>
            <li>
              Lift a <em>code block</em> out of a note in one tap — every block
              fenced in <code>```</code> carries a small copy button in its
              top-right corner that puts the code (and only the code) on your
              clipboard, without placing the cursor in the note or selecting a
              line by hand. As with the note copy above, the clipboard is
              written locally and nothing is sent anywhere.
            </li>
            <li>
              Group notes into separate <em>namespaces</em> — independent
              buckets you can switch between, each with its own icon and colour.
            </li>
            <li>
              Organise the notes within a namespace into <em>folders</em> — make
              one from the side menu, then drag notes into it or create new ones
              straight inside it. Drag a whole folder onto another namespace to
              move it there with everything in it.
            </li>
            <li>
              <em>Search across every note</em> from the magnifier on the side
              menu — it matches both titles and body text, is forgiving by
              default (a rough abbreviation still finds the note), and also
              understands wildcards and regular expressions. The search runs
              entirely in your browser, and finds your notes even when they're
              stored encrypted, without sending anything anywhere.
            </li>
            <li>
              Pick a theme and appearance that suits you — including whether the
              overview lists notes as compact rows, roomier cards, or a bare
              file-explorer list of titles, and how the side menu orders your
              folders and notes (folders on top or mixed in, sorted by name or
              by what you edited last). You can also fold the side menu's footer
              away to hand its space to the note list; your preferences are
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
              In the installed app, optionally sync to your own{" "}
              <span className="text-fg-bright">self-hosted server</span> — run
              the small <code className="text-fg-bright">notesd</code> daemon on
              a computer you own and pair the app to it over your own network,
              with no cloud provider and no accounts involved. The connection is
              locked to that daemon&apos;s own certificate. This backend is
              available only in the app, not the website.
            </li>
            <li>
              Your notes stay browsable in the folder they sync to: one plain
              markdown file per note, with the ones you&apos;ve archived filed
              into an <code className="text-fg-bright">archived/</code>{" "}
              subfolder, so what you see on disk matches what you see in the
              app. Because it is a real folder, you can drop your own files into
              it — and if notes finds something there it can&apos;t match to a
              note, it shows you the file and asks whether to import it as a
              note, delete it, or leave it alone. It never deletes a file you
              put there on its own.
            </li>
            <li>
              With a folder or cloud backend connected, edits made on one device
              show up on your others on their own — notes checks the backend for
              changes every few seconds and pulls them in while you read, even
              with a note open. It waits for a pause in your typing first, so it
              never overwrites what you&apos;re writing.
            </li>
            <li>
              Optionally encrypt everything at rest with a passphrase only you
              hold. Each note and each attachment is compressed and encrypted in
              your browser into its own file under an opaque name, so titles,
              filenames, and your images are unreadable in the folder or cloud.
              A green lock fills in note-by-note as the app seals them.
              Unlocking is instant however many notes you have — the list opens
              from a small encrypted index, and each note&apos;s text is
              decrypted the moment you open it, so an opened note downloads only
              its own body and attachments and stays readable offline once
              you&apos;ve opened it. Turn encryption on from one device and
              every other device syncing the same folder notices, locks itself,
              and asks for the same passphrase before it will show or write your
              notes — so no device is left holding them in the clear.
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
            about you. The one thing that reaches a third party without you
            turning it on is a YouTube link you put in a note yourself, which
            fetches that video&apos;s poster image from YouTube — and only
            fetches the player once you press play. For the full details — what
            is stored, where, and why — read the{" "}
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
