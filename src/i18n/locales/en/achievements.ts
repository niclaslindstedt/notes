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
    emphasis: {
      name: "Emphasis",
      condition: "Mark a word up as bold, italic, struck through, or code.",
      learnMore:
        "Wrap a word in `**` for bold, `*` for italic, `~~` to strike it through, or backticks for code, and the editor formats it as you type. The line you're actually on keeps that formatting too — the markers simply come into view beside it, dimmed, so you can see what's holding the word up and take it off again.",
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
    guillotine: {
      name: "Guillotine",
      condition: "Cut something with the cut button (or Ctrl/Cmd+K).",
      learnMore:
        "The scissors button at the top right of a note cuts to the clipboard: whatever you have selected, or — with nothing selected — the whole line the cursor is on, so tidying a note is one tap instead of a select-and-erase or a held Backspace. Park the cursor mid-sentence and it takes only what comes after it on that line, leaving what you wanted to keep. Ctrl/Cmd+K does the same from the keyboard, and Undo puts it back. The button is there for touch: on a computer the keyboard shortcut and the right-click menu already cut, so the header keeps the space instead.",
    },
    stylist: {
      name: "Stylist",
      condition: "Format something with the styling toolbar.",
      learnMore:
        "The formatting button at the top right of a note opens a toolbar above the text — headings, bold, italic, strikethrough, inline code, bullet and numbered lists, quotes, code blocks, indent and outdent, links, images and dividers, one button each. It writes ordinary Markdown, so anything you reach for there you can also just type; every button is a toggle, so pressing a lit one takes the formatting back off.",
    },

    fullStop: {
      name: "Full stop",
      condition: "End a sentence by tapping space twice.",
      learnMore:
        'Tap space twice at the end of a word and the note ends the sentence for you: the first space is swallowed and a full stop written in its place, leaving the cursor after ". " ready for the next one. It is the same shortcut your phone applies in any other text field — the editor writes every keystroke into the note itself, which puts the keystroke out of the keyboard\'s reach, so it does the substitution instead and does it the same way on a computer. Two spaces after a full stop stay two spaces, and inside a code block nothing is rewritten at all. Turn it off with "Disable auto correct" in Settings → Editor.',
    },
    capitalIdea: {
      name: "Capital idea",
      condition: "Let the note capitalise the start of a sentence for you.",
      learnMore:
        'Start a sentence and the note writes the capital for you \u2014 the first letter of a line, and the first letter after a full stop, question mark or exclamation mark. It is the capital your phone puts in for you anywhere else, done by the app because the editor writes every keystroke into the note itself, which puts the keystroke out of the keyboard\'s reach; that is also why it works the same on a computer, where nothing offers it at all. A file name or a decimal keeps its lower case, code blocks are left exactly as typed, and because the capital is an ordinary edit, Backspace or Undo takes it back off. Turn it off with "Capitalise sentences" in Settings \u2192 Editor.',
    },
    elbowRoom: {
      name: "Elbow room",
      condition: "Open a note's ⋯ menu on a narrow screen.",
      learnMore:
        "On a phone the editor's header has room for the note's name or its action buttons, not both — so the buttons fold into a single ⋯ button on the right. Pressing it slides them back out over the title; pressing it again, or touching the note itself, folds them away and hands the title back. The caret stays exactly where it was through all of it, so the cut and formatting buttons still act on the line you were writing.",
    },
    sleightOfHand: {
      name: "Sleight of hand",
      condition: "Select text in a note on a narrow screen.",
      learnMore:
        "Select some text on a phone and the three buttons that act on a selection — formatting, cut and copy — slide out of the ⋯ on their own, so the thing you just asked for is one tap away instead of two. Copy takes the highlighted text and nothing else (copying the whole note stays in the export menu), and cut takes it out onto the clipboard. Press the ⋯ and the row simply widens into the full set of actions, the way it always has; let the selection go and the buttons fold away and hand the note's name back.",
    },
    pinpoint: {
      name: "Pinpoint",
      condition: "Find text inside the note you have open.",
      learnMore:
        "The magnifier in a note's header — or ⌘F / Ctrl+F, which the app answers instead of the browser's own find-on-page — opens a find bar under the top bar, with the cursor already in it. What you type is matched verbatim and case-insensitively against the note you are reading — every hit lights up at once, the arrows step between them (Enter and Shift+Enter do the same from the keyboard), and the counter says which one of how many you are on. It searches only the open note; the magnifier on the side menu is the one that searches across all of them.",
    },
    swapMeet: {
      name: "Swap meet",
      condition: "Replace some text from the find bar.",
      learnMore:
        "Pressing the magnifier inside a note's find bar unfolds a second row: a field for what the matches should become, and the two buttons that apply it — one for the match you are standing on, one for every match at once. The search you already typed is the one it acts on, so crossing over costs nothing. Enter in the replace field replaces the current match and steps to the next, so a run of them is one key held down; Ctrl/Cmd+Enter does the lot. A replace is always a single undo away, however many lines it touched, and it is withheld on a read-only note along with every other edit.",
    },
    dryRun: {
      name: "Dry run",
      condition: "Preview a replacement before applying it.",
      learnMore:
        "The spectacles in the replace row show you what the replacement would write — and write nothing. Every line it would touch is listed, numbered the way the editor's gutter numbers them, with the text each match takes away struck through and the text arriving in its place lit up beside it, so the change reads in the context of the line rather than as an abstract count. The heading above says how many matches on how many lines, which is the answer you actually want before pressing Replace all on a long note. Nothing is committed until you press one of the buttons.",
    },
    starStruck: {
      name: "Star-struck",
      condition: "Add a note to your favorites.",
      learnMore:
        "The star at the left of a note's header marks it a favorite, and the side menu grows a Favorites section above the note list holding everything you have starred. It is a shortcut, not a move: the note keeps its folder, its place in the ordinary list, and everything else about it — the star just puts a second door on it, so the handful of notes you keep coming back to are one tap away no matter how deep they are filed or how far down the recents they have slipped. By default Favorites ignores the folders entirely and lists the notes flat; Settings → Appearance → Sidebar can reproduce the folder structure there instead.",
    },
    underLockAndKey: {
      name: "Under lock and key",
      condition: "Lock a note so it can't be edited.",
      learnMore:
        "The eye button beside the star makes the open note read-only. A locked note takes no caret at all: tap into it on a phone and the keyboard stays down, click into it on a desktop and nothing starts blinking, so the note you keep open for reference can't be typed into by accident — or by a pocket. The buttons that would rewrite it go with the caret (formatting, cut, the checkboxes on task rows, and the title field), while everything that only reads it carries on exactly as before: you can scroll it, select it, copy from it, search it, export it, star it and archive it. The line-number gutter still works too, so pressing a number selects that whole line and the copy button slides out to take it. Press the eye again to unlock it. The lock travels with the note, so it is still locked on your other devices.",
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
    clearTheDecks: {
      name: "Clear the decks",
      condition: "Collapse the docked sidebar to give the note the full width.",
      learnMore:
        "On a wide screen the side menu is docked open beside your notes, which is handy right up until you want to read or write without it. Move the pointer to the menu's inner edge and a slim strip fades in down the whole height of it, with a chevron at its centre: press it and the whole panel folds away, giving the note the full width with no gutter left behind. Move the pointer back to that edge of the screen and the strip returns, its chevron now pointing the other way to bring the menu in again. The choice is per device and remembered across reloads.",
    },
    marginalia: {
      name: "Marginalia",
      condition: "Adjust the editor's writing-column margins.",
      learnMore:
        "Settings → Editor narrows the writing column for a more focused, page-like feel — or lets it run the full width of the screen.",
    },
    fencedIn: {
      name: "Fenced in",
      condition: "Write a fenced code block in a note.",
      learnMore:
        "Wrap lines in ``` and the editor renders them as a block of code — verbatim, with no Markdown formatting applied inside. The fences themselves disappear once the block is closed, and come back the moment you put the caret inside it.",
    },
    quoteUnquote: {
      name: "Quote, unquote",
      condition: "Write a quote that runs over more than one row.",
      learnMore:
        "Pressing Enter inside a quote opens another quote row, so a long passage can be typed straight through instead of marking each row by hand. The quote keeps going until you leave it: press Quote again to unmark the row, or put the caret on a row that isn't quoted.",
    },
    subPoint: {
      name: "Sub-point",
      condition: "Nest a list item under another one.",
      learnMore:
        "Pressing Enter on a bullet or numbered row opens the next one, so a list is written straight through — and Tab on a row nests it under the row above (Shift+Tab pulls it back out). An empty item ends the list: one Enter steps a nested item back out a level, the next clears the row. Shift+Enter opens another row inside the item you are on instead of starting a new one.",
    },
    checkedOff: {
      name: "Checked off",
      condition: "Tick a checkbox off in a note.",
      learnMore:
        "A list row written `- [ ] milk` renders as a real checkbox. Press it and the item is ticked off there and then — the caret never moves onto the line, so nothing opens and no keyboard comes up on a phone. The tick is written straight into the Markdown as `- [x]`, so it travels with the note wherever it syncs. Enter on a task row opens the next one, always unticked.",
    },
    plainText: {
      name: "Plain and simple",
      condition: "Turn live Markdown rendering off.",
      learnMore:
        "Prefer raw text? Settings → Editor switches the live preview off so notes stay plain, unformatted source.",
    },
    countTheLines: {
      name: "Count the lines",
      condition: "Turn the editor's line numbers on.",
      learnMore:
        "Settings → Editor numbers every line down the left edge, the way a code editor does. Press a number to select that whole line — ready to cut, replace, or restyle.",
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
    nowPlaying: {
      name: "Now playing",
      condition: "Put a YouTube link in a note.",
      learnMore:
        "A YouTube link you paste into a note becomes a player right where it sits — every link shape works (youtu.be, /shorts/, the mobile site, an embed URL), and the tracking parameters that ride along are trimmed off. Nothing is fetched from YouTube until you press play; the button in the player's corner lifts it into widescreen over a blurred note, and puts it back without losing your place in the video.",
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
    dropzone: {
      name: "Dropzone",
      condition: "Hold a “new note” button to make a dropzone note.",
      learnMore:
        "A dropzone note is a scrap you write on one device to read on another — a link, an address, a code. Press and hold a “new note” button (the + on the overview, or New note in the side menu) and you get one, already named after the moment you made it. It waits in the Dropzone section at the top of the side menu instead of cluttering your notes, and the checkmark in its editor deletes it once you've picked it up. It is only offered when your notes sync somewhere your other devices can reach.",
    },
    keeper: {
      name: "Finders keepers",
      condition: "Keep a dropzone note as a regular note.",
      learnMore:
        "Sometimes a scrap turns out to be worth keeping. Give a dropzone note a name of your own instead of the timestamp it was born with, and the app asks whether to save it as a regular note — say yes and it leaves the Dropzone for your ordinary list, text, title and all.",
    },
    organizer: {
      name: "Filing system",
      condition: "Create a folder to group notes.",
      learnMore:
        "Folders group notes inside a namespace — a “Login feature”, a “Vacation 2025”. Tap the folder button on the Notes heading in the side menu to make one, then drag notes onto it to file them away. A folder can expand to make a new note straight inside it.",
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
        "“Copy to clipboard” in a note's export menu — the up arrow in its header — puts the open note on your clipboard. Settings → Editor chooses how much it takes — just the body, the title and body, or the whole .md file with its YAML frontmatter.",
    },
    printPress: {
      name: "Printing press",
      condition: "Export a note to PDF.",
      learnMore:
        "The up arrow in a note's header exports it. “Export to PDF” typesets the note as a document — headings, lists, quotes and code blocks and all — and downloads the finished file. The app writes the PDF itself rather than going through a print dialog, so nothing stamps a URL or a date into the margins. Settings → Export controls how the page looks: paper size and margins, the body and heading fonts and their sizes, the monospaced family and background behind code, the bullet glyph, and whether the pages are numbered.",
    },
    takeaway: {
      name: "Takeaway",
      condition: "Export a note as a Markdown file.",
      learnMore:
        "“Export to MD” in the same menu downloads the note as a plain .md file — byte for byte the file the folder and cloud backends store, YAML front matter and all — so it opens in any Markdown app and comes back into notes unchanged.",
    },
    snippetSnatcher: {
      name: "Snippet snatcher",
      condition: "Copy a code block with its copy button.",
      learnMore:
        "Every closed code block wears a small copy button in its top-right corner. One press puts the code — everything between the ``` fences, and nothing else — on your clipboard, without placing the caret in the note or selecting a single line by hand.",
    },
    sweepingStatement: {
      name: "Sweeping statement",
      condition: "Take more than one line at once in select mode.",
      learnMore:
        "The header's select-mode button turns the note into a list you pick from: one press takes a whole line and a second press on it gives that line back, so picking one line never gives up the last one \u2014 no handles to aim at a character with. For a run of them, drag down the rail at the left edge of the note; everywhere to the right of it the note goes on scrolling as usual. The lines you have taken are tinted along with their line numbers rather than wearing the ordinary selection colour, so you can tell the two apart at a glance. From there, type over them, delete them, copy or cut them, or style every one at once. Escape leaves the mode, handing an unbroken run over as an ordinary selection.",
    },
    offTheTop: {
      name: "Off the top",
      condition: "Cut or delete picked lines with the floating bar.",
      learnMore:
        "Pick a line on a phone and a bar rises at the top of the note with two halves: cut, and delete. They are the two things you most want to do with a run of lines and the two that were furthest away \u2014 on a narrow screen the header folds its buttons behind a \u22ef, and delete had no button at all, only a Backspace on the keyboard select mode deliberately keeps down. So the actions come to the selection instead. Cut takes the lines out onto the clipboard; delete just takes them out, with no confirm step \u2014 Undo puts either back. The bar is there for touch: on a computer Ctrl/Cmd+X, Backspace and an unfolded header already reach both, so nothing hovers over the text.",
    },
    manyHands: {
      name: "Many hands",
      condition: "Edit at more than one caret at once.",
      learnMore:
        "Ctrl/Cmd+D takes the word under the caret, and each press after that adds a second, third, fourth caret over the next occurrence of it \u2014 type once and every one of them changes. Ctrl/Cmd+\u2191 / \u2193 grow a plain column of carets instead, a line at a time, for typing the same thing down the edge of a list. Arrow keys, Backspace, Enter, copy and paste all answer at every caret; Escape drops back to the one you started from.",
    },
    seeker: {
      name: "Seeker",
      condition: "Search your notes.",
      learnMore:
        "The magnifier on the side-menu action bar — or ⌘⇧F / Ctrl+Shift+F from anywhere, the wider twin of the ⌘F that searches inside one note — searches every note's title and body at once. It's plain text and fuzzy by default — type a rough abbreviation and it still finds the note — and also takes wildcards (recipe*, dr?ft) or a /regex/. On encrypted backends it searches the same preview the note index already holds, so it works without unlocking every note.",
    },
    whereYouLeftOff: {
      name: "Right where you left off",
      condition:
        "Reopen a note and land back at the caret and scroll you left.",
      learnMore:
        "While the app is open it remembers where the caret sat and how far you'd scrolled in each note, so hopping between notes drops you back exactly where you were — same line, same place on screen — instead of at the top. On a phone the keyboard comes back up with the caret already in place. It's per-session: a fresh reload starts each note clean.",
    },
    retrace: {
      name: "Retrace",
      condition: "Use your browser's Back button to return to a note.",
      learnMore:
        "Every move you make — opening a note, hopping to another, stepping into the archive — leaves a step in your browser's history, so Back walks you through the notes you visited (and Forward walks you out again). It works with the back button, the keyboard shortcut, and Android's back gesture.",
    },
    deepLink: {
      name: "Deep link",
      condition: "Open a link that goes straight to a note.",
      learnMore:
        "The note you have open has its own address — copy it out of the address bar, or right-click any note for “Copy link”, and it reopens that exact note later, from a bookmark, a calendar entry, or a message to yourself. The link carries the namespace too, so following one switches to the right namespace first; a link to a namespace this device doesn't have simply lands on the overview. The address lives after the # so it is never sent to any server, and it only works where your notes already are — the link is a shortcut for you, not a way to share a note with someone else.",
    },

    // ── Pro ───────────────────────────────────────────────────────────
    patternSeeker: {
      name: "Pattern seeker",
      condition: "Search a note with a regular expression.",
      learnMore:
        "The `.*` switch inside the find field stops reading your search as literal characters and hands it to a regular expression instead — so `^#{1,3} ` finds every heading, and `\\d{4}-\\d{2}-\\d{2}` finds every date. Each line is matched on its own, so `^` and `$` mean the start and end of a line and no match ever spans a line break. It is what makes the replace field's `$1` mean anything: a pattern's capture groups can be pasted straight into what replaces it. A half-typed pattern says so where the match count usually is, rather than pretending the note has nothing in it.",
    },
    shapeshifter: {
      name: "Shapeshifter",
      condition: "Add a transform rule.",
      learnMore:
        "Settings → Transform matches part of a note with a regular expression and shows something else in its place: an issue number as a link to the issue, a booking code as the words it stands for, a phone number with its middle masked out. The note itself never changes — put the caret on the line to see exactly what you typed, and copying always copies the original.",
    },
    localDialect: {
      name: "Local dialect",
      condition: "Have transform rules in two different namespaces.",
      learnMore:
        "A transform rule belongs to one namespace, so the issue links you want at work never rewrite the shopping list at home. Settings → Transform still lists every rule you have — the ones belonging to your other namespaces are greyed out — and the rule's “Applies to” picker widens one back to all namespaces when it really is for everything.",
    },
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
    selfHoster: {
      name: "Self-hoster",
      condition: "Pair with your own notesd server.",
      learnMore:
        "Run the notesd daemon on your own computer and pair the app to it — your notes sync over your network to a server you control, with no cloud and no accounts. The connection is pinned to the daemon's own certificate. Available only in the installed app.",
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
    straggler: {
      name: "Straggler",
      condition: "Decide what to do with a file that isn't a note.",
      learnMore:
        "Your notes folder is a real folder you can write to, so things end up in it that aren't notes. The app never deletes them behind your back — it shows you what it found and lets you import it, remove it, or leave it be.",
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
    doorCode: {
      name: "Door code",
      condition: "Put a PIN on a namespace.",
      learnMore:
        "Settings → Storage asks for a short code before that namespace opens. The code travels with the namespace, so every device and everyone you share it with is asked. It's a light gate — encryption is what actually keeps the notes from being read.",
    },
    ownTerms: {
      name: "Own terms",
      condition: "Save a setting to this namespace or this device only.",
      learnMore:
        "The chevron on Save picks how far a setting reaches: everyone, everyone in this namespace, or just this device. Narrower wins, so your own choices stay yours even on a login you share.",
    },
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
    logKeeper: {
      name: "Log Keeper",
      condition: "Copy a slice of the sync log.",
      learnMore:
        "The sync log in the cloud-sync dialog has a Copy button that asks how far back to reach — the last 10 minutes, 30 minutes, hour, or everything it still holds. Reproduce the problem, copy the minutes around it, and paste that into a bug report or an AI assistant without the rest of the session's history burying it.",
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
