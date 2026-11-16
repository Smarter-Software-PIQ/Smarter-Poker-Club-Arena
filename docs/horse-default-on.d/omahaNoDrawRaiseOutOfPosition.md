# omahaNoDrawRaiseOutOfPosition (owner ruling 2026-11-15 12:30 America/Chicago; branch agent/plo-combodraw-01BbZPDi/feat/omaha-big-draw-aggression, pull request not yet opened)

Off by default in source (read `=== true`); ON live since 2026-11-16T02:55Z by option-switch row. This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand.

## Mechanism

Status: MET

Owner ruling, verbatim: "RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS."

`omahaDrawRaiseBar` in `server/src/engine/HorseOmahaBigDrawAggression.ts` reads the Horse's cards, the board and its position (in position: no live opponent acts after it on a later street). A hand below two pair that holds a flush draw or eight or more straight outs is a draw. Out of position a draw may not raise; in position a bare flush draw (no top pair or better, under eight straight outs) may not raise. The option applies the bar to the brain's existing draw raises in `HorseLogic.ts`: the baseline flop/turn semi-bluff raise, the pressure semi-bluff raise and the combo draw pump raise are gated where they stand, so the hand goes on to today's call-or-fold verdict; a raise from any other owner that reaches the final answer becomes a call (`omahaNoDrawRaiseFinal`).

## Input fidelity

Status: MET

Public state and the Horse's own cards only. No opponent read, no random draw.

## Value

Status: NOT MET

Not measured. It is an owner ruling. On the sweep the humans folded their own bet to a Horse raise 20 of 114 times heads-up. League cards `plo4_omaha_no_draw_raise_out_of_position` and `plo5_omaha_no_draw_raise_out_of_position` are unrun.

## Continuation

Status: NOT MET

Not measured separately.

## Reach

Status: NOT MET

Not counted in production. Each conversion has a receipt.

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only, flop and turn, a raise facing a wager. Two pair or better (a set, a straight, the nuts) is a made hand and is never barred, whatever it draws to. A bet when checked to is not a raise and is not touched by this option. Hi-lo, PLO6, tournaments, bomb pots, several boards and all-in-or-fold tables are outside. Cases by class in `HorseOmahaBigDrawAggression.test.ts`.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_no_draw_raise_ft_semibluff`, `omaha_no_draw_raise_v53_semibluff`, `omaha_no_draw_raise_v86_pump`, `omaha_no_draw_raise_final_call`.

## Limits

Status: MET

- A draw raise from an owner other than the three gated sites becomes a call, not today's own call-or-fold verdict.
- A draw raise chosen inside a signed policy graph before the wager rules, and a raise chosen by an authority-backed pack selection, are converted by the final rule only where the worker receipt validator admits the change with the request.
- One pair with a draw counts as a draw; one pair with no draw is not covered.
- Live behaviour is unverified: the option is ON live since 2026-11-16T02:55Z and has not been read live yet; this head changes it (see "Live change on this head" below).

## The combo draw made precise (2026-11-16, owner 12:30 and 12:52)

One definition (`omahaComboDrawForRaise`, `HorseOmahaBigDrawAggression.ts`) serves omahaTurnRiverRaiseNeedsNuts's in-position turn exception, omahaNoDrawRaiseOutOfPosition's bar and omahaBigDrawAggression's in-position raise: a hand below two pair holding a flush draw (five or more flush outs) together with a straight draw of eight or more outs, a 13+ out wrap with a flush draw included; straight outs are counted by rank under the two-card rule, a card that also completes the flush included (`omahaComboStraightOuts`). A pair adds nothing: a pair with the nut flush draw is not a combo draw, nor a pair with the nut flush draw and a gutshot (it does not raise), nor a pair with a wrap and no flush draw. Before this, a strong pair with any draw counted (and in the big-draw rule every class but the bare wrap). Tests: HorseOmahaBigDrawAggression.test.ts (`omahaComboDrawForRaise`).

## Live change on this head (review B2, 2026-11-16)

This option is ON live since 2026-11-16T02:55Z (option-switch row, Hand Analysis's owner-forced record); this change alters its live behaviour as follows: For this option the in-position bar on a PLO4/PLO5 cash flop or turn now turns into a call every raise by a hand below two pair that holds a flush draw without an eight-out straight draw, a pair or not: a pair with the nut flush draw (with or without a gutshot) that raised in position live today now calls. An open-ender with a flush draw whose flush-suit straight cards were left out now passes the bar and keeps its raise. Out of position nothing changes (every draw raise below two pair becomes a call, as before); two pair or better is never barred.
