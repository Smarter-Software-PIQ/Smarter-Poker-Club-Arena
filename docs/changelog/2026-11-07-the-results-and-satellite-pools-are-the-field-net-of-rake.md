# The results and satellite pools are the field, net of rake

**Date:** 2026-11-07
**Branch:** fix/prize-surfaces-net-of-rake

## The rule (owner, 2026-11-05 and 2026-11-06)

`tournaments.prize_pool` is the places pool net of bounty and rake;
`bounty_pool` and `total_rake` are separate columns. The TOTAL PRIZE POOL a
player sees is `prize_pool + bounty_pool`, never the guarantee and never a
pending overlay stacked on top (a finalized pool already holds the funded
overlay). The overlay is `max(0, guaranteed_prize - (prize_pool + bounty_pool +
total_rake))` and is shown on its own beside the guarantee. The helpers are
`displayTotalPool` and `guaranteeShortfall` in
`src/utils/tournamentPrizeFunding.ts` (#9786).

An audit found six surfaces still off that rule. All six are fixed here.

## What changed

1. **Satellite cards** (`src/components/tournament/details/useSatellites.ts`).
   The mapper printed the GUARANTEE as the pool
   (`prizePool: guaranteed_prize || prize_pool`) and never selected
   `bounty_pool` or `total_rake`, so a 2.5K GTD satellite that had collected
   1,656 read "2,500" and could never show its 660 overlay. The select now
   carries `bounty_pool` and `total_rake`; the card receives `prizePool`
   (places), `bountyPool`, `totalRake` and `guaranteedPrize` and prints the
   total pool, the GTD tag and the overlay through its existing path.
2. **Winner-results ticker** (`TournamentStartingTicker.tsx`). The results
   line printed `prize_pool` alone, the places pool only on a bounty event.
   It now selects `bounty_pool` and announces `displayTotalPool(prize_pool,
   null, bounty_pool)`.
3. **Results archive** (`src/pages/tournament/TournamentResultsPage.tsx`).
   All three selects now include `bounty_pool` and the list prints the total
   pool.
4. **XMTT lobby read** (`src/services/xmttLobbyReads.ts`). The row type
   declared `guaranteed_prize`, `bounty_pool`, `total_rake` and
   `prize_pool_finalized` but the select never fetched them; it does now.
5. **PayoutEngine.getOverlayStatus / OverlayStatus** deleted. It priced the
   overlay as `guarantee - players * buyIn` (the wrong rule) and had no
   callers in `src`. The barrel export in `src/services/index.ts` is removed
   with it.
6. Stale "the guarantee is a floor" comments in `DetailOverviewTab.tsx` and
   `TournamentBreakScreen.tsx` rewritten; the overlayAnnouncements test that
   said entries are counted "against the PRIZE side" now says the whole
   payment is counted, which is what the code does.

## Tests

- `tests/unit/prizePoolOverlayParity.test.tsx`: a guaranteed satellite row
  (1,196 / 460 / 184 against 2,500) maps to a 1,656 total pool and a 660
  overlay and the rendered card never shows 2.5K as the pool.
- `tests/unit/tournamentDetailTabFixes.test.ts`: the mapper keeps the
  guarantee on `guaranteedPrize`, not `prizePool`.
- `tests/unit/tickerMessages.test.ts`: a bounty event's results line reads
  "1,656 Prize Pool", and the ticker source hands the total to the item.
- `tests/components/tournamentArchiveReadIdentity.test.tsx`: the results list
  selects `bounty_pool` and prints "1,656 Prize Pool", not "1,196".
- `tests/xmttLobbyReads.test.ts`: the XMTT select carries every declared
  prize-funding column.
- `tests/unit/PayoutEngine.test.ts`: `getOverlayStatus` stays gone;
  `tests/unit/theClientHasOneTournamentMoneyRule.test.ts` no longer lists it.

No new `*.law.test.*` file, so no `docs/laws.d/` entry.
