/**
 * AdvancedStatsSummary — the eight headline rates as tappable cards.
 *
 * PURE PRESENTATION (2026-09-03). This component used to carry a standalone
 * `ca_player_stats_overview_v2` fetch WITHOUT p_days (lifetime numbers under
 * the page's "7 Days" label), a localStorage cache, two bus listeners, and an
 * invented benchmark table ("based on typical 1/2 NL Hold'em") that awarded
 * "Elite" to a Fold-To-3-Bet of 0 - i.e. to no data at all. None of that could
 * run in production (the page always passes `initialData`) except the badges,
 * which were fabricated. The page has a real BenchmarkPanel measured against
 * the field; this one just shows the numbers, for the window they cover.
 */

import React, { useState, useMemo } from 'react';
import { aggressionFactorLabel } from '../../pages/stats/format';
import { chipCents } from '../../utils/cashierAmount';
import { compactChips, cutFixed } from '../../utils/format';
import './AdvancedStatsSummary.css';
import type { StatsMetricAvailabilityContract } from '../../services/statsContract';
import { NOT_YET_MEASURED } from '../../pages/stats/format';

interface AdvancedStat {
  id: string;
  label: string;
  value: number;
  format: (val: number) => string;
  unit?: string;
  description: string;
  measured?: boolean;
}

export interface AdvancedStatsInput {
  cash_hands?: number;
  metric_availability?: Partial<StatsMetricAvailabilityContract>;
  total_hands?: number;
  total_profit?: number;
  hours_played?: number;
  cash_hours_played?: number;
  showdowns_won?: number;
  showdowns_total?: number;
  aggression_factor?: number;
  /** 'postflop' once the database counts flop/turn/river only (2026-11-04). */
  aggression_factor_basis?: 'postflop' | 'all_streets';
  three_bet_percent?: number; // fraction 0..1
  fold_to_three_bet?: number; // fraction 0..1
  cbet_flop?: number; // fraction 0..1
  vpip?: number;
  pfr?: number;
  bb_per_100?: number;
  total_winnings?: number;
}

