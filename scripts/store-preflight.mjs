#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// STORE PREFLIGHT — is this checkout actually wired up to ship?
//
// Everything the submission pipelines need that ISN'T code lives in places a
// repository cannot hold: the app records (App Store Connect's numeric id and
// team; Steamworks' app and depot ids), the credentials that talk to them, the
// consoles' own questionnaires, and the artwork a listing cannot go up
// without. Every one of them fails LATE and unhelpfully — a submission that
// runs for two minutes and then says "app not found", a build uploaded
// perfectly into Valve's shared test sandbox — so this walks the whole list up
// front and says which specific thing is missing and where to get it.
//
// Both storefronts, one command, because "are we ready to ship" is one
// question.
//
//   make store-preflight
//   make store-preflight ARGS="--now"     # only what waits on no store account
//
// It READS. Nothing here uploads, builds, or touches the network. Exit 1 means
// something is genuinely missing; a warning is something that is fine today
// and has to be true before the listing goes live.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ascCredentials, nativeEnv, reviewPhone } from "./lib/store-env.mjs";
import { RULES } from "../native/store/listing.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (...parts) => join(root, ...parts);
const rel = (path) => relative(root, path);
const nowOnly = process.argv.includes("--now");

// ---------------------------------------------------------------------------
// Reporting.
//
// Findings are grouped so the output reads as a checklist of the submission
// rather than as a stack of unrelated assertions. A finding may also name a
// GATE: the store record it waits on, which no amount of work in this checkout
// can bring forward — an App Store Connect app record needs an enrolled
// developer account, and enrolling an organization means a legal-entity check
// that takes weeks rather than days.
//
// Splitting the gated ones out is what makes the rest readable. The
// screenshots, the artwork, the listing copy, the privacy page and the bundled
// site are all doable on day one, and every one of them is something the
// submission would otherwise stall on afterwards. `--now` is that list.
// ---------------------------------------------------------------------------
const GATES = {
  apple: {
    short: "needs the App Store Connect record",
    hint: "native/RELEASING.md §1",
  },
  mac: {
    short: "needs the Mac App Store record",
    hint: "tauri/store/MAC_APP_STORE.md",
  },
  steam: { short: "needs the Steamworks app", hint: "tauri/store/README.md" },
};

const findings = [];
let group = "";
const section = (title) => {
  group = title;
};
const ok = (message) => findings.push({ level: "ok", group, message });
const warn = (message, hint, gate) =>
  findings.push({ level: "warn", group, message, hint, gate });
const fail = (message, hint, gate) =>
  findings.push({ level: "fail", group, message, hint, gate });

const env = nativeEnv(root);

// ---------------------------------------------------------------------------
// 1. THE LISTING. The half that is entirely ours, and the half that is
//    therefore finishable today.
// ---------------------------------------------------------------------------
// Which storefronts this app actually submits to. Declared in listing.mts
// because most of the fleet has one: asking a game with no Steam page for five
// 1920×1080 captures is noise that teaches a reader to skim the report.
const SHIPS = RULES.storefronts ?? {
  appStore: true,
  macAppStore: true,
  steam: true,
};

section("LISTING");

const run = (script, ...scriptArgs) =>
  spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      at("scripts", script),
      ...scriptArgs,
    ],
    { cwd: root, encoding: "utf8" },
  );

// THE COPY IS NOT IN THE REPOSITORY, so the first thing to say about a
// listing is which words it is built from. `native/store/copy.mts` is
// gitignored — the game is paid on the App Store and open source on GitHub —
// and `copy.example.mts` is a committed skeleton whose strings are
// placeholders. A submission compiled from the skeleton passes every check in
// this file and ships a subtitle reading "SUBTITLE — the hook, 30", so the
// distinction is reported before anything else.
const realCopy = existsSync(at("native", "store", "copy.mts"));
if (realCopy) {
  ok("native/store/copy.mts is present (the listing's own words, gitignored)");
} else {
  fail(
    "no native/store/copy.mts — the listing would be built from the SKELETON",
    "`cp native/store/copy.example.mts native/store/copy.mts`, then load the " +
      "`store-listing` skill: it carries the craft, the field limits and the " +
      "guideline 4.2 argument the review notes have to make. The words " +
      "themselves are deliberately not in this repository, so a fresh clone " +
      "has the skeleton and not the listing — and nothing here backs up your " +
      "copy of it either. Keep one outside the checkout.",
  );
}

