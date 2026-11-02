# Bounty guarantees include bounties

A 5,000 guarantee with 95 entries at 40 (26 places, 10 bounty, 4 rake) requires
4,050 place prizes, 950 bounties and 1,580 house overlay. Previously the funding
writers guaranteed 5,000 for places and added the bounty pool again.

The database start, finalization, excess-return and settlement guards now use
the same place floor: max(0, guarantee minus funded bounties). Existing escrow,
bank ownership, journal atomicity, idempotency and finalized-contract guards stay
in force. The owner separately directed an exact-event correction for 6b72abc3
before any place awards were paid. The maintained operation script locks and
asserts the original event, escrow, close receipt and bank; returns 950 excess
overlay through the journal and escrow rails; and changes place prizes to 4,050.
It preserves 950 bounties and 380 rake, refuses prepared or paid awards, and requires
the combined-guarantee source to be installed first. No trigger is disabled by
this change. The full live transaction passed a self-aborting rollback probe;
installation, committed correction and readback remain separate delivery steps.

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
