# 2026-11-07 - The baseline flop and turn bluff range (Hold'em and PLO)

Players report the horses "rarely bluff". #9803 audited and fixed the river
(`docs/changelog/2026-11-07-horse-river-bluff-range.md`). The same owner
instruction applies to every street (Dan, 2026-11-06): "CHECK THAT THERE IS
NOTHING THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' ... BLUFFS FOR
QUALIFIED CANDITATES OR SITUATIONS." This is the flop and turn audit: c-bets,
delayed c-bets, probes, turn barrels, semi-bluff raises and check-raises, in
NLH and PLO4/5/6.

## Measured before the change (production, read-only, 2026-11-07)

### Line frequencies

`hand_history`, two windows (now-30m and now-75m to now-40m, about 20:00 UTC),
bomb pots and multi-board excluded. "Opp" is the number of horse decisions with
nothing to call; heads-up/multiway is by players who acted on the flop.

| variant | spot                             | HU opp | HU bet % | MW opp | MW bet % |
| ------- | -------------------------------- | ------ | -------- | ------ | -------- |
| nlh     | flop c-bet as preflop raiser     | 789    | 67.2     | 82     | 47.6     |
| nlh     | turn barrel after a called c-bet | 291    | 52.9     | 25     | 60.0     |
| nlh     | turn probe after a checked flop  | 195    | 53.8     | 31     | 29.0     |
| nlh     | delayed c-bet (flop checked)     | 130    | 49.2     | 20     | 40.0     |
| plo4    | flop c-bet                       | 528    | 80.1     | 143    | 41.3     |
| plo4    | turn barrel                      | 175    | 69.1     | 39     | 84.6     |
| plo4    | turn probe                       | 80     | 58.8     | 61     | 27.9     |
| plo4    | delayed c-bet                    | 42     | 47.6     | 29     | 13.8     |
| plo5    | flop c-bet / barrel              | 31/5   | 74/100   | -      | -        |
| plo6    | flop c-bet / barrel              | 10/5   | 90/80    | 12/3   | 33/33    |

Second window, split cash/tournament: nlh cash HU c-bet 64.7 (n 868), barrel
55.7 (305), probe 50.0 (206); nlh MTT HU 66.8 / 53.8 / 48.4; plo4 cash HU 81.5 /
71.9 / 76.9; plo4 MTT HU 72.0 / 74.5 / 50.0. The aggregates sit at or above
solved heads-up single-raised-pot ranges (NLH c-bet roughly 55-75%, barrel
about 50-60%, probe 40-60%; lower multiway). The rates were not the problem;
WHICH hands bet was.

### Composition (hands shown down, 90 minutes)

Horse flop/turn decisions where the hole cards are recorded (showdown hands
only, so bluffs that won uncontested are missing: every share of air and draws
below is a lower bound). Made = a pair or better of hero's own, draw = a flush
draw or four to a straight, air = neither. PLO "made" counts any pair.

| variant | street | HU bets | made / draw / air % | draw checked to: bet % | air checked to: bet % | draw facing a bet: raise % | made facing: raise % |
| ------- | ------ | ------- | ------------------- | ---------------------- | --------------------- | -------------------------- | -------------------- |
| nlh     | flop   | 525     | 56.0 / 14.3 / 29.7  | 25.3 (n 297)           | 28.3 (551)            | 5.7 (122)                  | 16.5                 |
| nlh     | turn   | 425     | 74.8 / 15.3 / 9.9   | 19.8 (328)             | 13.9 (303)            | 7.7 (65)                   | 22.5                 |
| plo4    | flop   | 682     | 88.9 / 7.3 / 3.8    | 22.9 (218)             | 20.3 (128)            | 23.6 (123)                 | 34.6                 |
| plo4    | turn   | 516     | 95.0 / 3.1 / 1.9    | 11.0 (146)             | 22.2 (45)             | 12.5 (48)                  | 17.9                 |
| plo5    | flop   | 75      | 93.3 / 6.7 / 0      | 31.3 (16)              | -                     | 22.2 (9)                   | 59.2                 |
| plo5    | turn   | 28      | 100 / 0 / 0         | 0 (5)                  | -                     | -                          | 34.6                 |
| plo6    | turn   | 10      | 100 / 0 / 0         | 0 (2)                  | -                     | -                          | 44.4                 |

