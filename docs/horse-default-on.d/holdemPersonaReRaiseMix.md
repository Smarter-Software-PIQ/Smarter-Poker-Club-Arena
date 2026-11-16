# holdemPersonaReRaiseMix (content of #10791, folded into branch holdem/reads-responses-memory-20261115)

This option is DEFAULT OFF (`opts.holdemPersonaReRaiseMix === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

In two-card no-limit hold'em, the 3-bet bluff and squeeze bluff probability is multiplied by the Horse's persona scale (its nlh3BetMix over the id-model mean, 0.52 for the tightest Nit to 1.52 for the loosest LAG), decided once per hand from a hash of Horse id, hand, hole cards and a per-behaviour salt. Value re-raises and reshoves are not persona-specific (owner R3-B).

## Input fidelity

The hand identity comes from the decision snapshot (table id and hand number), the same for FAST, DEEP and retry; tested end to end through the worker runtime.

## Value

Not measured against people. Measured Horse against Horse (630,000 hands per arm, three cells): fleet 3-bet bluff rate preserved within 0.14 points.

## Continuation

Facing a 4-bet the existing rules answer, unchanged.

## Reach

Replay against main: off equals main on 64,960 decisions; on, every Omaha hand unchanged and 231 of 4,000 Hold'em hands change.

## Scope

nlh only, cash and tournament. Never Omaha, short deck, fixed limit, hi-lo or pineapple. The persona never bluffs an opener read as tight more (cap independent of styleTightReRaiserRespect).

## Visibility

Ledger flag holdemPersonaReRaiseMix; persona receipts per behaviour.

## Limits

A fallback hash (seat, dealer, stack, pot) applies to callers that supply no hand identity (offline only). Off is byte-identical.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
