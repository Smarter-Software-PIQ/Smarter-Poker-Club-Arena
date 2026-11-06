# Break Card: Your VPIP Belongs To An Entrant

Dan reported the tournament break card's "Your VPIP (Last Hour)" row showing
"No Recorded Hands" at Afternoon Free Buy (NLH) Table 9 during the 23:55 UTC
break on November 5, 2026.

## What the rows say

- Tournament `74ba8130-3ec5-48c2-b94b-409b7fb14a6b`, Table 9 is
  `f18a8b40-63f3-4f83-8a9d-9ed79a1a78d0`. Its only human seat is Danimal.
- Danimal had 61 settled hands in `ca_hand_facts` for the hour before the
  screenshot, every one visible within 1.5 seconds of the hand ending. The
  card's exact query, run under RLS as Danimal, returned 63 hands and 8 VPIP
  hands at the time of the fix (12.7%). The read path is live and correct.
- The card that showed "No Recorded Hands" also had no "Your Status" row, which
  renders only for an entrant. The viewing account was not entered in the
  event (KingFish was the active desktop session; it has no tournament entry
  and no hands in it).

## Root cause

The VPIP row rendered for any signed-in viewer of a tournament table, while
"Your Status" beside it already required an entry. A rail watcher therefore saw
their own empty sample labelled as "Your VPIP", which reads as a broken stat.

## Fix

`TournamentBreakScreen` now records whether the viewer has an entrant row in the
event (any status, so a player mid table move keeps the row) from the same
standings read it already performs, and renders `TournamentHourVpip` only for an
entrant. Entrants keep the live, event-driven, rolling-hour number.

## Pins

`tests/unit/tournamentBreakStandings.test.tsx`: a watcher sees no VPIP row, an
entrant does, and a status change between tables keeps it. The fake standings
feed now fans an event out to every subscriber, matching the real feed (the
card and its VPIP row share it).
