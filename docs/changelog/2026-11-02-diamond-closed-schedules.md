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
140 exact started events, chips to Midway Union Main Bank and Diamonds to
KingFish. All 73 empty waiting SNG/Spin games are explicitly excluded.
A private source-owned instruction records the exact identities and destinations;
the existing equal-share settlement transaction now refuses those identities
before any financial action. Already committed receipts remain readable.
The native routing regression executes the captured current function before and
after the exact migration, proving the refusal and unaffected outside identity.
It qualifies no fund transfer, deletion, physical drain or financial settlement.
Those remain unfinished and require their own connected implementation/proof.
