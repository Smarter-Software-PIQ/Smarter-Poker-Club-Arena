/**
 * UNION TREASURY LOG (Dan 2026-11-02)
 *
 * "INSIDE THE UNION WALLETS, UNION BANK, RAKE TREASURY, BACK UP BBJ WALLET,
 *  PROMO WALLET AND SPINS TREASURY, SHOULD BE A TRANSACTION LOG OF ANY OUTS,
 *  AND A ONE TIME DAILY "INS" WHERE IT GIVES THE DAILY TOTALS COLLECTED."
 *
 * Reads fn_union_treasury_log (migration 20261102063939). Every out is its own
 * row. Routine collection (rake, jackpot drops, spin entries, the jackpot
 * promo sweep) arrives as ONE "Daily Total Collected" row per
 * Chicago day, with its breakdown. One-off credits (transfers, settlements,
 * seeds, overlay returns) are listed individually because they are decisions, not collection.
 * Today's collection is still running, so it is shown as a live figure at the
 * top instead of a row; its row appears once the day closes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { reportError } from '../../utils/errorReporter';
import { fmt } from '../../utils/format';
import { chipCents, exactChipFigure } from '../../utils/cashierAmount';
import { enumToTitleCase, titleCase } from '../../utils/titleCase';
import { downloadCsv, toCsv } from '../../utils/downloadCsv';
import { WalletDeskHeading, WalletDeskRow } from '../wallet/WalletDesk';
import '../wallet/WalletDesk.css';

export type TreasuryLogWallet =
  | 'union_bank'
  | 'rake_treasury'
  | 'backup_bbj'
  | 'main_bbj'
  | 'promo'
  | 'spins_treasury';

type Kind = 'all' | 'ins' | 'outs';

interface LogRow {
  id: number;
  entry_kind: 'out' | 'in' | 'daily_in';
  occurred_at: string;
  log_day: string;
  amount: number;
  category: string | null;
  entries: number;
  breakdown: Record<string, { amount: number; entries: number }> | null;
  counterparty_type: string | null;
  counterparty_name: string | null;
  performed_by_name: string | null;
  description: string | null;
  balance_after: number | null;
  club_name: string | null;
}

interface Summary {
  today_in: { amount: number; entries: number; as_of: string } | null;
  today_out: number;
  today_out_count: number;
  week_in: number;
  week_out: number;
  week_complete?: boolean;
  month_complete?: boolean;
  month_in: number;
  month_out: number;
}

interface LogResponse {
  authorized: boolean;
  error?: string;
  rows?: LogRow[];
  has_more?: boolean;
  summary?: Summary;
  out_categories?: string[];
  history?: History;
}

/** How much history is closed and listed (20261102083808). */
interface History {
  complete_from: string;
  closed_through: string;
  filling: boolean;
  logged_since: string;
}

const EXPORT_PAGE = 5000;

/** House names for the categories a treasury actually sees. */
const CATEGORY_NAMES: Record<string, string> = {
  rake: 'Rake',
  bbj_contribution: 'Jackpot Drops',
  spin_entry: 'Spin Entries',
  spin_prize: 'Spin Prize',
  promo: 'Jackpot Promo Sweep',
  reversal: 'Overlay Returned',
  overlay: 'Tournament Overlay',
  rakeback: 'Rakeback',
  treasury_transfer: 'Treasury Transfer',
  union_settlement: 'Club Settlement',
  union_send: 'Sent To Club',
  settlement: 'Settlement',
  transfer: 'Transfer',
  bbj_payout: 'Jackpot Payout',
  wheel_prize: 'Diamond Wheel Prize',
  crash_prize: 'Crash Prize',
  crossing_prize: 'Donkey Cross Prize',
  plinko_prize: 'Plinko Prize',
  mines_prize: 'Mines Prize',
  leaderboard_payout: 'Leaderboard Payout',
  promo_send: 'Promo Sent',
  burn: 'Chips Retired',
};

