# 2026-11-08 - The heads-up tournament bluff loss was noise; break-even bluffing still stays off

## In plain English

Since #10042 the horses have had a better way to decide how often to bluff after the flop: they look at how often this opponent actually folds to a bet after the flop, and at how often a bet of the size they are about to make needs a fold to pay for itself. It shipped switched off, because one test table, heads-up tournament play against other horses, came out losing (-4.21 bb/100 on one run).

That table was re-run on eight more random seeds. It did not lose again in any consistent way: two runs were significantly negative, two were significantly positive, and all nine together average -0.30 +/- 0.61 bb/100, which is no measurable effect. The losing run was noise. Even the same seed moves by about 2 bb/100 when only the hour of day (which sets each horse's mood) changes. Taking the runs apart by street, stack depth and who acted first found no spot that loses on every seed and nothing tied to short tournament stacks, so there was no stack-depth correction to make.

Every other card was then re-run on two more seeds, plus PLO5 and PLO6, plus the exploiter cells (including heads-up 40bb). Nothing pools significantly negative anywhere, and eight cards pool significantly positive. By the league alone, the new bluffing would qualify to be switched on.

**It is still off, and nothing in the horse brain changes in this PR.** Switching it on was tried and the engine's own pre-push checks refused it. Six standing tests fail with it on and pass with it off. The reason is a design problem in #10042, not a test problem: against an opponent the horse has never seen, the new bluffing uses the average player's fold rate, which gives x1.45 bluffing, where every other read the horses have gives x1 (no adjustment). The standing law "a horse that has read nobody plays exactly as it did before it could" forbids that. Fixing it changes what the flag does, so the whole card set would have to be measured again before it could be switched on. That is written down below as the next step.

## What changed

- This changelog only. No code, flag or league card changes. `readBreakEvenBluff` and `readScopedShrink` stay default OFF.

## Why the flag cannot be switched on as it stands

With `readBreakEvenBluff` defaulting to on (`!== false`), the pre-push hook's server suite failed these six, and all six pass with the flag off on the same tree:

- `HorseOpponentExploitNeutrality.law.test.ts`: "nlh tournament: same actions, amounts and random draws while no read is engaged" and "covers nearly the whole corpus with every gate closed" (17 of 18 runs covered).
- `HorseV54RiverBluff.test.ts`: "V54 default off reproduces the brain before it, byte for byte", both arms (golden `plo4_air_no_blocker` digest differs).
- `HorseSkillActivationWiring.law.test.ts`: "the carried turn outlook turns the river check into the planned barrel" (bets 23 where the law expects a check).
- `HorseOpponentExploitBehavior.test.ts`: "nlh calling station: ... strictly fewer bluffs" (153 bluffs with reads against 103 with reads forced off; with the flag off it is 140 against 219).

The cause, from #10042's own code and unit test ("No postflop sample at all: the population, not neutral 1"): `HorseMind.breakEvenBluffOf` answers for every opponent, including one with no postflop sample, and for that opponent it returns the reference multiplier x1.45, while `bluffMod` returns the neutral 1. So with the flag on, decisions against unread opponents change, which is what the neutrality law and the byte-for-byte goldens pin. The break-even read also comes from the decision context's exploit counters, not `opponentRead`, so the behaviour test's "reads off" arm is no longer read-free. That is why the station test's off arm moves from 219 to 103.

What would let it ship (not done here, because it changes the measured strategy):

1. Return neutral (no break-even multiplier, legacy `bluffMod` path) for an opponent below a postflop sample gate, so an unread opponent plays exactly as main. Checked as a quick probe, not shipped: with the flag on and a gate of 8 facing-bet opportunities, five of the six failures pass (both neutrality tests, both V54 goldens, the barrel law).
2. The sixth, the calling-station test, still fails with that gate (153 bluffs against 103). Its "reads off" arm nulls `opponentRead`, but the break-even read comes from the exploit counters, so the comparison arm still bluffs by the read. Either the read has to follow the same off switch, or the test's off arm has to set `readBreakEvenBluff: false` as well; that is a decision for whoever ships the flag.
3. A second issue found on the way: `breakEvenFoldShare(size, equity)` compares a semi-bluff with giving the pot up (EV 0), not with checking (keeping its equity), so a hand with about a third of the equity "needs no folds" and bets at the x1.45 ceiling even into a station. The fold share that matches checking is `s (1 - 2e) / (1 + s - e (1 + 2s))`. A patch with tests is in the evidence folder (`equity-fix.diff`); on its own it does not clear the six failures above.
4. Then re-measure the full card set below on at least two seeds and apply the owner rule again.

## How the negative card was checked

- Reproduced exactly first: seed 20261110 on current main gives -4.21 +/- 2.05 (2,401 divergent pairs), the same as #10042.
- Eight more seeds of the same cell: +1.65, +3.37, -1.70, -4.50, +0.64, -0.59, +4.38, -1.74 (each 20,000 pairs). The spread between seeds (standard deviation 3.1) is 1.7 times what each run's own stderr predicts: the cell is volatile, and its own stderr understates that.
- The same seed with the mood hour pinned to eight different hours: -2.59, -2.84, -2.59, -2.90, -2.78, -0.37, -0.36, -2.65. With both arms the same (both on, or both off) the cell is exactly 0.00 with 0 divergent pairs, so the harness itself is clean.
- Where the negative seeds lost (seven seeds taken apart by the first action that differs between the arms): the largest piece in each was in a different place, often a hand where the horse opponent acted differently first (it had read the hero differently), and the hero's flop and turn bets carried no consistent sign. Shallow stacks did not stand out: hero spots with a stack-to-pot ratio under 3 were small and mixed. The #10042 guess that tournament chips make the break-even too low is not supported either: the 6-max tournament cells, the mid-field MTT mirror (six seeds, +0.04 +/- 0.09) and the human-field MTT card (six seeds, -0.15 +/- 0.27) are flat or positive.
- The one pattern that leaned the same way: on the river, where main's river bluff baseline bets air and the flag's lower multiplier checks instead, the flag gave up 0.2 to 1.4 bb/100 on six of the seven seeds. It is small, it sits inside the cell's own noise, and the cell as a whole pools flat.

Evidence, scripts and raw results: `/Volumes/SmarterArchives/agent-evidence/horse-improvements-01Gw7a/read-calibration/break-even-retune-01BbZP/`.

## League table (arm A = flag on, arm B = main with it off; claim only |bb/100| > 2 x stderr)

Seed 20261110 is #10042's run (copied from its evidence); 20261120 and 20261121 are new, and the heads-up tournament horse-field cell has nine seeds (20261110, 20261112 to 20261117, 20261120, 20261121). PLO5 and PLO6 were not in #10042's set and were added. Pooled = pair-weighted mean; pooled stderr from the per-seed stderrs. Mirror = HorseLeague runMatchup (all horses); human field = the same card against the calibrated human population; cell = RiverBluffBaselineLeague, one hero horse (standard = horses, mixed = horses + calibrated humans + station + over-folder). All runs on main with the flag default OFF, arm A `{ readBreakEvenBluff: true }`, arm B `{}`.

| Card                           | Harness     | Seeds | Pairs   | Pooled bb/100 | stderr | Divergent pairs | Verdict     | Per seed (bb/100 ± se)                                                                                                                                                           |
| ------------------------------ | ----------- | ----- | ------- | ------------- | ------ | --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| break_even_bluff               | mirror      | 3     | 36,000  | +0.14         | 0.19   | 114             | inside 2 se | +0.57 ± 0.42; +0.13 ± 0.33; -0.27 ± 0.17                                                                                                                                         |
| full_break_even_bluff          | mirror      | 3     | 18,000  | -0.06         | 0.19   | 62              | inside 2 se | -0.08 ± 0.32; -0.28 ± 0.30; +0.19 ± 0.36                                                                                                                                         |
| hu_break_even_bluff            | mirror      | 3     | 36,000  | +2.72         | 0.97   | 949             | positive    | +0.37 ± 1.72; +2.26 ± 0.76 **positive**; +5.53 ± 2.23 **positive**                                                                                                               |
| mtt_break_even_bluff           | mirror      | 6     | 36,000  | +0.04         | 0.09   | 119             | inside 2 se | -0.05 ± 0.17; +0.00 ± 0.23; +0.16 ± 0.28; -0.08 ± 0.13; +0.28 ± 0.11 **positive**; -0.08 ± 0.34                                                                                  |
| plo4_break_even_bluff          | mirror      | 3     | 18,000  | -0.17         | 0.21   | 149             | inside 2 se | -0.50 ± 0.26; +0.39 ± 0.24; -0.39 ± 0.51                                                                                                                                         |
| plo4_mtt_break_even_bluff      | mirror      | 3     | 18,000  | -0.02         | 0.06   | 8               | inside 2 se | -0.08 ± 0.13; +0.00 ± 0.03; +0.03 ± 0.11                                                                                                                                         |
| plo5_break_even_bluff          | mirror      | 2     | 12,000  | +0.18         | 0.59   | 226             | inside 2 se | +0.04 ± 0.82; +0.32 ± 0.84                                                                                                                                                       |
| plo5_mtt_break_even_bluff      | mirror      | 2     | 12,000  | -0.43         | 0.28   | 52              | inside 2 se | -0.42 ± 0.47; -0.43 ± 0.29                                                                                                                                                       |
| plo6_break_even_bluff          | mirror      | 2     | 12,000  | +1.23         | 0.96   | 369             | inside 2 se | +2.00 ± 1.51; +0.46 ± 1.19                                                                                                                                                       |
| plo6_mtt_break_even_bluff      | mirror      | 2     | 12,000  | -0.10         | 0.52   | 205             | inside 2 se | -0.03 ± 0.54; -0.16 ± 0.89                                                                                                                                                       |
| read_scoped_shrink             | mirror      | 1     | 12,000  | +0.00         | 0.00   | 0               | inert       | +0.00 ± 0.00                                                                                                                                                                     |
| human_break_even_bluff         | human field | 3     | 36,000  | +0.34         | 0.44   | 86              | inside 2 se | -0.82 ± 0.76; +0.97 ± 0.93; +0.88 ± 0.56                                                                                                                                         |
| human_full_break_even_bluff    | human field | 3     | 36,000  | -0.27         | 0.24   | 35              | inside 2 se | -0.34 ± 0.34; -0.48 ± 0.37; +0.01 ± 0.53                                                                                                                                         |
| human_hu_break_even_bluff      | human field | 3     | 36,000  | +0.18         | 0.43   | 189             | inside 2 se | +1.03 ± 0.91; +0.06 ± 0.72; -0.54 ± 0.57                                                                                                                                         |
| human_mtt_break_even_bluff     | human field | 6     | 72,000  | -0.15         | 0.27   | 259             | inside 2 se | -1.06 ± 0.75; -0.21 ± 0.63; -0.74 ± 0.64; +0.05 ± 0.64; +0.71 ± 0.77; +0.33 ± 0.51                                                                                               |
| nlh cash folders 2-max         | cell        | 3     | 60,000  | +0.01         | 0.05   | 7               | inside 2 se | +0.09 ± 0.07; -0.08 ± 0.12; +0.00 ± 0.00                                                                                                                                         |
| nlh cash folders 6-max         | cell        | 3     | 60,000  | +0.89         | 0.40   | 114             | positive    | +0.73 ± 0.77; +0.34 ± 0.47; +1.61 ± 0.79 **positive**                                                                                                                            |
| nlh cash mixed 2-max           | cell        | 3     | 60,000  | +1.62         | 0.51   | 548             | positive    | +1.01 ± 0.56; +2.40 ± 1.18 **positive**; +1.45 ± 0.80                                                                                                                            |
| nlh cash mixed 6-max           | cell        | 3     | 60,000  | +0.43         | 0.38   | 113             | inside 2 se | +1.15 ± 0.75; +0.92 ± 0.65; -0.78 ± 0.55                                                                                                                                         |
| nlh cash standard 2-max        | cell        | 3     | 60,000  | +0.41         | 0.39   | 357             | inside 2 se | +0.53 ± 0.62; +0.18 ± 0.89; +0.53 ± 0.44                                                                                                                                         |
| nlh cash standard 6-max        | cell        | 3     | 60,000  | -0.39         | 0.30   | 24              | inside 2 se | +0.07 ± 0.07; -1.23 ± 0.81; -0.01 ± 0.39                                                                                                                                         |
| nlh cash stations 2-max        | cell        | 3     | 60,000  | +0.28         | 0.59   | 732             | inside 2 se | -0.09 ± 0.80; +1.72 ± 1.10; -0.79 ± 1.11                                                                                                                                         |
| nlh cash stations 6-max        | cell        | 3     | 60,000  | +0.03         | 0.20   | 118             | inside 2 se | -0.45 ± 0.36; +0.37 ± 0.34; +0.16 ± 0.36                                                                                                                                         |
| nlh tournament folders 2-max   | cell        | 3     | 60,000  | -0.06         | 0.08   | 11              | inside 2 se | +0.01 ± 0.02; -0.25 ± 0.23; +0.06 ± 0.09                                                                                                                                         |
| nlh tournament folders 6-max   | cell        | 3     | 60,000  | +1.04         | 0.32   | 180             | positive    | +1.97 ± 0.60 **positive**; +0.77 ± 0.50; +0.39 ± 0.56                                                                                                                            |
| nlh tournament mixed 2-max     | cell        | 3     | 60,000  | +2.29         | 0.46   | 1,789           | positive    | +2.52 ± 0.71 **positive**; +2.38 ± 0.76 **positive**; +1.97 ± 0.89 **positive**                                                                                                  |
| nlh tournament mixed 6-max     | cell        | 3     | 60,000  | +0.02         | 0.40   | 231             | inside 2 se | -0.23 ± 0.68; +0.55 ± 0.84; -0.25 ± 0.56                                                                                                                                         |
| nlh tournament standard 2-max  | cell        | 9     | 180,000 | -0.30         | 0.61   | 14,966          | inside 2 se | -4.21 ± 2.05 **NEGATIVE**; +1.65 ± 1.06; +3.37 ± 1.31 **positive**; -1.70 ± 1.79; -4.50 ± 2.00 **NEGATIVE**; +0.64 ± 2.27; -0.59 ± 1.67; +4.38 ± 1.75 **positive**; -1.74 ± 2.17 |
| nlh tournament standard 6-max  | cell        | 3     | 60,000  | +0.31         | 0.22   | 81              | inside 2 se | +0.72 ± 0.58; -0.08 ± 0.22; +0.27 ± 0.26                                                                                                                                         |
| nlh tournament stations 2-max  | cell        | 3     | 60,000  | +0.39         | 0.48   | 1,366           | inside 2 se | -0.75 ± 0.89; +0.13 ± 0.76; +1.80 ± 0.85 **positive**                                                                                                                            |
| nlh tournament stations 6-max  | cell        | 3     | 60,000  | +0.68         | 0.33   | 354             | positive    | +0.30 ± 0.50; +0.91 ± 0.67; +0.83 ± 0.52                                                                                                                                         |
| plo4 cash folders 6-max        | cell        | 3     | 24,000  | -0.50         | 0.41   | 3               | inside 2 se | +0.00 ± 0.00; -1.51 ± 1.24; +0.00 ± 0.00                                                                                                                                         |
| plo4 cash mixed 6-max          | cell        | 3     | 24,000  | -0.15         | 0.19   | 3               | inside 2 se | -0.03 ± 0.02; -0.55 ± 0.55; +0.13 ± 0.13                                                                                                                                         |
| plo4 cash standard 6-max       | cell        | 3     | 24,000  | -0.80         | 0.61   | 16              | inside 2 se | -1.19 ± 0.91; +0.53 ± 1.11; -1.75 ± 1.14                                                                                                                                         |
| plo4 cash stations 6-max       | cell        | 3     | 24,000  | +2.16         | 2.10   | 4               | inside 2 se | -0.07 ± 0.07; +0.25 ± 0.19; +6.29 ± 6.29                                                                                                                                         |
| plo4 tournament folders 6-max  | cell        | 3     | 24,000  | +0.15         | 0.09   | 3               | inside 2 se | +0.12 ± 0.13; +0.00 ± 0.00; +0.33 ± 0.24                                                                                                                                         |
| plo4 tournament mixed 6-max    | cell        | 3     | 24,000  | +0.11         | 0.13   | 6               | inside 2 se | -0.01 ± 0.01; +0.05 ± 0.08; +0.30 ± 0.38                                                                                                                                         |
| plo4 tournament standard 6-max | cell        | 3     | 24,000  | +0.06         | 0.11   | 4               | inside 2 se | +0.03 ± 0.02; +0.00 ± 0.00; +0.14 ± 0.32                                                                                                                                         |
| plo4 tournament stations 6-max | cell        | 3     | 24,000  | +0.58         | 0.26   | 10              | positive    | +0.36 ± 0.45; +1.10 ± 0.58; +0.27 ± 0.27                                                                                                                                         |
| plo5 cash folders 6-max        | cell        | 2     | 16,000  | -0.20         | 0.70   | 6               | inside 2 se | -0.46 ± 0.46; +0.05 ± 1.32                                                                                                                                                       |
| plo5 cash mixed 6-max          | cell        | 2     | 16,000  | +0.13         | 0.31   | 5               | inside 2 se | -0.43 ± 0.36; +0.69 ± 0.50                                                                                                                                                       |
| plo5 cash standard 6-max       | cell        | 2     | 16,000  | -0.26         | 0.26   | 3               | inside 2 se | +0.00 ± 0.00; -0.52 ± 0.53                                                                                                                                                       |
| plo5 cash stations 6-max       | cell        | 2     | 16,000  | +0.07         | 0.05   | 2               | inside 2 se | +0.14 ± 0.10; +0.00 ± 0.00                                                                                                                                                       |
| plo5 tournament folders 6-max  | cell        | 2     | 16,000  | -0.58         | 0.29   | 6               | inside 2 se | -0.38 ± 0.33; -0.78 ± 0.48                                                                                                                                                       |
| plo5 tournament mixed 6-max    | cell        | 2     | 16,000  | +0.00         | 0.00   | 2               | inside 2 se | +0.00 ± 0.00; +0.00 ± 0.01                                                                                                                                                       |
| plo5 tournament standard 6-max | cell        | 2     | 16,000  | +0.15         | 0.25   | 6               | inside 2 se | +0.18 ± 0.47; +0.12 ± 0.13                                                                                                                                                       |
| plo5 tournament stations 6-max | cell        | 2     | 16,000  | +0.03         | 0.02   | 2               | inside 2 se | +0.03 ± 0.03; +0.03 ± 0.03                                                                                                                                                       |
| plo6 cash folders 6-max        | cell        | 2     | 16,000  | +0.77         | 0.68   | 2               | inside 2 se | +0.00 ± 0.00; +1.54 ± 1.36                                                                                                                                                       |
| plo6 cash mixed 6-max          | cell        | 2     | 16,000  | -0.24         | 0.27   | 3               | inside 2 se | +0.21 ± 0.21; -0.69 ± 0.51                                                                                                                                                       |
| plo6 cash standard 6-max       | cell        | 2     | 16,000  | +1.29         | 1.23   | 22              | inside 2 se | +1.20 ± 1.10; +1.39 ± 2.20                                                                                                                                                       |
| plo6 cash stations 6-max       | cell        | 2     | 16,000  | +1.01         | 0.69   | 14              | inside 2 se | -0.27 ± 0.30; +2.28 ± 1.35                                                                                                                                                       |
| plo6 tournament folders 6-max  | cell        | 2     | 16,000  | +0.54         | 0.47   | 4               | inside 2 se | -0.28 ± 0.28; +1.37 ± 0.89                                                                                                                                                       |
| plo6 tournament mixed 6-max    | cell        | 2     | 16,000  | +0.00         | 0.00   | 0               | inert       | +0.00 ± 0.00; +0.00 ± 0.00                                                                                                                                                       |
| plo6 tournament standard 6-max | cell        | 2     | 16,000  | +1.85         | 0.87   | 55              | positive    | +2.48 ± 1.50; +1.23 ± 0.90                                                                                                                                                       |
| plo6 tournament stations 6-max | cell        | 2     | 16,000  | +0.31         | 0.29   | 13              | inside 2 se | +0.19 ± 0.53; +0.43 ± 0.25                                                                                                                                                       |

Eight cards pool significantly positive: NLH heads-up mirror +2.72 +/- 0.97, NLH heads-up tournament mixed +2.29 +/- 0.46 (positive on all three seeds), NLH heads-up cash mixed +1.62 +/- 0.51, NLH 6-max tournament over-folders +1.04 +/- 0.32, NLH 6-max cash over-folders +0.89 +/- 0.40, NLH 6-max tournament stations +0.68 +/- 0.33, PLO4 6-max tournament stations +0.58 +/- 0.26, PLO6 6-max tournament standard +1.85 +/- 0.87. None pools significantly negative. Single seeds outside 2 stderr on the negative side: only the heads-up tournament horse-field cell (20261110 and 20261115), whose nine seeds pool to -0.30 +/- 0.61 (between-seed standard error 1.03).

## Exploiter suite, flag on vs off

`exploiterLeague.ts`, 3,000 pairs per cell, memory on, exploiters hx_barrel_air, hx_river_overbet, hx_station, calling_station, river_overbettor. Edge = what the exploiter earns over a production horse in its seat (bb/100). The on/off difference's stderr is the conservative unpaired one. A positive difference would mean the flag opens a leak.

| Exploiter, format                              | Seed     | Edge, flag off | Edge, flag on  | On minus off (unpaired se) |
| ---------------------------------------------- | -------- | -------------- | -------------- | -------------------------- |
| calling station nlh 2max                       | 20261110 | -528.5 ± 41.3  | -536.0 ± 41.4  | -7.5 ± 58.5                |
| calling station nlh 2max                       | 20261120 | -592.4 ± 41.6  | -594.8 ± 41.6  | -2.4 ± 58.9                |
| calling station nlh 2max                       | 20261121 | -564.0 ± 40.4  | -553.4 ± 40.4  | +10.6 ± 57.1               |
| **calling station nlh 2max, 3 seeds pooled**   |          |                |                | **+0.2 ± 33.6**            |
| calling station nlh 6max                       | 20261110 | -1197.1 ± 73.0 | -1196.2 ± 73.1 | +0.9 ± 103.4               |
| calling station nlh 6max                       | 20261120 | -1115.6 ± 73.2 | -1116.4 ± 73.3 | -0.8 ± 103.6               |
| calling station nlh 6max                       | 20261121 | -1086.7 ± 72.5 | -1083.3 ± 72.6 | +3.4 ± 102.6               |
| **calling station nlh 6max, 3 seeds pooled**   |          |                |                | **+1.2 ± 59.6**            |
| calling station plo4 6max                      | 20261110 | -671.4 ± 56.6  | -670.3 ± 56.6  | +1.1 ± 80.1                |
| calling station plo4 6max                      | 20261120 | -766.8 ± 59.4  | -766.8 ± 59.4  | +0.0 ± 84.0                |
| calling station plo4 6max                      | 20261121 | -645.0 ± 60.7  | -643.7 ± 60.7  | +1.4 ± 85.8                |
| **calling station plo4 6max, 3 seeds pooled**  |          |                |                | **+0.8 ± 48.1**            |
| hx barrel air nlh 2max                         | 20261110 | +17.0 ± 7.8    | +6.9 ± 8.4     | -10.1 ± 11.5               |
| hx barrel air nlh 2max                         | 20261120 | +2.9 ± 6.0     | +3.4 ± 6.3     | +0.6 ± 8.7                 |
| hx barrel air nlh 2max                         | 20261121 | +3.5 ± 8.3     | +14.1 ± 9.1    | +10.6 ± 12.4               |
| **hx barrel air nlh 2max, 3 seeds pooled**     |          |                |                | **+0.4 ± 6.3**             |
| hx barrel air nlh 6max                         | 20261110 | +6.5 ± 5.4     | +6.5 ± 5.4     | +0.0 ± 7.7                 |
| hx barrel air nlh 6max                         | 20261120 | -0.7 ± 4.6     | -1.5 ± 5.3     | -0.8 ± 7.0                 |
| hx barrel air nlh 6max                         | 20261121 | +1.9 ± 1.1     | +1.6 ± 1.0     | -0.3 ± 1.5                 |
| **hx barrel air nlh 6max, 3 seeds pooled**     |          |                |                | **-0.4 ± 3.5**             |
| hx barrel air plo4 6max                        | 20261110 | +20.2 ± 8.6    | +21.1 ± 8.6    | +0.8 ± 12.2                |
| hx barrel air plo4 6max                        | 20261120 | -5.4 ± 8.6     | -5.4 ± 8.6     | +0.0 ± 12.2                |
| hx barrel air plo4 6max                        | 20261121 | +0.6 ± 5.8     | -1.1 ± 5.9     | -1.7 ± 8.3                 |
| **hx barrel air plo4 6max, 3 seeds pooled**    |          |                |                | **-0.3 ± 6.4**             |
| hx river overbet nlh 2max                      | 20261110 | +15.2 ± 8.8    | +2.1 ± 9.6     | -13.1 ± 13.0               |
| hx river overbet nlh 2max                      | 20261120 | +1.7 ± 5.5     | -2.2 ± 6.4     | -3.9 ± 8.4                 |
| hx river overbet nlh 2max                      | 20261121 | -6.0 ± 8.9     | +5.9 ± 9.7     | +11.9 ± 13.2               |
| **hx river overbet nlh 2max, 3 seeds pooled**  |          |                |                | **-1.7 ± 6.8**             |
| hx river overbet nlh 6max                      | 20261110 | +14.0 ± 6.4    | +14.0 ± 6.4    | +0.0 ± 9.0                 |
| hx river overbet nlh 6max                      | 20261120 | -12.7 ± 7.2    | -12.5 ± 7.5    | +0.3 ± 10.4                |
| hx river overbet nlh 6max                      | 20261121 | +1.0 ± 4.6     | +1.9 ± 4.5     | +0.9 ± 6.4                 |
| **hx river overbet nlh 6max, 3 seeds pooled**  |          |                |                | **+0.4 ± 5.1**             |
| hx river overbet plo4 6max                     | 20261110 | +16.7 ± 9.4    | +20.4 ± 9.0    | +3.7 ± 13.0                |
| hx river overbet plo4 6max                     | 20261120 | +6.5 ± 7.9     | +6.5 ± 7.9     | +0.0 ± 11.1                |
| hx river overbet plo4 6max                     | 20261121 | +18.3 ± 8.1    | +18.4 ± 7.9    | +0.1 ± 11.3                |
| **hx river overbet plo4 6max, 3 seeds pooled** |          |                |                | **+1.2 ± 6.8**             |
| hx station nlh 2max                            | 20261110 | -271.6 ± 28.8  | -281.0 ± 29.0  | -9.4 ± 40.8                |
| hx station nlh 2max                            | 20261120 | -289.2 ± 28.6  | -288.0 ± 28.6  | +1.2 ± 40.5                |
| hx station nlh 2max                            | 20261121 | -268.7 ± 26.7  | -262.0 ± 26.5  | +6.7 ± 37.6                |
| **hx station nlh 2max, 3 seeds pooled**        |          |                |                | **-0.5 ± 22.9**            |
| hx station nlh 6max                            | 20261110 | -142.9 ± 24.8  | -141.7 ± 23.7  | +1.2 ± 34.3                |
| hx station nlh 6max                            | 20261120 | -118.2 ± 19.1  | -115.2 ± 18.6  | +3.1 ± 26.7                |
| hx station nlh 6max                            | 20261121 | -91.0 ± 18.9   | -82.5 ± 18.2   | +8.5 ± 26.3                |
| **hx station nlh 6max, 3 seeds pooled**        |          |                |                | **+4.2 ± 16.9**            |
| hx station plo4 6max                           | 20261110 | -252.1 ± 35.8  | -251.2 ± 35.8  | +0.8 ± 50.6                |
| hx station plo4 6max                           | 20261120 | -327.8 ± 36.5  | -327.6 ± 36.5  | +0.1 ± 51.6                |
| hx station plo4 6max                           | 20261121 | -331.5 ± 37.8  | -333.6 ± 37.9  | -2.1 ± 53.5                |
| **hx station plo4 6max, 3 seeds pooled**       |          |                |                | **-0.4 ± 30.0**            |
| river overbettor nlh 2max                      | 20261110 | -48.9 ± 19.3   | -58.9 ± 19.4   | -10.0 ± 27.3               |
| river overbettor nlh 2max                      | 20261120 | -39.2 ± 17.8   | -44.0 ± 17.9   | -4.8 ± 25.2                |
| river overbettor nlh 2max                      | 20261121 | -30.2 ± 17.4   | -20.2 ± 17.1   | +10.0 ± 24.4               |
| **river overbettor nlh 2max, 3 seeds pooled**  |          |                |                | **-1.6 ± 14.8**            |
| river overbettor nlh 6max                      | 20261110 | -46.1 ± 22.5   | -48.2 ± 22.5   | -2.1 ± 31.8                |
| river overbettor nlh 6max                      | 20261120 | -56.6 ± 23.3   | -53.8 ± 23.2   | +2.8 ± 32.9                |
| river overbettor nlh 6max                      | 20261121 | -43.4 ± 21.3   | -40.1 ± 21.0   | +3.3 ± 29.9                |
| **river overbettor nlh 6max, 3 seeds pooled**  |          |                |                | **+1.3 ± 18.2**            |
| river overbettor plo4 6max                     | 20261110 | -29.6 ± 28.7   | -29.7 ± 28.7   | -0.1 ± 40.6                |
| river overbettor plo4 6max                     | 20261120 | +6.8 ± 29.9    | +6.7 ± 29.9    | -0.1 ± 42.3                |
| river overbettor plo4 6max                     | 20261121 | -24.4 ± 25.2   | -25.8 ± 25.1   | -1.4 ± 35.6                |
| **river overbettor plo4 6max, 3 seeds pooled** |          |                |                | **-0.6 ± 22.9**            |

Heads-up 40bb (new; the shallow tournament-like depth):

| Exploiter, NLH heads-up 40bb         | Seed     | Edge, flag off | Edge, flag on | On minus off (unpaired se) |
| ------------------------------------ | -------- | -------------- | ------------- | -------------------------- |
| calling station                      | 20261120 | -329.7 ± 22.8  | -330.8 ± 22.8 | -1.1 ± 32.3                |
| hx barrel air                        | 20261120 | +5.8 ± 5.3     | +7.9 ± 5.2    | +2.1 ± 7.4                 |
| hx river overbet                     | 20261120 | +3.4 ± 5.0     | +2.6 ± 4.6    | -0.8 ± 6.8                 |
| hx station                           | 20261120 | -140.4 ± 15.4  | -140.9 ± 15.4 | -0.5 ± 21.8                |
| river overbettor                     | 20261120 | -1.4 ± 10.8    | -2.2 ± 10.7   | -0.8 ± 15.2                |
| calling station                      | 20261121 | -315.8 ± 23.0  | -311.1 ± 23.2 | +4.7 ± 32.7                |
| hx barrel air                        | 20261121 | +4.8 ± 5.9     | +5.9 ± 6.0    | +1.1 ± 8.4                 |
| hx river overbet                     | 20261121 | +4.9 ± 6.5     | +7.6 ± 6.4    | +2.7 ± 9.1                 |
| hx station                           | 20261121 | -147.3 ± 14.5  | -142.4 ± 14.6 | +4.9 ± 20.5                |
| river overbettor                     | 20261121 | -9.5 ± 11.1    | -3.0 ± 11.2   | +6.5 ± 15.8                |
| **calling station, 2 seeds pooled**  |          |                |               | **+1.8 ± 23.0**            |
| **hx barrel air, 2 seeds pooled**    |          |                |               | **+1.6 ± 5.6**             |
| **hx river overbet, 2 seeds pooled** |          |                |               | **+0.9 ± 5.7**             |
| **hx station, 2 seeds pooled**       |          |                |               | **+2.2 ± 15.0**            |
| **river overbettor, 2 seeds pooled** |          |                |               | **+2.9 ± 11.0**            |

No exploiter earns significantly more with the flag on in any format, at 100bb or 40bb.