Multiway, NLH turn bets were 88.5% made and PLO4 flop bets 98.7% made.

### Telemetry (`horse_brain_telemetry`, three days)

`v38_ev_check` 132,113 vs `v38_ev_bet` 44,752 (the Omaha EV engine below the
value bars checks three times in four); `v29_gto_flop_open` 66,005,
`v30_gto_turn_open` 9,510, `v57_turn_cell_initiative_skip` 35,168;
`v53_pressure_semibluff_raise` 2,211; `v74_omaha_semibluff_needs_draw` 27,264;
`v78_no_committing_bluff_raise` 824; `v40_no_third_barrel` 28,611 (river);
`v31_certified_skip_empty_store` 589,831 (no certified V31 store in
production). Phases 10-13 are shadow-only (0.02% applied).

### Replayed decisions (HorseLogic.decide, 1/2 cash, 100bb, unknown opponent, 200 seeds)

| spot                                            | before | after                    |
| ----------------------------------------------- | ------ | ------------------------ |
| nlh turn barrel, 9-8 open-ender on T-7-2-3      | 38%    | 71%                      |
| nlh turn barrel, A-Q two overcards on 8-5-2-J   | 39%    | 45%                      |
| nlh turn probe, Q-J flush draw on K-7-2-4       | 71%    | 69%                      |
| nlh flop check-raise, Q-J flush draw on K-7-2   | 8%     | 32%                      |
| nlh flop check-raise, 9-8 open-ender on T-7-2   | 7%     | 36%                      |
| nlh flop raise in position, Q-J flush draw      | 10%    | 23%                      |
| plo4 turn barrel, 9-8-6-J wrap on T-7-2-3       | **0%** | 63%                      |
| plo4 turn probe, same wrap                      | **0%** | 68%                      |
| plo4 turn barrel, A-5 nut flush draw on K-7-2-3 | 39%    | 77%                      |
| plo4 flop check-raise, wrap                     | 14%    | 44%                      |
| plo6 turn barrel, wrap                          | 6%     | 69%                      |
| nlh junk 6-4 on K-Q-9-3, plo4 junk              | 5%     | 5% (identical decisions) |

## Every gate between a qualified candidate and a bet (server/src/engine/HorseLogic.ts, after this change)

