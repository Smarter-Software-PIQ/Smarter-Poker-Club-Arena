import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Modal } from '../../components/common/Modal';
import { reportError } from '../../utils/errorReporter';
import { titleCase } from '../../utils/titleCase';
import styles from './ClubDataTotalsBreakdown.module.css';
import pageStyles from './ClubDataSimplePage.module.css';
import { figureDigits, formatWalletChips, type FigureInput } from '../../utils/format';
import {
  CLUB_DATA_ZONE_LABEL,
  clubDataDayBasis,
  clubDataWindowLabel,
  coverageNotices,
  coverageWindowLabel,
  type ClubDataCoverage,
  type ClubDataDayBasis,
} from '../../lib/clubDataDay';

export type TotalMetric = 'total_winnings' | 'mtt_winnings' | 'fee';
interface PlayerTotal {
  user_id: string;
  name: string;
  total_winnings: number;
  mtt_winnings: number;
  fee: number;
}
interface Breakdown {
  contract: string;
  club_id: string;
  range: { start: string; end: string };
  filters: { game: string; stakes: string; search: string | null };
  scope: string;
  players: PlayerTotal[];
  generated_at: string;
  /** Stage 2: the union basis states its basis and coverage here too. */
  accounting_basis?: string;
  day_basis?: string;
  accounting_coverage?: ClubDataCoverage | null;
}
interface Props {
  clubId: string;
  start: string;
  end: string;
  /** The day the screen's own answer counts (union clubs: 02:00 Chicago). */
  basis?: ClubDataDayBasis;
  game: string;
  stakes: string;
  search: string | null;
  metric: TotalMetric;
  onClose: () => void;
}
const LABELS = {
  total_winnings: 'Total Winnings',
  mtt_winnings: 'MTT Winnings',
  fee: 'Fees Generated',
};
/** Exact, digit for digit, never K/M (Dan 2026-11-13). */
const money = (value: FigureInput) => formatWalletChips(value);

/**
 * An exact decimal sum of reader figures, as decimal text. Each figure is
 * scaled to the longest fraction among them and added as an integer, so no
 * binary float rounding reaches a total (0.1 + 0.2 is 0.3, not
 * 0.30000000000000004), at any size.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function sumFigures(values: FigureInput[]): string {
  const parts = values.map((v) => figureDigits(v)).filter((d) => d !== null);
  const scale = parts.reduce((m, d) => Math.max(m, d.fraction.length), 0);
  let total = 0n;
  for (const d of parts) {
    const units = BigInt(d.whole + d.fraction.padEnd(scale, '0'));
    total += d.negative ? -units : units;
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** -1, 0 or 1 for a figure, read from its digits. */
function sign(value: FigureInput): number {
  const d = figureDigits(value);
  if (!d || !/[1-9]/.test(d.whole + d.fraction)) return 0;
  return d.negative ? -1 : 1;
}

export function validBreakdown(
  value: unknown,
  request: Omit<Props, 'metric' | 'onClose'>
): value is Breakdown {
  const v = value as Breakdown | null;
  return (
    !!v &&
    v.contract === 'ca_club_data_player_totals.v1' &&
    v.club_id === request.clubId &&
    v.range?.start === request.start &&
    v.range?.end === request.end &&
    v.filters?.game === request.game &&
    v.filters?.stakes === request.stakes &&
    v.filters?.search === request.search &&
    (v.scope === 'club' || v.scope === 'downline') &&
    Array.isArray(v.players) &&
    v.players.every(
      (p) =>
        typeof p.user_id === 'string' &&
        typeof p.name === 'string' &&
        [p.total_winnings, p.mtt_winnings, p.fee].every(
          (n) => typeof n === 'number' && Number.isFinite(n)
        )
    ) &&
    new Set(v.players.map((p) => p.user_id)).size === v.players.length
  );
}

