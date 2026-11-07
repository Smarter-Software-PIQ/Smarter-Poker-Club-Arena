# A busy satellite target releases the tournament finish lane

The original satellite admission acquired the platform finish mutex before waiting for its source and target hand keys. A target row held by another transaction could also block the subsequent award while the satellite held that mutex. In the private PostgreSQL reproduction, the target writer blocked the satellite payer and the satellite payer blocked a Spin finish in another backend.

Migration 20261107190137 retains the mutex, both ordered tournament keys and the target-before-source row order. A busy tournament key or row raises SQLSTATE 55P03 at admission. PostgreSQL unwinds the attempt before an award is booked.

When both requests to prepare the original satellite intent return 55P03, the manager keeps the qualifier boundary and re-arms its existing settlement work. A lost prepare response retains the unknown outcome even if the second request encounters contention. Execution and recovery continue to use the durable original request and receipt.

The private PostgreSQL qualification checks the original blocking chain, unrelated tournament admission, serialization of two satellites into one target and successful admission after release. The funded cohort qualification holds a target row or advisory key and checks an independent payout, then the original payout and both closed escrows. The code changes concern source and target admission; PostgreSQL still serializes simultaneous financial writers that require the same bank or finish authority.

The single-winner settlement could also book a fully funded entry in a running target without putting its winner in a chair. It now calls the existing late-registration seat authority after Diamond funding, within the original transaction, and checks the stored entrant, table and active chair before committing. The native running-target case reproduces the original orphaned registration and requires the same funded chair after receipt replay for both winner paths.
