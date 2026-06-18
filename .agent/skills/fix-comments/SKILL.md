---
name: fix-comments
description: 'Use when the user wants comments cleaned up, or whenever you''re about to touch a file whose comments narrate history instead of explaining current invariants. Removes or rewrites changelog-style comments ("previously", "the legacy behaviour", "see the plan", "used to re-scan", PR-number references, wiring narratives) while preserving comments that explain WHY current code is the way it is — especially "don''t try X, it doesn''t work" anti-pattern guards.'
---

# Fixing changelog-style comments

This is an AI-first codebase with no human coders. Comments exist
to **help the next agent reason about current code**. Comments
that narrate history (what the code used to do, which PR added a
field, why the old approach was slow) do the opposite: they
describe state that no longer exists, and the next agent has to
spend tool calls confirming whether the narrative still matches.

The job is to rewrite or delete those, while keeping the comments
that explain WHY current code is shaped as it is. The bar is "if
this comment were removed, would the next agent be confused?" —
not "is this comment factually accurate?".

## When to invoke

- User says "clean up comments", "fix the changelog-style
  comments", "the comments in X are stale".
- You're already editing a file and notice the comments are full
  of "previously" / "now" / "see the plan" framing. Land the
  rewrite in the same PR as the substantive change so the diff
  doesn't grow a follow-up.
- A grep across `src/` for "previously" or "used to" turns up
  more than a handful of hits. The skill is then a focused sweep,
  not a project-wide rewrite — pick one module at a time.

Do **not** run this as a standalone "tidy the whole codebase"
operation. The diff balloons, review is hard, and you'll burn
the user's autonomy budget on a low-stakes change. Scope it.

## Comment taxonomy

### REMOVE — changelog-style

These describe past states or off-tree context. They rot the
moment the surrounding code changes.

- **Past-state framing**: "Previously this did X", "used to
  re-tokenize the whole body", "the legacy behaviour", "before this
  fix", "the original implementation", "the prior version".
- **Perf comparison against the deleted approach**: "Trades two
  O(N log N) sorts for one", "without this the parser ran
  O(K × R)". The current complexity is in the code; the
  comparison is in commit history.
- **Off-tree decision context**: "see the plan", "from the design
  discussion", "the user explicitly wanted X", "worked out with
  the user", "per AskUserQuestion during planning".
- **PR / issue references**: "fixed #339", "see PR #620", "added
  in 2b5bf81". Git log has this.
- **Wiring narratives**: "Wired the new toggle through
  `Settings.foo`", "Added so the install prompt can …", "Lifted
  out of the local backend so every `StorageAdapter` can reuse
  the same merge helper" — the second half is fine (states the
  current contract), the "lifted out of" half is history.
- **Field-genealogy comments**: "Renamed from `bar`", "merged
  from `setX` + `setY`", "split from the old single function".

### KEEP — current-invariant

These tell the next agent something they wouldn't infer from the
code alone, and are still true.

- **WHY a non-obvious choice was made**: "Notes are keyed by a
  per-slug `localStorage` key, never a shared one — the default
  namespace keeps the historical root key", "null is the
  explicit-clear signal, undefined is `never set`", "the sort
  must be stable because ties depend on insertion order".
- **Hidden constraints and invariants**: "This module is in
  `domain/` — it must stay pure: no DOM, no `fetch`, no imports
  from `ui/` or `storage/`, so it stays portable to React Native",
  "every `StorageAdapter` method must resolve even when the remote
  is offline — callers don't re-check", "this regex assumes `^…$`
  anchors elsewhere".
- **Magic-number rationale**: "Debounce the save at 300 ms — any
  shorter and a fast typist thrashes the folder backend's file
  writes".
