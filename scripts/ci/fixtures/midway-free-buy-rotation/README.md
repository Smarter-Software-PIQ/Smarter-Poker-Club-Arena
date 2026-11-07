# Midway Free Buy rotation qualification

The runner `scripts/ci/test-midway-free-buy-rotation.py` starts a private
PostgreSQL 17 cluster and accepts no database URL. Cloned from the
`midway-free-buy-pko` fixture: the same synthetic column-shape schema (plus
the tables the rotation's paths read) and the same captured accounting and
tally triggers, so the deferred ledger/store invariant refuses any balance
move without its journal leg.

`preimages.json` holds production's definitions of every function the
migration replaces or reads, captured read-only on 2026-11-05 with their live
md5. The runner proves each reproduces that md5 here, so the migration's own
preimage guards run for real. It then installs the actual money-writer DDL
guard and executes the EXACT migration file over the opening state
(`opening.sql`, written under the November 2 trigger so every event starts as
PKO), and runs `cases.sql`:

- the reshape: Morning/Afternoon/Prime Time take regular/aiof/mystery; Midday,
  Midnight and an event with an entrant stay PKO;
- human and horse registration promo-fund 1 chip per format to the right pool;
- player-wallet rebuys and add-ons with zero fee and the right split (mystery
  add-on 0.50/0.50), with matching refund entitlements; aiof/PKO refuse add-ons;
- unplayed return credits the promo wallet once from the same components;
- tournament pools, maintained escrow and the escrow shadow agree after each;
- a registered event stays frozen; an unregistered PKO row follows the engine
  to aiof, regular and mystery;
- the schedule writer admits only the Midway Midnight Free Buy at 00:30;
- a second install is refused by the preimage guards.

`stubs.sql` replaces only identity, gate and bookkeeping helpers the rotation
does not change. Unregister and atomic cancellation call the unchanged promo
return owner and are covered by the PKO fixture. Synthetic identities only; no
production player data. Both psql and the pinned Node client (PGNODE) pass.

`scheduled-guarantee.sql` runs with the production schedule-slot classifier
and guard migration `20261106004812` installed. It exercises an actual
wrong-format insert and update against a 500-chip Afternoon slot, confirms
statement rollback, and checks that linking a started event preserves its terms.
