import React, { useState, useEffect, useCallback } from 'react';
import { useMasterBusSubscription } from '../../hooks/useMasterBusSubscription';
import { soundService } from '../../services/SoundService';
import { compactChips, formatPrizeAtUnit, moneyWordAtUnit } from '../../utils/format';
import { CHIP_UNIT_CENTS, normalizeUnitCents } from '../../../server/src/tournament/tournamentUnit';
import './FinalTableOverlay.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FinalTablePlayer {
  userId: string;
  username: string;
  chips: number;
  avatar?: string;
}

interface FinalTableOverlayProps {
  tournamentId: string;
  tournamentName?: string;
  prizePool?: number;
  /**
   * THE UNIT THE POOL IS PAID IN (2026-09-21). TournamentDetails passes
   * `tournamentRowUnitCents(tournament)` off the row it already read; the
   * table passes `arenaAssetUnitCentsIfRead` off its own arena. The row used
   * to print "Chips" after every pool, so a Diamond final table advertised a
   * Chip pool. `null` means the asset has not been read, and the pool line
   * waits for it instead of guessing.
   */
  unitCents: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const FinalTableOverlay: React.FC<FinalTableOverlayProps> = ({
  tournamentId,
  tournamentName = 'Tournament',
  prizePool = 0,
  unitCents,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [players, setPlayers] = useState<FinalTablePlayer[]>([]);
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');
  const timerRefs = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timerRefs.current.forEach(clearTimeout);
    };
  }, []);

  // Listen for FINAL_TABLE bus event
  useMasterBusSubscription('FINAL_TABLE_REACHED', (payload) => {
    if (payload.tournamentId !== tournamentId) return;

    const ftPlayers = payload.players || [];
    // Sort by chips descending — spread first to avoid mutating source array
    const sorted = [...ftPlayers].sort((a, b) => b.chips - a.chips);
    setPlayers(sorted);
    setPhase('enter');
    setIsVisible(true);

    // Cinematic power-chord fanfare for final table reveal
    soundService.playTournamentFinalTable();

    // Clear any previous timers
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];

    // Phase transitions — tracked for cleanup
    timerRefs.current.push(setTimeout(() => setPhase('show'), 800));
    timerRefs.current.push(setTimeout(() => setPhase('exit'), 7200));
    timerRefs.current.push(setTimeout(() => setIsVisible(false), 8000));
  });

  // Dismiss on tap
  const handleDismiss = useCallback(() => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    setPhase('exit');
    timerRefs.current.push(setTimeout(() => setIsVisible(false), 600));
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [isVisible, handleDismiss]);

  if (!isVisible) return null;

  const totalChips = players.reduce((s, p) => s + p.chips, 0);
  const seatsLeft = players.length;

  return (
    <section className={`ft-overlay ft-overlay--${phase}`} aria-label="Final table announcement">
      <div className="ft-overlay__content">
        <header className="ft-stage">
          <div className="ft-stage__lights" aria-hidden="true" />
          <div className="ft-stage__burst" aria-hidden="true" />
          <p>{tournamentName}</p>
          <h2 aria-live="polite">Final Table</h2>
          {seatsLeft > 0 && <span>{seatsLeft} finalists</span>}
        </header>
        <div className="ft-scoreboard">
          {prizePool > 0 && unitCents != null && (
            <div className="ft-overlay__prize-row">
              <span className="ft-overlay__prize-label">Prize Pool</span>
              {/* A chip pool prints exactly as it always has; a Diamond pool
                  is whole Diamonds, named, never "Chips" (2026-09-21). */}
              <span className="ft-overlay__prize">
                {normalizeUnitCents(unitCents) === CHIP_UNIT_CENTS
                  ? compactChips(prizePool)
                  : formatPrizeAtUnit(prizePool, unitCents)}{' '}
                {moneyWordAtUnit(unitCents)}
              </span>
            </div>
          )}

          {/* Player List */}
          <ol className="ft-overlay__players" aria-label="Finalists by chip count">
            {players.map((player, index) => {
              const chipPct = totalChips > 0 ? (player.chips / totalChips) * 100 : 0;
              return (
                <li
                  key={player.userId}
                  className="ft-player"
                  style={{ animationDelay: `${index * 100 + 400}ms` }}
                >
                  {/* Rank */}
                  <div className="ft-player__rank">{index + 1}</div>

                  {/* Info */}
                  <div className="ft-player__info">
                    <div className="ft-player__name-row">
                      <span className="ft-player__name">{player.username}</span>
                    </div>
                    <div className="ft-player__chips-row">
                      <span className="ft-player__chips">{compactChips(player.chips)}</span>
                      {/* Whole numbers on a forward-facing page. */}
                      <span className="ft-player__chip-pct">{Math.round(chipPct)}%</span>
                    </div>
                  </div>

                  {/* Chip Bar */}
                  <div className="ft-player__bar-wrap">
                    <div className="ft-player__bar" style={{ width: `${chipPct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className="ft-overlay__dismiss" onClick={handleDismiss}>
            Return to table
          </button>
        </div>
      </div>
    </section>
  );
};

export default FinalTableOverlay;
