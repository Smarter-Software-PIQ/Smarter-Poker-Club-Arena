# tests/stall-watch-honors-bounded-synchronized-break-resume.law.test.ts

`fn_ca_table_stall_decide` returns `'tournament_break_resuming'` when `/metrics` reports `paused="1"` within 8 minutes of `break_started_at` for a table that was progressing up to the `:55` synchronized tournament break, closing the `clearPersistedBreak()`-vs-`/metrics`-scrape race that caused 20 of the last 20 `TableStoppedDealing` alerts (including `82f7e3ed`, `6139298e`, `641a108f` on Friday Night Feature) without excusing unpaused stalls, stuck pauses past 8 minutes, or pre-break stalls.
