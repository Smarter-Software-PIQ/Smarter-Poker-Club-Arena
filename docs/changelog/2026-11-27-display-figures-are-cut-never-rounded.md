# 2026-11-27: a figure on screen is cut, never rounded

Dan, 2026-11-27: "NUMERS AFTER A DECIMAL NEED TO STOP AFTER 2 DIGITS ANY WHERE AND EVERYWHERE." Dan, 2026-09-04: "ABSOLUTELY ZERO ROUNDING ANYWHERE EVER."

PR #12250 (`2026-11-27-figures-stop-at-two-decimals.md`) made the shared chip formatters and the bare `Number#toLocaleString()` default stop at two decimals by cutting digits. Figures could still reach the screen rounded in five other ways:

1. a screen's own `new Intl.NumberFormat(..., { maximumFractionDigits: 2 })`, which rounds (and with no limit, rounds at three);
2. `value.toFixed(1)` or `toFixed(2)` printed next to `%`, `x`, `BB`, `Min`, `Days`, `Chips`;
3. `Math.round(x * 10) / 10` interpolated into text;
4. an explicit `toLocaleString({ maximumFractionDigits: 2 })` or `{ maximumFractionDigits: 0 }`: the PR #12250 cap left any call asking for two or fewer places as written, so it still rounded 0.999 up to "1";
5. the money helpers in `src/lib/utils.ts` and several helpers inside `src/utils/format.ts` itself (`formatStackChips`, `formatTableChips`, `formatBigBlinds`, `pct`).

## The root

Three helpers in `src/utils/format.ts`:

- `cutFixed(value, places)`: the shape of `toFixed` (no grouping, exactly `places` decimals, at most two), digits cut. 0.999 -> "0.99", 1.005 -> "1.00", -0.004 -> "0.00".
- `cutTo(value, places)`: the number shown at `places`, cut, used where `Math.round(x * 10) / 10` was interpolated.
- `cutNumberFormat(locales, options)`: replaces `new Intl.NumberFormat`. Same separators, currency and minimum places, at most two decimals, `roundingMode: 'trunc'`, and the value is cut by its digits first so an engine without `roundingMode` cuts too. Never prints "-0".

Arithmetic noise is not a digit: 0.29 \* 100 is 28.999999999999996, and a bare cut would print a 29% stat as 28.9%. Each helper reads the value at fifteen significant digits first (the precision a double carries), which returns that noise to 29 and leaves every real figure, 0.999 included, untouched. The browser default in `src/utils/twoDecimalDisplay.ts` now does the same, and adds `roundingMode: 'trunc'` to every `toLocaleString` call that names no rounding mode, so the 58 explicit `{ maximumFractionDigits: 2 }` calls cut too. Percent, compact and significant-digit calls keep their own place counts.

Not changed, on purpose: values sent to the server (`p_amount: amount.toFixed(2)` and the other cashier, credit and wallet intents), CSV exports (`statsCsvExport`, `CreditAdminPanel`, `CashierTradePage`, `pokerStarsExport`), the plain-text cashier receipt in `CashierResilience`, SVG paths, CSS durations and pixel values, cache keys, logs and error reports, input field values (`UnionStatementsPage` pay amount, `MemberRakebackEditor`), `src/config/spinSpec.ts` (its developer invariant message is mirrored byte for byte into the engine), and `Math.round(x * 100) / 100` used to clean cents in arithmetic. Those are payloads, measurements and money math, not a figure a player reads.

## Files changed

Shared roots:

- `src/utils/format.ts`: added `cutFixed`, `cutTo`, `cutNumberFormat`; `formatStackChips` cuts under 100 and cuts whole chips from 100 up (was `Math.round`); `formatTableChips` cuts below 1 and above; `formatBigBlinds` cuts at the tenth and at the whole (was `Math.round`); `pct` cuts.
- `src/utils/twoDecimalDisplay.ts`: every `toLocaleString` call without its own rounding mode cuts, value read at fifteen significant digits.
- `src/lib/utils.ts`: `formatCurrency`, `formatChips`, `formatChipsWhole` through `cutNumberFormat`; `formatPercent` through `cutFixed`.

`new Intl.NumberFormat` replaced by `cutNumberFormat`:

- `src/components/union/UnionClubGovernance.tsx`, `src/components/bbj/BBJRakeSchedule.tsx` (also its `blind` toFixed), `src/components/agent/AgentBackOffice.tsx`, `src/components/agent/DownlineRakePanel.tsx` (money and `count`, which rounded at three places), `src/services/TournamentService.ts` (`unregisterAmount`), `src/components/tournament/TournamentHUD.tsx` (the compact dock average now cuts: 1,999 reads 1.9K, not 2K).

On-screen `toFixed(1|2)` replaced by `cutFixed` (same place count):

