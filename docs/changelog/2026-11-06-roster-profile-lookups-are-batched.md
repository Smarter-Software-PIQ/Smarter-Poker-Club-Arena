# Roster profile lookups are batched (2026-11-06)

## What broke

The Agent Dashboard (`src/pages/AgentDashboardPage.tsx`) read every member of the
club and then asked for all of their profiles in ONE request:
`profiles?select=id,...,avatar_url:arena_avatar_url&id=in.(817 ids)`. PostgREST
filters travel in the URL, and past ~25KB the database gateway answers a plain
`400 Bad Request` (measured: 25.0KB answered 200, 26.5KB answered 400). For
KINGS CLUB (817 members) the URL was 32KB. Supabase edge logs show it failing at
14:26, 15:51, 17:16, 18:15 (twice) and 19:34 UTC on 2026-11-06; every player on
the page rendered without a name or avatar. The `player_stats` last-played read
on the same page sent the same list.

Same failure class as World Hub #2684 (Messenger read receipts for a
673-thread inbox).

## The fix

- `src/lib/inBatches.ts`: `idBatches` (100 unique ids per batch, ~3.7KB of URL)
  and `selectInBatches`, which runs one query per batch and returns the same
  `{ data, error }` shape a single query does, stopping at the first error.
- Moved onto it: AgentDashboardPage (profiles and player_stats),
  LeaderboardService (both profile decorations), UnionDashboardPage (union
  agents), AgentService (getAgents and agent players), AgentCommissionDashboard
  (sub-agents), HandHistoryService.fetchProfileMap, PlayerNotesPanel and
  MembershipService (promotion picker).
- The reads that used to discard their error now bind and report it. The
  discarded-error ratchet counts `await selectInBatches` the same as
  `await supabase`, so the wrapper cannot hide a discarded error, and six
  baseline entries went down for real.

## What pins it

`tests/unit/rosterLookupsAreBatched.test.ts`: batch boundaries (0, 1, 100, 101,
817), an 817-member roster read in nine requests of at most 100, first-error
stop, no request for an empty list, and a source pin on every call site above.
