import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WheelSegment } from '../../services/DiamondWheelService';
import { Modal } from '../common/Modal';
import cabinet from '../games/BonusCompletion.module.css';
import { getAnimationSpeed } from '../../utils/animationSpeed';
import { soundService } from '../../services/SoundService';
import { triggerHaptic } from '../../services/HapticService';
import { WheelPrizeArt } from './WheelPrizeArt';
import styles from './WheelWinReveal.module.css';

/** What the one plate says, by what was won. A game is played when the player says so. */
export function revealButtonLabel(kind: WheelSegment['kind']): string {
  if (kind === 'bonus') return 'Play Game';
  if (kind === 'upgrade') return 'Open Upgrade Wheel';
  return 'Continue';
}

/**
 * Display only: the receipt already owns the award. Opening never books a bet.
 *
 */
export function WheelWinReveal({
  prize,
  title,
  detail,
  onOpen,
  autoContinue = true,
  autoContinueAfterMs = 3000,
  eyebrow,
  silent = false,
  reserved = false,
  openLabel,
  holdOpen = false,
  art,
}: {
  prize: Pick<WheelSegment, 'kind' | 'game' | 'multiplier'>;
  title: string;
  detail: string;
  onOpen: () => void;
  /** A timed continue, honoured only with a positive `autoContinueAfterMs`. */
  autoContinue?: boolean;
  autoContinueAfterMs?: number;
  /**
   * What this receipt is, when it is not a win. The wheel's own prizes are
   * always won, so they keep the default; a bonus game's receipt can be a
   * guarantee paid after a hit or a crash, and "You Won" over that is a lie.
   */
  eyebrow?: string;
  /**
   * The round this receipt belongs to was not a win, or its own scene already
   * sang it. A major arpeggio and a success buzz over a hit or a crash teach
   * players that the sounds mean nothing.
   */
  silent?: boolean;
  reserved?: boolean;
  /**
   * What the one plate says, when the prize's own kind does not say it. The
   * Diamonds card game is the case: its plate opens three sealed cards rather
   * than continuing, and `revealButtonLabel` cannot know that from the kind
   * alone, because the same kind PAID under contract 3.
   */
  openLabel?: string;
  /**
   * Money is still ahead of this reveal, so the plate is the only way off it.
   * Escape and the backdrop close nothing, exactly as they close nothing over
   * a bonus game or an upgrade.
   */
  holdOpen?: boolean;
  /**
   * A picture of its own in place of the prize's atlas art: the offline test
   * page shows a finished bonus game's receipt art here, exactly as the live
   * receipt (BonusCompletion) does.
   */
  art?: ReactNode;
}) {
  const opened = useRef(false);
  const opening = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const remaining = useRef(
    prize.kind === 'bonus' ? 1000 * getAnimationSpeed() : autoContinueAfterMs
  );
  const sounded = useRef(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (silent || !visible || sounded.current) return;
    sounded.current = true;
    if (prize.kind === 'upgrade' || prize.kind === 'bonus') soundService.playBigWin();
    else soundService.playWin();
    triggerHaptic('success');
  }, [prize.kind, visible, silent]);
  const continueButton = useRef<HTMLButtonElement>(null);
  const choiceAhead = reserved || holdOpen || prize.kind === 'upgrade';
  const timedPrize =
    !choiceAhead && (prize.kind === 'bonus' || (autoContinue && autoContinueAfterMs > 0));
  useEffect(() => {
    continueButton.current?.focus();
  }, []);
  const finish = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    onOpenRef.current();
  }, []);
  useEffect(() => {
    if (!timedPrize || !visible || opened.current) return;
    const started = Date.now();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (prize.kind === 'bonus') {
        // A slow software-rendered frame may start the CSS entrance after the
        // timer starts. Let its real visible motion finish before navigation.
        const animations = opening.current?.getAnimations?.() ?? [];
        if (animations.length) {
          await Promise.allSettled(animations.map((animation) => animation.finished));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      if (!cancelled) finish();
    }, remaining.current);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [timedPrize, visible, finish, prize.kind]);
  return (
    <Modal
      isOpen
      ariaLabel={title}
      onClose={() => !choiceAhead && finish()}
      closeOnOverlay={!choiceAhead}
      closeOnEscape={!choiceAhead}
      showCloseButton={false}
      popupChassis="none"
      className={styles.dialog}
    >
      <div
        ref={opening}
        className={styles.opening}
        data-motion="keep"
        style={{
          animationDuration: `${480 * getAnimationSpeed()}ms`,
          animationPlayState: visible ? 'running' : 'paused',
        }}
        data-award-impact={
          prize.kind === 'bonus' || prize.kind === 'upgrade'
            ? 'burst'
            : (prize.multiplier ?? 0) >= 5
              ? 'major'
              : 'regular'
        }
      >
        <section className={cabinet.receipt}>
          <header>
            <span data-eyebrow>
              {eyebrow ??
                (prize.kind === 'upgrade'
                  ? 'Wheel Upgrade'
                  : prize.kind === 'bonus'
                    ? 'Bonus Game'
                    : reserved
                      ? 'Reserved'
                      : 'You Won')}
            </span>
            <h2>{title}</h2>
          </header>
          <div className={styles.prize} aria-hidden="true">
            <div className={styles.rays} />
            {art ?? <WheelPrizeArt segment={prize} className={styles.art} />}
          </div>
          <p className="sc-copy sc-copy--center" role="status">
            {detail}
          </p>
          <button ref={continueButton} className={styles.continue} onClick={finish}>
            {openLabel ?? revealButtonLabel(prize.kind)}
          </button>
        </section>
      </div>
    </Modal>
  );
}
