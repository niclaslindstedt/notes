---
name: debug-from-logs
description: "Use whenever the user pastes captured diagnostic output in a message — a browser console transcript, a stack trace with file:line:column locations, a failure block from `make test` / `make build` / `npm run dev`, or any timestamped or scoped log lines. Walks the trace from last-known-good to the failure, traces each suspicious line back to its source by greping the logged string, forms and verifies a root-cause hypothesis, and — critically — ends by evaluating whether the output was sufficient to diagnose the bug and adds the missing regression coverage or surfacing in the same change when it was not."
---

# Debugging from pasted diagnostics

Pasted diagnostic output is a primary debugging surface for this
app — a browser console transcript, a stack trace with
`file:line:column` locations, a failure block from `make test`,
`make build`, or `npm run dev`. When the user shares that output,
they've usually already reproduced the bug and the trace is what's
actionable. This skill is the playbook for turning that trace into
a fix without losing time guessing.

Three things distinguish this from generic "read the error and fix
it":

1. **Read the trace as a transaction.** Find the last successful
   operation, the first sign of trouble, and the terminal failure.
   The gap between the first two is where the bug usually hides.
2. **Treat diagnostic sufficiency as part of the deliverable.** A
   bug that was hard to diagnose from the pasted output is going to
   be hard to diagnose next time too. The final step of every run
   is to ask whether the output contained enough to find the bug,
   and to ship the missing regression coverage or real error
   surfacing in the same PR when it did not.
3. **Confirm the bug with a failing Vitest test before fixing it.**
   A reproduction under `tests/` makes "is the bug fixed?" a
   one-command answer (`make test`) instead of a manual
   click-around, and the same test becomes the permanent regression
   net once the fix lands.

## When to invoke

Invoke this skill the moment the user's message contains pasted
diagnostic output — even if they didn't say "debug this"
explicitly. Triggers include but are not limited to:

- A pasted browser console / devtools transcript.
- Stack traces with `file:line:column` locations.
- A failure block from `make test` (Vitest), `make build` (vite),
  or `make lint` (eslint + tsc).
- Output from `npm run dev` (the vite dev server) — startup errors,
  HMR failures, transform errors.
- Any multi-line block with `error:` / `fail:` prefixes, timestamps,
  or stack frames.

If the message has output **plus** an explicit "fix this", run the
skill — the explicit ask doesn't change the process. If you're
unsure whether something counts (e.g. a short single-line error
string), default to running the skill — the cost of going through
the checklist on a small payload is low.

Do **not** invoke this skill for:

- A request to instrument code or add diagnostics from scratch
  (without an existing failure to diagnose).
- A code-review pass where output is pasted as context but the user
  is asking about something other than a bug.

## Process

Walk these steps in order. Don't skip ahead — the early steps
constrain the search space for the later ones.

### 1. Frame what the user observed vs expected

Before reading the output, restate the symptom in one sentence:
what did the user do, and what was supposed to happen instead? The
trace will tell you which code paths ran; only the symptom tells
you which one was wrong.

If the user didn't say what they expected, ask once (briefly) and
proceed. The symptom anchors every later judgement about
"suspicious vs benign" lines.

### 2. Read the trace top-to-bottom once

Don't grep yet. Skim the whole paste so you have a mental picture
of the modules involved, the rough timeline, and where the output
turns from benign to error/stack. Note:

- **The last successful operation.** The most recent line that
  matches the symptom's "supposed to happen" path.
- **The first sign of trouble.** The earliest warning, error, or
  visibly anomalous line (unexpected branch, missing follow-up,
  unusual value).
- **The terminal failure.** The last line before the trace stops or
  starts looping.

The bug lives in the code path executed between the last success
and the first sign of trouble. The terminal failure is usually a
downstream symptom, not the root cause.

### 3. Trace each suspicious entry back to its source

For every interesting line, grep the codebase for the literal
message text or the symbol in a stack frame — a stable substring
narrows the call site immediately.

```sh
# Pin the call site from a stack-frame symbol or thrown message.
git grep -n "failed to migrate note document"

# Or, when the message has interpolated values, search a stable
# prefix or suffix.
git grep -n "unknown storage backend"
```

