# SparringLeague runoutEquity hi-lo split equity

2026-11-21, engineering worker for Antigravity Coordinator.

## The defect

`server/src/benchmark/SparringLeague.ts`, `runoutEquity`, scored every runout with `scoreOmahaHi` alone
and took no `variant` argument. For Omaha hi-lo variants (`plo8`, `flo8`), a qualifying 8-or-better low
hand facing a better high hand received `0.0` equity instead of `0.5`, and `horseEqVsActual` did not
forward `variant` when measuring tell-table value shares.

## The fix

`runoutEquity` (now exported for direct unit testing) and `horseEqVsActual` accept `variant: string = 'plo4'`
and forward `variant` from `runSparringCell`'s `onEnd` tell observer.

When `variantInfo(variant).isHiLo` is true (`plo8`, `flo8`), each evaluated 5-card runout scores both
`scoreOmahaHi` and `scoreOmahaLow`:

- If no player holds a qualifying 8-or-better low, 100% of the pot share goes to the high winner(s).
- If at least one player qualifies low, the pot share splits 50/50 between high winner(s) and best
  qualifying low winner(s), including ties, quartering, 3/4 pots, and scoops, matching
  `PokerEngine.determineWinners`.

When `variantInfo(variant).isHiLo` is false (`nlh`, `plo4`, `plo5`, `plo6`, `flh`, `short_deck`),
`runoutEquity` returns immediately after high-hand scoring without calling `scoreOmahaLow`, leaving
high-only behavior and speed unchanged.

## Verification

- Added `server/src/benchmark/SparringLeagueHiLoRunoutEquity.test.ts` (19 tests covering `plo8` and
  `flo8` splits, no-qualifying-low scoops, quartering, 3/4 pots, tied-high splits, strictly worse lows,
  exact turn runouts, flop runouts, `determineWinners` parity, and unchanged high-only variants).
- Verified pre-fix failure (10/17 failing on the high-only implementation) and post-fix pass across all
  `SparringLeague*` tests, `HorseLeagueHiLoSettlement.test.ts`, and `cd server && npx tsc --noEmit`.
