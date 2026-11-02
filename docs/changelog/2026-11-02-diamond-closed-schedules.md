# Diamond closure also closes its schedules

The owner requested complete Diamond Arena shutdown, including future events.
The live closure and both arena switches were disabled, but 26 recurring
schedule rows remained active. The existing schedule write triggers did not
consult the arena closure record.

The migration disables active schedules belonging to closed Diamond arenas and
adds a transaction-level guard to reject new active schedules, reactivation and
moving an active schedule into the closed arena. Other clubs remain unchanged.
Inactive history and occurrence receipts remain available. This change does not
settle the 15 remaining started Diamond tournaments or claim their closure.

The existing required native Diamond closure qualification now executes this
migration and checks the three rejected write paths, inactive edits, other-club
preservation and function privileges on isolated PostgreSQL 17. The full local
closure fixture passed, including existing custody and funding protections.
Production installation and final tournament settlement remain separate proof.

## Superseded equal-share authority

The owner's later instruction replaces equal-share payouts with deletion of
140 exact started events, eligible remaining chips to Midway Union Main Bank and Diamonds to
KingFish after player-owned liabilities are separately resolved. The 49 empty
SNGs and 24 empty Spins outside Diamond are explicitly excluded; Diamond closure
still applies to all its games and schedules.
A private source-owned instruction records the exact identities and destinations;
the existing equal-share settlement transaction now refuses those identities
before any financial action. Already committed receipts remain readable.
The native routing regression executes the captured current function before and
after the exact migration, proving the refusal and unaffected outside identity.
It qualifies no fund transfer, deletion, physical drain or financial settlement.
Those remain unfinished and require their own connected implementation/proof.

The existing restart source authority also rejects inserting either the retired
identity itself or a new tournament cloned from that identity. The native fixture
executes the actual existing trigger path for both cases. This does not prevent
unrelated new games or the excluded waiting SNG/Spin board from starting.

The source manifest fixes November 2 midnight America/Chicago (06:00 UTC),
140 exact identities, original operation IDs and 73 explicit exclusions. The
seeded private intent relation rejects subsequent insert, update, delete and
truncate, including owner-role writes. Native tests compare every target ID to
the source manifest and exercise all four mutation refusals. Destination fields
apply only to eligible remainders; no amount or eligibility is certified here.
