# omahaEvFoldModelHeadsUp: authority for the live switch

WooWoo audit programme, lane HU-OMAHA (2026-11-19), helper of the PLO/WooWoo successor. Default OFF in source (read `=== true`). This file authorizes nothing yet: its evidence rows are NOT MET until the declared evaluation (audit archive `repairs/HU-OMAHA/EVAL-DECLARATION.md`) has run and passed.

## Where it comes from

Commit 2301473c493 ("HU Omaha EV fold variants", Hand Analysis / Heads Up chats, Antigravity, 2026-11-18) added two cells to OMAHA_EV_FOLD_MODEL, `plo4_hu` and `plo5_hu`, both `foldOverMdf 1.0, population 0.311`, with no source, and nothing selected them. Its intent: when the Horse bets into one opponent in PLO4/PLO5, price his fold at about MDF instead of the pooled overfold. The commit itself is not merged (tsc fails with 4 errors and, from a stale base, it deletes main's omahaReadIsByStreetAndTexture wiring and the re-raise response read). This option rebuilds that intent on main with measured cells.

## The owner's order it rests on (verbatim)

- Standing rule (2026-11-17): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
- 2026-11-19 15:31 Chicago (relayed by the lead): everything from the Holdem Strategy, Limit Games, Human vs Horse, Lightning Games, Hand Analysis, Heads Up and PLO6 chats is cut over "BEFORE ITS LOST".

## What was measured

Source: the FOLD-MODEL lane's read-only extract (audit archive `repairs/FOLD-MODEL/work/events-fit.jsonl`, sha256 7cf63f9ad512bf352028f77882df876b92584e1004b07eafb838f6005f23fb96; PLO4/PLO5 cash, one board, no bomb pot, a person seated, 2026-11-04 10:00Z to 2026-11-18 10:06Z; built by `work/pull.py` + `work/ext.py`). Unit: a person's first answer to a Horse's first bet on the flop or turn (nothing bet before it on that street, the bet not all-in, no raise before his answer), exactly two players on the street. Script: `repairs/HU-OMAHA/hu-cells.py` (no hole cards read).

| cell        | n     | fold [95%]            | mean s/(P+s) | fold over MDF |
| ----------- | ----- | --------------------- | ------------ | ------------- |
| PLO4 flop   | 1,127 | 0.3185 [0.291, 0.346] | 0.3289       | 0.9684        |
| PLO4 turn   | 777   | 0.3411 [0.308, 0.374] | 0.3554       | 0.9596        |
| PLO4 pooled | 1,904 | 0.3277 [0.307, 0.349] | 0.3397       | 0.9646        |
| PLO5 flop   | 860   | 0.3000 [0.269, 0.331] | 0.3145       | 0.9539        |
| PLO5 turn   | 623   | 0.3579 [0.320, 0.396] | 0.3693       | 0.9693        |
| PLO5 pooled | 1,483 | 0.3243 [0.301, 0.348] | 0.3375       | 0.9610        |

Multiway on the same extract, people answer at 1.27 to 1.57 times MDF; that is what the pooled OMAHA_EV_FOLD_MODEL (PLO4 1.289, PLO5 1.458) carries into heads-up pots. Out of sample caution: the 12 held-out hours 2026-11-18 12:00Z to 2026-11-19 00:00Z (FOLD-MODEL `events-heldout.jsonl`) show PLO5 heads-up people at 1.02 over MDF on the flop (n 150) and 1.30 on the turn (n 97); PLO4 n 12. The turn cell is not stable across windows (the FOLD-MODEL lane saw the same).

## What it does

With omahaEvFoldModel on (production default) and this option on, at a PLO4 or PLO5 cash table, one board, no bomb pot, on the flop or the turn, when the Horse's EV bet engine (V38 flop/turn bet and the terminal flop remainder) prices a bet into exactly ONE opponent, the opponent's fold multiplier is

foldMul = foldOverMdf(cell) x fold / population(cell), fold = (k + 16 x population) / (n + 16)

where the cell is the variant's heads-up cell of that street (`OMAHA_EV_FOLD_MODEL_HEADS_UP`, HorseMind.ts), and (k, n) is his measured fold to a bet on that street (the street record, HorseMind.omahaStreetReadOf) when it has opportunities, else his postflop fold-to-bet counters (the pooled model's own read). A street cell below 300 person answers (`OMAHA_EV_FOLD_HEADS_UP_MIN_N`) falls back to the variant's pooled heads-up cell; below that the pooled model stands. A proven winner keeps its bluff respect as in the pooled model. Every later step (V53 barrel multiplier, V86 reads, card removal) is unchanged on top. Multiway pots, the river, raises (combo-draw raise), PLO6, hi-lo, tournaments, bomb pots and multi-board hands keep the pooled model. Nothing is keyed to a hand class, a bet size or an account.

Off (unset, false, a truthy non-boolean): the read option key is not even set and evFoldMul returns exactly what it returned before.

## Receipts

`omaha_ev_fold_model_heads_up_priced` (HorseDataLedger.ts), one count per opponent priced.

## Tests

server/src/engine/HorseMindOmahaEvFoldModelHeadsUp.test.ts: the cells and their minimum n; off (three forms) equal to the pooled model with or without a street; on, a stranger is the street cell and multiway keeps the pooled cell; his folds and calls move it; PLO6, tournaments and the parent option off unchanged; the receipt.

## Replay

- Replay: NOT RUN (declared in `repairs/HU-OMAHA/EVAL-DECLARATION.md`; it runs only after the CUTOVER-5 booking has merged, by the fixed per-option replay driver)

## Evidence rows

Evidence NOT MET: the declared evaluation has not run. The option stays OFF until it passes; a failed or INSUFFICIENT result keeps it OFF.
