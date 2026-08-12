import type { Widen } from "./_widen.ts";

// Strings for the settings dialog (the modal shell, its tabs, and the
// controls inside them) plus the full-screen unlock gate. Theme, font, and
// colour-slot *display names* are not here — those proper nouns and
// data-table labels live with the theme data in `src/theme/`.

const settings = {
  title: "Settings",
  close: "Close settings",
  sections: "Settings sections",
  chooseSection: "Choose section",

  tab: {
    general: "General",
    appearance: "Appearance",
    editor: "Editor",
    transform: "Transform",
    export: "Export",
    storage: "Storage",
    developer: "Developer",
    logs: "Logs",
  },

  general: {
    languageTitle: "Language",
    languageChoose: "Choose language",
    languageHint: "Translate the UI between English and Swedish.",
    achievementsTitle: "Achievements",
    menuTitle: "Menu",
    developerTitle: "Developer",
    language: "Language",
    disableAchievements: "Disable achievements",
    disableAchievementsHint:
      "Stop tracking achievements and hide the trophy button. Achievements you’ve already earned are kept.",
    menuActivation: "Open the menu with",
    menuActivationHint:
      "Choose how to open the side menu on this device — tap the floating button, or swipe in from the edge of the screen.",
    menuActivationSwipe: "Right-swipe",
    menuActivationButton: "Floating button",
    devMode: "Developer mode",
    devModeHint:
      "Reveal the Developer tab with diagnostic tools. Stays on this device.",
  },

  developer: {
    title: "Developer",
    blurb:
      "Diagnostics for development. These settings stay on this device and never travel with a synced folder or cloud.",
    captureLogs: "Capture logs",
    captureLogsHint:
      "Record the in-app log to this browser so it survives a reload, and show the Logs tab. Off by default.",
    fakeData: "Fake data",
    fakeDataHint:
      "Replace your notes with an in-memory sample document for this session. Reload (or turn it off) to return to your real notes — the sample is never saved.",
  },

  editor: {
    title: "Editor",
    newNotesTitle: "New notes",
    layoutTitle: "Writing column",
    markdownTitle: "Markdown",
    typingTitle: "Typing aids",
    formattingTitle: "Formatting on save",
    copyTitle: "Copying",
    defaultTitle: "Default note title",
    defaultTitleHint:
      "What to name a new note before you give it a title of your own.",
    defaultTitleOff: "Off",
    defaultTitleDateTime: "Date & time",
    defaultTitleNumbered: "Numbered",
    margins: "Margins",
    marginsHint: "How much breathing room to leave around the writing column.",
    wordWrap: "Word wrap",
    wordWrapHint: "Wrap long lines instead of scrolling sideways.",
    renderMarkdown: "Render Markdown",
    renderMarkdownHint:
      "Format Markdown as you type — every line but the one you're on shows formatted, like Obsidian.",
    lineNumbers: "Line numbers",
    lineNumbersHint:
      "Number every line down the editor's left edge, the way a code editor does. Press a number to select that whole line. Needs Markdown rendering on.",
    shortenLinks: "Shorten links",
    shortenLinksHint:
      "Trim long pasted URLs in the preview to the domain, a few characters either side of an [...] marker. The full link is still saved and still opens — only the display is shortened.",
    shortenLinksOff: "Off",
    attachmentsTitle: "Attachments",
    imagesAtEnd: "Images at the end",
    imagesAtEndHint:
      "Collect pasted or dropped images in a block at the foot of the note instead of showing them inline where you added them.",
    filesAtEnd: "Files at the end",
    filesAtEndHint:
      "Collect attached files (anything that isn't an image) in a block at the foot of the note instead of inline.",
    capitaliseSentences: "Capitalise sentences",
    capitaliseSentencesHint:
      "Start every sentence with a capital as you type — after a full stop, question mark or exclamation mark, and at the start of a line. Code blocks are left alone, and the capital is an ordinary edit, so Backspace or Undo takes it straight back off.",
    disableSpellcheck: "Disable spell check",
    disableSpellcheckHint:
      "Stop your device checking spelling as you type, hiding the red squiggles.",
    disableAutocorrect: "Disable auto correct",
    disableAutocorrectHint:
      "Stop your device auto-correcting and auto-capitalising as you type (mostly affects mobile keyboards), and stop a double-tapped space ending the sentence with a full stop. Overrides Capitalise sentences.",
    trimTrailingSpaces: "Trim trailing spaces",
    trimTrailingSpacesHint:
      "Remove spaces left at the end of every line when a note is saved.",
    trailingNewline: "End with a newline",
    trailingNewlineHint:
      "Make sure a saved note ends with a single trailing newline.",
    copyScope: "Copy",
    copyScopeHint:
      "What Export → Copy to clipboard puts on the clipboard. Body is just what you wrote; the others add the title, or the whole .md file with its YAML frontmatter.",
    copyBody: "Body",
    copyTitleBody: "Title & body",
    copyFrontMatter: "Front matter",
  },

  transform: {
    rulesTitle: "Transform rules",
    blurb:
      "Rewrite what a note shows without changing what it stores. A rule matches part of a note with a regular expression and shows something else in its place — an issue number as a link to the issue, a phone number with its middle masked. The note keeps exactly what you typed: put the caret on the line to see it, and copying always copies the original.",
    scopeBlurb:
      "Each rule belongs to a namespace, so work and home can rewrite different things. Rules from your other namespaces are listed here too, greyed out — they don't run over the notes you have open.",
    empty: "No transforms yet.",
    add: "Add transform",
    orderHint:
      "Rules run top to bottom, and the first one to claim a piece of text wins.",
    toggleAria: "Enable {name}",
    editAria: "Edit {name}",
    deleteAria: "Delete {name}",

    ruleTitleAdd: "Add transform",
    ruleTitleEdit: "Edit transform",
    name: "Name",
    namePlaceholder: "Issue links",
    scope: "Applies to",
    scopeAll: "All namespaces",
    scopeHint:
      "Which notes this rule rewrites. A new rule starts in the namespace you're in; pick All namespaces to run it everywhere.",
    pattern: "Match",
    patternPlaceholder: "#(\\d+)",
    patternHint:
      "A regular expression. Wrap a part in parentheses to capture it, then use $1, $2 … in the replacement ($& is the whole match).",
    patternInvalid: "Not a valid regular expression: {error}",
    ignoreCase: "Ignore case",
    helperToggle: "Regex reference",
    tokenGroup: {
      match: "Match a character",
      repeat: "Repeat",
      group: "Group",
      position: "Position",
    },
    token: {
      digit: "Any digit, 0 to 9",
      word: "Any letter, digit or underscore",
      space: "A space, tab or line break",
      any: "Any single character",
      set: "Any one of the characters you list",
      notSet: "Any character except the ones you list",
      range: "A range of characters — put it inside […]",
      oneOrMore: "One or more of what came before",
      zeroOrMore: "Any number of what came before, including none",
      optional: "What came before, but it may be missing",
      count: "Between 2 and 4 of what came before — change the numbers",
      capture: "Capture what's inside, to reuse as $1 in the replacement",
      nonCapture: "Group without capturing — for repeating a whole phrase",
      alternate: "Either the left side or the right side",
      lineStart: "The start of the line",
      lineEnd: "The end of the line",
      wordBoundary: "The edge of a word, so #12 doesn't match inside ab#123",
      escape: "Treat the next character as itself, not as a regex symbol",
    },
    kind: "Replace with",
    kindLink: "Link",
    kindText: "Text",
    kindSensitive: "Sensitive",
    kindHint:
      "Link keeps the matched text and turns it into a link; Text shows something else entirely; Sensitive hides the match behind a mask.",
    replacementLink: "Link address",
    replacementLinkHint:
      "Where the match points. The matched text stays on screen; only its destination is built from this.",
    replacementLinkPlaceholder: "https://github.com/acme/repo/issues/$1",
    replacementText: "Replacement",
    replacementTextHint: "What to show in place of the match.",
    replacementTextPlaceholder: "$1",
    replacementSensitive: "Mask this (optional)",
    replacementSensitiveHint:
      "Leave empty to mask the whole match. Fill it in to mask something built from the match instead.",
    mask: "Mask",
    maskAll: "Hide everything",
    maskFixed: "Fixed length",
    maskEnds: "Keep both ends",
    maskLast: "Keep the end",
    maskFirst: "Keep the start",
    maskHint:
      "How much of the match still shows. Fixed length always draws the same number of stars, so the length is hidden too.",
    sample: "Sample text",
    samplePlaceholder: "Fixed in #134",
    output: "Result",
    outputEmpty: "Type some sample text to see what this rule does.",
    outputHint: "How the sample above reads once this rule is applied.",
  },

  export: {
    title: "Export",
    blurb:
      "How a note is laid out when you export it to PDF. The app typesets and writes the file itself, so nothing but your note ends up on the page. Exporting to Markdown writes the same .md file your notes are stored as, so it has nothing to style.",
    pageTitle: "Page",
    textTitle: "Text",
    codeTitle: "Code",
    listsTitle: "Lists",
    contentTitle: "Content",
    pageSize: "Paper",
    pageLetter: "Letter",
    pageLegal: "Legal",
    orientation: "Orientation",
    portrait: "Portrait",
    landscape: "Landscape",
    margins: "Margins",
    marginsHint: "The blank border left on all four sides of the page.",
    marginNarrow: "Narrow",
    marginNormal: "Normal",
    marginWide: "Wide",
    bodyFont: "Font",
    fontSans: "Sans-serif",
    fontSerif: "Serif",
    fontMono: "Monospace",
    bodyFontHint:
      "The typeface the body text is set in. Only the families every PDF reader already has, so the file stays small and reads the same everywhere — the app's own webfonts aren't among them.",
    fontSize: "Text size",
    lineHeight: "Line spacing",
    headingScale: "Heading size",
    headingScaleFlat: "Flat",
    headingScaleSmall: "Small",
    headingScaleNormal: "Normal",
    headingScaleLarge: "Large",
    headingScaleHint:
      "How much bigger than the body text your headings run. Flat keeps them close to body size; Large gives a title page more presence.",
    headingFont: "Heading font",
    headingFontBody: "Same as body",
    headingFontHint:
      "The typeface your headings are set in. Leave it following the body, or mix the two — sans headings over a serif body is the classic pairing.",
    codeFont: "Code font",
    codeFontHint:
      "Code blocks and inline code are always monospaced; this picks which family. Courier comes with every PDF reader; DejaVu Sans Mono is embedded in the file, which adds a few kilobytes and reads better.",
    codeSize: "Code size",
    codeBackground: "Code background",
    codeBackgroundHint:
      "The fill behind code blocks and inline code. Printers honour it, so a dark colour costs ink.",
    codeBackgroundNone: "No background",
    codeBackgroundCustom: "Custom",
    bullet: "Bullet",
    bulletHint:
      "The bullet on a top-level list item ({name}). Nested levels carry on through the other glyphs, so each level stays distinct.",
    bulletDisc: "Disc",
    bulletCircle: "Circle",
    bulletSquare: "Square",
    bulletDash: "Dash",
    bulletArrow: "Arrow",
    includeTitle: "Print the title",
    includeTitleHint:
      "Head the page with the note's title. Turn it off when the note already opens with its own heading.",
    pageNumbers: "Number the pages",
    pageNumbersHint:
      "Foot every page with its number, centred. This is the only thing the app puts in the margins — the URL and date a print dialog would add are never written.",
  },

  appearance: {
    theme: "Theme",
    mode: "Mode",
    variant: "Variant",
    systemNote: "Follows your device's light / dark setting.",
    list: "Note list",
    listLayout: "Layout",
    listLayoutRows: "Rows",
    listLayoutCards: "Cards",
    listLayoutList: "List",
    listLayoutHint:
      "Rows is a compact one-line list; cards are taller, showing more of each note before fading out; list is a bare file-explorer listing of titles only.",
    sidebar: "Sidebar",
    favoritesFolders: "Folders in Favorites",
    favoritesFoldersHint:
      "Group the Favorites section by the folders its notes are filed in. Off, it lists every favorite flat.",
    folderPlacement: "Folders",
    folderPlacementTop: "On top",
    folderPlacementMixed: "Mixed in",
    folderPlacementHint:
      "Keep folders pinned above your notes, or sort them in among the notes.",
    sortBy: "Sort by",
    sortByModified: "Last modified",
    sortByName: "Name",
    font: "Font",
    fontFamily: "Font family",
    textSize: "Text size",
    colours: "Colours",
    shapeMotion: "Shape & motion",
    cornerRadius: "Corner radius",
    density: "Density",
    reduceMotion: "Reduce motion",
    reduceMotionHint: "Disable animations and transitions.",
  },

  storage: {
    backendTitle: "Where your notes are stored",
    backendBlurb:
      "Notes are saved as one markdown file per note. Keep them on this device, in a local folder you pick, or in your own cloud — they never touch a server of ours.",
    backendAria: "Storage backend",
    backendBrowser: "This device",
    backendFolder: "Local folder",
    backendDropbox: "Dropbox",
    backendGoogleDrive: "Google Drive",
    browserHint:
      "Notes live in this browser only. They stay on this device and aren't shared with your other devices.",
    folderConnected:
      "Your notes are saved as markdown files in the folder you picked.",
    folderUnconnected: "Pick a folder to keep your notes in as markdown files.",
    folderReconnectHint:
      "This browser lost access to the folder. Reconnect to keep saving there.",
    folderReconnect: "Reconnect folder",
    folderChoose: "Choose folder…",
    dropboxConnected: "Your notes sync to your Dropbox app folder.",
    dropboxUnconnected: "Sign in to keep your notes in your own Dropbox.",
    gdriveConnected: "Your notes sync to a folder in your Google Drive.",
    gdriveUnconnected: "Sign in to keep your notes in your own Google Drive.",
    backendNotesd: "Self-hosted",
    notesdConnected:
      "Your notes sync to your own notesd server — no cloud, no accounts.",
    notesdUnconnected:
      "Run the notesd daemon on your own computer and pair this app to sync privately over your network. Available only in the installed app.",
    notesdPair: "Pair a server…",
    notesdPairHint:
      "Start notesd on your computer, then paste the pairing code it prints (notesd://…) or scan its QR.",
    notesdPairPlaceholder: "notesd://pair?…",
    notesdPairSubmit: "Pair",
    notesdScan: "Scan QR",
    notesdPairing: "Pairing…",
    notesdDiscovered: "Found in your {source}:",
    notesdKnownHint:
      "Enter a fresh pairing code from “{name}” — start notesd and copy the code it shows.",
    notesdTokenPlaceholder: "Pairing token or notesd:// code",
    encryptionTitle: "Encryption",
    encryptionOn: "Encryption is on",
    encryptionOff: "Encryption is off",
    encryptionHint:
      "Scramble your notes (AES-GCM) with a passphrase before they're saved. The passphrase never leaves this device and can't be recovered — forget it and the notes can't be read.",
    enableEncryption: "Turn on encryption",
    disableEncryption: "Turn off encryption",
    passphrase: "Passphrase",
    passphraseConfirm: "Confirm passphrase",
    passphraseWarning:
      "There is no recovery. If you forget this passphrase your notes can't be read.",
    passphraseTooShort: "Use a passphrase of at least 4 characters.",
    passphraseMismatch: "The passphrases don't match.",
    encryptionBusyEnabling: "Turning encryption on…",
    encryptionBusyDisabling: "Turning encryption off…",
    encryptionStepReading: "Reading your notes…",
    encryptionStepDerivingKey: "Deriving encryption key…",
    encryptionStepEncrypting: "Encrypting your notes…",
    encryptionStepDecrypting: "Decrypting your notes…",
    encryptionStepSaving: "Saving your notes…",
    encryptionStepFinalizing: "Finalizing…",
    encryptingNote: "Encrypting “{title}”…",
    encryptingAttachment: "Encrypting “{filename}” (attachment of “{title}”)…",
    decryptingNote: "Decrypting “{title}”…",
    decryptingAttachment: "Decrypting “{filename}” (attachment of “{title}”)…",
    conversionRetry:
      "Couldn't reach the backend — retrying “{title}” (attempt {attempt})…",
    conversionPaused:
      "Paused while offline — resumes when the connection returns.",
    conversionUntitled: "this note",
    conversionCanClose:
      "You can now close settings — this finishes in the background.",
    encryptionFailed: "Something went wrong. Tap to see the log.",
    encryptionStatusAria: "Encryption progress",
    encryptionLogTitle: "Encryption log",
    encryptionLogEmpty: "Nothing was logged.",
  },

  unlock: {
    title: "Notes are locked",
    hint: "Enter your passphrase to unlock and read your notes on this device.",
    hintRemote:
      "Encryption was turned on from another device. Enter the passphrase you set there to unlock your notes on this device.",
    passphrase: "Passphrase",
    unlock: "Unlock",
    statusAria: "Unlock progress",
    stepDerivingKey: "Checking your passphrase…",
    stepDecrypting: "Decrypting your notes…",
    stepFinalizing: "Unlocking your notes…",
    decryptingNote: "Decrypting “{title}” ({index}/{total})…",
    untitledNote: "Untitled note",
    wrong: "That passphrase didn't work.",
    offline:
      "You're offline and nothing is cached on this device yet. Connect to the internet and try again.",
  },

  logs: {
    title: "Logs",
    filterLabel: "Filter",
    filterAll: "All",
    filterInfo: "Info",
    filterWarn: "Warnings",
    filterError: "Errors",
    copy: "Copy",
    copied: "Copied to clipboard.",
    copyFailed: "Copy failed.",
    clear: "Clear",
    empty: "No entries.",
    entryCount: "{count} entries.",
  },
} as const;

export type SettingsCatalog = Widen<typeof settings>;

export default settings;
