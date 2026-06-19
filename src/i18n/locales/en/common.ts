import type { Widen } from "./_widen.ts";

// Strings reused across more than one feature — generic verbs and the
// close/cancel chrome every modal shares. Feature-specific copy lives in its
// own namespace file.

const common = {
  close: "Close",
  cancel: "Cancel",
  save: "Save",
  delete: "Delete",
  create: "Create",
  confirm: "Confirm",
  back: "Back",
  connect: "Connect",
  disconnect: "Disconnect",
  connected: "Connected",
  reload: "Reload",
  tryAgain: "Try again",
  dismiss: "Dismiss",
} as const;

export type CommonCatalog = Widen<typeof common>;

export default common;
