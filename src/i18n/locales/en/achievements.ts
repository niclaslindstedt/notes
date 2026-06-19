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
    archivist: {
      name: "Archivist",
      condition: "Archive a note.",
      learnMore:
        "Swipe a note right in the overview to archive it — it leaves the list without being deleted. Find archived notes under Archive in the side menu, where you can restore or remove them for good.",
    },
    compartments: {
      name: "Compartments",
      condition: "Create a second namespace.",
      learnMore:
        "Namespaces are separate, self-contained sets of notes — work and home, say. Switch between them from the side menu; each can sync to its own folder.",
    },
    polyglot: {
      name: "Polyglot",
      condition: "Switch the app's language.",
      learnMore:
        "notes speaks English and Swedish — switch in Settings → General and the whole interface follows. Your choice is remembered on this device.",
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

    // ── Expert ────────────────────────────────────────────────────────
    paranoidMode: {
      name: "Paranoid mode",
      condition: "Turn on at-rest encryption.",
      learnMore:
        "Settings → Storage encrypts your notes with a passphrase only you hold. They're sealed on disk and in the cloud until you unlock them.",
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