| gate (file:line)                                                                                                                              | verdict                                                                                                                                                                                                                                                        | action                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| V38 EV engine, Omaha/short deck/FL below the value bars (`:10568`, `HorseEvEngine.ts:146,161`)                                                | DEFECT for bluffs: the opponent folds exactly MDF, which makes a pure bluff worth zero against a positive check EV, and the folded hands are ones hero beat 85% of the time, which collapses a draw's continuing equity. A 13-out PLO4 wrap checked 200 of 200 | the baseline owns qualified Omaha draws before it; the engine still prices everything else                 |
| V29/V30 solver cells, NLH HU with the lead (`:10094`)                                                                                         | DEFECT for draws: a class mean over every board in a texture class (the same failure V58 documents for made hands); A9o's cell cannot see this board's open-ender                                                                                              | the baseline decides qualified draws/air before the cell; the cell keeps every other hand                  |
| V57 turn-cell initiative skip (`:10171`)                                                                                                      | correct (tournament turn cells are not barrel nodes)                                                                                                                                                                                                           | untouched                                                                                                  |
| V7 one-and-done give-up (`:10563`, 80% cash / 65% MTT check with no plan, equity < 0.52)                                                      | DEFECT for draws: a cash solver-cell c-bet records no plan, and a plan of "false" (65% of planned flop bluffs) checked a turn draw four times in five                                                                                                          | qualified draws, overcards and blockers no longer reach it; it still gives up unqualified junk (correct)   |
| V7 barrel continuation (`:10512`), V39 outlook, Items 21/23 plan fingerprint                                                                  | correct story mechanics, but frequency 0.52 x bluffScale for a draw                                                                                                                                                                                            | owns unqualified hands only; the baseline's bets still record a plan and outlook for the river             |
| V11 initiative gate (`:10242`), no donk leads                                                                                                 | correct poker: leading OOP into the aggressor on a street they have not checked is not a story                                                                                                                                                                 | untouched (the baseline's `probe` is only after the aggressor checked the flop back)                       |
| V4 c-bet branch (`:10687`): `wetness <= 0.45 && !scare.any`, oppCount <= 2                                                                    | DEFECT for qualified hands: no c-bet bluff on any wet board; two overcards on a wet flop had only the generic roll                                                                                                                                             | the baseline owns them; the branch keeps the range c-bet for unqualified hands on dry boards               |
| semi-bluff bet (`:10720`): bluffFreq x aggression x 1.4 HU, about 0.24                                                                        | over-tight: solved HU pots bet a flop flush draw about three in four                                                                                                                                                                                           | the baseline owns draws                                                                                    |
| pure-bluff bet (`:10750`): HU only, bluffFreq x 0.8                                                                                           | correct for junk (rare); left for unqualified hands                                                                                                                                                                                                            | untouched                                                                                                  |
| semi-bluff raise (`:11924`): bluffFreq x aggression x bluffScale x 0.5, about 8%                                                              | DEFECT: solved HU pots check-raise a flop flush draw about a third of the time and raise it in position about a quarter                                                                                                                                        | the baseline raise (`:11815`) owns qualified draws; this branch is skipped when the baseline had its roll  |
| V53 pressure semi-bluff mix (`:11642`)                                                                                                        | correct read-driven reshaping                                                                                                                                                                                                                                  | kept as a floor inside the baseline raise                                                                  |
| V74 Omaha semi-bluff needs a draw (`:9140`)                                                                                                   | correct poker                                                                                                                                                                                                                                                  | subsumed: the baseline raises only physical draws                                                          |
| V78 no committing bluff raise (`v78CommitsWithoutJam`)                                                                                        | correct poker (no raise-then-fold)                                                                                                                                                                                                                             | applied to the baseline raise unchanged                                                                    |
| V8 OOP check-raise bluff on a blocked scare card (`:12001`)                                                                                   | correct, small                                                                                                                                                                                                                                                 | untouched                                                                                                  |
| bluffScale: exploit x blocker x position x ICM (`:8937`), V17 players behind (`:9085`), V36 multi-board (`:8984`), V18 self-image, V37 bubble | correct reshaping                                                                                                                                                                                                                                              | the baseline applies its own bounded multipliers (position, multiway, ICM, reads)                          |
| V16 fold-to-c-bet read (`:10693`)                                                                                                             | correct reshaping                                                                                                                                                                                                                                              | applied to baseline c-bets and barrels inside [0.7, 1.4]                                                   |
| V37 satellite lock, ICM risk                                                                                                                  | correct survival arithmetic                                                                                                                                                                                                                                    | a locked seat is out of scope; risk scales the baseline (draws never below half, the rest never below 0.3) |
| PLO paired-board fold (`HorsePloPairedBoardFold.ts`, wager_rules)                                                                             | owner ruling (Dan 2026-10-25)                                                                                                                                                                                                                                  | preserved; the baseline never semi-bluff raises a paired Omaha board and bets one at half frequency        |
| V40 Omaha third barrel x0.15 (`:8941`)                                                                                                        | river only; #9803 owns it                                                                                                                                                                                                                                      | untouched                                                                                                  |

Also found, not a bluff gate and left for its owner: facing a 0.7-pot turn bet,
Q-J of hearts on K-7-2-4 with the flush draw folds 94% of the time (calls 1%).

## What changed

`server/src/engine/HorseFlopTurnBluffRange.ts` owns the flop or turn with no
showdown value for a qualified candidate on a line that tells a story.

- Lines: `cbet` (hero raised preflop), `barrel` (hero's flop bet was called),
  `delayed` (flop checked through), `probe` (the raiser checked the flop back;
  hero leads the turn out of position), `stab` (the aggressor checked to hero
  in position). A lead into the aggressor on a street they have not checked is
  left to V11.
- Selection: strongDraw (flush draw, open-ender, double gutter; Omaha nut flush
  draw, 8+ out wrap, flush plus straight draw), pairDraw (a weak pair with a
  strong draw), weakDraw (gutshot; Omaha a non-nut flush draw or 6+ outs),
  backdoor (flop, with an overcard), overcards (two, Hold'em), blocker (top
  unseen card of a two-flush suit). On a board with three of a suit only draws
  and that blocker qualify. Junk is not qualified and decides exactly as before.
- Frequency: per-combo class frequencies for a heads-up single-raised pot
  (`FT_BLUFF_BASE`, e.g. c-bet strong draw 0.78, barrel 0.72, overcards 0.45 /
  0.30), out of position x0.85-0.9, multiway draws only (x0.55 three-handed,
  strong draws x0.3 four-handed, never five), Omaha weak draws and blockers
  x0.75, paired Omaha board x0.5, a runout for the opponent x0.7 (draws x0.9),
  an unblocked completing turn x0.6 for non-draws, shallow non-draws x0.5,
  capped at 0.88.
- Raises: `FT_RAISE_BASE` (flop OOP strong 0.36 / IP 0.24; turn OOP 0.24 / IP
  0.18; no turn gutshot raises), Omaha nut draws x1.2, three-handed strong
  draws only x0.4, bets over 0.75 pot x0.7, no raise into a turn bet over 0.75
  pot or a flop bet over the pot, never into a paired Omaha board, V78 kept,
  capped at 0.6.
- Size: Hold'em flop a third on a dry board the raiser owns, 0.55-0.75 with a
  draw, 0.45-0.6 otherwise; turn 0.6-0.8 (probe 0.5-0.7). Pot limit 0.5-0.8 on
  the flop and 0.6-0.9 on the turn, never above the pot; the shove when that is
  the size.
- Reads reshape, never switch off: a credible station x0.55 for draws and x0.25
  for the rest, fold-to-c-bet and the exploit fold read inside [0.6, 1.4], the
  V53 pressure mix as a raise floor. No read is the baseline.
- `opts.flopTurnBluffBaseline` (default on) ablates it; ledger flag and
  `ft_bluff_baseline_*` / `ft_semibluff_raise_*` receipts registered.

## Tests

New law `server/src/engine/HorseFlopTurnBluffRange.law.test.ts`
(`docs/laws.d/horse-flop-turn-bluff-range.md`), NLH and PLO4: qualified spots
bet or raise at non-zero bounded rates, owned by the baseline, and beat the
ablated brain; junk decides identically to the ablated brain; showdown value,
satellite locks, five-way pots, four-way junk and all-in opponents are not
bluffed; a station gets fewer but never zero; a bubble still semi-bluffs; the
PLO paired-board rule holds. Fixtures in `HorseFlopTurnBluff.test-support.ts`.

## Pins moved, with the reason

The baseline deliberately changes no-read flop/turn decisions for qualified
draws, so these isolate it the way #9803 isolated the river baseline:

- `HorseOpponentExploitNeutrality.law.test.ts`: mocks both eligibility
  functions to ineligible (the corpus replays the frozen no-read brain; the
  baseline is opponent-neutral by construction).
- `HorseOmahaTournamentPressureCorpus.test-support.ts` (V53 default-off
  digests): `flopTurnBluffBaseline: false`.
- `GtoPostflop.test.ts` cell wiring: the fixture A9o on Q-J-T holds an
  open-ender, which the baseline now owns before the class-mean cell; the
  wiring tests ablate it.
- `HorseLogic.test.ts` (V7 plans), `HorsePlanFingerprintActivation.law.test.ts`
  (plan withdrawal) and `HorseContinuationOutlookAudit.test.ts` (outlook
  path): their fixtures are a gutshot and a wrap the baseline now owns; the V7
  plan, the Items 21/23 fingerprint and the outlook still govern every
  unqualified hand, and these tests pin those mechanisms with the baseline
  isolated.

`HorseTurnAirDrawCalls.test.ts` (V68) and `HorseMadeHandBeatsClassMean.law.test.ts`
pass unchanged: the baseline does not raise into a pot-sized turn bet, and a
hand with no card of a monotone board's suit is not qualified.

## Remaining gaps

- PLO4 heads-up aggregate c-bet (80%) and barrel (70%) rates already sit above
  solved ranges, carried by made hands (95% of shown turn bets); the baseline
  adds draws. The made-hand side of the Omaha value ladder needs its own audit.
- The V38 EV engine's MDF fold and 85% folded-hand constant still undervalue
  every bluff for spots this layer does not own (short deck, pineapple, fixed
  limit, hi-lo).
- Excluded here: hi-lo, fixed limit, short deck, multi-board, bomb pots, and
  leads into the aggressor (V11).
- Flush draws fold too often facing turn bets (above).
- No league measurement or ablation of the baseline was run; the frequencies
  are class targets, not measured equilibria.

## Activation

Engine change: it activates only in the next certified 04:00-04:05
America/Chicago maintenance release. Not live before then.
