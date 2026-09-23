// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// THE STORE LISTING, held to what the storefronts will actually accept — and
// to what the app it describes actually does.
//
// Two kinds of assertion live here and the split is the point:
//
//   THE LIMITS. Apple's field lengths, Valve's blurb ceiling. Enforced by
//   `scripts/generate-store-metadata.mjs` too, and asserted here as well
//   because the generator runs when somebody remembers to run it, where this
//   runs on every push. An over-long subtitle is not a broken build — App Store
//   Connect truncates it silently and the listing goes live wrong.
//
//   THE CLAIMS. The review notes make load-bearing statements about the build:
//   that the whole game ships inside the binary, that nothing is sold, that
//   nothing leaves the device, that a privacy page exists. Every one is
//   checkable from the tree, and a note that has drifted from the build is an
//   argument a reviewer can disprove faster than they can read it.
//
// The rasters are here too, for the one reason that matters: `css × scale` has
// to equal `raster` exactly, Chromium accepts a mismatch silently, and Apple
// rejects a set that is one pixel off.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { RULES } from "../native/store/listing.mts";
import * as skeleton from "../native/store/copy.example.mts";
// A tool repo has no identity module: the brand-shaped facts are stated in
// the listing itself (`RULES.brand`), and the LISTING NAME arrives as
// APP_DISPLAY_NAME like every other deployment coordinate.
const APP_TITLE =
  process.env.APP_DISPLAY_NAME?.trim() || RULES.brand.projectName;
const PUBLISHER = RULES.brand.publisher;
const PRIVACY_URL = RULES.brand.privacyUrl;

const root = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

// THE COPY IS NOT COMMITTED, so this suite reads whichever module is present:
// `copy.mts` on the machine that submits, and the committed `copy.example.mts`
// skeleton everywhere else — CI included. That is the honest arrangement rather
// than a compromise: the limits and the claims are properties of the SHAPE, and
// holding the skeleton to them is what stops the shape rotting while the real
// listing lives outside the repository. The generator re-runs every one of
// these against the real words at `make store-metadata`, on the machine that
// has them.
//
// IT MUST NOT NAME `copy.mts` IN A LITERAL IMPORT, and that cost a red CI.
// TypeScript resolves the specifier of a dynamic `import()` exactly as it
// resolves a static one, so `await import("../native/store/copy.mts")` inside a
// try/catch typechecks fine on the machine that HAS the file and fails on every
// clone with `TS2307: Cannot find module`. Locally green, CI red — which is the
// standing hazard of a gitignored SOURCE module: this checkout is not a clone,
// so `tsc --noEmit` here is not the check CI runs.
//
// So the path is built at runtime and handed over as a URL, which TypeScript
// cannot resolve and does not try to. The TYPES come from the skeleton, which is
// committed and therefore always resolvable — and since the skeleton is the
// declared shape, typing the real module as `typeof skeleton` is exactly the
// assertion worth making about it.
const localCopy = join(root, "native", "store", "copy.mts");
const copy: typeof skeleton = existsSync(localCopy)
  ? ((await import(pathToFileURL(localCopy).href)) as typeof skeleton)
  : skeleton;

// Non-null because a listing with no en-US locale is not a listing — and
// under `noUncheckedIndexedAccess` the index says "possibly undefined", which
// would otherwise spread `?.` through every case below for a state the next
// line rules out.
const EN = copy.APPLE_INFO["en-US"]!;
if (!EN) throw new Error("copy.APPLE_INFO has no en-US locale");
const NOTES = copy.APPLE_REVIEW_NOTES;
const CONTACT = RULES.apple.contact;

/** Whether this checkout has the real listing, or only the skeleton. */
const authored = copy !== skeleton;

/**
 * A case that is only meaningful against real copy.
 *
 * The BUILD half of every claim below is checked unconditionally, because that
 * is a property of the tree and belongs on every runner. The half that asks
 * whether the NOTES say so can only be asked where the notes exist — the
 * skeleton's placeholders deliberately do not spell out the guideline 4.2
 * argument, and rewriting them until they did would recreate the very thing
 * keeping the copy out of this repository is for.
 */
const itAuthored = authored ? it : it.skip;

