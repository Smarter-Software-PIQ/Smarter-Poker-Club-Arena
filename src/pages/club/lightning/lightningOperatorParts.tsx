/**
 * The pieces the Lightning operator views share: the mode inks, the figure
 * and latency grids, and the calm states every door answers with
 * (restricted, not available yet, refused, failed). #SmarterDesign (Dan
 * 2026-11-27): figures are chrome meters and every state is the one chrome
 * ArenaState screen; the painted console is the old style.
 */
import { ArenaState } from '../../../components/ops/ArenaOps';
import { compactChips } from '../../../utils/format';
import {
  LATENCY_LEGS,
  LATENCY_LEG_LABELS,
  enumLabel,
  type LatencyLegs,
  type LightningModeTone,
  type OperatorAnswer,
} from '../../../lightning/lightningOperatorApi';
import styles from '../ClubLightningOperationsPage.module.css';

import { inkClass, type LightningInk } from './lightningInk';

export const MODE_INK: Record<LightningModeTone, LightningInk> = {
  must_move: 'silver',
  lightning: 'blue',
  pending: 'gold',
  frozen: 'red',
  other: 'muted',
};

/** A count the door did not give is unknown, and prints as a dash, never 0. */
export function count(n: number | null): string {
  return n === null ? '-' : compactChips(n);
}

export function onOff(flag: boolean | null): string {
  if (flag === null) return 'Unknown';
  return flag ? 'On' : 'Off';
}

/** A latency in whole milliseconds; the unit is printed once, in the head. */
export function ms(n: number | null): string {
  return n === null ? '-' : Math.round(n).toLocaleString('en-US');
}

export function Figure({
  label,
  value,
  ink = 'silver',
}: {
  label: string;
  value: string;
  ink?: LightningInk;
}) {
  return (
    <div className={`${styles.figure} arena-meter`}>
      <dt className={`${styles.figureLabel} ${inkClass('blue')}`}>{label}</dt>
      <dd className={`${styles.figureValue} ${inkClass(ink)}`}>{value}</dd>
    </div>
  );
}

export function LatencyGrid({ legs }: { legs: LatencyLegs }) {
  const present = LATENCY_LEGS.filter((leg) => legs[leg]);
  if (present.length === 0) return null;
  return (
    <ul className={styles.grid} aria-label="Action Latency In Milliseconds">
      <li className={styles.gridRow}>
        <span className={`${styles.gridHead} ${inkClass('muted')}`}>Milliseconds</span>
        <span className={`${styles.gridHead} ${styles.gridCell} ${inkClass('muted')}`}>P50</span>
        <span className={`${styles.gridHead} ${styles.gridCell} ${inkClass('muted')}`}>P95</span>
        <span className={`${styles.gridHead} ${styles.gridCell} ${inkClass('muted')}`}>P99</span>
      </li>
      {present.map((leg) => {
        const r = legs[leg]!;
        return (
          <li className={styles.gridRow} key={leg}>
            <span className={`${styles.gridName} ${inkClass('blue')}`}>
              {LATENCY_LEG_LABELS[leg]}
            </span>
            <span className={`${styles.gridCell} ${inkClass('silver')}`}>{ms(r.p50)}</span>
            <span className={`${styles.gridCell} ${inkClass('silver')}`}>{ms(r.p95)}</span>
            <span className={`${styles.gridCell} ${inkClass('silver')}`}>{ms(r.p99)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The calm states every door shares: restricted, not yet, refused, failed. */
export function AnswerState({
  answer,
  onRetry,
}: {
  answer: OperatorAnswer<unknown> | null;
  onRetry: () => void;
}) {
  if (!answer) {
    return <ArenaState tone="loading" title="Reading Lightning..." />;
  }
  if (answer.status === 'denied') {
    return (
      <ArenaState
        tone="empty"
        title="Restricted"
        message="Lightning Operations Is Available To Club Owners And Administrators."
      />
    );
  }
  if (answer.status === 'unavailable') {
    return (
      <ArenaState
        tone="empty"
        title="Not Available Yet"
        message="Lightning Operator Readings Arrive With The Next Database Release."
      />
    );
  }
  if (answer.status === 'refused') {
    return (
      <ArenaState tone="error" title={`Lightning Refused This Read: ${enumLabel(answer.code)}`} />
    );
  }
  if (answer.status === 'error') {
    return (
      <ArenaState
        tone="error"
        title="Lightning Read Failed"
        message={answer.message}
        actions={
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        }
      />
    );
  }
  return null;
}
