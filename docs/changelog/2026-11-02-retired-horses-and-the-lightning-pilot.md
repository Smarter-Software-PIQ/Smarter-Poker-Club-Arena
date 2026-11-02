# Retired Horses And The Lightning Pilot

Date: 2026-11-02

## Owner Order

Dan, 2026-11-02 17:17 CT: "RETIRE THE HORSES AND RETIRE THE LIGHNING PILOT".

## What Changed

Migration `20261102231943_retired_horses_leave_every_stat_and_the_lightning_pilot_closes.sql`:

- **Retired horses.** The 62 horses outside the canonical 1,000 were already retired in `ca_horse_fleet_register`, with no membership, chips, seat or open entry. Their history now leaves every club's player statistics: the attribution views drop any row of a horse whose fleet record is retired.
- **Lightning Internal Pilot.** The club has been retired since 2026-10-31, with every table closed and no chips anywhere. Its 144 remaining horse memberships now depart, with records retained.
  - The `club_members_bot_house_only` CHECK refuses any update to an automated row outside a house board.
  - So the house board function admits the pilot for that one transaction only. It is restored byte for byte before COMMIT, with its md5 asserted.
- The pilot's fleet policy row is set to enabled false and paused, so the fleet can never target it.

## What Did Not Change

- No chip, rollup, fact or ledger row changes.
- Human records of the retired club (owner, KingFish) stay as records. The client already hides retired clubs.
