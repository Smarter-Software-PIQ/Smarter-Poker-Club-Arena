# No hold'em 4-bet is made to fold (2026-11-01)

Dan, 2026-10-31, verbatim: "HORSES KEEP MAKING THESE WEIRD 4 BETS ANYTIME I 3
BET, THEN FOLD 100% OF THE TIME TO A FIVE BET. YOU NEED TO FIX THIS AND STOP 4
BETTING POTS IF THEY ARE FOLDING. ITS SPEWING CHIPS." Then: "ITS IN THE
SATURDAY MYSTERY BOUNTY 30 TOURNAMENT".

## What production showed

Saturday Mystery (`329aa86f-08a9-46f1-8916-59c230aca349`, NLH), 111 hands with
Dan seated between 01:30 and 02:50 UTC on 2026-11-01. Horses faced a 3-bet nine
times and 4-bet six of them (fleet-wide the rate is about 12%). The 4-bets were
value hands: AA, KK, KK, QQ, QQ and AKo (`ca_hand_facts`). The recorded hand,
53158209 at 02:03 UTC, about 107bb deep: a horse opened QQ to 3.1bb, Dan 3-bet
to 10.9bb, the horse 4-bet to 25bb, Dan moved all in, and the horse folded QQ.

## Cause

Two rules disagreed about the same hand. Rule 2 of the hold'em premium rules
(Dan 2026-10-25, `HorseHoldemPremiumAggression.ts`) requires QQ, AKs and AKo to
re-raise a 3-bet, never flat it. Facing the 5-bet, the brain's deep-tournament
bar in `HorsePreflop.ts` (Dan 2026-10-25: at 60bb+ effective only AA and KK put
the stack in facing a 4-bet) also covered the player who MADE the 4-bet, so QQ
and AK were required to 4-bet and then required to fold. Separately, the V7
"4-bet bluff" band in `HorsePreflop.ts` and other owners could make a sized
4-bet with hands below the continuing range, by design folding to a 5-bet.

## Fix (rule 4, applied in the final `wager_rules` node and again at commit)

- **4a.** A sized re-raise over a 3-bet or more (a 4-bet, a non-all-in 5-bet)
  is made only with QQ+ or AK. Any other hand the brain wanted to re-raise with
  calls the 3-bet instead (dominated offsuit hands still fold under rule 1). An
  all-in re-raise is untouched. Push/fold depth (20bb or less) is left to the
  brain.
- **4b.** A horse whose own 4-bet (or later re-raise) has been re-raised never
  folds, at any depth: it calls (the all-in when calling is all in), and AA/KK
  put the rest in through rule 2.
- The Oct 25 deep 5-bet discipline still governs a horse that only 3-bet and
  faces a 4-bet; nothing there changes.
- The live worker's receipt validation admits exactly these two
  de-escalations, bound to the request's action history
  (`holdemFourBetSpot`). The PLO6 receipt guard test no longer lists NLH among
  the games where a raise-to-call is refused; the NLH admission is pinned in
  `HorseHoldemPremiumAggression.law.test.ts`.
- Telemetry: `holdem_no_four_bet_bluff`, `holdem_four_bettor_continues`.

Every opponent gets the same policy; nothing reads a horse/human label.

## Tests

`server/src/engine/HorseHoldemPremiumAggression.law.test.ts` replays the
recorded hand (QQ calls the jam for every seed and style, receipts valid),
covers AA/KK jamming a non-all-in 5-bet, the 4-bet range (JJ, TT, AQs, KQs,
A5s, 76s call; QQ+, AK keep their raise), all-in re-raises untouched, a
3-bettor still free to fold to a 4-bet, a short 4-bettor still calling, and
the context-bound receipt admission. Related server suites: 55 files, 1,271
tests pass.
