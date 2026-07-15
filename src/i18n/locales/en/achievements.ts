import type { Widen } from "./_widen.ts";

// Strings for the achievements feature — the header trophy button, the
// unlock-notification modal, the four-tier tour chrome, and the
// per-achievement catalog. The runtime reads `catalog.<id>.{name,condition,
// learnMore}` by id (see `src/ui/achievements/AchievementsModal.tsx`); the
// Swedish file mirrors this shape key-for-key.

const achievements = {
  button: {
    open: "Achievements",
    unseenOne: "1 new achievement",
    unseenOther: "{n} new achievements",
  },
  unlockModal: {
    titleOne: "Achievement unlocked!",
    titleOther: "{n} achievements unlocked!",
    dismiss: "Awesome!",
  },
  modal: {
    title: "Achievements",
    counter: "{unlocked} of {total} unlocked · {earned}/{max} points",
    intro:
      "Every feature in the app is also a trophy. As you use it — writing a note, switching themes, connecting the cloud — you quietly earn achievements. You don't chase them; they find you.",
    learnMore: "Learn more",
    locked: "Locked",
    tier: {
      beginner: {
        title: "Beginner",
        subtitle: "Just opened the app — finding your feet.",
      },
      intermediate: {
        title: "Intermediate",
        subtitle: "Making it yours.",
      },
      pro: {
        title: "Pro",
        subtitle: "Sync it, secure it, take it everywhere.",
      },
      expert: {
        title: "Expert",
        subtitle: "Bend the app to your exact workflow.",
      },
    },
  },
  catalog: {
    // ── Beginner ──────────────────────────────────────────────────────
    firstNote: {
      name: "First note",
      condition: "Write your first note.",
      learnMore:
        "Tap the + button (or press Enter on the empty list) to start a note. Everything you type is saved automatically as you go.",
    },
    wordsmith: {
      name: "Wordsmith",
      condition: "Write a note that runs to more than one line.",
      learnMore:
        "A note's title is its own field at the top; everything below it is the body. Notes render Markdown as you write.",
    },
    headliner: {
      name: "Headliner",
      condition: "Give a note a title.",
      learnMore:
        "The title is its own row at the top of the note — type it there rather than as the first line of the body. It can't be reached by backspacing from the body, and it names the note's file when you sync to a folder or the cloud.",
    },
    interiorDesigner: {
      name: "Interior designer",
      condition: "Switch to a different theme.",
      learnMore:
        "Settings → Appearance offers a range of light and dark editor themes. Your choice is saved on this device (and travels with cloud sync).",
    },
    biggerPicture: {
      name: "The bigger picture",
      condition: "Change the interface text size.",
      learnMore:
        "Settings → Appearance scales the whole UI up or down, so the app reads comfortably on any screen.",
    },
    secondThoughts: {
      name: "Second thoughts",
      condition: "Undo an edit.",
      learnMore:
        "Use the side menu's Undo (or Ctrl/Cmd+Z) to step back through your edits — creating, deleting, and writing are all reversible.",
    },
    homeScreen: {
      name: "Home screen",
      condition: "Install the app to your device.",
      learnMore:
        "notes is a Progressive Web App: add it to your home screen or launcher and it opens full-screen and works offline, just like a native app.",
    },

    // ── Intermediate ──────────────────────────────────────────────────
    collector: {
      name: "Collector",
      condition: "Keep five notes at once.",
      learnMore:
        "There's no limit on how many notes you keep. The list sorts the most recently edited to the top so what you're working on stays in reach.",
    },
    fontFanatic: {
      name: "Font fanatic",
      condition: "Pick a different font family.",
    },
    gallery: {
      name: "Gallery",
      condition: "Switch the note list to a different layout.",
      learnMore:
        "Settings → Appearance lays the overview out three ways: compact one-line rows, taller cards that show several lines of each note and fade the tail out, or a bare file-explorer list of titles only. Pick whichever you like to scan.",
    },
    sidebarArranger: {
      name: "Rearranger",
      condition: "Change how the side menu orders folders and notes.",
      learnMore:
        "Settings → Appearance → Sidebar decides whether folders pin above your notes or mix in among them, and whether the side menu sorts by name or by what you edited last.",
    },
    spaceSaver: {
      name: "Space saver",
      condition: "Fold the side menu footer away to make more room for notes.",
      learnMore:
        "The thin chevron rail just above the footer folds the Donate, trophy, About and Settings rows out of view, handing that vertical space to your note list. Tap it again to bring the footer back — the choice is remembered across reloads.",
    },
    marginalia: {
      name: "Marginalia",
      condition: "Adjust the editor's writing-column margins.",
      learnMore:
        "Settings → Editor narrows the writing column for a more focused, page-like feel — or lets it run the full width of the screen.",
    },
    plainText: {
      name: "Plain and simple",
      condition: "Turn live Markdown rendering off.",
      learnMore:
        "Prefer raw text? Settings → Editor switches the live preview off so notes stay plain, unformatted source.",
    },
    freehand: {
      name: "Freehand",
      condition: "Disable spell check or autocorrect.",
      learnMore:
        "Writing code, structured notes, or another language? Settings → Editor can stop your device checking spelling and auto-correcting as you type.",
    },
    namingConvention: {
      name: "Naming convention",
      condition: "Change the default title for new notes.",
      learnMore:
        "Settings → Editor decides what a brand-new note is called before you title it yourself — the date and time, an auto-incrementing “Note”, “Note 2”, … , or nothing at all.",
    },
    tidyUp: {
      name: "Tidy up",
      condition: "Change how notes are tidied when saved.",
      learnMore:
        "Settings → Editor tidies each note as it's saved — trimming trailing spaces from every line and ending the note with a single newline. Turn either off to keep your notes exactly as typed.",
    },
    appendix: {
      name: "Appendix",
      condition: "Show attachments at the end of the note.",
      learnMore:
        "Settings → Editor can collect a note's images and files into a block at the foot of the note instead of showing them inline where you pasted them — handy when the attachments are references, not part of the flow. Images and files toggle independently.",
    },
    shortAndSweet: {
      name: "Short and sweet",
      condition: "Turn on link shortening.",
      learnMore:
        "Settings → Editor trims long pasted URLs in the preview down to the domain plus a few characters either side of an [...] marker, so a tracking link no longer sprawls across the note. The whole link is still saved and still opens when clicked — only the display is shortened.",
    },
    archivist: {
      name: "Archivist",
      condition: "Archive a note.",
      learnMore:
        "Swipe a note right in the overview to archive it — or right-click it on a computer — and it leaves the list without being deleted. Find archived notes under Archive in the side menu, where you can restore or remove them for good.",
    },
    compartments: {
      name: "Compartments",
      condition: "Create a second namespace.",
      learnMore:
        "Namespaces are separate, self-contained sets of notes — work and home, say. Switch between them from the side menu; each can sync to its own folder.",
    },
    organizer: {
      name: "Filing system",
      condition: "Create a folder to group notes.",
      learnMore:
        "Folders group notes inside a namespace — a “Login feature”, a “Vacation 2025”. Tap the folder button on the Notes heading in the side menu to make one, then drag notes onto it (or use a note's “Move to folder”) to file them away. A folder can expand to make a new note straight inside it.",
    },
    polyglot: {
      name: "Polyglot",
      condition: "Switch the app's language.",
      learnMore:
        "notes speaks English and Swedish — switch in Settings → General and the whole interface follows. Your choice is remembered on this device.",
    },
    importer: {
      name: "Importer",
      condition: "Drag and drop a Markdown file into the app.",
      learnMore:
        "On desktop, drop one or more Markdown files anywhere on the window and each becomes a note — the file's name turns into the title and its contents fill the body.",
    },
    rightClick: {
      name: "Context switch",
      condition: "Open a note's right-click menu.",
      learnMore:
        "On a computer, right-click a note — in the overview or the side menu — for a quick menu of its actions: archive (or restore from the Archive view), and delete. It's the desktop counterpart to the swipe gestures you'd use on a touchscreen.",
    },
    copycat: {
      name: "Copycat",
      condition: "Copy a note to the clipboard.",
      learnMore:
        "The copy button beside the sync glyph puts the open note on your clipboard. Settings → Editor chooses how much it takes — just the body, the title and body, or the whole .md file with its YAML frontmatter.",
    },
    seeker: {
      name: "Seeker",
      condition: "Search your notes.",
      learnMore:
        "The magnifier on the side-menu action bar searches every note's title and body at once. It's plain text and fuzzy by default — type a rough abbreviation and it still finds the note — and also takes wildcards (recipe*, dr?ft) or a /regex/. On encrypted backends it searches the same preview the note index already holds, so it works without unlocking every note.",
    },
    whereYouLeftOff: {
      name: "Right where you left off",
      condition:
        "Reopen a note and land back at the caret and scroll you left.",
      learnMore:
        "While the app is open it remembers where the caret sat and how far you'd scrolled in each note, so hopping between notes drops you back exactly where you were — same line, same place on screen — instead of at the top. On a phone the keyboard comes back up with the caret already in place. It's per-session: a fresh reload starts each note clean.",
    },

    // ── Pro ───────────────────────────────────────────────────────────
    localVault: {
      name: "Local vault",
      condition: "Connect a folder on your device.",
      learnMore:
        "Settings → Storage can keep each note as a plain Markdown file in a folder you pick, so your notes live as ordinary files you fully own.",
    },
    cloudWalker: {
      name: "Cloud walker",
      condition: "Connect a cloud backend.",
      learnMore:
        "Connect Dropbox or Google Drive and your notes sync to your own cloud storage, so they follow you to every device you sign in on.",
    },
    freshPull: {
      name: "Fresh pull",
      condition: "Reload your notes from the backend.",
      learnMore:
        "The sync details dialog can re-read the document from the connected backend, pulling in edits another device made.",
    },
    peacemaker: {
      name: "Peacemaker",
      condition: "Resolve a sync conflict.",
      learnMore:
        "When two devices edit the same notes while apart, the app surfaces the clash and lets you keep yours or take theirs — no edits silently lost.",
    },
    pictureThis: {
      name: "Picture this",
      condition: "Paste or drop an image into a note.",
      learnMore:
        "On a local folder or cloud backend you can paste (Ctrl/Cmd+V) or drag an image straight into the editor. It's saved as a real image file under an attachments folder beside your notes and shows inline as a thumbnail you can click to open full-size.",
    },
    paperTrail: {
      name: "Paper trail",
      condition: "Attach a file to a note.",
      learnMore:
        "On a local folder or cloud backend you can paste or drag any file — a PDF, an archive, a spreadsheet — straight into the editor. It's saved as a real file under an attachments folder beside your notes and shows as a chip with its type icon you can click to download.",
    },
    liveSync: {
      name: "Telepathy",
      condition: "Watch an edit from another device arrive on its own.",
      learnMore:
        "With a folder or cloud backend connected, notes quietly checks for changes every few seconds and pulls them in by itself — so an edit you make on one device appears on another while you watch, even with the note open, as long as you've paused typing.",
    },

    // ── Expert ────────────────────────────────────────────────────────
    paranoidMode: {
      name: "Paranoid mode",
      condition: "Turn on at-rest encryption.",
      learnMore:
        "Settings → Storage encrypts your notes with a passphrase only you hold. They're sealed on disk and in the cloud until you unlock them.",
    },
    fortKnox: {
      name: "Fort Knox",
      condition: "Encrypt every note and all its attachments at rest.",
      learnMore:
        "Each note becomes its own encrypted file and each attachment its own encrypted blob, compressed and opaquely named. A green lock fills in note-by-note as the background migration seals them — when every note is locked, you're here.",
    },
    keyHandoff: {
      name: "Key handoff",
      condition: "Open the app on a device after encrypting from another.",
      learnMore:
        "Encryption travels with your notes. Turn it on with one device and the next device to sync the same folder notices the encrypted notes, locks itself, and asks for the passphrase you set — so a plaintext device can never quietly sit alongside your sealed notes.",
    },
    themeWizard: {
      name: "Theme wizard",
      condition: "Build your own custom theme.",
      learnMore:
        "The Custom theme in Settings → Appearance opens every colour, the corner radius, and the row density up to you for a look that's entirely your own.",
    },
    stillness: {
      name: "Stillness",
      condition: "Turn on reduced motion.",
    },
    minimalist: {
      name: "Minimalist",
      condition: "Hide the floating menu button.",
      learnMore:
        "On the installed mobile app you can hide the floating menu button entirely and open the side menu with an inward swipe from the screen edge.",
    },
    underTheHood: {
      name: "Under the Hood",
      condition: "Turn on developer mode.",
      learnMore:
        "Settings → General → Developer mode reveals a Developer tab whose diagnostics — like capturing the in-app log across reloads — help track down a sync problem from the device it happens on.",
    },
    holodeck: {
      name: "Holodeck",
      condition: "Load the sample data set.",
    },
    completionist: {
      name: "Completionist",
      condition: "Unlock every other achievement.",
      learnMore:
        "The last trophy on the board — earned the moment you've collected all the others.",
    },
  },
} as const;

export type AchievementsCatalog = Widen<typeof achievements>;

export default achievements;
