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
