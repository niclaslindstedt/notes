# The store listing

Everything App Store Connect needs for Notes' product page, compiled from one
authored source and uploaded with fastlane.

```sh
make store-preflight     # is this checkout wired up to ship? what is left?
make store-metadata      # copy.mts + listing.mts → store.config.json, fastlane metadata
make store-upload        # the listing text + screenshots → App Store Connect
```

| Path                            | What it is                                                     | Committed? |
| ------------------------------- | -------------------------------------------------------------- | ---------- |
| `listing.mts`                   | The RULES: storefronts, categories, age rating, review contact | yes        |
| `copy.example.mts`              | A skeleton naming what goes where, with placeholder strings    | yes        |
| `copy.mts`                      | **Every word the product page shows**                          | **no**     |
| `store.config.json`             | The compiled listing, for `eas metadata:push`                  | no (built) |
| `../fastlane/metadata/**`       | The same listing in the layout `fastlane deliver` reads        | no (built) |
| `screenshots/en-US/`            | Upload-ready PNGs at Apple's exact rasters                     | no         |
| `../fastlane/Appfile, Fastfile` | The upload lane — identity from `APP_BUNDLE_ID`                | yes        |

Notes ships on the **App Store** alone — iPhone and iPad. `listing.mts`
declares that, and neither tool asks for what a storefront that is off would
need.

## Why the words are not here

The app is on the App Store and open source here. Those two facts are only in
tension for the listing's WORDS: a description, subtitle, promotional text and
keyword set are what the store indexes and what a competitor reads, and
publishing them in a public repository puts the listing's own copy on a
crawlable page. So `copy.mts` is gitignored and kept outside this checkout,
`copy.example.mts` documents its shape, and everything that is a rule rather
than a word stays in the open in `listing.mts` — an age-rating answer is a
claim about the build that anyone should be able to check.

**The privacy and support pages are not in this repository either.** They are
generated from one row in [agilatorab/apps](https://github.com/agilatorab/apps)
and served from apps.agilator.se, which is why the policies of every app on
that site cannot drift apart.

## What the generator enforces

`scripts/generate-store-metadata.mjs` **fails rather than truncates**, because
App Store Connect truncates silently.

| Field          | Limit                                       |
| -------------- | ------------------------------------------- |
| `title`        | 2–30 chars (`APP_DISPLAY_NAME`)             |
| `subtitle`     | ≤ 30                                        |
| `keywords`     | ≤ 100 chars **for the comma-joined string** |
| `promoText`    | ≤ 170                                       |
| `description`  | 10–4000                                     |
| `releaseNotes` | ≤ 4000                                      |
| `review.notes` | 2–4000                                      |

It also refuses a keyword the title or subtitle already spends, and it and
`tests/store-listing.test.ts` check the review notes against the build — they
are the guideline 4.2 argument that this app is not a browser pointed at a
website.

## The screenshots

Taken of **the real app on its demo data**: `VITE_SEED=demo` builds Notes
onto one person's notebook held in memory (`src/dev/demoData.ts`; `make demo`
to try it), and each frame is staged on it at the device's real viewport, with
the real iOS status bar. The set is produced outside this repository and
staged into `screenshots/en-US/` before an upload:

- `iphone-NN-<id>.png` — **1320×2868**, the 6.9″ iPhone
- `ipad-NN-<id>.png` — **2064×2752**, the 13″ iPad

Those are the two sizes App Store Connect requires; it scales each down to the
smaller devices in its family. fastlane files every PNG under its device by
its dimensions, in name order.

## Uploading

`make store-upload` recompiles the listing and runs `fastlane listing`
(`../fastlane/Fastfile`): `deliver` with the text and the screenshots, **never
a binary, never a submission** — the build goes up through EAS, and a human
submits for review in App Store Connect.

It needs, in `native/.env` or the environment (see `../.env.example`):

- `APP_DISPLAY_NAME` and `APP_BUNDLE_ID` — the listing's name and the app it
  belongs to. The upload refuses without them: compiled without a name, the
  title is the plain project name, and deliver would rename the product page.
- `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_PATH` or `ASC_KEY_CONTENT` — an
  App Store Connect API key, so there is no two-factor session to expire
  mid-upload.
- `ASC_REVIEW_PHONE` — the number App Store review rings. Never committed; the
  generator leaves the field out rather than upload a placeholder.

## What still has to be done by hand

In App Store Connect, once per app: **App Privacy** (the answer is Data Not
Collected, and it is true), the **price**, and pressing **Submit for Review**.