const listing = run("generate-store-metadata.mjs", "--check");
if (listing.status === 0) {
  ok(
    `the listing compiles and passes every store limit (copy from ${realCopy ? "copy.mts" : "copy.example.mts"})`,
  );
} else {
  fail(
    "the listing does not compile",
    (listing.stderr || listing.stdout || "").trim() ||
      "run `make store-metadata` for the detail",
  );
}

// Apple RINGS this number, and this repository is public — so it lives in the
// environment and nowhere else. It is listed here rather than under
// CREDENTIALS because it is not gated on anything: a phone number can be put
// in a `.env` today.
const phone = reviewPhone(root);
if (!phone) {
  fail(
    "no App Store review phone (ASC_REVIEW_PHONE)",
    "Apple rings it, so it has to be reachable and carry a biome code. Put it in " +
      `${rel(env.file)} — NEVER in listing.mts, which is committed to a public repository.`,
  );
} else if (!phone.startsWith("+")) {
  fail(
    `ASC_REVIEW_PHONE (${phone}) has no biome code`,
    "Apple requires the + prefix, e.g. +46…",
  );
} else {
  ok(`review contact ${phone}`);
}

// The two pages the listing NAMES. Apple fetches the privacy URL before review
// opens the app at all, and rejects a support URL that is a mailto: — so both
// have to be pages in the site's own tree rather than promises in the YAML.
for (const [page, why] of [
  [
    "privacy",
    "Apple requires it and fetches it; the Play Console's Data safety form links it",
  ],
  ["support", "Apple requires an http(s) support URL and rejects a mailto:"],
]) {
  const file = at("pwa", "public", page, "index.html");
  const url =
    page === "privacy" ? RULES.brand?.privacyUrl : RULES.brand?.supportUrl;
  if (existsSync(file)) {
    ok(`/${page}/ has a page behind it (${rel(file)})`);
  } else if (url?.startsWith("https://apps.agilator.se/")) {
    // Generated from one row in agilatorab/apps, where a link allowlist runs
    // in CI before it publishes. Nothing to read here — the gate is that it
    // resolves, and it is checked where it lives.
    ok(`${page} URL is served by agilatorab/apps (${url})`);
  } else {
    fail(`the listing names /${page}/ but ${rel(file)} does not exist`, why);
  }
}

// ---------------------------------------------------------------------------
// 2. BUILD INPUTS. Not needed to configure a record; needed before a build,
//    and all of it doable now.
// ---------------------------------------------------------------------------
section("BUILD INPUTS");

const distIndex = existsSync(at("pwa", "dist", "index.html"))
  ? at("pwa", "dist", "index.html")
  : at("dist", "index.html");
if (existsSync(distIndex)) {
  ok(`${rel(distIndex).replace("/index.html", "")} is built`);
} else {
  warn(
    "the web build has not been run",
    "`make build`. Everything downstream — the app's bundled site, the desktop " +
      "webroot, the screenshots — is a copy of it.",
  );
}

const webroot = at("native", "assets", "webroot.zip");
if (existsSync(webroot)) {
  ok(
    `native/assets/webroot.zip present (${(statSync(webroot).size / 1e6).toFixed(1)} MB)`,
  );
} else {
  warn(
    "native/assets/webroot.zip has not been built",
    "`make native-bundle`. It is the copy of the game that ships INSIDE the app, " +
      "which is the whole argument that this is not a browser pointed at a website " +
      "(guideline 4.2). The `build:*` scripts and the CI workflow bundle it for you.",
  );
}

