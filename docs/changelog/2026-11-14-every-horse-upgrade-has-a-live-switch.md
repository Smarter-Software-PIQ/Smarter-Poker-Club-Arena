# Every Horse decision upgrade has a live switch

The style read switch (2026-11-13) could carry seven options. Other built Horse
decision options that ship switched off could only be turned on, or turned back
off, with an engine release. This change widens the same switch so it also
carries fourteen of them. It is the same table (`ca_horse_style_switch`), the
same audit table, the same 30 second engine read and the same worker message.
There is no second table.

**Nothing is switched by this change.** The migration adds no row. With no row
for an option the engine does not pass that option at all, so the code default
decides exactly as before; a real decision with an empty switch is handed the
same options and journals the same replay state as one with no switch wired.

## What an operator can do after the migration is installed and an engine carrying this change serves

Service role only; every change is recorded in `ca_horse_style_switch_audit`
with the actor, the time and a note.

    SELECT public.fn_ca_horse_option_switch_set('<option>', 'off', '<actor>', '<note>');  -- 'on' only with evidence, below
    SELECT public.fn_ca_horse_option_switch_clear('<option>', '<actor>', '<note>');  -- back to the release default
    SELECT public.fn_ca_horse_option_switch_effective();

A change reaches every decision worker within about 30 seconds. The switch is
fleet-wide per option: there is no per-Horse, per-lane, per-club or per-table
setting.

## Switchable options (release default of every one: off)

The seven style options, unchanged, with off, shadow, canary and on:
`styleValueBettorNotManiac`, `styleBigBetHonesty`, `styleRaiseRespect`,
`styleTightReRaiserRespect`, `styleFoldRatePreRepair`, `styleValueExtraction`,
`styleFoldBluff`.

Fourteen more, with no shadow arm, offered `off` (and clear) only until each
earns its promotion evidence (see the next section): `v16Hu`,
`v16Ratio`, `v17RiverProbe`, `v23ShortDeck`, `v32FacingDefense`,
`v33DepthCeiling`, `v55OmahaRiverTripsFlat`, `commitUnderPot`,
`v62RiverBettorPolarity`, `readPostflopFoldRate`, `readShrinkResponse`,
`readBreakEvenBluff`, `readScopedShrink`, `omahaNeutralUnknown`.

## 'on' needs promotion evidence (HA-10878-1)

A fleet-wide `on` row for one of the fourteen is the same behaviour as turning
that option on by default, with no review between the row and the decision. So
the switch offers `on` only for an option whose evidence file
`docs/horse-default-on.d/<option>.md` exists: the same directory and naming rule
as `HorseDefaultOnNeedsEvidence.law.test.ts`, and the file must also name the
option, its pull request, its switch scope (equal to the registry scope) and the
head it was reviewed at. **Today none of the fourteen has one, so none can be
set `on`.** `off` and clear stay available for every registered option.

The refusal is enforced at every boundary:

- Engine registry: `OPTION_SWITCH_EVIDENCED_ON` (empty) decides which options
  are registered with `on`; registering `on` without evidence throws at load.
- Engine parser: a configuration carrying `on` for an option without evidence is
  invalid, so every non-style option runs at its release default, on the first
  read of a new worker exactly as on later reads; a replay record carrying one
  is not a valid record.
- Database: `fn_ca_horse_option_switch_states` answers `{off}` for such an
  option, `fn_ca_horse_option_switch_set` raises on `on` before any write, and a
  table check (`ca_horse_style_switch_on_needs_evidence`) refuses an `on` row
  from any writer, the owner role included.
- Law: `everyUpgradeHasALiveSwitch.law.test.ts` fails when the evidenced list,
  the two migration lists and the evidence directory diverge.

The seven style options keep their own states and their shadow and canary
controls, unchanged. None of the seven has a file in `docs/horse-default-on.d/`.

## Never switchable here

Refused by name by the engine registry, by the database functions and by the
worker: the authority-gated options (the cash feature pack, `v53PloTourneyIcm`,
the Phase 8 guard), the phase packs, Pillar 2 and the deep-dive discipline it
lives in, the V31 solver store (R7/R8), held-out packs, All-In-Or-Fold
widening, blind steal, the two withdrawn PLO6 rules, and every option that
changes a preflop range while the owner's preflop range hold stands
(`v46ShortDeck`, `nashPushFoldIcm`, `huBbDefendsToPrice`,
`huOpenerDefendsToPrice`, `huLimpDefendsToPrice`, `facingOpenFullRingZone`,
`committedStackPricedIn`, `vs3BetShortStack`, `holdemPersonaReRaiseMix`).
Lifting a hold for one option is a source change to the registry and to the
migration whitelist, reviewed like any other.

## Failure and restart

A worker that has just started, a read that fails twice in a row, an answer
that is not the documented shape, an answer naming an option the engine does
not know, and an answer older than 120 seconds all leave every one of the
fourteen options at its release default (not at its last value, and not forced
off). The seven style options keep their own rule: they read as off. A
malformed answer never stops a decision.

An engine that predates this change keeps working: it reads
`fn_ca_horse_style_switch_effective`, which keeps its shape and names only the
style options. An engine with this change on a database without the migration
falls back to that same function and switches nothing else.

## Replay

A decision made with any of the fourteen options switched journals the switched
set in its replay state (`horse-decision-replay-state-v5`). Replay restores the
set from the record and never reads the live switch. A decision with nothing
switched keeps the version it had (v3, or v4 with a style state), byte for byte.

## Proof

`scripts/ci/test-horse-option-switch-evidence-postgres.sh` (workflow
`horse-option-switch-evidence-proof.yml`) installs both switch migrations on a
throwaway PostgreSQL 17 and proves by execution: the options offered `on` equal
the style options plus those with an evidence file; for each of the fourteen
the set function and the table refuse `on`, and the old style setter refuses
the name; `off` and clear work and each writes one audit row with its actor;
the refused options are refused by states, set and clear; the style options
still take shadow, canary, on and off; a style row written before the migration
survives it. Run against the migration as it was at 0260f14b, 60 of its
assertions fail.

`server/src/engine/horseDecision/everyUpgradeHasALiveSwitch.law.test.ts` (real
worker decisions, the migration whitelist against the registry, the refusals on
both sides, grants, audit, failure and replay) and
`server/src/engine/HorseOptionSwitch.test.ts` (registry, parser, holder).
`HorseUpgradeManifestRuntimeParity.law.test.ts` and the manifest digest test
are unchanged.

Limits: beside the PostgreSQL proof above, the database half is proven from the
migration source and by the migration's own read-back block, which raises at install if a held option
answers as switchable or a browser role holds a grant. An answer naming an
option an older engine does not know sets that engine's fourteen options back
to their release defaults until the engine is released, so a later addition to
the whitelist must ship in the engine before its row is set.
