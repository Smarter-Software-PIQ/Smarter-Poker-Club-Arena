# 2026-11-21: League supports fixed-limit Omaha hi-lo (`flo8`) betting

## Summary

The duplicate league (`HorseLeague.ts` / `LeagueDecisionState.ts`) now deals fixed-limit Omaha hi-lo (`flo8`) with the live engine's fixed-limit betting rules (small bet preflop and flop, big bet turn and river, four-wager street cap, single legal wager amount, controller authoritative menu) paired with hi-lo split showdown settlement (`settleLeagueShowdown` -> `determineWinners`).

## Changes

- **`server/src/benchmark/LeagueDecisionState.ts`**:
  - Admitted `flo8` in `leagueDealsFixedLimit` (alongside `flh`) so `leagueActionState`, `leagueHorseDecisionInput`, and `playHand` run the exact same controller fixed-limit bounds and authoritative menu for `flo8` as `flh`.
  - Kept `leagueFixedLimitRefusal` rejecting stacks at or below 24 big blinds, tournament context, antes, and unqualified field populations (including `flh_scripted_field_v1` on `flo8`, since its postflop helpers evaluate Hold'em hands).
- **`server/src/benchmark/HorseLeague.ts`**:
  - Merged consecutive pot layers with identical eligible seats (and routed orphaned layers to the main pot) in `settleLeagueShowdown` before calling `determineWinners`, matching `PokerEngine.calculatePots` so odd-cent hi-lo splits and ties with folded blinds match `HandController.completeHand` down to the cent.
  - Promoted the three `flo8` arms that genuinely diverge on the legal game (measured at 300 pairs, seed 20261115, `EQUITY_GOVERNOR=off`, 0 illegal / 0 truncated / 0 corrected / 0 brain fallbacks) from `UNMEASURABLE_MATCHUPS` to `FIXED_LIMIT_OMAHA_HILO_CARDS` (`LEAGUE_MATCHUPS`):
    - `flo8_no_omaha_presumption` (heads-up, 2,000 pairs; 59 of 300 diverged Hybrid, 64 of 300 plain)
    - `flo8_priced_preflop` (six seats, 2,000 pairs; 68 of 300 diverged Hybrid, 56 of 300 plain)
    - `flo8_river_full_bet_read` (heads-up; 5 of 300 diverged Hybrid, 5 of 300 plain)
  - Kept the six `flo8` arms that diverged in 0 of 300 pairs (`flo8_nut_low_river_bet`, `flo8_hilo_low_half_floor`, `flo8_call_is_not_a_commitment`, `flo8_river_strong_hand_leads`, `flo8_steal_vs_tight_blinds`, `flo8_read_ignores_probes`) in `UNMEASURABLE_MATCHUPS` with updated legal-game refusal reasons.
- **Tests**:
  - `server/src/benchmark/HorseLeagueFixedLimit.test.ts`: extended node-by-node `HandController` replay (including qualifying-low split showdowns), structure invariants (street bet sizes, four-wager cap, chip conservation, max 24bb loss), refusal checks, and non-inert card runs to cover `flo8` alongside `flh`.
  - `server/src/benchmark/ALeagueDecisionStateIsProductions.law.test.ts`: added `flo8` fixed-limit nodes and `playHand` live-key-set checks.
  - `server/src/benchmark/HorseLeagueHiLoSettlement.test.ts`: added a folded-blind pot-merging parity test for `flo8`.
  - `server/src/benchmark/LeagueInertMatchupsAreRetiredOrRepointed.test.ts`: updated the pinned `UNMEASURABLE_MATCHUPS` list for the three promoted `flo8` cards.
- **Docs**: updated `docs/horse-league-fixed-limit.md`.
