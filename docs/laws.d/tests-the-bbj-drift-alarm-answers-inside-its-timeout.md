# tests/the-bbj-drift-alarm-answers-inside-its-timeout.law.test.ts

`bbj_drift_since` is the hourly alarm that compares every chip `rake_records`
books as a BBJ contribution with what reached `bbj_contributions`. It runs as
the service role, whose statements stop at 8 s. On 2026-11-26 a cold call took
18 s on production: the bank was probed once per hand by a random uuid, about
26,000 reads from disk, so the alarm was cancelled whenever the bank was not
cached. Migration 20261126222226 adds the covering partial index
`idx_bbj_contrib_window_cover` and reads the bank as one range starting a day
before the window, grouped by hand. A hand the range holds nothing for is
looked up by hand id with no time window, so received is still joined by hand
(Dan, 2026-08-30) and a back-dated heal never reads as missing money.

The law pins the signature and invoker shape, that `rake_records` is read once,
that the booked side, the 6 minute settle grace and the unlinkable count keep
their meaning, that the bank range is fenced and starts at least a day early,
that the by-hand fallback stays, that both covering indexes stay declared, and
that the install proof never calls the function or reads the ledgers.
20261126203947 did both and was refused on install (transaction timeout) and
reverted by #12154; a refused migration blocks every engine certification.
