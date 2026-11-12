/**
 * LIGHTNING PHASE 8: THE SESSION SUMMARY.
 *
 * Shown when a player leaves Lightning (over the lobby they land in, by the
 * app-root host below) and inside the notice a room shows when Lightning has
 * ended for its Cluster. The numbers are fn_lightning_session_summary's: hands,
 * duration, hands per hour, starting and ending stack, net, BB/100, VPIP and
 * PFR when known, LIGHTNING FOLD count and showdowns.
 *
 * VIEW SESSION opens this session's hands (Recent Hands, filtered to it).
 * PLAY AGAIN goes back to the Cluster's Lightning entry, where JOIN LIGHTNING
 * and the existing buy-in confirmation still stand between the player and
 * any chip: nothing here spends.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  fetchLightningSessionSummary,
  lightningChipsText,
  type LightningSessionSummary as Summary,
} from '../../lightning/lightningSessionApi';
import { useFitText } from '../lobby/game-cards/useFitText';
import { SpadeConsole } from '../console/SpadeConsole';
import {
  closeLightningSessionSummary,
  useLightningSummaryRequest,
} from '../../lightning/lightningSummaryStore';
import { useUserStore } from '../../stores/useUserStore';
import { writeLightningPrefs } from '../../lightning/lightningPrefs';
import { masterBus } from '../../core/MasterBus';
import { titleCase } from '../../utils/titleCase';
import { reportError } from '../../utils/errorReporter';
import LightningStatsGrid, { lightningStatRows } from './LightningStatsGrid';
import LightningRecentHands from './LightningRecentHands';
import './LightningSession.css';
import '../../styles/postPlayResults.css';
import { ChipStackReport } from '../session/ChipStackReport';

export function useLightningSessionSummary(
  poolSessionId: string | null,
  cashout?: { tableId: string; occupancyId: string }
): {
  summary: Summary | null;
  failed: boolean;
} {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!poolSessionId) return;
    let live = true;
    let generation = 0;
    let completionRead = false;
    setSummary(null);
    setFailed(false);
    const read = () => {
      const request = ++generation;
      return fetchLightningSessionSummary(poolSessionId)
        .then((s) => {
          if (!live || request !== generation) return;
          setSummary(s);
          setFailed(!s);
        })
        .catch((err: unknown) => {
          if (!live || request !== generation) return;
          setSummary(null);
          setFailed(true);
          reportError(err, 'LightningSession.summary_read_failed', { poolSessionId });
        });
    };
    // The existing occupancy watcher follows the queued leave across navigation.
    // Its completion event is emitted only after the seat's cashout commits.
    const off = masterBus.subscribe('SEAT_CASHED_OUT', (event) => {
      const landed = event?.payload;
      if (
        !cashout ||
        completionRead ||
        landed?.tableId !== cashout.tableId ||
        landed.occupancyId !== cashout.occupancyId
      )
        return;
      completionRead = true;
      void read();
    });
    void read();
    return () => {
      live = false;
      off();
    };
  }, [poolSessionId, cashout?.tableId, cashout?.occupancyId]);
  return { summary, failed };
}

/** A result leads the recap, on the same glass as the session statistics. */
function LightningResult({ summary, name }: { summary: Summary; name?: string | null }) {
  const net = summary.net;
  const value = lightningChipsText(net, true);
  const ref = useFitText<HTMLSpanElement>(value, 1, 0.35);
  return (
    <div
      className="lightning-result"
      data-result={net === null ? 'unknown' : net < 0 ? 'loss' : net > 0 ? 'win' : 'even'}
    >
      <span className="lightning-result__label">
        {net === null
          ? 'Session Result'
          : net < 0
            ? 'Session Loss'
            : net > 0
              ? 'Session Profit'
              : 'Break Even'}
      </span>
      <span className="lightning-result__well">
        <span ref={ref} className="lightning-result__value">
          {value}
        </span>
      </span>
      <span className="lightning-result__caption">
        {titleCase(name || 'Lightning Session Results')}
      </span>
    </div>
  );
}

