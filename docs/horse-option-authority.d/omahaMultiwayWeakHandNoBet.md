# omahaMultiwayWeakHandNoBet: authority for the live switch

Lane brief of 2026-11-16 (PLO4/PLO5 defence, part 2). Evidence NOT MET: league INCONCLUSIVE (2026-11-18), real-decision replay judged worse.

## What it does

PLO4/PLO5 cash, one board, high only, the turn and the river, nothing to call, two or more live opponents, a bet with one pair or less (`omahaOnePairOrLess`), not nut class, and on the turn no nut-class draw (four or more nut-class outs, `omahaNutClassOuts`: the nut flush, the nut straight or a full house no bigger one beats) and no combo draw (`omahaComboDrawForRaise`): the bet becomes a check unless the bet-versus-check EV against every live opponent's range (`omahaBetVsCheckEv`; exact counts, the turn averaged over every river card; measured fold rates: on the turn his fold to a bet, on the river 1 minus his river-call rate; else the priors 0.31 turn, 0.60 river; ranges independent) says the bet is worth more than the check by 2% of the pot.

The PLO6 lane's plo6NoMultiwayBetWithWeakMadeHand (not on main at 963b71f394b; read on its branch) is the six-card form: flop and turn, a narrower weak made-hand class, a draw test that also keeps eight straight outs, no EV exception. This option is consistent in its draw definitions with the PLO4/PLO5 shared ones and does not touch PLO6 (the exact count serves four and five cards; a PLO6 hand keeps its decision).

Precedence: an owner-ruled check (`omahaOopCheckRules`, after the older owner-ruled checks), kept outermost by `omahaOwnerRuledFinal`; one receipt per decision.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaMultiwayWeakHandNoBet docs/horse-option-authority.d/omahaMultiwayWeakHandNoBet.md sha256 <digest>`). The option is registered in the live switch (on and off; follow-up list migration 20261118013329 names it) and is OFF unless such a row is written. The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on

The owner's principles of 2026-11-15, as the lane brief of 2026-11-16 relays them (in substance, not verbatim): no blanket rules, the decision is hand, player, price and pot dependent; play defence on bad cards; an owner-ruled check or fold is final; facing a bet on the turn or the river, raise only with the nuts. No verbatim owner order names this option; the brief that ordered it is the lane's (2026-11-16).

## Recorded hands and rulings it answers

Full sweep 2026-11-15 families D2 (multiway bet with an underpair or bottom two pair, no nut draw: 56 bets, 80% mistakes) and B1b (river bet on a paired board with one pair or less). No sweep hand was replayed through the option.

## Receipts

omaha_multiway_weak_hand_bet_checked; its `_vetoed` twin omaha_multiway_weak_hand_bet_checked_vetoed fires when a later rule replaced the check.

## Tests

HorseOmahaMultiwayDiscipline.test.ts (16 seeds per class: top pair three-way on the turn checks at every seed with the population prior; opponents measured to fold to almost every bet keep the bet by the comparison; heads-up, a nut straight draw and two pair unchanged; byte-identical when unset or false; admitted by the receipt validator). An opponent already all in has no fold equity and is not a party to the bet's chips (2026-11-18, review N2 of #11211): six tests in the same file, four of which fail on the code before the fix.

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001, the strategy-head method: unset and all three options false both give b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1, 446 / 2714 / 428 / 2844 decisions, 0 illegal, 0 fallbacks; archive defense2-20261116/fp-\*.json).
- Value, continuation, reach: NOT MET. League evaluation 2026-11-18 on build bac65c601d2 (the all-in fold-equity fix; archive plo-handoff-review-01a1cbbd/wave2c-013U37 (PASS-BAR.md declared before the runs; eval/RESULTS.md; REPLAY.md)), 32 live options on in both arms, 3 seeds x 4,000 mirrored pairs per cell, bb/100 A-B pooled +/- SE: PLO4 field -0.51 +/- 0.47 (13 divergent pairs: INCONCLUSIVE), PLO4 Horse-only +0.12 +/- 0.36 EQUAL, PLO5 field +0.93 +/- 1.53 EQUAL, PLO5 Horse-only +0.28 +/- 0.50 EQUAL; 0 illegal, truncated or fallbacks. Verdict INCONCLUSIVE (not FAIL: stays switchable, default OFF).
- Real decisions (REPLAY.md): on 833 real multiway turn/river nothing-to-call Horse decisions (audit2 PLO5 and Nov 16) the option only turns bets into checks: 58 changed, 0 judged fixed, 26 judged newly wrong of 43 judged by the audit's rules (judge -365 bb). Recommendation: do not switch on.

## Limits

Stated, not measured: the shown range 0.5, the 2% margin. Measured: the priors 0.31 / 0.60 (full sweep, heads-up Horse bets with one pair or less: turn 145 of 468, river 68 of 113 everyone folded), heads-up rates used per opponent multiway. On the turn the river is not played after either line, so the check is valued at showdown and a draw's later value is not counted beyond the nut-class and combo exclusions.
