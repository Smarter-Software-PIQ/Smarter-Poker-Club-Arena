import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '../lobby/ArenaWorkspace.css';
import './ArenaOps.css';

/**
 * CLUB OPERATIONS IN #SMARTERDESIGN (Dan 2026-11-27): "INSIDE THE PLAYER
 * MANAGEMENT PAGE AT THE TOP ... YOU SEE THE 'CLUB OPERATIONS'. THAT NEEDS TO
 * BE ENHANCED WITH THE #SMARTERDESIGN, AS WELL AS EVERY SINGLE ONE OF THESE
 * PAGES". #SmarterDesign is the arena workspace language Player Management,
 * the Cashier and Club Data already wear (ArenaWorkspace.css): thin chrome
 * cases, chrome readout tiles, chrome buttons that light blue when selected
 * and chrome list rows. These two pieces are the parts every Club Operations
 * page shares, so each page prints its live figures into the same chrome.
 * The painted console plates are the old style and are never used here.
 */

export type ArenaTone = 'live' | 'attention' | 'danger';

export interface ArenaReading {
  id: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: ArenaTone;
}

interface ReadingsProps {
  readings: ArenaReading[];
  label?: string;
  busy?: boolean;
  className?: string;
}

/** A row of chrome readout tiles: four across on a desktop, two on a phone. */
export function ArenaReadings({ readings, label, busy, className }: ReadingsProps) {
  return (
    <dl
      className={className ? `arena-ops-readings ${className}` : 'arena-ops-readings'}
      aria-label={label}
      aria-busy={busy || undefined}
    >
      {readings.map((r) => (
        <div key={r.id} className="arena-meter" data-tone={r.tone}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
          {r.sub != null && <dd className="arena-ops-reading-sub">{r.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

type RowProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  to?: string;
  index?: number | string;
  title: ReactNode;
  line?: ReactNode;
  lineId?: string;
  signal?: ReactNode;
  signalTone?: ArenaTone;
  signalLabel?: string;
  [data: `data-${string}`]: string | undefined;
};

/**
 * One chrome list row: a numeral, the title, one line of detail, a signal on
 * the right and a chevron. A Link when it opens somewhere, a plain div when not.
 */
export function ArenaRow({
  to,
  index,
  title,
  line,
  lineId,
  signal,
  signalTone,
  signalLabel,
  className,
  ...rest
}: RowProps) {
  const body = (
    <>
      {index != null && (
        <span className="arena-ops-row__index" aria-hidden="true">
          {typeof index === 'number' && index < 10 ? `0${index}` : index}
        </span>
      )}
      <span className="arena-ops-row__copy">
        <strong>{title}</strong>
        {line != null && <small id={lineId}>{line}</small>}
      </span>
      {signal != null && signal !== 0 && signal !== '' && (
        <span className="arena-ops-row__signal" data-tone={signalTone} aria-label={signalLabel}>
          {signal}
        </span>
      )}
      {to && (
        <span className="arena-ops-row__chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  const cls = className
    ? `arena-ledger-row arena-ops-row ${className}`
    : 'arena-ledger-row arena-ops-row';
  if (to) {
    return (
      <Link to={to} className={cls} {...rest}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} {...rest}>
      {body}
    </div>
  );
}

interface StateProps {
  /** empty: nothing to show yet; loading: reading; error: the read failed. */
  tone: 'empty' | 'loading' | 'error';
  title: ReactNode;
  message?: ReactNode;
  /** Keys under the message, such as Retry: buttons or links. */
  actions?: ReactNode;
  className?: string;
}

/**
 * One chrome screen for every empty, loading and error state on the Club
 * Operations pages (Dan 2026-11-27), so a page reads the same with no data,
 * while reading, and when a read fails as it does with a full ledger.
 */
export function ArenaState({ tone, title, message, actions, className }: StateProps) {
  return (
    <div
      className={className ? `arena-ops-state ${className}` : 'arena-ops-state'}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-busy={tone === 'loading' || undefined}
    >
      {tone === 'loading' && <span className="arena-ops-state__meter" aria-hidden="true" />}
      <strong className="arena-ops-state__title">{title}</strong>
      {message != null && <p className="arena-ops-state__message">{message}</p>}
      {actions != null && <div className="arena-switch arena-ops-keys">{actions}</div>}
    </div>
  );
}
