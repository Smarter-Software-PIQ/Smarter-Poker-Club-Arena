# Bounty guarantees include bounties

A 5,000 guarantee with 95 entries at 40 (26 places, 10 bounty, 4 rake) requires
4,050 place prizes, 950 bounties and 1,580 house overlay. Previously the funding
writers guaranteed 5,000 for places and added the bounty pool again.

The database start, finalization, excess-return and settlement guards now use
the same place floor: max(0, guarantee minus funded bounties). Existing escrow,
bank ownership, journal atomicity, idempotency and finalized-contract guards stay
in force. Finalized event 6b72abc3 retains its committed 5,950 award; no player
award is reduced or recovered. Its actual retained house overlay is 2,530.

Rewards reads aggregate escrow funding instead of treating the overlaid pool as
entry contributions. Fixed-bounty entry descriptions derive from charged terms,
replacing the stale 21.5 + 10 + 3.5 blurb with 26 + 10 + 4. Shared prize displays
subtract bounties before applying the place guarantee.

Regression protection exercises the actual funding, return and escrow writers
in an isolated PostgreSQL17 fixture, including the old 5,950 reproduction,
corrected late-entry return, replay and journal-failure rollback. Component tests
cover totals, copy, legacy committed awards and unavailable funding. Required
accounting CI runs the native test; client post-publication verification reads
the reported live event using the existing disposable certification identity.