function useShareResult(summary: Summary | null, name?: string | null) {
  const [label, setLabel] = useState('Share');
  const onClick = async () => {
    const text = [
      name || 'Lightning Session',
      ...(summary
        ? lightningStatRows(summary, 'summary').map((row) => row.label + ': ' + row.value)
        : []),
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Session Results', text });
      else {
        await navigator.clipboard.writeText(text);
        setLabel('Copied');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setLabel('Retry Share');
    }
  };
  return { label, onClick };
}

function LightningReport({
  summary,
  name,
  onClose,
  onView,
  share,
  onLobby,
}: {
  summary: Summary;
  name?: string | null;
  onClose: () => void;
  onView: () => void;
  share: ReturnType<typeof useShareResult>;
  onLobby: () => void;
}) {
  const net = summary.net;
  const rows = lightningStatRows(summary, 'summary');
  const stats = [
    'hands',
    'duration',
    'hands_per_hour',
    'total_buy_in',
    'current_stack',
    'net',
    'bb_per_100',
    'vpip',
    'pfr',
    'showdowns',
    'fast_folds',
  ].map((key) => rows.find((row) => row.key === key) ?? { label: key.toUpperCase(), value: '-' });
  return (
    <ChipStackReport
      name={name || 'Lightning Cash'}
      headline={
        net == null
          ? 'Session Result'
          : net < 0
            ? 'Session Loss'
            : net === 0
              ? 'Break Even'
              : 'Session Profit'
      }
      value={lightningChipsText(net, true)}
      loss={net !== null && net < 0}
      stats={stats}
      onClose={onClose}
      onView={onView}
      share={share}
      primary={{ label: 'Game Lobby', onClick: onLobby }}
    />
  );
}

export interface LightningSessionSummaryCardProps {
  poolSessionId: string;
  clusterId: string;
  name?: string | null;
}

/** The summary's body: the numbers, VIEW SESSION and PLAY AGAIN. */
export function LightningSessionSummaryCard({
  poolSessionId,
  clusterId,
  name = null,
}: LightningSessionSummaryCardProps) {
  const { summary, failed } = useLightningSessionSummary(poolSessionId);
  const [viewing, setViewing] = useState(false);
  const share = useShareResult(summary, name);
  const navigate = useNavigate();
  const clubId = useUserStore((state) => state.currentClubId);
  if (summary && !viewing) {
    const lobby = () => navigate(clubId ? `/clubs/${clubId}` : '/');
    return (
      <LightningReport
        name={name}
        summary={summary}
        onClose={lobby}
        onLobby={lobby}
        onView={() => setViewing(true)}
        share={share}
      />
    );
  }
  return (
    <div className="lightning-summary" data-testid="lightning-summary" data-cluster={clusterId}>
      <p className="lightning-summary__eyebrow">Lightning</p>
      <p className="lightning-summary__title">{name ? `${name} Session` : 'Session'}</p>
      {summary ? (
        <>
          <LightningResult summary={summary} name={name} />
          <LightningStatsGrid stats={summary} mode="summary" />
        </>
      ) : (
        <p className="lightning-sheet__quiet">
          {failed ? 'We Could Not Load This Session Right Now.' : 'One Moment...'}
        </p>
      )}
      <div className="lightning-summary__actions">
        <button
          type="button"
          className="lightning-summary__btn"
          data-testid="lightning-summary-view-session"
          aria-pressed={viewing}
          onClick={() => setViewing((v) => !v)}
        >
          VIEW SESSION
        </button>
        <button type="button" className="lightning-summary__btn" onClick={share.onClick}>
          {share.label}
        </button>
        <button
          type="button"
          className="lightning-summary__btn lightning-summary__btn--primary"
          onClick={() => navigate(clubId ? `/clubs/${clubId}` : '/')}
        >
          Game Lobby
        </button>
      </div>
      {viewing ? <LightningRecentHands poolSessionId={poolSessionId} sessionOnly /> : null}
    </div>
  );
}

/** Mounted once at the app root, beside the cash Session Complete host. */
export function LightningSessionSummaryHost() {
  const req = useLightningSummaryRequest();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(false);
  const poolSessionId = req?.poolSessionId ?? null;
  const { summary, failed } = useLightningSessionSummary(poolSessionId, req?.cashout);
  useEffect(() => {
    setViewing(false);
  }, [poolSessionId]);
  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightningSessionSummary();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  const share = useShareResult(summary, req?.name);
  const clubId = useUserStore((state) => state.currentClubId);
  if (!req) return null;
  if (summary && !viewing) {
    return createPortal(
      <div
        className="lightning-sheet__overlay"
        data-testid="lightning-summary-host"
        onClick={closeLightningSessionSummary}
      >
        <div
          className="chip-report-host"
          role="dialog"
          aria-modal="true"
          aria-label="Session Results"
          onClick={(event) => event.stopPropagation()}
        >
          <LightningReport
            name={req.name}
            summary={summary}
            share={share}
            onClose={closeLightningSessionSummary}
            onView={() => setViewing(true)}
            onLobby={() => {
              writeLightningPrefs({ lastClusterId: req.clusterId, lastClusterName: req.name });
              closeLightningSessionSummary();
              navigate(clubId ? `/clubs/${clubId}` : '/');
            }}
          />
        </div>
      </div>,
      document.body
    );
  }
  const body = (
    <div
      className="lightning-sheet__overlay"
      data-testid="lightning-summary-host"
      onClick={closeLightningSessionSummary}
    >
      <div
        className="lightning-summary-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightning-summary-title"
        onClick={(e) => e.stopPropagation()}
      >
        <SpadeConsole
          className="postplay-panel"
          eyebrow="Lightning"
          title="Session Results"
          titleId="lightning-summary-title"
          pill="Complete"
          pillInk="blue"
          onClose={closeLightningSessionSummary}
          plates={{
            secondary: {
              label: 'VIEW SESSION',
              type: 'button',
              onClick: () => setViewing((v) => !v),
            },
            middle: share,
            primary: {
              label: 'Game Lobby',
              type: 'button',
              onClick: () => {
                writeLightningPrefs({ lastClusterId: req.clusterId, lastClusterName: req.name });
                closeLightningSessionSummary();
                navigate(clubId ? `/clubs/${clubId}` : '/');
              },
              ink: 'white',
            },
          }}
        >
          <div
            className="lightning-summary"
            data-testid="lightning-summary"
            data-cluster={req.clusterId}
          >
            {summary ? (
              <>
                <LightningResult summary={summary} name={req.name} />
                <LightningStatsGrid stats={summary} mode="summary" />
              </>
            ) : (
              <p className="lightning-sheet__quiet">
                {failed ? 'We Could Not Load This Session Right Now.' : 'One Moment...'}
              </p>
            )}
            {viewing ? (
              <LightningRecentHands poolSessionId={req.poolSessionId} sessionOnly />
            ) : null}
          </div>
        </SpadeConsole>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}

export default LightningSessionSummaryHost;
