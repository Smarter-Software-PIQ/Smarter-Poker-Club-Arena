# Omaha wave two: the multiway discipline and the street plan layers together

Date: 2026-11-16. Lane: PLO Strategy. Integration of two default-off option sets on one head (no option turned on, no source default flipped): the multiway river call, river bluff and multiway weak-hand bet (`omahaMultiwayRiverCallNeedsStrength`, `omahaNoRiverBluffIntoValueLeader`, `omahaMultiwayWeakHandNoBet`) and the street plan's flop, three-way turn and preflop layers (`omahaStreetPlanFlop`, `omahaStreetPlanThreeWay`, `omahaPreflopStackPlan`).

## Precedence where they meet

The owner-ruled checks act first and are final (`omahaOopCheckRulesCore`, then the discipline checks inside `omahaOopCheckRules`); the street plan layers run only on a bet those let stand; `omahaOwnerRuledFinal` re-applies the discipline checks and `omahaWagerIsChecked` (which now asks the flop and three-way plans too) outermost. Among the new checks any check wins: a bet stands only if every active rule lets it stand. A three-way turn bet with one pair or less is covered by both `omahaMultiwayWeakHandNoBet` and `omahaStreetPlanThreeWay`; exactly one check receipt describes the final check: `omaha_multiway_weak_hand_bet_checked` when the weak-hand rule checks (the plan then never runs), `omaha_street_plan_three_way_checked` only on a bet the weak-hand rule let stand.

## Lazy big-draw pricing (no decision changes)

With every option on, a flop or turn check that an owner-ruled, discipline or street-plan check had made could still be priced by `omahaBigDrawAggression` (its equity count, about 100 ms on a PLO5 flop) for a bet the outermost rule then replaced by the check. The one wager the big-draw verdict can make is now fixed before any equity is counted; when a ruled check stands in the decision, `omahaOwnerRuledFinal` is asked (quietly) whether that exact wager would be replaced, and if so the equities are not counted and the check stands (receipt `omaha_big_draw_aggression_final_check_unpriced` in place of the bet and its `_vetoed` twin). Decisions are identical with every option on (19,200 timed decisions and the four-cell digests over three seeds, before and after).

## The multiway river call: the bettor's multiway value region

`omahaMultiwayRiverCallNeedsStrength` priced the bettor with his heads-up value region even when he bet into two or more players. The verdict now uses the derived multiway region `Vn = 1 - (1 - V1)^(1/n)` (`omahaMultiwayValueShare`: the weakest value hand is best against all n players as often as the heads-up one is against one, under the module's independence). No new constant; heads-up unchanged; the live facing-bet EV option is untouched. Of the 14 recorded multiway river non-nut calls the verdict priced as calls, four now fold (a nine-high flush with a player behind, trips on a double-paired board, bottom set at a pot-sized bet, top two pair on a four-flush board); full houses and the second-nut and queen-high flushes facing a bet and a call still call. The option stays off.

## Verification

`HorseOmahaWaveTwo.test.ts` (receipt crediting, lazy pricing), `HorseOmahaMultiwayDiscipline.test.ts` (the multiway value region), both branches' tests and the precedence laws. Unset, the decision digest is unchanged (b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1). No evaluation has been run.
