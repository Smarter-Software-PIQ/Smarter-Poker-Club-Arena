# fixedLimitPopulationCells (pull request not yet opened; branch agent/fixed-limit-population-cells-01BbZPDh)

A decide option read as `=== true`, built DEFAULT OFF and scoped by code to fixed-limit hold'em cash tables (`FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE = {flh}` in `HorseOpponentExploit.ts`; HorseLogic adds it to a decision's read options only when `!isTournamentMode`, the same cash/tournament test W5 uses). This file is the evidence for a later change that would turn it on at flh cash; it turns nothing on. It moves tight-player reads that feed preflop decisions (tight-opener and tight-reraiser respect), so it falls under the owner's preflop range hold (see Turning it on). Evaluation: agent evidence `fixed-limit-01Gw7aDr/AB-0.19-PREDECLARATION.md`, results `AB-EVALUATION-2.md` section 3.13.

## Mechanism

Status: MET

`exploitEnvelopeFor` (`server/src/engine/HorseOpponentExploit.ts`) returns the Horse population cell an opponent's style and exploit reads are judged against. With the option on, a fixed-limit hold'em cash decision reads `FIXED_LIMIT_POPULATION_ENVELOPE['flh:' + size]` (version `fixed-limit-population-2026-11-16`) instead of the 2026-10-16 cell. Example at full-ring flh: VPIP mean 0.214 with band [0.135, 0.322], PFR 0.107 [0.068, 0.158], measured from 40,670 hands and 455 Horses. Thresholds, margins, minimum hands and credibility are unchanged. Pinned in `AFixedLimitPopulationCells.law.test.ts` law (1).

## Input fidelity

Status: MET (with stated hand-supplied parts)

The cells are measured from 107,538 recorded Horse-only fixed-limit cash hands (2026-11-09T04:00Z to 2026-11-16T04:00Z, public actions only), through the same increments, opportunity-scoped decay and long window the live learner uses. The evaluation is a paired two-arm simulation on the real HandController and HorseLogic.decide with the production hybrid cash profile, memory on with the production feed, live stack quantiles and small-blind mix (configuration C2 of AB-EVALUATION-2.md), the probe switch on in both arms. Supplied by hand: scripted opponents (true tight `tt`, measured VPIP 0.092 at flh 6 and 0.098 at flh 9; tight-passive; tight-value; loose-passive; maniac) or baseline Horses, and one decision hour.

## Value

Status: PASS as pre-declared under rule 0.19, but that verdict pooled the three tt cells including flo8, which is now out of scope; the flh cells pass individually; the flh-only pool is a post-hoc diagnostic; the pre-declared engagement check used the participation count only, and on the tight-reraiser count the flh 6 Horse-field false-positive control rose 3.2 % of decisions, above the rule's 1 % line (not part of the pre-declared check; see Limits)

- The flh true-tight cells each pass on their own, more than 2 SE above zero: flh 6 +0.26 +/- 0.08, flh 9 +0.21 +/- 0.09.
- The pre-declared 0.19 PASS (+0.16 +/- 0.05) pooled the three tt cells, flo8 6 included; flo8 is now out of scope by code. The flh-only pool (+0.23 +/- 0.06) was chosen after the results were read, so it is a post-hoc diagnostic, not a new PASS.
- The pre-declared engagement check counted "a hero decision with any live opponent read tight" (the participation read) and passed on that count. On the tight-reraiser count, the flh 6 Horse-field cell, a false-positive control, rose from 104 to 528 hero decisions (+424, 3.2 % of 13,319 decisions), above the rule's 1 % line. That count was not part of the pre-declared check, so it decides nothing under 0.19; it is recorded under Limits.

Validated portion, BB per 100 hands, arm A option on minus arm B off, 70 s cells (AB-EVALUATION-2 3.13; the flh results stand for the scoped head: identical deals, see Reach):

| Opponent                 | flh 6 seats      | flh 9 seats      |
| ------------------------ | ---------------- | ---------------- |
| true tight (target)      | +0.26 +/- 0.08   | +0.21 +/- 0.09   |
| tight-passive            | -0.05 +/- 0.06   | -0.01 +/- 0.01   |
| tight-value (value only) | -0.04 +/- 0.51   | -0.41 +/- 0.86   |
| Horse field              | +0.02 +/- 0.01   | -0.26 +/- 0.20   |
| loose-passive            | +0.29 +/- 0.85   | +1.05 +/- 0.76   |
| maniac (harm control)    | +12.16 +/- 10.81 | +45.26 +/- 19.88 |

No flh cell is below -1 - 2 SE (no HARM).

