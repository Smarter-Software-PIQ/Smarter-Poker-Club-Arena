# 2026-11-12 - the live V31 store refuses a cell without range provenance

FLOP-2 W2, authorized by Dan 2026-11-12 14:35 CST. Engine-side companion to
the database guard in draft PR #10625.

## What changed

R7 and R8 were solved on forced lines: full root ranges carried past earlier
decisions. Nothing in a cell's seal can reveal that, so a sealed cell was
servable on an unstated range assumption. The live loader now reads the
dataset's round registration (`gto_v31_round_registrations.cell_provenance`,
by `dataset_key`) once per load and the store keeps a validated cell only
when exactly one provenance entry names that cell and it declares:

- `range_construction` root, natural or subgame (never `forced`);
- the game assumptions: variant nlh, two players to the flop, the cell's pot
  type and depth, chips per big blind, an effective stack equal to depth x
  chips per big blind, a root pot, rake `[fraction 0..1, cap]` and a betting
  tree checksum equal to the cell's sealed `manifest_checksum`;
- a `runtime_mapping` whose key fields are this cell's key, an acting solver
  seat 0 or 1 and two distinct solver positions that put the cell's hero and
  opponent on those seats.

Anything else refuses the cell, fail closed: the column not installed, no
registration, a failed read, malformed JSON, a missing or duplicate entry,
`forced`, a missing assumption or a mapping for another key. Each refused cell
counts `v31_certified_skip_no_range_provenance` and the loader logs
`V31_RANGE_PROVENANCE_REFUSED` once per dataset. `replaceGtoPostflopV31Async`
with no provenance argument serves nothing.

The check runs at install time, before the atomic swap; a refused cell is
absent from the in-memory map. The decision path (`decideV31Certified`,
`gtoStreetAdviceV31`) is unchanged and makes no database call
(`server/src/services/GtoPostflopV31RangeProvenance.test.ts` pins that).
Offline evaluation and re-check stores are unchanged.

## Effect today

None on any live decision. Read-only on PokerIQ-Production 2026-11-12: 0
active V31 datasets, 0 serving bindings, 0 round registrations, and no
`cell_provenance` column. The live store is already empty
(`v31_certified_skip_empty_store`). Once #10625 is installed, a dataset must
come from a round registered with provenance to serve any cell.

The change alters the V31 execution fingerprint (the loader and the store are
in it), as any change to those files does; no binding exists to strand.
