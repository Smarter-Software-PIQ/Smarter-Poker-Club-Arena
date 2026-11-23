# Every authority doc states its evidence, and a sweep declares what it reads (2026-11-22)

Follow-up to `2026-11-22-a-docs-change-runs-the-tests-that-read-it.md` (#11800).

## 1. The scoreboard's authority files must state their evidence

`scripts/ops/holdem-blanket-scoreboard-lib.mjs` reports each Hold'em option's
evidence by finding "Evidence MET" or "Evidence NOT MET" in its file under
`docs/horse-option-authority.d/`. #11791 rewrote one of those files and the
words dropped out; the scoreboard read `UNKNOWN` and main went red. Nothing
said a file had to stay readable; one unrelated test happened to pin one
option's status.

`tests/every-scoreboard-authority-doc-states-its-evidence.law.test.ts` loads
the files exactly as the scoreboard does (`loadLocalRepoInputs`,
`buildEffectiveCatalog`) and refuses any catalog option whose authority file
states neither. When written, the scoreboard read 10 authority files and all
10 were readable. Re-breaking the #11791 file makes the law fail naming it.
It names the folder in its code, so a docs-only pull request that edits one of
those files runs it.

Scope: the law covers the files the scoreboard reads. 28 other files in that
folder (mostly Omaha options, which the Hold'em scoreboard does not read) do
not state their evidence in that form; whether they should is the owning
lanes' call, so they are not rewritten here. One default-on file the
scoreboard reads (`docs/horse-default-on.d/holdemRiverFullHouseValue.md`) has
no `Status:` lines, so the scoreboard counts it as not all met; that is also
left to the horse lane.

## 2. A sweep no scanner can see declares what it reads

`scripts/ci/run-docs-readers.mjs` finds readers by the paths their code names.
`tests/unit/theDeployDocsNameTheLiveRoute.test.ts` walks every doc from the
repository root and names no docs path, so a docs-only pull request that broke
it would not have run it. A test can now declare a sweep in a comment:

    // @reads-docs: docs !docs/_archive !docs/changelog !docs/handoffs

Entries are docs paths it reads; `!` entries are paths it skips, and a skip
wins over a literal the walker names in order to skip it. The deploy-docs law
carries that line (its skips are its own `HISTORY_PATHS`). Searching the
suites for other root-level walks of docs found none: the other recursive
walks cover code folders or temporary copies.
