# Club Data history load reads each source row once (2026-11-15)

Audit findings D2 and D3 on 20261115063000, fixed by migration
`20261115075440_club_data_history_load_reads_each_row_once`.

- D2: a slice counted a row when its inserting xid was "visible" in the day's
  snapshot. A row written inside a subtransaction whose parent was still open
  at the snapshot carries an xid the snapshot's in-progress list does not name,
  so the load and the live projection could both count it. The widening of a
  32-bit xmin also folded a row inserted after the snapshot into an ancient xid.
  Slices now read only rows whose xmin precedes the snapshot's xmin (signed
  distance widening); begin reads the newer rows inside the snapshot itself
  (MVCC), and reads the day's Bad Beat Jackpot awards and resolves its
  projection failures there.
- D3: `ca_club_acct_seed_parts` records begin and every slice with the
  snapshot; a slice sent twice or without its begin is refused, and finish logs
  the day only when the slices cover it exactly. begin refuses a day after the
  live projection's day.
- Days loaded before the fix (2026-09-19 to 2026-10-26 at the time) are
  unaffected: production holds no src 0 or journal row and no projection
  failure for any day before 2026-11-14, so no source row of those days was in
  progress at any load's snapshot.
- Native qualification: `scripts/ci/test-club-data-accounting-read-model.py`
  (subtransaction case, slice twice, partial cover, missing begin, day after
  the live day).
