// The demo notebook — what `VITE_SEED=demo` boots onto (see `./demo.ts`), and
// what the App Store screenshots are taken of. One person's notes: a backend
// developer who runs a small homelab and writes a little on the side. Three
// namespaces, each with the folders and favorites a real one grows, and
// nearly every note written to be read at a glance on a phone.
//
// It is written for the store frames first, so several notes carry a premise
// a frame stages — `tests/dev/demo.test.ts` holds them to it:
//
// - "NAS rebuild" (Personal › Homelab, a favorite) is the live-preview
//   editor at its best: headings, a half-ticked checklist, inline code, a
//   fenced block, a quote — all of it on one phone screen.
// - "Retro — sprint 41" (Work) ends in four `TODO(name): …` lines, the ones a
//   single regex replace turns into a checklist.
// - "On-call handover" (Work) cites issue numbers the Work transform renders
//   as links, and a bridge code the global one masks.
// - "RFC: rate limits at the edge" (Work › RFCs) carries line comments.
// - "Wi-Fi & door codes" (Personal, locked) has secrets the same rule masks.
//
// Every timestamp is relative to `now`, so the notebook never ages. No brands,
// no real businesses, first names only, and fictional hosts
// (`example.com`, RFC 1918 addresses).

import type { LineComment } from "../domain/note-comment.ts";
import type { Folder, Note, Snapshot } from "../domain/note.ts";
import type { TransformRule } from "../domain/transform.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  type Namespace,
  namespaceLocalKey,
  serializeNamespaces,
} from "../storage/namespaces.ts";
import { serialize } from "../storage/serialize.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A note as authored: its age instead of timestamps, its folder by key. */
type NoteSpec = {
  id: string;
  title: string;
  body: string[];
  /** How long ago it was created, and last edited (defaults to created). */
  created: number;
  edited?: number;
  folder?: string;
  favorite?: boolean;
  locked?: boolean;
  archived?: boolean;
  /** Line comments: 0-based source lines and what was said about them, in
   *  line order (the order the app keeps them in). */
  comments?: { lines: number[]; text: string; age: number }[];
};

type NamespaceSpec = {
  namespace: Namespace;
  /** Folders by key → display name, in creation order. */
  folders: [key: string, name: string][];
  notes: NoteSpec[];
};

// ---- Personal ---------------------------------------------------------------

