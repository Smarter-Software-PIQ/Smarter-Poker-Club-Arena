# omahaReraisedPotDiscipline (owner ruling 2026-11-14 23:49, hand 59455160; pull request not yet opened, branch agent/plo-reraised-01Gw7aDt/fix/omaha-reraised-pot-discipline)

Carried by the release pull request that supersedes #10937 (branch agent/plo-madehandon-01Gw7aDt/fix/omaha-made-hand-defense-on), built on #10937.

On by default (read `!== false`) on the owner's order of 2026-11-15 00:55 America/Chicago, given after the lane told him the rule was built but unmeasured and would not be in the 4 AM release (his words are at the end of this file). Rows marked NOT MET are unmeasured and rest on that authority alone. A paired evaluation was declared before any graded run (Horse mirror, development human field, one loose-aggressive value seat, one light 4-bettor seat; PLO4 and PLO5); it runs after this head's gate, its verdict is recorded in the changelog, and a failing result switches the option off again. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). Chip amounts are big blinds.

## Split at the release head (2026-11-15)

Only the PREFLOP cell is on by default: a continue facing a 4-bet or more without aces or a premium structure folds unless the committed call pays the price against aces. In the development Horse-mirror probe the all-in preflop calls it folds had negative all-in equity value (PLO4 n4, mean -32 bb; PLO5 n2, mean -54 bb). The POSTFLOP cell (one pair or two pair below top two not stacking off in a pot raised three or more times) is the separate opt-in option `omahaReraisedPotStackOffFold`, default OFF with league cards: in the same probe the calls it folds had positive all-in equity value against the holdings shown (PLO4 n38, +13 bb, equity 0.317 against a price of 0.227; PLO5 n22, +9 bb, 0.264 against 0.225). A rule that folds winning calls is not the fix the owner asked for; it goes on only after its declared evaluation passes.

## Mechanism

Status: MET

The owner's ruling, in substance: when a PLO pot is 4-bet and 5-bet before the flop, ace-high broadway hands without a pair of aces or a strong suited connected structure lose much of their value, and the Horse must not then call off its stack after the flop with top-and-bottom pair or one pair because the price looks cheap. In the reported hand the Horse continued through a 4-bet and a 5-bet with such a hand and then called all in on the turn with two pair that was not top two.

The cause: the preflop continue against a re-raise is a strength threshold that does not look at how many raises came before, and after the flop the committed-stack branch of `HorseLogic.ts` (`committedLegacy`, the `eq15 >= required` call) prices a stack-off against the generic equity estimate and the pot odds, which are cheap once most chips are in. Neither asks what a 4-bet or 5-bet range holds.

The change is `server/src/engine/HorseOmahaReraisedPot.ts`, run as the outermost call-discipline fold on both decision paths (after `omahaBigBetCallFold`). In a pot raised three or more times before the flop (open, 3-bet, 4-bet), facing a wager, a continue (call, raise or all-in) becomes a fold when:

- Preflop: the hand holds no pair of aces and no declared premium structure (kings double-suited, or a double-suited rundown of four ranks within a span of four, lowest seven or higher), and either the call does not commit the stack, or it does and the hand's equity against a random hand holding a pair of aces is below the price of the call.
- Flop, turn or river: the hand is one pair or two pair below top two (`omahaMadeClass` `pair`, `low2p`, `board2p`), the call commits the stack (all in, or less than the resulting pot left behind) or the decision raises over the wager, and the hand's equity against a random hand that holds a pair of aces or already makes top two pair or better is below the price.

A call that is not committing, top two pair, sets, straights and better are untouched. The equities are Monte Carlo estimates with a private generator seeded from the cards; the rule draws nothing from the brain's random stream.

## Input fidelity

Status: MET

Public state and the Horse's own cards only: the preflop action history, the pot, the call and the stack. No opponent read is used. The declared ranges are fixed (aces preflop; aces or top two or better after the flop), not a measured read of the re-raiser.

## Value

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

Not yet measured. The declared paired evaluation (league cells listed under Scope; pass rule: pooled human-field gain more than 2 SE above zero, no cell more than 2 SE below zero, no illegal action or fallback) has its verdict recorded in `docs/changelog/2026-11-15-omaha-reraised-pot-discipline.md`; the option is on by the owner's order meanwhile and goes off again if it fails.

## Continuation

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

Not measured separately. A preflop fold ends the hand; the paired evaluation's arms include every later street of the hands where the continue was kept or folded.

## Reach

Status: NOT MET

Owner authority: plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 f89a6cf5382f04198200c0b8f94dedc6534553d3325f6da7faea7650a2d2dd0b

Rare in the simulator: in 600 Horse-mirror hand pairs (300 PLO4, 300 PLO5) the rule folded 4 preflop continues and kept 21 continues on price; the postflop fold did not occur in that sample. Production reach was not counted (no production query was run for this change).

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only. Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside, as is any decision with nothing to call or where fold is not legal. Unit cases and the league checks are in `HorseOmahaReraisedPot.test.ts` (unset and false play byte-identical poker; on, the rule fires with receipts and no illegal action).

## Visibility

Status: MET

Receipts registered in `HorseDataLedger.ts`: `omaha_reraised_pot_preflop_fold`, `omaha_reraised_pot_postflop_fold`, and `omaha_reraised_pot_priced_in` when the rule examined a continue and kept it on price. League cards `plo4_omaha_reraised_pot_discipline` and `plo5_omaha_reraised_pot_discipline`.

## Limits

Status: MET

- The declared ranges are a model, not a measurement of real 4-bettors; a player who 4-bets light is exactly where folding a dominated hand can be wrong, which is why a light 4-bettor seat is one of the evaluation's cells.
- Multiway equity is computed against one declared-range hand.
- The verbatim owner text for 23:49 was not in the archived chat file used by the lane; the rule follows the lane brief's wording.
- The audit of hand 59455160 was not available to this change; the reported line is described from the lane brief.
- Live behaviour is unverified: the option is off.

## Owner's instruction, verbatim (PLO Strategy chat, America/Chicago)

The owner's own text, exactly as typed; "[...]" marks words left out. Full record: evidence archive `plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md`.

2026-11-14 23:49: "WHEN THERE ARE 4 AND 5 BETS PRE... HANDS LIKE AK AQ AJ GO DOWN SIGNFICANTLY IN VALUE! THEN WE JUST CALL OFF WITH TOP AND BOTTOM PAIR... LIKE WTF BRO"

2026-11-15 00:55, after being told the rule was built, unmeasured and not in the 4 AM release: "LISTEN MOTHER FUCKER... YOU'VE HAD 8 HOURS TO BUILD THIS, IF ITS NOT IN THE 4AM CUT OVER YOUR FUCKING FIRED AND YOU WILL NEVER BE USED AGAIN... ARE WE CLEAR?!" and 00:56: "[...] GET IT DONE, FIXED, ACTIVATED AND PUBLISHED!!!"
