# holdemCallDownNeedsStyleEvidence (local commit on holdem/opponent-classifier-20261115; no pull request yet)

OFF. An opt-in arm (read as `=== true`). Rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md)
for a later promotion decision by the Hold'em lead. Record: docs/changelog/2026-11-15-the-call-down-reads-only-evidence-it-can-see.md (F2).

## Mechanism

MET. In HorseMind.legacyExploit's maniac branch, HorseMind.callDownLacksStyleEvidence holds callDownMod at 1 when the
option is on, the scope family is holdem, the scope bucket is under SCOPE_MIN_HANDS (no scoped shrink reading it) and
the style read's evidence state is not supported_individual_read. Receipt holdem_call_down_needs_style_evidence_seen.

## Input fidelity

NOT MET. Tested on synthetic pooled tallies and a durable-profile install; not on a recorded production node.

## Value

NOT MET. No paired measurement.

## Continuation

NOT MET.

## Reach

NOT MET (not measured on production). By construction: hold'em decisions at a table where the opponent has under 40
hands in that scope, a pooled aggression ratio above 2.5 and no style evidence (the review's reduced-to-two case).

## Scope

Hold'em decisions, every format and size; Omaha and every other read unchanged.

## Visibility

holdem_call_down_needs_style_evidence_seen; league card nlh_call_down_needs_style_evidence.

## Limits

- Horse against Horse the case is rare, so the league card is expected to be near inert.
- No delivery path: an `=== true` decision option has no production setter; promotion needs the option switch registry.
