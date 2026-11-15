# omahaManiacReRaiseWidthMeasured (full sweep 2026-11-15, owner 11:39 and 11:41: decisions hand-, player- and price-dependent, no blanket rules; branch agent/plo-underpair-01BbZPDi/fix/omaha-no-stack-off-with-underpair, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

The full sweep (4,573 human-seated PLO4/PLO5 cash hands, 2026-11-10 to 2026-11-15) ranks preflop first, and against the biggest winner the losses are two halves of one line: a Horse opens, he re-raises, the Horse 4-bets without aces (21 times, -1,441 bb), he 5-bets, the Horse calls (9 of the 22 calls of his re-raises, -818 bb).

Replayed through `HorseLogic.decide` with his measured counters in the opponent memory (raises 55-82% of hands, re-raises 33% over 15 decayed opportunities), 18 of the 21 4-bets are the V53 pressure 4-bet (`v53_pressure_four_bet`) and the calls are the maniac price call, both inside the preflop price arithmetic of `HorseLogic.ts` (`v38_preflop_allin_price`): equity against the re-raiser's range, against the price plus its margins. The range comes from `HorseMind.bandFor`, which since 2026-10-22 reads a maniac's 3-bet at his whole RAISING width and his 4-bet or more at `reRaiseLineWidth` of it, because a player who shoves every hand seldom faces a raise and his re-raise statistic never engages. For this player that is the top 69% of hands for his 3-bet and the top 58% for his 5-bet, so a queen-ten-seven-three reads 50% equity against a 5-bet.

With the option on (PLO4/PLO5 cash), a measured maniac whose re-raise statistic rests on 12 or more decayed opportunities (`OMAHA_MANIAC_RERAISE_MIN_OPPS`) is read on a re-raising line at his own re-raise rate (the shrunk posterior mean: 0.25 for this player, 0.16 for his 4-bet or more by the same `reRaiseLineWidth`), never wider than today's read. Nothing else moves: the price, the realisation and domination margins, the 6-point gap a pressure 4-bet needs and every bar are as they were. A presumed read, a maniac with few counted re-raises, a non-maniac and an unknown player are read as today.

## Input fidelity

Status: MET

The opponent memory's decayed counters, the ones every exploit read uses. The recorded hand (`HorseOmahaManiacReRaiseWidth.fixture.json`, anonymised to seats) is replayed with the winner's measured rates placed in the memory; the live memory at each decision is not in a snapshot.

## Value

Status: NOT MET

Not measured. On the sweep's own hands, replayed: of the 18 4-bets against the winner that replay as 4-bets, 9 are no longer made (those hands lost 1,008 bb) and 9 still are (stronger hands; they lost 455 bb); of the 22 calls of his re-raises, 17 are still calls at the majority of seeds, so the calling half is narrowed, not removed. A replay with assumed counters is not an evaluation; the declared paired evaluation decides (league cards `plo4_omaha_maniac_reraise_width_measured`, `plo5_omaha_maniac_reraise_width_measured`).

## Continuation

Status: NOT MET

Not measured. The same band seeds the postflop range read of a player who re-raised before the flop, so postflop decisions in those pots also read him narrower; this is intended and unmeasured.

## Reach

Status: NOT MET

Not counted in production. The receipt counts band reads, several per decision.

## Scope

Status: MET

PLO4 and PLO5 cash, the mind on, a measured (not presumed) maniac with 12 or more decayed re-raise opportunities, on a 3-bet or bigger line. `HorseOmahaManiacReRaiseWidth.test.ts`: the band widths off and on, never wider, unchanged for few opportunities, a non-maniac, an unknown player and an opening line; the recorded 4-bet is not made with the option on and a strong hand still 4-bets; the recorded call of the 5-bet folds in some seeds and never raises; unset and false are byte-identical; the mind off and an empty memory are today's play.

## Visibility

Status: MET

Receipt `omaha_maniac_reraise_width_measured` in `HorseDataLedger.ts`.

## Limits

Status: MET

- The read has no 4-bet statistic; a 4-bet or more is the 3-bet rate through `reRaiseLineWidth`.
- The posterior mean is shrunk toward the population, so a 33% re-raiser is read at 25%.
- In the Horse mirror a measured maniac with counted re-raises may never occur, so the league cards may be inert.
- The calls of 4-bets by other people (50 of the 72 in the sweep) are not reached by this option: without each person's live memory 16 of them do not replay at all, and the rest are ordinary range play at its price.
- Live behaviour is unverified: the option is off.