interface AdvancedStatsSummaryProps {
  /** The page's range-windowed `overall` block (rates as fractions). */
  initialData?: AdvancedStatsInput | null;
  /** The page's analysis window label, e.g. "7 Days" or "All". */
  rangeLabel?: string;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function buildStats(d: AdvancedStatsInput): AdvancedStat[] {
  const totalHands = n(d.total_hands);
  const hoursPlayed = n(d.cash_hours_played);
  const totalProfit = n(d.total_profit);
  const showdownsWon = n(d.showdowns_won);
  const showdownsTotal = n(d.showdowns_total);
  const hourlyRate = hoursPlayed > 0 ? totalProfit / hoursPlayed : 0;
  const showdownWinPct = showdownsTotal > 0 ? (showdownsWon / showdownsTotal) * 100 : 0;

  return [
    {
      id: 'hourly',
      measured: d.metric_availability?.cash_hours_played === true && hoursPlayed > 0,
      label: 'Hourly Rate',
      value: hourlyRate,
      format: (val) => `${val >= 0 ? '+' : ''}${compactChips(chipCents(val))}`,
      unit: '/hr',
      description:
        'Cash Profit Per Recorded Cash Hand Hour In This Window. Overlapping Tables Count Once.',
    },
    {
      id: 'totalHands',
      label: 'Hands Analysed',
      value: totalHands,
      format: (val) => Math.floor(val).toLocaleString(),
      description: 'Hands Inside This Analysis Window',
    },
    {
      id: 'showdownWin',
      measured: showdownsTotal > 0,
      label: 'Showdown Win %',
      value: showdownWinPct,
      format: (val) => `${cutFixed(val, 1)}%`,
      description: `Won ${showdownsWon.toLocaleString()} Of ${showdownsTotal.toLocaleString()} Showdowns`,
    },
    {
      id: 'aggression',
      measured: d.metric_availability?.aggression_factor === true,
      label: aggressionFactorLabel(d.aggression_factor_basis),
      value: n(d.aggression_factor),
      format: (val) => cutFixed(val, 1),
      description:
        d.aggression_factor_basis === 'postflop'
          ? 'Bets And Raises Divided By Calls, Flop Through River'
          : 'Bets And Raises Divided By Calls',
    },
    {
      id: 'threeBet',
      measured: d.metric_availability?.three_bet_percent === true,
      label: '3-Bet %',
      value: n(d.three_bet_percent) * 100,
      format: (val) => `${cutFixed(val, 1)}%`,
      description: 'How Often You Re-Raise Preflop When You Have The Chance',
    },
    {
      id: 'foldTo3Bet',
      measured: d.metric_availability?.fold_to_three_bet === true,
      label: 'Fold To 3-Bet %',
      value: n(d.fold_to_three_bet) * 100,
      format: (val) => `${cutFixed(val, 1)}%`,
      description: 'How Often You Fold After Being Re-Raised Preflop',
    },
    {
      id: 'cbetFreq',
      measured: d.metric_availability?.cbet_flop === true,
      label: 'C-Bet Frequency',
      value: n(d.cbet_flop) * 100,
      format: (val) => `${cutFixed(val, 1)}%`,
      description: 'How Often You Bet The Flop After Raising Preflop',
    },
    {
      id: 'bbPer100',
      measured: n(d.cash_hands) > 0,
      label: 'BB/100 Hands',
      value: n(d.bb_per_100),
      format: (val) => `${val >= 0 ? '+' : ''}${cutFixed(val, 1)}`,
      description: 'Big Blinds Won Per 100 Cash Hands',
    },
  ];
}

const AdvancedStatsSummary: React.FC<AdvancedStatsSummaryProps> = ({ initialData, rangeLabel }) => {
  const stats = useMemo(() => buildStats(initialData ?? {}), [initialData]);
  const [selectedStat, setSelectedStat] = useState<string | null>(null);
  const getTrendColor = (val: number) => {
    if (val > 0) return '#10b981';
    if (val < 0) return '#ef4444';
    return '#8a9aaa';
  };

  return (
    <div className="stats-workbench-surface advanced-stats-summary">
      <div className="stats-header">
        <h3>Betting And Showdown Statistics</h3>
        <p className="stats-subtitle">
          Detailed Metrics From Your Play
          {rangeLabel && rangeLabel !== 'All' ? ` Over The Last ${rangeLabel}` : ''}
        </p>
      </div>

      <div className="advanced-stats-grid">
        {stats.map((stat) => {
          const isSelected = selectedStat === stat.id;

          return (
            <button
              type="button"
              key={stat.id}
              className={`advanced-stat-card ${isSelected ? 'selected' : ''}`}
              aria-expanded={isSelected}
              onClick={() => setSelectedStat(isSelected ? null : stat.id)}
            >
              <span className="card-top">
                <span className="stat-title">{stat.label}</span>
              </span>
              <span className="card-value">
                <span
                  className="value-main"
                  style={{
                    color:
                      stat.id === 'hourly' && stat.measured ? getTrendColor(stat.value) : undefined,
                  }}
                >
                  {stat.measured === false ? NOT_YET_MEASURED : stat.format(stat.value)}
                </span>
                {stat.unit && stat.measured !== false && (
                  <span className="value-unit">{stat.unit}</span>
                )}
              </span>
              {isSelected && <span className="card-description">{stat.description}</span>}
            </button>
          );
        })}
      </div>

      <details className="metric-glossary">
        <summary>Metric Definitions</summary>
        <div className="stats-legend">
          <div className="legend-item">
            <span className="legend-label">BB/100 Hands</span>
            <p>Big Blinds Won Per 100 Hands - Primary Win Rate Metric</p>
          </div>
          <div className="legend-item">
            <span className="legend-label">C-Bet</span>
            <p>Continuation Bet - Betting On The Flop After Raising Preflop</p>
          </div>
          <div className="legend-item">
            <span className="legend-label">AF</span>
            <p>Aggression Factor - Ratio Of Aggressive To Passive Actions</p>
          </div>
        </div>
      </details>
    </div>
  );
};

export default AdvancedStatsSummary;
