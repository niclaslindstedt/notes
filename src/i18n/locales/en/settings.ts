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
  },

  general: {
    title: "General",
    languageTitle: "Language",
    languageChoose: "Choose language",
    languageHint: "Translate the UI between English and Swedish.",
    achievementsTitle: "Achievements",
    menuTitle: "Menu",
    aboutTitle: "About",
    blurb:
      "notes is a local-first app — your notes live in this browser unless you connect a folder or cloud. Appearance settings are saved on this device.",
    language: "Language",
    disableAchievements: "Disable achievements",
    disableAchievementsHint:
      "Stop tracking achievements and hide the trophy button. Achievements you’ve already earned are kept.",
    menuButton: "Show menu button",
    menuButtonHint:
      "When off, swipe in from the edge of the screen to open the menu.",
  },

  editor: {
    title: "Editor",
    margins: "Margins",
    marginsHint: "How much breathing room to leave around the writing column.",
    wordWrap: "Word wrap",
    wordWrapHint: "Wrap long lines instead of scrolling sideways.",
    renderMarkdown: "Render Markdown",
    renderMarkdownHint:
      "Format Markdown as you type — every line but the one you're on shows formatted, like Obsidian.",
    disableSpellcheck: "Disable spell check",
    disableSpellcheckHint:
      "Stop your device checking spelling as you type, hiding the red squiggles.",
    disableAutocorrect: "Disable auto correct",
    disableAutocorrectHint:
      "Stop your device auto-correcting and auto-capitalising as you type (mostly affects mobile keyboards).",
  },

  appearance: {
    theme: "Theme",
    mode: "Mode",
    variant: "Variant",
    systemNote: "Follows your device's light / dark setting.",
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
  },

  unlock: {
    title: "Notes are locked",
    hint: "Enter your passphrase to unlock and read your notes on this device.",
    passphrase: "Passphrase",
    unlock: "Unlock",
    wrong: "That passphrase didn't work.",
    offline:
      "You're offline and nothing is cached on this device yet. Connect to the internet and try again.",
  },
} as const;

export type SettingsCatalog = Widen<typeof settings>;

export default settings;