/** How many PNGs a generated art directory holds (0 when it never ran). */
const pngCount = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true }).filter((f) =>
        String(f).endsWith(".png"),
      ).length
    : 0;

const appleShots = pngCount(at("native", "store", "screenshots"));
if (appleShots > 0) ok(`${appleShots} App Store screenshots staged`);
else
  warn(
    "no App Store screenshots have been captured",
    "`make store-shots`. Apple requires at least one per device family, and " +
      "fastlane uploads text only without them.",
  );

const macShots = pngCount(at("tauri", "store", "screenshots", "mac-2880"));
if (macShots > 0) ok(`${macShots} Mac App Store screenshots staged`);
else
  warn(
    "no Mac App Store screenshots have been captured",
    '`make store-shots ARGS="--only mac-2880"`. Apple wants at least one, at one of ' +
      "its four Mac rasters, and they are DESKTOP frames — a phone screenshot " +
      "upscaled is the fastest way to look like a port.",
  );

const steamShots = pngCount(at("tauri", "store", "screenshots"));
if (steamShots > 0) ok(`${steamShots} Steam screenshots staged`);
else
  warn(
    "no Steam screenshots have been captured",
    '`make store-shots ARGS="--only steam"`. Valve requires five at 1920×1080.',
  );

// The icon set every storefront reads, and the one artifact here that is
// generated from the app's own mark rather than drawn.
const icons = [
  "icons/pwa-512.png",
  "icons/apple-touch-icon-180.png",
  "og.png",
].filter((f) => !existsSync(at("pwa", "public", f)));
if (icons.length === 0) ok("the icon set and the share card are generated");
else warn(`missing generated art: ${icons.join(", ")}`, "`make icons`");

// ---------------------------------------------------------------------------
// 3. THE APP RECORD. Without these `eas submit` has nothing to submit TO, and
//    none of it can be filled in before an enrolled account exists.
// ---------------------------------------------------------------------------
section("APP RECORD");

const easJson = JSON.parse(readFileSync(at("native", "eas.json"), "utf8"));
const iosSubmit = easJson.submit?.production?.ios ?? {};

if (!env.exists) {
  warn(`${rel(env.file)} does not exist`, "cp native/.env.example native/.env");
}

if (/^\d+$/.test(String(iosSubmit.ascAppId ?? ""))) {
  ok(`Apple app id ${iosSubmit.ascAppId} (eas.json → submit.production.ios)`);
} else {
  fail(
    "eas.json → submit.production.ios.ascAppId is not set",
    "create the app in App Store Connect first; it assigns the numeric Apple ID " +
      '(the id########## in the App Store URL). Paste it as "ascAppId".',
    "apple",
  );
}

if (/^[A-Z0-9]{10}$/i.test(String(iosSubmit.appleTeamId ?? ""))) {
  ok(`Apple team ${iosSubmit.appleTeamId} (eas.json → submit.production.ios)`);
} else {
  fail(
    "eas.json → submit.production.ios.appleTeamId is not set",
    "ten alphanumerics, from the developer portal's Membership page.",
    "apple",
  );
}

// THE BUNDLE ID IS DEFINED ONCE AND REPEATED ONCE. app.config.js owns it; the
// fastlane Appfile restates it and cannot import a JavaScript module, so a
// drift would upload this listing onto a different app. Checked rather than
// derived, for exactly that reason.
const appConfig = readFileSync(at("native", "app.config.js"), "utf8");
const configBundle = /const BUNDLE_ID = "([^"]+)"/.exec(appConfig)?.[1];
const appfilePath = at("native", "fastlane", "Appfile");
if (!configBundle) {
  fail("could not read BUNDLE_ID from native/app.config.js");
} else if (!existsSync(appfilePath)) {
  warn(
    `no ${rel(appfilePath)} — fastlane cannot upload without one`,
    `it names the same bundle id app.config.js does (${configBundle}) plus the ` +
      "Apple account. See native/store/README.md.",
    "apple",
  );
} else {
  const appfileBundle = /app_identifier\("([^"]+)"\)/.exec(
    readFileSync(appfilePath, "utf8"),
  )?.[1];
  if (appfileBundle === configBundle)
    ok(`bundle id ${configBundle}, agreed by fastlane`);
  else {
    fail(
      `bundle id drift: app.config.js says ${configBundle}, the Appfile says ${appfileBundle}`,
      "the Appfile is Ruby and cannot import app.config.js, so the two are kept in " +
        "step by hand. app.config.js is the source of truth.",
    );
  }
}

