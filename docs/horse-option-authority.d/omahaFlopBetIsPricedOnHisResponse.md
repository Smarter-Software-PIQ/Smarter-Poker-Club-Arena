# omahaFlopBetIsPricedOnHisResponse: authority for the live switch

PLO-OWNER lane REPLACEMENTS-5 (R2, 2026-11-21). Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash flop (table, and Lightning when `omahaPricedInLightning` opens it), high only, one board, no bomb pot, not fixed limit (`omahaPricedInScope`). Default OFF (`=== true`).

1. **Flop bet-or-check (replaces #13 `omahaBareOverpairOopFlopCheck`, HU and multiway, OOP and IP):** in the bare-big-pair-with-preflop-lead spot (`omahaPricedSitesFlopBetSpot`), prices the proposed flop bet beside checking using every live opponent's lifetime HUD public record (`f.fb.{sm|bg}.{hu|mw}`, `f.rBet.{hu|mw}`, `f.stab.{hu|mw}`, `2 * f.stabsz.{hu|mw}`), shrunk continuously `n / (n + k)` with no cliff and no person-vs-Horse key. OOP `evCheck` prices his measured stab rate and stab size; IP `evCheck` closes the flop. The bet stands only when `evBet - evCheck > sampleSe + readSpread`; otherwise it becomes a check.
2. **Flop facing-raise and facing-stab range scaling (addresses B6 unmeasured raiser range):** inside `omahaFlopFacingBetEvRule`, scales the raiser's range by his lifetime HUD `f.rBet.{hu|mw}` relative to population prior (clamped `[0.5, 2.5]`) and the post-check stabber's range by `f.stab.{hu|mw}` (clamped `[0.5, 2.0]`). With `n = 0` or no HUD provider installed, the factor is `1.0` identically.

## Receipts

- `omaha_flop_bet_on_his_response_kept`
- `omaha_flop_bet_on_his_response_checked`
- `omaha_flop_bet_on_his_response_unpriced_kept`
- `omaha_flop_facing_raise_hud_range_scaled`
- `omaha_flop_facing_stab_hud_range_scaled`

## Replay

- Replay: NOT RUN (audited-decision scorer not run; formal 8-cell sparring grade PASS on seeds 20261153/20261154 at head 5062696b9c10, criteria sha256 32b468655489, 7/7 adversaries negative, 56/56 CTRL zero, 0 hard flags, 0/4755 > 100ms latency)
