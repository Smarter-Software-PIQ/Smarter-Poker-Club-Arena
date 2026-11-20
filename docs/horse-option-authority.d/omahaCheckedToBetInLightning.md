# omahaCheckedToBetInLightning: Authority For The Live Switch

Built 2026-11-20 by EMERG lane OPEN-ITEMS-3 (lead session 01TLQer8) on the owner's orders of 2026-11-19 (stop the PLO4/PLO5 bleeding; decisions from the math and the measured statistics; the Horses hardly ever bluff and must in the right spots). Evidence NOT MET for a default-on; this file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

A scope option, default OFF, read `=== true` (`HorseLogic.omahaCheckedToBetIsPricedRule`). With it on, the game of `omahaCheckedToBetIsPriced` (`server/src/engine/HorseOmahaCheckedToBet.ts`: on the river, every opponent has checked and the node's answer is a check, the check is priced beside every bet size) includes the Lightning pools (`gs.publicMemoryDomain.speed === 'lightning'`) without `omahaPricedInLightning`, which opens every priced family in Lightning at once. It switches the rule on nowhere by itself and changes no other rule. PLO6 is untouched (the rule's scope is PLO4/PLO5 cash, one board, high only). The bet it makes is a wager of the `wager_rules` node, which the response validator admits as any wager; no admission of its own.

Receipt: `omaha_checked_to_bet_in_lightning` (with `omaha_checked_to_bet_priced_bet` or `omaha_checked_to_bet_priced_check_kept`).

## The Owner's Orders It Rests On (Verbatim)

- "ITS MATH FIRST ... Make the Horses play real poker based on real decisions, math and all the data and statistics they have." (2026-11-19 7:33-7:38 PM Chicago)
- Horses hardly ever bluff and must in the right spots (2026-11-19 evening).

## What Was Measured

Why a narrow scope and not `omahaPricedInLightning`: on the exact journal replay of 2026-11-18..19 (PLO4/PLO5 cash, 1,741 decisions facing a wager, base = the live option set of 2026-11-19 11:26 PM Chicago), `omahaPricedInLightning` alone changed 19 decisions facing a wager and graded fit -334.3 bb (SE 161.3, 10 hands), held out -66.2 (SE 254.9, 9 hands) against the opponents' real cards. On river decisions with nothing to call it changes nothing by itself.

The opponents' answer (public actions; hidden cards only grade): a player who had checked the river continued against a Horse bet of 0.8 pot or more 4 of 48 times on Nov 17-18 and 4 of 26 on Nov 19; by his own real hand strength, hands that 3% to 15% of two-card holdings beat continued 2 of 47 and 2 of 23.

Graded on the same replay, river decisions with nothing to call (593), `omahaCheckedToBetIsPriced` with this option against the base, the opponents' real cards (offline only), bb. A bet is graded at the response measured on Nov 17-18 for the responder's own hand strength and the bet's pot share (criteria declared before grading: work folder `emerg/open-items/work/oi3/CRITERIA-OI3.md`); a check is the showdown.

| Set                       | Checks That Become Bets | bb (SE)        | Hands Positive |
| ------------------------- | ----------------------- | -------------- | -------------- |
| Fit, Nov 18 from 1 PM     | 11 hands                | +345.5 (111.2) | 10             |
| Held out, Nov 19          | 8 hands                 | +51.1 (11.8)   | 7              |
| Held out, Lightning pools | 4 hands                 | +24.4 (11.2)   | 3              |
| Held out, tables          | 4 hands                 | +26.7 (6.0)    | 4              |

19 decisions change (18 bets, 1 all-in), none becomes a check or a fold. The same figures were obtained with `omahaPricedInLightning` opening the pool, graded against that option alone. If every opponent called every bet the fit day is -133.5 (SE 188.9) and the held-out day +411.5 (SE 280.8): most of the bets are bluffs and their value is the folds.

Limits: 19 decisions in a day and a half; the response table is two days of answers; a person who starts calling river bets moves his own river call rate and the rule prices him on it, but that adjustment was not measured. League: no Lightning domain (refused matchup `plo5_omaha_checked_to_bet_in_lightning`: 0 of 300 pairs diverged, run seed 20261120, inert by construction).

## Tests

`server/src/engine/HorseOmahaCheckedToBetMeasuredResponse.law.test.ts` (the rule's laws), `server/src/engine/aPricedSiteReadsTheLightningGate.law.test.ts` (the scope function itself still opens Lightning only when told to).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the graded exact journal replay of 2026-11-18..19 is in archive repairs/EMERG/OPEN-ITEMS-3.md and work emerg/open-items/work/oi3/g-ct2.out)
