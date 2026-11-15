# holdemGearShiftReach (local commit on holdem/opponent-classifier-20261115; no pull request yet)

OFF. An opt-in arm (read as `=== true`). This file records where the option stands against the eight rows of
[HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) for a later promotion decision by the
Hold'em lead. Declaration and targets: docs/changelog/2026-11-15-a-gear-shift-is-reachable.md.

## Mechanism

MET. HorseOpponentExploit.opponentExploitRead takes a reach argument only with the option on (HorseMind.opponentRead,
no-limit hold'em): after a confirmed regime break the fast window is judged at EXPLOIT_CREDIBILITY on pfr, rfi,
threeBet and betCheckedTo, high side, where the 0.95 gear-shift line or the 0.97 fast-engage line was missed. Plumbed
from HorseDecideOpts through HorseMind's decision read options; receipt holdem_gear_shift_reach_seen.

## Input fidelity

NOT MET. Synthetic decayed counters only; not a recorded production node.

## Value

NOT MET. No paired measurement against humans.

## Continuation

NOT MET. Not measured how a player read earlier continues against the maniac responses.

## Reach

NOT MET (not measured on production). By construction, measured on synthetic counters: full ring, 6 raises in the last
~12 hands after an 8 to 18 percent history (7 to 8 today). Short-handed and heads-up: no change.

## Scope

No-limit hold'em reads from HorseMind.opponentRead. Omaha, fixed limit, sibling and rare-opportunity reads unchanged.

## Visibility

holdem_gear_shift_reach_seen (HorseDataLedger, counts read computations); league card nlh_gear_shift_reach.

## Limits

- Horse-against-Horse nobody changes gear, so the league card is expected to be near inert.
- With holdemManiacSampleGate also on, the gate can withhold the maniac width of a gear-shifted read.
- No delivery path: an `=== true` decision option has no production setter; promotion needs one (the option switch
  registry) and its replay plumbing.
