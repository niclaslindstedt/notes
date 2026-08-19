import type { Widen } from "./_widen.ts";

// Strings for the namespace management dialog — the named buckets that each
// hold their own note document. The switcher in the side menu handles the
// common "switch namespace" path; this modal is the full add / rename /
// appearance / delete surface. Generic verbs (close/cancel/save/create/
// confirm/delete) come from `common.*`.

const namespace = {
  heading: "Namespaces",
  blurb:
    "A namespace is a self-contained group of notes. Switch between them to keep, say, personal and shared notes apart. Each namespace can carry its own icon and colour.",
  newLabel: "New namespace",
  nameLabel: "Namespace name",
  namePlaceholder: "e.g. Work, Family",
  colorLabel: "Colour",
  glyphLabel: "Icon",
  switchTo: "Switch to {name}",
  rename: "Rename",
  deleteAction: "Delete namespace",
  deleteConfirm: "Delete “{name}” and all of its notes? This can't be undone.",
  nameRequired: "A name is required",
  defaultBadge: "Default",
  noIcon: "No icon",
  newColorPrefix: "New namespace colour",
  newGlyphNone: "New namespace, no icon",
  newGlyphPrefix: "New namespace icon",

  switchTitle: "Open another namespace",
  switchHint: "Other namespaces are unaffected — open one instead.",
  stillLocked: "Locked",

  pinTitle: "PIN",
  pinHint:
    "Ask for a short code before this namespace opens. The code travels with the namespace, so every device — and everyone you share it with — is asked for it.",
  pinSoftWarning:
    "A PIN is a light gate: it stops a mis-tap or a borrowed phone, but the notes are still stored in plain text and anyone sharing this account can attack the code offline. Turn on encryption for anything that actually needs protecting.",
  pinSet: "Set a PIN",
  pinChange: "Change PIN",
  pinRemove: "Remove PIN",
  pinOn: "This namespace asks for a PIN",
  pinOff: "This namespace has no PIN",
  pinLabel: "PIN",
  pinCurrentLabel: "Current PIN",
  pinConfirmLabel: "Confirm PIN",
  pinTooShort: "Use a PIN of at least {min} characters.",
  pinMismatch: "The PINs don't match.",
  pinWrong: "That PIN didn't work.",
  pinGateTitle: "“{namespace}” needs a PIN",
  pinGateHint: "Enter this namespace's PIN to open it on this device.",
  pinGateSubmit: "Open",
} as const;

export type NamespaceCatalog = Widen<typeof namespace>;

export default namespace;
