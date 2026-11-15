# holdemRiverFullHouseValue (branch holdem/river-full-house-value-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.holdemRiverFullHouseValue === true`). This file is the evidence gathered so far and what is still owed before it may be switched on.

## Mechanism

No-limit hold'em, river, one board, not a bomb pot or All-In-Or-Fold: a player out of position without the betting lead checks every hand to the prior aggressor at the V11 initiative gate. With the option on, a full house or better that uses a hole card and is not an under-full, a trips-board boat or the board playing (HorseHoldemRiverFullHouseValue.holdemRiverLeadBoat) skips that gate 70% of the time and is bet by the existing monster sizing branch. The other 30% keeps the check and its check-raise.

## Input fidelity

The hand test reads only the Horse's two cards and the five board cards. The gate conditions are the ones the V11 gate already reads (initiative, position, prior check). No opponent read is used.

## Value

Not measured. Owed: a declared paired evaluation. Evidence so far is reach on audited hands, not chips: the replay of the 131 audited river decisions (RIVER-FULL-HOUSE-REPLAY-20261115.md in the Hold'em archive) shows 48 still check at this gate on main and 19 of those are qualifying hands.

## Continuation

The bet uses the monster branch, whose raise-response plan is `commit` for these hands. A raise over the lead is answered by the existing facing-a-raise rules (unchanged).

## Reach

On the 131 audited spots: 22 change with the option on (19 that reproduced a check, 3 already-betting spots whose size draw shifts), 0 with it off. League card `nlh_river_full_house_value`.

## Scope

`gs.gameVariant === 'nlh'` only. Not short deck, Omaha, fixed limit, multiple boards, bomb pots or All-In-Or-Fold. Cash and tournaments alike.

## Visibility

Receipt `holdem_river_full_house_lead_seen` fires once per lead. Ledger flag `holdemRiverFullHouseValue`.

## Limits

A fixed 70% frequency, not solved. The hand test does not read flushes or straights (a full house beats both). The replay behind the reach figure has no opponent memory and 21 tournament spots without a stage. Off is byte-identical: no random number is drawn unless every other condition holds and the option is on.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
