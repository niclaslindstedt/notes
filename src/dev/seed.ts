// Developer fake-data seeding. Populates localStorage with a rich, realistic
// dataset — several namespaces, each with notes of varying length, title and
// body — so the app can be exercised against lifelike content while debugging
// without hand-typing it every time.
//
// Ported in spirit from checklist's developer "Fake data" toggle
// (`src/dev/seed.ts` + the in-memory `dev-seed` adapter), but adapted to the
// notes domain and reshaped into an ENV-DRIVEN seed rather than a UI toggle:
// checklist swaps an ephemeral in-memory adapter for the active document only,
// whereas a notes dataset spans the *namespace registry* plus a per-namespace
// document, neither of which an adapter swap reaches. So instead this writes
// straight into the localStorage keys the real local backend reads
// (`namespaceLocalKey(slug)` for each document, the namespace registry for the
// list), behind the `VITE_SEED` flag set by the `dev:seed` / `build:seed`
// npm scripts (see `.env.seed`).
//
// Seeding is guarded by a version sentinel: it writes once per `SEED_VERSION`
// so a reload during a debugging session keeps the edits you just made, and
// bumping `SEED_VERSION` (because the dataset below changed) forces a fresh
// seed on the next load. Pass `{ force: true }` to re-seed unconditionally.
//
// WARNING — this OVERWRITES the local document of every namespace it seeds,
// including the historical default key. It only runs behind the explicit
// `VITE_SEED` flag and only once per version, so a developer who opts in is
// knowingly trading their local sample data; it never runs in an ordinary
// `make dev` / production build.

import { type Note, type Snapshot } from "../domain/note.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  type Namespace,
  namespaceLocalKey,
  serializeNamespaces,
} from "../storage/namespaces.ts";
import { serialize } from "../storage/serialize.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("seed");

// Bump whenever the dataset below changes so an already-seeded browser
// re-seeds on the next `dev:seed` load instead of keeping stale sample data.
export const SEED_VERSION = "1";

const SEED_SENTINEL_KEY = "notes:dev:seeded";
// The registry key the namespace store reads (kept in lockstep with
// `LIST_KEY` in `storage/namespaces.ts`).
const NAMESPACES_KEY = "notes:namespaces";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Whether the `VITE_SEED` flag (set by the `dev:seed` script) is on. */
export function isSeedRequested(): boolean {
  const flag = import.meta.env.VITE_SEED;
  return flag === "true" || flag === "1";
}

// A note authored relative to `now`, so the seeded list sorts and reads like a
// real one. `created` / `updated` are "this many days ago"; `updated` defaults
// to `created` (an untouched note). A small per-note hour jitter keeps two
// notes from the same day from colliding on an identical timestamp.
type NoteSpec = {
  title: string;
  body: string;
  created: number;
  updated?: number;
  archived?: boolean;
};

let jitter = 0;
function buildNotes(now: number, specs: NoteSpec[]): Note[] {
  return specs.map((s) => {
    const createdAt = now - s.created * DAY - (jitter++ % 11) * HOUR;
    const updatedAt =
      now - (s.updated ?? s.created) * DAY - (jitter++ % 7) * HOUR;
    const note: Note = {
      id: crypto.randomUUID(),
      title: s.title,
      body: s.body,
      createdAt,
      updatedAt,
    };
    if (s.archived) note.archived = true;
    return note;
  });
}

/**
 * A seeded namespace and the document it holds. The first entry is always the
 * default namespace so the registry normaliser keeps it at the front.
 */
export type SeededNamespace = {
  namespace: Namespace;
  snapshot: Snapshot;
};

/**
 * Build the full sample dataset: several namespaces, each with notes of
 * varying length, title and body (one-liners, checklists, long-form Markdown
 * with headings / code / quotes, and a couple of archived notes). Pure — a
 * fresh dataset is built each call, stamped relative to `now`.
 */
