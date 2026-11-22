# omahaNoMadeClassCap: authority for the live switch

Lane HIDDEN-ON, 2026-11-20 (lead session 01TLQer8). Default OFF (`opts.omahaNoMadeClassCap === true`). Evidence NOT MET on the committed scorer bar: the audited-decision replay below is not run; the evidence is the lane's exact journal replay. The lead switches it; nobody else.

## What It Does

In PLO4 and PLO5 cash (table and Lightning; never PLO6, never a tournament) the V40 Omaha pressure cap does not run. That cap replaces the equity a decision uses with a fixed ceiling per made-hand class (air or one pair 0.28, board two pair 0.30, low two pair 0.32 or 0.36, top two pair 0.34 or 0.50, weak trips 0.50, set 0.62, less 0.05 per extra heat point, plus 0.10 on the flop, 0.04 on the turn and 0.12 with a nut draw) whenever the Horse faces a bet of 0.6 pot or more, a barrel, a raise or a second opponent. The cap has no option of its own: it runs under `v40Omaha`, which also carries the range sampler reads, so switching `v40Omaha` off is a different and wider change (and reaches PLO6). With this option on the decision uses the equity that entered the cap. The V15 flush and straight cap is not changed.

## Owner Order

2026-11-20 12:01 AM Chicago: "DO NOT TAKE MY STANDING ORDER FOR SHIT! EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH." Every option and rule is kept, flipped or removed only on its real-card grade. 2026-11-19 8:27 PM: PLO6 is not touched.

## Evidence

Leave-one-out exact journal replay on the live image aec0d93b40cd with the live switch set of 12:01 AM Nov 20, every journaled PLO4/PLO5 cash postflop decision facing a wager (1,741 graded decisions), the cap block not run, graded on the opponents' real cards (offline only), fit day Nov 18, holdout Nov 19. Report: repairs/EMERG/HIDDEN-ON.md.

- 27 actions change: call to raise 15, fold to raise or all-in 7, call to all-in 4, fold to call 1.
- Declared grade (calls with the measured realization, raises by the heads-up clairvoyant lower bound): fit +469.4 bb (SE 306.4, 18 hands, 13 positive); holdout +569.8 bb (SE 354.0, 9 hands, 7 positive).
- All-in grade: fit +205.6 (SE 303.3); holdout +282.7 (SE 290.0).
- A called raise discounted by the same realization as a call: fit +268.5 (SE 310.0); holdout +362.2 (SE 349.9).
- Hands (ids only): 60037338, 60117866, 60167023 (folds holding 0.68 to 0.84 against the bettor's real cards), 60168495; against: 60130051, 60039239.
- Small sample: 27 decisions in about 34 hours of journal. The sign holds on both days under all three grades; only the declared grade is beyond one standard error on both days.

## Wiring

`HorseLogic.decidePostflop`, the `made40.weak` block ("V40 OMAHA PRESSURE CAP"): skipped when `omahaNoMadeClassCapInScope` (HorseOmahaClassCapsRespectEquity.ts) is true. Receipt `omaha_made_class_cap_not_applied`. With `omahaClassCapsRespectEquity` also on there is no V40 cap left to floor; its V15 floor is unchanged.

## Tests

`server/src/engine/HorseOmahaNoMadeClassCap.law.test.ts`: scope; end to end on a constructed PLO5 turn spot (off: the cap fires and the Horse folds on every seed; on: the cap never fires, the receipt fires, no fold, the action passes the decision door; PLO4 same path); PLO6 byte-identical with the option on; tournament byte-identical; unset equals false.

## Replay

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; lane HIDDEN-ON's exact journal replay with fit and holdout grades is in repairs/EMERG/HIDDEN-ON.md)
