# 376656 StatsAllInEquityCoverageLow: Lightning all-ins are never priced

Alert: `StatsAllInEquityCoverageLow` row 376656 (firing 2026-11-11T09:34:01Z), and its
earlier episode 376652 (fired 2026-11-10T10:15Z, resolved 2026-11-11T09:28Z). Summary:
"All-in equity coverage is 96.69% over 7 days" against a 99% bar.

## What the rows say (read 2026-11-11T09:55Z, production `kuklfnapbkmacvwxktbh`, read-only)

`ca_hand_facts`, owed all-in runouts (`was_all_in AND went_to_showdown AND all_in_street <> 'river'`)
in the 30 hours before 09:55Z, by table:

| table | name | owed runouts | missing `all_in_equity` |
| --- | --- | ---: | ---: |
| `ea34f32d` | PLO4 0.25/0.50 Lightning Games | 1,706 | 1,706 |
| `0f84a1ab` | NLH 0.25/0.50 Lightning Games | 1,468 | 1,468 |
| `228eb1cc` | PLO6 0.10/0.25 Classic | 248 | 7 |
| `b5a40a28` | PLO5 0.10/0.25 Classic | 199 | 4 |
| every other physical cash table | | | 0-3 each |

By variant and format the gap is cash multiway runouts (`all_in_equity_owed = true` on
almost every missing row); tournaments are 98.5%+ covered.

`ca_stats_witness_audit_log` shows the 7-day ratio climbing (0.9407 on 11-07 to 0.9669
on 11-11) only because the tournament-heavy days carry a denominator Lightning cannot;
with the Spin/HU fleet retired on 11-09, Lightning is a growing share of runouts, so the
ratio cannot reach 99% without this fix.

## Root cause

`ServerTableEngineRunout.broadcastAllInEquity()` prices a physical runout on the
equity worker pool and emits `all_in_equity`; `TableStateHub.emitEvent` passes that to
`captureAllInEquity()`, and `writeHandFacts` reads it back by `tableId:handNumber`.
`LightningHandHost` handles `ALL_IN_RUNOUT` by pacing the runout only: it never prices
and never emits the event. `LightningHandFacts` (2026-10-24) builds the facts with the
same `writeHandFacts`, so every Lightning seat in a runout was marked owed by the frozen
`allInRunoutWitness` and written with `all_in_equity = NULL`, `ev_returned = NULL`.

## Fix

- `server/src/lightning/LightningAllInEquity.ts`: prices the runout with the same pool,
  `exact: true`, the controller's live pots as pot-share denominators, and the
  Omaha/hi-lo/short-deck flags; refuses exactly where the physical engine publishes no
  number; never rejects.
- `LightningHandHost`: starts the pricing once at the first `ALL_IN_RUNOUT` (before any
  further card) and awaits it, bounded at 3 s, when it builds the hand's stats facts.
- `HandFactsInput.allInEquity`: a caller-priced equity used only when the hub cache has
  none for the hand. Physical tables are unchanged.

No migration. Engine change: it activates through the daily engine release.

## Proof

- `server/src/lightning/ALightningAllInIsPriced.law.test.ts`: 2 of 6 fail on the
  pre-fix host/facts code (the facts write NULL equity; the host never prices), 6 of 6
  pass after.
- `npx tsc --noEmit` (server) clean; `LightningHandHost`, `LightningHandToHand`,
  `LightningPostCommitRecovery` suites 68/68.

## Close condition

After an engine at or after this PR's merge is serving: Lightning owed runouts played
after the release have `all_in_equity` (query above, `played_at >` the release), and the
7-day ratio in `ca_stats_witness_audit_log` rises to 99%+ as the pre-release week ages
out; `StatsAllInEquityCoverageLow` then resolves without refiring.
