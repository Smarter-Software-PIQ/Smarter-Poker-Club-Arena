# holdemManiacSampleGate (local commit on holdem/opponent-classifier-20261115; no pull request yet)

OFF. An opt-in arm (read as `=== true`). This file records where the option stands against the eight rows of
[HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) for a later promotion decision by the
Hold'em lead. Class definitions and targets: docs/changelog/2026-11-15-a-regular-is-not-a-maniac.md (CLASS-DEFINITIONS).

## Mechanism

MET. HorseOpponentExploit.withManiacSampleGate attaches the gate's evidence (decayed hands, 3-bet opportunities, the
size's regular PFR line and P(pfr beyond it)) to the no-limit hold'em read HorseMind.opponentRead returns, only with
the option on; maniacRaiseWidth then applies the sample floor, the credible-PFR opener route and the 3-bet opportunity
floor. Plumbed from HorseDecideOpts through HorseMind's decision read options; receipt maniac_sample_gate_withheld_seen.

## Input fidelity

NOT MET. Tested on synthetic decayed counters and through a HorseMind decision on an installed profile; not on a
recorded production node.

## Value

NOT MET. No paired measurement against humans. The cost (a true maniac recognised at about hand 19 rather than 4 to 6)
and the gain (regulars no longer met with maniac responses) are not measured in chips.

## Continuation

NOT MET. Not measured how gated regulars continue against the responses they now get.

## Reach

NOT MET (not measured on production). By construction: every no-limit hold'em read with a maniac width below 15
decayed hands, every short-handed and heads-up first-in-only maniac width, and every re-raise width on fewer than 8
decayed 3-bet opportunities.

## Scope

No-limit hold'em reads from HorseMind.opponentRead, every format and table size on its own Horse PFR cell; Omaha,
fixed-limit and presumed reads are passed through unchanged.

## Visibility

maniac_sample_gate_withheld_seen (HorseDataLedger); read.maniacGate carries the evidence; league card
nlh_maniac_sample_gate.

## Limits

- Horse-against-Horse the maniac width rarely engages, so the league card is expected to be near inert.
- No delivery path: an `=== true` decision option has no production setter; promotion needs one (the option switch
  registry) and its replay plumbing.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
