# tests/a-browser-cannot-write-a-club-member-row.law.test.ts

A `club_members` row carries a member's club chips, held and locked chips, role
and agent. On 2026-11-26 signed-in players still held INSERT and UPDATE on the
table, with the "Users can join clubs" and `club_members_update` policies behind
them. The balance triggers already refused a browser balance write, but every
other column was one policy mistake away from a player editing their own row.
No browser write was in use: joining, leaving and role changes all run through
SECURITY DEFINER functions, and the one dead direct write in
`ClubsService.leaveClub` was removed. Migration 20261126191556 revokes INSERT
and UPDATE from PUBLIC, anon and authenticated and asserts it, keeping the
service role's writes and the column SELECT grants. Migration 20261126191910,
in the daily maintenance window, adds validated floors so held and locked chips
never go below zero and drops the two browser write policies. The law pins both
migrations, that no later migration grants a browser role a write on
`club_members`, and that no `src` file writes `club_members` directly.
