# 2026-11-07 - four CI-process fixes and the GitHub owner note

Four things cost this estate time today, none of them in product code, and
one fact about GitHub that every agent needs on its first push. Each fix
carries a test; the fifth item is documentation, dated and measured.

## Shipped

### 1. A fresh worktree installs every package root, and every refusal names the command

Twice today a fresh worktree reached `.husky/pre-push` with no
`server/node_modules` and was BLOCKED with
`required local server dependencies are incomplete`. `scripts/agent-workspace.sh`
already walked every package root, but when the main clone had nothing to
clone from it printed `run 'npm ci'` and installed nothing - the 2026-08-25
server/ hole had moved from silence to a message.

- The provisioner now installs in the tree (`npm ci --ignore-scripts --no-audit --no-fund`,
  `TREE_NPM_CI`) for every package root it cannot clone or whose clone fails;
  root and `server/` reach it through the same `package.json` discovery.
  `--ignore-scripts` because the root `prepare` only re-points
  `core.hooksPath`, which `ensure-hooks.sh` already did.
- Every remaining "install it yourself" message names that exact command,
  including the Mac path, which still installs nothing by the 2026-09-11
  policy (pinned by the existing Mac scenarios in the same law test).
- `.husky/pre-push` prints a one-line `remedy:` under all four dependency
  BLOCKs, naming the package root.
- `scripts/agent-push.sh` runs the hook's own read-only
  `local-dependency-policy.mjs` probe on both roots before the gate and
  warns with the same command. A warning, never a refusal: the hook decides.
- Pinned in `tests/a-worktree-gets-a-node-modules-that-works.law.test.ts`.

### 2. A workflow that is not `ci.yml` no longer admits the browser suites

`scripts/ci/classify-ci-changes.mjs` set `src: true` for any
`.github/workflows/` file, so a pull request touching `backup-engine.yml`,
two `*.law.test.ts` files and `docs/laws.d/` ran the full CSS Beat
(Chromium + WebKit, 10 shards x 2 partitions) and Diamond playfield suites and
failed on a flake its diff could not reach. No `src`-gated job (Production
Build, browser harness, CSS Beat, Diamond playfield) reads any workflow but
`ci.yml`, which both defines them and is what `cssBeatJobInputs()` parses.

`src` now takes every other `wide` input unchanged (package manifests, Vite,
vitest, tsconfig, the four selection scripts) and, of the workflows, `ci.yml`
only (`wideClient`). `server`, `tests`, `phase4` and `fixture` are untouched:
dozens of tests read workflow YAML and still run for every workflow change.
Required check names stay green exactly as they do for any `src: false` diff
today - the jobs skip and the ruleset counts the skip; an unreadable diff still
classifies as everything. `docs/**`, `scripts/ci/*` (outside the four
selection scripts) and `tests/*.law.test.ts` already classified `src: false`.
Pinned in `tests/unit/fixtureNativeCi.test.ts`, including the exact diff that
paid the fan-out and the inputs that must still run the browser.

### 3. `check-migrations-are-live.mjs`: a lost handshake is re-attempted, bounded

The check answered `COULD NOT ASK: spawnSync psql ETIMEDOUT` at 18:00Z and
18:09Z and `Installed and merged migrations agree` was red on main for ~45
minutes. psql ran with no `connect_timeout`; an unanswered handshake held the
process until `execFileSync`'s 60 s budget killed it.

`runPsql()` now sets `PGCONNECT_TIMEOUT=15` (libpq honours it before any
query) and re-attempts at most `CONNECT_RETRIES = 2` more times, each attempt
logged, only for a failure before any query was answered: `ETIMEDOUT` /
`ECONNRESET` with empty stdout, psql exit 2 with a connection message, libpq's
connection-phase messages, or SQLSTATE class 08. A query the server rejected
(exit 1 + `ERROR:`) or answered, or one killed after it produced output, is
never sent twice. `COULD NOT ASK` stays exit 2 (CLAUDE.md 10.86) and now says
how many attempts preceded it. Pinned with an injected spawn in
`tests/unit/migrationsAreLiveConnectionRetry.test.ts`; the law test gained
three pins.

### 4. `hero-cards-no-glitch.spec.ts` waits with its own budget and names what was pending

The spec waited a fixed number of milliseconds for `[data-ready]="true"`,
failed once today and passed on rerun, and its failure said only that the
attribute was still `false`. `data-ready` is `useTableArt().reveal`: the deck
decoded, the felt and room decoded, or the cover expired. The fixture
(`tests/e2e/fixtures/cardArtReady.tsx`) now exposes `cardArtReadiness()` from
the same caches the hooks read, and `expectTableRevealed()` waits until the
test's configured timeout less a 5 s margin, then fails with that snapshot.
The assertion is unchanged. Pinned in `tests/unit/heroCardsReadinessWait.test.ts`.
Not executed here: this lane has no Playwright browsers; the spec and fixture
type-check against `tsconfig.app.json`.

### 5. CLAUDE.md section 11 and PUBLISHING.md step 6: the GitHub owner and `gh`'s own login

Measured 2026-11-07 by this lane: GitHub reports the repository under
`Smarter-Software-PIQ` (renamed from `Smarter-Poker`), the old owner path
redirects to the numeric repository ID and some proxies refuse clients that
follow it; the exported fine-grained `GH_TOKEN` reads and pushes but is
refused `mergePullRequest`, `enablePullRequestAutoMerge` and `rerun`. Merge, PR
edits and `gh run rerun <run-id> --failed` run as
`env -u GH_TOKEN -u GITHUB_TOKEN gh ...`. Dated, per 10.86's expiry rule.

## Deliberately not changed

- The Mac dependency policy (no automatic installs on Darwin) stands; it is a
  written owner instruction pinned by the same law test. The Mac path now
  prints the exact command instead of a policy sentence alone.
- `index.html` and `public/**` already classify `src: false` on their own;
  that is pre-existing and outside this change.
- Two tests failed in this lane for environmental reasons only:
  `tests/the-break-clocks-agree.law.test.ts` reads commit `eed06fe5` from a
  shallow clone that does not hold it, and
  `tests/operations/client-runtime-retention.test.mjs` requires the Mac's
  external SSD scratch directory.
