# icmBustPaysPlace (branch holdem/reads-responses-memory-20261115, PR #11008)

This option is DEFAULT OFF (`opts.icmBustPaysPlace === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

IcmModel bubbleFactor and pairwiseBubbleFactor price what a whole-stack risk loses. A bust was valued at 0; with the option on it is valued at the place the player finishes (equityAfterPot: behind every stack live before the hand), which in the money is a paid place. HorseLogic.decide scopes the option per decision (withIcmBustPaysPlace).

## Input fidelity

Reads only the stacks, payouts and hero index the existing ICM inputs already carry (realIcmInputs). Outside the money the place pays 0, so nothing changes there.

## Value

Not measured. The defect is shown on hand 59441335 (nine left, 13 paid): the 2.1bb stack's factor read the cap of 5 instead of about 1.17 because busting ninth, which pays ninth, was priced as losing every payout.

## Continuation

No new action; it changes the price the existing ICM premium (V16), the covered-opponent fold pressure (HorseTournamentUtility) and the payout-aware push/fold tables read.

## Reach

In-the-money tournament decisions where a whole stack is at risk. League card mtt6_ft_icm_bust_pays_place_12bb.

## Scope

Tournaments in the money, every variant that reads these factors. Cash games and decisions outside the money are unchanged.

## Visibility

Ledger flag icmBustPaysPlace. Tests: IcmModel.test.ts (on and off), HorseV16.test.ts, AShortStackJamPricesThePayJump.law.test.ts.

## Limits

Off is byte-identical to the previous valuation (pinned). The place model assumes the bust finishes behind every stack live before the hand.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