Engagement (the declared count, a hero decision with any live opponent read tight, arm A minus arm B): flh 6 tt +124 (+0.29 % of decisions), flh 9 tt +46 (+0.12 %); Horse field -346 and -1,245; loose-passive +4 (+0.03 %) and -1. The split by seat read (diagnostic): the tt script is read tight in about 92 % of hero decisions in both arms; the option's large effect is removing tight reads of Horse seats (-4.1 % and -13.6 % of decisions in the Horse-field cells) and of the tight-passive and tight-value scripts.

Where the option RAISES a tight read (AB-EVALUATION-2 3.13, arm A on against arm B off):

- Tight-reraiser respect rises. The measured three-bet cell means are higher than today's at every flh size (heads-up 0.0897 -> 0.0997, short-handed 0.0623 -> 0.0762, full ring 0.0347 -> 0.0527), so "three-bet credibly low" fires more easily. flh 6 against the Horse field (a false-positive control): 528 hero decisions on against 104 off (+424, 3.2 % of decisions). flh 6 against tight-passive: 26,288 against 25,338; flh 9 against tight-passive: 22,442 against 21,855.
- Tight reads of a Horse seat rise at flh 6 against tight-passive: 252 -> 885 hero decisions (+633, +8.46 % of decisions; 3.13 diagnostic); at flh 6 against tt they rise by 96 (3,154 -> 3,250).
- Tight-opener respect against the TRUE-TIGHT target falls: flh 6 tt 23,216 on against 39,048 off, flh 9 tt 24,454 against 35,274 (3.13 cells); 6,793 against 10,823 and 7,023 against 9,303 in the diagnostic. Tight-reraiser respect against tt falls too (flh 6 24,036 against 38,855; flh 9 25,192 against 35,141). So the measured gain against tt comes with LESS preflop respect for a genuinely tight opener, not more; the owner needs this in front of him when deciding on the preflop hold.
- Every flh statistic moves, not only the tight reads: the option swaps the whole envelope. Examples at the frozen census, full-ring flh (checked at this head): the fold-to-3-bet mean goes from 0.5609 (today's family cell) to 0.0032; census Horses read loose go from 53 to 74 (short-handed 1 -> 6); the exploit read engages on census Horses where today's cells engage on none (short-handed 0 -> 2, full ring 0 -> 1). The independent review's probe also found a loose synthetic profile read loose at 80 hands in 43 runs on against 26 off. No law bounds loose, postflop or exploit-read movement; the maniac gains above (+12.16 and +45.26, wide errors) come through this route.

flo8, measured and out of scope by code: tt -0.14 +/- 0.13, tight-passive +0.19 +/- 0.12, tight-value +1.27 +/- 0.57, Horse field -2.29 +/- 0.71 (3.2 SE below zero, 0.13 above the harm line, 1,801 deals), loose-passive +1.69 +/- 0.87, maniac +28.60 +/- 20.66. The Horse-field loss is almost all preflop (-1.92 of -2.29 on the first-divergence class p). The read that changes there is the participation read of the Horse seats: tight labels on Horse seats fall from 1,437 to 1,081 hero decisions (-22.5 %), while tight-opener and tight-reraiser respect are zero in both arms (they never act in an Omaha scope). The preflop money therefore moves through the other readers of the same envelope (the exploit read and the Omaha opponent read); this diagnostic does not isolate which.

## Continuation

Status: NOT APPLICABLE as a single node

The option moves a read, not one action; continuation is inside the paired whole-hand simulation above (every street played out by HandController and both arms' brains).

## Reach

Status: MET

Deals whose actions differ between the arms at flh: 1.1 % and 1.5 % against the tight script, 0.6 % and 0.1 % against tight-passive, 0.1 % and 2.5 % against the Horse field, 6.0-16.2 % against tight-value and loose-passive, 44.5 % and 73.4 % against the maniac. Option-off identity with main: 300 deals at flh six seats, arm B records identical. Scoped head against the evaluated head: league v4b flh 6 and flh 9 cells against tt and the Horse field, seeds 1:300, identical deals (AB-EVALUATION-2 0.19 scope record); the cash-only head against the scoped head: the same eight runs, identical deals, nets and cards (AR-P3-POPULATION-CELLS.md, section of 2026-11-16 after the independent review).

Census, a property of the frozen census snapshot only: at the frozen census (every Horse's own counters at the end of the export window), ON labels no more players tight than OFF for each tight read (full ring participation tight 35.2 % -> 18.2 %, tight-opener 14.1 % -> 0.9 %, tight-reraiser 69 -> 17 of 455 Horses). This is not a claim about play: in play and on early samples tight-reraiser respect reaches MORE players with the option on (Value, above). Exact census counts (law (2b), on / off, of flh full ring's 455 Horses): participation tight 83 / 160, tight-opener 4 / 64, tight-reraiser 17 / 69, isValueBettor 117 / 264, tightPassiveFolder 5 / 24, tightNotAggressive 75 / 155; flh short-handed (356): 14 / 29, 1 / 4, 11 / 12, 24 / 26, 1 / 0, 10 / 21; flh heads-up (189): 2 / 5, 0 / 0, 3 / 3, 5 / 5, 0 / 0, 2 / 5. One downstream consumer rises at the census: tightPassiveFolder at flh short-handed, 0 -> 1.

Early samples (law (3b), seeded full-ring flh preflop histories, 150 runs per profile, a Horse opening in front on 40 % of hands; runs with tight-reraiser respect on, option on / off, with the runs on only with the option on in brackets): engaged at hand 40: tight profile 58 / 89 (4), Horse-like profile (VPIP 0.21) 6 / 11 (2), loose profile (VPIP 0.30) 2 / 1 (2); engaged at hand 60: tight 85 / 111 (8), Horse-like 31 / 27 (15), loose 24 / 4 (20). The sample gates are identical with the option on and off (15 decayed hands before any side, 8 three-bet opportunities before the three-bet side): with too few hands neither arm fires. The independent review's own probe, with a different history generator, found tight-reraiser respect on at 40 hands in 28 Horse-like runs on against 16 off and 17 loose runs against 4.

## Scope

Status: MET

Only fixed-limit hold'em CASH decisions, at every table size. Tournament flh is inert by code: HorseLogic adds the option only when `!isTournamentMode` (the W5 test), so at a tournament table every read is main's envelope and names main's version, and a seeded flh tournament decision stream is identical with the option on and off (law (6)). The cells are cash hands only (`tournament_id is null`); a tournament use would need its own cells and its own evaluation. flo8 is inert by code (law (5): main's envelope, every census read and seeded cash and tournament decision streams equal to the option off). Every no-limit and pot-limit read is byte-identical (law (1), all variants and sizes, and a stubbed non-fixed-limit structure).

## Visibility

Status: MET

Receipt `fixed_limit_population_cell_read` (registered in HorseDataLedger), and every read frame (`opponentExploitRead`, `presumedAggressorRead`) and the style receipt name the envelope version they used (`exploitEnvelopeVersionFor`): `fixed-limit-population-2026-11-16` with the option on at flh cash, main's version otherwise (pinned in law (1)).

## Limits

Scripted opponents and Horse identities, no humans; the cells are Horse play, so a real tight person's distribution is not measured; maniac cells have wide standard errors; tournaments are out of scope by code and were not evaluated; the flh-only pool is post hoc; the census participation label still reads part of the Horse distribution tight with the option on (unchanged rule).

The census law (law (2)) holds for the frozen census snapshot only. It does not bound play: tight-reraiser respect engages more often with the option on (flh 6 against the Horse field 528 against 104 hero decisions; against tight-passive 26,288 against 25,338), tight reads of a Horse seat rise at flh 6 against tight-passive (252 -> 885), and tight-opener respect against the true-tight target falls (flh 6 23,216 against 39,048). The only absolute bound is tight-opener respect at or under 1 % of census Horses at full-ring flh. Two things are pinned exactly: the frozen table by value (law (7): every mean, lo and hi of all six cells equals the generator output, so any change to a cell value fails the law), and the per-consumer census counts on and off (law (2b): participation tight, tight-opener, tight-reraiser, isValueBettor, tightPassiveFolder, tightNotAggressive). Law (3b) records early-sample counts exactly but does not bound them, and no law bounds in-play engagement.

The pre-declared engagement check of rule 0.19 counted the participation read only. On the tight-reraiser count the flh 6 Horse-field false-positive control rose 3.2 % of decisions (528 against 104), above the rule's 1 % line. That count was not part of the pre-declared check, so it decides nothing here; it is a reason an ON case needs its own pre-declared engagement check on the tight-reraiser count (and on the tight-opener count), not only on the participation read. Every flh statistic moves, not only the tight reads, and no law bounds the loose, postflop or exploit-read movement.

## Turning it on

The option is registered off-only under the owner's preflop range hold (main's rule: an option that changes a preflop range is off-only until the owner lifts the hold for it by name; `OPTION_SWITCH_OFF_ONLY` in `HorseOptionSwitch.ts`, `hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON)`). The live switch therefore refuses ON for it. Turning it on needs, in order: the owner lifting the hold for this option by name, recorded in source (the lift moves it out of the off-only map); then Hand Analysis's route: its ACCEPT at the exact head being turned on, and the recorded evidence row the switch requires (migration `20261116004500`). Nothing in this file or branch turns it on.
