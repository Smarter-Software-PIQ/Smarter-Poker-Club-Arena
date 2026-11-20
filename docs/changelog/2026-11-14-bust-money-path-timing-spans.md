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
door (`fn_claim_tournament_bounty_elimination`: entry, lane, tournament_row,
checks, core, end) and the payer's entry point (`fn_collect_bounty_obligation`:
entry, pre_core, core, end) from their exact bodies with marked
`RAISE LOG 'ca_bust_money_span ...'` lines carrying the tournament, the call's
`clock_timestamp()` start and elapsed milliseconds. RAISE LOG writes nothing,
takes no subtransaction (review of 538e3d79: an EXCEPTION-guarded insert per
span cost 80 subxids per bounty sweep, over the 64-entry cache), leaves FOUND
and ROW_COUNT alone, never reaches the client (log level below
client_min_messages=notice) and still records calls that later abort, such as
a lane timeout. `fn_collect_bounty` itself is not re-created: its body carries
a frozen uuid version check that
`a-player-id-is-a-uuid-not-a-uuid-version.law.test.ts` forbids copying
forward, so the payer's internal lane wait is not split out. No result, error
path, lock order or grant changes:

- `tests/a-bust-money-span-changes-nothing.law.test.ts`: stripped bodies equal
  the production bodies byte for byte; every marked line is one RAISE LOG and
  nothing else; no span inside the lane lock block; grants restated as
  production holds them; the held removal restores both bodies.
- `scripts/ci/test-bust-money-spans-native.sh`: PG17 scratch cluster applies
  the migration as written, both functions compile, a span changes neither
  FOUND nor ROW_COUNT, reaches the server log and not the client, then the
  removal restores the production bodies and grants.

Removal: `docs/audits/2026-11-14-bust-money-spans/pending-adoption/20261114200138_restore_bust_money_path_bodies.sql`
restores both exact production bodies. It moves into `supabase/migrations/`
in the fix PR after the spans are read.

Delivery: merged only after the release custodian's schema hold lifts and no
Backup certification it would invalidate is in flight, before the 03:30 CST
cutoff; otherwise held for the next post-seal window. Read the spans after the
next busy PKO (Midnight Free Buy, ~00:00 CST) from the Postgres logs
(Supabase `query_logs`, service `postgres`):

    select timestamp, event_message from postgres_logs
     where event_message like '%ca_bust_money_span%<event id>%'
     order by timestamp;
