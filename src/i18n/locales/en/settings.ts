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
    disableSpellcheck: "Disable spell check",
    disableSpellcheckHint:
      "Stop your device checking spelling as you type, hiding the red squiggles.",
    disableAutocorrect: "Disable auto correct",
    disableAutocorrectHint:
      "Stop your device auto-correcting and auto-capitalising as you type (mostly affects mobile keyboards).",
    trimTrailingSpaces: "Trim trailing spaces",
    trimTrailingSpacesHint:
      "Remove spaces left at the end of every line when a note is saved.",
    trailingNewline: "End with a newline",
    trailingNewlineHint:
      "Make sure a saved note ends with a single trailing newline.",
    copyScope: "Copy",
    copyScopeHint:
      "What the editor's copy button puts on the clipboard. Body is just what you wrote; the others add the title, or the whole .md file with its YAML frontmatter.",
    copyBody: "Body",
    copyTitleBody: "Title & body",
    copyFrontMatter: "Front matter",
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
