# A satellite qualifier receipt stays with the current manager

A manager could lose its lease during a state read or a funded qualifier settlement, then announce the result and request table cleanup after its successor took charge. Both state reads and the settlement acknowledgement now recheck ownership before the manager uses a receipt. The successor can read the stored result or adopt the prepared request.

The manager regression delivers the same old zero-stack hand callback twice across the handoff and checks that the held dealer never receives a release. The PostgreSQL qualification expires the first protocol-2 lease at a funded bubble, rejects the old manager's payout attempt and checks that the successor adopts the original request. The two exact qualifiers receive funded entries, the recorded bubble receives the remainder and receipt replay preserves every financial row.
