# No projected payouts (2026-11-07)

Dan, verbatim: "NEVER EVER USE 'PROJECTED PAYOUTS' ANYWHERE AND EVER. YOU ONLY USE ACTUAL REAL TIME TOTALS!"

A tournament place is now priced only on the actual prize pool as it stands
(`effectivePlaceLadderPool` / `placePrize`), or the recorded prize once paid.

- **GameLobbyPanel (Payouts tab):** the "Projected" column is now "Prize",
  priced on the actual places pool only. The "Guaranteed N" sub-line, its
  guaranteed ladder, the funding read and the "Projected Amounts Are
  Estimates..." / "Guaranteed Figures Include..." footnote are gone; the note
  reads "Amounts Update Live With The Prize Pool."
- **TournamentInfoPanel (table-side Prizes) and TournamentPage (Payouts):**
  the "Guaranteed N" per-place sub-line and its guaranteed ladder are removed.
- **RewardsTab:** the per-place "Guaranteed N" line and the "Guaranteed
  Amounts Include The ..." note are removed. Total Prize Pool, the
  Guarantee/Overlay header, "Where It Comes From" and the live overlay
  sentence under the guarantee stay (live totals, not payouts).
- **MysteryBountyPanel:** before the chests are drawn it no longer shows a
  projected tier ladder, a "Projected" tag or a projected chest count. It
  shows the actual mystery pool so far (`useMysteryBountyPoolSoFar`, the
  engine's own `mysteryPoolCents` split of the live bounty pool), "Not Drawn
  Yet" for chests, and says the bounties are drawn when they activate.
  `src/lib/mysteryBountyProjection.ts` and `useMysteryBountyProjection` are
  deleted.

Law: `tests/no-projected-payouts.law.test.tsx` refuses the projected-payout
wording in any user-visible string or JSX text under `src/`, and renders the
worked example (1,196 places, 460 bounties, 184 rake, 2,500 GTD, 660 house
due, 50/30/20) on the lobby panel and Rewards: first place 598, never 1,856
or 928. It replaces
`tests/every-projected-place-shows-its-guaranteed-minimum.law.test.ts`.
