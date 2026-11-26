# holdemPersonaPostflopIsPriced: authority for the live switch

**State: OFF** (dark): source default OFF, read `=== true`; held in `OPTION_SWITCH_REFUSED` (`server/src/engine/HorseOptionSwitch.ts`: "pending registration: no switch-list migration lists it yet (built dark 2026-11-21, Horse Switch lane)") until a switch-list migration registers it; it has no switch row and this file proposes none. This file is `holdemPersonaPostflopIsPriced.UNREGISTERED.md` until the registration change renames it to `holdemPersonaPostflopIsPriced.md` (an option file must name a registered option: `everySwitchListNameIsRegistered.law.test.ts`). Code: the dark Hold'em bundle PR #11812 (stacked on the HORSE DECISIONS combo; open, not merged, read 2026-11-22). Evidence NOT MET: the pre-registered offline league grade `persona-v2` (V2 empirical priors) is PASS (PRIMARY 6-max cash `-0.166 +/- 0.481 bb/100`, `z = -0.344`, equal-weight pooled over 4 seeds, a not-worse bar, not a measured gain; worst guarded cell `-0.913 +/- 1.001`, `z = -0.912`; CONTROL inert; `0` illegal, `0` truncated, `0` brain fallbacks), but Criterion 5 of the same criteria, the replay on real audited decisions (HVH48 Auditor D), is not run: the scorer refuses an option set that names an option the registry refuses, so it can run only after the switch-list migration. Criterion 2 (at least 2,000 priced decisions per card, a separate telemetry pass) is not measured in the grade folder. Switch-on waits for that replay row (`newlyWrong <= fixed`) under `## Replay`.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. The module also cites the owner orders of 2026-11-20 15:27 (no blanket rule decides a Horse action) and 2026-11-21 02:00 (every blanket rule goes off one at a time, each tested and validated) America/Chicago; no verbatim copy of those two is in `docs/`. Built by the Horse Switch lane on 2026-11-21, V2 empirical priors (graded HEAD `de694e9a23702d3ca5e398c59ae659a12b3a0686`, merged into the bundle by `8511f9817577`).

## The blanket rule it replaces

Four V87 postflop spots in two-card no-limit hold'em, decided by a fixed frequency on a per-spot hash unit (`v87SpotUnit`), scaled by the Horse's persona when `holdemPersonaPostflop` (default OFF) is on (`HorseHoldemPersonaPostflop`):

- `cbet`: heads-up, in position, the Horse's initiative, dry flop, weak hand: bet about 0.33 pot on 52% (air) or 58% (a weak pair) of spots, times the archetype's c-bet scale;
- `stab`: the turn takeaway, heads-up in position after the flop stabber checked the turn: bet about 0.67 pot on `min(0.9, 0.55 + probeRate x 0.6)` of spots, times the archetype's stab scale;
- `trap`: out of position on the flop against a high-frequency stabber with strong top pair or better or a 12+ out draw: check (to check-raise) on 42% of spots, or the persona's trap figure;
- `check_raise`: the flop check-raise into that stabber's bet: raise about `0.9 x (pot + call)` on 42% of spots, or the persona's trap figure.

None of those frequencies reads the price of the action or what this opponent has shown.

## What it does

Code: `server/src/engine/HorseHoldemPersonaPostflopIsPriced.ts`, read in `HorseLogic.decidePostflop` at the four V87 spots. In the same spots with the same entry conditions, the frequency is replaced by a comparison of expected values from the heads-up model of `HorseHoldemValueAndCallsArePriced` (`holdemPricedVerdict`), against this opponent's line range (his preflop band re-weighted by his line this hand), with measured live NLH empirical priors (`holdemEmpiricalPriors.ts`) shrunk smoothly toward his reads (OpponentHud when available, else HorseMind `ExploitCounters` with `k = 6`; the pool prior at `n = 0`):

