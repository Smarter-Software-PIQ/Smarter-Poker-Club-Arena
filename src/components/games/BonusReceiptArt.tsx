import { useState, type CSSProperties } from 'react';
import { getAnimationSpeed, prefersReducedMotion } from '../../utils/animationSpeed';
import styles from './BonusReceiptArt.module.css';
import {
  bookedAtCap,
  receiptBucketTint,
  receiptFigure,
  type BonusReceiptGame,
} from './bonusReceiptFigure';

export type { BonusReceiptGame } from './bonusReceiptFigure';

/** What the small lit line over the figure says, win or loss. */
function caption(game: BonusReceiptGame, dim: boolean, figure: number | null | undefined) {
  if (game === 'crash') return dim ? 'Crashed At' : 'Booked At';
  if (game === 'plinko') return 'Best Bucket';
  if (game === 'mines') return Math.round(Number(figure)) === 1 ? 'Gem Found' : 'Gems Found';
  return dim ? 'Hit At' : 'Made It To';
}

export function BonusReceiptArt({
  game,
  figure,
  cap,
  dim = false,
}: {
  game: BonusReceiptGame;
  figure?: number | null;
  /** Crash: the round's own cap as a multiplier; a round booked at it wears the crown. */
  cap?: number | null;
  /** A lost round: the art stands back and the figure is not gold. */
  dim?: boolean;
}) {
  const [reduced] = useState(() => prefersReducedMotion());
  const [speed] = useState(() => getAnimationSpeed());
  const label = receiptFigure(game, figure);
  const crown = game === 'crash' && !dim && bookedAtCap(figure, cap);
  const cents = Math.round(Number(figure) * 100);
  const style = {
    '--animation-speed': speed,
    '--receipt-tint':
      game === 'plinko' ? receiptBucketTint(Number.isFinite(cents) ? cents : 0) : undefined,
  } as CSSProperties;
  return (
    <div
      className={styles.stage}
      data-receipt-art={game}
      data-dim={dim || undefined}
      data-crown={crown || undefined}
      data-reduced={reduced || undefined}
      style={style}
    >
      <img
        className={styles.art}
        src={import.meta.env.BASE_URL + `assets/diamond-spins/result-${game}.webp`}
        alt=""
      />
      {label !== null && (
        <span className={styles.figure} data-receipt-figure={game}>
          <span className={styles.caption}>{caption(game, dim, figure)}</span>
          <span className={styles.value}>{label}</span>
        </span>
      )}
    </div>
  );
}