- **Anti-pattern guards** ("don't try X — it doesn't work
  because Y"): keep these even if they read like history,
  because they save the next agent from re-doing a failed
  experiment. Examples: "Do not call `skipWaiting()` /
  `clientsClaim()` from the service worker — the app uses the
  `prompt` update model on purpose; auto-activating the waiting
  worker reloads the page mid-edit and can lose unsynced
  changes", "Do not refactor this to `Array.from(entries)` — the
  iterator is consumed by the caller before this returns".
- **Counter-intuitive contracts**: "Returns the same reference
  when nothing changed so the render diff is a no-op", "an empty
  array means `clear`, undefined means `don't touch`".
- **Cross-file invariants**: "Migrations run in array order on
  every load/save — append new steps, never reorder, or an older
  document upgrades through the wrong path", "Mirrors the token
  set the renderer in `markdown.ts` walks — keep the tokenizer and
  renderer in sync or a block type silently stops rendering".

### REWRITE — keep the substance, drop the framing

Most "changelog" comments contain a useful WHY tangled with
historical framing. Rewrite to preserve the WHY.

- ❌ "Tokenize the body block-by-block. Previously we
  `split('\n')` the whole string and re-scanned it per line, which
  was O(N²) on big notes; this walks once so `parseMarkdown`
  stays O(N)."
- ✅ "Tokenize the body block-by-block in one walk so
  `parseMarkdown` stays O(N) on large notes."

- ❌ "Cap the iteration to prevent runaway in pathological
  inputs. This was added after a note with thousands of list items
  hung the parser; keeps the worst case bounded regardless of
  input size."
- ✅ "Cap the iteration so a pathological input can't run away."

- ❌ "With the default local backend the adapter collapses to a
  synchronous read — the legacy behaviour kept for callers that
  don't await."
- ✅ "With the local backend the read resolves synchronously."

The rule: if you'd write the comment this way from scratch, with
no prior version to compare to, that's the version that belongs
in the code.

### Inline noise — usually remove

Inline comments that just narrate the next line ("Fallback:
nothing found (shouldn't happen)") rarely earn their keep. If the
function name and the surrounding two lines make the intent
obvious, delete the inline. If they don't, the comment is
probably trying to compensate for an unclear name — fix the name
instead.

## Operating procedure

### 1. Pick a scope

One module at a time. `src/domain/markdown.ts` is a scope.
`src/domain/` is not. The diff for a single module is reviewable;
the diff for a directory is not.

If the user gave you a specific scope, use it. If they said
"clean up the comments", pick the most-changelog-y file you
already have open or noticed during another task — don't go
hunting.

### 2. Survey the file

Read the whole file first. List every comment that smells
changelog-y in your head before editing anything. This catches
two patterns the per-comment view misses:

- **Linked comments** — the header comment explains the rule,
  three helper comments reference "the rule" by name. If you
  rewrite the header without updating the helpers, the helpers
  become dangling references.
- **Redundant comments** — two comments saying the same WHY
  three functions apart. Pick one to keep, kill the other.

### 3. Apply the taxonomy per comment

For each candidate:

1. Is this a **current-invariant** comment with no historical
   framing? **Keep verbatim.**
2. Does it contain an **anti-pattern guard** ("don't try X")?
   **Keep**, even if it reads like history — the warning is
   forward-looking. If it's wrapped in historical framing,
   trim the framing but keep the warning.
3. Is it **pure history** (past-state, perf-comparison,
   wiring narrative, off-tree reference)? **Delete.**
4. Does it mix WHY + history? **Rewrite** to preserve the WHY
   without the framing. The rewrite test: if you didn't know
   the old version existed, would this comment make sense?

### 4. Don't touch what you don't have to

A small targeted rewrite is more valuable than a sweeping one:

- Don't reformat unchanged paragraphs to "improve flow"
- Don't rewrap lines unless prettier asks for it
- Don't shorten a comment that's already current-invariant just
  because it's long
- Don't add comments. Removing > adding. If a comment isn't
  there, the next agent reads the code; if a comment is there
  and is wrong, the next agent reads it AND the code.

### 5. Verify

```sh
make fmt-check && make lint && make test
```

Comments don't change behaviour, so a green fast loop is the
full safety net. `make lint` runs `eslint . && tsc --noEmit`, so
the typecheck is folded in — there is no separate `make
typecheck`. If you also moved code (a guard reorder, a function
extracted to remove a "lifted out of" comment), `make build`
catches any surface tsc skipped.

### 6. Commit

Conventional commit: `docs(<scope>): tighten comments to current
invariants` or `chore(<scope>): drop changelog-style comments
from <file>`. Body should say what _kind_ of comments were
removed (past-state, perf-comparison, wiring narratives) so the
PR title isn't a mystery.

### 7. PR

Pure comment cleanup is `no-changelog`. Run the `write-changeset`
skill to confirm and apply the label. If you also landed a
substantive change in the same PR, the substantive change's
fragment-or-skip rule wins.

## Patterns to grep for

Coarse search across `src/` to find candidate files:

```sh
# Past-state framing
grep -rln "Previously\|previously\|used to\|the legacy\|the original\|before this" src/ | head -20

# Perf-comparison comments
grep -rln "without this\|instead of re-\|drops from O\|reduces O\|trades.*for\|previously paid" src/ | head -20

# Off-tree decision references
grep -rln "see the plan\|from the design\|worked out with\|AskUserQuestion\|the user wanted\|the user explicitly" src/ | head

# PR / issue numbers
grep -rEn "#[0-9]{2,4}\b" src/ | grep -v "^//\|\* " | head -20

# Wiring narratives
grep -rln "Wired \|Lifted out\|Captured.*flag\|Added so\|Routed through" src/ | head -20
```

The top hits are the files that benefit most from a sweep.
Don't run them all — pick one to start, gauge the value, decide
whether another is worth it.

## Pitfalls

- **Deleting an anti-pattern guard because it reads like
  history.** "Do not call `skipWaiting()` from the service worker
  — the `prompt` update model relies on the waiting worker staying
  parked until the user accepts the UpdateToast" sounds like a
  changelog entry but is actually a forward-looking warning. The
  test isn't "does this describe the past?" but "would the next
  agent regret not knowing this?".
- **Rewriting comments that are already current-invariant.**
  Save your edits for the comments that actually need them.
  The diff should focus reviewer attention on substantive
  changes.
- **Adding new "improved" comments.** The default is no
  comment. If a function is unclear, fix the name or
  structure — don't compensate with prose.
- **Sweeping across many files in one PR.** Cap at ~3 closely-
  related files per PR. Comment changes need a reviewer to
  read every comment to verify nothing important was dropped;
  bigger diffs get rubber-stamped.
- **Treating commit-message-style imperative comments as
  history.** "// Normalize the slug before keying the namespace so
  the same name always resolves to the same bucket" is fine — it
  states a current rule with WHY. The "before keying" is
  sequencing, not history.

## Self-improvement

If a recurring comment shape isn't covered by the taxonomy above,
add it. Example shapes already worth recording:

- **"Hot path: this runs on every keystroke. Two perf moves keep
  its per-edit cost bounded…"** — past-perf-comparison.
  The "hot path" framing is fine; the "Two perf moves" narration
  is history.
- **"Used by the local, folder, Dropbox, and Drive backends so
  they all …"** — caller-genealogy. Callers change; the comment
  doesn't. Delete or rewrite to state the _contract_ the callers
  depend on, without naming them.
