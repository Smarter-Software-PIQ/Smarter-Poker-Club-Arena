# Hold'em Committed No-Pair And Danger-Board Authority Docs: Three League Seeds And Sample Limits

## Summary

- Records the three-seed `horseLeagueCard.ts` runs (`6,000` pairs / `12,000` hands per seed = `36,000` hands each on engine `eca4fd3abcca`, `0` illegal actions) in `docs/horse-option-authority.d/holdemCommittedNoPairIsPriced.md` (`-0.50 +/- 0.53 bb/100`) and `docs/horse-option-authority.d/holdemDangerBoardEquityIsPriced.md` (`-0.75 +/- 0.63 bb/100`).
- Explicitly documents the `n = 50` called-hand showdown selection bias (`HOLDEM_DANGER_BOARD_BETTOR_SHOWN`: a shown hand is a called hand biased toward showdowns, not the bettor's full betting range) and `n = 124` postflop raise-response sample (`HOLDEM_RAISE_FOLD_SHARE_BY_PRICE`) per the Coordinator review on `#11545`.
- Both options remain `Evidence NOT MET` and default `OFF`.
