# fixedLimitPopulationCells (pull request not yet opened; branch agent/fixed-limit-population-cells-01BbZPDh)

A decide option read as `=== true`, built DEFAULT OFF. This file is the evidence for a later change that would turn it on; it turns nothing on. Under the Fixed-Limit lane's pre-declared rule (agent evidence `fixed-limit-01Gw7aDr/AB-0.19-PREDECLARATION.md`, results `AB-EVALUATION-2.md` section 3.13) the option may be proposed on. The builder proposes it for fixed-limit hold'em and recommends holding flo8 (see Value).

## Mechanism

Status: MET

`exploitEnvelopeFor` (`server/src/engine/HorseOpponentExploit.ts`) returns the Horse population cell an opponent's style and exploit reads are judged against. With the option on, a decision whose betting structure is fixed limit reads `FIXED_LIMIT_POPULATION_ENVELOPE[${variant}:${size}]` (version `fixed-limit-population-2026-11-16`) instead of the 2026-10-16 cell. Example values at full-ring flo8: VPIP mean 0.526 (flo8 short-handed cell, borrowed because no full-ring cell existed) becomes 0.312 with band [0.184, 0.542]; at full-ring flh 0.214 [0.135, 0.322]. Thresholds, margins, minimum hands and credibility are unchanged. Pinned in `AFixedLimitPopulationCells.law.test.ts` law (1).

## Input fidelity

Status: MET (with stated hand-supplied parts)

The cells are measured from 107,538 recorded Horse-only fixed-limit cash hands (2026-11-09T04:00Z to 2026-11-16T04:00Z, public actions only), through the same increments, opportunity-scoped decay and long window the live learner uses. The evaluation is a paired two-arm simulation on the real HandController and HorseLogic.decide with the production hybrid cash profile, memory on with the production feed, live stack quantiles and small-blind mix (configuration C2 of AB-EVALUATION-2.md), the probe switch on in both arms. Supplied by hand: scripted opponents (true tight `tt`, measured VPIP 0.092-0.106; tight-passive; tight-value; loose-passive; maniac) or baseline Horses, and one decision hour.

## Value

Status: MET under the pre-declared rule for the targets; one significant loss stated

Validated portion, BB per 100 hands, arm A option on minus arm B off, 70 s cells (deals 600-17,487):

| Opponent                 | flh 6 seats      | flh 9 seats      | flo8 6 seats     |
| ------------------------ | ---------------- | ---------------- | ---------------- |
| true tight (target)      | +0.26 +/- 0.08   | +0.21 +/- 0.09   | -0.14 +/- 0.13   |
| tight-passive            | -0.05 +/- 0.06   | -0.01 +/- 0.01   | +0.19 +/- 0.12   |
| tight-value (value only) | -0.04 +/- 0.51   | -0.41 +/- 0.86   | +1.27 +/- 0.57   |
| Horse field              | +0.02 +/- 0.01   | -0.26 +/- 0.20   | -2.29 +/- 0.71   |
| loose-passive            | +0.29 +/- 0.85   | +1.05 +/- 0.76   | +1.69 +/- 0.87   |
| maniac (harm control)    | +12.16 +/- 10.81 | +45.26 +/- 19.88 | +28.60 +/- 20.66 |

Pooled over the three tt cells: +0.16 +/- 0.05 (PASS); no cell below -1 - 2 SE (no HARM); the binding mixed-sign rule is not met. The flo8 Horse field is significantly negative (3.2 SE, 0.13 above the harm line, 1,801 deals, almost all preflop) and flo8 shows no tt gain, so flo8 is recommended held until that cell is re-measured.

## Continuation

Status: NOT APPLICABLE as a single node

The option moves a read, not one action; continuation is inside the paired whole-hand simulation above (every street played out by HandController and both arms' brains).

## Reach

Status: MET

Deals whose actions differ between the arms: flh 0.1-2.5 % against the tight script, the tight-passive script and the Horse field; flo8 2.8-11.8 % against the same three; 5.5-17.6 % against tight-value and loose-passive; 44.5-73.4 % against the maniac. Option-off identity with main: 300 deals at flh and flo8 six seats, arm B records identical. Census: the option lowers the share of Horses read tight in every cell (full ring: flh 35.2 % -> 18.2 %, flo8 73.8 % -> 26.7 %).

## Scope

Status: MET

Only fixed-limit decisions (`flh`, `flo8`) at every table size; every no-limit and pot-limit read is byte-identical (law (1), all variants and sizes, and a stubbed non-fixed-limit structure). Cash and tournament decisions both read the cells; only cash was evaluated, so a tournament turn-on would need its own cells.

## Visibility

Status: MET

Receipt `fixed_limit_population_cell_read` (registered in HorseDataLedger), and every read frame and style receipt names the envelope version it used (`exploitEnvelopeVersionFor`).

## Limits

Scripted opponents and Horse identities, no humans; the cells are Horse play, so a real tight person's distribution is not measured; maniac cells have wide standard errors; the flo8 Horse-field and loose-passive cells are small; tournaments were not evaluated; the census participation label still reads part of the Horse distribution tight with the option on (unchanged rule).
