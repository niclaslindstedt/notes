---
name: refactor
description: "Use to work through the refactor backlog in docs/refactoring-roadmap.md, to extend it with newly-discovered code smells, or to clear it back to a blank slate. Picks the highest-leverage pending item, re-verifies its severity against the current tree (line counts and the smell shape drift over time), and either lands the fix, skips it with a written reason, or extends the roadmap when exploration mode finds something new. Clear mode wipes the Pending / Landed / Investigated lists back to the bootstrap shape and optionally chains a fresh Explore to repopulate them. Grounded in the roadmap — bootstraps it on first run, and stops when the queue is empty rather than refactoring for its own sake."
---

# Working the refactor roadmap

`docs/refactoring-roadmap.md` is the single source of truth for what
this codebase considers a code smell worth fixing. It carries:

- a strategic-context section explaining why the smells matter — the
  goal is to keep the codebase clean and the layering honest so new
  UI surfaces, new storage backends (the `StorageAdapter` byte
  contract must stay interchangeable across local / folder / Dropbox /
  Google Drive, plus the `encrypting/` and `cache/` wrappers), and new
  namespace / Markdown features stay easy to add;
- a **severity rubric** (1–10, with **3** as the fix threshold and
  an "easy wins" carve-out for mechanical zero-risk transforms);
- a **Pending** list grouped by severity band, with line counts and
  refactor plans;
- a **Landed** list of past fixes;
- an **Investigated and skipped** list of candidates rejected on
  prior sweeps, with the reasoning.

This skill is the operating procedure for that file. There are three
modes:

- **Work mode** — pick the highest-leverage pending item, verify,
  land it (or skip it with a reason).
- **Explore mode** — survey the codebase for smells the roadmap
  hasn't catalogued yet, rate them, and append them to **Pending**.
- **Clear mode** — wipe the roadmap's findings back to its
  bootstrap shape (empty Pending / Landed / Investigated lists),
  then optionally chain into a fresh Explore to repopulate it.

The skill is **grounded**: every action references a specific row in
the roadmap. Don't refactor code that isn't on the list — file a
finding under Explore mode first, get it rated, then land it on a
follow-up pass. **Don't keep going once Pending is empty.** A clean
roadmap means the layering is honest and the next UI surface,
storage backend, or namespace feature has a clean runway; the next
session will re-survey before adding anything new.

## Bootstrap — first run, before anything else

`docs/refactoring-roadmap.md` does not exist yet in this repo. The
**first** time this skill runs, create it before doing any other
work:

