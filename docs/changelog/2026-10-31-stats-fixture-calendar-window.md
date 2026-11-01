# Keep the recorded-opportunity fixture within its requested window

Required accounting shard 2 in run41255280512 failed after November1 UTC:
the expected WTsD/showdown totals included six fixed October2 history rows,
while the real reader correctly selected only its requested 30 UTC calendar days.
The local PostgreSQL17.11 fixture reproduced the same failure before this change.

The expectation now independently applies that calendar window. Historical
range fixtures, production queries, metric assertions and authorization checks
are preserved. This repairs the required qualification blocker; it provides no
production schema or connected tournament/RIT acceptance credit.
