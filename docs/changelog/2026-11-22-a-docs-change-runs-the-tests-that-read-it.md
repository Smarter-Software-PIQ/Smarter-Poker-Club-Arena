# A docs change runs the tests that read it (2026-11-22)

## What broke

At 5:47 PM Chicago on 2026-11-22, #11791 recorded that the horse option
`holdemValueAndCallsArePriced` is live. It changed one file,
`docs/horse-option-authority.d/holdemValueAndCallsArePriced.md`, and in
rewriting its state line it dropped the words "Evidence NOT MET". The Hold'em
blanket scoreboard (`scripts/ops/holdem-blanket-scoreboard-lib.mjs`) reads
those words to report each option's evidence, and
`tests/unit/holdemBlanketScoreboard.test.ts` pins what it reports. The
scoreboard now read `UNKNOWN`, the test failed, and from then on every pull
request that ran Client Unit Tests failed it, whatever it changed.

## Why nothing stopped it

CI classifies a change that touches only `docs/` as running no application
suite, so #11791 skipped the client unit suite and the server shards and went
green. The one test that reads the file it changed never ran. This had
happened twice before: `docs/laws.d/` on 2026-09-20 and `docs/evidence/` on
2026-10-11, and each time the directory was named in
`scripts/ci/classify-ci-changes.mjs` by hand. When this was written the tests
read 44 `docs/` entries on the client side and 20 on the server side; the
classifier named three.

## The fix

1. The authority file says "Evidence NOT MET against the REPLAY-6
   verdict-only bar" again. That is what its author wrote in words (the
   verdict-only bar is not met; the activation rests on the real-card EV grade
   and the league results), now in the form the scoreboard reads. Main is
   green.
2. The ungated compile job (`typecheck_compile`, behind the required
   TypeScript Check) has a new step, "A docs change runs the tests that read
   it" (`scripts/ci/run-docs-readers.mjs`). It takes the exact changed files
   from the classifier, and for every `docs/` path among them runs the tests
   that read it whenever their suite is skipped. A test reads a path when its
   code, or a `scripts/` file it names, holds that path or a directory above
   it as a literal, a template, or `resolve(ROOT, 'docs', ...)` pieces.
   Comments do not count. Docs nobody reads still run nothing, so the fast
   path stays fast; replaying #11791 through the step runs
   `holdemBlanketScoreboard.test.ts` and fails with the same error that broke
   main.
3. `tests/a-docs-change-runs-the-tests-that-read-it.law.test.ts` pins the
   step, its place in the ungated job, and the #11791 case.
   `tests/unit/requiredCiRunnerRecovery.test.ts` carries the new fingerprint
   of the compile job.

The classifier is unchanged: several tests deliberately keep docs-only and
changelog-only pull requests off the full suites, and this keeps that while
closing the gap.

Limit: a path built any other way (for example `join(dir, name)` with `dir`
from a variable) is invisible to the step. Write the path a test reads as one
of the recognised forms.
