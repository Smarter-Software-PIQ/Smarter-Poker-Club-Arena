# The Local Push Gate Runs The Tests That Read A Changed Engine File, And The Timing Benchmark Allows For A Busy Machine

Two things cost time on November 12, 2026. Neither changes how the engine plays or settles a hand.

## A Test That Reads A File Now Runs When That File Changes

Some engine laws check a method by reading its source file as text. They import nothing from that file, so the local push gate, which follows imports, never picked them. A change to `ServerTableEngineSettlement.ts` (PR #10631) passed the whole local gate and then failed hosted CI on `ChipContinuity.law.test.ts`, which reads that file.

The server gate in `.husky/pre-push` now also picks every server test that names a changed file as a path: the file name with its extension, straight after a slash or an opening quote. If a helper script (`.mjs`) reads the changed file, the tests that name that helper are picked too. Imports use the `.js` name, so this does not pull in the whole suite.

Measured on a scratch change to `ServerTableEngineSettlement.ts`: before, 0 tests were picked this way; after, 45, including `ChipContinuity.law.test.ts` and `OriginalPayloadRetry.test.ts` (through its helper). The server suite has about 2,000 test files.

The gate also no longer runs a law twice when that law is one of several test files changed in the same push.

## The 50,000 Hand Benchmark Allows For Machine Load Outside Hosted CI

`HorseHoldemEliteOverhaul.test.ts` case 8 requires the run to finish in under 8 seconds. On a Mac shared by several agents it took 8,578 ms at a load of about 80 on 28 cores and refused a push, although every correctness check passed.

- In hosted CI (GitHub Actions, detected by `GITHUB_ACTIONS=true`) the limit is still exactly 8,000 ms.
- Anywhere else the limit is 8,000 ms times the one minute load per core, never less than 8,000 ms and never more than 32,000 ms (4 times).
- The test prints the measured time, the load per core and the limit it used.
- The hand count, zero illegal actions and every strategy check are unchanged and are now judged before the clock, so a slow machine cannot hide a correctness failure.

The plain `CI` variable is not used: the agent shells on the shared Mac export `CI=1`, so it does not tell hosted CI from a local push.

## Limits

- A test that builds a file name from pieces, or reads a whole directory, is still not picked by name.
- A changed file with a very common name (for example `index.ts`) picks every server test that names any file of that name.
- A genuine slowdown of the benchmark is still caught in hosted CI, not on a loaded local machine.
