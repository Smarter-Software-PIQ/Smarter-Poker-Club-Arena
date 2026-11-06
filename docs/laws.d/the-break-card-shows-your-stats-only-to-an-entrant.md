# tests/the-break-card-shows-your-stats-only-to-an-entrant.law.test.ts

Dan, 2026-11-05: the tournament break card's personal rows ("Your Status", "Your VPIP (Last Hour)") belong to an entrant of that event only, so a viewer watching a table they are not entered at never sees an empty sample labelled as theirs; entrant status comes from the card's own standings read (any status, so a player between tables keeps it), and the VPIP row's read stays the live per-tournament, per-player, rolling-hour `ca_hand_facts` read.
