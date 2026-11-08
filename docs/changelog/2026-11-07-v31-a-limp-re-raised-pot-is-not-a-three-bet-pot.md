# V31: a limp-re-raised pot is not a three-bet pot

Date: 2026-11-07

## Defect

PR #9924 keyed a pot limped and then raised once as `lrp`, apart from `srp`.
It left the rest of the limped family alone: a limp followed by two raises
was still keyed `3bet`, and a limp followed by three or more raises
`4bet_plus`, the same as a raise-first-in pot that was re-raised. The ranges
differ just as much (a limp-raise or iso-then-re-raise range, not a three-bet
range against an open), so a `3bet` / `4bet_plus` playbook cell could have
been served in a limp-re-raised spot.

## Fix

`gtoV31PotType` (server/src/engine/GtoDecisionContext.ts) now returns:

| preflop line                         | pot type     |
| ------------------------------------ | ------------ |
| no raise                             | `limped`     |
| one raise, no limp before it         | `srp`        |
| limp, then one raise                 | `lrp`        |
| two raises, no limp before the first | `3bet`       |
| limp, then two raises                | `l3bet`      |
| three+ raises, no limp before        | `4bet_plus`  |
| limp, then three or more raises      | `l4bet_plus` |

A limp is a voluntary preflop call, or an all-in that raises nothing, before
the first raise (unchanged from #9924). A cold call of an open before a
three-bet is a flat, not a limp, and stays `3bet`.

`lrp`, `l3bet` and `l4bet_plus` (type `GtoV31LimpedRaisedPotType`) are values
the consult can ask for but no sealed cell can carry: `GtoV31SealedPotType`
keeps the four sealed values, the loader's `POT_TYPES` check admits only
those, and the database CHECKs on `gto_v31_runtime_cells.pot_type` and the
`fn_gto_v31_*` context validators refuse anything else. Every consult in a
limped-then-raised pot therefore misses with the ordinary `no_cell` miss. The
key format is unchanged (13 fields, same order).

## Every key producer agrees

`gtoV31PotType` is the only function that derives a pot type from an action
history (no SQL or script derives it), and every producer reads it:

- the live consult (`HorseV31CertifiedPolicy`, the only caller);
- the R8 density pre-flight demand hook and `gtoV31DemandCell`, which take
  the consult's `potType` (an `l3bet` ask is its own `...|l3bet|...` cell and
  falls outside the default `--pots=srp` scope);
- the evaluator (`HorseSolverAgreementV31`, `decisionState.potType`) and the
  replay digest (`GtoV31ReplayDigest`), which run the same consult on the
  recorded action history.

## Execution fingerprint

`GtoDecisionContext.ts` is inside the V31 execution fingerprint walk, so the
execution digest changes with this commit. Checked read-only before merging:
`gto_v31_serving_bindings` has 0 unrevoked rows and `gto_v31_datasets` has no
active or promoted dataset (10 building, 1 evaluating, 1 rejected), so no
certified playbook is stranded.

## Tests

Both failed on the unmodified source (`expected '3bet' to be 'l3bet'`) and
pass with the fix.

- `GtoDecisionContext.test.ts`: 6-max and heads-up limp / iso / re-raise
  lines are `l3bet`; a third raise (all-in or not) is `l4bet_plus`; an all-in
  limp counts; re-raised pots without a limp stay `3bet` / `4bet_plus`; a cold
  call of the open before the three-bet stays `3bet`.
- `GtoV31DensityPreflight.test.ts`: through the full brain, a heads-up
  raise-first-in three-bet pot is keyed `3bet` and answered by a sealed
  `3bet` cell; the same spot reached by limp, raise and re-raise is keyed
  `l3bet`, misses, and its demand key differs from the `3bet` cell key.
