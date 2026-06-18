---
name: find-optimizations
description: "Use when the user asks for high-value performance optimizations in the notes app — order-of-magnitude wins in algorithms that matter, not micro-tuning. Surveys the hot paths (pure domain operations over notes, the live-preview Markdown parser called on every keystroke, storage serialize/migrate, per-render passes in the UI), presents candidates with complexity and trigger context for the user to gate the work, and is honest when the codebase has already been tuned and no high-value wins remain."
---

# Finding high-value optimizations

The job is **order-of-magnitude wins on algorithms that matter** —
not micro-optimization, not cleanup, not theoretical improvements
in cold paths. A successful run either lands a small number of
clear big-O improvements or reports honestly that the obvious wins
are already gone.

The skill is **survey-first**: present candidates to the user with
complexity and trigger context before doing work. The user gates
which ones land. Pure perf changes ship behind `no-changelog` —
they have no user-visible effect.

## When to invoke

- User says "find optimizations", "make this faster", "look for
  perf wins", "X feels slow".
- You opened a file and noticed an obvious hot-path quadratic loop
  with bounded inputs you could ship a fix for.

Do **not** run this proactively. It's an explicit user request — if
the codebase is already tuned, the right output is "nothing to do",
and that's only useful when the user asked.

## Honest framing first

Before any code search: **mature codebases often have no high-value
wins left**. The fast-loop check below tells you which kind of
codebase you're in — do it first, and tell the user honestly. A
"nothing to find" answer in 5 minutes is more valuable than a
fabricated 2x win in 2 hours.

Keep one more thing in mind for this app specifically: the realistic
input sizes are small. A user has dozens to a few hundred notes, and
a single note's `body` is a page or two of Markdown. Wins that only
matter at N = 100k will never fire here — demote them hard. The one
genuine exception is the **per-keystroke** path: even at a small N,
work that runs on every character the user types is felt as input
lag, so a quadratic there matters at sizes that look trivial.

## Triage in three passes

### Pass 1 — gauge how tuned the codebase already is (2 min)

Grep the source for evidence of prior optimization work:

```sh
grep -rln "WeakMap\|Map(\|memoize\|memoise\|useMemo" src/ | head -10
grep -rn "drops from O\|reduces O\|previously\|single-pass\|single pass" src/ | head -10
```

