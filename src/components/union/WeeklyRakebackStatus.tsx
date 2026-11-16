/**
 * WEEKLY RAKEBACK STATUS (owner, 2026-11-15). One section on the Union
 * Statements page: where the current (or most recent) Monday payout stands,
 * stage by stage, and the week's statements. It reads
 * ca_union_weekly_rakeback_status (union owner / admin only, the same rule
 * as the statement board) and reads again once a minute ONLY while the
 * payout is in progress; otherwise it never polls. Styling is the Union
 * Statements page's own module, so colours and type match it exactly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { isAuthzError } from '../../utils/clubDashboard';
import { reportError } from '../../utils/errorReporter';
import { formatWalletChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import { chicagoDayLabel, chicagoInstantLabel } from '../../utils/unionStatementBoard';
import {
  elapsedLabel,
  parseWeeklyRakebackStatus,
  weeklyRakebackOverall,
  WEEKLY_RAKEBACK_REFRESH_MS,
  type RakebackStage,
  type RakebackStageState,
  type WeeklyRakebackOverall,
  type WeeklyRakebackStatus as Status,
} from '../../utils/weeklyRakebackStatus';
import { SpadeConsole, type ConsoleInk } from '../console/SpadeConsole';
import styles from '../../pages/UnionStatementsPage.module.css';

const STATE_WORD: Record<RakebackStageState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  not_finished: 'Not Finished Yet',
  not_checked: 'Not Checked Yet',
  done: 'Done',
  late: 'Late',
  failed: 'Failed',
};

const OVERALL_INK: Record<WeeklyRakebackOverall, ConsoleInk> = {
  Failed: 'red',
  Late: 'gold',
  Running: 'blue',
  Done: 'green',
  'Not Finished': 'silver',
  Waiting: 'silver',
};

function chips(n: number | null): string {
  return n === null ? '' : formatWalletChips(n);
}

function StateWord({ state }: { state: RakebackStageState }) {
  // .warn / .neg are declared before .pill in the page module, so they sit on
  // an inner span to keep their colour.
  const word = STATE_WORD[state];
  if (state === 'late')
    return (
      <span className={styles.pill}>
        <span className={styles.warn}>{word}</span>
      </span>
    );
  if (state === 'failed')
    return (
      <span className={styles.pill}>
        <span className={styles.neg}>{word}</span>
      </span>
    );
  const tone = state === 'done' ? styles.pillPaid : state === 'running' ? styles.pillOpen : '';
  return <span className={`${styles.pill} ${tone}`}>{word}</span>;
}

function StageRow({ stage }: { stage: RakebackStage }) {
  return (
    <div className={styles.clubRow} data-stage={stage.key} data-state={stage.state}>
      <div className={styles.clubMain}>
        <div className={styles.clubText}>
          <div className={styles.clubName}>{stage.label}</div>
          <div className={styles.clubMeta}>
            <StateWord state={stage.state} />
            {stage.detail && <span>{stage.detail}</span>}
            {stage.at && <span>{chicagoInstantLabel(stage.at)} Chicago Time</span>}
            {stage.state !== 'done' && stage.state !== 'waiting' && stage.scheduled_at && (
              <span>Scheduled {chicagoInstantLabel(stage.scheduled_at)} Chicago Time</span>
            )}
            {stage.state !== 'done' && stage.elapsed_seconds !== null && (
              <span>{elapsedLabel(stage.elapsed_seconds)} Elapsed</span>
            )}
            {stage.state !== 'done' &&
              stage.state !== 'failed' &&
              (stage.deadline_at ? (
                <span>
                  Deadline {chicagoInstantLabel(stage.deadline_at)} Chicago Time
                  {stage.deadline_source ? ` (${stage.deadline_source})` : ''}
                </span>
              ) : (
                <span>No Deadline Set</span>
              ))}
          </div>
        </div>
        {stage.amount !== null && (
          <div className={styles.clubAmount}>
            <div className={styles.amountValue}>{chips(stage.amount)}</div>
            <div className={styles.amountLabel}>Chips</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WeeklyRakebackStatus({ unionId }: { unionId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setLoading(true);
    let next: Status | null = null;
    try {
      const { data, error: rpcError } = await supabase.rpc('ca_union_weekly_rakeback_status', {
        p_union_id: unionId,
      });
      if (!alive.current) return;
      if (rpcError) {
        if (!isAuthzError(rpcError)) reportError(rpcError, 'WeeklyRakebackStatus.rpc');
        setError(
          isAuthzError(rpcError)
            ? 'You Do Not Have Access To This Union’s Rakeback Status.'
            : 'Weekly Rakeback Status Could Not Be Loaded.'
        );
      } else {
        next = parseWeeklyRakebackStatus(data);
        setStatus(next);
        setError(null);
      }
    } catch (caught) {
      if (!alive.current) return;
      reportError(caught, 'WeeklyRakebackStatus.parse');
      setError('Weekly Rakeback Status Could Not Be Loaded.');
    }
    setLoading(false);
    // Read again only while the payout is in progress, at most once a minute.
    if (next?.in_progress) {
      timer.current = setTimeout(() => void load(), WEEKLY_RAKEBACK_REFRESH_MS);
    }
  }, [unionId]);

  useEffect(() => {
    alive.current = true;
    setStatus(null);
    void load();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]);

  const overall = status ? weeklyRakebackOverall(status) : null;

  return (
    <SpadeConsole
      eyebrow="Union Finance"
      title="Weekly Rakeback Status"
      pill={loading && !status ? 'Loading' : error && !status ? 'Offline' : (overall ?? 'Waiting')}
      pillInk={
        loading && !status ? 'gold' : error && !status ? 'red' : OVERALL_INK[overall ?? 'Waiting']
      }
      crest="spade"
      family="spade"
      foot="foot"
      aria-busy={loading}
    >
      <section aria-label="Weekly Rakeback Status">
        {status && (
          <div className={styles.periodBar}>
            <div className={`sc-label sc-ink--blue ${styles.periodLabel}`}>
              Week Ending {chicagoDayLabel(status.period.end)}
            </div>
            <div className={`sc-ink--silver ${styles.unionName}`}>
              Accounting Period{' '}
              {status.period.label ??
                `${chicagoInstantLabel(status.period.start)} To ${chicagoInstantLabel(status.period.end)} (America/Chicago)`}
            </div>
            {status.scheduled_for && (
              <div className={`sc-ink--silver ${styles.unionName}`}>
                Payout Scheduled {chicagoInstantLabel(status.scheduled_for)} Chicago Time
              </div>
            )}
          </div>
        )}

        {error && (
          <div className={`${styles.state} ${styles.error}`} role="alert">
            <p>{error}</p>
            <button type="button" className={styles.linkBtn} onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {loading && !status && !error && (
          <div className={styles.state}>Loading Weekly Rakeback Status.</div>
        )}

        {status && (
          <div className={styles.list} aria-label="Payout Stages">
            {status.stages.map((stage) => (
              <StageRow key={stage.key} stage={stage} />
            ))}
          </div>
        )}

        {status && status.statements.length > 0 && (
          <section className={styles.houseSection} aria-label="Weekly Statements">
            <div className={`sc-label sc-ink--blue ${styles.sectionLabel}`}>Weekly Statements</div>
            <div className={styles.list}>
              {status.statements.map((s) => (
                <div
                  className={styles.clubRow}
                  key={s.number ?? s.club ?? ''}
                  data-statement={s.number ?? ''}
                >
                  <div className={styles.clubMain}>
                    <div className={styles.clubText}>
                      <div className={styles.clubName}>{titleCase(s.club ?? 'Unknown Club')}</div>
                      <div className={styles.clubMeta}>
                        {s.number && <span>{s.number}</span>}
                        {s.direction && <span>{titleCase(s.direction)}</span>}
                        {s.house ? (
                          <span>Union House Statement, Record Only</span>
                        ) : (
                          <span className={s.delivered ? styles.deliveredYes : styles.deliveredNo}>
                            {s.delivered ? 'Delivered' : 'Not Delivered'}
                          </span>
                        )}
                        {!s.house && (
                          <span
                            className={
                              s.matches_club_data === true
                                ? styles.deliveredYes
                                : s.matches_club_data === false
                                  ? styles.deliveredNo
                                  : undefined
                            }
                          >
                            {s.matches_club_data === true
                              ? 'Matches Club Data'
                              : s.matches_club_data === false
                                ? 'Differs From Club Data'
                                : 'Club Data Not Checked'}
                          </span>
                        )}
                        {s.credit_notes.map((c) => (
                          <span key={c.number ?? ''}>
                            Credit Note {c.number ?? ''} {chips(c.amount)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.clubAmount}>
                      <div className={styles.amountValue}>{chips(s.amount)}</div>
                      <div className={styles.amountLabel}>Chips</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {status && (
          <div className={styles.footNote}>
            Read {chicagoInstantLabel(status.generated_at)} Chicago Time.
            {status.in_progress
              ? ' The Payout Is In Progress, So This Refreshes Once A Minute.'
              : ' Nothing Is Running, So This Does Not Refresh On Its Own.'}
          </div>
        )}
      </section>
    </SpadeConsole>
  );
}
