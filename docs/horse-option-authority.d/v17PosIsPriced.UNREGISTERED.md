# v17PosIsPriced: authority for the live switch (unregistered / dark)

**State: OFF in source (read `=== true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations, zero switch rows), not yet registered in the SQL option switch (registration rides the switch-list route and the rename to `v17PosIsPriced.md`). Evidence NOT MET.** Mechanism, scope, receipts, law tests, OFF identity and HVH48 D + E hard safety are met; the activation bar is not (people-only changed decisions `n = 0 < 20`).

Criteria declared before build or replay: `/Volumes/SmarterWork/agent-work/extreme-capacity/hd-abe2654e/criteria/CRITERIA-V17POS-PLAYERS-BEHIND-PRICED.md` (sha256 `417a75e9ca7d067c8b835324572a9af178f1e9b8c4d77563abd1370d4c2c8aee`, HORSE DECISIONS lane Worker POS, 2026-11-22). Ownership: unclaimed (Horse SWITCH, inbox 2026-11-22T22:06:27Z); Omaha bytes untouched under PLO lead-5's freeze.

## What it replaces

The V17 positional-pressure table in `server/src/engine/HorseLogic.ts`: `bluffScale *= 1.1 / 1.0 / 0.72 / 0.5` for 0 / 1 / 2 / 3+ live, not-all-in players acting after the Horse this street (`v17_pos_behind`, about 140,000 to 316,000 fires a day, every variant). With the option on it is replaced in single-board no-limit Texas Hold'em on the flop and turn only.

## How each decision is priced

Pure module `server/src/engine/HorsePlayersBehindBluffPriced.ts` (`pricePlayersBehindBluff`), zero `fastRandom()` draws, public seats, stacks, the flop and in-session counters only:

- Each respondable opponent is behind or in front of the Horse (the `playersBehind17` order). Its fold probability is the measured NLH fold-to-first-bet rate of #11724 for the street and size band, bettor in position for an opponent in front and out of position for one behind, times the measured flop texture multiplier, scaled by that player's in-session fold-to-bet read (`rho = shrunk / pooled`, 6 pseudo-observations; a stranger is the pool).
- `F_act` = the probability the whole field folds; `F_ref` = the same field with only the first player behind priced as behind (the order the last-to-act binary already prices).
- Reference size `s = min(0.67 pot, effective stack) / pot`; risk-adjusted break-even `FE_be = bf s / (1 + bf s)` with the hero bubble factor in tournaments.
- `m = max(F_act / F_ref, min(1, F_act / FE_be))`: 1 with zero or one player behind; each extra player behind costs that player's measured oop / ip fold ratio (strangers: flop 0.6903, turn 0.8263 at the reference size) unless the field still beats the price.
- Unchanged even when ON: the river (no measured seat-relation split for river first bets), Omaha (PLO4/5/6/8), Short Deck, Fixed Limit, pineapple, pot-limit Hold'em, multi-board and bomb pots. Unpriceable spots keep the fixed table.

## Receipts & Tests

- Receipts (`HorseDataLedger.ts`): `v17_pos_priced_trim`, `v17_pos_priced_neutral`, `v17_pos_priced_unpriced`.
- Law: `server/src/engine/AV17PosIsPriced.law.test.ts` (`docs/laws.d/server-src-engine-AV17PosIsPriced.md`). League cards `nlh_v17_pos_is_priced` (cash) and `nlh_mtt_v17_pos_is_priced` (MTT, 40 bb, big-blind ante).

## Replay

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2734; unjudged 0; set hvh48-D-nlh-cash-asof; scorer 5d54a7a86ee; source placed verdict-only; arm v17p vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 5356; unjudged 0; set hvh48-E-nlh-tourney-asof; scorer 5d54a7a86ee; source placed verdict-only; arm v17p vs off; replayed 5356 of 10937

HVH48 D (cash) and E (tournament) AsOf-memory replay, seeds `1, 7, 42`, live 67-row switch snapshot (`prod-switch-20261122T0336Z.json`), de-duplicated on (hand, seat, decision time, toCall, currentBet), 0 duplicates dropped, zero hole cards or hand ids recorded: 0 illegal, 0 refused, 0 errors, 0 changed decisions in every slice (all, people-only, people-only without the top person, Horse-only, mixed). Priced receipts on the ON arm: D trim 278 / neutral 819 / unpriced 13; E trim 45 / neutral 1,062 / unpriced 48. People-only spots drew no trim receipt (D neutral 126 / unpriced 7; E neutral 234 / unpriced 18). Real-card grade: no changed decision to grade.

### Why Evidence NOT MET

No people-only decision changed (`n = 0 < 20`): no people-only flop or turn spot drew a trim, and the trims on Horse-only and mixed spots moved no modal action over the three seeds. Activation needs a real-human sample with multiway flop / turn bluff spots and the bars of the criteria file.
