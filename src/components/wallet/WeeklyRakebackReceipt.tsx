/**
 * WEEKLY RAKEBACK RECEIPT (owner, 2026-10-31: "weekly receipts in Transaction
 * History"). A weekly rakeback or agent commission leg of the player's own chip
 * statement opens its receipt: the club, the accounting week, the rake the
 * player generated, the recorded rate and the amount paid. The receipt is read
 * by fn_my_weekly_rakeback_receipt, which answers only for a posted leg of the
 * caller's own wallet and writes nothing.
 */
import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { compactChips } from '../../utils/format';
import { reportError } from '../../utils/errorReporter';

export const WEEKLY_RECEIPT_CATEGORIES = new Set(['rakeback', 'commission']);

export interface WeeklyReceipt {
  available: boolean;
  kind?: 'rakeback' | 'commission';
  direction?: 'in' | 'out';
  club_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  rake_generated?: number | null;
  rate_pct?: number | null;
  own_commission?: number | null;
  role?: string | null;
  pass_through?: boolean | null;
  amount?: number;
  paid_at?: string;
}

const day = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Chicago',
      });
};

/** An accounting week runs Monday to Monday at its boundary hour; the receipt
 * names Monday through Sunday, the seven days the player actually played. */
export function receiptWeek(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const first = new Date(start).getTime();
  if (Number.isNaN(first)) return '';
  const last = new Date(first + 6 * 24 * 60 * 60 * 1000).toISOString();
  return `${day(start)} - ${day(last)}`;
}

const roleLabel = (role?: string | null) =>
  role ? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';

export function WeeklyRakebackReceipt({ ledgerId }: { ledgerId: string }) {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<WeeklyReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next || receipt || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('fn_my_weekly_rakeback_receipt', {
        p_ledger_id: ledgerId,
      });
      if (rpcError) throw rpcError;
      setReceipt((data ?? { available: false }) as WeeklyReceipt);
    } catch (err) {
      reportError(err, 'WeeklyRakebackReceipt.load');
      setError('Receipt Unavailable Right Now. Try Again.');
    } finally {
      setLoading(false);
    }
  }, [open, receipt, loading, ledgerId]);

  return (
    <div className="chip-statement__receipt">
      <button
        type="button"
        className="chip-statement__receipt-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? 'Hide Weekly Receipt' : 'Weekly Receipt'}
      </button>
      {open && (
        <div className="chip-statement__receipt-body" role="region" aria-label="Weekly Receipt">
          {loading && <span>Loading Receipt...</span>}
          {error && (
            <span className="sc-ink--red" role="alert">
              {error}
            </span>
          )}
          {receipt && !receipt.available && <span>No Weekly Receipt For This Movement.</span>}
          {receipt?.available && (
            <dl>
              <dt>Club</dt>
              <dd>{receipt.club_name || 'Club'}</dd>
              <dt>Week</dt>
              <dd>{receiptWeek(receipt.period_start, receipt.period_end)}</dd>
              {receipt.kind === 'rakeback' && (
                <>
                  <dt>Rake You Generated</dt>
                  <dd>{compactChips(Number(receipt.rake_generated ?? 0))}</dd>
                  <dt>Rakeback Rate</dt>
                  <dd>{Number(receipt.rate_pct ?? 0)}%</dd>
                </>
              )}
              {receipt.kind === 'commission' && (
                <>
                  <dt>Role</dt>
                  <dd>{roleLabel(receipt.role)}</dd>
                  {receipt.own_commission != null && !receipt.pass_through && (
                    <>
                      <dt>Your Own Commission</dt>
                      <dd>{compactChips(Number(receipt.own_commission))}</dd>
                    </>
                  )}
                </>
              )}
              <dt>{receipt.direction === 'out' ? 'Passed On' : 'Paid To You'}</dt>
              <dd>{compactChips(Number(receipt.amount ?? 0))}</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export default WeeklyRakebackReceipt;
