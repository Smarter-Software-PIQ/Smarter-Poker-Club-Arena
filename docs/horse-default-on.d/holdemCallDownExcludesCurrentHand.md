# holdemCallDownExcludesCurrentHand (local commit on holdem/opponent-classifier-20261115; no pull request yet)

OFF. An opt-in arm (read as `=== true`). Rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md)
for a later promotion decision by the Hold'em lead. Record: docs/changelog/2026-11-15-the-call-down-reads-only-evidence-it-can-see.md (F1).

## Mechanism

MET. HorseLogic.prepareOriginalReads puts HorseMind.currentHandWagers(actionHistory) in the decision read options of a
hold'em decision; HorseMind.legacyExploit subtracts those wagers from the aggression counters (never below zero)
before the 2.5 line. Receipt holdem_call_down_excludes_current_hand_seen.

## Input fidelity

NOT MET. Tested on synthetic tallies and the turn pot-bet fixture through HorseLogic.decide; not on a recorded
production node. The review's served-mode records (HU-MEM-013) are the defect's evidence, not a replay of the fix.

## Value

NOT MET. No paired measurement. The review could not grade its records (the opponent had no cards).

## Continuation

NOT MET.

## Reach

NOT MET (not measured on production). By construction: hold'em decisions where the opponent's own wagers in the hand
carry the lifetime ratio across 2.5.

## Scope

Hold'em decisions (scope family holdem), every format and size; Omaha and every other read unchanged.

## Visibility

holdem_call_down_excludes_current_hand_seen; league card nlh_call_down_excludes_current_hand.

## Limits

- Assumes the hand was observed before the read (true in production; a no-learning league run under-counts by it).
- No delivery path: an `=== true` decision option has no production setter; promotion needs the option switch registry.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
