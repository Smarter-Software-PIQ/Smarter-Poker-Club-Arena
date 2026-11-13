# Player Management shows today's net beside the chosen window, no rakeback percentage

**Date:** 2026-11-12
**Owner ask:** Dan, 2026-11-12, with a screenshot of the Simple roster: "I don't
want to just see weekly. I want to see 'today's' +/- total. You can remove the
rakeback % from this summary."

## What changed

- Every roster row now carries a second net under the fee label: **Today**
  (or **Week** when Today is the chosen Win / Loss window), in the same green
  and red inks as the main figure, with "..." while it loads and "Unavailable"
  after a failed read. In Advanced mode it is a labelled metric ("Today W/L")
  beside the chosen window's net.
- The "Rakeback N%" line is gone from the row summary in both modes. Rakeback
  still shows on the player record.
- Implementation: `ClubMembersPage` asks `useRosterWinLoss` a second time for
  the secondary window (same `ca_club_members_period_summary` RPC, batched per
  page, its own cache), and passes `secondaryWinLoss` /
  `secondaryWinLossUnavailable` / `secondaryWinLossLabel` to `MemberRow`.
  The Simple row keeps five financial lines, so it still fits the 116px
  virtual row.

## Tests

`tests/unit/playerManagementShowsFeesGenerated.test.tsx`: no rakeback
percentage in either mode; today's net printed and toned beside the chosen
window's net; loading and unavailable states.
