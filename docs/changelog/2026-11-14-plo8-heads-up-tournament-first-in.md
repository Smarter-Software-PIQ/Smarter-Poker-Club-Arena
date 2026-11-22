# PLO8 heads-up tournaments: the blinds stop walking (default-off option omahaHiLoTournamentFirstIn)

Date: 2026-11-14. Lane: Heads Up (HU-HILO-002; delegated by PLO Strategy 2026-11-14T22:47Z; HU-HILO-003, PLO8 cash and deeper than 20 BB, is not part of this change). Status: one new Horse option, default OFF, with its league card. No live decision changes, no schema change, no migration.

## Why

The heads-up audit (hu-audit-01UxDLnM/variants/FINDINGS.md) measured pot-limit Omaha hi-lo tournaments at 20 big blinds or less: the heads-up small blind folds 83 to 85 percent of its first actions and the big blind folds 81 to 91 percent to one raise. It is the same commitment-zone fold that #10687 corrected for Omaha high (HorseOmahaTournamentFirstIn.ts); hi-lo was left out on purpose because it needed its own evaluation.

## What changed

- `HorseDecideOpts.omahaHiLoTournamentFirstIn` (HorseLogic.ts), default OFF: only explicit `true`, or a league arm's parameter object, switches it on. When on, and only for pot-limit Omaha hi-lo in an engine-declared tournament, HorseLogic passes the hand's hi-lo percentile (`omahaPreflopPercentile(cards, true)`) to the preflop engine. Off, nothing is computed.
- HorsePreflop.ts: after the Omaha high block, the same replacement function `omahaTournamentFirstIn` runs with `OMAHA_HILO_TOURNAMENT_FIRST_IN`: the Omaha high heads-up shares (small blind first in plays every hand as the pot-limit maximum raise; the big blind calls its top 75 percent against one raise at a price of a half or better), 20 BB ceiling, every three-handed branch zero, and the table capped at two dealt in even when a league arm asks for more. It replaces only a fold; All-In-Or-Fold, locked satellite seats, cash, fixed-limit hi-lo and deeper stacks stand aside. HorseOmahaTournamentFirstIn.ts itself is unchanged.
- Receipt `omaha_hilo_tournament_first_in`; ledger flag and receipt rows (HorseDataLedger.ts).
- League card `plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb` (HorseLeague.ts; PLO8 heads-up final table at 12 BB, arm A the option on, arm B today). `ADefaultOffFlagHasALeagueCard` pins that the flag has its card.

## Tests

`server/src/engine/HorseOmahaHiLoTournamentFirstIn.law.test.ts` (10 cases): the published limits; off, absent and every non-true scalar change no decision and fire nothing; PLO8 heads-up small blind at 8/12/20 BB folds at least 40 percent off and at most 5 percent on, every change is a fold turned into a legal action with its receipt; the big blind facing one pot raise folds at least 25 points less and still folds at least 10 percent; Omaha high (PLO4/5/6), cash, 25 BB, three-handed (including a league arm that asks for three-handed) and fixed-limit hi-lo unchanged; a league arm can switch the small blind part off.

## Evaluation (declared before any result: hu-audit-01UxDLnM/evaluation/DECLARATION-HU-HILO-002.md)

PLO Strategy's Evaluation Protocol 2 method, PLO8: real HandController hands, heads-up tournament, every deal played from both seats, paired difference option minus off in big blinds per hand against five opponents (old, tight, wide, call-heavy, adaptive re-shover) at 8, 12 and 20 BB, 4,000 hands per cell.

Development seed 94101, option on minus off: +0.53 to +0.55 at 8 BB, +0.45 to +0.49 at 12 BB, +0.28 to +0.30 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.17 / +0.15 / +0.05 and adaptive +0.30 / +0.20 / +0.00 (no cell below zero). Declared rule: SUPPORTED. The small blind part carries the gain; the big blind part alone was not distinguishable from zero in any cell.

Confirmation, fresh seed 94202, run once and reported as it is: +0.57 to +0.59 at 8 BB, +0.49 to +0.55 at 12 BB, +0.34 to +0.37 at 20 BB against old, tight and wide (every interval above zero); call-heavy +0.27 / +0.27 / +0.12 and adaptive +0.38 / +0.28 / +0.11 (no cell below zero; 20 BB includes zero). Declared rule: SUPPORTED. Tables and raw per-group results: hu-audit-01UxDLnM/evaluation/results-HU-HILO-002/.

## Limits

Every opponent is a variant of the Horse brain; no human-calibrated Omaha field is qualified. Chips only (heads-up, so payout-linear). At 20 BB the gain against a re-shoving or call-heavy opponent is not distinguishable from zero, as for Omaha high. The option stays default OFF; activation would need a `docs/horse-default-on.d/` evidence file and is not proposed here.

**Note (2026-11-21):** every PLO8 figure above from the evaluation league (`server/src/benchmark/HorseLeague.ts`, `playHand`) came from the high-only league, which paid every hi-lo pot to the high hand with no low half; it needs re-measurement on the league with hi-lo settlement (`settleLeagueShowdown`, `docs/changelog/2026-11-21-league-pays-the-low-half.md`).
