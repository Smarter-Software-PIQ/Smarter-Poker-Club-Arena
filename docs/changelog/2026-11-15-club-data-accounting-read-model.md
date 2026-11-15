# 2026-11-15 - Club Data's accounting read model

Migrations `20261115020010_club_data_accounting_read_model.sql` (installed at
merge) and `20261115020011_club_data_accounting_read_model_goes_live.sql`
(installed at merge too, owner instruction 2026-11-14 21:55 Chicago "IT CAN GO
LIVE AS SOON AS YOU PUSH IT": attaches the live projection in one transaction
that first takes all eight table locks at once with LOCK TABLE ... NOWAIT, so
no writer waits on a lock request of this migration; the eight locks are held
only for the trigger creation and commit. A busy table refuses the file at once
and it is dispatched once more, never in a loop).

Club Data must match the union weekly invoices 1:1 on the same 02:00
America/Chicago boundaries. The invoice reads accounting records Club Data
never read, and reading them at query time is too slow (one club's cash fees
for one week: 66 s). This read model carries those records per club, 02:00
accounting day, game and player, for every union game:

- fee: the accounting rake credit (cash by `earned_at`, the funding
  admission's club when one exists; tournament by recognition);
- cash result and hands: each hand's stack change by the participant's
  earning club (touches with their treasury gift and post-hand escrow
  readings, and link resolutions with the lightning funding owner), plus BBJ
  stack awards from the invoice's own reader; a player's hands are the cash
  hands they took part in, and the club hand count (per table) is the RAKED
  hands (accepted rake above zero) the club took part in, the one definition
  Club Data used before (20261022103651) on both the club and union screens;
- tournament result: funding and returns owned by their receipts, as the
  invoice classifies them, plus the entries still deferred at each week
  boundary, in the version of the kept boundary certificate the week's
  invoice used (`fn_ca_union_pnl_boundary_for_invoice`, #10899). A side with
  no such version is not invoice-exact and loads nothing.

Measured read-only for week 2026-11-02 to 2026-11-09: receipts plus the
2026-11-02 and 2026-11-09 holdings reproduce every invoice tournament result
to the cent (Deep Stack -195,554.11, The Felt Society -101,626.77, KINGS CLUB
-18,011.94).

No money write ever waits on the projection: its rows are written under a
never-waiting one-key advisory try-lock, or appended to an insert-only
journal; every trigger function runs with `lock_timeout = 50ms`; a projection
that raises is recorded in `ca_club_acct_projection_failures`, the money write
commits, and the screens report that day incomplete (P0; the day reload that
makes it whole is listed in `docs/BAND-AIDS-REGISTER.md` as debt). History is
loaded day by day by `club-data-accounting-seed.yml` (dispatched by a person)
as the whole day minus what the live projection already holds, in one
snapshot, so nothing is counted twice.

Proof: `scripts/ci/test-club-data-accounting-read-model.py` (native
PostgreSQL, two sessions): every figure per club and day to the cent, a load
before and after live rows, a later escrow certificate and funding admission,
a failed projection recorded and resolved by a reload, the invoice-version
rule, a live write beside another open projection of the same rows (no wait,
journaled), a day load beside a live commit (each hand once), the 32-lock
budget.

The Club Data screens switch to this model in a follow-up change once its
history is loaded and checked against the five invoices.