// ---------------------------------------------------------------------------
// 4. CREDENTIALS. What the upload authenticates with.
// ---------------------------------------------------------------------------
section("CREDENTIALS");

const credentials = ascCredentials(root);
if (credentials.missing.length === 0) {
  ok(
    `App Store Connect API key ${credentials.keyId} (issuer ${credentials.issuerId})`,
  );
} else {
  warn(
    "no App Store Connect API key",
    "an API key rather than an Apple ID, because a .p8 carries no 2FA session to " +
      "expire mid-upload. Missing:\n      - " +
      credentials.missing.join("\n      - "),
    "apple",
  );
}

// EAS reads the PROCESS environment, not native/.env — fastlane loads the file
// on its own and `eas submit` does not, so a value that lives only in the file
// is configured for one tool and invisible to the other.
const easKeyVars = ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID"];
const unexported = easKeyVars.filter(
  (key) => !process.env[key] && env.value(key),
);
if (unexported.length) {
  warn(
    `export ${unexported.join(", ")} before running eas submit`,
    "eas reads the process environment; only fastlane loads native/.env.",
  );
}

if (
  env.value("EXPO_TOKEN") ||
  existsSync(join(process.env.HOME ?? "", ".expo", "state.json"))
) {
  ok("EAS has a way to authenticate (token or an `eas login` session)");
} else {
  warn(
    "no EXPO_TOKEN and no eas login session",
    "`eas login` for a laptop; the `native` workflow reads the EXPO_TOKEN repo secret.",
  );
}

if (
  /EAS_PROJECT_ID = process\.env/.test(appConfig) &&
  !env.value("EAS_PROJECT_ID")
) {
  warn(
    "the EAS project id is not pinned in app.config.js and is not in the environment",
    "run `eas init` in native/, then pin the id it prints as EAS_PROJECT_ID in " +
      "app.config.js so nobody needs the variable.",
    "apple",
  );
}

// ---------------------------------------------------------------------------
// 5. THE CONSOLE WORK. Neither command can do these — they are forms.
// ---------------------------------------------------------------------------
section("BY HAND IN THE CONSOLES");

warn(
  "the App Privacy questionnaire",
  "the answer is NO DATA COLLECTED, and it is true: settings, progress, boards, " +
    "ghosts and photographs are all in the WebView's own local storage and " +
    "nothing is transmitted. /privacy/ says the same thing.",
  "apple",
);
warn(
  "the Play Console's Data safety form and content rating",
  "same answers as Apple's, plus the 1024×500 feature graphic Play requires and " +
    "Apple does not.",
  "apple",
);
warn(
  "an age rating from the questionnaire in listing.mts",
  "the advisory answers are authored; the console still has to be walked through " +
    "them once per storefront.",
  "apple",
);