- Stats: `src/components/stats/AdvancedStatsSummary.tsx`, `BenchmarkPanel.tsx`, `CashIntelligencePanel.tsx`, `HoleCardHeatmap.tsx`, `PositionWinRates.tsx`, `PositionalRadar.tsx` (labels only; the SVG path keeps toFixed), `SessionHistory.tsx`, `StatsShareCard.tsx`, `TrophyRoom.tsx`, `findLeaks.ts`, `statBenchmarks.ts`; `src/pages/stats/ClubComparisonTable.tsx`, `OverviewTab.tsx`, `PerformanceTab.tsx`, `RakeTab.tsx`, `SharedClubStatsView.tsx`, `StatsHeadlineDeck.tsx`, `TournamentPlayingStats.tsx`, `TournamentsTab.tsx`, `binomialConfidence.ts`; `src/pages/PlayerStatsPage.tsx`, `src/pages/SessionHistoryPage.tsx` (labels only), `src/pages/AntiCheatPage.tsx`.
- Table: `src/pages/TablePage.tsx` (rebuy, rakeback and auto top up toasts), `src/pages/MultiTablePage.tsx`, `src/components/table/InsuranceModal.tsx`, `LeaderboardPanel.tsx`, `RealTimeResultPanel.tsx`, `SessionAnalytics.tsx`, `SessionHUD.tsx`, `TournamentHourVpip.tsx`.
- Agents, rake and union: `src/components/agent/AgentAnalyticsDashboard.tsx`, `AgentHierarchyTree.tsx`, `AgentScoreCard.tsx`; `src/components/club/RakeSnapshotPanel.tsx` (also a `Math.round(pct * 10) / 10`); `src/components/union/UnionOpsPanel.tsx`; `src/components/admin/SecurityDashboard.tsx`; `src/pages/AgentManagementPage.tsx`, `SuperAgentDashboard.tsx`, `RakebackPage.tsx`, `RateAuditPage.tsx`, `UnionDashboardPage.tsx`, `UnionGamesPage.tsx`, `UnionStatementsPage.tsx` (ECO base label only), `CashierPage.tsx`, `ClubSettingsPage.tsx`, `admin/HouseAdsPage.tsx`, `club/ClubDataPage.tsx` (also a `Math.round(pct * 10) / 10`), `club/ClubLightningOperationsPage.tsx`, `club/lightning/LightningClusterDetail.tsx` (also a `Math.round` reading).
- Jackpot: `src/components/bbj/BBJMiniPanel.tsx`, `BBJAdminAnalytics.tsx`, `src/pages/BadBeatJackpotPage.tsx`, `src/utils/jackpotExact.ts` (`jackpotPercent(15.3798)` reads 15.37).
- Games: `src/components/crash/CrashCurve.tsx` (the multiplier label only; geometry keeps toFixed), `src/components/games/ChoiceScene.tsx`, `FloorFeed.tsx`, `MinesGrid.tsx`, `bonusReceiptFigure.ts`, `src/components/wheel/WheelRunPanels.tsx`, `src/components/daily-bonus/DailyBonusSheet.tsx`, `src/components/gamification/StreakMultiplier.tsx`, `src/pages/DiamondChoicePage.tsx`, `DiamondCrashPage.tsx`, `DiamondGamesPage.tsx`, `DiamondTestPage.tsx`, `DiamondWheelPage.tsx`, `src/utils/diamondGamesFairness.ts`, `src/services/DiamondGamesService.ts`, `src/services/DailyBonusService.ts`.
- Other: `src/components/cash/CashGameCreateFlow.tsx`, `src/components/club/CreateTournamentModal.tsx`, `src/components/tournament/details/RewardsTab.tsx`, `src/components/tournament/details/BlindsTab.tsx` (also its `Math.round(m * 10) / 10`), `src/components/lobby/AdvancedFilters.tsx`, `src/components/lobby/lobbyEntries.ts` (chip total and opening minutes), `src/components/wallet/WalletCashierModal.tsx`, `src/components/device/deviceReport.ts`, `src/components/common/AnimatedNumber.tsx` (also its whole-chip `Math.round`), `src/lib/bettingStructure.ts`, `src/lib/allInEquityDisplay.ts`, `src/utils/replayMotion.ts` (pot odds and ratio), `src/utils/cashierBatch.ts`.

## What a player now sees differently

Only figures whose next digit is 5 or more change, and each one by one unit in its last place, downward: the crash lobby's 2.8968x average reads "2.8x" (was "2.9x", still inside Dan's 2.4x to 3.0x band), a 0.3636 ITM reads "36.3%", a 1.0909 ROI reads "109.0%", 4.25 BB/100 reads "4.2", and the Donkey Cross street-five multiplier that read "5.57x" reads "5.56x".

## Tests

New law `tests/display-figures-are-cut-never-rounded.law.test.ts` (registered in `docs/laws.d/display-figures-are-cut-never-rounded.md`): unit checks for the helpers and the shared formatters, and a scan of `src/` that refuses a `new Intl.NumberFormat` outside `cutNumberFormat`, a `toFixed` printed beside a display unit, and an interpolated `Math.round(x * 10) / 10`.

Pins updated in the same change because they pinned the old rounded output: `tests/figures-stop-at-two-decimals.law.test.ts` (narrow, percent and significant calls now cut), `tests/the-jackpot-is-printed-to-the-cent.law.test.ts` (15.37), `tests/the-games-never-pay-more-than-they-take-in.law.test.ts` and `tests/unit/diamondGamesFairness.test.ts` (Average Crash 2.8x), `tests/components/DiamondGamesLobbyOdds.test.tsx` (2.8x), `tests/components/DiamondChoiceFinishedRound.test.tsx` (5.56x), `tests/components/stats-contract-truth.test.tsx` (36.3%, 109.0%), `tests/components/player-stats-contract-truth.test.tsx` (4.2), `tests/components/performance-confidence.test.tsx` and `tests/unit/binomialConfidence.test.ts` (40.3% lower bound), `tests/unit/insuranceModalLayout.test.tsx` (the rate readout is `cutFixed(rate, 2)`), `tests/no-invented-money-on-an-agent-screen.law.test.ts` and `tests/stats-presentation-truth.test.ts` (source pins naming `toFixed(1)` and the old import lines).
