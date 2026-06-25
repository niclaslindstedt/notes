# Refactoring roadmap

The single source of truth for what this codebase considers a code smell
worth fixing. It is maintained by the `refactor` agent skill
(`.agent/skills/refactor/`), which works it in three modes — **Work**
(land the highest-leverage pending item), **Explore** (survey for new
smells and append them), and **Clear** (reset the findings to a blank
slate).

## Strategic context — why these smells matter

`notes` is a local-first PWA with **no backend**. Its leverage comes from
keeping the layering honest so new surfaces stay cheap to add:

- **Honest dependency direction.** `app → ui → domain` and
  `app → storage → domain`. Nothing in `src/domain/` may import from
  `ui/`, `storage/`, or `app/`, or touch `window` / `document` / `fetch`
  — a lint-enforced invariant that keeps `domain/` pure and portable to
  the React Native app under `native/`. Any violation is an architectural
  blocker.
- **Interchangeable storage backends.** Every backend (local default,
  folder, Dropbox, Google Drive) is a `StorageAdapter` moving bytes
  (`src/storage/adapter.ts`), optionally behind the `encrypting/` and
  `cache/` higher-order wrappers. Logic that should be shared but lives in
  one adapter, or a contract one adapter quietly diverges from, breaks the
  interchangeability that lets a new backend drop in.
- **A stable persisted shape.** The serialize/migrate pipeline
  (`src/storage/serialize.ts`, `migrations.ts`) runs on every load/save so
  backends only move bytes. Refactors here must be pure relocation; any
  change to the stored shape is a migration — a feature, not a refactor.
- **Easy-to-add UI surfaces and namespace / Markdown features.** Large,
  multi-concern files and duplicated logic raise the cost of every new
  list view, settings section, namespace capability, or Markdown token.

A clean roadmap means the layering is honest and the next UI surface,
storage backend, or namespace feature has a clean runway.

## Severity rubric

Rate every finding 1–10. **3 is the fix threshold**; below 3 it does not
go on the list. Mechanical, zero-risk transforms (a rename, a helper
extraction with N≥3 call sites, a type-only edit) are **easy wins** — land
them at any severity when touching the file anyway.

| Band | What to look for                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9–10 | Architectural blocker. Correctness / persistence risk, a broken layering edge, a domain-purity violation, or a `StorageAdapter` divergence every backend bumps into. |
| 7–8  | Multiplier. Local today; every new storage backend / UI surface / namespace feature threads through it.                                                       |
| 5–6  | Friction. Slows iteration; readers stumble. Worth landing soon.                                                                                               |
| 3–4  | Nit with leverage. Cheap to fix; alternative call-sites would multiply if left alone.                                                                         |
| 1–2  | Cosmetic. Don't add to the roadmap; if it ever bothers anyone enough to want to fix it, it'll re-surface.                                                     |

Patterns observed to rate consistently (capture them so the next agent
doesn't re-derive):

- A non-test source file **over the 1000-line cap** (OSS_SPEC §20.5) with
  no `oss-spec:allow-large-file:` opt-out is a standing split-by-concern
  candidate. Severity tracks how far over the cap and how many distinct
  concerns are tangled — multi-concern files near 2× the cap land in the
  7–8 band; a modestly-over file with clean internal seams sits at 5–6.

---

## Pending

### Severity 9–10 — architectural blockers

_(none)_

### Severity 7–8 — multipliers

_(none)_

### Severity 5–6 — friction

_(none)_

### Easy wins

_(none)_

---

## Landed

_(none yet — history before this reset lives in git; see the
`refactor(...)` / `feat(...)` commits and prior revisions of this file.)_

---

## Investigated and skipped

- **2026-06 — `directory-adapter.ts` (1250 lines, over the §20.5 cap):
  re-evaluated, no clean further seam — left as the cohesive sync core.**
  This file has already been split four times — `crypto-session.ts`,
  `folder-registry.ts`, `attachment-reconcile.ts`, `enc-note-codec.ts`, and
  `migration-converters.ts` were each extracted out of it. The residual is the
  load / save / plan / conflict-detection / index-sync core, where every concern
  threads through the others (`save` → `plan` → `writeFiles` → `verifyEncrypted`;
  the encrypted-load index fast-path, deferred-note tracking, and the
  representation-switch atomicity all share the same closure state), so there is
  no concern that lifts out cleanly without a wide, leaky deps bundle. The file
  is ~250 over the cap but a forced split here would trade a tolerable
  large-but-cohesive file for two artificially-coupled modules — a worse smell.
  The +55-line growth since the last measurement (1195 → 1250) is PR #163
  ("make encrypted unlock resilient to a flaky index"), a resilience fix *inside*
  the existing index-sync concern, not a new separable one. **Re-evaluate if** a
  genuinely new concern accretes (e.g. a second sync strategy, a new
  representation), or the file grows materially past ~1350 — not on line count
  alone. **Severity 1** as a split candidate (cohesive); do not force the split.
