# tests/a-moved-seat-never-leaves-a-locked-promo-position.law.test.ts

The database refuses, at COMMIT, any transaction that seats a cash player at another table while a LOCKED promo position (open-grant principal, locked-gate winnings, unreleased integrity) stays keyed to the table they left, through a deferred constraint trigger on table_seats queued only when a live occupancy ends; a plain exit is never refused. Incidents bb04ee5f, e542fbd7 and 887c0008 (2026-11-21).
