# holdemProfileCompletenessCap (branch holdem/next-n1-completeness-cap-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.holdemProfileCompletenessCap === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

A pooled opponent row whose stored profile is not complete (HorseOpponentStyle.profileQualification: legacy back-fill pending, or no public memory domain on file) is named in the decision's own detached state by horseDecision/observerReads. HorseMind.styleProvenanceOf then reports the profile as incomplete, so the style read's confidence is capped at incompleteProfileCap (0.4). The exact row governs; a sibling donor row counts only while the exact row is not among the counters the read stands on. Until now every pooled read reported complete, so the cap never applied live (audit J).

## Input fidelity

Reads only `initialized` and `public_memory_domain` of the pooled rows the decision already reads. The named rows travel in read frame v17, so DECIDE_FAST, DECIDE_DEEP and exact replay agree.

## Value

Not measured. Owed: a declared evaluation against people. Known consequence of the existing thresholds at a 0.4 cap (audit J section 3): styleValueBettorNotManiac and the passive value-raise respect need confidence 0.5 and so do not act on an incomplete profile; every other style consumer is weakened, none is strengthened.

## Continuation

No new action. It lowers the confidence the existing style consumers read.

## Reach

Depends on how many pooled rows are still back-fill pending; not known from source. Receipt counts it live. Refused league matchup nlh_profile_completeness_cap (league hands have no pooled rows).

## Scope

Every decision whose style read stands on a pooled public row (the live worker path). Not Omaha-specific or hold'em-specific in code; named holdem because the style read's consumers are hold'em options.

## Visibility

Receipt `holdem_profile_completeness_cap_seen`. Ledger flag `holdemProfileCompletenessCap`. Test anIncompleteProfileIsCappedThroughTheWorker.test.ts.

## Limits

The option reaches the observer reads through the request's options; a live switch row needs the same effective-option wiring the shown river memory got (workerRuntime gives the read view the switched value) before a row alone engages it. Off is byte-identical: nothing is carried, the frame stays at its earlier version.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
