# The Charles Rule resume is a law, and the Diamond race fixture uses one day (2026-11-14)

## The law

`tests/the-charles-rule-countdown-resumes.law.test.ts` pins the owner's
2026-11-13 ruling behind #10788 so a later image of `fn_cash_session_evaluate`
cannot bring back the restart at ten.

Verified on production after #10788 installed (06:26 UTC): two Classic sessions
paused with 3 of 10 played and came back at 3 played; 28 paused sessions were
dealt further hands with the count unchanged; 15 sessions left while paused; a
Lightning pool session paused at 6 of 10 with its reference kept. A rebuy while
paused moved that session's baseline from 100 to 200 and left the count at 6:
existing behaviour, recorded here and not changed.

## The fixture

`Accounting transactions shard 1/7` failed on #10788 at 06:00:01 UTC, the first
second of the Chicago day. The Diamond Spins custody race seeded, settled and
asserted "yesterday in Chicago" from four separate clocks, so a run crossing
midnight seeded one day and asserted another. `scripts/dev/test-accounting-delivery.sh`
now reads the day once and passes it to the seed, both racers and the assert.
