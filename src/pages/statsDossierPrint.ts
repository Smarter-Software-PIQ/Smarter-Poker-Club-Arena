/** Load the complete printable dossier only when the player requests it. */
export async function prepareStatsDossier() {
  await Promise.all([
    import('./stats/RakeTab'),
    import('./stats/OverviewTab'),
    import('./stats/PerformanceTab'),
    import('./stats/PositionsTab'),
    import('./stats/HandsTab'),
    import('./stats/TrophiesTab'),
    import('./stats/TournamentsTab'),
    import('./stats/TournamentPlayingStats'),
    import('./stats/AnalysisTab'),
    import('../components/stats/StatsCharts'),
    import('../components/stats/StatsPositionPiePlot'),
    import('../components/stats/EVLuckChart'),
    import('../components/stats/BankrollTracker'),
    import('../components/stats/PositionWinRates'),
    import('../components/stats/PositionalRadar'),
    import('../components/stats/HoleCardHeatmap'),
    import('../components/stats/NemesisPanel'),
    import('../components/stats/BenchmarkPanel'),
    import('../components/stats/TrophyRoom'),
    import('../components/stats/StatsShareCard'),
    import('../components/stats/SessionHistory'),
    import('../components/stats/AdvancedStatsSummary'),
    import('../components/agent/DownlineRakePanel'),
  ]);
}
