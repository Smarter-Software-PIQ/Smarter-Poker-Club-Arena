# 2026-11-08 - Break-even bluffing now leaves unread opponents alone; it stays off

## In plain English

The new "break-even" way for horses to decide how often to bluff after the flop (#10042, flag `readBreakEvenBluff`, off by default) had two faults that kept it from being switched on. Both are fixed here.

1. **It changed how horses play against players they had never read.** Against a stranger it used the average player's fold rate and bluffed 1.45 times as often, where every other read the horses have makes no change at all. The standing rule is "a horse that has read nobody plays exactly as it did before it could". Now the break-even bluffing only acts against a player whose fold-to-bet or river-call habit the horse has already shown, with real evidence, to be outside normal horse play. That is the same test every other opponent read already uses. Against everybody else, strangers and normal regulars included, the horse plays exactly as it does with the flag off. When the reads are switched off, this switches off with them.
2. **Its math for a semi-bluff was wrong.** It compared betting a drawing hand with giving the pot up, instead of with checking and keeping the draw. So a hand with about a third of the equity "needed no folds" and was bet at the maximum rate even into a calling station. It now uses the fold share at which betting does exactly as well as checking.

With the flag forced on, the six standing tests that failed before now pass, and none of them was changed. Those six were the neutrality law (two tests), the V54 river bluff golden (two), the barrel-continuation wiring law, and the calling-station "strictly fewer bluffs" test.

**The flag stays off, for a measured reason.** Every league card was measured again on three seeds, with the same method and scripts as before, along with every exploiter cell. With the fix in, the flag no longer changes much of anything. 41 of the 54 cards did not change a single hand. The other 13 moved by less than their own noise. No card came out significantly better or worse, and no exploiter gained. The owner rule needs at least one card that is significantly better, so the default stays off. The horses in the test leagues, and the calibrated human field, all play inside the normal horse range, so nobody there ever counts as "read". The fix is working as intended. Only the scripted calling stations get read, and the change there is small.

## What changed

- `server/src/engine/HorseMind.ts`
  - `breakEvenBluffOf` returns nothing (so the existing price is used) unless that opponent's postflop bluff read is already engaged, which means `postflopBluffMod(opponentRead)` is not null. It asks through `opponentRead`, so a decision with reads off has no break-even read either.
  - `tableExploit`: in a multiway pot, a responder with no break-even read still counts toward the weakest-link limit at its existing price. The break-even price is attached only when it is lower than every unread responder's price.
  - `breakEvenFoldShare(s, e)` is now `s (1 - 2e) / (1 + s - e (1 + 2s))`, the fold share at which a bet does as well as checking. It is `s / (1 + s)` for air (no change) and 0 from half the equity up.
- `server/src/engine/HorseMindBreakEvenBluff.test.ts` (the flag's own unit test from #10042): one assertion pinned the fault itself ("no postflop sample at all: the population, not neutral 1") and now expects no read. The station example plays 20 rounds instead of 10, so its station read engages under the new gate. The semi-bluff example uses the corrected formula. New tests cover the "bet equals check" identity, a short sample not counting as a read, the read switching off with reads off, and the multiway weakest-link rule. On the old code six of these fail, and all 19 pass on the new code.
- The flag's comments in `HorseLogic.ts` and its row in `HorseDataLedger.ts` describe the gate and the corrected formula. `readBreakEvenBluff` stays default OFF, and no league card or standing test was edited.

## Checks

- The six standing tests with the flag forced on (`!== false`, local only, not shipped): all pass. They are HorseOpponentExploitNeutrality.law (20 of 20, coverage over 90%), HorseV54RiverBluff golden (both arms), HorseSkillActivationWiring.law, and HorseOpponentExploitBehavior (24 of 24, the nlh calling station included).
- The full server suite with the flag forced on: 30,988 tests passed and 35 failed, in 9 files. 34 of those failures, in 8 files, fail the same way with the flag off on the same tree. They come from this machine, not the change: the TMPDIR path is too long for a PostgreSQL socket, and some native-worker and subprocess fixtures fail. The one failure caused by the flag is HorseMindReadCalibration's "the default is off" pin, which is the expected result of switching a default and is not needed while it stays off.
- The candidate as shipped (flag off): server `tsc --noEmit` is clean, and the focused suites listed above pass.

## League, re-measured (arm A = flag on, arm B = off; a result counts only when |bb/100| > 2 x stderr)

Seeds 20261110, 20261120 and 20261121, on every card. The pair counts per seed are the same as in the previous run: mirror and human field 6,000 to 12,000, NLH cells 20,000, PLO cells 8,000.

| Card group                                                       | Cards | Result                                                   |
| ---------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| Horse mirror (NLH 2/6/9-max, MTT 40bb, PLO4/5/6 cash and MTT)    | 10    | inert: 0 divergent pairs of 216,000                      |
| Calibrated human field (NLH 6-max, 9-max, heads-up, MTT)         | 4     | inert: 0 divergent pairs of 144,000                      |
| River-bluff cells, horses only ("standard"), NLH and PLO4        | 6     | inert                                                    |
| River-bluff cells, PLO5 and PLO6, every pool                     | 16    | 15 inert; PLO5 tournament mixed +0.18 +/- 0.13 (2 pairs) |
| River-bluff cells, stations / over-folders / mixed, NLH and PLO4 | 18    | 6 inert, 12 inside 2 se                                  |

The cells that moved at all:

| Cell                                     | Pooled bb/100 | stderr       | Divergent pairs | Per seed                                       |
| ---------------------------------------- | ------------- | ------------ | --------------- | ---------------------------------------------- |
| nlh cash stations 2-max                  | +0.52         | 0.38         | 351             | +0.23 +/- 0.59; +0.90 +/- 0.83; +0.42 +/- 0.52 |
| nlh tournament stations 2-max            | +0.25         | 0.41         | 871             | -0.86 +/- 0.75; +0.33 +/- 0.72; +1.28 +/- 0.66 |
| nlh tournament stations 6-max            | +0.24         | 0.18         | 110             | +0.40 +/- 0.32; +0.08 +/- 0.38; +0.25 +/- 0.24 |
| nlh tournament mixed 6-max               | -0.10         | 0.10         | 17              | -0.27 +/- 0.20; -0.15 +/- 0.22; +0.11 +/- 0.07 |
| plo4 tournament folders 6-max            | +0.11         | 0.08         | 2               | +0.00; +0.00; +0.33 +/- 0.24                   |
| nlh cash folders 2-max                   | -0.03         | 0.04         | 3               | +0.00; -0.08 +/- 0.12; +0.00                   |
| nlh cash stations 6-max                  | +0.01         | 0.06         | 20              | +0.14 +/- 0.15; -0.05 +/- 0.06; -0.07 +/- 0.10 |
| nlh cash mixed 6-max                     | +0.00         | 0.02         | 7               | +0.03 +/- 0.03; +0.01 +/- 0.03; -0.03 +/- 0.02 |
| (four more with 1 to 12 divergent pairs) | about 0.0     | 0.00 to 0.06 |                 |                                                |

No card pools significantly positive or negative, and no single seed of any card is significant.

## Exploiter suite (exploiterLeague, 3,000 pairs per cell, memory on, 3 seeds)

All 20 cells were measured: five exploiters (hx_barrel_air, hx_river_overbet, hx_station, calling_station, river_overbettor) at NLH 2-max and 6-max 100bb, PLO4 6-max 100bb and NLH heads-up 40bb. The pooled on-minus-off edge runs from -0.3 to +0.9 bb/100, against standard errors of 3.8 to 59.3. No exploiter earns significantly more with the flag on.

## What would let it ship

The rule is not met: no card is significantly better. If someone wants to try again, the only places the flag acts are tables where a player is credibly read as a station or an over-folder. The closest result was the heads-up cash station cell, at +0.52 +/- 0.38. Measuring those cells on more pairs or more seeds is the next step. The mirror and human-field cards cannot show a gain now, because by design nobody in them gets read.

Evidence, scripts and raw results: `/Volumes/SmarterArchives/agent-evidence/horse-improvements-01Gw7a/read-calibration/break-even-neutral-01BbZP/`.
