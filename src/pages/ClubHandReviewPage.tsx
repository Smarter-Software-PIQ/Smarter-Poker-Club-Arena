import { usePlayerPreference } from '../hooks/usePlayerPreference';
/**
 * HAND REVIEW
 *
 * The queue is available to club staff. Opening every seat's holding is a
 * separate owner or admin read, and the database records every one in the
 * audit trail. The client gate is presentation only; Postgres is authoritative.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArenaState } from '../components/ops/ArenaOps';
import ClubIntegrityHeader from '../components/club/ClubIntegrityHeader';
import { useToast } from '../components/common/Toast';
import { ClubPageSection as SpadeConsole } from '../components/club/ClubPageSection';
import HandDetailView from '../components/handdetail/HandDetailView';
import { useAuthUser } from '../hooks/useAuthUser';
import { useClubNavigationAccess } from '../hooks/useClubNavigationAccess';
import {
  handFlagService,
  FLAG_STATUS_LABEL,
  GODMODE_REASON_MIN,
  type HandFlag,
  type HandFlagStatus,
  type OperatorHandRead,
} from '../services/HandFlagService';
import { resolveClubUUIDStrict } from '../utils/clubIdResolver';
import { reportError } from '../utils/errorReporter';
import { buildReplay, replayInputFromRow, type ReplayModel } from '../utils/handReplay';
import { titleCase } from '../utils/titleCase';
import './ClubHandReviewPage.css';

type QueueFilter = HandFlagStatus | 'all';
type PageState = 'loading' | 'ready' | 'denied' | 'notFound' | 'error';

interface HandReviewScope {
  scopeKey: string;
  clubUuid: string;
}

interface ScopedHandRead {
  scopeKey: string;
  requestId: number;
  value: OperatorHandRead;
}

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

function when(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? titleCase(date.toLocaleString()) : '';
}

function HandReviewState({
  title,
  message,
  tone = 'empty',
  action,
}: {
  title: string;
  message: string;
  tone?: 'loading' | 'error' | 'empty';
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="chr-page arena-workspace" data-arena-surface="club">
      <section className="chr-state-wrap">
        <section className="arena-case arena-ops-case">
          <ArenaState
            tone={tone}
            title={title}
            message={message}
            actions={
              action ? (
                <button type="button" onClick={action.onClick}>
                  {action.label}
                </button>
              ) : undefined
            }
          />
        </section>
      </section>
    </div>
  );
}

export default function ClubHandReviewPage() {
  const { clubId: clubParam } = useParams<{ clubId: string }>();
  const { user } = useAuthUser();
  const toast = useToast();
  const access = useClubNavigationAccess(clubParam ?? '');
  const scopeKey = `${clubParam ?? ''}:${user?.id ?? 'signed-out'}`;
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  const [resolvedScope, setResolvedScope] = useState<HandReviewScope | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const [flags, setFlags] = useState<HandFlag[]>([]);
  const [filter, setFilter] = usePlayerPreference<QueueFilter>('ClubHandReviewPage:filter', 'open');
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [handNumber, setHandNumber] = useState('');
  const [reason, setReason] = useState('');
  const [opening, setOpening] = useState(false);
  const [read, setRead] = useState<ScopedHandRead | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const resolveRequestRef = useRef(0);
  const queueRequestRef = useRef(0);
  const openRequestRef = useRef(0);
  const decisionRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    document.title = 'Hand Review | Smarter Poker';
    return () => {
      mountedRef.current = false;
      resolveRequestRef.current += 1;
      queueRequestRef.current += 1;
      openRequestRef.current += 1;
      decisionRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = ++resolveRequestRef.current;
    queueRequestRef.current += 1;
    openRequestRef.current += 1;
    decisionRequestRef.current += 1;
    setResolvedScope(null);
    setState('loading');
    setFlags([]);
    setBusyFlag(null);
    setReplyDraft({});
    setHandNumber('');
    setReason('');
    setOpening(false);
    setRead(null);
    setReadError(null);

    if (!clubParam) {
      setState('notFound');
      return;
    }

    const requestedScopeKey = scopeKey;
    const isCurrent = () =>
      mountedRef.current &&
      requestId === resolveRequestRef.current &&
      requestedScopeKey === currentScopeKeyRef.current;

    void (async () => {
      try {
        const clubUuid = await resolveClubUUIDStrict(clubParam);
        if (!isCurrent()) return;
        setResolvedScope({ scopeKey: requestedScopeKey, clubUuid });
      } catch (error) {
        if (!isCurrent()) return;
        reportError(error, 'ClubHandReviewPage.resolveClub');
        setState('notFound');
      }
    })();
  }, [clubParam, scopeKey]);

  const loadQueue = useCallback(
    async (which: QueueFilter) => {
      const scope = resolvedScope;
      if (!scope || scope.scopeKey !== currentScopeKeyRef.current) return;
      const requestId = ++queueRequestRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        requestId === queueRequestRef.current &&
        scope.scopeKey === currentScopeKeyRef.current;

      setFlags([]);
      setState('loading');
      try {
        const result = await handFlagService.clubQueue(scope.clubUuid, which);
        if (!isCurrent()) return;
        if (result.denied) {
          setState('denied');
          return;
        }
        if (!result.ok) {
          setState('error');
          return;
        }
        if (result.flags.some((flag) => flag.clubId && flag.clubId !== scope.clubUuid)) {
          reportError(
            new Error('Hand review queue returned a row outside the requested club'),
            'ClubHandReviewPage.queueScopeMismatch'
          );
          setState('error');
          return;
        }
        setFlags(result.flags);
        setState('ready');
      } catch (error) {
        if (!isCurrent()) return;
        reportError(error, 'ClubHandReviewPage.loadQueue');
        setState('error');
      }
    },
    [resolvedScope]
  );

  useEffect(() => {
    if (!resolvedScope || resolvedScope.scopeKey !== scopeKey || access.loading) return;
    if (!access.isClubStaff) {
      setFlags([]);
      setState('denied');
      return;
    }
    void loadQueue(filter);
  }, [access.isClubStaff, access.loading, filter, loadQueue, resolvedScope, scopeKey]);

  const openHand = useCallback(
    async (numberText: string, why: string) => {
      const scope = resolvedScope;
      if (!scope || scope.scopeKey !== currentScopeKeyRef.current) return;
      const hand = Number(String(numberText).replace(/[^0-9]/g, ''));
      if (!Number.isFinite(hand) || hand <= 0) {
        setReadError('Enter The Hand Number');
        return;
      }

      const requestId = ++openRequestRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        requestId === openRequestRef.current &&
        scope.scopeKey === currentScopeKeyRef.current;
      setOpening(true);
      setRead(null);
      setReadError(null);
      try {
        const result = await handFlagService.openHand(scope.clubUuid, hand, why);
        if (!isCurrent()) return;
        setOpening(false);
        if (!result.ok || !result.read) {
          setReadError(titleCase(result.error ?? 'Could Not Open That Hand'));
          return;
        }
        setRead({ scopeKey: scope.scopeKey, requestId, value: result.read });
        /* Said out loud every time because the reader is about to see cards
           nobody at the table saw. */
        toast.info('This Read Was Logged To The Club Audit Trail');
      } catch (error) {
        if (!isCurrent()) return;
        setOpening(false);
        setReadError('Could Not Open That Hand');
        reportError(error, 'ClubHandReviewPage.openHand');
      }
    },
    [resolvedScope, toast]
  );

  const activeRead = read?.scopeKey === scopeKey ? read.value : null;
  const model: ReplayModel | null = useMemo(() => {
    if (!activeRead) return null;
    try {
      return buildReplay(
        replayInputFromRow(activeRead.row as never, {
          privateHoleCards: activeRead.allHoleCards as never,
        })
      );
    } catch (error) {
      reportError(error, 'ClubHandReviewPage.buildReplay');
      return null;
    }
  }, [activeRead]);

  const resolveFlag = useCallback(
    async (flag: HandFlag, status: HandFlagStatus) => {
      const scope = resolvedScope;
      if (
        !scope ||
        scope.scopeKey !== currentScopeKeyRef.current ||
        busyFlag ||
        !flags.some((current) => current.id === flag.id) ||
        (flag.clubId && flag.clubId !== scope.clubUuid)
      ) {
        return;
      }
      const note = (replyDraft[flag.id] ?? '').trim();
      if ((status === 'resolved' || status === 'dismissed') && !note) {
        toast.error('Closing A Flag Needs A Note The Player Can Read');
        return;
      }

      const requestId = ++decisionRequestRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        requestId === decisionRequestRef.current &&
        scope.scopeKey === currentScopeKeyRef.current;
      setBusyFlag(flag.id);
      try {
        const result = await handFlagService.resolve(flag.id, status, note || undefined);
        if (!isCurrent()) return;
        setBusyFlag(null);
        if (!result.ok || (result.flag?.clubId && result.flag.clubId !== scope.clubUuid)) {
          toast.error(titleCase(result.error ?? 'Could Not Update That Flag'));
          return;
        }
        toast.success(`Flag Marked ${FLAG_STATUS_LABEL[status]}`);
        setReplyDraft((previous) => ({ ...previous, [flag.id]: '' }));
        void loadQueue(filter);
      } catch (error) {
        if (!isCurrent()) return;
        setBusyFlag(null);
        toast.error('Could Not Update That Flag');
        reportError(error, 'ClubHandReviewPage.resolveFlag');
      }
    },
    [busyFlag, filter, flags, loadQueue, replyDraft, resolvedScope, toast]
  );

  const scopeReady = resolvedScope?.scopeKey === scopeKey;
  const openCount = flags.filter(
    (flag) => flag.status === 'open' || flag.status === 'under_review'
  ).length;

  if (state === 'notFound') {
    return (
      <HandReviewState
        title="Club Not Found"
        message="That Club Could Not Be Found."
        tone="error"
      />
    );
  }

  if (!scopeReady || state === 'loading' || access.loading) {
    return (
      <HandReviewState
        title="Loading Hand Review"
        message="Confirming The Current Club, Operator Access And Flagged Hand Queue."
        tone="loading"
      />
    );
  }

  if (access.error || state === 'error') {
    return (
      <HandReviewState
        title="Queue Unavailable"
        message="The Current Club Queue Could Not Be Loaded. No Case Data Was Changed."
        tone="error"
        action={{
          label: 'Retry Queue',
          onClick: () => {
            if (access.error) access.reload();
            else void loadQueue(filter);
          },
        }}
      />
    );
  }

  if (state === 'denied' || !access.isClubStaff) {
    return (
      <HandReviewState
        title="Operator Access Required"
        message="Hand Review Is For Club Operators."
        tone="empty"
      />
    );
  }

  return (
    <div className="chr-page arena-workspace" data-arena-surface="club">
      <ClubIntegrityHeader
        clubId={clubParam}
        active="hand-review"
        title="Hand Review"
        description="Hands Your Players Flagged, And The Audited Lookup That Opens Any Hand Dealt At This Club."
        metrics={[
          { label: 'Waiting', value: openCount },
          { label: 'Listed', value: flags.length },
        ]}
      />

      <section className="chr-workspace">
        {access.canControlClub ? (
          <SpadeConsole
            arena
            className="chr-lookup"
            title="Open A Hand"
            pill="Logged"
            plates={{
              secondary: {
                label: 'Clear Lookup',
                disabled: opening || (!handNumber && !reason && !readError),
                onClick: () => {
                  openRequestRef.current += 1;
                  setOpening(false);
                  setHandNumber('');
                  setReason('');
                  setRead(null);
                  setReadError(null);
                },
              },
              primary: {
                label: opening ? 'Opening Hand' : 'Open Hand',
                disabled:
                  opening || reason.trim().length < GODMODE_REASON_MIN || !handNumber.trim(),
                onClick: () => void openHand(handNumber, reason),
              },
            }}
            aria-label="Open A Hand"
          >
            <p className="chr-lookup__warn">
              Shows All Hole Cards, Including Folded And Mucked Hands. The Reader, The Hand And The
              Reason Are Written To The Club Audit Trail.
            </p>
            <div className="chr-lookup__form">
              <label>
                <span className="chr-field-label">Hand Number</span>
                <input
                  className="chr-lookup__number arena-ops-well"
                  type="text"
                  inputMode="numeric"
                  value={handNumber}
                  placeholder="Hand Number"
                  aria-label="Hand Number"
                  onChange={(event) => setHandNumber(event.target.value)}
                />
              </label>
              <label>
                <span className="chr-field-label">Audit Reason</span>
                <input
                  className="chr-lookup__reason arena-ops-well"
                  type="text"
                  value={reason}
                  placeholder="Why Is This Hand Being Opened?"
                  aria-label="Why This Hand Is Being Opened"
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </div>
            {readError && (
              <p className="chr-lookup__error" role="status">
                {titleCase(readError)}
              </p>
            )}
          </SpadeConsole>
        ) : (
          <SpadeConsole arena className="chr-lookup" title="Hand Lookup Locked" pill="Protected">
            <p className="chr-lookup__warn">
              Opening A Hand Shows All Hole Cards, And Is For A Club Owner Or Admin.
            </p>
          </SpadeConsole>
        )}

        {activeRead && model && (
          <SpadeConsole
            arena
            className="chr-hand"
            title={`Hand ${String(activeRead.row.hand_number ?? '')}`}
            pill={activeRead.cardsComplete ? 'Complete' : 'Partial'}
            plates={{ primary: { label: 'Close Hand', onClick: () => setRead(null) } }}
            aria-label="The Opened Hand"
          >
            <div className="chr-hand__bar">
              <span className="chr-hand__cards">
                {activeRead.cardsComplete
                  ? `All ${activeRead.seatsDealt} Holdings On Record`
                  : `${activeRead.seatsWithCards} Of ${activeRead.seatsDealt} Holdings On Record`}
              </span>
            </div>
            {!activeRead.cardsComplete && (
              <p className="chr-hand__short">
                The Seats Without Cards Below Are Not Empty Hands. Their Holdings Are No Longer On
                Record.
              </p>
            )}
            <HandDetailView model={model} currentUserId={null} badge="Operator View" />
          </SpadeConsole>
        )}

        {activeRead && !model && (
          <SpadeConsole arena className="chr-hand" title="Replay Unavailable" pill="Protected">
            <ArenaState
              tone="error"
              title="The Hand Was Read And Logged, But Its Replay Could Not Be Built."
            />
          </SpadeConsole>
        )}

        <SpadeConsole
          arena
          className="chr-queue"
          eyebrow="Player Signals"
          title="Flagged Hands"
          pill={`${flags.length} Listed`}
        >
          <div
            className="chr-filters arena-switch arena-ops-keys"
            role="group"
            aria-label="Filter Flagged Hands"
          >
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {flags.length === 0 ? (
            <ArenaState
              tone="empty"
              title={filter === 'open' ? 'Queue Clear' : 'No Matches'}
              message={
                filter === 'open'
                  ? 'No Hands Are Waiting On You.'
                  : 'No Flagged Hands Match That Filter.'
              }
            />
          ) : (
            <ul className="chr-list">
              {flags.map((flag) => (
                <li key={flag.id} className={`chr-flag arena-ledger-row is-${flag.status}`}>
                  <div className="chr-flag__head">
                    <span className="chr-flag__num">
                      Hand {flag.handNumber ?? '?'}
                      {flag.tableName ? ` / ${titleCase(flag.tableName)}` : ''}
                    </span>
                    <span className={`chr-flag__status is-${flag.status}`}>
                      {FLAG_STATUS_LABEL[flag.status]}
                    </span>
                  </div>
                  <p className="chr-flag__note">{titleCase(flag.note)}</p>
                  <div className="chr-flag__meta">
                    <span>Filed {when(flag.createdAt)}</span>
                    {flag.reviewedAt && <span>Answered {when(flag.reviewedAt)}</span>}
                  </div>

                  {flag.operatorNote && (
                    <div className="chr-flag__reply">
                      <span className="chr-flag__reply-label">Sent To The Player</span>
                      <p className="chr-flag__reply-body">{titleCase(flag.operatorNote)}</p>
                    </div>
                  )}

                  <label className="chr-flag__reply-field">
                    <span className="chr-field-label">Player Reply</span>
                    <input
                      className="chr-flag__replybox arena-ops-well"
                      type="text"
                      value={replyDraft[flag.id] ?? ''}
                      placeholder="What Should The Player Be Told?"
                      aria-label={`Reply To The Flag On Hand ${flag.handNumber ?? ''}`}
                      onChange={(event) =>
                        setReplyDraft((previous) => ({
                          ...previous,
                          [flag.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="chr-flag__actions arena-switch arena-ops-keys">
                    {access.canControlClub && flag.handNumber != null && (
                      <button
                        type="button"
                        disabled={Boolean(busyFlag)}
                        onClick={() => {
                          setHandNumber(String(flag.handNumber));
                          const why = `Flagged hand: ${flag.note}`.slice(0, 400);
                          setReason(why);
                          void openHand(String(flag.handNumber), why);
                        }}
                      >
                        Open This Hand
                      </button>
                    )}
                    {flag.status !== 'under_review' && flag.status !== 'resolved' && (
                      <button
                        type="button"
                        disabled={Boolean(busyFlag)}
                        onClick={() => void resolveFlag(flag, 'under_review')}
                      >
                        Take It
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(busyFlag)}
                      onClick={() => void resolveFlag(flag, 'resolved')}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyFlag)}
                      onClick={() => void resolveFlag(flag, 'dismissed')}
                    >
                      Close, No Change
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SpadeConsole>
      </section>
    </div>
  );
}
