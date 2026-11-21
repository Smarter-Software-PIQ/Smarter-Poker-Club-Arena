# A Person Beating The PLO Horses Beyond 2 SE Reaches Production Alerts Within The Hour (2026-11-20)

Migration `20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts.sql`. PLO-OWNER repair programme, lane EXPOSURE.

## Why

Skilled aggressive persons beat the PLO4/PLO5 cash Horses for weeks and nothing in production said so. The numbers were in `ca_hand_facts` the whole time; the loss was found by hand, days late.

## What It Adds (read-only)

- `smarter_private.fn_ca_horse_exposure_hands(p_at, p_per)`: each person's PLO4/PLO5 cash hands with a Horse dealt in the 60 days to `p_at` (bomb pots and tournaments out), newest first, with the chips the person took from or paid to the Horses in each hand. The split is rake-free and pro-rata: a loser's loss goes to the winners in proportion to their wins. The EV-adjusted figure applies the same split to `ev_net_bb`. Hands are found through `idx_hand_history_human_created`; `lightning_hand` is read by its unique `hand_number` index.
- `public.fn_ca_horse_exposure_watch(p_at, p_dry_run)`, pg_cron `ca-horse-exposure-watch-hourly` at :17: for every person and game, bb/100 with its standard error, real and EV-adjusted, over the newest 500, 1,000 and 2,500 hands (each when full) and over every hand of the 60 days (from 500). When an EV-adjusted rate is above +2 SE it raises one warning `PersonBeatsHorsesBeyondTwoSE` (source `horse-exposure-watch`, key `exposure:<game>:<person>`) for the Production Alerts fleet, with the leak breakdown: per Horse in the person's hands, how that Horse's part ended (hand over preflop, all-in, Horse folded preflop / flop / turn / river, called to a showdown, won without one) in real and EV chips, and the table / Lightning split. A repeat while it fires bumps the receipt; a run with no window above +2 SE resolves it; the next episode gets a new key. Runs are kept in `smarter_private.ca_horse_exposure_runs`.
- Its own reliability-controller class (`smarter_private.reliability_alert_classes`, priority 305, `horse_exposure_analysis`, never an incident, never escalated). Without it the controller would file the warning as an `unclassified` incident that escalates; today `notify_mode = critical_only` suppresses a warning's Messenger message, and the class keeps it that way whatever the mode becomes.
- It is an analysis trigger only. It writes only its run table and the alert inbox, reads no Horse option, setting or seat, and keys nothing in play on the person it reports. Severity `warning` from a source `fn_ca_owner_page_kind` does not map: it never pages the owner's phone.

## Measured On Production History (Read-Only)

Oct 16 - Nov 20 2026, 25,216 PLO4/PLO5 cash hands with a person, replayed hourly with a Python replica of the same arithmetic. The replica and this SQL were checked against each other on the same hands loaded into PostgreSQL 17, at four instants, with the same persons, windows and breakdown.

- It fires for one person-game only (the PLO5 person who later won +8,842 bb against the Horses): first on Oct 24 at 9:17 PM Chicago through the 60-day window (970 hands, EV-adjusted +279 ± 137 bb/100), when he was +1,239 bb. With the three rolling windows alone it would first have fired on Nov 16 at 6:17 PM.
- A person whose real win came from all-in run-outs (+2,622 bb real, -94 bb EV-adjusted) never fires.
- No other person with 500 or more hands fires.

## Writes And Cost

Three writes, all its own: one `smarter_private.ca_horse_exposure_runs` row per run; alert records through `fn_record_operational_alert` (insert, or a receipt bump on a repeat); `status = 'resolved'` on its own firing alerts when no window is above +2 SE. Measured on production (EXPLAIN ANALYZE of the window query, read-only, Nov 20): 21.6 s with a cold cache (127,711 pages read from disk, 104,790 in memory; hand_history 8.4 s, ca_hand_facts 12.8 s) and 0.5 s warm. One connection, once an hour.

## Install

Installs on merge through Apply Merged Migration (one transaction, no hot-table lock, no foreign key). The first run is the next :17 after install. Merge it after an engine cutover seals, or before the Backup export of the next release, never between certification and cutover.

## Proof

`scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py` (PostgreSQL 17, 12 cases) builds the alert inbox and the owner page route as production has them, then proves the split against an independent model hand by hand, the windows, the breakdown, one warning that pages nobody, the repeat, the resolution, the next episode, and the dry run. Law: `tests/a-person-beating-the-horses-reaches-production-alerts.law.test.ts`.
