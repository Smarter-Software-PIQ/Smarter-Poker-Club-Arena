# 2026-11-20: one league card from the command line

## What changed and why

A Horse decision option is switched on in production only with recorded
evidence, and part of that evidence is its league card. The league
(`server/src/benchmark/HorseLeague.ts`) had `runMatchup(matchup, pairs,
runSeed)` and the nightly `runLeague`, which deals every card, and nothing in
between: a lane that needed one card's result waited for the night or
hand-wrote a matchup object in a scratch script.

`server/src/scripts/horseLeagueCard.ts` deals one named card on demand. It
changes no engine behaviour, switches no option, and reads and writes no
database.

## Usage

```bash
cd server
npx tsx src/scripts/horseLeagueCard.ts --card=<name> --seed=<n>[,<n>...] [--pairs=<n>]
npx tsx src/scripts/horseLeagueCard.ts --list
```

- `--card`: the exact name of one card in `LEAGUE_MATCHUPS`. The card is passed
  to `runMatchup` as it is declared (variant, seats, stack, context, personas,
  mood clock, memory learning, human field, spot selection, both arms).
- `--seed`: required, 1 to 4294967295. Several seeds separated by commas are
  one full run each, followed by one line with the seeds together (the mean of
  the per-seed bb/100 and the standard error from the per-seed standard errors).
  There is no default seed: a result is evidence only with the seed that made it.
- `--pairs`: duplicate pairs per seed, 2 to 65536. Default: the pairs the card
  declares; a card that declares none needs `--pairs`.
- `--list`: every card name, dealable first, then the refused ones.

Exit code 0 on a completed run, 2 on a refusal (message on stderr).

Under shared load run it as `nice -n 10 npx tsx ...`.

## Refusals

- A name that is not a card: refused, with the names that contain it.
- A name in `UNMEASURABLE_MATCHUPS`: refused with the recorded reason, the same
  text the nightly writes to the card's `refused` row. Nothing is dealt.
- A missing or malformed argument, a repeated argument, a repeated seed.

## The result block

One block per seed, then a `RESULT_JSON` line holding the unrounded
`LeagueResult`:

```
=== LEAGUE CARD RESULT ===
card:            <name>
option:          <the option keys the two arms differ in>
arm A:           <config_a as the nightly stores it>
arm B:           <config_b as the nightly stores it>
table:           variant, seats, stackBB, gameMode, field, personas, clocks
pairs:           <requested>, <played> (<hands>)
seed:            <n>
bb/100 (A - B):  <arm A minus arm B>
stderr:          <per-pair standard error> (block stderr when the league computes one)
z:               <bb/100 divided by stderr>
SIGNIFICANT:     yes | no (SIGNIFICANT | not resolved | INERT)
divergent pairs: <pairs the two arms settled differently>
harness:         illegal, truncated, corrected, brainFallbacks
engine revision: <git SHA, or GIT_COMMIT_SHA / ENGINE_VERSION when set>
solver stores:   charts, postflop, postflopV31 counts
equity governor: off
wall time:       <seconds>
=== END ===
```

SIGNIFICANT is the nightly's rule, `|bb/100| > 2 x stderr`, and an inert run
(no pair diverged, or zero variance) is INERT, never significant. The engine
revision says so when `server/src` has uncommitted changes.

## How it differs from a nightly row

- The seed is the one given. The nightly derives its seed from the run date
  and the card name, so this is a new sample of the same card, not a replay of
  a night.
- The solver stores are EMPTY. The nightly's compute worker hydrates the
  preflop charts and both postflop stores from the database before the first
  hand; this command has no database, so a decision that would consult a
  solver store takes the brain's path without one. The block prints the three
  counts so no reader mistakes one for the other. A card whose arms differ in a
  rule that sits outside the solver stores is still measured on the same
  simulator, deals and arms.
- It runs in the calling process, not the low-priority child process, with the
  equity governor off as the worker has it and the tournament future-hand facts
  prepared as the worker prepares them.
- Nothing is written to `horse_league_results`.

## Files

- `server/src/scripts/horseLeagueCard.ts`: the command.
- `server/src/benchmark/HorseLeagueCard.ts`: arguments, card lookup, refusals,
  verdict and the block. No simulator code.
- `server/src/benchmark/HorseLeagueCard.test.ts`: 25 cases on arguments,
  refusals, the verdict rule and the block. No hand is dealt.

## Verification

- `npx vitest run src/benchmark/HorseLeagueCard.test.ts`: 25 passed.
- Run for real against `nlh_hu_postflop_balance`,
  `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb`,
  `plo6_facing_bet_is_priced` and the heads-up defence cards; an unknown name
  and `human_hu_opener_defends_vs_threebet_40bb` (refused list) both exit 2
  with their message. The result blocks are in the pull request, not in the
  repository.
