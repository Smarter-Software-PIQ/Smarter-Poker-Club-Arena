/**
 * CLUB DATA: THE UNION INVOICE WEEKS INSIDE THE SELECTED DATES
 * ============================================================================
 * Owner, 2026-11-14: "The data page display data starts and stops at the same
 * 2AM time that the invoices are appearing as; the data on this page should
 * match the invoices 1:1."
 *
 * Every issued union weekly invoice whose week lies inside the selected dates
 * is printed here with its real boundaries (Monday 2:00 AM to Monday 2:00 AM
 * Chicago Time) and the invoice's own fee and player net loss, read from the
 * issued document by ca_club_data_union_weeks (20261114235606). The page's
 * totals above still count table activity by midnight Chicago days with their
 * own definitions; this block is the invoice, and says which is which.
 *
 * A refused read (an agent's downline view, a club in no union) prints
 * nothing. A failed or inexact read says so and never prints a figure.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { isAuthzError } from '../../utils/clubDashboard';
import { reportError } from '../../utils/errorReporter';
import { CLUB_DATA_ZONE_LABEL } from '../../lib/clubDataDay';
import {
  parseUnionWeeks,
  unionWeekLabel,
  unionWeeksBoundaryEnd,
  type UnionInvoiceWeeks,
} from '../../lib/clubDataUnionWeeks';
import styles from './ClubDataSimplePage.module.css';

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  clubId: string;
  /** First selected calendar day. */
  start: string;
  /** Last selected calendar day. */
  end: string;
}

export default function ClubDataUnionWeeks({ clubId, start, end }: Props) {
  const key = `${clubId}|${start}|${end}`;
  const [state, setState] = useState<{
    key: string;
    data: UnionInvoiceWeeks | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    let dead = false;
    void Promise.resolve(
      supabase.rpc('ca_club_data_union_weeks', {
        p_club_id: clubId,
        p_start: start,
        p_end: unionWeeksBoundaryEnd(end),
      })
    )
      .then(({ data, error }) => {
        if (dead) return;
        if (error) {
          if (!isAuthzError(error)) reportError(error, 'ClubDataUnionWeeks.read');
          setState({ key, data: null, failed: !isAuthzError(error) });
          return;
        }
        const parsed = parseUnionWeeks(data);
        setState({ key, data: parsed, failed: parsed === null });
      })
      .catch((err) => {
        if (dead) return;
        reportError(err, 'ClubDataUnionWeeks.read');
        setState({ key, data: null, failed: true });
      });
    return () => {
      dead = true;
    };
  }, [clubId, start, end, key]);

  if (!state || state.key !== key) return null;
  if (state.failed) {
    return (
      <p className={styles.liveLine} role="status">
        <span className={styles.inkLoss}>Union Invoice Figures Could Not Be Read.</span>
      </p>
    );
  }
  const weeks = state.data?.weeks ?? [];
  if (weeks.length === 0) return null;

  return (
    <section aria-label="Union Invoice Weeks">
      {weeks.map((week) => {
        const numbers = week.invoices
          .map((invoice) => invoice.invoice_number)
          .filter((n): n is string => !!n);
        return (
          <div key={week.period_start}>
            <p className={styles.liveLine}>
              Union Invoice Week {unionWeekLabel(week)} {CLUB_DATA_ZONE_LABEL}
              {numbers.length > 0 && numbers.length <= 2 ? ` - Invoice ${numbers.join(', ')}` : ''}
            </p>
            <dl className={styles.runningLine} aria-label="Invoice Fee">
              <dt>Invoice Fee</dt>
              <dd title={money(week.fee)}>{money(week.fee)}</dd>
            </dl>
            <dl className={styles.runningLine} aria-label="Invoice Player Net Loss">
              <dt>Invoice Player Net Loss</dt>
              <dd title={money(week.player_net_loss)}>{money(week.player_net_loss)}</dd>
            </dl>
            {week.cash_net_loss !== null && week.tournament_net_loss !== null && (
              <>
                <dl className={styles.runningLine} aria-label="Invoice Cash Player Net Loss">
                  <dt>Cash Player Net Loss</dt>
                  <dd>{money(week.cash_net_loss)}</dd>
                </dl>
                <dl className={styles.runningLine} aria-label="Invoice Tournament Player Net Loss">
                  <dt>Tournament Player Net Loss</dt>
                  <dd>{money(week.tournament_net_loss)}</dd>
                </dl>
              </>
            )}
          </div>
        );
      })}
      <p className={styles.liveLine}>
        Invoice Figures Are The Issued Union Invoice, 2:00 AM To 2:00 AM {CLUB_DATA_ZONE_LABEL}.
        Totals Above Count Table Activity By Midnight Days And Can Differ.
      </p>
    </section>
  );
}
