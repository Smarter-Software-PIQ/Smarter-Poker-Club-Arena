# The BBJ drift alarm answers inside its timeout

The hourly alarm that compares BBJ chips booked in rake_records with chips
banked in bbj_contributions took 18 s cold on production, past the service
role's 8 s statement timeout, so it was cancelled whenever the bank was not
cached. Nearly all of that was one random probe of bbj_contributions per hand.

Migration 20261126222226 adds the covering index idx_bbj_contrib_window_cover
and reads the bank as one index range from a day before the window, grouped by
hand. A hand the range misses is still looked up by hand id with no window, so
the answer is unchanged (checked against the previous body on a scratch
database with late and back-dated bank rows). The install proof no longer
calls the function, so it cannot be refused for time the way 20261126203947
was before #12154 reverted it.

Law: tests/the-bbj-drift-alarm-answers-inside-its-timeout.law.test.ts.
