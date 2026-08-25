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
              Markdown body that formats as you type. The row the cursor is on
              keeps its formatting like every other one — a bold word stays bold
              while you edit it, with the markers that made it bold shown
              faintly beside it so you can see them and take them off. New notes
              can be named automatically by date and time or with a running
              number, and each note is tidied as it's saved — trailing spaces
              trimmed and a closing newline added, both optional in Settings.
              Long pasted links can be shortened in the preview so they don't
              sprawl across the note — the full link is still saved and still
              opens. Tapping the text puts the cursor at the end of the word
              under your finger, which is something a fingertip can actually aim
              at, while a mouse click lands exactly where you point. Line
              numbers can be switched on down the editor's left edge,
              code-editor style, where pressing a number selects that whole
              line. While the app is open, hopping between notes drops you back
              at the exact spot and cursor position you left each one at. On a
              phone, where the header has room for the note&apos;s name or its
              buttons but not both, those buttons fold into a single{" "}
              <span aria-hidden>⋯</span> control on the right — pressing it
              slides them back out over the title, and touching the note again
              folds them away and hands the title back. Select some text and the
              three buttons that act on a selection — formatting, cut and copy —
              slide out on their own, so what you just highlighted is one tap
              from being styled, cut or copied.
            </li>
            <li>
              Picking out lines is a mode of its own. The button left of the
              magnifier turns the note into a list you choose from: one press
              takes a whole line and a second press on it gives that line back,
              so picking one line never gives up the last one — the lines you
              want need not even be next to each other. For a run of them, drag
              down the rail at the note&rsquo;s left edge; everywhere to the
              right of it the note keeps scrolling as it always did, so you can
              travel between picks without fighting the gesture. There are no
              handles to aim at a single character with, which is what makes
              taking eight lines on a phone awkward otherwise. The lines you
              have taken are tinted along with their line numbers rather than
              wearing the ordinary selection colour, so the two are never
              confused. From there you can type over them, delete them, copy or
              cut them, or style every one of them at once. On a phone a bar
              rises at the top of the note the moment a line is taken, with a
              cut half and a delete half, so the two things you most want to do
              with a run of lines are one tap away instead of hidden behind the
              header&rsquo;s ⋯. <kbd>Esc</kbd> leaves the mode, handing an
              unbroken run over as an ordinary selection.
            </li>
            <li>
              On a computer, edit at more than one place at once — the same
              multiple cursors a code editor gives you. <kbd>⌘</kbd>/
              <kbd>Ctrl</kbd>+<kbd>D</kbd> selects the word under the cursor,
              and each press after that adds a cursor over the next occurrence
              of it, so renaming something that appears six times in a note is
              one word typed once. <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>↑</kbd> and{" "}
              <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>↓</kbd> instead build a plain
              column of cursors a line at a time, for putting the same thing
              down the edge of a list. Typing, deleting, the arrow keys, copy
              and paste all answer at every cursor at once, and <kbd>Esc</kbd> —
              or a click anywhere in the note — drops you back to the single
              cursor you started from.
            </li>
            <li>
              Reach for the formatting button at the top right of a note to open
              a styling toolbar above the text — headings, bold, italic,
              strikethrough, inline code, bullet, numbered and checklist lists
              (with indent and outdent for sub-points), quotes, code blocks,
              links, images, and dividers, one button each. It writes ordinary
              Markdown, so anything you reach for there you can just as well
              type by hand, and every button is a toggle — the toolbar lights up
              whatever the cursor is already sitting in, from the heading it's
              on to the bold or italic phrase around it, so pressing a lit
              button takes that formatting back off.
            </li>
            <li>
              Tap <kbd>space</kbd> twice at the end of a word and the sentence
              ends itself — the second space becomes a full stop, cursor left
              ready for the next sentence. It is the shortcut your phone applies
              in any other text field, done by the app so it works the same on a
              computer. Two spaces after a full stop stay two spaces, code
              blocks are left verbatim, and <em>Disable auto correct</em> in
              Settings turns it off.
            </li>
            <li>
              Sentences start with a capital. The note writes it for you — the
              first letter of a line, and the first letter after a full stop,
              question mark or exclamation mark — so the capital your phone puts
              in everywhere else is there in the editor too, and on a computer
              where nothing offers it at all. File names and decimals keep their
              lower case, code blocks are left exactly as typed, and{" "}
              <em>Capitalise sentences</em> in Settings turns it off.
            </li>
            <li>
              Lists write themselves. <kbd>Enter</kbd> on a bullet or numbered
              row opens the next one — numbers count up as you go — and{" "}
              <kbd>Tab</kbd> tucks a row in under the one above it, with{" "}
              <kbd>Shift</kbd>+<kbd>Tab</kbd> to pull it back out. Press{" "}
              <kbd>Enter</kbd> on an empty row to step back out of the list, or{" "}
              <kbd>Shift</kbd>+<kbd>Enter</kbd> to add another line to the point
              you are already on. Quotes carry on the same way.
            </li>
            <li>
              Checklists you can actually tick. A row written{" "}
              <code>- [ ] milk</code> draws a real checkbox — tap it and the
              item is checked off there and then, without opening the editor or
              raising the keyboard on a phone. The tick is written straight into
              the Markdown as <code>- [x]</code>, so it is part of the note and
              travels with it wherever you keep it. <kbd>Enter</kbd> opens the
              next item, always unchecked — and the formatting toolbar&apos;s{" "}
              <em>Checklist</em> style turns any lines you have into checkboxes
              without typing the brackets yourself.
            </li>
            <li>
              Cut text out with the <em>scissors</em> button beside the copy
              button: it takes whatever you have selected, or — with nothing
              selected — the whole line the cursor is on, or just the text after
              it when the cursor is parked mid-sentence. What it takes goes on
              your clipboard, ready to paste back somewhere else.{" "}
              <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> does the same from the
              keyboard, and Undo puts it back. The button itself is a touch
              affordance — on a computer, where the shortcut and the right-click
              menu already cut, the header leaves it out.
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
              Set up your own <em>transform rules</em> in Settings and the app
              rewrites what a note shows without touching what it stores. A rule
              matches part of a note with a regular expression and displays
              something else in its place: an issue number like{" "}
              <code className="text-fg-bright">#134</code> as a link straight to
              that issue, a shorthand as the words it stands for, or a phone
              number as <code className="text-fg-bright">076****123</code> so it
              isn&apos;t readable over your shoulder. The note itself never
              changes — put the cursor on the line to see exactly what you
              typed, and copying always copies the original. Everything happens
              on your device; a rule is a pattern you wrote, and no text is sent
              anywhere to match it. Each rule is built in a dialog where you
              type sample text and watch the result underneath, so you can see
              what it does before you keep it. A rule belongs to one namespace
              (see below), so the rewrites you want at work leave your notes at
              home alone — or you can set a rule to apply in all of them.
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
              in a note's header, or <em>⌘F / Ctrl+F</em>, drops a search bar
              under the top bar, lights up every match as you type, and steps
              between them with arrows (or Enter) while telling you which of how
              many you are on. It reads only the note in front of you, and never
              leaves your device.
            </li>
            <li>
              <em>Find and replace</em> — pressing the magnifier in that same
              search bar unfolds a second field: what the matches should become,
              and the buttons that apply it to the one you are standing on or to
              all of them at once. The{" "}
              <code className="text-fg-bright">.*</code> switch reads what you
              typed as a <em>regular expression</em> instead of literal text, so
              a pattern can find what a plain search can&apos;t and its capture
              groups can be pasted into the replacement as{" "}
              <code className="text-fg-bright">$1</code>. Before you commit to
              anything, <em>preview</em> lists every line that would change —
              what goes, and what arrives in its place — while writing nothing;
              and once you do, the whole replacement is a single undo away. All
              of it runs in your browser, on the note you have open.
            </li>
            <li>
              <em>Export a note</em> from the up arrow in its header — as a{" "}
              <em>PDF</em>, as a plain{" "}
              <code className="text-fg-bright">.md</code> file, or straight to
              your clipboard. The PDF is typeset and written by the app itself
              and arrives as an ordinary download — no print dialog, and nothing
              stamping a URL or a date into the margins — and Settings → Export
              decides how the page looks: paper size and margins, the body and
              heading fonts and their sizes, the monospaced family and the
              background behind code, the bullet character, and whether the
              pages are numbered — down to how that number reads (
              <code className="text-fg-bright">2 of 7</code>,{" "}
              <code className="text-fg-bright">2 / 7</code> or a bare{" "}
              <code className="text-fg-bright">2</code>) and which edge of the
              page it sits against. The Markdown export is the same file the app
              stores your notes as, so it opens anywhere and comes back
              unchanged. The clipboard option takes, by default, just the body —
              or, if you choose so in Settings, the title and body or the whole
              Markdown file with its frontmatter. Every export happens on your
              device: nothing is uploaded to convert it, and the clipboard is
              written locally.
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
              A namespace can be shared with other people by sharing its folder
              (or the account behind it), and everything that protects or
              configures one applies to that namespace alone: its own settings,
              its own optional PIN, its own optional encryption passphrase.
            </li>
            <li>
              Put a <em>PIN</em> on a namespace so it asks for a short code
              before it opens. The code travels with the namespace, so every
              device you use — and everyone you share it with — is asked for it.
              It is a light gate against a mis-tap or a borrowed phone; the
              notes behind it are still stored as ordinary text, so encryption
              (below) is what actually keeps a namespace from being read.
            </li>
            <li>
              Organise the notes within a namespace into <em>folders</em> — make
              one from the side menu, then drag notes into it or create new ones
              straight inside it. Drag a whole folder onto another namespace to
              move it there with everything in it.
            </li>
            <li>
              Hand a scrap of text to your other devices with the{" "}
              <em>dropzone</em>. Press and hold any “new note” button and you
              get a temporary note, already named after the moment you made it,
              waiting in a Dropzone section at the top of the side menu instead
              of among your notes. Write the link, the address or the code on
              one device, pick it up on another, and tick the checkmark in its
              editor to delete it — dropzone notes are meant to be thrown away,
              so they are deleted rather than archived. Give one a name of your
              own instead and the app offers to keep it as a regular note. The
              dropzone is only offered when your notes are stored somewhere your
              other devices can read — a synced folder, a cloud, or your own
              server — since it has nothing to do otherwise; it uses the storage
              you have already connected and sends nothing anywhere new.
            </li>
            <li>
              Mark the notes you keep coming back to as <em>favorites</em> — the
              star in a note's header lifts it into a Favorites section at the
              top of the side menu, so it is one tap away wherever it is filed.
              The note itself does not move; Favorites lists them flat by
              default, and a setting can reproduce their folder structure there
              instead.
            </li>
            <li>
              <em>Lock a note</em> so it cannot be edited — the eye button
              beside the star in a note's header makes it read-only. A locked
              note takes no cursor at all, so the on-screen keyboard stays down
              and nothing can be typed into the reference note you keep open by
              accident. You can still read, select, copy, search and export it,
              and pressing the eye again unlocks it. The lock is stored with the
              note, so it stays locked on your other devices; it is a guard
              against stray keystrokes rather than a password, which is what the
              separate encryption option below is for.
            </li>
            <li>
              <em>Search across every note</em> from the magnifier on the side
              menu, or with <em>⌘⇧F / Ctrl+Shift+F</em> — it matches both titles
              and body text, is forgiving by default (a rough abbreviation still
              finds the note), and also understands wildcards and regular
              expressions. The search runs entirely in your browser, and finds
              your notes even when they're stored encrypted, without sending
              anything anywhere.
            </li>
            <li>
              Pick a theme and appearance that suits you — including whether the
              overview lists notes as compact rows, roomier cards, or a bare
              file-explorer list of titles, and how the side menu orders your
              folders and notes (folders on top or mixed in, sorted by name or
              by what you edited last). You can also fold the side menu's footer
              away to hand its space to the note list, and — on a wide screen,
              where the side menu is docked open beside your notes — collapse
              the whole menu so the note takes the full width, bringing it back
              from a handle that appears when you move the pointer to that edge
              of the screen; your preferences are remembered on the device.
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
              required once it has loaded. There are also downloadable{" "}
              <a
                href="https://github.com/niclaslindstedt/notes/releases/latest"
                className="text-link hover:underline"
              >
                desktop builds
              </a>{" "}
              for Windows, macOS, and Linux: the same app in its own window,
              sending nothing anywhere. Cloud sync is available in the browser
              and mobile app only.
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
              Optionally encrypt a namespace at rest with a passphrase only you
              hold. Encryption is chosen per namespace, so you can seal the one
              you keep to yourself and leave the one you share with other people
              readable — or give the shared one its own passphrase that only the
              people in it know. Each note and each attachment is compressed and
              encrypted in your browser into its own file under an opaque name,
              so titles, filenames, and your images are unreadable in the folder
              or cloud. A green lock fills in note-by-note as the app seals
              them. Unlocking is instant however many notes you have — the list
              opens from a small encrypted index, and each note&apos;s text is
              decrypted the moment you open it, so an opened note downloads only
              its own body and attachments and stays readable offline once
              you&apos;ve opened it. Turn encryption on from one device and
              every other device syncing that namespace notices, locks itself,
              and asks for the same passphrase before it will show or write your
              notes — so no device is left holding them in the clear. Your other
              namespaces are unaffected, and a locked one always offers to open
              a different one instead.
            </li>
            <li>
              Choose <em>how far each setting reaches</em>. The chevron beside
              Save in Settings writes a change for everyone using the account,
              for everyone using the current namespace, or for this device only
              — and the narrowest choice wins. Device settings are never
              uploaded anywhere, so on a namespace shared with other people your
              own theme, font, and editor preferences stay yours while the notes
              stay shared. The chevron beside Reset walks the same ladder back:
              return a setting to what the namespace says, to what the account
              says, or to the app&apos;s defaults.
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
