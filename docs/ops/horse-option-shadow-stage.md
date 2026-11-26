# Horse option shadow stage (PLO and Hold'em)

The shadow stage is how a dark Horse option is trialled on live tables without ever acting on it. With the option's
switch row in state `shadow`, every acted decision is made exactly as with no row; after the answer has been sent, an
idle decision worker re-decides a sampled decision once with the option flipped and records whether the answer would
have been the same. Source: `server/src/engine/HorseOptionShadowStage.ts` (table, scope, breaker) and
`server/src/engine/horseDecision/workerRuntime.ts` (`scheduleOptionShadowStage`, `runOptionShadowStage`).

Since 2026-11-24 the stage is not PLO-only: any registered option that declares a stage entry is staged, whatever its
game.

## What it guarantees (unchanged by game)

- The acted decision, its RNG positions and its plan effects are those of no row (law
  `aListedOptionInShadowStageNeverChangesTheActedDecision.test.ts`, held for PLO4 cash, NLH cash, NLH Lightning and
  NLH tournament decisions, scripted and production brain over every recorded FAST decision).
- Nothing of the re-decision runs before the answer; work queued behind the decision drops it.
- One shadow row globally (`scripts/ops/horse-option-switch.mjs preflight` refuses a second `shadow`/`on_shadow` row).
- Acted-time budget 50 ms, Horse-only cap 2 per worker per minute, the shared per-minute budget
  (`HORSE_OPTION_SHADOW_PER_MINUTE`, default 12), people first.
- Latency breaker per option and worker: one re-decision charged over 150 ms, or three over 50 ms in the last 20,
  stops that option in that worker until restart (`option_shadow_stage_self_disabled_seen`). A re-decision is charged
  min(wall, thread CPU).

## Games

| Entry game       | Decisions                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `4`, `5`         | PLO4 / PLO5 cash, table and Lightning, one board, no hi-lo, no bomb pot (`omahaOptionGameOf`) |
| `nlh_cash`       | no-limit hold'em cash table: `gameVariant` nlh, two hole cards, one board, no bomb pot        |
| `nlh_lightning`  | the same, Lightning (`publicMemoryDomain.speed === 'lightning'`)                              |
| `nlh_tournament` | the same, a tournament (`isTournamentMode`'s reading)                                         |

An entry may also list `streets` (absent: every street) and, for Omaha, `companions` (options passed true with it
when it is flipped to true).

## Registering an option (one line)

Add the option to `OPTION_SHADOW_STAGE` in `HorseOptionShadowStage.ts`, in the games and streets it acts in:

```ts
  // <lane> <date>: <one line on where it acts>
  holdemTournamentRaiseDefenceIsPriced: holdemStage(['nlh_tournament'], ['preflop']),
```

Omaha entries keep their form (`{ games: [4, 5], streets: [...] }`). Nothing else is needed: the option is staged by
its ordinary `shadow` row. The law `aPricedOptionDeclaresAShadowStageEntry.law.test.ts` fails the build when a
registered option whose name says it is priced (`/pric/i`) takes `shadow` or `on_shadow` and is neither in
`OPTION_SHADOW_STAGE` nor in `OPTION_SHADOW_STAGE_UNSTAGED` with the reason it cannot be staged. An option that is not
staged keeps the inline option shadow (re-decided before the answer, only when the acted decision took 15 ms or less).
In a hold'em game that inline re-decision also runs under the stage's latency breaker (one over 150 ms, or three over
50 ms in the last 20, stops it in that worker: `option_shadow_inline_self_disabled_seen`, then
`option_shadow_skipped_stage_disabled_seen`), so a slow unstaged Hold'em option holds at most one live decision per
worker before it stops. Stage it to take it off the live path entirely.

Open branches of the Hold'em lane add their own line this way (tournament raise defence, late-street chooser, 3-bet
range), and add the option's acted receipt prefixes to `ACTED_RECEIPTS` in
`scripts/ops/horse-option-shadow-watch-lib.mjs` (or pass `--acted-prefix` to the watcher).

## What a trial records

- `option_shadow_<option>_<changed|same>_seen` (+ `_person_seen` with a person dealt in): agree / disagree.
- Hold'em games only, a changed answer: `option_shadow_<option>_dir_<from>_to_<to>_seen` (+ `_person_seen`), over
  fold, check, call, bet, raise, allin (other actions read `other`), or `option_shadow_<option>_dir_size_seen` when
  only the amount moved. So a trial shows WHAT the option would change (fold_to_call, call_to_fold, raise_to_call,
  check_to_bet, bet_to_check, size, ...).
- Latency: `option_shadow_stage_redecide` (all), `option_shadow_stage_redecide_game_<plo4|plo5|nlh_cash|nlh_lightning|nlh_tournament>`
  (per game), `option_shadow_stage_redecide_cpu` (thread CPU).
- The receipt itself rides in the next journaled decision record, field `stagedOptionShadowReceipts`.

## Starting and reading a Hold'em trial

1. Preflight and set (the switch CLI; its own gates apply, nothing else may be in shadow):

   ```bash
   node scripts/ops/horse-option-switch.mjs preflight holdemValueAndCallsArePriced shadow
   node scripts/ops/horse-option-switch.mjs set holdemValueAndCallsArePriced shadow --reason "<why>" --authority "<ref>" --changed-by "<actor>"
   node scripts/ops/horse-option-switch.mjs verify-pickup holdemValueAndCallsArePriced shadow
   ```

2. Read it (read-only, any time):

   ```bash
   node scripts/ops/horse-option-shadow-watch.mjs holdemValueAndCallsArePriced --since 2026-11-24T15:00:00Z [--release <sha prefix>]
   ```

   It prints the switch row, re-decisions, agree/disagree (all, with a person), disagreement by direction, the breaker
   and guards, acted leaks (must be 0), errors, re-decision latency over 100 ms, person hands reached, and one line
   `VERDICT=CLEAN|DIRTY` (exit 0 / 1; 2 when it cannot run). DIRTY when: no re-decision yet, an acted leak, the
   breaker tripped, a re-decision failed or could not be encoded, an error in `horse_error_log`, 1% or more of
   re-decisions over 100 ms, or no acted receipt is known for the option (pass `--acted-prefix`).

3. End it: `set <option> off` (or clear the row) through the same CLI.

The watcher replaces the ad-hoc shell watcher used for `omahaMathCorePlo5Flop` and reads PLO options the same way.
