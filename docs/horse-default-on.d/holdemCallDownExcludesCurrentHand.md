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
