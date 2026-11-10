# tests/a-closed-persons-tournament-name-is-not-public.law.test.ts

`tournament_players.username` is the name a player held when they registered.
A finished or cancelled tournament's rows are immutable evidence, so closing
an account scrubbed the profile and left that name in a column every client
can read: on 2026-11-09 a closed person's former name was still printed by
results pages and returned by the REST API. Nothing stored is changed.
Ordinary readers go through `public.tournament_players_public`, which has the
table's columns and answers a closed person's `username` with the label the
scrubbed profile carries (`public.ca_closed_player_labels`: a profile whose
status is `deleted` and which is not a horse). Platform staff still read the
recorded name. A retired horse is a house character, not a person, and keeps
its name in past results. The four results functions that returned
`tp.username` read the same view. This law pins the label's one definition and
its index, the view's mask and grants, and the refusal to install with a
column missing. The base table itself hides a closed person's rows from
ordinary readers through a read policy installed in the daily maintenance
window.
