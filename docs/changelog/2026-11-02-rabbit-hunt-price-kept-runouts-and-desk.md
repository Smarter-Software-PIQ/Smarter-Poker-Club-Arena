# Rabbit Hunt: Price Before The Tap, Kept Run Outs, Auto Run Allowance, Staff Desk (2026-11-02)

- Hand History shows what the next rabbit hunt will use before the tap (`fn_rabbit_hunt_charge_preview`, read only, engine charge order).
- A run out a player bought is kept for that player alone (`rabbit_hunt_owned_runouts`, filled by a trigger on `rabbit_hunt_reveals`, backfilled) and re-shows free after the one day saved window.
- Auto Run Rabbit Hunt explains its cost and shows the live remaining allowance.
- Platform staff get the Rabbit Hunt Desk to correct one reveal once through the audited correction core; diamond charges are refused there.
- Migration `20261102165142`, native PG17 contract `scripts/ci/test-rabbit-hunt-enhancements.sh`, unit tests for pricing, kept run outs, the desk and the Auto Run line.
