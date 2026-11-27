/**
 * One labelled value in a stats grid. Moved verbatim out of PlayerStatsPage.tsx
 * (Stats Page Programme phase 2) so every tab chunk can use it.
 *
 * NO PER-BOX SCOPE TAG (Dan, 2026-11-27): "IT DOESN'T NEED TO SAY CASH INSIDE
 * EACH BOX, AS CASH GAMES IS ALREADY SELECTED AT THE TOP." Since the separated
 * RPC (one population per game mode) the Cash Games / Tournaments switch is the
 * single statement of which hands a figure counts, so a row carries no scope
 * word. The 2026-09-20 `scope` prop that printed one is removed, not hidden.
 */
import { NOT_YET_MEASURED } from './format';

export function StatRow({
  label,
  value,
  highlight,
  color = '#00d4ff',
  evidence,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  color?: string;
  /** Visible denominator and confidence evidence for a derived conclusion. */
  evidence?: string;
}) {
  /* An unmeasured figure already says so in its value; a second line saying
     the denominator is unavailable is the same fact twice (Dan, 2026-11-27:
     "remove any and all unnecessary explanations"). */
  const unmeasured = value === NOT_YET_MEASURED;
  return (
    <div className={`stat-row ${highlight ? 'highlight' : ''}`}>
      <span className="row-label">
        <span className="row-dot" style={{ backgroundColor: color }} />
        <span className="stat-label-text">{label}</span>
        {evidence && !unmeasured ? (
          <span className="hero-stat-sub stat-evidence">{evidence}</span>
        ) : null}
      </span>
      <span
        className={`row-value${unmeasured ? ' is-unmeasured' : ''}`}
        style={unmeasured ? undefined : { color }}
      >
        {value}
      </span>
    </div>
  );
}