export function buildSeed(now: number = Date.now()): SeededNamespace[] {
  jitter = 0;
  return [
    {
      namespace: { slug: DEFAULT_NAMESPACE_SLUG, name: "Default" },
      snapshot: {
        notes: buildNotes(now, [
          {
            title: "Welcome to notes",
            created: 30,
            updated: 1,
            body: [
              "This is a **local-first** notebook. Everything you write stays",
              "in this browser until you connect a folder or cloud backend.",
              "",
              "- Swipe a note right to archive it",
              "- Tap the trophy to see what you've unlocked",
              "- Use the side menu to switch **namespaces**",
              "",
              "> Tip: the editor renders Markdown live as you type.",
            ].join("\n"),
          },
          {
            title: "Groceries",
            created: 2,
            updated: 0,
            body: [
              "- [x] Oat milk",
              "- [x] Sourdough",
              "- [ ] Coffee beans",
              "- [ ] Spinach",
              "- [ ] Olive oil (the green tin)",
            ].join("\n"),
          },
          {
            title: "",
            created: 0,
            body: "Call the dentist back about the Tuesday slot.",
          },
          {
            title: "Books to read",
            created: 12,
            updated: 4,
            body: [
              "1. _The Left Hand of Darkness_ — Le Guin",
              "2. _Project Hail Mary_ — Weir",
              "3. _Piranesi_ — Clarke",
              "4. _The Overstory_ — Powers",
              "",
              "Finished: ~~_Klara and the Sun_~~ (loved it).",
            ].join("\n"),
          },
          {
            title: "App ideas",
            created: 21,
            updated: 6,
            body: [
              "# Half-baked ideas",
              "",
              "## Worth prototyping",
              "",
              "- A tiny CLI that turns a folder of Markdown into a static site",
              "- Habit tracker that only ever shows *today*",
              "",
              "## Probably not",
              "",
              "- Yet another to-do app",
              "- Social network for houseplants 🪴",
              "",
              "```js",
              "// the whole 'static site' idea, roughly",
              "const pages = glob('**/*.md').map(render);",
              "writeAll(pages);",
              "```",
            ].join("\n"),
          },
          {
            title: "Old grocery run",
            created: 40,
            updated: 38,
            archived: true,
            body: "- [x] Tinfoil\n- [x] Dish soap",
          },
        ]),
      },
    },
    {
      namespace: {
        slug: "work",
        name: "Work",
        glyph: "briefcase",
        color: "#3b82f6",
      },
      snapshot: {
        notes: buildNotes(now, [
          {
            title: "Standup — Mon",
            created: 0,
            body: [
              "**Yesterday:** finished the migration runner tests.",
              "**Today:** namespace reconcile on the Dropbox backend.",
              "**Blockers:** waiting on design for the empty state.",
            ].join("\n"),
          },
          {
            title: "Q3 roadmap",
            created: 18,
            updated: 3,
            body: [
              "# Q3 planning",
              "",
              "Three themes this quarter, in priority order.",
              "",
              "## 1. Sync reliability",
              "",
              '- [ ] Conflict resolution UX ("keep mine" / "keep theirs")',
              "- [ ] Retry with backoff on the cloud backends",
              "- [x] Offline mirror for Google Drive",
              "",
              "## 2. Onboarding",
              "",
              "- [ ] First-run tour",
              "- [ ] Sample data a new user can poke at",
              "",
              "## 3. Performance",
              "",
              "- [ ] Virtualise the note list past ~500 notes",
              "- [ ] Profile the live-preview parser on long notes",
              "",
              '> Stretch: a public changelog modal ("What\'s new").',
            ].join("\n"),
          },
          {
            title: "1:1 with Priya",
            created: 7,
            updated: 7,
            body: [
              "- Career: wants to lead the sync workstream — yes, hand it over",
              "- Feedback: more context in PR descriptions",
              "- Follow up: conference budget for the autumn",
            ].join("\n"),
          },
          {
            title: "Bug triage",
            created: 1,
            updated: 0,
            body: [
              "- [ ] #412 — archive swipe fires twice on iOS",
              "- [ ] #418 — favicon doesn't update on namespace switch",
              "- [x] #401 — encrypted notes fail to decrypt after reload",
              "- [ ] #420 — long titles overflow the side menu",
            ].join("\n"),
          },
          {
            title: "Useful psql",
            created: 25,
            updated: 25,
            body: [
              "```sql",
              "-- biggest tables, fast",
              "SELECT relname, pg_size_pretty(pg_total_relation_size(relid))",
              "FROM pg_catalog.pg_statio_user_tables",
              "ORDER BY pg_total_relation_size(relid) DESC",
              "LIMIT 10;",
              "```",
            ].join("\n"),
          },
          {
            title: "Old sprint plan",
            created: 60,
            updated: 55,
            archived: true,
            body: "Superseded by the Q3 roadmap. Kept for reference.",
          },
        ]),
      },
    },
    {
      namespace: {
        slug: "recipes",
        name: "Recipes",
        glyph: "coffee",
        color: "#f59e0b",
      },
      snapshot: {
        notes: buildNotes(now, [
          {
            title: "Sourdough loaf",
            created: 90,
            updated: 5,
            body: [
              "# Everyday sourdough",
              "",
              "Makes one boule. Total time ~24h, hands-on ~30 min.",
              "",
              "## Ingredients",
              "",
              "- 500g bread flour",
              "- 350g water (70% hydration)",
              "- 100g active starter",
              "- 10g salt",
              "",
              "## Method",
              "",
              "1. **Autolyse** — mix flour + water, rest 1h.",
              "2. Add starter and salt, fold in.",
              "3. **Bulk** — 4–5 sets of stretch-and-folds over 4h.",
              "4. Shape, then cold-proof overnight in the fridge.",
              "5. Bake at 250°C: 20 min lid on, 20 min lid off.",
              "",
              "> The crumb is better when the dough is *just* jiggly before shaping.",
            ].join("\n"),
          },
          {
            title: "Weeknight pasta",
            created: 14,
            updated: 2,
            body: [
              "Garlic, chilli, anchovy melted in olive oil. Toss with",
              "spaghetti and a ladle of pasta water. Lemon + parsley to finish.",
              "Done in the time the water boils.",
            ].join("\n"),
          },
          {
            title: "Cold brew ratio",
            created: 8,
            body: "1:8 coffee to water, coarse grind, 16h in the fridge. Dilute 1:1.",
          },
          {
            title: "Pancakes",
            created: 3,
            body: [
              "- 1 cup flour",
              "- 1 cup milk",
              "- 1 egg",
              "- 1 tbsp sugar, 1 tsp baking powder, pinch of salt",
              "",
              "Rest 10 min. Medium heat.",
            ].join("\n"),
          },
        ]),
      },
    },
    {
      namespace: {
        slug: "travel",
        name: "Travel",
        glyph: "plane",
        color: "#10b981",
      },
      snapshot: {
        notes: buildNotes(now, [
          {
            title: "Japan — 2 weeks",
            created: 45,
            updated: 9,
            body: [
              "# Japan itinerary",
              "",
              "Two weeks, late October (autumn leaves 🍁).",
              "",
              "## Tokyo (4 nights)",
              "",
              "- Tsukiji outer market — go early, eat breakfast there",
              "- teamLab Planets (book ahead)",
              "- Day trip to Kamakura",
              "",
              "## Kyoto (4 nights)",
              "",
              "- Fushimi Inari at dawn (beat the crowds)",
              "- Arashiyama bamboo grove",
              "- Nishiki market",
              "",
              "## Kanazawa → Hakone (rest)",
              "",
              "- Kenroku-en garden",
              "- One night in a ryokan with an onsen",
              "",
              "## Practical",
              "",
              "- [ ] JR Pass — buy before arriving",
              "- [ ] Pocket wifi at the airport",
              "- [ ] IC card (Suica) for local trains",
              "- [x] Passport valid through next year",
            ].join("\n"),
          },
          {
            title: "Packing list",
            created: 10,
            updated: 1,
            body: [
              "- [ ] Passport + ID",
              "- [ ] Chargers, adaptor, battery pack",
              "- [ ] Layers (it gets cold at night)",
              "- [ ] Comfortable walking shoes",
              "- [ ] Reusable water bottle",
              "- [x] Book the dog sitter",
            ].join("\n"),
          },
          {
            title: "Lisbon notes",
            created: 200,
            updated: 200,
            archived: true,
            body: "Last year's trip. Time Out Market, the 28 tram, pastéis in Belém.",
          },
        ]),
      },
    },
    {
      namespace: {
        slug: "journal",
        name: "Journal",
        glyph: "pen",
        color: "#a855f7",
      },
      snapshot: {
        notes: buildNotes(now, [
          {
            title: "2026-06-18",
            created: 2,
            body: [
              "Long run this morning, 14k along the river. Legs heavy by the",
              "end but the head felt clear. Read on the balcony after.",
              "",
              "Grateful for: cold water, a quiet street, no meetings.",
            ].join("\n"),
          },
          {
            title: "2026-06-12",
            created: 8,
            body: "Short one. Tired. Early night.",
          },
          {
            title: "2026-06-05",
            created: 15,
            body: [
              "Shipped the namespace feature today. Proud of how the",
              "reconcile turned out — it just *does the right thing* when you",
              "connect a second device.",
              "",
              "Note to self: write the docs while it's fresh, not next week.",
            ].join("\n"),
          },
        ]),
      },
    },
  ];
}

