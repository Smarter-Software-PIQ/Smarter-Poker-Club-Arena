# A heavy member's promo fee reader measures both routes (2026-11-22)

Incident `9408cfd4-997d-4d22-83dc-172d12ced857`, `fn_ca_post_commit_lag_watch`, critical,
table `6165c59d` (PLO5 1.00/2.00 Lightning Games).

## What happened

At 20:15:47 UTC hand 60560424 froze a 400.00 pending add-on for member `86e42f5e`.
Its post-commit envelope resolves the add-on, which settles the member's promo
play-through, which reads `fn_ca_promo_fee_events`. That read ran past the
caller's statement timeout on every retry. A table's envelopes complete in hand
order, so no later hand at the table could bank its rake, jackpot drop or
play-through while the first one kept failing.

## Cause, read from rows

`fn_ca_promo_fee_events` chooses between two ways to find a member's cash fees:
the member's own postings, or every hand clock in the interval probed for that
member. It measured the two for a member with 257 to 16,384 lifetime postings.
At 16,385 the line `WHEN n=16385 THEN true` chose the clock window unmeasured.

The interval starts at the account's first promo grant, so it only grows. For
this member it held 670,193 hand commits and 331,354 retained clocks: 1,001,547
probes to find 1,488 fees. 271 of the 558 accounts with an open grant were on
that route, 122 more were between 8,000 and 16,384 postings, and the read timed
out 1,003 times in the 24 hours before the incident.

## The change

`20261122203048_a_heavy_member_s_promo_fee_reader_measures_both_routes.sql`:

- The unmeasured line is gone. The two routes are compared at every size.
- The member's postings are counted and read from one day before the earliest
  instant the reader can use (the interval start or the enforcement start,
  whichever is earlier), not from the start of their history. A fee is posted
  after its hand is accepted: 70,590 of 70,590 postings measured over 36 hours
  had their clock at or before the posting, the closest by 0.24 s.

Same answer both ways for the incident member (1,488 fees, 922.65), measured on
production with a `pg_temp` copy: 123 ms, against a timeout before.

## Pinned

`tests/fixtures/promo-profit-fee-clocks/native.sql` now runs a member with
16,385 recent postings inside a 20,000-hand window and refuses one posting probe
per window hand. Against the previous reader it fails with 20,011 scans.

## What this does not change

The read still grows with a member's own postings since enforcement began
(2026-11-17), about 300 a day for this member. That is one member's rows instead
of the platform's, but it is not constant. A stored running fee total per
account is the change that makes it constant.
