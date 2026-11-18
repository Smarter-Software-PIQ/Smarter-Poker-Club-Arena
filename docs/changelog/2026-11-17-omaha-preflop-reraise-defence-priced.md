# Omaha preflop re-raise defence priced by equity, realization, price and rake (option, default off, off-only)

Date: 2026-11-17. Lane: PLO Strategy. Owner order 11:49 America/Chicago (no blanket rules; decisions by the math, the
hand, the opponent's range, equity and EV; the bet size must not make or break a decision). One new option, default off
(read `=== true`) and registered off-only under the owner preflop range hold: `omahaPreflopReraiseDefencePriced`.

## What happened

Audit part 2: Horses that raised folded to one measured winning player's 3-bet 93 of 168 times (55%) and to his 4-bet
44 of 59 (75%). Step 1 checked it before anything was built: the folded hands had 48-50% equity against his measured
range at a 32-34% price; real calls by a Horse that had raised beat folding by +5.66 bb (SE 2.39, n 1,164). Not
confirmed out of position at a stack-to-pot ratio of 5 or more or with players still to act.

## What changed

`HorseOmahaPreflopReraiseDefence.ts` and `HorseOmahaPreflopReraiseDefenceRule.ts`: with the option on, a PLO4/PLO5 cash
preflop decision facing a 3-bet or more is the largest of folding, calling and the re-raise the earlier rules proposed,
each valued from the exact hand's equity against the re-raiser's measured width (population mean when unknown),
a realization measured on recorded calls (position, ratio after the call, players in, hand shape), the price and the
rake. One owner per cell (2026-11-18): a call that the re-raised-pot call cell of `HorseOmahaOopReraisedPot` judges (the
live implementation; the out-of-position 4-bet call included) stays with that cell, and there the decision is identical
to the option off; this option answers only where that cell does not judge. Receipts
`omaha_preflop_reraise_defence_fold`, `_call`, `_raise`, `_changed`. Ledger flag, reference-decision sources, league
cards plo4/plo5_omaha_preflop_reraise_defence_priced, follow-up switch migration
20261118001546_horse_option_switch_omaha_preflop_reraise_defence_priced, authority file
docs/horse-option-authority.d/omahaPreflopReraiseDefencePriced.md. Unset and false decide byte-identically.

## Evaluation

Declared before running, new seeds: EQUAL. PLO5 human-like field (fixed identity) -9.23 bb/100 (SE 41.13, 5 x 4,000
pairs), PLO4 +35.39 (SE 28.69, 3 x 4,000); Horse-only tables -0.12 (3.74), +1.39 (3.96), and with the live options in
both arms +0.32 (1.72), -0.82 (2.79). The option acts (152 changed answers in 1,000 pairs) and nothing failed. Replay of
7,768 real decisions: unset and false identical; 1,409 fixed and 177 newly wrong against Step 1's yardstick. The
option stays off. These figures were measured with the option answering before the re-raised-pot call cell; with that
cell live the option now changes fewer decisions (one owner per cell), and neither run was repeated.
