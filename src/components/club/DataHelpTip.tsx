import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  portal = false,
}: {
  children: ReactNode;
  label?: string;
  /** Tints the "?" red when a note inside it is a warning. */
  alert?: boolean;
  className?: string;
  /** Escape Clipped Rows And Scrollable Wallet Panels. */
  portal?: boolean;
}) {
  const id = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!portal || !open || !summaryRef.current || !panelRef.current) return;
    const rect = summaryRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - panel.width - 12)),
      top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - panel.height - 12)),
    });
  }, [portal, open, children]);
  useEffect(() => {
    if (!portal || !open) return;
    const close = () => {
      if (detailsRef.current) detailsRef.current.open = false;
      setOpen(false);
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!detailsRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        summaryRef.current?.focus();
      }
    };
    const viewport = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', viewport, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', viewport, true);
    };
  }, [portal, open]);
  const panel = (
    <div
      id={id}
      ref={panelRef}
      className={`${styles.panel} ${portal ? styles.panelPortal : ''}`}
      hidden={portal && !open}
      style={portal ? position : undefined}
    >
      {children}
    </div>
  );
  return (
    <details
      ref={detailsRef}
      onToggle={portal ? (event) => setOpen(event.currentTarget.open) : undefined}
      className={`${styles.tip} ${className ?? ''}`}
      data-testid="data-help-tip"
    >
      <summary
        ref={summaryRef}
        aria-controls={id}
        className={`${styles.mark} ${alert ? styles.markAlert : ''}`}
        aria-label={label}
        title={label}
      >
        ?
      </summary>
      {portal ? createPortal(panel, document.body) : panel}
    </details>
  );
}