export default function ClubDataTotalsBreakdown({
  clubId,
  start,
  end,
  basis = 'calendar',
  game,
  stakes,
  search,
  metric,
  onClose,
}: Props) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let dead = false;
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    const timer = window.setTimeout(() => {
      if (!dead) {
        setFailed(true);
        controller.abort();
      }
    }, 20000);
    void (async () => {
      try {
        const { data: result, error } = await supabase
          .rpc('ca_club_data_player_totals', {
            p_club_id: clubId,
            p_start: start,
            p_end: end,
            p_game: game,
            p_stakes: stakes,
            p_search: search,
          })
          .abortSignal(controller.signal);
        if (dead || controller.signal.aborted) return;
        if (error) throw error;
        if (!validBreakdown(result, { clubId, start, end, game, stakes, search }))
          throw new Error('Incomplete player totals');
        setData(result);
      } catch (error) {
        if (!dead) {
          reportError(error, 'ClubDataTotalsBreakdown.read');
          setFailed(true);
        }
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      dead = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [clubId, start, end, game, stakes, search, attempt]);
  const players = data?.players ?? [];
  const sorted = [...players]
    .filter((p) => `${p.name} ${p.user_id}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b[metric] - a[metric] || a.user_id.localeCompare(b.user_id));
  const wins = sumFigures(players.filter((p) => sign(p[metric]) > 0).map((p) => p[metric]));
  const losses = sumFigures(players.filter((p) => sign(p[metric]) < 0).map((p) => p[metric]));
  const net = sumFigures([wins, losses]);
  // The drilldown's own answer states its basis; the screen's is the fallback
  // while it loads.
  const answerBasis = data ? clubDataDayBasis(data) : basis;
  const unionBasis = answerBasis === 'accounting';
  const notices = coverageNotices(data?.accounting_coverage);
  const windowLabel =
    coverageWindowLabel(data?.accounting_coverage) ||
    clubDataWindowLabel(start, end, answerBasis) ||
    `${start} - ${end}`;
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={`${LABELS[metric]} By Player`}
      showCloseButton={false}
      className={`${styles.dialog} ${pageStyles.theme}`}
      size="large"
    >
      <header className={styles.header}>
        <h2>{LABELS[metric]} By Player</h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close Breakdown"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className={styles.body}>
        <p className={styles.range}>
          {windowLabel} {CLUB_DATA_ZONE_LABEL}
        </p>
        {notices.provisional && <p role="status">{notices.provisional}</p>}
        {notices.incomplete && (
          <p role="alert" className={styles.loss}>
            {notices.incomplete}
          </p>
        )}
        {metric === 'mtt_winnings' &&
          (unionBasis ? (
            <p>
              Union Invoice Basis: Finished MTTs Only. Prizes, Bounties And Refunds Less Buy-Ins,
              Rebuys And Add-Ons. An Entry In A Tournament Still Running At A Week Boundary Counts
              In The Week It Settles.
            </p>
          ) : (
            <p>Finished MTTs Only. Amounts Are Net Entries And Payouts.</p>
          ))}
        {metric === 'total_winnings' &&
          (unionBasis ? (
            <p>
              Union Invoice Basis: Cash Winnings (Each Cash Hand&apos;s Stack Change, Bad Beat
              Jackpot Awards Included) Plus Tournament Results (MTT Winnings, Sit And Go Results And
              Unfinished MTT Entries). Chips Still On The Felt Are Not Added.
            </p>
          ) : (
            <p>Net Results Include Cash, Tournaments And Chips Still On The Felt.</p>
          ))}
        {metric === 'fee' &&
          (unionBasis ? (
            <p>
              Union Invoice Basis: The Rake Credited For Each Player, Before Agent Shares And
              Adjustments.
            </p>
          ) : (
            <p>Fees Generated By Each Player, Before Agent Shares And Adjustments.</p>
          ))}
        {data?.scope === 'downline' && <p>You And Your Downline</p>}
        {failed ? (
          <div role="alert">
            <p>Player Totals Could Not Be Read.</p>
            <button
              type="button"
              className={styles.action}
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try Again
            </button>
          </div>
        ) : !data ? (
          <p role="status">Reading Player Totals</p>
        ) : (
          <>
            <dl className={styles.totals}>
              {metric !== 'fee' && (
                <>
                  <div>
                    <dt>Winning Players</dt>
                    <dd className={styles.win}>{money(wins)}</dd>
                  </div>
                  <div>
                    <dt>Losing Players</dt>
                    <dd className={styles.loss}>{money(losses)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>{metric === 'fee' ? 'Total Fees' : 'Net Total'}</dt>
                <dd className={sign(net) < 0 ? styles.loss : styles.value}>{money(net)}</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>
                  {players
                    .filter((p) => p.user_id !== '00000000-0000-0000-0000-000000000000')
                    .length.toLocaleString('en-US')}
                </dd>
              </div>
            </dl>
            <label className={styles.search}>
              Find Player
              <input
                type="search"
                aria-label="Find Player In Breakdown"
                placeholder="Search Player Or ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className={styles.tableScroll}>
              <table>
                <caption>{LABELS[metric]} By Player</caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">{LABELS[metric]}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.user_id}>
                      <th scope="row" title={p.user_id}>
                        {titleCase(p.name)}
                      </th>
                      <td
                        className={
                          sign(p[metric]) < 0
                            ? styles.loss
                            : metric !== 'fee' && sign(p[metric]) > 0
                              ? styles.win
                              : styles.value
                        }
                      >
                        {money(p[metric])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length === 0 && <p>No Players In This Selection.</p>}
            <p>All Player Totals Are Included. Search Only Filters The List. Amounts Are Exact.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
