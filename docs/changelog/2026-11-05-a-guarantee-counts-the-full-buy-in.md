# A Guarantee Counts The Full Buy-In

Owner rule, 2026-11-05. The full qualifying player payment counts toward a
tournament's buy-in guarantee before bounty or rake allocations. A player who
pays 40 chips split 26 prize / 10 bounty / 4 rake has put 40 toward the
guarantee. With G the advertised guarantee and C the players' gross payments
(entries, re-entries, rebuys and add-ons, net of refunds), the house or promo
funding is H = max(0, G - C) in total; once C reaches G it is zero.

## The Defect

Every writer sized the house funding against one floor,
`fn_ca_place_guarantee(G, bounty_pool) = G - bounty_pool`, and paid
max(0, floor - prize_pool). That is (G - C) + rake: rake was never counted
toward the guarantee. Reproduced on production's own code (native proof):

| Entries at 40 (26/10/4), G 500 | C   | Required H | Old close-out paid |
| ------------------------------ | --- | ---------- | ------------------ |
| 10                             | 400 | 100        | 140                |
| 13                             | 520 | 0          | 32                 |

Across guaranteed events started since 2026-10-20, 73 completed events were
funded 6,745.40 chips above the corrected H (every one already paid out to
players). No open, registering or running event had house funding at the time
of the change. The event list is in the reconciliation report for this change.

## The Fix

Migration `20261105220120`:

- `fn_ca_place_guarantee_gross(G, bounty_pool, total_rake)` = G - bounty - rake.
  `bounty_pool` is cumulative (an award does not reduce it; awards are in
  `bounty_pool_paid`) and `total_rake` is net of refunds (0 mismatches against
  escrow across 466 guaranteed events), so the close-out pays exactly
  max(0, G - C) and nothing once C >= G.
- All 13 readers of the floor pass `total_rake`, md5-guarded: the close-out
  chain, the start trigger (satellite seats only), the start-overlay excess
  return, the shortfall reader, both settlement doors and their atomic twins,
  the completion guard, the two conservation detectors and the Diamond floor.
- `fn_ca_backpay_guarantee_shortfalls` loses its last grant (service_role), so
  nothing can run it; it topped events up to the full guarantee in prizes and
  bounties, ignoring rake. Its body is unchanged.
- `fn_tournament_guarantee_check` counts rake as part of what met the
  guarantee.
- `fn_ca_tournament_prize_funding` returns `gross_collected`, `player_prize`,
  `player_bounty`, `rake`, `guarantee` and `house_required`.
- `fn_ca_guarantee_coverage(event)` gives the reconcilable breakdown, and
  `ca_guarantee_funding_variances` is filled every 15 minutes with any
  finalized guaranteed event whose house funding is above or below H.

Screens: the lobby card shows the guarantee (labelled "Guarantee") until the
players' gross payments reach it, then the money actually in the prize and
bounty pools; the place ladder floors at G - bounty - rake; the Rewards meter
reads "Collected Against The Guarantee" from the gross.

Allocation of H follows the existing overlay policy: it funds the regular
prize pool (places). Bounty and rake allocations are never touched.

Native proof: `scripts/ci/test-guarantee-counts-the-full-buy-in.py`.
Law: `tests/a-guarantee-counts-the-full-buy-in.law.test.ts`.
