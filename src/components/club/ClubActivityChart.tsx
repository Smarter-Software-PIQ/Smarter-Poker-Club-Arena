/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB ACTIVITY CHART - hands and rake over time
 * ═══════════════════════════════════════════════════════════════════════════════
 * Kept in its own file and loaded with React.lazy from ClubDashboard, matching
 * ProfitChart: Recharts is a ~390KB dependency and must not sit in the
 * dashboard's initial chunk just because the Overview tab might show a chart.
 *
 * Hands and rake differ by orders of magnitude (tens of thousands of hands
 * against hundreds of chips), so they get separate Y axes - plotted on one
 * axis the rake series would be a flat line pinned to zero.
 */

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './ClubActivityChart.module.css';

export interface ClubActivityPoint {
  d: string;
  hands: number;
  rake: number;
}

/**
 * WHICH HANDS (2026-09-04, the gate on phase 6). This component is rendered
 * twice on the club dashboard, from two different series: the Overview tab
 * passes hands DEALT (every hand the engine finished, tournament hands
 * included) and the Revenue tab passes RAKED hands, which on this club is
 * 182,035 against 596,817 for the same week. Both were drawn under a legend
 * that said "Hands". The caller names its series now, because a chart that
 * relabels itself between tabs is the defect phase 6 exists to remove.
 */

interface Props {
  data: ClubActivityPoint[];
  height?: number;
  /** What the hands series counts. Required by every caller - see above. */
  handsLabel: string;
}

/** "2026-08-19" -> "Aug 19", without dragging in a date library. */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const fmtInt = (n: number) => Math.trunc(n).toLocaleString('en-US');
const fmtChips = (n: number) =>
  (Math.trunc(n * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function ClubActivityChart({ data, height = 240, handsLabel }: Props) {
  const points = (data || []).map((p) => ({ ...p, label: shortDay(p.d) }));

  if (points.length === 0 || points.every((p) => p.hands === 0 && p.rake === 0)) {
    return (
      <div className={styles.empty} style={{ height }}>
        No Activity In This Period Yet
      </div>
    );
  }

  return (
    <div className={styles.chart} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="caHands" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#45adff" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#45adff" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#253e57" strokeOpacity={0.6} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#9fbacc', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#253e57' }}
            minTickGap={12}
          />
          <YAxis
            yAxisId="hands"
            tick={{ fill: '#9fbacc', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(v: number) => fmtInt(v)}
          />
          <YAxis
            yAxisId="rake"
            orientation="right"
            tick={{ fill: '#9fbacc', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => fmtChips(v)}
          />
          <Tooltip
            contentStyle={{
              background: '#07111c',
              border: '1px solid #253e57',
              borderRadius: 4,
              fontSize: '0.8rem',
            }}
            labelStyle={{ color: '#74dfff' }}
            // Recharts types `name` as possibly undefined, so it is normalised
            // here rather than asserted away.
            formatter={(value, name) => {
              const label = String(name ?? '');
              return label === 'Rake'
                ? [fmtChips(Number(value)), label]
                : [fmtInt(Number(value)), label];
            }}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: '#9fbacc' }} />
          <Area
            yAxisId="hands"
            type="monotone"
            dataKey="hands"
            name={handsLabel}
            stroke="#45adff"
            strokeWidth={2}
            fill="url(#caHands)"
          />
          <Bar
            yAxisId="rake"
            dataKey="rake"
            name="Rake"
            fill="#ffd700"
            opacity={0.75}
            radius={[3, 3, 0, 0]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
