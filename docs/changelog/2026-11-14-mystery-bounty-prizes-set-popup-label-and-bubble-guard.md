# Mystery bounty prizes: set popup, tab label, bubble guard and the law

Follow-up to `2026-11-13-mystery-bounty-prizes-are-shown-when-the-prize-pool-is-finalized.md`
(Dan 2026-11-13: once the prize pool is finalized every mystery bounty prize is
shown). Dan asked for all four follow-ups.

1. **A double bust on the bubble no longer changes the prizes shown.** If the
   phase opens with fewer players than the ladder was sealed for, the seed
   (through the new `fn_mystery_sealed_ladder_for_open`, migration
   `20261114072509`) keeps the sealed ladder, drops the smallest chests that no
   longer have a knockout, and spreads their chips evenly, in whole chips, over
   the chests that remain. Every prize that stays is at least what was shown,
   the draw order is kept, and the total is exactly the sealed pool. Probed on
   production in a rolled-back transaction: 19 sealed to 18 and to 16, totals
   exact, no chest smaller than shown, a pool mismatch falls back to the
   engine's cut.
2. **The law.** `tests/mystery-bounty-prizes-are-shown-at-entry-close.law.test.ts`
   pins every link: engine seal, seal guards, lobby read, seed, lobby and table
   listeners. Panel render tests pin that the sealed ladder is listed before the
   money and that nothing claims the prizes are set before entry closes.
3. **The table is told.** On `mystery_bounty_sealed` each table raises one
   popup per event, "Mystery Bounty Prizes Are Set. Tap To See Them"; the tap
   opens the in-table lobby on the Bounties tab (`requestedTab` on
   `TournamentLobbyModal` / `TournamentDetails`).
4. **The tab says the amounts are final.** While the phase has not opened the
   Bounties tab reads "Prizes Set At Entry Close, <time>. They Open When The
   Mystery Phase Starts" above the ladder (`sealed_at` from
   `fn_mystery_bounty_inventory`).

No engine change: the engine already seals and broadcasts. Client and
migration ship on merge.
