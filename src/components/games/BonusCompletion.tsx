import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../common/Modal';
import cabinet from './BonusCompletion.module.css';
import { WheelPrizeArt } from '../wheel/WheelPrizeArt';
import { getAnimationSpeed } from '../../utils/animationSpeed';
import { soundService } from '../../services/SoundService';
import { triggerHaptic } from '../../services/HapticService';
import DiamondWheelService, { type WheelBonusAward } from '../../services/DiamondWheelService';
import { reportError } from '../../utils/errorReporter';
import { isBigPayout } from '../../utils/bigWin';
import styles from '../wheel/WheelWinReveal.module.css';
import { BonusReceiptArt, type BonusReceiptGame } from './BonusReceiptArt';

/** Where an accumulated award is played, by the game it names. */
export function bonusGameRoute(clubId: string, award: WheelBonusAward): string {
  return `/clubs/${clubId}/${award.game}?wheelAward=${encodeURIComponent(award.id)}`;
}

/** Game scenes deliver a settled receipt after their reveal. Earned games
 * return to the wheel after reading time. Expanded details and an actionable
 * next-game choice keep the receipt open. No navigation starts a new spin. */
export default function BonusCompletion({
  clubId,
  clubUuid = null,
  awardId,
  chips,
  detail,
  eyebrow,
  silent,
  proof,
  game,
  figure,
  cap,
  stakeChips,
  headline,
}: {
  /**
   * One line said on its own, in gold, above the detail: for Donkey Cross, how
   * far the donkey would have got after the player booked the win (Dan,
   * 2026-10-11). Absent: nothing extra is shown.
   */
  headline?: string;
  /** The route's club id, used for navigation. */
  clubId: string;
  /** The club's UUID, used to read the wheel's waiting awards. Absent: no read. */
  clubUuid?: string | null;
  /** The award this receipt settled, so it is never offered as the next game. */
  awardId?: string | null;
  chips: number;
  detail: string;
  /** What this receipt is, when the round was not won. */
  eyebrow?: string;
  /** The round was not a win, or its own scene already sang it. */
  silent?: boolean;
  /**
   * What this browser made of the sealed round, in the sentence the player is
   * already reading. Proving a round should not need a collapsed panel and a
   * press inside the five seconds this receipt lasts.
   */
  proof?: string;
  /**
   * The game that produced this receipt. With it, the picture is that game's
   * own (BonusReceiptArt) instead of the chip stack; without it, the chip
   * stack stays. Everything the receipt says and does is the same either way.
   */
  game?: BonusReceiptGame;
  /**
   * The one number the game is about, printed over its art: the booked (or
   * crashed) multiplier for Crash, the street reached for Donkey Cross, the
   * best bucket's multiplier for Plinko and the gems found for Mines.
   */
  figure?: number | null;
  /** Crash: the round's own cap as a multiplier, so the crown goes to a round booked at it. */
  cap?: number | null;
  /**
   * What the round staked, in chips. A win of five times it or more is a Big
   * Win in every game (src/utils/bigWin.ts): the receipt says so, its rays burn
   * gold, and when the receipt is the one that sings it sings the big chord.
   */
  stakeChips?: number | null;
}) {
  const big = eyebrow === undefined && isBigPayout(chips, stakeChips);
  const navigate = useNavigate();
  const [next, setNext] = useState<WheelBonusAward | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const sounded = useRef(false);
  const left = useRef(false);
  const [reading, setReading] = useState(false);
  const remaining = useRef(5000);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  // A receipt sings only over a win the player has not already heard. A lost
  // round, or one whose own scene took the chord, stays quiet (PR #5100).
  useEffect(() => {
    if (!visible || silent || sounded.current) return;
    sounded.current = true;
    if (big) {
      soundService.playBigWin();
      triggerHaptic('heavy');
    } else {
      soundService.playWin();
      triggerHaptic('success');
    }
  }, [visible, silent, big]);
  // One read of the wheel's waiting awards (C1 lists them as pending_awards).
  // A wheel state without the field, or a read that fails, simply offers no
  // next game: the wheel itself still shows every award when the player returns.
  useEffect(() => {
    if (!clubUuid) return;
    let cancelled = false;
    (async () => {
      try {
        const state = await DiamondWheelService.getStateV2(clubUuid);
        const waiting = (state.pending_awards ?? []).find((award) => award.id !== awardId);
        if (!cancelled && waiting) setNext(waiting);
      } catch (error) {
        reportError(error, 'BonusCompletion.pendingAwards');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubUuid, awardId]);
  const go = useCallback(
    (to: string) => {
      if (left.current) return;
      left.current = true;
      navigate(to, { replace: true });
    },
    [navigate]
  );
  useEffect(() => {
    if (!awardId || next || !visible || reading || left.current) return;
    const started = performance.now();
    const timer = window.setTimeout(() => go(`/clubs/${clubId}/wheel`), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [awardId, clubId, go, next, visible, reading]);
  const back = {
    label: 'Back To The Wheel',
    onClick: () => go(`/clubs/${clubId}/wheel`),
  };
  const title = `${chips.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Chips`;
  return (
    <Modal
      isOpen
      ariaLabel={title}
      onClose={() => undefined}
      closeOnOverlay={false}
      closeOnEscape={false}
      showCloseButton={false}
      popupChassis="none"
      className={styles.dialog}
    >
      <div
        className={styles.opening}
        data-motion="keep"
        data-bonus-step="completed"
        style={{
          animationDuration: `${480 * getAnimationSpeed()}ms`,
          animationPlayState: visible ? 'running' : 'paused',
        }}
        data-receipt-game={game}
        data-award-impact={big ? 'major' : eyebrow ? 'guarantee' : 'regular'}
      >
        <section className={cabinet.receipt}>
          <header>
            <span data-result-label>{eyebrow ?? (big ? 'Big Win' : 'You Won')}</span>
            <h2>
              <span className={cabinet.paidLabel}>Paid</span> {title}
            </h2>
            <small>Credited To Your Club Balance</small>
          </header>
          <div className={styles.prize} aria-hidden="true" data-big={big ? 'true' : undefined}>
            <div className={styles.rays} />
            {game ? (
              // A receipt with an eyebrow is a round that was not won: the
              // same art, standing back.
              <BonusReceiptArt game={game} figure={figure} cap={cap} dim={eyebrow !== undefined} />
            ) : (
              <WheelPrizeArt segment={{ kind: 'chips' }} className={styles.art} />
            )}
          </div>
          {headline ? (
            // A block of its own, above the receipt's sentence and read with it.
            <div className={cabinet.headline} data-receipt-headline="true">
              <strong>{headline}</strong>
            </div>
          ) : null}
          <details
            className={cabinet.details}
            onToggle={(event) => setReading(event.currentTarget.open)}
          >
            <summary>Round Details</summary>
            <p role="status" className="sc-copy">
              {`${big ? 'Big Win. ' : ''}${chips > 0 ? 'Your Prize Is Booked.' : 'No Chips Won This Round.'} ${detail}`}
              {proof ? ` ${proof}` : ''}
              {next ? ' Another Bonus Game Is Waiting For You.' : ''}
            </p>
          </details>
          <footer>
            <button type="button" onClick={back.onClick}>
              {back.label}
            </button>
            {next && (
              <button type="button" onClick={() => go(bonusGameRoute(clubId, next))}>
                Play Next Bonus Game
              </button>
            )}
          </footer>
        </section>
      </div>
    </Modal>
  );
}
