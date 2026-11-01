# tests/member-stats-chicago.law.test.ts

Member ledger and linked performance windows use America/Chicago calendar dates and DST-aware midnight boundaries, independent of the viewer device timezone. Native PostgreSQL regression executes the real reporting RPCs against UTC-bucket and timestamped fixtures.
