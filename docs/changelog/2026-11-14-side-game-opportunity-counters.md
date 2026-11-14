# Side Games: An Offer And The Brain's Own Read Are Counted Apart

Upgrade 08 (side games, cash only) already counted the run-it-twice answers, the three insurance answers a Horse sends, and the kill-pot or seven-deuce context that reaches a Horse decision request. Two questions a daily zero could not answer were left. For insurance there was no denominator: zero answers could mean no Horse leader was ever offered insurance, or that offers were made and the answer never ran. For kill pots and seven-deuce the only counter sat on the request the table engine builds, before the worker: nothing showed that the brain, in the worker, read the kill hand or the bounty in that decision.

Measurement path only: no decision, wager, think time, queue or deadline changes. Five new counters, all `*_seen` receipts with no floor.

## What Changed

- `upgrade08_insurance_offered_seen` (`ServerTableEngineRunout.scheduleHorseInsuranceResponse`): one per insurance offer whose leader is a Horse the engine plays, counted where the answer is scheduled, after the Horse check. It is the opportunity for `upgrade08_insurance_decline_seen`, `_accept_seen` and `_cashout_seen`, which are a subset: an offer the hand or the lifecycle retires before the timer runs is offered and never answered.
- `upgrade08_kill_pot_orbit_seen` (`HorseLogic` preflop): the preflop orbit analysis read this decision as an active kill hand. `upgrade08_kill_pot_unopened_seen`: that read kept the pot unopened (the kill blind is not treated as a raise), which is the adjustment the preflop thresholds consume.
- `upgrade08_seven_deuce_overlay_seen` (`HorseLogic` preflop and postflop): the side-game overlay resolved the seven-deuce game as on for this decision (cash, no-limit hold'em). `upgrade08_seven_deuce_bounty_seen`: the Horse holds 7-2 and a bounty credit above zero went to the decision, the preflop threshold credit or the postflop pot overlay.
- The four brain counters fire only on the worker's telemetry-on evaluation, once per decision. Warm-up and second-look replays run with telemetry off and are not counted.
- `HORSE_UPGRADE_LIVE_EVIDENCE` lists the five keys under upgrade 08, and the `upgrade08_*` ledger family row names the new source and meanings.

## Reading The Counters

- Insurance: `offered` at zero means no table offered a Horse leader insurance that day. `offered` above zero with the three answers summing to less is normal when hands end first; answers at zero against a material `offered` is a stopped answer path.
- Kill pot: `upgrade08_kill_pot_seen` counts every Horse decision request on a kill hand, any street. `kill_pot_orbit` counts only preflop decisions the brain evaluated, so it is lower by design; `kill_pot_unopened` is a subset of `kill_pot_orbit`.
- Seven-deuce: `upgrade08_seven_deuce_seen` counts every request at a table with the game switched on. `seven_deuce_overlay` is lower where the table is not no-limit hold'em, where the brain correctly reads the game as off. `seven_deuce_bounty` needs the Horse to hold 7-2 (about 1.2 percent of hands), so it is small and a zero on a short day is not a fault.

## Limits, Stated

- Counters are fleet evidence: they carry no Horse identity and do not show that any one Horse used a side game.
- The request counters are fired by the table engine and the brain counters by the worker. A request the worker refuses or that is aborted has the first and not the second. No ratio between them is enforced.
- Lightning has no kill pots, no insurance and no seven-deuce game (the Lightning host never sets it); no Lightning caller was added.
- Three computed side-game values still have no reader in the Horse brain and are not counted as used. They are reported, not changed here: the opponent bounty-bluff credit when the Horse does not hold 7-2 (`HorseSideGameOverlay.ts`, `opponentBountyBluffRateBonus`); the kill-hand effective big blind and stack depth (`HorsePreflopOrbitState.ts`, `effectiveBigBlind`, `effectiveUnitStackBB`); and any postflop kill-pot pricing, since the postflop pot overlay carries the seven-deuce bounty only.
- A Horse leader's insurance answer is priced by the table engine, not by the Horse brain; that is the existing design.

## Regression

- `HorseUpgradeSideGameCounters.test.ts` (14 tests, was 4): the production insurance scheduler counts one offer at scheduling and the answer after the timer; nothing for a person or for a Horse seat its own client drives; an offer retired before the timer is offered and unanswered.
- Same file, real `HorseLogic.decide`: kill pot unopened and raised; seven-deuce preflop and postflop with and without 7-2; nothing with the game off or in a tournament; every counter silent with telemetry off and the action, amount and think time identical on the same seeded spot.
- Same file, real table engine: the request the engine builds for a seven-deuce table and for a kill hand makes the brain count its read, and a plain hand counts nothing.
- `HorseActionSpaceFreedom.law.test.ts`: the four insurance scenarios now also assert four offers counted.
- Mutation check: fourteen mutants (each fire dropped, the offer fire moved before the Horse check or doubled, each condition widened, each telemetry gate removed) each fail the file.