If the comments are full of complexity claims ("trades two sorts
for one", "drops from O(N²) to O(N)", "Map keyed on note id so the
lookup is O(1)"), the obvious wins are gone. Tell the user upfront —
don't promise three wins and then backtrack.

Signals that the easy work has been done:

- `Map` / `WeakMap` lookups keyed on note id instead of repeated
  `.find()`
- memoization caches on pure `src/domain/` transforms, or `useMemo`
  guarding a derivation in `src/ui/`
- precomputed indexes threaded through instead of rebuilt per call
- ref-equality dirty checks instead of deep/string compares

When you see these, set expectations down before searching further.

### Pass 2 — survey hot paths (15-30 min)

The places where wins matter, ordered by impact:

1. **The live-preview Markdown parser** — `src/domain/markdown.ts`
   (`classifyLines`, `parseInline`) is the single highest-value hot
   path. `MarkdownEditor.tsx` re-derives the parse on **every
   keystroke** (`useMemo(() => classifyLines(value), [value])`), so
   it runs once per character over the whole note body. A tokenizer
   that rescans from the start per line, an inline pass with an
   `indexOf` scan per character, or any accidental O(n²) over the
   body length is the canonical win here — it's felt directly as
   typing lag. Look for:
   - A cursor that fails to advance monotonically (a re-scan from 0
     inside the per-line or per-token loop).
     `grep -rn "indexOf\|slice\|substring" src/domain/markdown.ts`
   - Re-parsing the entire body when only the active line changed.

2. **Pure domain operations** — the functions in `src/domain/note.ts`
   (`noteTitle`, `notePreview`, `sortByUpdated`, `isBlank`) that
   transform the note model and the note list. These are called from
   the UI on user actions and sometimes on every render. Look for:
   - A `.find()` over notes inside a loop over a sibling collection —
     `O(N × M)` where a `Map` makes it `O(N + M)`.
     `grep -rn "\.find(" src/domain src/app src/ui`
   - A function the UI calls on every interaction that rebuilds a
     whole derived structure each time instead of guarding the
     common (no-op / partial-input) case with an early return.

3. **Storage serialize / migrate** — `src/storage/serialize.ts` and
   `src/storage/migrations.ts` run the serialize/parse/migrate
   pipeline on **every load and save**, behind the `StorageAdapter`
   contract (`src/storage/adapter.ts`). A parse/serialize that walks
   the whole note document more than once, or a migration that
   rebuilds the entire snapshot per note, is felt as a slow load or
   save. Note that autosave is debounced, so a one-off cost there is
   invisible — it's the per-document walk that matters.

4. **Per-render passes in the UI** — `src/ui/` code that walks the
   whole note list on every render to derive counts, ordering,
   titles, or previews. A slow derivation here blocks the paint.
   Look for sort comparators that build template-literal string keys
   per comparison, or `notePreview` / `noteTitle` re-run inside a
   render of each row when one memoized pass would do.

What to look for in each:

- **O(N × M) where M should be O(1)**: a `.find()` inside a loop
  over notes. Convert to a `Map`. Easy to spot:
  `grep -rn "\.find(" src/`
- **O(N²) over a string**: a parser cursor that rescans the body
  from the start per line/token. This is the markdown-parser failure
  mode and the one that actually bites at small N.
- **O(N log N) where O(N) would do**: `.sort()[0]` (use a single
  pass for max), `.filter().sort().at(-1)` (single-pass argmax).
- **Recomputed-per-interaction work**: a heavy derivation the UI
  calls on every keystroke or render. Either memoize on a stable
  input (`useMemo`), or guard with an early-return for the common
  case.
- **Allocation churn in tight loops**: template-literal string keys
  (`${a}|${b}`) rebuilt inside a comparator; fresh objects per note
  when one shared object would do.
- **Early returns AFTER expensive work**: a guard that bails on a
  partial / no-op input placed below the precompute that produced
  data the guard then throws away.

What to skip:

- **Bounded N**: a user's note count is dozens to low hundreds, and a
  note body is a page or two. A "fix" at N = 100k changes nothing the
  user will ever feel — *unless* it's on the per-keystroke parser
  path, where even small N matters.
- **Debounced paths**: storage autosave runs once per pause in
  typing. Even a 10x speed-up there is invisible.
- **Already-memoized paths**: a derivation cached on a tight input
  (a `useMemo` keyed on the body, a memoized domain transform) is
  already paying once-per-input. The work it does inside is rarely
  the bottleneck — unless the input itself changes per keystroke,
  which is exactly why the markdown parser is the exception.

### Pass 3 — verify each candidate (5 min per)

For each candidate that survives Pass 2:

1. **Find the call site(s)**. `grep -rn "<function>" src/`. If the
   function is only invoked from a debounced or one-shot path,
   demote the candidate — unless it's on the per-keystroke editor
   path, which is the opposite of debounced.
2. **Estimate N in practice**. The realistic worst case here is a
   user with a few hundred notes, and a single note body of a page
   or two. If the optimization saves work only at N the app will
   never reach, demote — again, the keystroke path is the exception.
3. **Confirm the current complexity by reading the code**, not by
   trusting the comment. Code drifts; the optimization claim in a
   comment may have been undone by a later edit.
4. **Sanity-check that the fix is simple**. Order-of-magnitude wins
   from a 5-line change are real; a rewrite of the markdown parser to
   a different architecture is not in scope. Skip anything that
   requires architectural change, and respect the dependency rules in
   `AGENTS.md` — `src/domain/` stays pure (no DOM, no I/O), so a
   "fix" that reaches into `window` or `storage` from domain code is
   out of bounds.

## Presenting candidates

Show the user a ranked list **before writing any code**. For each
candidate, give:

- `file:line` of the issue
- Current complexity (e.g. O(N²))
- Proposed complexity (e.g. O(N))
- What triggers the code (per render? per keystroke? per load? per
  save?)
- Realistic N
- One-sentence fix sketch

Also list the candidates you considered and rejected, with reasons.
This is how the user calibrates whether you actually looked or just
produced the most plausible-sounding wins. Be specific — "considered
the per-render `sortByUpdated` but the list is ≤200 notes, not orders
of magnitude" is a useful rejection.

End the presentation by saying clearly whether you found 1, 2, 3, or
0 candidates. **Don't pad the list.** A single real win is better
than three speculative ones; zero real wins is a valid answer the
user wants to hear.

## When the user approves the work

Standard fix loop:

1. **Make the minimum edit**. An order-of-magnitude win usually
   comes from a 1–5 line change (early-return reorder, `Map`
   substitution, advancing a parser cursor monotonically, a
   `useMemo`). If the patch is larger than that, you may be
   over-reaching.
2. **Run the fast loop locally**: `make fmt-check && make lint &&
make test && make build`. `make lint` already includes `tsc
   --noEmit`, so there is no separate typecheck step. Tests are the
   safety net — a perf change that breaks behaviour is worse than no
   change. The markdown parser is well covered under
   `tests/domain/markdown.test.ts`; lean on it.
3. **Commit with `perf(<scope>): <subject>`**. Mention what
   triggered the work and the complexity delta in the body. PRs are
   squash-merged, so the PR title must follow conventional-commit
   format too.
4. **Ship behind `no-changelog`** — pure perf with no user-visible
   behaviour change needs no changelog fragment. Run the
   `write-changeset` skill to confirm the call and apply the label.

If the fix changes any behaviour (different rounding, different
default, different fall-back), write a `Changed` or `Fixed`
changelog fragment instead (`.changes/unreleased/<unix-ts>-<slug>.md`).

## Pitfalls

- **Believing an Explore agent's "everything is optimized" report**
  without spot-checking. The agent reads excerpts and can miss
  things past its read window. Always read the top 2–3 candidate
  files yourself.
- **Counting 2x as a win**. Order-of-magnitude or skip. The user
  asked for high-value, not "any improvement".
- **Touching code with no measured cost**. Profile-blind
  optimization in a derivation that never showed up in a flame graph
  is wasted work. If the code looks slow but you can't show it being
  called frequently over a meaningful N, demote — with the standing
  exception of the per-keystroke markdown path, where frequency is a
  given.
- **Fabricating wins**. If pass 1 says the codebase is tuned, pass 2
  surfaces only candidates already optimized away, and pass 3
  demotes the rest, the answer is "nothing to do". Don't backfill
  the list with refactors-disguised-as-optimizations.
- **Sweeping into refactor territory**. "While I'm here, this
  function would read better as…" is a refactor, not a perf fix.
- **Over-caching at the cost of correctness or UX**. A cache that
  serves stale data after a user edit is worse than the slow
  function it replaced. If the optimization needs an invalidation
  contract you can't state in one sentence, skip it.
- **Optimizing one storage backend only**. A change in
  `src/storage/` must hold for every `StorageAdapter` backend
  (`local`, `folder`, Dropbox, Drive) and the `encrypting` / `cache`
  wrappers, or be a feature-detectable capability — see `AGENTS.md`.

## Self-improvement

After a run, if you found a recurring pattern (a hot-path function
the codebase calls a lot but the survey doesn't yet list), add it to
"Pass 2 — survey hot paths" above. The skill is the institutional
memory of where to look — letting it stay stale defeats the point.
