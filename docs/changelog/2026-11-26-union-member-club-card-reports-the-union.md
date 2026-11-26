# A Union Member Club's Card Reports The Union (2026-11-26)

Dan, 13:03 Chicago, with a screenshot of the Kings Club card reading ACTIVE 148:
"THE KINGS CLUB 'ACTIVE' NUMBER SHOULD DISPLAY HOW MANY PLAYERS ARE ACTIVE INSIDE
THE MIDWAY UNION, NOT JUST INSIDE THE CLUB. ONCE A CLUB 'JOINS THE UNION' THERE
CLUB DATA SHOULD REPORT WHATS 'LIVE IN THE UNION' AT THAT MOMENT. IT SHOULD NO
LONGER DISPLAY THERE CLUB DATA BY DEFAULT. THEY CAN CHANGE IT IN THE CLUB SETTINGS
IF THEY WANT TO DISPLAY THERE REAL TIME CLUB DATA, OVER UNION DATA."

## Cause

A union member club has no floor of its own, but its card's ACTIVE total counted
only its own members seated on the union floor. Kings Club read 3 measured plus the
145 display addition; the Midway Union floor carried 601 live players at the time.

## Fix

- One rule, in two mirrored places: `src/lib/clubCardActiveSource.ts` and
  `public.fn_club_card_active_source`. In a union means `union` unless
  `clubs.settings.card_active_source` is `club`. No column was added, so `clubs`
  took no exclusive lock.
- `fn_set_club_card_active_source(club, source)`: the settings door, for the same
  managers who may set the club message; `jsonb_set` touches only that key.
- `fn_kings_club_display_totals()`: in union mode `active_total` is the union floor
  (`fn_batch_union_floor_players`, distinct live seats) with `active_addition` 0; a
  live union measurement carries no addition. Club mode is unchanged. This also
  fixes the Join Club preview, which reads the same RPC.
- Home carousel: a member club in union mode prints the union floor as ACTIVE, the
  union's cash/events split under it, and "LIVE ACROSS THE MIDWAY UNION". A club
  that chose club data prints its own total and its own split. The card's figure
  cache moved to a new scope so a club-only number is never shown as the union's.
- Club Settings: a "Club Card Activity" section for union member clubs with the
  switch "Show Club Data Instead Of Union Data" (off by default), saved instantly.

Law: `tests/a-union-member-club-card-reports-the-union.law.test.tsx`.
