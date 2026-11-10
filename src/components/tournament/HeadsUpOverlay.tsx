import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMasterBusSubscription } from '../../hooks/useMasterBusSubscription';
import { soundService } from '../../services/SoundService';
import { getAvatarWithFallback } from '../../utils/avatarGenerator';
import { compactChips } from '../../utils/format';
import './HeadsUpOverlay.css';

interface HeadsUpPlayer {
  userId: string;
  username: string;
  chips: number;
  avatar?: string;
}

interface HeadsUpOverlayProps {
  tournamentId: string;
  tournamentName?: string;
}

export const HeadsUpOverlay: React.FC<HeadsUpOverlayProps> = ({
  tournamentId,
  tournamentName = 'Tournament',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [player1, setPlayer1] = useState<HeadsUpPlayer | null>(null);
  const [player2, setPlayer2] = useState<HeadsUpPlayer | null>(null);
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const seen = React.useRef<string | null>(null);
  const stopAudio = React.useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    return () => {
      stopAudio.current?.();
      timerRefs.current.forEach(clearTimeout);
    };
  }, []);

  // Listen for HEADS_UP_SWITCH event
  useMasterBusSubscription('HEADS_UP_SWITCH', (payload) => {
    if (payload.tournamentId !== tournamentId || seen.current === tournamentId) return;
    seen.current = tournamentId;

    stopAudio.current = soundService.playTournamentHeadsUp();
    setPlayer1(payload.player1);
    setPlayer2(payload.player2);

    setPhase('enter');
    setIsVisible(true);

    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];

    // Sequences matching FinalTableOverlay
    timerRefs.current.push(setTimeout(() => setPhase('show'), 800));
    timerRefs.current.push(setTimeout(() => setPhase('exit'), 7200));
    timerRefs.current.push(
      setTimeout(() => {
        stopAudio.current?.();
        setIsVisible(false);
      }, 8000)
    );
  });

  const handleDismiss = useCallback(() => {
    stopAudio.current?.();
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

  if (!isVisible || !player1 || !player2) return null;
  return (
    <section className={`hu-overlay hu-overlay--${phase}`} aria-label="Heads Up Announcement">
      <div className="hu-stage">
        <div className="hu-stage__scenery" aria-hidden="true" />
        <button className="hu-stage__dismiss" type="button" onClick={handleDismiss}>
          Return To Table
        </button>
        <header className="hu-stage__heading">
          <p>{tournamentName}</p>
          <h2>Heads Up</h2>
        </header>
        <div className="hu-stage__match">
          {[player1, player2].map((player, index) => (
            <div
              key={player.userId}
              className={`hu-contender hu-contender--${index ? 'right' : 'left'}`}
            >
              <img
                className="hu-contender__portrait"
                alt=""
                src={getAvatarWithFallback(player.avatar, player.userId, player.username, 200)}
                onError={(event) => {
                  const fallback = getAvatarWithFallback(null, player.userId, player.username);
                  if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
                }}
              />
              <div className="hu-contender__plate">
                <strong>{player.username}</strong>
                <span>{compactChips(player.chips)}</span>
              </div>
            </div>
          ))}
          <strong className="hu-stage__clash" aria-label="Versus">
            VS
          </strong>
        </div>
      </div>
    </section>
  );
};
