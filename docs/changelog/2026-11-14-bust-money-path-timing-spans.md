# Timing spans in the PKO bust money path (2026-11-14, incident #3)

After #10833 only the knockout door and the bounty payer are serial per PKO
bust, and they set the ceiling. On Midnight Free Buy b6d94533 (01:00-03:00
CST) the door's server-side origin time was p10 685-862 ms / p50 802-940 ms
and the payer's p50 859-966 ms, against ~150 ms and ~200 ms in every other
hour; ordinary reads moved only 96 -> 118 ms. Read-only evidence ruled out the
gateway, the finishers-at-commit ranking query (17 ms warm), f06_source_guard
and slow statements, and left the tournament settlement lane (shared by every
table's hand steps, exclusive for the door and payer) as the leading but
unproven explanation: waits under the 1 s log threshold are invisible, and the
slowest hour had few, fast hand steps.

Migration `20261114190106_bust_money_path_timing_spans.sql` re-creates the
door and payer from their exact bodies with marked `clock_timestamp()` spans
(lane, tournament_row, checks/pre_core, core, end) into
`smarter_private.ca_bust_money_spans`, through a helper that swallows every
error and writes only for 48 hours from installation and below a row cap. No
result, error path or lock order changes:

- `tests/a-bust-money-span-changes-nothing.law.test.ts`: stripped bodies equal
  the production bodies byte for byte; no span precedes a FOUND/ROW_COUNT read
  (mutation-tested); helper bounded, no foreign key, no public grant.
- `scripts/ci/test-bust-money-spans-native.sh`: PG17 scratch cluster applies
  the migration as written, both functions compile, the helper honours window
  and cap, never raises (even with its log dropped).

Delivery: merged only after the release custodian's schema hold lifts and no
Backup certification it would invalidate is in flight, before the 03:30 CST
cutoff; otherwise held for the next post-seal window. Read the spans after the
next busy PKO (Midnight Free Buy, ~00:00 CST):

    SELECT fn, mark, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)
      FROM smarter_private.ca_bust_money_spans
     WHERE tournament_id = '<event>' GROUP BY 1, 2 ORDER BY 1, 2;