const PERSONAL: NamespaceSpec = {
  namespace: {
    slug: DEFAULT_NAMESPACE_SLUG,
    name: "Personal",
    glyph: "home",
    color: "#e5c07b",
  },
  folders: [
    ["homelab", "Homelab"],
    ["trips", "Trips"],
  ],
  notes: [
    {
      id: "demo-nas-rebuild",
      title: "NAS rebuild",
      folder: "homelab",
      favorite: true,
      created: 9 * DAY,
      edited: 25 * MINUTE,
      body: [
        "## Plan",
        "- [x] Order two 8 TB drives",
        "- [x] Burn-in with `badblocks -wsv`",
        "- [x] Scrub the old pool, export it",
        "- [ ] Rebuild as a mirror",
        "- [ ] Restore from the cold backup",
        "",
        "## Commands",
        "```",
        "zpool create -o ashift=12 \\",
        "  tank mirror sda sdb",
        "zfs set compression=lz4 tank",
        "```",
        "",
        "> Label the bays **before** you pull.",
        "",
        "## Log",
        "- Old pool: four years, zero errors",
        "- Drive B runs 3 °C hotter. Reseat.",
        "- Scrub took 6 h, repaired nothing",
        "",
        "## After",
        "1. Snapshot nightly, keep 30",
        "2. Off-site copy, first Sunday",
        "",
        "Budget: two drives, one Saturday.",
      ],
    },
    {
      id: "demo-network-map",
      title: "Network map",
      folder: "homelab",
      created: 40 * DAY,
      edited: 3 * DAY,
      body: [
        "VLANs, until I stop fiddling:",
        "",
        "- `10` trusted — `10.0.10.0/24`",
        "- `20` servers — `10.0.20.0/24`",
        "- `30` things — `10.0.30.0/24`",
        "- `99` guests — internet only",
        "",
        "The printer lives on `30` and is",
        "not allowed to talk to anything.",
      ],
    },
    {
      id: "demo-backups",
      title: "Backups, 3-2-1",
      folder: "homelab",
      created: 60 * DAY,
      edited: 12 * DAY,
      body: [
        "- 3 copies: laptop, NAS, cold drive",
        "- 2 kinds of media",
        "- 1 off-site: the drive at Mum's",
        "",
        "Test a restore every quarter. A backup you never restored is a hope.",
      ],
    },
    {
      id: "demo-lisbon",
      title: "Lisbon, four days",
      folder: "trips",
      created: 21 * DAY,
      edited: 2 * DAY,
      body: [
        "## Day 1",
        "- Tram up to the castle, early",
        "- Custard tarts, the warm ones",
        "## Day 2",
        "- Train to the coast, swim",
        "",
        "Split everything four ways.",
      ],
    },
    {
      id: "demo-packing",
      title: "Packing list",
      folder: "trips",
      created: 22 * DAY,
      edited: 2 * DAY,
      body: [
        "- [x] Passport",
        "- [x] Adapter (type F)",
        "- [ ] Swim things",
        "- [ ] Paperback for the flight",
        "- [ ] Charger. The long cable.",
      ],
    },
    {
      id: "demo-sourdough",
      title: "Sourdough",
      created: 90 * DAY,
      edited: 5 * DAY,
      body: [
        "500 g flour · 360 g water (72%)",
        "100 g starter · 10 g salt",
        "",
        "1. Autolyse 45 min",
        "2. Four folds, 30 min apart",
        "3. Cold proof overnight",
        "4. 250 °C lid on 20 min, off 25",
        "",
        "Starter peaks ~5 h after feeding.",
      ],
    },
    {
      id: "demo-codes",
      title: "Wi-Fi & door codes",
      locked: true,
      created: 120 * DAY,
      edited: 30 * DAY,
      body: [
        "Guest Wi-Fi: `lanterns` pass: tulip-harbor-42",
        "Building door code: 4471",
        "Bike lock code: 2851",
      ],
    },
    {
      id: "demo-books",
      title: "Books, this year",
      created: 200 * DAY,
      edited: 8 * DAY,
      body: [
        "1. ~~The one about the lighthouse~~",
        "2. The long history of salt",
        "3. That essay collection Ana lent me",
        "",
        "Give it back this time.",
      ],
    },
    {
      id: "demo-apartment",
      title: "Apartment fixes",
      created: 45 * DAY,
      edited: 6 * DAY,
      body: [
        "- [x] Re-caulk the bathtub",
        "- [ ] Door that swings shut by itself",
        "- [ ] Hall light: three-way switch",
        "- [ ] Measure for the shelf, twice",
      ],
    },
    {
      id: "demo-gifts",
      title: "Gift ideas",
      created: 70 * DAY,
      edited: 14 * DAY,
      body: [
        "- Ana: the good pencils, a sketchbook",
        "- Dad: soldering helping hands",
        "- Leo: a puzzle he can't solve fast",
      ],
    },
  ],
};

// ---- Work -------------------------------------------------------------------

