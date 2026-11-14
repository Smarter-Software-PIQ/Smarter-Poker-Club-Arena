# The cutover spectator may arrive during the last hand, and a late one is named

2026-11-14

## What happened

Off-cycle engine cutover, receiver run 43565107242 of
`.github/workflows/auto-deploy-hetzner.yml`. The job `cutover-spectator` failed,
`correlate-cutover-spectator` failed after it, and the release has no
`sealed-spectator-<run>-<attempt>` artifact.

Times in UTC:

| time              | event                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| 06:11:26          | receiver created                                                                     |
| about 06:12:20    | preflight finished; `cutover-spectator` and `engine-doors` started                   |
| about 06:13:20    | `deploy` started (it needs `preflight` and `engine-doors` only)                      |
| 06:14:19-06:14:22 | the host accepted the last-hand announcement                                         |
| about 06:14:50    | the spectator case threw `production engine is in scheduled maintenance (last_hand)` |

On November 12 (receiver 43264950019) the same job passed because the
announcement came about five minutes after dispatch.

## Root cause, read from source

The spectator job and the deploy job are siblings. Nothing orders the host
announcement after the spectator's browser, and the browser costs minutes:
`npm ci`, `playwright install --with-deps chromium webkit`, the fixture account,
its membership, global setup, then the lobby.

The case selected its table with `selectOccupiedRunningCashTables`, which calls
`readEngineHealth`. That shared helper throws for ANY active maintenance phase,
because every other case in the file certifies ordinary dealing. The spectator
is the one case whose subject is the replacement itself, and it inherited the
precondition. Three places refused `last_hand`:

1. the workflow step `Read predecessor before opening a spectator`
   (`jq 'select(.maintenance.active==false)'`);
2. `readEngineHealth` in `tests/e2e/production-live-table-realtime.spec.ts`;
3. `expect(before.maintenance?.active).toBe(false)` in the case.

`last_hand` is not the freeze. `MaintenanceBreak.LAST_HAND_LEAD_MS` is two
minutes; the predecessor keeps serving through it, and
`engine_maintenance_break_log.break_started_at` is written from
`breakStartedAt`, which `beginCountdown` sets at the start of the countdown, not
at the announcement. The correlator already requires
`armedAt < freeze <= container start <= thaw`, and the case already requires its
initial socket to be open at `freeze`. So a spectator armed inside the last hand
satisfies every existing proof. Only the precondition was wrong.

A second fact follows from the same source: after the announcement tables park
at their hand boundary, so `healthyRunningTable` (not paused, progress inside
45 s) would select nothing even with the phase admitted.

## What changed

`scripts/ci/cutover-spectator-admission.mjs` (new, no browser, unit tested)
holds the decision:

- `classifySpectatorAdmission(health, { target, predecessor })` returns
  `observe` (phase `idle` or `last_hand`), `not-observed-late` (the freeze has
  begun, or the candidate already serves) or `unknown` (unreadable health, a
  foreign SHA, no maintenance flag). Three outcomes, per CLAUDE.md 10.86.
- `occupiedCashTableForBreak(table)` is the table test used only once tables
  have parked: a cash table that has dealt and has two dealable players. Whether
  it deals again is still proved by the committed post-thaw hand.

The spec case reads the engine first and again after its snapshot, classifies
both reads, and passes `admitLastHand` to the selection. Only this case passes
it; every other case keeps the strict precondition. The witness gains
`armedPhase`, and the correlator refuses any value but `idle` or `last_hand`.

A late spectator writes `cutover-spectator-not-observed.json`, records a
non-verdict (`::warning::UNKNOWN: NOT OBSERVED (late): ...`, job summary, test
annotation) and skips. It never writes `cutover-spectator.json`. If opening the
table fails and a fresh health read itself says the freeze has begun, the
failure is reclassified the same way; if that read says anything else, or cannot
be made, the original error stays red.

The workflow step now runs the same classifier. A late arrival there creates no
fixture account and opens no browser. `correlate-cutover-spectator` has three
exits: 0 uploads `sealed-spectator-<run>-<attempt>`; 3 prints the warning and
uploads `spectator-not-observed-<run>-<attempt>`; anything else is red. A
witness beside a not-observed record is refused.

## What did not change

- `deploy` still needs `preflight` and `engine-doors` only. Nothing in the
  release path reads either spectator job. The law pins this.
- No timer, watcher or retry was added.
- No proof was loosened: same socket open at the freeze, same instance change,
  same natural reconnect, same committed hand, same receipt binding.

## Options rejected

**(A) Make the announcement wait for the spectator.** This puts an evidence job
in front of the host transaction. Owner windows have a fixed expiry and an
announcement band, and a bounded fail-open wait is still new code in the deploy
job that must be right on every release in order to help an optional witness.
The existing proofs show the wait is unnecessary: the spectator has until the
freeze, not until the announcement.

**(B) Make the spectator faster.** Starting it beside preflight would open a
production browser for a request preflight has not verified, and the law pins
`needs: preflight`. Chromium cannot be dropped from the install because
`tests/e2e/global-setup.ts` launches it for the login. Caching browsers does not
remove the `--with-deps` system packages. Any of these narrows the race without
removing it; none could be measured from here.

## What is not verified

The live Playwright path was not run. Unverified until a real cutover: that the
lobby still offers a View action on a parked cash table during the last hand,
that the engine sends a spectator SNAPSHOT then, and that the table chosen deals
within 240 s of the thaw. If any of those fails the job is red as before; none
can produce a sealed artifact.

## Residual risk

The spectator now has until the freeze instead of until the announcement, which
is two more minutes. On November 14 it reached the lobby about 30 s after the
announcement, leaving about 90 s. A slower runner can still arrive after the
freeze; that run is now NOT OBSERVED (late), with its reason in an artifact,
instead of a failure that reads like a defect. Spectator continuity for such a
release is still unverified.
