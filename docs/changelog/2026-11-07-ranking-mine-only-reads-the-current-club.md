# Ranking "Mine Only" appears at once and shows only the current club's downline

Dan, 2026-11-06: "WHEN YOU GO TO 'RANKINGS' INSIDE A TOURNAMENT LOBBY, THE
'MINE ONLY' TAKES TOO LONG TO APPEAR. IT SHOULD SHOW SUPER AGENTS, AGENTS, OR
SUB AGENTS DOWNLINES HERE. AND KINGFISH SHOULD ONLY BE SHOWN THE DOWNLINES
INSIDE OF THE CLUB HES CURRENTLY INSIDE OF, (SAME WITH AGENTS AND EVERYTHING
ELSE) IT SHOULD ONLY SHOW THE CURRENT CLUBS DOWNLINES THAT ARE STILL INSIDE THE
CLUB."

## Root cause (measured on production, 2026-11-07)

`useDownlineIds` resolved the tournament's whole union scope, then for every
club in it where the viewer was staff called `ca_club_members_overview` (the
full roster reader: wallets, fees, hands, downline counts for every member),
sequentially, 500 rows per page with the whole function re-run per page, and
kept only `user_id`. For KingFish on a Midway Union event:

| club               | roster reader       |
| ------------------ | ------------------- |
| KINGS CLUB         | 670 ms              |
| The Felt Society   | 6,936 ms (x2 pages) |
| Deep Stack Society | 6,742 ms            |
| Midway Union       | 2,268 ms            |

About 16.6-23.5 s before the button could appear. The same union walk unioned
every club's players, so an owner of several clubs saw all of them as "his".

## Fix

- New reader `ca_tournament_my_downline_ids(p_tournament_id, p_club_id)`
  (migration `20261107032055`): one club - the one the viewer is inside, which
  must be in the tournament's scope - and only members still in it
  (`membership_lifecycle_status = 'active'`, never deleted profiles, never the
  viewer). Owner / co-owner / admin get every member of that club; super agent
  / agent / sub agent get their recursive agent subtree there (same tree as
  Club Data); plain players get nothing. Returns ids only. 2-8 ms on
  production; agent results identical to `ca_club_member_downline` for the
  four largest agent trees.
- `useDownlineIds(userId, tournamentId, viewerClubId)` makes that single call.
- `RankingTab` passes the club lobby's `:clubId`, else
  `useUserStore.currentClubId` (the club the viewer entered through).
- Tests: `tests/unit/tournamentDownlineIds.test.tsx` and
  `tests/unit/tournamentDownlineScopeDeadline.test.tsx` rewritten to pin the
  single scoped call; the old union-wide pins were the behaviour Dan replaced.