const WORK: NamespaceSpec = {
  namespace: {
    slug: "work",
    name: "Work",
    glyph: "briefcase",
    color: "#61afef",
  },
  folders: [
    ["rfcs", "RFCs"],
    ["oneonones", "1:1s"],
  ],
  notes: [
    {
      id: "demo-handover",
      title: "On-call handover",
      created: 3 * DAY,
      edited: 40 * MINUTE,
      body: [
        "## Pages",
        "- Queue depth, twice. #418",
        "- Cert renewal, done. #409",
        "- Health check flaps on eu-2, #421",
        "",
        "## Watch",
        "- Disk on db-3 at 81%, #420",
        "- Deploy freeze Thursday 14:00",
        "- Leo is back Monday",
        "",
        "## Changed",
        "- Retry budget halved, #412",
        "- Queue alert now on depth, #418",
        "",
        "## Access",
        "- Incident bridge code: 719204",
        "- Runbooks start at #402",
        "",
        "## Next",
        "- [ ] Rotate the bridge code",
        "- [ ] Close #421, or write down why not",
        "",
        "Quiet week. Hand it back tidier.",
      ],
    },
    {
      id: "demo-standup",
      title: "Standup",
      created: 30 * DAY,
      edited: 1 * DAY,
      body: [
        "## Yesterday",
        "- Merged the retry fix, #412",
        "## Today",
        "- Pair with Priya on #415",
        "- Draft the rate-limit RFC",
      ],
    },
    {
      id: "demo-retro",
      title: "Retro — sprint 41",
      created: 4 * DAY,
      edited: 3 * HOUR,
      body: [
        "## Went well",
        "- Canary caught the cache bug",
        "- Pairing on the flaky test",
        "- Nobody paged after midnight",
        "",
        "## Could be better",
        "- Review queue sat for two days",
        "- Staging drifted from prod again",
        "",
        "## Action items",
        "TODO(sam): runbook for cache warmup",
        "TODO(priya): split the payments suite",
        "TODO(leo): alert on queue depth",
        "TODO(sam): pin the base image digest",
      ],
    },
    {
      id: "demo-rfc",
      title: "RFC: rate limits at the edge",
      folder: "rfcs",
      created: 6 * DAY,
      edited: 5 * HOUR,
      body: [
        "## Problem",
        "One tenant's batch job can starve everyone else's requests.",
        "",
        "## Proposal",
        "A token bucket per API key, at the edge, before auth.",
        "",
        "- 100 requests/s sustained",
        "- bursts up to 400",
        "- `429` with a `Retry-After`",
        "",
        "## Open questions",
        "- Do internal jobs get a bypass?",
        "- Where do we keep the counters?",
      ],
      comments: [
        {
          lines: [4],
          text: "Before auth means anonymous traffic counts too. Say so.",
          age: 3 * HOUR,
        },
        {
          lines: [6, 7],
          text: "Where do these numbers come from? Link last month's p99.",
          age: 4 * HOUR,
        },
        {
          lines: [12],
          text: "Leo says one shared store per region is enough.",
          age: 2 * HOUR,
        },
      ],
    },
    {
      id: "demo-release",
      title: "Release checklist",
      favorite: true,
      created: 80 * DAY,
      edited: 1 * DAY,
      body: [
        "- [x] Changelog reads like English",
        "- [x] Migrations run backwards too",
        "- [ ] Tag, then build from the tag",
        "- [ ] Canary for an hour",
        "- [ ] Tell support what changed",
      ],
    },
    {
      id: "demo-snippets",
      title: "Shell snippets",
      favorite: true,
      created: 300 * DAY,
      edited: 2 * DAY,
      body: [
        "Who is holding the port:",
        "```",
        "lsof -iTCP:8080 -sTCP:LISTEN",
        "```",
        "Biggest things in here:",
        "```",
        "du -sh * | sort -h | tail",
        "```",
        "How long a request takes:",
        "```",
        "curl -so /dev/null \\",
        "  -w '%{time_total}\\n' $URL",
        "```",
        "Undo the last commit, keep work:",
        "```",
        "git reset --soft HEAD~1",
        "```",
        "Read a token's payload:",
        "```",
        "cut -d. -f2 <<< $T | base64 -d",
        "```",
        "Errors, as they happen:",
        "```",
        "tail -f app.log | grep -i err",
        "```",
        "Tunnel to the staging database:",
        "```",
        "ssh -L 5432:db:5432 staging",
        "```",
        "Which files mention it:",
        "```",
        "grep -rl 'rate.?limit' src/",
        "```",
      ],
    },
    {
      id: "demo-priya",
      title: "Priya",
      folder: "oneonones",
      created: 50 * DAY,
      edited: 7 * DAY,
      body: [
        "- Wants to own the billing service",
        "- Conference talk: yes, help outline",
        "- Next time: on-call load",
      ],
    },
    {
      id: "demo-onboarding",
      title: "Onboarding a new hire",
      created: 150 * DAY,
      edited: 20 * DAY,
      body: [
        "1. Laptop, keys, the two repos",
        "2. Ship something small on day two",
        "3. Shadow on-call before carrying it",
      ],
    },
  ],
};

// ---- Writing ----------------------------------------------------------------

const WRITING: NamespaceSpec = {
  namespace: {
    slug: "writing",
    name: "Writing",
    glyph: "pen",
    color: "#c678dd",
  },
  folders: [],
  notes: [
    {
      id: "demo-plain-text",
      title: "Draft: notes in plain text",
      created: 12 * DAY,
      edited: 1 * DAY,
      body: [
        "# Why my notes are plain text",
        "",
        "Every notes app I have loved either shut down, changed hands or started to want a subscription. The notes that survived were the ones kept as files.",
        "",
        "So now every note is a Markdown file. It opens in anything, diffs cleanly, greps in a second, and will still open in twenty years.",
        "",
        "Search is `grep`. A backup is a copy. Sync is whichever folder I point it at, and nobody reads along.",
        "",
        "## What I gave up",
        "- Nothing I miss",
        "",
        "## What I got back",
        "- Notes nobody else is reading",
        "- A folder I can *back up, search and keep*",
        "",
        "> Write in the format you can still read when the app is gone.",
      ],
    },
    {
      id: "demo-talk",
      title: "Talk ideas",
      created: 35 * DAY,
      edited: 9 * DAY,
      body: [
        "- Boring technology, a love letter",
        "- What a homelab taught me about on-call",
        "- Deleting code as a feature",
      ],
    },
    {
      id: "demo-overused",
      title: "Words I overuse",
      created: 100 * DAY,
      edited: 11 * DAY,
      body: ["just · really · actually · simply", "", "Search for them. Cut."],
    },
  ],
};

