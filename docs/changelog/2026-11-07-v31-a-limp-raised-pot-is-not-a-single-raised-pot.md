# V31: a limp-raised pot is not a single-raised pot

Date: 2026-11-07

## Defect

The certified V31 postflop playbook keys a spot as
`street|game_family|objective|utility_context|table_size|pot_type|hero_position|opponent_position|depth_bucket|texture_class|node_role|facing_kind|facing_size_bucket`.
`gtoV31PotType` counted preflop raises only, so a pot that was limped and then
raised once was keyed `srp`, the same as a pot opened with a raise and called.
The two have very different preflop ranges (a limping range against an
iso-raise, versus an opening range against a flatting range), so a cell solved
for open-raise-and-call pots would have been served in limp-raised pots.

Measured with the R8 density pre-flight: 4,394 of 22,116 in-scope probe asks
(20%) came from limped pots and were keyed `srp`.

## Fix

`gtoV31PotType` (server/src/engine/GtoDecisionContext.ts) now returns a
distinct pot type, `lrp`, when a voluntary preflop call (a limp, or an all-in
that raises nothing) comes before the only preflop raise. Blinds and antes are
not in the action history, so a preflop fold or the big blind's check never
counts as a limp. Pots with no raise stay `limped`; two or more raises stay
`3bet` / `4bet_plus`.

`lrp` is a value the consult can ask for but no sealed cell can carry:
`GtoV31SealedPotType` keeps the four sealed values, the loader's `POT_TYPES`
check still admits only those four, and the database CHECKs on
`gto_v31_runtime_cells.pot_type` (and every `fn_gto_v31_*` context validator)
already refuse anything else. So every V31 consult in a limp-raised pot misses
with the ordinary `no_cell` miss, and the V32 open-node fallback
(`gtoV31CellMatrix`) misses the same way. The key format is otherwise
unchanged (13 fields, same order).

The same function feeds every producer of the key, so they agree without
further change: the live consult (`HorseV31CertifiedPolicy`), the R8 density
pre-flight demand hook and `gtoV31DemandCell` (a limp-raised ask is now its
own `...|lrp|...` cell and falls outside the default `--pots=srp` scope), and
the evaluator and replay digest, which run the same consult.

No SQL derives `pot_type` from an action history; the database only validates
the four sealed values on sealed cells and on agreement receipts, which are
written for hits only. No migration is needed.

## Execution fingerprint

`GtoDecisionContext.ts` is inside the V31 execution fingerprint walk, so the
execution digest changes with this commit. No V31 dataset is active and no
serving binding exists, so no certified playbook is stranded by the change.

## R8 consequences

The R8 density pre-flight must be re-run on this commit: limp-raised asks
now land in `lrp` cells instead of inflating `srp` cells, so the frozen plan's
per-cell demand (made with the local `--max-limped-share=0` patch) should be
re-derived from the engine itself; the local patch is no longer needed.

Not covered here: a limp followed by two or more raises is still keyed `3bet`
/ `4bet_plus`.

## Tests

- `GtoDecisionContext.test.ts`: limp then iso-raise (6-max and heads-up), an
  all-in limp, folds before the open, flats after the open, and a pot limped
  to the flop.
- `GtoV31DensityPreflight.test.ts`: through the full brain, a heads-up
  raise-first-in pot is keyed `srp` and answered by a sealed `srp` cell; the
  same spot reached by limp then raise is keyed `lrp`, misses, and its demand
  key differs from the `srp` cell key.
