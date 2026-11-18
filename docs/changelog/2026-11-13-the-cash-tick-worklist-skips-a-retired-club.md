# The Cash Tick Worklist Skips A Retired Club (2026-11-13)

Found during the live verification of the 1/2 cash relaunch on engine 53360840.

- 25,884 `controller_tick_error` rows in one hour, all
  `CLUB_RETIRED: gameplay and cashier records are read-only`, from 36 disabled
  must-move games of four retired "Crest Cert Template" clubs (retired
  2026-11-07). Their tables sit at lifecycle `live` / status `closed`, so the
  worklist admitted them, the tick tried to make the two fields agree, and the
  retired-club guard refused the write on every pass. 36 of the 84 games on
  the list, about 600,000 error rows a day, under the old engine and the new.
- Migration 20261113124849 leaves a retired club's games off
  `fn_cash_clusters_to_tick`. Same columns, order and admission rule for every
  other game; no record of a retired club is changed. Both tick passes read
  that list. Dry run on production: 84 -> 48 games, exactly the 36 retired
  ones dropped, all 48 enabled games kept.
- Law: server/src/cluster/TheTickNeverVisitsARetiredClub.law.test.ts.
- The /health `horseWorkSchedule` census now documents that `seatingRefused`
  counts (horse, table) candidate pairs per cycle and `target` is the
  planner's cap for the current minute of the daily curve.
