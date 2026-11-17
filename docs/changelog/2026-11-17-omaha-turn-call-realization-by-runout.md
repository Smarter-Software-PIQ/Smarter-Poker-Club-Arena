# Omaha: a turn call's realization is read from the runout (default OFF)

Date: 2026-11-17. Lane: PLO Strategy (Phase 2, texture-based equity realization). Owner instruction 2026-11-17 10:56 America/Chicago and ruling 2026-11-16 ("the size of the bet should not make or break the decision"). One new option, off by default (read `=== true`): `omahaTurnCallRealizationByRunout`. Nothing is switched on by this change.

## What was there

With `omahaFacingBetEv` on (it is on live), a PLO4/PLO5 turn call with chips behind multiplies its exact showdown equity by one realization factor: 0.85 out of position, 0.92 in position, 0.85 with a player behind, whatever the hand and the board. The numbers are hold'em-origin (`GtoFacingDefenseV32.realizationFactor`). Two hand-specific caps were added on 2026-11-16 for hands the flat number priced wrong, each behind a bet-size threshold (40% and 70% of the pot).

## What the live hands show

Read-only, PLO5 cash with a person seated, 2026-11-16T23:42Z to 2026-11-17T17:00Z: hands in which a Horse called a turn bet netted -812 bb over 16 calls on three-suited boards and -591 bb over 14 calls on connected boards, against +167 bb over 73 calls on dry boards and +517 bb over 29 calls on paired boards (where the 2026-11-16 cap already acts). Small samples, whole-hand results: they locate the question, they are not an evaluation.

## What changed

New `server/src/engine/HorseOmahaRunoutRealization.ts` (pure). The exact turn count already scores the hand on every river card against the bettor's value region and against his other holdings; it now returns those per-river results (`OmahaEvHandCounts.runout`). With the option on, the factor of a non-final turn call is read from them:

- a river where the hand beats at least half of his value region: that river's equity is realized in full;
- a river where it beats under a fifth: its wins against his value region are not realized, and its wins against his other holdings are realized at the share a non-value holding checks down (0.6 in position, 0.45 out), rising to full as this bettor's bluff share goes from 0.35 to 0.6;
- linear in between; the factor stays within 0.35 and 1.

The earlier caps still apply after it as upper bounds. No term is the size of the bet. Six-card hands, the river and a final call are untouched. With the option unset or false the verdict is identical key for key.

The constants are stated, not measured. The option stays off until league cards `plo4_omaha_turn_call_realization_by_runout` and `plo5_omaha_turn_call_realization_by_runout` pass; authority file `docs/horse-option-authority.d/omahaTurnCallRealizationByRunout.md`.

## Files

- `server/src/engine/HorseOmahaRunoutRealization.ts`, `HorseOmahaRunoutRealization.test.ts` (new).
- `server/src/engine/HorseOmahaFacingBetEv.ts`: the per-river rows and the verdict hook.
- `server/src/engine/HorseLogic.ts`: the option, the count memo key and the verdict context.
- `server/src/engine/HorseDataLedger.ts`, `server/src/benchmark/HorseLeague.ts`: the ledger entry and the two league cards.
- `supabase/migrations/20261117170855_horse_option_switch_plo_turn_call_realization_by_runout.sql` and `scripts/ci/test-horse-option-switch-evidence-postgres.sh`: the generated switch lists.
