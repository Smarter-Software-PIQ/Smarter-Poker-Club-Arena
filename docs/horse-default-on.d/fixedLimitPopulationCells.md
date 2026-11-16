# fixedLimitPopulationCells (pull request not yet opened; branch agent/fixed-limit-population-cells-01BbZPDh)

A decide option read as `=== true`, built DEFAULT OFF and scoped by code to fixed-limit hold'em (`FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE = {flh}` in `HorseOpponentExploit.ts`). This file is the evidence for a later change that would turn it on at flh; it turns nothing on. It moves tight-player reads that feed preflop decisions (tight-opener and tight-reraiser respect), so it falls under the owner's preflop range hold: turning it on needs the owner to lift the hold for it by name and Hand Analysis's evidence route. Evaluation: agent evidence `fixed-limit-01Gw7aDr/AB-0.19-PREDECLARATION.md`, results `AB-EVALUATION-2.md` section 3.13.

## Mechanism

Status: MET

`exploitEnvelopeFor` (`server/src/engine/HorseOpponentExploit.ts`) returns the Horse population cell an opponent's style and exploit reads are judged against. With the option on, a fixed-limit hold'em decision reads `FIXED_LIMIT_POPULATION_ENVELOPE['flh:' + size]` (version `fixed-limit-population-2026-11-16`) instead of the 2026-10-16 cell. Example at full-ring flh: VPIP mean 0.214 with band [0.135, 0.322], PFR 0.107 [0.068, 0.158], measured from 40,670 hands and 455 Horses. Thresholds, margins, minimum hands and credibility are unchanged. Pinned in `AFixedLimitPopulationCells.law.test.ts` law (1).

## Input fidelity

Status: MET (with stated hand-supplied parts)

The cells are measured from 107,538 recorded Horse-only fixed-limit cash hands (2026-11-09T04:00Z to 2026-11-16T04:00Z, public actions only), through the same increments, opportunity-scoped decay and long window the live learner uses. The evaluation is a paired two-arm simulation on the real HandController and HorseLogic.decide with the production hybrid cash profile, memory on with the production feed, live stack quantiles and small-blind mix (configuration C2 of AB-EVALUATION-2.md), the probe switch on in both arms. Supplied by hand: scripted opponents (true tight `tt`, measured VPIP 0.092 at flh 6 and 0.098 at flh 9; tight-passive; tight-value; loose-passive; maniac) or baseline Horses, and one decision hour.

## Value

Status: MET for flh under the pre-declared rule; the flh-only pool is a post-hoc diagnostic

Validated portion, BB per 100 hands, arm A option on minus arm B off, 70 s cells (AB-EVALUATION-2 3.13; the flh results stand for the scoped head: identical deals, see Reach):

| Opponent                 | flh 6 seats      | flh 9 seats      |
| ------------------------ | ---------------- | ---------------- |
| true tight (target)      | +0.26 +/- 0.08   | +0.21 +/- 0.09   |
| tight-passive            | -0.05 +/- 0.06   | -0.01 +/- 0.01   |
| tight-value (value only) | -0.04 +/- 0.51   | -0.41 +/- 0.86   |
| Horse field              | +0.02 +/- 0.01   | -0.26 +/- 0.20   |
| loose-passive            | +0.29 +/- 0.85   | +1.05 +/- 0.76   |
| maniac (harm control)    | +12.16 +/- 10.81 | +45.26 +/- 19.88 |

The pre-declared verdict pooled the three tt cells including flo8 (+0.16 +/- 0.05, PASS). Pooling only the two flh tt cells gives +0.23 +/- 0.06; that number is chosen after the results were read, so it is a diagnostic, not a new PASS. No flh cell is below -1 - 2 SE.

Engagement (the declared count, a hero decision with any live opponent read tight, arm A minus arm B): flh 6 tt +124 (+0.29 % of decisions), flh 9 tt +46 (+0.12 %); Horse field -346 and -1,245; loose-passive +4 (+0.03 %) and -1. The split by seat read (diagnostic): the tt script is read tight in about 92 % of hero decisions in both arms; the option's large effect is removing tight reads of Horse seats (-4.1 % and -13.6 % of decisions in the Horse-field cells) and of the tight-passive and tight-value scripts.

flo8, measured and out of scope by code: tt -0.14 +/- 0.13, tight-passive +0.19 +/- 0.12, tight-value +1.27 +/- 0.57, Horse field -2.29 +/- 0.71 (3.2 SE below zero, 0.13 above the harm line, 1,801 deals), loose-passive +1.69 +/- 0.87, maniac +28.60 +/- 20.66. The Horse-field loss is almost all preflop (-1.92 of -2.29 on the first-divergence class p). The read that changes there is the participation read of the Horse seats: tight labels on Horse seats fall from 1,437 to 1,081 hero decisions (-22.5 %), while tight-opener and tight-reraiser respect are zero in both arms (they never act in an Omaha scope). The preflop money therefore moves through the other readers of the same envelope (the exploit read and the Omaha opponent read); this diagnostic does not isolate which.

## Continuation

Status: NOT APPLICABLE as a single node

The option moves a read, not one action; continuation is inside the paired whole-hand simulation above (every street played out by HandController and both arms' brains).

## Reach

Status: MET

Deals whose actions differ between the arms at flh: 1.1 % and 1.5 % against the tight script, 0.6 % and 0.1 % against tight-passive, 0.1 % and 2.5 % against the Horse field, 6.0-16.2 % against tight-value and loose-passive, 44.5 % and 73.4 % against the maniac. Option-off identity with main: 300 deals at flh six seats, arm B records identical. Scoped head against the evaluated head: league v4b flh 6 and flh 9 cells against tt and the Horse field, seeds 1:300, identical deals (AB-EVALUATION-2 0.19 scope record). Census: the option lowers the share of flh Horses read tight in every cell (full ring 35.2 % -> 18.2 %, tight-opener 14.1 % -> 0.9 %).

## Scope

Status: MET

Only fixed-limit hold'em decisions, at every table size. flo8 is inert by code (law (5): main's envelope, every census read and seeded cash and tournament decision streams equal to the option off). Every no-limit and pot-limit read is byte-identical (law (1), all variants and sizes, and a stubbed non-fixed-limit structure). Cash and tournament flh decisions both read the cells; only cash was evaluated, so a tournament turn-on would need its own cells.

## Visibility

Status: MET

Receipt `fixed_limit_population_cell_read` (registered in HorseDataLedger), and every read frame and style receipt names the envelope version it used (`exploitEnvelopeVersionFor`).

## Limits

Scripted opponents and Horse identities, no humans; the cells are Horse play, so a real tight person's distribution is not measured; maniac cells have wide standard errors; tournaments were not evaluated; the flh-only pool is post hoc; the census participation label still reads part of the Horse distribution tight with the option on (unchanged rule); the option is under the owner's preflop range hold.
