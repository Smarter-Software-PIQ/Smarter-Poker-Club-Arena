# omahaOnePairDiscipline (owner complaints 2026-11-14: hands 59407629, 59430325, 59431232, 59417700, 59426444)

Carried by the release pull request that supersedes #10937 (branch agent/plo-madehandon-01Gw7aDt/fix/omaha-made-hand-defense-on), built on #10937.

## STATUS: OFF by default (read `=== true`) since 2026-11-15, after its declared evaluation failed

It was on by the owner's order (his words are at the end of this file) in #10957's first head. Its declared evaluation (one-pair-20261115, source 9d9ad486, 200 sessions x 300 pairs per cell, 0 illegal, 0 fallbacks) failed its frozen rule: Horse-only PLO4 -0.77 bb/100 (SE 0.34, z -2.30); the development human field leaned positive, PLO4 +0.26 (SE 0.61), PLO5 +1.31 (SE 0.56), pooled +0.79 (SE 0.41, z +1.89, below the 2 SE bar); Horses against a loose-aggressive seat PLO4 -7.01 (SE 5.46), PLO5 +4.12 (SE 2.79). It goes off as declared; the opt-in arm, receipts, tests and league cards stay. The owner's words on the misplays it answers (PLO Strategy chat, 2026-11-14, exactly as typed, "[...]" marks words left out): 21:33 (hand 59431232) "[...] CHECKS FLOP, BETS 33% POT ON TURN, CHECK CALLS POT BET WHEN FLUSH AND STRAGITH GET THERE!!!! STOP [...] CALLING RIVER BETS WHEN WE CAN'T [...] BEAT ANYTHING!!!!!!!". The one-pair river bets (59407629, 59430325) and the one-pair stack-offs (59426444, 59417700) are the lane's open findings from the same evening. These name the misplays; they are not a measurement of the rule.

Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The pull request that carries this file is the one titled "Omaha: one-pair discipline (river value bets, beaten river calls, one-pair stack-offs), off by default".

## Mechanism

Status: MET

`server/src/engine/HorseOmahaOnePair.ts`, run on the final answer of the `wager_rules` node (after every owner that can bet, raise or call, including the checked-to pricing that can turn a river check into a half-pot bet with one pair). PLO4/PLO5 high, one board, not Hi-Lo, not fixed limit, not all-in-or-fold, not a bomb pot. Only ever reduces chips:

1. River: one pair or less (high card, one pair, or the board's pair plus one own pair) never bets or raises for value. Bet -> check; raise -> call. A wager the reference brain chose in one of its river bluff branches (the declared-bluff flag set at those branches), and the river bluff check-raise, keep their wager.
2. River: facing a wager of 0.66 pot or more (the last bettor's added chips over the pot before them) at a call price of 0.13 or more, two pair or less on a board where a straight or a flush is possible folds, unless the bettor is MEASURED as a postflop over-bluffer (isPostflopManiac on a read that is not presumed).
3. Flop and turn, facing a wager: one pair or less with fewer than four next-card outs to a nut-class hand does not raise (call when the call costs no more than half the effective stack, fold when it costs more) and does not call a wager costing more than half the effective stack, unless that call is priced under 0.25.

## Input fidelity

Status: MET

Hero's cards, the board, the pot, the wager and the public action record; one stored read (the measured over-bluffer class) for rule 2's exception. The complaint hands have no fixtures; their nodes are built states or variations of other anonymised complaint fixtures (`HorseOmahaOnePair.test.ts`).

## Value

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

See the paired evaluation in the lane archive (one-pair-20261115/RESULTS.md). No production value measurement.

## Continuation

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

Not measured: how often a 0.66-pot river bet on a straight- or flush-possible board is a bluff, by bettor class, was not counted beyond the over-bluffer read.

## Reach

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

Not counted from recorded hands. Reported in the paired evaluation as receipt counts per cell.

## Scope

Since 2026-11-15 01:32 (owner): every cell requires a board on which a straight or a flush is possible; dry boards are exempt.

Status: MET

Gated in code as above. With the option off, decisions on a 112-decision sample equal those of the base commit (digest pinned in the test).

## Visibility

Status: MET

Receipts registered in `HorseDataLedger.ts`: `omaha_one_pair_river_value_bet_checked`, `omaha_one_pair_river_value_raise_flatted`, `omaha_one_pair_river_beaten_call_folded`, `omaha_one_pair_raise_flatted`, `omaha_one_pair_raise_folded`, `omaha_one_pair_stack_off_folded`. League cards `plo4_omaha_one_pair_discipline`, `plo5_omaha_one_pair_discipline`.

## Limits

Status: MET

- Rule 2 folds on bet size and board texture; a player who over-bets rivers and has not yet been measured as an over-bluffer is folded to.
- Rule 1 relies on the declared-bluff flag from the reference brain's river bluff branches; a one-pair wager chosen by a later policy owner as a bluff is not marked and is checked.
- Rule 3 counts next-card nut outs only (no backdoors, no implied odds). Hand 59426444's money went in preflop (aggro-build-20261114/DIAGNOSIS.md), which this rule does not touch.
- The outer safety net path (decisions with no policy graph) does not run these rules.
- Live behaviour is unverified until a release carries this and the receipts are read.

## Owner's order to ship it on (PLO Strategy chat, 2026-11-15, America/Chicago, verbatim)

00:37: "LAUNCH WHAT CAN BE DONE NOW AT THE NEXT CUT OFF AS SOON AS POSSIBLE AND EVERYTHING ELSE BETTER BE INSIDE THE 4AM CUT OVER!"

00:56: "WE ARE DOING EVERYTHING AT 4AM NOT 3AM. GET IT THE FUCK DONE AND MAKE SURE ITS DONE RIGHT, THEY SAID YOU HAD 3 SEPERATE FAILURES TODAY, THATS UNACCEPTABLE! GET IT DONE, FIXED, ACTIVATED AND PUBLISHED!!!"