function categoryName(c: string | null | undefined): string {
  if (!c) return 'Movement';
  return CATEGORY_NAMES[c] ?? enumToTitleCase(c);
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

function dayName(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

function counterparty(r: LogRow): string {
  if (r.counterparty_name) return titleCase(r.counterparty_name);
  if (r.counterparty_type === 'prize_liability') return 'Prize Pool';
  if (r.counterparty_type === 'table_stack') return 'Table';
  if (r.counterparty_type) return enumToTitleCase(r.counterparty_type);
  return '';
}

export function UnionTreasuryLog({
  unionId,
  wallet,
  walletLabel,
}: {
  unionId: string;
  wallet: TreasuryLogWallet;
  walletLabel: string;
}) {
  const [kind, setKind] = useState<Kind>('all');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Search fires after typing pauses, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (after: LogRow | null) => {
      if (!unionId) return;
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc('fn_union_treasury_log', {
          p_union_id: unionId,
          p_wallet: wallet,
          p_kind: kind,
          p_before: after ? after.occurred_at : null,
          p_before_id: after ? after.id : null,
          p_limit: 50,
          p_category: category || null,
          p_search: query || null,
        });
        if (mine !== seq.current) return;
        if (rpcError) throw rpcError;
        const res = (data || {}) as LogResponse;
        if (!res.authorized) {
          setError(res.error ? titleCase(res.error) : 'This Log Is Not Available To You.');
          setRows([]);
          return;
        }
        const page = res.rows || [];
        setRows((prev) => (after ? [...prev, ...page] : page));
        setHasMore(Boolean(res.has_more));
        if (!after) {
          setSummary(res.summary ?? null);
          setHistory(res.history ?? null);
          setCats(res.out_categories || []);
        }
      } catch (e) {
        if (mine !== seq.current) return;
        reportError(e, 'UnionTreasuryLog.load');
        setError('Could Not Load The Transaction Log.');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [unionId, wallet, kind, category, query]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  /* Exports the WHOLE log for the current view, not just the rows on screen:
     it pages through the same RPC, 5,000 rows a call, until there is no more. */
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: LogRow[] = [];
      let after: LogRow | null = null;
      for (;;) {
        const { data, error: rpcError } = await supabase.rpc('fn_union_treasury_log', {
          p_union_id: unionId,
          p_wallet: wallet,
          p_kind: kind,
          p_before: after ? after.occurred_at : null,
          p_before_id: after ? after.id : null,
          p_limit: EXPORT_PAGE,
          p_category: category || null,
          p_search: query || null,
        });
        if (rpcError) throw rpcError;
        const res = (data || {}) as LogResponse;
        if (!res.authorized) throw new Error(res.error || 'Not Authorized');
        const page = res.rows || [];
        all.push(...page);
        if (!res.has_more || page.length === 0) break;
        after = page[page.length - 1];
      }
      const header = [
        'Date',
        'Type',
        'Category',
        'Amount',
        'Entries',
        'Counterparty',
        'Club',
        'By',
        balanceLabel,
        'Notes',
      ];
      const body = all.map((r) => [
        r.entry_kind === 'daily_in' ? r.log_day : r.occurred_at,
        r.entry_kind === 'out' ? 'Out' : r.entry_kind === 'daily_in' ? 'Daily In' : 'In',
        r.entry_kind === 'daily_in' ? 'Daily Total Collected' : categoryName(r.category),
        r.entry_kind === 'out' ? -Number(r.amount) : Number(r.amount),
        r.entries,
        counterparty(r),
        r.club_name ?? '',
        r.performed_by_name ?? '',
        r.balance_after ?? '',
        r.description ?? '',
      ]);
      downloadCsv(`${walletLabel.replace(/\s+/g, '-').toLowerCase()}-log.csv`, toCsv(header, body));
    } catch (e) {
      reportError(e, 'UnionTreasuryLog.export');
      setError('Could Not Export The Transaction Log.');
    } finally {
      setExporting(false);
    }
  };

  /* What "balance" on a row means (verified 2026-11-02). Promo and the jackpot
     banks carry the wallet's own balance at that moment. A Spins row carries
     the live spin pool's balance, which excludes the idle reserve, so it is
     named for what it is. Union Bank and Rake rows carry none: the ledger does
     not record one, and the screen does not guess. Daily rows are totals. */
  const balanceLabel = wallet === 'spins_treasury' ? 'Spin Pool Balance After' : 'Balance After';

  const todayIn = Number(summary?.today_in?.amount ?? 0);

  return (
    <section aria-label={`${walletLabel} Transaction Log`}>
      <WalletDeskHeading title="Transaction Log" meta={walletLabel} />
      {history && (
        <p className="wdesk__empty" role="status">
          {history.filling
            ? `History Complete From ${dayName(history.complete_from)}. Earlier History Is Still Filling In.`
            : `History Complete From ${dayName(history.complete_from)}.`}
        </p>
      )}

      {summary && (
        <div className="wdesk__list">
          <WalletDeskRow
            name="Today So Far"
            sub={
              <>
                <span className="wdesk__in">{`In +${exactChipFigure(todayIn)}`}</span>
                <span className="wdesk__sep">{`${fmt(Number(summary.today_in?.entries ?? 0))} Entries`}</span>
                <span className="wdesk__sep wdesk__out">{`Out -${exactChipFigure(Number(summary.today_out))}`}</span>
                <span className="wdesk__sep">{`${fmt(Number(summary.today_out_count))} Outs`}</span>
              </>
            }
            figure={exactChipFigure(chipCents(todayIn - Number(summary.today_out)))}
          />
          <WalletDeskRow
            name={
              summary.week_complete === false && history
                ? `Since ${dayName(history.complete_from)}`
                : 'Last 7 Days'
            }
            sub={
              <>
                <span className="wdesk__in">{`In +${exactChipFigure(Number(summary.week_in))}`}</span>
                <span className="wdesk__sep wdesk__out">{`Out -${exactChipFigure(Number(summary.week_out))}`}</span>
              </>
            }
            figure={exactChipFigure(chipCents(Number(summary.week_in) - Number(summary.week_out)))}
          />
          <WalletDeskRow
            name={
              summary.month_complete === false && history
                ? `Since ${dayName(history.complete_from)}`
                : 'Last 30 Days'
            }
            sub={
              <>
                <span className="wdesk__in">{`In +${exactChipFigure(Number(summary.month_in))}`}</span>
                <span className="wdesk__sep wdesk__out">{`Out -${exactChipFigure(Number(summary.month_out))}`}</span>
              </>
            }
            figure={exactChipFigure(
              chipCents(Number(summary.month_in) - Number(summary.month_out))
            )}
          />
        </div>
      )}

      <div className="wdesk__words" role="group" aria-label="Show">
        {(['all', 'ins', 'outs'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            className="wdesk__word"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              if (k === 'ins') setCategory('');
            }}
          >
            {k === 'all' ? 'All' : k === 'ins' ? 'Ins' : 'Outs'}
          </button>
        ))}
        <button
          type="button"
          className="wdesk__word"
          onClick={() => void exportCsv()}
          disabled={rows.length === 0 || exporting}
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {kind !== 'ins' && cats.length > 1 && (
        <div className="wdesk__words" role="group" aria-label="Out Type">
          <button
            type="button"
            className="wdesk__word"
            aria-pressed={category === ''}
            onClick={() => setCategory('')}
          >
            Every Out
          </button>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              className="wdesk__word"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {categoryName(c)}
            </button>
          ))}
        </div>
      )}

      <label className="wdesk__search">
        <input
          placeholder="Search Player, Club Or Note"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search The Transaction Log"
        />
      </label>

      <div className="wdesk__list">
        {error && (
          <div className="wdesk__empty wdesk__empty--bad" role="alert">
            {error}
          </div>
        )}
        {!error &&
          rows.map((r) => {
            if (r.entry_kind === 'daily_in') {
              const parts = Object.entries(r.breakdown || {})
                .sort((a, b) => Number(b[1].amount) - Number(a[1].amount))
                .map(([c, v]) => `${categoryName(c)} ${exactChipFigure(Number(v.amount))}`);
              return (
                <WalletDeskRow
                  key={`d${r.id}`}
                  name={`Daily Total Collected · ${dayName(r.log_day)}`}
                  sub={
                    <>
                      <span>{`${fmt(r.entries)} Collections`}</span>
                      {parts.length > 0 && <span className="wdesk__sep">{parts.join(', ')}</span>}
                    </>
                  }
                  figure={
                    <span className="wdesk__in">{`+${exactChipFigure(Number(r.amount))}`}</span>
                  }
                />
              );
            }
            const inbound = r.entry_kind === 'in';
            const other = counterparty(r);
            return (
              <WalletDeskRow
                key={`r${r.id}`}
                name={categoryName(r.category)}
                sub={
                  <>
                    <span>{when(r.occurred_at)}</span>
                    {other && (
                      <span className="wdesk__sep">
                        {inbound ? `From ${other}` : `To ${other}`}
                      </span>
                    )}
                    {r.club_name && <span className="wdesk__sep">{titleCase(r.club_name)}</span>}
                    {r.performed_by_name && (
                      <span className="wdesk__sep">{`By ${titleCase(r.performed_by_name)}`}</span>
                    )}
                    {r.description && (
                      <span className="wdesk__sep">{titleCase(r.description)}</span>
                    )}
                    {r.balance_after != null && (
                      <span className="wdesk__sep">{`${balanceLabel} ${exactChipFigure(Number(r.balance_after))}`}</span>
                    )}
                  </>
                }
                figure={
                  <span className={inbound ? 'wdesk__in' : 'wdesk__out'}>
                    {`${inbound ? '+' : '-'}${exactChipFigure(Number(r.amount))}`}
                  </span>
                }
              />
            );
          })}
        {!error && !loading && rows.length === 0 && (
          <div className="wdesk__empty">Nothing Logged For This View Yet.</div>
        )}
        {loading && <div className="wdesk__empty">Loading Log</div>}
        {!error && hasMore && !loading && (
          <button
            type="button"
            className="wdesk__more"
            onClick={() => void load(rows[rows.length - 1] ?? null)}
            aria-label="Load More Log Entries"
          >
            Load More
          </button>
        )}
      </div>
    </section>
  );
}

export default UnionTreasuryLog;
