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
A function named in a view or a policy runs with the reader's privileges, and
anon may not execute `fn_is_platform_admin`: the view therefore tests staff by
reading `profiles`, and anon has its own policy that names no such function.
This law holds both, and holds the policies to RESTRICTIVE, read-only and the
daily window.
Both views read with their owner's rights and say so (`security_invoker =
false`): the platform makes a new public view caller-rights by default, and a
caller-rights view cannot mask, because its reader may not read the columns
that say who is closed and the table's own policy would hide the row the view
exists to label. This law refuses a later migration that turns either back.
Ordinary readers may select the label view, because the read policy asks it as
them, so since 2026-11-10 it lists a closed person only where a tournament
result names them: before that, anon could list 2,664 closed profile ids over
the REST API. This law holds the restriction on every later definition.