// ---------------------------------------------------------------------------
// 6. THE MAC APP STORE. The desktop shell's OTHER storefront, and the one
//    whose gates are least like the phone app's: a second app record, a
//    sandbox, a provisioning profile, and a package format `tauri build` does
//    not produce on its own.
// ---------------------------------------------------------------------------
if (SHIPS.macAppStore) {
  section("MAC APP STORE");

  const macConfig = at("tauri", "store", "mac.config.json");
  if (existsSync(macConfig)) {
    ok(`the Mac listing is compiled (${rel(macConfig)})`);
  } else {
    warn(
      "the Mac listing has not been compiled",
      "`make store-metadata`. If it says SKIPPED, the copy module has no MAC_INFO / " +
        "MAC_REVIEW_NOTES — the Mac page is a separate piece of writing, because the " +
        "phone's review notes describe a different binary. See the `store-listing` skill.",
    );
  }

  // THE ICON THE DOCK DRAWS. Not one of the PNGs: a macOS bundle reads
  // `icon.icns` and nothing else, and a build without one ships the blank
  // generic icon — which is both a rejection and the first thing anybody sees.
  const icns = at("tauri", "src-tauri", "icons", "icon.icns");
  if (existsSync(icns)) ok(`the macOS .icns is generated (${rel(icns)})`);
  else
    warn(
      "no macOS .icns",
      "`npm --prefix tauri run icons`; `make tauri` runs it too.",
    );

  // The Tahoe half. Optional today and dated tomorrow: without a layered icon
  // the Dock shows a flat square beside neighbours that pick up the glass.
  const layers = pngCount(at("tauri", "store", "icon-layers"));
  if (layers >= 2) ok(`${layers} Icon Composer layers for the macOS 26 icon`);
  else
    warn(
      "no Icon Composer layers",
      "`make icons`; tauri/store/MAC_APP_STORE.md has the rest.",
    );

  // EVERYTHING BELOW NEEDS A MAC, and says so rather than failing on Linux: the
  // entitlements name a team, the profile is issued to that team, and both are
  // gitignored because this repository is public.
  const entitlements = at("tauri", "src-tauri", "Entitlements.plist");
  if (existsSync(entitlements)) {
    ok(`the sandbox entitlements are generated (${rel(entitlements)})`);
  } else {
    warn(
      "no Entitlements.plist — the Mac App Store requires the App Sandbox",
      "`npm --prefix tauri run mac:appstore` writes it from APPLE_TEAM_ID in " +
        "native/.env. Generated rather than committed because it names a specific " +
        "developer account, and this repository is public.",
      "mac",
    );
  }

  const profile = at("tauri", "src-tauri", "embedded.provisionprofile");
  if (existsSync(profile))
    ok("a Mac App Store provisioning profile is in place");
  else
    warn(
      "no embedded.provisionprofile",
      "download a Mac App Store profile for the app id in the developer portal and " +
        "save it as tauri/src-tauri/embedded.provisionprofile (gitignored).",
      "mac",
    );

  // ---------------------------------------------------------------------------
  // 7. STEAM. The desktop shell ships to a second storefront, and everything
  //    above is Apple's. The build side of it — packaging, signing, the upload
  //    — belongs to `make tauri-package`; these are the STORE-PAGE facts, which
  //    are true or false from a cold checkout.
  // ---------------------------------------------------------------------------
}

