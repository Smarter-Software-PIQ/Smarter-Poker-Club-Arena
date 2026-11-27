# The Crash Drill Is Not An Engine Stall (2026-11-26)

Lane: release-custody.

## What Broke

Backup run 45885658741 (certify job 140147121213) refused `2238a16342de` with
one hard-ceiling verdict: `kind=cash shape=fold n=313 max_ms=34642`, hand
`dff6cb90-ecb8-4a01-98c1-b1754ba5b0dc` on table
`6d9b0dd4-99f3-4a12-b9ab-b5210b373a92`. The other 312 fold pairs were at most
5 ms. Run 45892895834 then certified `396283f68a7f`, the same engine code,
with no breach. The certificate of the refused run recorded
`crashRecoverySeconds: 29`.

`cmd_certify` kills the engine on purpose (`crash_container`, SIGKILL through
a pidfd) after the swap rehearsal and measures Docker's restart. The engine
abandons a hand in flight on restart (`checkCrashRecovery`, B10) and deals a
fresh one. The pair from the last hand before the kill to the first hand after
the restart therefore holds the kill, the restart and the abandoned hand,
here 36.5 s of gap less the 1.85 s a fold owes. The soak starts 60 s after
recovery, but the grader selects pairs by the NEXT hand's `created_at` (the
moment that hand ended), and the previous hand may end up to 60 s before the
next one starts. A first post-restart hand that ends after the soak start
(for example one that waits out a turn clock) brings its drill-spanning gap
into the soak window. The swap rehearsal itself cannot do this: it retains
hands across its break and the grader already leaves out maintenance breaks.

Hand gap grading of production is unchanged and correct: a real engine crash
in production is an unintended delay. Only the Backup harness's own drill is
an intended pause.

## How It Is Fixed

- `cmd_certify` records `crash_at` just before `crash_container` and
  `recovered_at` when recovery is proved, and passes both to
  `check_soak_hand_gap_delay`.
- The check's SQL lists the pairs in the soak window whose gap spans
  `[crash_at, recovered_at]`, with the grader's own pairing (previous hand on
  the table, gap under 60 s), keyed by the hand before the gap exactly as the
  grader's `worst_hands` names it.
- The judge takes each such pair out of its cell: n, the over-budget count and
  the maximum are recomputed from the grader's worst hands. A pair not among
  any cell's worst hands is kept and reported as `notLocated` (it then cannot
  be what breaches the ceiling). A legacy grader without worst hands is judged
  unadjusted. The certificate's `handGapCheck.harnessCrashPairs` names every
  pair, what was left out and what was kept.
- The 5,000 ms ceiling, the 250 ms budget and the binomial rule are unchanged.
  With no drill pair the same 34 s gap still fails, and a real stall beside a
  drill pair still fails by its own hand.

## What Stops It Returning

`tests/backup-cert-checks-lifecycle-logs.law.test.ts`, describe "the crash
drill is not an engine stall", replays run 45885658741's cell (passes only
with the drill pair named), pins that nothing passes without it, that a real
7.6 s stall beside it still fails, that an unlocated pair is reported and
kept, that a legacy grader is unadjusted, and the SQL predicates and the
`crash_at`/`recovered_at` wiring. The SQL was also run on PostgreSQL 16
against a fixture with one drill-spanning pair and one ordinary pair: only
the spanning pair was listed and left out; called with two arguments the same
fixture still fails.
