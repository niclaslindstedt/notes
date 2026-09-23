# The store listing

One authored source compiles into the files the upload tools read.

- `listing.mts` — **committed.** The brand-shaped facts, which storefronts
  this app ships on, the categories, the age-rating questionnaire with a
  reason on every row, the field limits and the release policy.
- `copy.mts` — **gitignored.** Every word a reader sees on the product page.
  Nothing backs it up; keep a copy outside the checkout.
- `copy.example.mts` — the committed skeleton that documents the shape.

```sh
make store-preflight     # is this checkout wired up to ship?
make store-metadata      # compile the listing (ARGS="--check" to validate)
```

**The privacy and support pages are not in this repository.** They are
generated from one row in [agilatorab/apps](https://github.com/agilatorab/apps)
and served from apps.agilator.se — which is why thirteen policies cannot drift
apart, and why the row changes in the same release the app's behaviour does.
The generator and the preflight know the URLs are off-site and say so rather
than looking for a file.

Notes ships on the **App Store** alone: no desktop shell, no Mac record, no
Steam page. `listing.mts` declares that, and neither tool asks for what a
storefront that is off would need.

---

One authored source compiles into the files the upload tools read.

- `listing.mts` — **committed.** The rules: which storefronts this game ships
  on, the categories, the age-rating questionnaire with a reason on every row,
  the field limits and the release policy.
- `copy.mts` — **gitignored.** Every word a buyer reads. Nothing backs it up;
  keep a copy outside the checkout.
- `copy.example.mts` — the committed skeleton that documents the shape.

```sh
make store-preflight     # is this checkout wired up to ship?
make store-metadata      # compile the listing (ARGS="--check" to validate)
```

---

Everything App Store Connect and the Play Console need, generated
from sources committed in this repository. Three commands produce the whole
submission package, and one says what is still missing:

```sh
make store-preflight         # is this checkout wired up to ship? what is left?
make store-metadata          # copy.mts + listing.mts → store.config.json, fastlane
make store-shots             # the real game → screenshots/ (captioned PNGs)
```

| Path                                 | What it is                                                   | Committed? |
| ------------------------------------ | ------------------------------------------------------------ | ---------- |
| `copy.mts`                           | **Every word both stores show** — the file you write         | **no**     |
| `copy.example.mts`                   | A skeleton naming what goes where, with placeholder strings  | yes        |
| `listing.mts`                        | The RULES: storefronts, limits, categories, age rating      | yes        |
| `store.config.json`                  | The compiled listing, for `eas metadata:push`                | no (built) |
| `../fastlane/metadata/**`            | The same listing in the layout `fastlane deliver` reads      | no (built) |
| `screenshots/<device>/`              | Upload-ready captioned PNGs at Apple's exact rasters         | no (built) |
| `../../tauri/store/screenshots/`     | The same set at Valve's raster, full-bleed                   | no (built) |

The generated ones are gitignored for the reason `pwa/dist` is: they are
reproducible outputs, and reviewing a 2868×1320 PNG diff in a pull request helps
nobody. Regenerate them whenever you submit.

## The listing

**`copy.mts` is the file to edit, and it is not in this repository.**

The game is **paid on the App Store** and **open source on GitHub**, and those
two facts are only in tension for the listing's WORDS: a description, subtitle,
promotional text and keyword set are what the store indexes and what a
competitor reads, and publishing them here would put the paid listing's own
prose on a crawlable page under somebody else's domain. So the copy is
gitignored, `copy.example.mts` is a committed skeleton documenting the shape,
and **the craft lives in the `store-listing` skill** — every field limit, the
guideline 4.2 argument the review notes have to make, and the traps.

Everything that is a RULE rather than a word stayed in the open, in
`listing.mts`: the types, the categories, the age-rating questionnaire, the
contact, and the release policy. An age-rating answer is a claim
about the build that a public repository should be able to check.

One authored source for both storefronts, because they describe one game — a
second hand-kept page is a second place the game's own name, version and claims
go stale. **Keep a backup of `copy.mts` outside this checkout**: nothing here
backs it up, by design.

Brand-shaped fields are **not** in it. The listing title, the marketing URL, the
privacy-policy URL and the copyright line are composed by the generator from
[`pwa/src/identity.ts`](../../pwa/src/identity.ts), so a rename reaches the store
listing the same way it reaches the manifest and the app's name.

A TypeScript module rather than a YAML catalog, for the reason the rest of this
repo's small fixed catalogs are (see [`docs/spec-conformance.md`](../../docs/spec-conformance.md)):
the generator and `tests/store_listing_test.ts` read the same typed rows with no
schema layer and no parser dependency, and the identity it composes against is
itself a module.

### What the generator enforces

`scripts/generate-store-metadata.mjs` **fails rather than truncates**, because
App Store Connect truncates silently and finding that out from a live listing is
the expensive path. It also says which copy module it compiled, and warns
loudly when that is the skeleton — a submission built from placeholders passes
every check and ships a subtitle reading `SUBTITLE — the hook, 30`.

| Field                    | Limit                                       |
| ------------------------ | ------------------------------------------- |
| `title`                  | 2–30 chars (composed from `identity.ts`)    |
| `subtitle`               | ≤ 30                                        |
| `keywords`               | ≤ 100 chars **for the comma-joined string** |
| `promoText`              | ≤ 170                                       |
| `description`            | 10–4000                                     |
| `releaseNotes`           | ≤ 4000                                      |
| `review.notes`           | 2–4000                                      |

It also **cross-checks the listing against the app it describes**, because the
review notes are not decoration — they are the argument that this app is not a
browser pointed at a website, and every claim in them is checkable from here:

- The notes say the whole game ships inside the binary. `src/config.ts` treats
  any `extra.gameUrl` in `app.config.js` as "stream the remote site instead", so
  one appearing there would make the notes false for every build at once. The
  generator refuses.
- The notes name `/privacy/`. Apple fetches that URL before review opens the app,
  so the page has to exist in the site's own tree — `pwa/public/privacy/index.html`
  — rather than be promised in the listing.
- The support URL has to be `https` (Apple rejects a `mailto:`) and must not be
  the source repository.

### The review phone number

The one listing field that behaves like a credential. Apple **rings it**, and
this repository is public, so it comes from `ASC_REVIEW_PHONE` in the gitignored
`native/.env` ([`.env.example`](../.env.example) documents it) and never from
any authored file. The generator leaves the field out of the upload rather than hand
review a number that rings nobody, and `make store-preflight` fails until one is
set.

### Uploading

Two paths, both fed from the same authored copy, so they cannot disagree:

| Path                | Uploads                | Notes                              |
| ------------------- | ---------------------- | ---------------------------------- |
| `fastlane deliver`  | text **+ screenshots** | Preferred. Free (MIT). Needs Ruby. |
| `eas metadata:push` | text only              | Cannot upload screenshots.         |

fastlane authenticates with an **App Store Connect API key** rather than an
Apple ID, because a `.p8` carries no 2FA session to expire in the middle of a
forty-minute upload. `ASC_KEY_ID`, `ASC_ISSUER_ID` and either `ASC_KEY_PATH` or
`ASC_KEY_CONTENT` — see `.env.example`; `native/*.p8` and `native/.env` are
gitignored.

`native/fastlane/` (the `Appfile` and the lanes) does not exist yet — it is one
of the things `make store-preflight` names, and [`../RELEASING.md`](../RELEASING.md)
§3 says what goes in it.

## The screenshots

`scripts/store-shots.mjs` drives the real game in headless Chromium.

```sh
make build                                   # the harness serves pwa/dist
npm i --no-save playwright-core              # and needs a Chromium
make store-shots                             # everything
make store-shots ARGS="--only iphone"        # one raster
make store-shots ARGS="--shot drift"         # one frame, iterating
make store-shots ARGS="--no-captions"        # the game, not the listing
```

Devices shot: **iPhone 6.9″** (2868×1320) and **iPad 13″** (2752×2064) — the only
two sizes App Store Connect requires, since Apple scales each set down to every
smaller device in its family.
it finds under `native/store/screenshots` to App Store Connect and a 16:9 desktop
frame is not a valid iPhone screenshot.

Four properties make the output trustworthy rather than a lucky screen-grab:

1. **Exact rasters.** Each device shoots at its true CSS viewport and
   `deviceScaleFactor`, so 956×440 @3× _is_ 2868×1320 — captured at device
   resolution, never upscaled into it, and captured against the layout that
   viewport actually gets (this game ships a whole portrait HUD). The final PNG's
   dimensions are asserted; Apple rejects a set that is one pixel off.

2. **Staged, not driven to.** Every frame stands the run at a moment
   (`?at=racing&s=…`, [`engine/game/place.ts`](../../engine/game/place.ts)) on a
   pinned campaign level and hands it to the engine's own driver (`?bot=1`).
   Nothing random is drawn by a placement and the bot is deterministic, so
   re-running reproduces the same frames — a caption tweak does not mean
   re-hunting for the moment.

3. **The shutter is timed in STAGE seconds, not wall milliseconds.** Under
   software rendering the simulation advances at a fraction of wall time, and a
   different fraction on every machine. The run's own clock is the only cursor
   that means the same thing everywhere. Both drivers report the ratio they
   observed — near 1 is a real GPU, near 10 is software rasterization.

4. **Every frame is a heads-up race.** Fifteen crews on one grid, physically on
   the road together, because a frame of one car on an empty road sells a
   screensaver. See the `store-shots` skill for why the campaign's stagger will
   not do.

`SHOTS` in [`scripts/store-shots/recipes.mjs`](../../scripts/store-shots/recipes.mjs)
is plain data — six frames, six different claims. Each frame's MOMENT is chosen
on a contact sheet rather than guessed:

```sh
make store-sweep ARGS="--shot drift"                        # coarse
# LOOK at previews/store-sweep/drift.png
make store-sweep ARGS="--shot drift --around 0.4 --span 0.6"  # fine
# LOOK again, write the winner into that recipe's captureAtS
```

**The captions render in the game's own type stack, which means the machine
matters.** The stack asks for `Avenir Next Condensed` and falls through to
`sans-serif`; a Linux runner has no condensed face, so its captions are wider
than a Mac's. The drivers print which family actually resolved. Shoot the
shipping set on macOS.

## What still has to be done by hand

None of these can be automated — they live in the store consoles, and
`make store-preflight` walks all of them plus the credentials and the app record:

- **App Privacy** (Apple) and **Data safety** (Play). The answer is
  NO DATA COLLECTED, and it is true: settings, progress, score boards, ghosts and
  photographs are all in the WebView's own local storage and nothing is
  transmitted. `/privacy/` says the same thing.
- The age-rating questionnaire, once per storefront, from the `advisory` answers
  authored in `listing.mts`.
- The 1024×500 feature graphic Play requires and Apple does not.

[`../RELEASING.md`](../RELEASING.md) is the full submission run-through.
