# The throughput policy reader accepts the serving protocol

Incident 3e1fcfde-ba43-40c8-84c5-6b749789edbf began after #11081 published the
monitoring collector independently of its engine change. The production journal
reported `python3: Argument list too long`: the full health response was passed
in argv. After that transport failure, the serving immutable release
`3529e86663daa427b380a8ab9bd09347270c670e` also lacked the new population
fingerprint, so a small health response would still have been rejected.

The collector streams health over descriptor 3. Its versioned reader recognizes
that exact predecessor by its full release SHA and uses a domain-separated
release cohort combined with the SQL fingerprint. This is a conservative cohort
for that immutable policy, including rollback; it never mixes SQL-only history,
new engine curves or an unknown release. A present but malformed fingerprint
continues to fail closed. New engines use their published population fingerprint.

The existing collector regression suite runs the real shell script against a
3 MiB health response and the pre-fingerprint production shape. Both cases failed
before the repair. Unknown release identities, missing schedule data and corrupt
new fingerprints remain unreadable; money and controller gauges remain available.
Delivery uses Deploy Monitoring, followed by loaded collector and Prometheus
readback. No engine replacement or alert threshold change is required.
