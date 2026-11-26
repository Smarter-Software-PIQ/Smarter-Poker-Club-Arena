# 2026-11-24: Hold'em tournament raise defence priced by EV (three options, default OFF)

Options `holdemTournamentHeadsUpBigBlindDefenceIsPriced`, `holdemTournamentBlindDefenceIsPriced`,
`holdemTournamentCommittedRaiseIsPriced` (registered dark; nothing switched on). Source: the read-only sweep
NLH-TOURNAMENT-SWEEP (leaks L1, L2, L4). Root cause re-read on main: the short-stack push/fold node of
HorsePreflop answers any faced raise with a fixed-bar jam or a fold (no call, no price); the priced heads-up
defences start at 20bb; the all-in call price answers only a jam or an all-in call.

Code: `server/src/engine/HorseHoldemTournamentRaiseDefence.ts` (the price), `...Wiring.ts` (scope, receipts, the
Phase 7 / Phase 8 refusal), `HorseHoldemPreflopClassEquity.data.ts` (generated, `server/scripts/holdem-preflop-class-equity-gen.ts`),
`HorseHoldemTournamentRaiseDefencePriors.data.ts` (fitted, `server/scripts/holdem-tournament-raise-defence-fit.ts`
from `server/scripts/holdem-tournament-raise-defence-export.sql`). Hooks in `HorseLogic.ts` (reference end, Phase 7,
Phase 8, the premium rules stand aside) and `HorseTournamentShoveDiscipline.ts` (stands aside for a priced shove).

Law: `AHoldemTournamentRaiseDefenceIsPriced.law.test.ts`. Authority: `docs/horse-option-authority.d/` (one file per
option). League cards: `hu_holdem_tournament_heads_up_big_blind_defence_is_priced_18bb`,
`mtt6_holdem_tournament_blind_defence_is_priced_17bb`, `mtt6_holdem_tournament_committed_raise_is_priced_22bb`.
Switch-list follow-up migration: pending (PR #11825's migration merges first).

## v2 (same day): anchored to the solved equilibrium

v1 priced its shove against the current pool's own fold-to-jam rates (the leak being fixed) and overshot to never
folding and shoving nearly every hand at 15-25bb. v2: `server/scripts/holdem-tournament-raise-defence-solve/`
(`solve.py`: chip-EV CFR+ of the open / defend / re-raise game, heads-up and ring, 6-40bb, 320 spots, worst
best-response gain 0.0031bb per hand; `realisation-selfplay.ts`: the flop realisation measured in self-play league
hands, no database read), tables `HorseHoldemTournamentRaiseDefenceSolved.data.ts` + reader, the answer
`HorseHoldemTournamentRaiseDefenceAnchored.ts` (the solved mix, one seeded receipted draw; moved by the opponent's own
record, the population fold with a capped and halved trust, the pay-jump factor). With any of the three options on,
the all-in call price reads the same tables for a jam over the open, a 3-bet or a 4-bet. Raise-defence grid: every
spot within 7 points of the solved shares. League (2 seeds x 15,000 pairs): heads-up 18bb +16.15 bb/100 (SE 1.73),
blind defence 17bb +2.31 (0.29), committed raise 22bb +2.98 (0.28), 6-max Sit & Go 17bb (all three) +0.15 (0.25, not
resolved); the 12bb cards were inert in the mirror league (the openers jam or fold there) and moved. Exploit probe
(heads-up, 8-25bb): on minus off +12.95 bb/100 against a min-raise-any-two raise-folder, +13.4 against a correct jam
caller, +15.4 against a Horse. Authority docs carry the tables.

Compliance (same day): the first realisation table was fitted from production hands with both players' starting
hands, cards never shown included; under the owner's ruling (zero unshown hole cards read, live or stored, offline
fitting included) it, its fit and its export were withdrawn and the table refitted in self-play; law
`ARaiseDefenceFitReadsNoUnshownHoleCard`.
