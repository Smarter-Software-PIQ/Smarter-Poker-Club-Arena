# Deterministic terminal-owner proof fixture clock

Client publication refused the terminal-owner regression after its fixed
November 2 negative window expired at 14:05 UTC. The test used the real wall
clock, so its deliberately unsettled ten-hour case became settled even though
the production predicate was correct. The same source passed at 13:31 UTC.

Pin only the owning fixture clock at November 2, 12:30 UTC: after its captured
recovery records and before that negative window. Preserve every proof/refusal
assertion, the production sixty-second settling guard and all native ownership
and cleanup requirements. The fixture restores the clock through unittest
cleanup.
