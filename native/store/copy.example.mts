// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// THE STORE COPY'S SHAPE — a committed skeleton, not a listing.
//
// The real words live in `copy.mts` beside this, which is GITIGNORED: a
// description, subtitle, promo text and keyword set are what the store indexes
// and what a competitor reads, so publishing them puts the listing's own prose
// on a crawlable page under somebody else's domain. `listing.mts` explains the
// split.
//
// THIS FILE IS DELIBERATELY NOT WRITING. Every string below is a placeholder
// naming what belongs there, short enough that nobody could mistake it for
// marketing and long enough to satisfy the field limits so a fresh clone
// typechecks and `make store-metadata` runs end to end. Do not improve the
// prose here — improving it would recreate exactly what the split exists to
// avoid, one adjective at a time.
//
// HOW TO WRITE THE REAL THING: load the `store-listing` skill. It carries the
// craft — what each field is for, every limit and which of them truncate
// silently, how the keyword budget is actually spent, the guideline 4.2
// argument the review notes have to make, and the traps. The knowledge is in
// the repository; the words are not.
//
//   cp native/store/copy.example.mts native/store/copy.mts
//   # …then follow the skill, and keep a backup outside this checkout.

import type { AppleInfo } from "./listing.mts";

const EN_US: AppleInfo = {
  // ≤ 30. Indexed for search as well as read, so it earns its keywords.
  subtitle: "SUBTITLE — the hook, 30",

  // ≤ 170. The one field that changes without shipping a build.
  promoText:
    "PROMO TEXT — what is newsy this month, and nothing load-bearing. Up to 170 characters.",

  // 10–4000. The first two lines are all the store shows before "more".
  description: `DESCRIPTION — the hook in the first two lines, then what the
player actually does, then what makes this one unusual. Up to 4000 characters,
read on a phone.`,

  // The JOINED string is what must fit 100 characters, not each term.
  keywords: ["keyword", "budget", "spent", "joined"],

  // ≤ 4000. The product page's "What's New".
  releaseNotes:
    "RELEASE NOTES — what changed, for the version this ships beside.",

  // Required, must be http(s), and deliberately not the source repository.
  supportUrl: "https://example.invalid/support/",
};

/** The App Store product page, one entry per locale. */
export const APPLE_INFO: Record<string, AppleInfo> = { "en-US": EN_US };

/**
 * What App Store review is told before it opens the app.
 *
 * The single highest-leverage field in the submission, and the one this
 * skeleton is least able to stand in for: a WebView-shaped app is judged under
 * guideline 4.2 (minimum functionality), and these notes are the argument that
 * this one is not a browser pointed at a website. The generator checks the
 * real notes against the build — see the `store-listing` skill.
 */
export const APPLE_REVIEW_NOTES = `REVIEW NOTES — no account is needed; what
the app does; that the whole app ships inside the binary and works in airplane
mode (guideline 4.2); what the native layer adds; that nothing is sold and no
data is collected; which permission, if any, the app asks for and why; and
the privacy page, which the listing also points at:
https://apps.agilator.se/notes/privacy/`;

// NO MAC OR STEAM COPY HERE. `listing.mts` says this app ships on the App
// Store alone, so there is no second page to write. When a desktop storefront
// is turned on, its fields join this file beside the phone's — the shape is in
// the sibling repo that already ships on all three.
