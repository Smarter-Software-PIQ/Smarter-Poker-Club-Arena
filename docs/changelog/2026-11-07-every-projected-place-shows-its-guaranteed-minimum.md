# Every projected place shows its guaranteed minimum (2026-11-07)

## The defect

While registration is open on a guaranteed event, RewardsTab (since 2026-11-06)
prints each place twice: the projection on what the field has put into places,
and underneath it "Guaranteed N", the floor the house underwrites if the field
does not close the guarantee. Three other surfaces price the same place on the
places-only ladder and say nothing about the guarantee, so one event read two
ways at once:

- `GameLobbyPanel` Payouts tab, "Projected" column (the lobby drawer);
- `TournamentInfoPanel` Prizes tab (the table-side panel);
- `TournamentPage` Payouts ladder (the arena tournaments page).

Owner's worked example: 46 entries x (36 buy-in = 26 places + 10 bounty, 4
fee), 2,500 GTD. Places 1,196, bounties 460, rake 184. Guarantee credit counts
the whole payment, so the house share is max(0, 2,500 - (1,196 + 460 + 184))
= 660, and the guaranteed ladder pool is 1,196 + 660 = 1,856. Rewards showed
"Guaranteed 1,856" under a 100% first place; the other three showed 1,196.

The lobby panel also gated its Projected column on
`max(prize_pool, guaranteed_prize) > 0`, which opened the column on a guarantee
alone with nothing to price in it, and carried a comment saying the prize pool
"is floored by the guarantee". It is not: `tournaments.prize_pool` is the
places pool net of bounty and rake, and the house share enters it only when it
is funded at close.

## The fix

One read, one rule, four surfaces.

- `src/hooks/useTournamentPrizeFunding.ts` (new): RewardsTab's private fetch of
  `fn_ca_tournament_prize_funding`, lifted verbatim. Same guard (no read without
  a guarantee), same request deadline and abort of the previous read, same
  re-read on a standings update, same `fundingKey` keyed on
  `prize_pool:bounty_pool:prize_pool_finalized` so a stale answer is never shown
  against a newer row, same `null` (never zero) on a failed or mismatched read.
  Takes a report context so a failed read names its surface. It is now the only
  client caller of the RPC.
- `pendingHouseShare` in `src/utils/tournamentPrizeFunding.ts` (new): what the
  house still adds at close, `house_due` when the database says it, otherwise
  `max(0, (house_required ?? overlay) - max(0, house_posted))`. A Free Buy's
  promo chips are already in the pool, so 250 GTD holding 155 promo adds 95,
  never 250. `null` funding is 0: no floor is shown rather than a guessed one.
- `RewardsTab` uses both. Behaviour unchanged; its eleven existing tests pass
  untouched.
- `GameLobbyPanel`, `TournamentInfoPanel`, `TournamentPage` each read funding
  through the hook, derive a guaranteed ladder pool with
  `effectivePlaceLadderPool(prize_pool + pendingHouse, ...)` exactly as
  RewardsTab does (the one ladder rule from
  `tests/payout-one-rule-everywhere.law.test.ts` is kept), and print
  "Guaranteed N" under a place when the guaranteed figure exceeds the
  projection. Only when the event has a guarantee, the pool is not finalized,
  it is not a satellite, and the house still owes something. Final standings
  with recorded prizes are untouched.
- The lobby panel's Projected column now opens when there is a ladder to price
  (places pool > 0, or the guaranteed pool while the house share is pending);
  the stale "floored by the guarantee" comment is corrected; the footnote says
  the guaranteed figures include the N the house adds.
- Each floor is a stacked sub-line inside the existing cell
  (`.glp__projected-gtd`, `.tip__prize-gtd`, `.tourn-value__gtd`) so the
  tables keep their column count at 375px.

## Tests

- `tests/unit/pendingHouseShare.test.ts`: the helper's five cases.
- `tests/hooks/useTournamentPrizeFunding.test.tsx`: fetch shape, no read
  without a guarantee, stale-key suppression, standings re-read, failure and
  mismatch answer null and report.
- `tests/components/GameLobbyPanelGuaranteedFloor.test.tsx`,
  `tests/components/TournamentInfoPanelGuaranteedFloor.test.tsx`,
  `tests/unit/tournamentPageGuaranteedFloor.test.tsx`: each renders the worked
  example (pool 1,196, bounty 460, rake 184, GTD 2,500, funding mocked to
  house_due 660) on a 50/30/20 structure and asserts first place reads 598
  with "Guaranteed 928", the same number `placePrize(1,856, ...)` gives
  RewardsTab; no floor once house_due is 0 or the pool is finalized; no RPC
  read without a guarantee.
- `tests/every-projected-place-shows-its-guaranteed-minimum.law.test.ts` (law,
  registered in `docs/laws.d/`): all four surfaces import and call the hook and
  helper and price the floor through `effectivePlaceLadderPool`; none names the
  RPC; the hook is the only client file that does; the hook keeps its deadline,
  abort, realtime refresh and key invalidation.

Green in this worktree: the new tests above,
`tests/tournament-guarantees-include-bounties.law.test.tsx`,
`tests/unit/prizePoolOverlayParity.test.tsx`,
`tests/unit/tournamentLobbyTabContract.test.ts`,
`tests/payout-one-rule-everywhere.law.test.ts`,
`tests/a-guarantee-moves-no-chips-before-close.law.test.ts`,
`tests/a-buyin-guarantee-counts-the-whole-payment.law.test.ts`,
`tests/law-registry.law.test.ts`, every existing GameLobbyPanel,
TournamentInfoPanel and TournamentPage test, the 34 source-contract tests the
pre-push hook selects for the changed files, the 98 files `vitest related`
finds for the changed source, and `npx tsc --noEmit -p .`.
