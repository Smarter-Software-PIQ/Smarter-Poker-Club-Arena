import type { ReactNode } from 'react';
import styles from './DataHelpTip.module.css';

/**
 * Dan, 2026-11-15: explanation paragraphs (how figures are counted, invoice
 * basis, day boundaries, provisional notes) never print on a page. They live
 * behind this "?" and open only when the reader taps it.
 *
 * A native <details> keeps it keyboard and screen-reader friendly with no
 * state, and the copy stays in the DOM for search and tests while closed.
 */
export default function DataHelpTip({
  children,
  label = 'How These Figures Are Counted',
  alert = false,
  className,
}: {
  children: ReactNode;
  label?: string;
  /** Tints the "?" red when a note inside it is a warning. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <details className={`${styles.tip} ${className ?? ''}`} data-testid="data-help-tip">
      <summary
        className={`${styles.mark} ${alert ? styles.markAlert : ''}`}
        aria-label={label}
        title={label}
      >
        ?
      </summary>
      <div className={styles.panel}>{children}</div>
    </details>
  );
}
