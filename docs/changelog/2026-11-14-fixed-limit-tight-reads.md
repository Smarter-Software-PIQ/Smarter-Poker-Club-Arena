# Fixed limit reads a tight player as tight (two default-off fixes)

Fixed-Limit lane, 2026-11-14. Diagnosis: agent evidence `fixed-limit-01Gw7aDr/O-TIGHT-FL-DIAGNOSIS.md` ("Smallest fix designs" 1 and 2); implementation record: `N-ADAPTATION-FIX.md` sections T1 and T2. Both DEFAULT OFF; nothing turns them on.

## T1. Fixed-limit Omaha has no presumption (`HorseDecideOpts.fixedLimitOmahaNoPresumption`, read as `=== true`)

Every Omaha opponent without a disproof is read as an aggressive raiser (`presumedAggressorRead`, owner update 2026-10-27). That is a pot-limit policy: it prices a pot-sized raise. In flo8 a raise costs one bet and a 21-27 percent raiser never disproves it, so a tight-value player stayed "presumed" at 1,000 hands and the Horse opened 159 of 400 first-in buttons against him versus 202 with memory off (diagnostic harness). With the option on, `HorseMind.opponentRead` returns the opponent's own measured read on a fixed-limit Omaha decision. The `omahaNeutralUnknown` branch, when on, still runs first. Pot-limit Omaha (hi-lo included) is unchanged. Decision-time only: no store is read or written differently. Receipt `fixed_limit_omaha_presumption_withheld`; refused league matchup `flo8_no_omaha_presumption`. Law `AFixedLimitOmahaHasNoPresumption.law.test.ts`.

## T2. Fixed-limit river bets are showdown value evidence (process switch `HorseMind.setFixedLimitRiverBetsAreValueEvidence`, source default `FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT = false`)

V83 (`aggressionShownAsValue`) keeps neutral respect for a bettor whose big river bets reached showdown strong (20+ of them, 75 percent strong), but counted only river bets of at least 20 big blinds, which cannot exist in fixed limit. A tight-value fixed-limit bettor therefore kept callDownMod 1.2 (called down lighter). With the switch on, `observeHandComplete` counts every river bet or raise that reached showdown in a hand whose `riverCallContext.variant` is fixed limit. No-limit and pot-limit keep the 20-big-blind bar; a hand without a river-call context is unchanged. Process-level like the probe switch, because counting runs outside a decision.

Stores: `OpponentStats.bigBetSD` / `bigBetSDStrong` (and the V43 snap/tank showdown tallies counted in the same loop), which are persisted in `horse_mind_stats` (`bigbet_sd`, `bigbet_sd_strong`) and pooled per player across games, so a player's fixed-limit showdowns would also count toward the same player's V83 read in other games. Future counting only: nothing already counted is reset, rewritten or replayed. Receipt `fixed_limit_river_bet_showdown_counted`. Law `AFixedLimitRiverBetIsValueEvidence.law.test.ts`.

## Not done

No evaluation (the league deals no fixed limit). No activation route: live requests carry no decide options; T2 is a source default. Turning either on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`.
