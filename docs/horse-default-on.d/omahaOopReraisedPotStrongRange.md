# omahaOopReraisedPotStrongRange (owner instruction 2026-11-15 11:49, 11:51, 11:55 and 11:58 America/Chicago; branch agent/plo-3betdef-01BbZPDi/fix/omaha-elite-continues-vs-measured-wide-three-bettor, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

Owner: Horses call 3-bets and 4-bets out of position with too weak a range, and must not call just because the opponent is aggressive; the calling range is rundowns, straight makers and double-suited hands whose cards all work together, not big cards held together only by rank and not high cards with low cards.

Where aggression lowers the bar today (`server/src/engine/HorseLogic.ts`): against an observed maniac raiser every re-raise is priced by the maniac-price arithmetic (`maniacPrice38`), whose range is his whole raise width (`HorseMind.bandFor`: a 3-bet line reads `maniacRaiseWidth`, about 70% for the production winner) and whose realization charge is 0.10 out of position only when the Horse opened and faces exactly one re-raise (V53); facing a 4-bet or more, or when the Horse did not raise, it is 0.03 in or out of position. In the range play a wide re-raiser's read lowers the call and 4-bet bars (`preflopVsReRaiser`). None of these asks what the hand is made of.

The rule (`server/src/engine/HorseOmahaOopReraisedPot.ts`, applied outermost on both decision paths by `omahaOopReraisedPotStrongRange` in `HorseLogic.ts`): a preflop CALL facing a 3-bet or more from a raiser the Horse acts before on every later street, or facing a 4-bet or more in either position, the raiser not all in, stands only when

- the hand is aces with a suit (the engine's class `aa_ds`): never examined; or
- it is a commitment with equity above the raw price: facing a 3-bet, the stack-to-pot ratio after the call under 1; facing a 4-bet or more, the call itself all in (a pot-sized 4-bet leaves that ratio under 1 at any ordinary depth, so the ratio alone would excuse every 4-bet call); or
- the hand is COORDINATED (bare aces, class `aa_dry`, are excused this test only) and its equity is at least the raw price plus the engine's realization charge: 0.10 out of position, 0.05 in position, plus 0.03 facing a 4-bet or more when it holds exactly one ace or exactly one king. Facing a 4-bet with the ratio after the call under 1 the margins are waived; coordination is not.

Otherwise the call becomes a fold. A raise is never touched. A call of a 3-bet in position is unchanged.

COORDINATED: not the V46 class `dangler`; at most one pair; all cards in ONE connected rank group (sorted, ace high or low, no two neighbouring ranks more than two apart, so no card stands outside the group: no dangler is tolerated in PLO4 or PLO5); one-rank gaps inside the group at most one in PLO4 and two in PLO5, one more for a double-suited hand (the elite class `rundown_ds` or `broadway_conn_ds`, or two clean two-card suits).

EQUITY: against the last raiser's range alone, the band `HorseMind.bandFor` reads for him (measured width when his read is engaged, the line-implied prior otherwise). A 4-bet or more that no read has widened is priced against the engine's declared 4-bet range (`omahaReraisedPremium`: a pair of aces, kings double-suited, double-suited rundowns). Aggression widens the band and so raises the equity, but the margin is charged in full and no width makes an uncoordinated hand a call. Deterministic sampling seeded by the hand; no draw from the brain's random stream.

## Input fidelity

Status: MET

Public state, the Horse's own cards and the mind's range band for the last raiser. The recorded cases replay the public action of production hands with the Horse's own cards only.

## Value

Status: NOT MET

Not measured. What the production sweep shows about position (4,573 human-seated PLO4/PLO5 cash hands, 2026-11-10 to 2026-11-15, Horse's last preflop action, whole-hand result; archive `plo-handoff-review-01a1cbbd/3betdef-20261115/position/POSITION.md`) does not single out position: calling a 3-bet lost 7.2 bb a hand in position (231 hands) and 2.1 out of position (232); calling a 4-bet or more lost 22.0 in position (59) and won 4.6 out of position (37); without aces, calling a 4-bet or more lost 49.7 in position (50) and 1.3 out of position (28). 4-betting won in both positions. The samples are small and the results swing by hundreds of big blinds a hand. The declared paired evaluation is still to be written and run.

## Continuation

Status: NOT MET

Not measured. A preflop fold ends the hand. The flop rule that goes with it is a separate option (`omahaReraisedPotFlopContinueNeedsEquityShape`).

## Reach

Status: NOT MET

Not counted in production. Structural census, 20,000 seeded deals per game: the share of hands that is coordinated, and the decisions census with the option on, are in the archive (`3betdef-20261115/oop-census.txt`).

## Scope

Status: MET

PLO4 and PLO5 cash, high only, one board, preflop, fold legal. Hi-Lo, PLO6, bomb pots, all-in-or-fold tables and tournaments are outside, as are a call of a 3-bet in position, a raiser who is all in and every raise. Tests in `HorseOmahaOopReraisedPot.test.ts`: by class on a seeded census of 500 hands a class (one connected group, split high/low, big cards with danglers; double suited and least suited), on recorded production calls, and in the decision (unset and false byte-identical; a call the cell folds becomes a fold and nothing else moves).

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_oop_reraised_call_folded` and `omaha_oop_reraised_call_kept`. League cards `plo4_omaha_oop_reraised_pot_strong_range` and `plo5_omaha_oop_reraised_pot_strong_range`.

## Limits

- The option's name says out of position; since the owner's 11:55 instruction it also covers a call of a 4-bet or more in position.
- Raw all-in equity does not carry the owner's preference for live, unblocked hands in PLO5: against the declared 4-bet range, one-group double-suited hands without an ace or king average 0.449, with one ace or king 0.474, split high/low 0.466, big cards with danglers 0.450 (PLO4 does order as the owner describes: 0.424, 0.402, 0.397, 0.382). The preference is carried by the coordination test and the 0.03 key-card margin, not by equity.
- Equity is against the last raiser alone; other players in the pot are not sampled.
- One-group hands of low rank (2-3-4-5) are coordinated; they fail on equity or not at all.
- The commitment clause for a 4-bet (all in only) is stricter than the stack-to-pot ratio of 1 first specified, for the reason given under Mechanism.
- Live behaviour is unverified: the option is off.
