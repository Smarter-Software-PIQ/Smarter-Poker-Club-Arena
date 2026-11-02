# Midway promo-funded Free Buy qualification

The maintained runner `scripts/ci/test-midway-free-buy-pko.py` starts a private
PostgreSQL 17 cluster and accepts no database URL. It executes candidate funding
and conversion functions extracted from the migration, captured ledger actor,
store tally, escrow, and registered-contract guards. The schema contains only
column shapes; auth identity is synthetic. It verifies funding, duplicate
funding, returns, duplicate returns, insufficient funds, rollback, private helper
ACLs, and conversion/rollback of 412 registrations with deferred accounting
validation. These are synthetic entries, not production player data.

The existing registration-funding runner with `--midway-free-buy-pko` composes
the actual request receipt and admission functions with promo funding. It tests
request replay, observed lock overlap, human and horse funding, rollback, and
independent escrow reconstruction. Its inherited fixture limits still apply:
HTTP, real identity sessions, membership notifications and gameplay are outside
this isolated database fixture. Knockout and champion payment require the
existing bounty qualification plus deployed behavior verification.

The focused runner also invokes `test-midway-free-buy-full.py`, which installs
all candidate migration bytes over the retained financial catalog and November 2
function preimages, converts 412 synthetic registrations, and exercises actual
cancellation, immutable receipt replay and rollback. Schema-only schedule fields
and captured union-store seed fill gaps in the older financial fixture.

The existing required chip-journal transaction gate invokes registration funding
with `--with-heads-up-payout`; that mode runs the new entry cases and both promo
qualification runners without changing workflow routing or prior cases. Source snapshots were read on November 2, 2026; they carry no
credentials or production player data. Production installation still requires
protected merge and the existing Apply Merged Migration workflow.

The required chip-journal gate uses its pinned Node PostgreSQL client when `PGNODE` is supplied; native workstations use `psql`. Both connect only to the newly created private cluster. Fixture opening state commits explicitly before the rollback probes, preserving the same transaction boundaries under either client.