export const DEMO_NAMESPACES: readonly NamespaceSpec[] = [
  PERSONAL,
  WORK,
  WRITING,
];

// ---- Transform rules --------------------------------------------------------

/**
 * The rules this person keeps: issue numbers become links in the work notes,
 * and codes and passwords are masked on screen everywhere (the note still
 * stores what was typed).
 */
export const DEMO_TRANSFORMS: readonly TransformRule[] = [
  {
    id: "demo-issue-links",
    namespace: "work",
    name: "Issue links",
    pattern: "#(\\d{3,5})\\b",
    ignoreCase: false,
    kind: "link",
    replacement: "https://git.example.com/platform/api/issues/$1",
    mask: "ends",
    sample: "Merged the retry fix, #412",
    enabled: true,
  },
  {
    id: "demo-hide-codes",
    namespace: null,
    name: "Hide codes",
    pattern: "(?<=(?:pass|code): )\\S+",
    ignoreCase: true,
    kind: "sensitive",
    replacement: "",
    mask: "fixed",
    sample: "Building door code: 4471",
    enabled: true,
  },
];

// ---- building ---------------------------------------------------------------

function buildNote(
  spec: NoteSpec,
  folders: Map<string, string>,
  now: number,
): Note {
  const createdAt = now - spec.created;
  const updatedAt = now - (spec.edited ?? spec.created);
  const note: Note = {
    id: spec.id,
    title: spec.title,
    // Every note ends with the newline format-on-save would give it, so
    // opening one never registers as an edit.
    body: spec.body.join("\n") + "\n",
    createdAt,
    updatedAt,
  };
  if (spec.folder) {
    const id = folders.get(spec.folder);
    if (!id) throw new Error(`demo note ${spec.id}: no folder ${spec.folder}`);
    note.folderId = id;
  }
  if (spec.favorite) note.favorite = true;
  if (spec.locked) note.locked = true;
  if (spec.archived) note.archived = true;
  if (spec.comments) {
    note.comments = spec.comments.map((c, i): LineComment => ({
      id: `${spec.id}-comment-${i + 1}`,
      lines: [...c.lines].sort((a, b) => a - b),
      text: c.text,
      createdAt: now - c.age,
      updatedAt: now - c.age,
    }));
  }
  return note;
}

/** One namespace's document, stamped relative to `now`. */
export function buildDemoSnapshot(spec: NamespaceSpec, now: number): Snapshot {
  const folders: Folder[] = spec.folders.map(([key, name], i) => ({
    id: `demo-folder-${key}`,
    name,
    // Created in list order, long enough ago to predate every note in them.
    createdAt: now - 400 * DAY + i * DAY,
  }));
  const ids = new Map(spec.folders.map(([key]) => [key, `demo-folder-${key}`]));
  const notes = spec.notes.map((n) => buildNote(n, ids, now));
  return folders.length > 0 ? { notes, folders } : { notes };
}

export type DemoNotebook = {
  /** Every namespace with its document, the default first. */
  namespaces: { namespace: Namespace; snapshot: Snapshot }[];
  /** What the in-memory `localStorage` starts with: key → stored text. */
  storage: Record<string, string>;
  /** The transform rules, for the global appearance layer. */
  transforms: TransformRule[];
};

/** The whole demo notebook, stamped relative to `now`. Pure. */
export function buildDemo(now: number = Date.now()): DemoNotebook {
  const namespaces = DEMO_NAMESPACES.map((spec) => ({
    namespace: spec.namespace,
    snapshot: buildDemoSnapshot(spec, now),
  }));
  const storage: Record<string, string> = {
    // The local backend, opened on the Personal namespace's overview.
    "notes:backend": "browser",
    "notes:namespace:active": DEFAULT_NAMESPACE_SLUG,
    "notes:namespaces": serializeNamespaces(namespaces.map((n) => n.namespace)),
  };
  for (const { namespace, snapshot } of namespaces) {
    storage[namespaceLocalKey(namespace.slug)] = serialize(snapshot);
  }
  return {
    namespaces,
    storage,
    transforms: DEMO_TRANSFORMS.map((r) => ({ ...r })),
  };
}
