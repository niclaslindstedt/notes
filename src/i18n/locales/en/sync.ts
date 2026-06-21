import type { Widen } from "./_widen.ts";

// Strings for the cloud / folder-backed sync surfaces: the header status
// glyph (`SyncStatus`), the sync-details modal (`SyncDetailsModal`), and the
// conflict-resolution prompt (`ConflictModal`). Provider names (e.g.
// "Dropbox") are runtime data passed as `{provider}` — never translated.

const sync = {
  // Header status glyph labels (title + aria-label).
  offline: "Offline",
  saving: "Saving…",
  failed: "Sync failed",
  throttled: "Rate limited — retrying",
  reauthRequired: "Reconnect needed",
  syncConflict: "Sync conflict",
  saveUnsaved: "Save unsaved changes",
  syncedTo: "Synced to {provider}",

  // Cloud-sync details modal.
  cloudSync: "Cloud sync",
  status: "Status",
  backend: "Backend",
  fileLocation: "File location",
  reconnectTo: "Reconnect to {provider}",
  saveNow: "Save now",
  reloadFromBackend: "Reload from backend",
  openIn: "Open in {provider}",

  // Live activity block (what the sync is doing right now).
  activity: "Activity",
  uploadingFiles: "Uploading now",
  uploadingCount: "{n} files",
  encryptingHeading: "Encrypting at rest",
  decryptingHeading: "Decrypting at rest",
  conversionCount: "{done} of {total}",
  conversionFailed: "Conversion stopped",

  // Details grid.
  encryptionLabel: "Encryption",
  encryptionOn: "On",
  encryptionOff: "Off",

  // Sync log (always-on in-memory ring buffer, surfaced here regardless of
  // the developer-mode capture toggle).
  syncLog: "Sync log",
  viewSyncLog: "View sync log",
  hideSyncLog: "Hide sync log",
  syncLogEmpty: "No sync activity logged yet.",
  copyLog: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",

  // Per-state heading shown in the modal's status block, plus the
  // explanatory "what / why" line beneath it.
  offlineHeading: "You're offline",
  offlineDetail:
    "You're editing the copy saved on this device. It'll sync back to {provider} when the connection returns.",
  syncingNow: "Syncing now…",
  failedHeading: "Sync failed",
  failedDetailFallback: "The last save to {provider} didn't go through.",
  throttledHeading: "Rate limited",
  throttledDetail:
    "{provider} is throttling saves. Your latest changes will sync automatically in a moment.",
  reauthHeading: "Reconnect needed",
  reauthDetail:
    "Your connection to {provider} expired. Reconnect to keep syncing.",
  conflictHeading: "Sync conflict",
  conflictDetail:
    "Another device changed these notes. Choose which copy to keep in the conflict prompt.",
  pendingHeading: "Unsaved changes",
  pendingDetail: "You have changes that haven't been saved to {provider} yet.",
  syncedHeading: "Synced to {provider}",

  // Conflict-resolution prompt. The two copies are summarised side by side
  // (note + word counts) and the user picks which one wins.
  conflict: {
    title: "These notes changed on another device",
    hint: "Your copy on this device and the copy on the backend have both moved on. Keep one — nothing is merged automatically.",
    mineLabel: "This device",
    theirsLabel: "Other device",
    // No plural engine: the component picks One vs Other by the count and
    // passes {n}.
    notesOne: "{n} note",
    notesOther: "{n} notes",
    wordsOne: "{n} word",
    wordsOther: "{n} words",
    keepMine: "Keep this device's copy",
    keepTheirs: "Keep the other copy",
  },
} as const;

export type SyncCatalog = Widen<typeof sync>;

export default sync;
