# v87DeepCashOnePairPotControl (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87DeepCashOnePairPotControl` with zero default-ON behavior change so 150bb+ deep-cash bare one-pair river pot control can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts`, when `isV87Nlh` (or `v87NlhManiac`) and `opts.v87DeepCashOnePairPotControl !== false` in cash games (`!isTournamentMode(gs)`): (a) on the river at `effBB87 >= 150` facing a `>= 65%` pot bet after `>= 2` opponent barrels (`barrels40 >= 2`), bare one-pair (`cat === 2`) folds unless the bettor is a verified multi-street postflop maniac (`v87_deep_cash_onepair_pot_control`); (b) inside `maniacCallDown`, bare one-pair (`cat <= 2`) at `150bb+` refuses auto-stacking off for `>= 135bb` / all-in unless the aggressor is a verified multi-street postflop maniac (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public effective stack depth in big blinds (`effBB87`, `totalInvested + stack`), pot, bet size, opponent barrel count (`barrels40`), hero's hand category (`cat`), observed `isLagBully`/`streetBullyRead`/`isPostflopManiac` when `useMind` is enabled, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87DeepCashOnePairPotControl !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league evaluation of 150bb+ deep-cash one-pair pot control without disabling preflop `v87HoldemOverhaul` ranges or any other postflop V87 rule.

## Continuation

Status: MET

Returns a river fold (and withholds `maniacCallDown` override) on deep multi-street bare one-pair spots; two-pair+, sets, and spots under 150bb continue through normal river call pricing unchanged. When `v87DeepCashOnePairPotControl: false`, the spot falls through cleanly to standard V38/V61/V80 river call pricing.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_deep_cash_onepair_pot_control` on 150bb+ deep NLH cash rivers facing multi-street large barrels inside the ~4,300 fires/day V87 postflop bundle. Tournaments and stacks under 150bb are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em cash games at 150bb+ effective depth (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2 && !isTournamentMode(gs)`). Tournaments, PLO4, PLO5, PLO6, and all Omaha variants are excluded and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_deep_cash_onepair_pot_control` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87DeepCashOnePairPotControl` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87DeepCashOnePairPotControl: false` isolates only the 150bb+ deep-cash one-pair river fold and its paired `maniacCallDown` stack-off refusal guard.
