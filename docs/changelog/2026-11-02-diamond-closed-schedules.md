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
