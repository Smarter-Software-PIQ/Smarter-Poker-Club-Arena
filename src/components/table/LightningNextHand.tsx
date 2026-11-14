import { useEffect, useRef, useState } from 'react';
import {
  LIGHTNING_NEXT_HAND_FADE_MS,
  LIGHTNING_NEXT_HAND_NOTICE_MS,
  LIGHTNING_NEXT_HAND_TEXT,
  nextHandNoticeDue,
} from '../../lightning/lightningHand';
import { getAnimationSpeed } from '../../utils/animationSpeed';
import './LightningFoldBar.css';

export default function LightningNextHand({
  handInProgress,
  handComplete = false,
  eligible = true,
  dealing = false,
  thresholdMs = LIGHTNING_NEXT_HAND_NOTICE_MS,
}: {
  handInProgress: boolean;
  /** The felt's hand-bound completion latch, after its full award hold. */
  handComplete?: boolean;
  eligible?: boolean;
  dealing?: boolean;
  thresholdMs?: number;
}) {
  // A winner can keep the completed hand's snapshot while waiting to be
  // matched again. The existing completion latch ends that hand on the felt;
  // handSettling alone is too early because the pot push is still playing.
  // Only an eligible, connected room may say it is finding a new hand.
  // An announced deal continues that same wait until the cards can be shown.
  const handActive = !eligible || (handInProgress && !handComplete && !dealing);
  const quietSinceRef = useRef<number | null>(handActive ? null : Date.now());
  const [, setTick] = useState(0);
  /* Whether the line has been shown since it last finished leaving. Read in
     render so the fade-out starts in the same frame the deal does: the line
     is never unmounted and remounted on its way out. */
  const shownRef = useRef(false);
  const lastLabel = useRef(LIGHTNING_NEXT_HAND_TEXT);
  useEffect(() => {
    if (handActive) {
      quietSinceRef.current = null;
      setTick((t) => t + 1);
      return;
    }
    if (quietSinceRef.current === null) quietSinceRef.current = Date.now();
    const wait = Math.max(0, quietSinceRef.current + thresholdMs - Date.now());
    const timer = setTimeout(() => setTick((t) => t + 1), wait);
    return () => clearTimeout(timer);
  }, [handActive, thresholdMs]);
  const due = nextHandNoticeDue({
    handInProgress: handActive,
    quietSinceMs: quietSinceRef.current,
    nowMs: Date.now(),
    thresholdMs,
  });
  if (due) {
    shownRef.current = true;
    lastLabel.current = dealing ? 'Dealing Cards...' : LIGHTNING_NEXT_HAND_TEXT;
  }
  const leaving = !due && shownRef.current;
  /* The fade out runs its full length at the player's speed, then the line
     is removed. A deal that ends again inside the fade keeps the same timer. */
  useEffect(() => {
    if (!leaving) return;
    const fade = Math.round(LIGHTNING_NEXT_HAND_FADE_MS * getAnimationSpeed());
    const done = setTimeout(() => {
      shownRef.current = false;
      setTick((t) => t + 1);
    }, fade);
    return () => clearTimeout(done);
  }, [leaving]);
  if (!eligible || (!due && !leaving)) return null;
  return (
    <p
      className="lightning-next-hand"
      data-testid="lightning-next-hand"
      data-leaving={due ? undefined : 'true'}
      role="status"
    >
      {lastLabel.current}
    </p>
  );
}
