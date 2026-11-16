# The call-down reads only evidence it can see (options holdemCallDownExcludesCurrentHand, holdemCallDownNeedsStyleEvidence; both default off)

The heads-up memory review (HU-MEM-013; Hold'em section V6, extreme-archive/agy-holdem-elite-c2072436/v-evidence-20261115/
V6-HU-MEM-013-HOLDEM-SECTION.md) traced every fold-to-call change against a tight bettor to the legacy lifetime
call-down multiplier (`HorseMind.legacyExploit`: an aggression ratio above 2.5 on 12 or more actions sets
`callDownMod` 1.2, which also switches off the one-pair fold layers gated on `callDownMod <= 1`). It named two
defects in what that multiplier reads.

## F1: the bets being faced are counted as history about the bettor

`HorseLogic.prepareOriginalReads` observes the hand into the opponent's counters before the read. In the review's
served mode the prior read gave 1.00 and the decision's read 1.20: the wagers of the hand being decided pushed the
ratio over the line, so the bet the Horse faces became evidence that the same bettor bluffs.

With `holdemCallDownExcludesCurrentHand` on, a hold'em decision carries each opponent's wagers in the hand
(`HorseMind.currentHandWagers` of the decision's own action history, counted exactly as `observe` counts them, forced
actions skipped) in its decision read options, and the legacy ratio subtracts them (never below zero) before it is
compared with 2.5. A bettor over the line on his history alone is still widened. Receipt
`holdem_call_down_excludes_current_hand_seen` (the read with the hand would have entered the maniac branch, the read
without it does not). The fast look, the deep look and an exact replay compute the same wagers from the same history.

## F2: reduced to two, the multiplier answers from a read the style layer cannot see

Below `SCOPE_MIN_HANDS` (40) the lifetime read answers from the pooled tallies, while the style read used for the
decision reads the scope's own counters. A player known from heads-up play, met at a short or full table that folds
down to two, read "unknown, confidence 0" to the style layer and 1.20 to the multiplier, so the value-bettor exemption
(`styleValueBettorNotManiac`) could not act.

With `holdemCallDownNeedsStyleEvidence` on, in a hold'em decision whose scope bucket is under the line (and no scoped
shrink is reading it), the legacy maniac multiplier stays neutral when the style read has no supported individual
read. Receipt `holdem_call_down_needs_style_evidence_seen`.

## Why options and not plain repairs

Both change decisions in the spots they repair (the review's fold-to-call records), so each is a decision change under
HORSE-DECISION-CHANGE-EVIDENCE.md and ships off with an evidence file and a league card
(`nlh_call_down_excludes_current_hand`, `nlh_call_down_needs_style_evidence`). With both off every read is what it
was. Tests: server/src/engine/aCallDownReadsOnlyEvidenceItCanSee.test.ts.

## Limits

- F1 assumes the hand was observed before the read, which is true on every production path; a decision made with
  observation off (a league run without learning) under-counts by that hand, clamped at zero.
- The review's opponent was a synthetic script without cards, so no record is graded right or wrong; these repairs
  remove evidence the multiplier should not have had, they do not tune the line.