- `cbet`: the flop c-bet fold prior by position, size (0.33 pot), flop texture (paired `1.091x`, unpaired non-monotone `1.000x`, monotone `0.780x`) and effective SPR (below 3 `0.719x`, 3 to 7 `1.141x`, 7 and deeper `1.000x`); bet when `EV(bet) > EV(check)`.
- `stab`: the turn first-bet fold prior by position and size (0.67 pot); bet when `EV(bet) > EV(check)`.
- `trap`: the flop bet-when-checked-to prior (33.50% live NLH) and the out-of-position flop fold-to-bet prior (35.0% medium); check when `EV(check)` is at least the EV of every priced bet size (a tie keeps the passive option).
- `check_raise`: the NLH flop fold-to-raise prior (`estimateHoldemFoldToRaisePrior`, #11759) by raise-to-bet and raise-to-pot ratios, effective SPR, all-in commitment and OpponentHud `f.fRaise` / `f.fBet` shrinkage; raise when the value raise beats fold and call (equity above 0.5 against the continuing range).

When a spot is taken, the site's own action follows as today (its sizes on its own hash units, the downstream c-bet blocks, the V78 commit check of the check-raise); when declined, the decision falls through to the rest of the engine as when today's unit misses. More than one live opponent, no population cell or an empty range: the spot is declined (`*_unpriced`). Independent of `holdemPersonaPostflop`: with this option on the four spots are priced whatever that option's state and the persona scales are not read there. No random number. Not All-In-Or-Fold. Off (absent or false): nothing here is read; byte-identical.

## Receipts

`holdem_persona_postflop_priced_cbet_taken`, `holdem_persona_postflop_priced_cbet_declined`, `holdem_persona_postflop_priced_stab_taken`, `holdem_persona_postflop_priced_stab_declined`, `holdem_persona_postflop_priced_trap_taken`, `holdem_persona_postflop_priced_trap_declined`, `holdem_persona_postflop_priced_check_raise_taken`, `holdem_persona_postflop_priced_check_raise_declined`, `holdem_persona_postflop_priced_unpriced` (registered in `HorseDataLedger.ts`, tag `PersonaPostflop`).

## Tests

`server/src/engine/HoldemPersonaPostflopIsPriced.law.test.ts` (registered in `docs/laws.d/server-src-engine-HoldemPersonaPostflopIsPriced.md`): with the option on, the four spots are decided deterministically by EV on the measured priors (position, texture, effective SPR, turn fold, flop bet-when-checked-to, the true villain raise call fraction), independent of `holdemPersonaPostflop`; off, every decision and receipt is byte-identical. Its grade cards (`cash6_holdem_persona_postflop_is_priced`, `hu_holdem_persona_postflop_is_priced`) are `DEVELOPMENT_LEAGUE_CARDS` in `server/src/benchmark/HorseLeague.ts`.

## Evidence rows

- Mechanism, scope, receipts, law test, off byte-identical: met (law test above).
- League grade (offline, pre-registered): PASS (below). The PRIMARY point estimate is negative and not significant: the bar is "not worse".
- Priced decisions per card (Criterion 2, at least 2,000): not measured (the manifest calls for a separate telemetry pass; none is in the grade folder).
- Replay on real audited decisions (Criterion 5): NOT RUN (see `## Replay`).

## Grade (2026-11-22, `persona-v2`)

Evidence: `/Volumes/SmarterWork/agent-work/extreme-capacity/horse-switch-013U37bWhV/grade-runs/persona-v2/` (`VERDICT.md`, `verdict.json`, `results.jsonl` sha256 `b87c1301e0975137e3d2f84f4bf8b45cacea72662acb47dbc4d8571e322dc9fd`). Pre-registered manifest `grade-manifests/persona-v2.manifest.json` (sha256 `dc6554220bb4ccd2e8ca8066fce2897471314b38094363cf74fd30fbb16ebf85`, the sha the verdict records) and criteria `/Volumes/SmarterWork/agent-work/extreme-capacity/hs-enh2-151f9a34/persona-v2/CRITERIA-AMENDMENT-v2-empirical-priors.md` (sha256 `e5df650faa67d6d953571169ed035e2d33e8535d09365f1fcd7a9a3eb96fc7b1`; the file's sha256, recomputed 2026-11-22, matches). Harness `scripts/ops/grade-holdem-option.mjs` (schema `holdem-grade-harness/v1`, runner sha256 `a10e3a07f494868446854b812cbd2946af30a03b221078e4fdeea3207d80d6e5`, library sha256 `0be911c9b6414562b985f6510d9a097800dad6971dfc8cd8bdf530e2a69572de`), pinned HEAD `de694e9a2370`, offline solver stores, 6,000 pairs per seed, seeds `20261122` to `20261125`.

Arms: A `{ holdemPersonaPostflop: true, holdemPersonaPostflopIsPriced: true }` vs B `{ holdemPersonaPostflop: true }`. Bars (pre-registered): PRIMARY equal-weight pooled `z >= -1.0` (not worse); every PRIMARY and GUARD seed and the pooled GUARD above `-2.0 x` its own SE; CONTROL inert; no illegal, truncated or fallback action.

- **Verdict: PASS.** All `9` cell exit codes `0`.
- PRIMARY `cash6_holdem_persona_postflop_is_priced` (6-max NLH cash): equal-weight pooled **`-0.166 +/- 0.481 bb/100` (`z = -0.344`)**; inverse-variance cross-check `-0.136 +/- 0.454` (`z = -0.299`). Seeds: `-0.913 +/- 1.001` (`z = -0.912`), `+0.193 +/- 1.084` (`+0.178`), `+0.026 +/- 1.018` (`+0.025`), `+0.031 +/- 0.700` (`+0.044`). `736` divergent pairs.
- GUARD `hu_holdem_persona_postflop_is_priced` (heads-up NLH cash): pooled inverse-variance `+1.949 +/- 2.201` (`z = +0.886`), equal-weight `+2.133 +/- 2.210`. Seeds: `-0.996 +/- 4.254`, `+1.067 +/- 4.267`, `+5.287 +/- 4.761`, `+3.173 +/- 4.379`.
- Worst guarded cell: `cash6_holdem_persona_postflop_is_priced` seed `20261122`, `-0.913 +/- 1.001` (`z = -0.912`), inside the `-2.0` bar.
- CONTROL (`a = b = { holdemPersonaPostflop: true }`, seed `20261122`): `0` parted hands, `0` divergent pairs, `0.000 bb/100` (inert).
- Hard flags: `0` illegal, `0` truncated, `0` brain fallbacks.
- VERIFIER-10 recompute: the verdict names the command (`node scripts/ops/grade-holdem-option.mjs recompute ... --criteria-sha=e5df650f... --compare=<verdict.json>`); no recompute result is recorded in the grade folder (not measured).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (as of 2026-11-22 no replay of holdemPersonaPostflopIsPriced on real audited decisions is recorded; the pre-registered Criterion 5, HVH48 Auditor D real-card replay with newlyWrong <= fixed, waits for its switch-list registration, because the scorer refuses an option set naming an option in OPTION_SWITCH_REFUSED)

## Limits

- No measured gain: PRIMARY pooled `-0.166 +/- 0.481` is a negative point estimate, not significant; the heads-up guard is positive and not significant. The case for it is the removal of the fixed and persona frequencies (the owner order), not a league win.
- Heads-up only: with more than one live opponent the spot is declined, so the multiway V87 decisions are unchanged.
- The grade plays `holdemPersonaPostflop: true` in both arms; that parent is default OFF in source, and whether production carries it on was not read here, so how the option compares with the production brain at these spots is not measured.
- The grade is offline Horse-against-Horse league play with empty solver stores; no human field and no live decision has seen it. `HorseHoldemPersonaPostflopIsPriced.ts` in the bundle is byte-identical to the graded HEAD; `HorseLogic.ts` and `holdemEmpiricalPriors.ts` carry later merges. A grade on the bundle itself is not measured.

## Rollback

It is OFF and has no switch row, so nothing is rolled back today. Once a switch-list migration registers it and it is switched on with the note `authority: holdemPersonaPostflopIsPriced <the path of this file after that rename> sha256 <64 hex>` (this file's sha256 after that rename; `HorseOptionSwitch.optionSwitchOnNote`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemPersonaPostflopIsPriced off --rollback --reason <text> --authority <ref> --changed-by <actor>` (`fn_ca_horse_option_switch_set('holdemPersonaPostflopIsPriced', 'off', '<actor>', '<reason>')`). Off is byte-identical to the base brain (law test); no data migration.

Rollback triggers (any one, while it is on):

- any `horse_decision_refused_isolated` row;
- any `phase15_execution_fallback` row;
- `recoverableRequestErrors` above `0`;
- new `horse_error_log` rows tied to it (a decision carrying one of its receipts, or an error in `HorseHoldemPersonaPostflopIsPriced.ts` or its `HorseLogic` sites).
