import { useEffect, useState, type ReactNode } from 'react';
import { useFitText } from '../lobby/game-cards/useFitText';
import { lateRegEndMs } from '../lobby/lateRegWindow';
import { lateRegCountdown, type LateRegCountdown } from '../lobby/lateRegCountdown';
import type { LobbyTournamentRow } from '../lobby/lobbyEntries';
import { tournamentService } from '../../services/TournamentService';
import { tournamentEntryWindowOpen } from '../../utils/tournamentEntryWindow';
import { serverNow } from '../../utils/serverClock';
import { reportError } from '../../utils/errorReporter';
import './TournamentLateRegCallToAction.css';

/**
 * THE TOURNAMENT SPECTATOR CALL TO ACTION (Dan 2026-10-21)
 *
 * Dan, with a screenshot of "Table Full · 0 Waiting / Join The Waiting List"
 * printed under a running MTT: "THIS 'TABLE FULL JOIN THE WAITING LIST' SHOULD
 * NEVER BE DISPLAYED WHEN WATCHING A TOURNAMENT OR ON A TOURNAMENT PAGE. THERE
 * SHOULD BE A MTT ONE THAT SAYS 'XYZ AMOUNT OF TIME LEFT BEFORE REGISTRATION
 * CLOSES' CLICK HERE TO REGISTER."
 *
 * A tournament has no waiting list. A spectator at a tournament table can do
 * exactly one thing: enter the event while late registration is open. So
 * this prints the time left in the entry window on its dedicated approved
 * two-compartment painted holder (#ClubArenaConsole, nothing drawn here),
 * and the tap takes the player to the tournament's own page, which owns the
 * real registration flow (buy-in sheet, tickets, Diamonds, refusals).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CLOCK COMPARTMENT COUNTS (Dan 2026-11-10)
 *
 * Dan, with a screenshot of the Nightly 10K's holder reading "Reg Closes In /
 * Open" under a running level: "THE 'REGISTRATION CLOSES IN' BUTTON ISN'T
 * WORKING OR FUNCTIONAL. IT SHOULD HAVE THE COUNT DOWN CLOCK INSIDE OF IT."
 *
 * It was not a dead button. `lateRegEndMs` is the STRICT deadline and answers
 * null for an ADD-ON event until the engine stamps `addon_period_ends_at`,
 * which it does only when the add-on window actually opens - that is, after
 * the entry levels are already over. For the whole of the registration window,
 * the one time the clock is worth reading, the strict projection had nothing
 * to give and this compartment printed the bare word "Open".
 *
 * Every add-on event was affected: the Nightly 10K in the screenshot carries
 * `add_on_available = true` with `addon_period_ends_at = null`.
 *
 * `lateRegCountdown` (../lobby/lateRegCountdown) is the projection Dan already
 * ruled on for the lobby card on 2026-11-06 ("FIX IT SO IT ALWAYS SHOWS THE
 * COUNT DOWN"): it walks the level window forward through the breaks and the
 * daily freeze and adds the engine's fixed 60-second add-on minute
 * (TournamentManagerBase.addOnBreakDurationMs), then counts to the stamped end
 * once there is one. This holder reads it the same way `mttPhaseText` does -
 * the countdown first, the strict deadline as the fallback - so one event
 * cannot count down in the lobby and read "Open" at its own table.
 *
 * WHAT STILL DECIDES WHETHER THE OFFER IS SHOWN. Only
 * `tournamentEntryWindowOpen`, the mirror of
 * fn_tournament_late_registration_open. A countdown is an ESTIMATE: a level
 * clock that stalls, or a drain that runs past the projected minute, must
 * never retract an entry the database is still admitting. So an elapsed
 * estimate drops the clock back to the open-with-nothing-to-count wording and
 * leaves the button exactly where it is.
 */
export interface TournamentLateRegCallToActionProps {
  tournamentId: string;
  /** Changes at every hand boundary: the honest tick to re-read the row. */
  refreshKey?: number;
  /** A background slot stays mounted; it stops its clock while off screen. */
  hidden?: boolean;
  onRegister: () => void;
  /** Rendered when late registration is closed or unknown. */
  fallback: ReactNode;
}

type LateRegRow = LobbyTournamentRow & { status?: string | null };

export function fmtLateRegClock(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? m.toString().padStart(2, '0') : String(m);
  const tail = `${mm}:${sec.toString().padStart(2, '0')}`;
  return h > 0 ? `${h}:${tail}` : tail;
}

