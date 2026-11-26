# v17ShortDeckIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows); rename to `v17ShortDeckIsPriced.md` only when a registration PR moves it out of `OPTION_SWITCH_REFUSED`. Evidence NOT MET.**

Criteria declared before code, league run or replay: `CRITERIA-V17-SHORTDECK-PRICED.md` (sha256 `420f5649922688c9f2fa406be518e6f5fcca67dd00fe9a2afb5d89675df8b73d`, 2026-11-22 22:19Z, HORSE DECISIONS lane Worker SD).

## What it replaces

The unowned fixed V17 Short Deck overlay in `server/src/engine/HorseLogic.ts` `decidePostflop`: `mw += 0.015 + (oppCount - 1) * 0.012` (receipt `v17_short_deck`, 10,440 fires in the 7 days to 2026-11-22). One increment added to every Short Deck postflop value / call / raise bar, the same for every hand, opponent and pot.

## How each decision is priced

Pure module `server/src/engine/HorseShortDeckMultiwayPriced.ts` (`priceShortDeckMultiwayShift`): zero `fastRandom()` draws, public records and the hero's own simulated equity only, no opponent hole cards, no `opponentHud/` import.

- `f_i` = live opponent i's fold-to-a-bet probability on this street: measured Short Deck pool prior (production `hand_history`, 2026-11-14T22:00Z..2026-11-22T22:00Z, responses to a street's first bet up to the first raise: flop 442/1,280, turn 514/1,266, river 423/785; Horses only) shrunk with prior strength 6 onto that opponent's own fold-to-bet record (`HorseMind.foldToBetCountersOf`, mind on only). All-in or no chips behind: `f = 0`.
- `g` = mean `f_i / (1 - f_i)`; `rho = (1 + kappa_SD g) / (1 + kappa_NLH g)`; shift `delta = e - e^rho` replaces the fixed increment (`> 0` tightens, `< 0` loosens).
- `kappa` (continuation sharpness of the `conditionEquityAgainstRaiseCallRange` kernel) measured for both decks by the same Monte Carlo with the engine's own scorer (pinned run 500 spots, K 120, R2 24, exact river): flop NLH 0.3151 / SD 0.2396, turn 0.4068 / 0.3432, river 0.9415 / 0.9305. Flop and turn differ by 8.4 and 4.0 SE with the same sign in all four runs, so the priced shift loosens there; the river difference (0.85 SE, sign changes) is treated as none, so the river shift is 0.
- Unpriceable input (equity not finite, no live opponent, other street): `delta = 0`, receipt `v17_short_deck_priced_unpriceable`. The fixed increment is never re-applied by this option.
- OFF / unset / false: the original line runs unchanged. Every non-Short-Deck hand: byte-identical.

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `v17_short_deck_priced_tighter`, `v17_short_deck_priced_looser`, `v17_short_deck_priced_unpriceable`.
- Law: `server/src/engine/AV17ShortDeckIsPriced.law.test.ts` (`docs/laws.d/server-src-engine-AV17ShortDeckIsPriced.md`).
- League card: `shortdeck_v17_priced` (Horse-vs-Horse, informational only).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: fixed 0; newlyWrong 0; changed 13; unchanged 177; unjudged 13; set SD-has_human 2026-08-27..2026-10-30 AsOf-memory (deduped); scorer 7a54cc2c174; source unaudited verdict-only; arm v17p vs off; replayed 190 of 190

### Real-human Short Deck replay (2026-11-22)

Every retained Short Deck `has_human` hand (113 hands, 2026-08-27..2026-10-30); every Horse `horse_policy` postflop decision with a recorded public snapshot and the Horse's own hole cards (190 nodes: flop 79, turn 65, river 46), re-decided with today's brain at `7a54cc2c1746` + this option, arm `v17p` (on) vs `off`, base = live 67-row production switch snapshot (`prod-switch-20261122T0336Z.json`), seeds 1, 7, 42 (majority action kind), opponent memory as of each decision (`AsOfOpponentMemory` over the retained has_human history), de-duplicated on (hand, seat, decision time, toCall, currentBet): 0 duplicates. No hole cards or hand ids recorded.

| Slice                                 | Replayed | Base reproduces recorded | Changed | More aggressive / passive / resized | Errors / illegal |
| ------------------------------------- | -------: | -----------------------: | ------: | ----------------------------------- | ---------------- |
| All                                   |      190 |                      166 |      13 | 8 / 1 / 4                           | 0 / 0            |
| People only                           |       57 |                       46 |       1 | 0 / 0 / 1                           | 0 / 0            |
| People excl. the most frequent person |        0 |                        - |       - | -                                   | -                |
| Mixed (people and Horses)             |       90 |                       88 |      11 | 8 / 0 / 3                           | 0 / 0            |
| Horses only                           |       43 |                       32 |       1 | 0 / 1 / 0                           | 0 / 0            |

Every node reached the overlay (`v17_short_deck` 190 of 190 off; priced receipt 190 of 190 on, all `looser`: flop and turn shift below 0, river exactly 0). The whole retained Short Deck record holds ONE distinct person, so the excluded-top slice is empty. No decision here is audited and a person's cards are never retained, so nothing is judged (fixed / newly wrong both 0, all 13 unjudged). Paired league card `shortdeck_v17_priced`, 6,000 pairs per seed (Horse-vs-Horse, informational): seed 1 -1.308 +/- 1.817, seed 7 -0.156 +/- 1.975, seed 42 +0.344 +/- 1.854 bb/100; 0 illegal, 0 truncated, 0 corrected, 0 exception fallbacks; 301-308 divergent pairs per seed.

**Why Evidence NOT MET:** people-only changed decisions `n = 1 < 20`, one person in the whole record, no real-card grade possible. Do not register or switch on until a real-human Short Deck sample meets the criteria's activation bar.
