# The time a Horse takes is public information only

Date: 2026-11-15. Lane: PLO Strategy. Owner order (12:16 Chicago): "There is a timing tell, when the Horses snap bet the turn, it's almost always a draw and never a made hand ... fix that globally."

## What was measured

Every PLO4/PLO5 cash hand with a person seated from 2026-11-10 21:30Z to 2026-11-15 17:33Z (4,573 hands, 30,398 Horse decisions with a person still in, all with the Horse's cards and the millisecond stamp of every action). Delay = the action's stamp minus the previous action's stamp in the hand; for the first seat to act on a street that is the action that closed the street before (the record has no deal event, so the deal is inside the number).

1,136 Horse turn bets. Under 1.5 seconds (366): 52% made hands (two pair or better), 18% draws, 30% one pair or less. 1.5 seconds or more (770): 58% made, 15% draws, 27% one pair or less. A fast turn bet is a draw rather than a made hand 1.2 times as often as a slow one. People raised fast turn bets 7% of the time and slow ones 7%. So the observation as stated does not hold over the five days: a fast turn bet was a made hand more often than not. In the 46 turn bets of the build live since 13:22Z the gap is wider (fast 50% made, slow 88% made), on too few hands to be sure.

## What was wrong in the code

The think time was built by `HorseLogic.computeThinkTime` from mostly public inputs, with four private ones left:

- the brain's difficulty hint is the public one only on the path with `v86MultiStreetUnblocked` and `decisionGravityTiming` on; any other path uses the distance of the Horse's own equity from a threshold, and a path without the opponent-reading step uses a fixed board texture;
- the hold'em Hollywood tank is triggered by the Horse's own made-hand category;
- the random draws come from the strategy and Monte Carlo stream, whose position depends on how many samples the private hand drew;
- the safety net answers at exactly 1,500 ms.

## What changed

One option, `horseActionTimeIsPublicOnly`, default OFF (only an explicit `true` switches it on). With it on, every think time, in every variant and format (Lightning reads the same value), is produced by one function, `horsePublicActionTimeMs` (`server/src/engine/horsePublicActionTime.ts`), from: the street, the board, the pot, the price, the stacks, the players still in, the number of boards, the action and amount the table is about to see, the seat's tempo persona, and a random stream of its own. The mixture, weights, floors and soft floor are the shipped ones, so the pace is unchanged (property test: mean within 6% on three recorded spots). Floors: 350 ms with no bet to call, 1,250 ms facing a bet, 2,000 ms facing a tournament shove. The engine already releases an action at the later of "decision ready" and "think time", and a decision takes 2 to 4 ms (75 ms worst seen), so the decision path does not show.

Unset, the brain is byte-for-byte the shipped one. On, the action and amount of every decision are unchanged and the strategy stream sits where it did.

## Not changed

`ServerTableEngineTurns.ts` and the Lightning files. The second look still lets a call, fold or all-in facing a bet in a 20bb+ pot wait for the deeper answer inside the turn clock; which spots qualify is public. Lightning's fast fold (a Horse already folding folds right away) is the format's own feature and stays.

## Tests

`aHorseActionTimeIsPublicInformationOnly.law.test.ts` (reads the source: one producer, no private name reaches it, no branch carries a think time of its own) and `HorseActionTimePublicOnly.test.ts` (200 private hands on each of three recorded public states, two decision paths: the think time equals the public function of the action shown; unset is identical; pace kept).