/**
 * One combined sample document — every seeded namespace's notes flattened into
 * a single `Snapshot`. This is what the in-memory dev-seed adapter
 * (`src/storage/dev-seed/index.ts`) serves for the in-app "Fake data" toggle,
 * which works against one document rather than the whole namespace registry.
 * Pure: a fresh document each call, stamped relative to `now`.
 */
export function buildSeedSnapshot(now: number = Date.now()): Snapshot {
  return { notes: buildSeed(now).flatMap((s) => s.snapshot.notes) };
}

function readSentinel(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(SEED_SENTINEL_KEY);
  } catch {
    return null;
  }
}

/**
 * Write the sample dataset into localStorage: the namespace registry plus
 * each namespace's serialized document, under the same keys the local backend
 * reads. No-ops (returning `false`) when localStorage is unavailable, or when
 * the current `SEED_VERSION` was already seeded and `force` isn't set.
 */
export function seedDevData(opts: { force?: boolean } = {}): boolean {
  if (typeof localStorage === "undefined") return false;
  if (!opts.force && readSentinel() === SEED_VERSION) return false;

  const seeded = buildSeed();
  try {
    const namespaces = seeded.map((s) => s.namespace);
    localStorage.setItem(NAMESPACES_KEY, serializeNamespaces(namespaces));
    for (const { namespace, snapshot } of seeded) {
      localStorage.setItem(
        namespaceLocalKey(namespace.slug),
        serialize(snapshot),
      );
    }
    localStorage.setItem(SEED_SENTINEL_KEY, SEED_VERSION);
  } catch (err) {
    log.error("seed failed", err);
    return false;
  }

  const noteCount = seeded.reduce((n, s) => n + s.snapshot.notes.length, 0);
  log.warn(
    `seeded ${seeded.length} namespaces / ${noteCount} notes (VITE_SEED) — ` +
      `local data was overwritten`,
  );
  return true;
}

/**
 * Seed only when the `VITE_SEED` flag is on. Called once at startup from
 * `main.tsx` before React mounts, so the local backend's first synchronous
 * load already sees the seeded default document.
 */
export function maybeSeedDevData(): void {
  if (isSeedRequested()) seedDevData();
}