describe("the App Store listing fits Apple's fields", () => {
  it("has a title between 2 and 30 characters", () => {
    // Composed from identity.ts rather than authored, so this is really an
    // assertion about the game's NAME — which is the point: a rename that
    // overruns Apple's field should fail here rather than at upload.
    expect(APP_TITLE.length).toBeGreaterThanOrEqual(2);
    expect(APP_TITLE.length).toBeLessThanOrEqual(30);
  });

  it("keeps the subtitle under 30 characters", () => {
    expect(EN.subtitle.length).toBeLessThanOrEqual(30);
  });

  it("spends at most 100 characters on the JOINED keyword string", () => {
    // The budget is spent on the comma-joined string, NOT per keyword. This is
    // the limit that surprises people.
    expect(EN.keywords.join(",").length).toBeLessThanOrEqual(100);
  });

  it("does not repeat a keyword, or spend one the title already spends", () => {
    expect(new Set(EN.keywords).size).toBe(EN.keywords.length);
    const spent = `${APP_TITLE} ${EN.subtitle}`.toLowerCase();
    expect(EN.keywords.filter((k) => spent.includes(k.toLowerCase()))).toEqual(
      [],
    );
  });

  it("keeps promo text under 170 and the description between 10 and 4000", () => {
    expect(EN.promoText.length).toBeLessThanOrEqual(170);
    expect(EN.description.length).toBeGreaterThanOrEqual(10);
    expect(EN.description.length).toBeLessThanOrEqual(4000);
    expect(EN.releaseNotes.length).toBeLessThanOrEqual(4000);
  });

  it("keeps the review notes between 2 and 4000", () => {
    expect(NOTES.length).toBeGreaterThanOrEqual(2);
    expect(NOTES.length).toBeLessThanOrEqual(4000);
  });

  it("gives Apple an https support URL that is not the source repository", () => {
    // A mailto: is rejected outright, and a listing whose support link is a
    // GitHub tree tells a player who installed a game to open a pull request.
    expect(EN.supportUrl).toMatch(/^https:\/\//);
    expect(EN.supportUrl).not.toContain("github.com");
  });

  it("names a review contact, and no phone number", () => {
    expect(CONTACT.firstName).toBeTruthy();
    expect(CONTACT.lastName).toBeTruthy();
    expect(CONTACT.email).toBeTruthy();
    // THE NUMBER APPLE RINGS IS NOT COMMITTED. This repository is public, so it
    // comes from ASC_REVIEW_PHONE in the gitignored native/.env and the
    // generator drops the field when nobody has set one. A phone number
    // appearing in the authored listing is a personal detail published
    // permanently and in the history.
    expect(JSON.stringify(CONTACT)).not.toMatch(/\+\d{6}/);
  });
});

describe("the review notes are true of the build", () => {
  it("is right that the whole game ships inside the binary", () => {
    // `src/config.ts` reads ANY `extra.gameUrl` as "stream the remote site
    // instead and skip the local server", which would make the notes false for
    // every build at once — store builds included. The comment in
    // app.config.js explaining its absence is stripped before the check, or
    // this test fails on the sentence that says the field is not there.
    const config = read("native", "app.config.js")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(config).not.toMatch(/gameUrl\s*:/);
  });

  itAuthored("says so, naming the bundled site", () => {
    expect(NOTES).toMatch(/webroot\.zip/);
  });

  it("is right that nothing is sold", () => {
    const pkg = read("native", "package.json");
    expect(pkg).not.toMatch(/StoreKit|expo-in-app-purchases|react-native-iap/);
  });

  itAuthored("says so", () => {
    expect(NOTES).toMatch(/no in-app\s+purchases/i);
  });

  it("names the privacy page the listing points at", () => {
    // A tool repo's policy is generated from one row in agilatorab/apps — see
    // `RULES.brand.privacyUrl` — so there is nothing in this tree to read.
    // What IS checkable here is that the notes name the same URL the listing
    // submits, which is the pair that drifts.
    expect(PRIVACY_URL).toMatch(
      /^https:\/\/apps\.agilator\.se\/[a-z-]+\/privacy\/$/,
    );
    expect(NOTES).toContain(PRIVACY_URL);
  });

  itAuthored("names that page in the notes", () => {
    expect(NOTES).toContain(PRIVACY_URL);
  });

  it("does not promise a feature by naming a bundle id the app does not use", () => {
    // The development fallback lives in the name-guard module where a repo has
    // one, and in the app config where it does not — the generator reads the
    // same chain, so the test does too.
    const config = existsSync(join(root, "native", "identifiers.js"))
      ? read("native", "identifiers.js")
      : read("native", "app.config.js");
    // The listing's identifier is a deployment's coordinate, so it arrives as
    // APP_BUNDLE_ID rather than being committed. What IS committed is the
    // development fallback, and it must be one that can never reach a store:
    // `dev.local.*` is not on the publisher's domain and no record can ship
    // under it.
    const devId = /const DEV_BUNDLE_ID = "([^"]+)"/.exec(config)?.[1];
    expect(devId).toBeTruthy();
    expect(devId).toMatch(/^dev\.local\./);
    expect(config).toContain("process.env.APP_BUNDLE_ID");
    // And a production build must refuse to run on the fallback, or the guard
    // is decoration.
    expect(config).toContain('EAS_BUILD_PROFILE === "production"');
    expect(PUBLISHER).toBeTruthy();
  });
});