1. Write `docs/refactoring-roadmap.md` with:
   - a short **strategic-context** intro (the clean-layering framing
     above — honest dependency direction `app → ui → domain` and
     `app → storage → domain`; interchangeable `StorageAdapter`
     backends including the `encrypting/` and `cache/` wrappers;
     easy-to-add UI surfaces and namespace / Markdown features);
   - the **severity rubric** table (reproduced under "Rate each
     finding" below);
   - an empty **Pending** section (with the severity-band
     sub-headings and an "Easy wins" carve-out at the bottom);
   - an empty **Landed** section;
   - an empty **Investigated and skipped** section.
2. Then proceed in **Explore mode** to populate **Pending** — pick
   one survey angle, run it, and write the findings into the file
   you just created.

After the bootstrap run the file exists and behaves as the source of
truth for every subsequent run; this step is a no-op once the file
is present.

## Modes — pick one per invocation

Pick at session start; don't blend modes within one PR. Each PR
carries a single item from one mode (Clear mode may chain a fresh
Explore into the same PR — see its loop).

- **Work mode** (default): user asked you to "work the refactor
  backlog", "do the next refactor", "land another item". Run the
  **Work-mode loop** below.
- **Explore mode**: user asked you to "find more refactor
  candidates", "do another sweep", "extend the roadmap". Run the
  **Explore-mode loop** below. (Bootstrap, above, ends here.)
- **Clear mode**: user asked you to "clear the refactor roadmap",
  "wipe the backlog", "reset the roadmap", "start the roadmap
  fresh". Run the **Clear-mode loop** below.

If the user is ambiguous ("can you clean up the codebase?"), ask
which mode they want before doing anything. The cost of guessing
wrong is a PR pointed at the wrong outcome.

## Work-mode loop

### 1. Open the roadmap and pick a candidate

```sh
$EDITOR docs/refactoring-roadmap.md
```

Look at **Pending**. Pick the **highest-severity** item the current
session can plausibly land in one PR. Tie-break:

1. **Architectural blockers first** (severity 9–10). These gate
   future work — a broken dependency direction (domain/ reaching
   into ui/, storage/, or app/) or a `StorageAdapter` that can't
   stay interchangeable blocks everything downstream; everything
   else can wait.
2. **Easy wins** at any severity (mechanical moves, helper
   extractions with N≥3 call sites, type-only edits). The roadmap
   has an explicit "Easy wins" list at the bottom of Pending.
3. **Severity 7–8 multipliers** next.
4. **Severity 5–6 friction** if the harder bands are blocked or
   already in flight on another branch.
5. **Severity 3–4** opportunistically — usually as a drive-by while
   touching the file for other reasons.

If you can't pick one — e.g. every remaining 9-band item requires
smoke-testing a cloud backend (Dropbox / Google Drive OAuth) you
can't reach in this environment — tell the user, surface the
constraint, and ask whether to drop to a lower band or do an
Explore-mode sweep instead.

### 2. Re-verify before touching code

The roadmap goes stale between sweeps. Confirm the candidate is
still real:

```sh
# Line counts shift; the severity rubric reads them as a proxy for
# "size of the affected surface". Refresh the count for any file
# the candidate names. The 1000-line cap (§20.5 of OSS_SPEC.md) is
# a hard signal here.
wc -l <files-the-candidate-touches>

# Grep for the exact smell shape — a candidate that called out
# "domain/ reaching into storage/" can quietly evaporate if an
# earlier PR cut the import. Don't take the roadmap's word for it;
# re-read the file.
grep -n '<the-pattern>' <files>
```

If the smell has shrunk meaningfully (e.g. file dropped well under
1000 lines, the duplication is now at 2 call sites instead of 8),
**re-rate** before doing anything. A candidate that drifts from
7/10 to 3/10 may still be worth landing but the plan probably needs
updating too. If it drifts to 1/10, move it to **Investigated and
skipped** with "smell decayed naturally — re-evaluate if N call
sites grow again" and stop.

### 3. Land the refactor

Follow the per-candidate **Plan** in the roadmap as the starting
point, but the plan is allowed to be wrong — if you discover a
better seam while reading the code, use the better one and amend
the roadmap entry in the same PR so the next agent sees the
corrected shape.

Refactor rules:

- **No behaviour changes.** Pure refactors. A refactor PR that
  also adjusts UX is two PRs in a trench coat — split it.
- **Respect the layering.** The dependency direction is
  `app → ui → domain` and `app → storage → domain`. Nothing in
  `src/domain/` may import from `ui/`, `storage/`, `app/`, or touch
  `window`, `document`, or `fetch` — this is a lint-enforced hard
  invariant that keeps `domain/` portable to the planned React
  Native app. A refactor must never move code in a way that crosses
  these edges; if a candidate seems to require it, it's a
  feature/design change, not a refactor — stop and flag it.
- **Hold the line on size**: each refactor PR should aim for
  <500 lines of diff. The roadmap entry may describe a larger end
  state; that's fine, but ship it as a sequence of small PRs each
  of which leaves the code working. Splitting a file that breached
  the 1000-line cap into cohesive sibling modules, one PR per seam,
  is the model.
- **Run the linter and tests.** `make lint && make test` before
  opening the PR. Note that `make lint` is `eslint . && tsc
  --noEmit` — the typecheck is folded into lint; there is no
  separate `make typecheck`. Tests are Vitest only (`make test` is
  `vitest run`); there is no e2e / Playwright layer.
- **Always evaluate the refactor for new tests, and leave coverage
  better than you found it.** A refactor is the moment the code is
  most malleable, so it's the cheapest time to close a coverage gap.
  `src/domain/` is the layer that must stay covered — it's pure, so
  the tests are cheap. Before opening the PR, ask three questions of
  every seam you touched and act on the answer in the **same** PR:
  1. **Did the refactor expose previously-untestable logic?**
     Extracting a pure helper, splitting a module, or introducing an
     injectable seam (a passed-in `StorageAdapter`, a clock, a fetch
     impl) almost always means a unit that was unreachable before is
     now directly callable. Add the tests that the new seam makes
     possible — that exposed testability is a deliverable of the
     refactor, not a follow-up.
  2. **Is the behaviour you're relocating covered?** A pure refactor
     must not change behaviour, and the cheapest proof is a test that
     passes both before and after. If the code you're about to move
     has no test pinning its behaviour, **write that test first**
     (against the pre-refactor code), confirm it's green, then
     refactor under it. Untested code is not safe to move silently.
  3. **Can you make the code more testable as part of the move?**
     Prefer the seam that takes its dependencies as arguments over
     the one that reaches for a global; prefer a pure function over
     one that reads the clock or the DOM. Pushing logic down into
     `src/domain/` (where it's pure and trivially testable) is itself
     a legitimate refactor goal — if a candidate is hard to test
     because of how it's wired, rewiring it for testability (then
     testing it) is the refactor.

  Run a coverage pass (`npx vitest run --coverage`, installing
  `@vitest/coverage-v8` if absent) over the files you touched and
  confirm the numbers went up, not down. A refactor PR that leaves
  coverage lower than it found it — because it moved logic out from
  under the tests that were pinning it — is a regression, not a
  cleanup.
- **Smoke-test the storage hot path manually for storage-layer
  refactors.** The OAuth / cloud flows (Dropbox, Google Drive) have
  **no automated coverage**, so any refactor touching the
  `StorageAdapter` backends or the `encrypting/` / `cache/` wrappers
  must be exercised by hand against the local (this-device) default
  plus whichever cloud backend the change touches before merging.
  The roadmap calls these out explicitly because Vitest can't reach
  the OAuth flow.

### 4. Update the roadmap in the same commit

Edit `docs/refactoring-roadmap.md` to reflect the new state:

- **Move the row from Pending to Landed.** One-line summary plus
  the date (`YYYY-MM`). If the change shipped as a multi-PR plan
  and only step 1 landed, leave the candidate in Pending with the
  scope narrowed (mark step 1 done, describe step 2's remaining
  shape).
- **If the smell decayed mid-refactor** — e.g. you discovered the
  problem is smaller than the roadmap claimed — drop the severity
  in the moved row and note "narrower than expected" in the
  Landed line.
- **If you discovered a related smell while reading the code**,
  add a Pending row in the right severity band. Don't fix it in
  the same PR.

The roadmap edit is **part of the refactor PR**, not a follow-up.
A PR that lands the code change without updating the roadmap will
silently re-propose the same work on the next sweep.

### 5. Write the changeset / changelog fragment

A refactor PR is rarely user-visible — by definition there should
be no behaviour change. Invoke the `write-changeset` skill anyway;
its decision tree handles "pure refactor with no user-visible
effect" by labelling the PR `no-changelog`. Don't try to write a
changelog fragment for a refactor.

### 6. Stop when Pending is empty

If Pending has no rows left (across every severity band), the
refactor sweep is **done**. Don't invent new items to keep going.
Tell the user the backlog is empty and recommend either:

- moving on to feature work (a clean roadmap is the whole point —
  the layering is honest and the next UI surface, storage backend,
  or namespace feature has a clean runway); or
- running this skill in **Explore mode** to look for new smells
  that emerged since the last sweep.

## Explore-mode loop

This mode extends the roadmap. The cost of a bad refactor is high;
the cost of a bad roadmap entry is low (it just sits in Pending
until someone re-rates it). So Explore mode is more permissive
about flagging — but every entry gets a rating, a file path, and a
sentence explaining **why it has leverage** (it blocks future work,
or every new storage backend / UI surface threads through it). No
ratings-by-vibe.

### 1. Read the roadmap first

Before exploring, skim the existing Pending / Landed / Investigated
lists so you don't re-propose what's already there. **Investigated
and skipped is especially important** — it tells you the smells
that look real but were rejected on closer reading, and the
reasoning that rejected them. Don't re-propose a skipped item
unless you can explain what changed (e.g. the call-site count
grew, the divergent semantics finally converged).

### 2. Pick a survey angle

You can't audit everything in one session. Pick a frame and stick
to it:

- **Largest files first.** `find src -name '*.ts' -o -name '*.tsx'
  | xargs wc -l | sort -rn | head` — read each large file with the
  rubric in mind. Anything approaching the **1000-line cap**
  (§20.5 of OSS_SPEC.md) without an `oss-spec:allow-large-file:`
  opt-out is a standing candidate to split by concern.
- **Per-layer audit.** Read every file in one layer at a time:
  - `src/domain/` — **purity.** Pure functions over the note model
    (`note.ts`) and the dependency-free Markdown parser
    (`markdown.ts`) only. No DOM, no I/O.
    `grep -rn "from.*['\"].*\(ui\|storage\|app\)" src/domain` —
    **any hit violates the domain-purity rule** and is at least a
    multiplier. Also grep for `window`, `document`, `fetch` inside
    `src/domain/`.
  - `src/storage/` — **interchangeability.** Anything added to one
    backend must work for every backend (local default in
    `src/storage/local/`, folder, Dropbox, Google Drive — all over
    the byte-level `StorageAdapter` in `src/storage/adapter.ts`,
    optionally behind the `encrypting/` and `cache/` wrappers) or be
    expressed as a capability the UI can feature-detect. Logic that
    lives in one adapter but should be shared (the shared
    `markdown/codec.ts` and `directory-adapter.ts` are where the
    file backends pool it), or a `StorageAdapter` contract that one
    adapter quietly diverges from, is a smell.
  - **Persisted-note shape & migrations.** The serialize/migrate
    pipeline (`src/storage/serialize.ts`, `src/storage/migrations.ts`)
    runs on every load/save so backends only move bytes. A refactor
    here must be a pure rename/relocation; any actual change to the
    stored shape needs a migration step and is a feature, not a
    refactor. Audit for migration steps that duplicate logic, or
    parse/validate code that should live in `serialize.ts` leaking
    into individual adapters.
  - `src/ui/`, `src/app/`, `src/pwa/`, `src/theme/` — look for
    domain rules leaking into presentational code, duplicated logic
    across sibling components, and note-model parsing that belongs
    down in `src/domain/`.
- **Direction-of-dependency check.**
  `grep -rn "from.*['\"].*\(ui\|storage\|app\)" src/domain` — any
  hit is a real smell because the layering forbids it. Confirm the
  broader direction (`app → ui → domain`, `app → storage → domain`)
  holds.
- **Cross-cutting patterns.** Grep for repeated boilerplate (JSON
  `parse → cast` pairs, duplicated encode/decode helpers, inline
  Markdown-shape handling, hardcoded user strings). For each
  pattern, report N≥3 example files with line numbers.
- **Type-safety holes.** `grep -rn "as any\|as unknown
  as\|@ts-ignore\|@ts-expect-error" src/` — each hit is at least
  severity 3.
- **AGENTS.md rule sweep.** Pick one cross-cutting rule and grep
  for violations: domain/ purity; storage interchangeability across
  every backend; **no third-party network calls** beyond the app's
  own origin and the opt-in Dropbox / Google Drive APIs (grep for
  `fetch(` / URLs and confirm every call is to an allowed origin and
  gated on the user choosing that backend); the 1000-line cap.

Delegate broad sweeps to `Agent(subagent_type: "Explore")` with a
self-contained brief — Explore-mode surveys produce a lot of file
reads, and the parent context shouldn't carry every excerpt.

### 3. Rate each finding 1–10

Use the rubric in the roadmap:

| Band | What to look for                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9–10 | Architectural blocker. Correctness / persistence risk, a broken layering edge, a domain-purity violation, or a `StorageAdapter` divergence every backend bumps into. |
| 7–8  | Multiplier. Local today; every new storage backend / UI surface / namespace feature threads through it.                                                       |
| 5–6  | Friction. Slows iteration; readers stumble. Worth landing soon.                                                                                               |
| 3–4  | Nit with leverage. Cheap to fix; alternative call-sites would multiply if left alone.                                                                         |
| 1–2  | Cosmetic. Don't add to the roadmap; if it ever bothers anyone enough to want to fix it, it'll re-surface.                                                      |

For each finding ≥3, write a row into Pending with:

- **The file path(s)** with current line counts.
- **The smell shape** — one or two sentences, concrete enough that
  a future agent can re-verify by running a grep.
- **The plan** — what the fix looks like. Doesn't have to be the
  final answer; the next agent will re-evaluate. Just enough to
  show the work isn't unbounded.
- **The risk** — what could go wrong, what must be smoke-tested
  (e.g. the cloud backends, which have no automated coverage; a
  persisted-shape round-trip through serialize/migrate), whether
  it's a multi-PR plan.
- **The rating**, in bold, at the end of the prose: `**Severity:
  N.**`

Place the row in the right severity band. If the row crosses
bands (e.g. a 7-rating that also contains a 4-rated "easy partial
fix"), keep it in the higher band but note the partial fix
inline.

### 4. Skip findings that fail the rubric

If a finding rates below 3, **don't** add it to Pending. It's
either:

- already there in spirit (re-read Pending and confirm), in which
  case do nothing;
- a real cosmetic concern, in which case mention it in the PR
  body and drop it.

If a finding rates 3 but you can't articulate why it has leverage
(blocks future work, or every new backend / UI surface threads
through it), the rating is probably wrong. Re-rate honestly. A
roadmap full of inflated 3s makes Work mode wander; a roadmap with
10 honest items is more useful than one with 40 aspirational ones.

### 5. Don't fix in Explore mode

Explore mode opens a PR that **only** edits
`docs/refactoring-roadmap.md`. The code stays the same. Work mode
handles the code on a subsequent pass.

The reason: a fix landed in the same PR as the discovery means
the discovery wasn't peer-reviewed before someone acted on it.
The two-PR rhythm forces a sanity check.

### 6. Stop after one survey angle

Explore mode is a **bounded sweep**, not an open-ended scan.
Pick one survey angle (step 2), exhaust it, write the findings,
open the PR. Don't try to do every angle in one session — that's
how Pending lists accumulate redundant rows and lose focus.

If the codebase is rich enough that the chosen angle yielded 10+
findings, the PR is large enough; ship it and let a future
session pick the next angle. If the angle yielded zero
findings (the layer is clean), say so in the PR body and pick a
different angle next time.

## Clear-mode loop

Clear mode resets the roadmap's **findings** back to the empty,
freshly-bootstrapped shape so a fresh sweep can start from a clean
slate. The user reaches for it when the backlog has gone stale
wholesale — the tree moved out from under it, a big refactor
invalidated the lot, or they just want to re-derive the queue from
scratch rather than re-verify rows one at a time.

### 1. Confirm before wiping — clearing is destructive

The roadmap is more than a TODO list. Clearing it discards:

- the **Pending** queue (the catalogued, rated smells);
- the **Landed** history (the record of what was already fixed
  and when); and — most consequentially —
- the **Investigated and skipped** reasoning, which is what stops
  future Explore sweeps from re-proposing smells that were already
  examined and deliberately rejected.

Git history preserves the old file, so nothing is truly lost — but
the *working* roadmap loses it, and the next agent reads the
working file, not the git log. Before wiping, **state what's about
to go** — the row counts in each of the three lists — and confirm
with the user, unless they were already explicit ("yes, wipe the
whole roadmap"). Use `AskUserQuestion` if there's any doubt.

If only part of the roadmap has gone stale (e.g. Pending is
obsolete but Landed and Investigated are still worth keeping), that
is **not** a full clear — say so and offer to clear only Pending,
or to handle the stale rows individually via Work / Explore mode
instead. A full clear is the right tool only when the user wants a
genuine blank slate.

### 2. Reset the file to its bootstrap shape

Rewrite `docs/refactoring-roadmap.md` to exactly the post-bootstrap
state described under **Bootstrap** above:

- **Keep the scaffolding** — the strategic-context intro and the
  severity rubric. These are the *framework*, not findings, and
  they give the next Explore sweep its leverage lens. (If the user
  wants a truly fresh start that also re-derives the strategic
  context — e.g. the churn analysis is years stale — re-run that
  analysis as part of the clear and rewrite the intro; otherwise
  leave it intact.)
- **Empty the three finding lists** — leave **Pending** (with its
  severity-band sub-headings and the "Easy wins" carve-out at the
  bottom), **Landed**, and **Investigated and skipped** present but
  empty. An empty Pending is a valid terminal state: Work mode
  reads it as "backlog clean, stop".

### 3. Offer a fresh Explore

A cleared roadmap is an empty roadmap, so the natural next step is
to repopulate it. Ask the user whether to chain a fresh Explore:

- **If yes**: switch to the **Explore-mode loop** above, pick one
  survey angle, and write its findings into the now-empty Pending.
  This is the one case where two modes share a PR — the clear and
  the re-explore are one logical "reset and re-survey" operation.
  Still hold to one survey angle (Explore step 6); a fresh roadmap
  doesn't license auditing everything at once.
- **If no**: stop. Leave Pending empty and tell the user the
  roadmap is now blank — the next run can Explore to repopulate it,
  or they can do feature work on a clean runway.

### 4. One PR, roadmap-only

The clear (and any chained Explore) edits **only**
`docs/refactoring-roadmap.md` — no code changes, same as Explore
mode. Invoke `write-changeset`; a roadmap reset is not user-visible,
so it lands `no-changelog`.

## What this skill explicitly does NOT do

- **Doesn't refactor code that isn't on the roadmap.** If you see
  something during Work mode that looks like a smell but isn't on
  the list, switch to Explore mode behaviour for that finding:
  add it to Pending with a rating, then return to the original
  Work-mode candidate. Don't sneak in unrelated cleanup.
- **Doesn't introduce new abstractions speculatively.** "We might
  need this when a new backend lands" is not a reason to extract an
  abstraction now. The roadmap captures **observed** smells with
  evidence; if the smell isn't visible yet, wait. AGENTS.md's "no
  features beyond what the task requires" applies to refactors too.
- **Doesn't change persisted-note shape semantics.** If a refactor
  touches the note model that `src/storage/serialize.ts` /
  `migrations.ts` persists, it must be pure renaming /
  module-relocation; any actual change to a stored shape needs a
  migration / compatibility step and is a feature, not a refactor.
  Put it in the PR description and stop.
- **Doesn't keep going past an empty Pending list.** When the
  backlog is clean, the next action is **feature work**, not
  inventing more refactors. Tell the user the backlog is empty and
  stop.
- **Doesn't bundle items.** Each PR carries one roadmap row. The
  one-row-per-PR discipline is what makes the rollback story
  cheap and the review surface small. (Clear mode is the lone
  exception: a clear plus its chained re-explore are one logical
  operation in one PR.)
- **Doesn't clear the roadmap silently.** Clear mode wipes the
  Landed history and the Investigated-and-skipped reasoning, not
  just Pending — so it confirms what's about to be lost before
  rewriting the file, and never destroys that history as a
  drive-by during Work or Explore mode.

## Common pitfalls

- **Forgetting to re-verify line counts.** A candidate flagged at
  1100 lines may now be 600; the severity drops accordingly. The
  rubric reads line counts as a proxy for blast radius (and the
  1000-line cap as a hard signal) — refresh them at pickup, not at
  the original sweep.
- **Refactoring the easy win when the architectural blocker is
  on the same file.** If a storage adapter needs both a contract
  fix (severity 9) and a comment cleanup (severity 1), do the
  contract fix. Bundling the comment cleanup into the same PR is
  fine; bundling 10 separate "easy wins" while leaving the blocker
  is a procrastination pattern.
- **Treating Investigated-and-skipped as a TODO list.** Those
  items were rejected for a reason. Re-read the reason before
  proposing them again. If the reason no longer applies, edit the
  Skipped entry to explain what changed and move it back to
  Pending.
- **Letting Explore mode become a refactor mode.** The PR opens,
  the rating gets written, and then the agent decides to "also
  fix it while it's here". That's a Work-mode PR, not an
  Explore-mode one. Discipline matters: one PR, one purpose.
- **Inflating severity to justify doing the work.** If the
  smell is a 3 and the rubric says "land opportunistically",
  resist the urge to round up to 5 to make it feel urgent. The
  ratings are how the next agent decides what's worth their
  time; inflating them devalues the signal.
- **Moving logic out from under its tests.** Splitting a file or
  relocating a function can orphan the tests that were covering it,
  or land the logic in a spot the existing tests no longer reach.
  Re-point (or re-add) the tests in the same PR and confirm coverage
  for the touched files didn't drop — a refactor that quietly lowers
  coverage has traded a code smell for a worse one.
- **Treating "add tests" as a separate follow-up PR.** When a
  refactor exposes a newly-testable seam, the tests belong in the
  refactor PR. Deferring them means the next sweep sees green CI over
  untested code and assumes it's covered.

## Skill self-improvement

After a run:

1. If a new survey angle was useful in Explore mode (e.g. "grep
   for `fetch(` to audit the no-third-party-network rule", "diff
   the migration steps for duplicated parse logic"), add it
   to the "Pick a survey angle" list above so the next agent
   doesn't have to reinvent it.
2. If a class of finding consistently rates the same (e.g. every
   domain/ purity violation ends up at 8), capture the pattern in
   the roadmap's severity rubric so the next agent doesn't have to
   derive it.
3. If a refactor exposed an unexpected risk (broke a storage
   backend, a persisted-note round-trip through serialize/migrate,
   a domain invariant), document the risk in the roadmap's plan
   column so the next agent following that plan knows what to
   smoke-test.
4. Commit the skill edit alongside the substantive PR — drift on
   the skill itself is the same kind of error this skill prevents.