For each match, **read the surrounding 20–40 lines** — the
diagnostic value is in the control flow around the call (which
branch ran, which branch silently didn't, what happens next).

### 4. Identify silent gaps

A common shape: a `try { … } catch (err) { return; }` that swallows
the failure without re-throwing or surfacing it upstream. The trace
ends there because the rest of the system never finds out the
operation failed.

When the line that should follow an error is missing, that catch is
the gap. Note it — both as a candidate root cause and as a
candidate site for "step 7: insufficient diagnostics".

Other silent gaps to look for:

- An `await` missing on a Promise-returning call (common in the
  on-demand `dropbox` / `gdrive` storage adapters and the `cache`
  wrapper around them), so a rejection becomes an unhandled
  rejection that never reaches the console.
- A `catch` that swallows a non-`Error` value (a string, a rejected
  promise's reason that isn't an `Error`), so the stack frame shows
  only a file location and no description. Fix the throw site to
  raise a real `Error`.
- A code path that starts an operation but has no matching success
  or failure log — the operation went in and never came out.

### 5. Form a single hypothesis

State the root cause in one sentence, naming a file and a line
range. Examples:

- "`src/storage/serialize.ts:142` parses a value the snapshot
  schema declares as `string`, but a pre-v2 document stored a raw
  object, so `JSON.parse` throws on first load before the migration
  in `src/storage/migrations.ts` can normalise it."
- "`src/domain/markdown.ts:88` advances the tokenizer cursor by the
  matched-prefix length, but an unterminated inline span leaves the
  cursor un-advanced, so `classifyLines` loops forever on a line
  containing a lone backtick."

If you can't pin it to a file and line range yet, you're not done
with step 3 — keep grepping until you can.

### 6. Verify by reading code, not by running

The user already ran it. Open the candidate file at the line range
in the hypothesis, read the control flow, and confirm the
hypothesis explains every suspicious line in step 2. If a line
doesn't fit the story, either the hypothesis is wrong or there's a
second bug.

Respect this repo's architecture while you read: `src/domain/` is
pure (no DOM, no I/O, no imports from `ui/`, `storage/`, `app/`,
`window`, `document`, or `fetch` — the boundary is lint-enforced),
so a domain bug is reproducible in a plain node test with no
environment setup. A bug that only manifests in the browser lives
in `src/ui/`, `src/app/`, `src/storage/`, or `src/pwa/`.

When you're confident the hypothesis holds, propose or apply the
fix per the user's instructions and the standard conventions in
`AGENTS.md`.

### 6a. Confirm the bug with a failing Vitest test

Before writing the fix, write the regression test that proves the
bug exists. Drop it under `tests/`, mirroring the `src/` path with a
`.test.ts` suffix (e.g. a bug in `src/storage/migrations.ts` gets
`tests/storage/migrations.test.ts`). The test should:

1. Exercise the same path the trace describes — call the domain or
   storage function directly with the input that reproduces the
   failure. Mock storage at the `StorageAdapter` contract
   (`src/storage/adapter.ts`); never touch `localStorage` directly.
2. Assert the broken behaviour with `expect(...)`. The test must
   **fail** against the current code before you touch the fix —
   otherwise you don't have a real regression net, you have a
   tautology. Run `make test` to prove the red state, then keep the
   test alongside the fix so it lights green after.
3. Pick the environment deliberately. Domain and storage tests run
   in plain node. A UI test that needs the DOM opts in with a
   `// @vitest-environment jsdom` docblock at the top of the file.

### 6b. Reproduce visual bugs against the dev server

A Vitest test is the right answer when the bug is reproducible from
a function call. When the bug needs a real browser — a rendering
glitch in the live-preview editor, a focus trap, an install-prompt
or service-worker issue — run the dev server and reproduce it by
hand:

```sh
# Leave it running for the duration of the debug.
npm run dev   # http://localhost:5173
```

Drive the failing surface in the browser, read the devtools console
and the Network panel, and capture the offending output. Once the
hypothesis is clear, pull as much of it as possible back down into a
Vitest test (a `jsdom` UI test, or a pure domain test if the logic
can be isolated) so the regression net lives forever; the
dev-server session does not.

### 7. Evaluate diagnostic sufficiency — and ship the missing coverage

This is the step the skill exists for. After the bug is identified,
ask three questions:

1. **Did the pasted output contain the root cause?** Could a future
   reader have found it from the trace alone, without your greps?
2. **Were the silent gaps from step 4 the proximate diagnostic
   blocker?** A swallowed catch that truncated the trace, a thrown
   non-`Error` that rendered without a message, a missing test that
   would have caught the regression — all of these turned a
   five-minute fix into a fifteen-minute one.
3. **Will the next instance of this class of bug look the same?** If
   the same diagnostic gap exists across many sibling sites, the fix
   is to teach the pattern, not just to patch the one site.

If the answers point at any of these, **ship the missing coverage
in the same PR as the bug fix**. Concretely:

- Add a Vitest regression test for the class of bug, not just the
  one input, when the surface has obvious neighbours (every document
  schema version the migration pipeline handles, every namespace
  shape, etc.).
- Make a swallowed error surface: re-throw, or replace a silent
  `catch { return; }` with one that propagates or reports the
  failure to the caller the UI can show.
- If a `catch` swallowed a non-`Error` value, fix the throw site to
  raise a real `Error` with a descriptive message so the stack
  frame carries the cause.
- If the bug spanned a storage backend, confirm the same coverage
  applies to every `StorageAdapter` backend (`local`, `folder`,
  Dropbox, Drive) and the `encrypting` / `cache` wrappers — anything
  added to one backend must work behind the shared contract or be a
  feature-detectable capability (`AdapterCapability`).

Don't go on an instrumentation spree — the goal is the minimum set
that makes the next reproduction self-explanatory. If you added
more than a handful of new tests or surfacing points, you're
probably over-reaching; prune.

### 8. Report

Reply to the user with:

1. The one-sentence root cause (from step 5).
2. The proposed or applied fix.
3. The path to the new `tests/.../<name>.test.ts`, with a one-line
   note that it was red before the fix and green after. If the bug
   was visual and you reproduced it against `npm run dev`, say so.
4. A short note about which regression coverage or error surfacing
   you added and why, or "diagnostics were sufficient — none added"
   if step 7 came up clean.

Keep the report tight. The diff and the commit message hold the
detail.

## Working with this codebase's tests

Vitest is the only test runner — there is no Playwright and no e2e
suite. Key facts for debug sessions:

- `make test` runs the full suite (`vitest run`). Scope to one file
  with `npx vitest run tests/domain/markdown.test.ts`, or iterate
  with `npx vitest tests/domain/markdown.test.ts` (watch mode).
- Tests live in `tests/`, mirroring the `src/` tree, with a
  `.test.ts` / `.test.tsx` suffix.
- Domain and storage tests run in plain node. A UI test that needs
  the DOM opts into jsdom with a `// @vitest-environment jsdom`
  docblock at the top of the file.
- Mock storage at the `StorageAdapter` contract
  (`src/storage/adapter.ts`) — never reach into `localStorage`
  directly from a test. A reproduction that depends on stored state
  should set that state up through the adapter inside the test.
- `make lint` (`eslint . && tsc --noEmit`) is also the typecheck —
  there is no separate `make typecheck` target. A "this can't be
  undefined" bug is often a `tsc` error you can surface by reading
  the lint output rather than the runtime trace.

## Reading errors in this codebase

- `src/domain/` is pure by contract. A stack trace whose frames are
  all inside `src/domain/` (`note.ts`, the `markdown.ts` parser) is
  reproducible in node with zero environment setup — write the
  failing test first and you've likely already isolated it.
- Errors that surface only in the browser (DOM exceptions,
  service-worker / install-prompt failures from `src/pwa/`, storage
  quota errors from `src/storage/local/`) won't appear in `make test`
  output — reproduce them against `npm run dev` and read the
  devtools console.
- The service worker uses the **prompt** update model
  (`registerType: "prompt"` in `vite.config.ts`): the app surfaces
  an `UpdateToast` and registers the SW via `workbox-window`, and
  deliberately does **not** `skipWaiting()` / `clientsClaim()` —
  doing so would reload the tab mid-edit and risk unsynced changes.
  If a trace shows the page reloading on its own or a new SW taking
  control without the toast, suspect an accidental `autoUpdate` /
  `skipWaiting` regression and check `src/pwa/usePwaUpdate.ts`
  against that contract.
- If a pasted stack frame shows only a file location and no message,
  the throw site is likely raising a non-`Error` value. Fix the
  throw to raise a real `Error` so the trace carries a description.

## Skill self-improvement

After a run:

1. If a recurring diagnostic gap keeps showing up (the same shape
   of silent catch across the storage adapters, the same missing
   regression test, etc.), add a row to step 4's "Other silent gaps
   to look for" list.
2. If the trigger heuristic in "When to invoke" misfired (you
   skipped the skill on a paste that needed it, or ran it on a paste
   that didn't), tighten the bullet list accordingly.
3. If you found yourself reaching for a grep pattern repeatedly,
   promote it into step 3's examples.
4. If the bug was hard to reach from a plain function call (it
   needed jsdom setup or a `StorageAdapter` mock you had to
   hand-roll), add a small helper under `tests/` so the next
   regression on the same surface starts from a known state.
5. Keep the skill edit alongside the bug fix, the regression test,
   and any added surfacing — the skill is documentation of what
   worked, and drift on the skill itself is the same kind of error
   the skill prevents.