/**
 * The deadline this holder counts to, or null when the row supports none.
 *
 * The same order the lobby card uses (`mttPhaseText`): the countdown
 * projection first, the strict deadline behind it, and a target only ever in
 * the future - an elapsed estimate is nothing to count, never a close.
 */
export function lateRegCallToActionTarget(
  row: LateRegRow | null,
  nowMs: number
): LateRegCountdown | null {
  if (!row) return null;
  const countdown = lateRegCountdown(row, nowMs);
  if (countdown) return countdown;
  const strict = lateRegEndMs(row);
  return strict !== null && strict > nowMs ? { endMs: strict, phase: 'late_reg' } : null;
}

/** Copy for the shell, or null when nothing should be offered. Pure for tests. */
export function lateRegCallToActionCopy(
  row: LateRegRow | null,
  nowMs: number
): { eyebrow: string; title: string } | null {
  if (!row) return null;
  // The database predicate is the only thing that may withdraw the offer.
  if (!tournamentEntryWindowOpen(row, nowMs)) return null;
  const title = 'Tap Here To Enter';
  const target = lateRegCallToActionTarget(row, nowMs);
  if (target === null) {
    return {
      eyebrow:
        row.add_on_available === true ? 'The Add-On Is Starting' : 'Late Registration Is Open',
      title,
    };
  }
  const closes = target.phase === 'add_on' ? 'The Add-On Closes' : 'Registration Closes';
  return {
    eyebrow: `${fmtLateRegClock((target.endMs - nowMs) / 1000)} Left Before ${closes}`,
    title,
  };
}

export function TournamentLateRegCallToAction({
  tournamentId,
  refreshKey,
  hidden,
  onRegister,
  fallback,
}: TournamentLateRegCallToActionProps) {
  const [loaded, setLoaded] = useState<{ id: string; row: LateRegRow | null } | null>(null);
  const row = loaded?.id === tournamentId ? loaded.row : null;
  const [nowMs, setNowMs] = useState(() => serverNow());

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    setNowMs(serverNow());
    void tournamentService
      .getTournament(tournamentId, { throwOnError: true })
      .then((t) => {
        if (!cancelled)
          setLoaded({ id: tournamentId, row: (t as unknown as LateRegRow | null) ?? null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({ id: tournamentId, row: null });
        reportError(error, 'TournamentLateRegCallToAction.Load');
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, refreshKey, hidden]);

  const copy = lateRegCallToActionCopy(row, nowMs);
  const open = copy !== null;

  useEffect(() => {
    if (hidden || !open) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setNowMs(serverNow());
    }, 1000);

    const onVisible = () => {
      if (!document.hidden) setNowMs(serverNow());
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hidden, open]);

  const eyebrow = copy?.eyebrow ?? '';
  const title = copy?.title ?? '';
  const target = lateRegCallToActionTarget(row, nowMs);
  /* An add-on event whose entry levels are over and whose hands are still
     draining: the minute opens when the last hand finishes, so there is no
     honest second to print until the engine stamps it. */
  const addOnStarting = target === null && row?.add_on_available === true;
  const clockLabel =
    target?.phase === 'add_on' ? 'Add-On Ends In' : addOnStarting ? 'Add-On' : 'Reg Closes In';
  const clock =
    target !== null
      ? fmtLateRegClock((target.endMs - nowMs) / 1000)
      : addOnStarting
        ? 'Starting'
        : 'Open';
  const clockRef = useFitText<HTMLSpanElement>(clock, 1, 0.35);
  const titleRef = useFitText<HTMLSpanElement>(title, 1, 0.5);

  if (!copy) return <>{fallback}</>;

  return (
    <button
      type="button"
      className="tournament-entry-holder"
      data-testid="tournament-late-reg-cta"
      onClick={() => {
        // A suspended tab must never navigate on an expired cached clock.
        const now = serverNow();
        if (!hidden && lateRegCallToActionCopy(row, now)) onRegister();
        else setNowMs(now);
      }}
      aria-label={`${eyebrow}. ${title}`}
    >
      <span className="tournament-entry-holder__clock" aria-hidden="true">
        <span className="tournament-entry-holder__label">{clockLabel}</span>
        <span className="tournament-entry-holder__clock-line">
          <span ref={clockRef} className="tournament-entry-holder__time">
            {clock}
          </span>
        </span>
      </span>
      <span className="tournament-entry-holder__face" aria-hidden="true">
        <span className="tournament-entry-holder__label">Tournament Spectating</span>
        <span className="tournament-entry-holder__title-line">
          <span ref={titleRef} className="tournament-entry-holder__title">
            {title}
          </span>
        </span>
      </span>
    </button>
  );
}
