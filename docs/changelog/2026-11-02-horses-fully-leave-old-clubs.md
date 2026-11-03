# Horses Fully Leave Their Old Clubs

Date: 2026-11-02

## Owner Order

Dan, 2026-11-02 15:46 CT: "MAKE SURE ANY AND ALL HORSES ARE FULLY REMOVED, THAT ALL OF THEIR PLAYER STATS ARE REMOVED AND TRANSFERED TO THERE NEW CLUB".

## What Changed

- **Unregistered entries.** 105 horse entries funded by a club the horse left, in events not yet started, were unregistered through `fn_ca_unregister_tournament_player_exact`. That function refunds and reverses fees to the paying club. The split then departed every membership left with nothing open.
- **Immediate departure.** Migration `20261102215504_horses_fully_leave_old_clubs_and_take_their_stats.sql` makes the split's settling stage depart the remaining old memberships at once, with records retained. It no longer waits for running events.
  - A prize or bounty from an event already in progress is credited to the retained record. The payout path already allows this for a departed member.
  - `fn_ca_horse_club_split_late_claims` returns that credit to the old club's bank once every event on the record has finished. It makes one claim per record, through the same Club Bank leg.
- **Statistics.** The attribution views now move every canonical horse's history out of every split club it does not belong to (Kings Club, Deep Stack Society, The Felt Society) into its assigned club. Period leaderboards read the union's raw rows and attribute by home club, which for a horse is now its assigned club.

## What Did Not Change

- No rollup, fact or ledger row is rewritten.
- Rake, fees, rakeback bases and union P&L read the original rows.