if (SHIPS.steam) {
  section("STEAM");

  const steamConfigPath = at("tauri", "store", "steam.json");
  let steamConfig = null;
  try {
    steamConfig = JSON.parse(readFileSync(steamConfigPath, "utf8"));
  } catch {
    fail(
      `${rel(steamConfigPath)} could not be read`,
      "it holds the app and depot ids an upload writes into its VDF.",
    );
  }

  if (steamConfig) {
    // 480 is Spacewar, Valve's shared test app. Everything works with it — the
    // build uploads, the page renders — into a sandbox every developer on Steam
    // shares. It is the quietest failure in the whole submission.
    const appId = Number(process.env.SF_STEAM_APP_ID || steamConfig.appId);
    if (appId === 480) {
      fail(
        "the Steam app id is 480 — that is Spacewar, Valve's shared test app",
        "an upload against it succeeds into a sandbox every Steam developer shares. " +
          "Put the real id in tauri/store/steam.json.",
        "steam",
      );
    } else if (Number.isFinite(appId) && appId > 0) {
      ok(`Steam app ${appId}`);
    } else {
      fail(
        "tauri/store/steam.json has no appId",
        "Steamworks → App Admin; the number in the URL is the app id.",
        "steam",
      );
    }

    const depots = Object.entries(steamConfig.depots ?? {});
    const unset = depots.filter(
      ([, id]) => !Number.isFinite(Number(id)) || Number(id) <= 0,
    );
    if (depots.length === 0) {
      fail(
        "tauri/store/steam.json names no depots",
        "one per platform the build ships",
        "steam",
      );
    } else if (unset.length === 0) {
      ok(
        `${depots.length} Steam depots (${depots.map(([os]) => os).join(", ")})`,
      );
    } else {
      warn(
        `Steam depots not set: ${unset.map(([os]) => os).join(", ")}`,
        "Steamworks → App Admin → Depots. A depot per platform, or the upload has " +
          "nowhere to put that platform's build.",
        "steam",
      );
    }
  }

  const steamPage = at("tauri", "store", "steam-listing.md");
  if (existsSync(steamPage))
    ok(`the Steam store page is compiled (${rel(steamPage)})`);
  else
    warn("the Steam store page has not been compiled", "`make store-metadata`");

  // Valve's own required art. Not generated from the app mark — a capsule is a
  // designed image with the game's name set in it, which is a different job from
  // an icon (see the store-art half of tauri/store/README.md).
  const capsules = at("tauri", "store", "capsules");
  const capsuleCount = pngCount(capsules);
  if (capsuleCount > 0)
    ok(`${capsuleCount} Steam capsule images in ${rel(capsules)}`);
  else
    warn(
      "no Steam capsule art",
      "Valve requires a header (920×430), a small capsule (462×174), a main capsule " +
        "(1232×706) and a library capsule (600×900). None can be an upscaled icon — a " +
        "capsule is the game's name set in a picture, which is a designed image and " +
        "not a generated one. NOT gated on the Steamworks record: this is doable today, " +
        "and it is the item a first upload most often waits on.",
    );
}

// ---------------------------------------------------------------------------
// Print. Grouped, gated findings folded to the end of their group, and a
// summary line that answers the question the command was run to ask.
// ---------------------------------------------------------------------------
const MARK = { ok: "✓", warn: "•", fail: "✗" };

const shown = nowOnly ? findings.filter((f) => !f.gate) : findings;
let lastGroup = "";
for (const finding of shown) {
  if (finding.group !== lastGroup) {
    console.log(`\n${finding.group}`);
    lastGroup = finding.group;
  }
  const gate = finding.gate ? `  [${GATES[finding.gate].short}]` : "";
  console.log(`  ${MARK[finding.level]} ${finding.message}${gate}`);
  if (finding.hint) console.log(`      ${finding.hint}`);
  if (finding.gate) console.log(`      → ${GATES[finding.gate].hint}`);
}

const count = (level) => shown.filter((f) => f.level === level).length;
const gated = findings.filter((f) => f.gate).length;
const blocking = shown.filter((f) => f.level === "fail" && !f.gate).length;

console.log(
  `\nstore-preflight${nowOnly ? " --now" : ""}: ` +
    `${count("ok")} ready, ${count("warn")} outstanding, ${count("fail")} missing` +
    (nowOnly
      ? `  (${gated} more wait on a store record — drop --now to see them)`
      : `  (${gated} of them wait on a store record)`),
);
if (!nowOnly && gated > 0 && blocking === 0) {
  console.log(
    "Nothing left that this checkout can fix: every remaining failure waits on a " +
      'store account. `make store-preflight ARGS="--now"` is the doable list.',
  );
}

// A gated failure is not this checkout's fault, so it does not fail the
// command — otherwise the exit code says "broken" for the months an
// enrollment takes, and stops meaning anything.
process.exitCode = blocking > 0 ? 1 : 0;
