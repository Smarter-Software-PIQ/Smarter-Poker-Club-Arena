/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HIT AND RUN - THE LEAVE CONFIRMATION, ON THE SPADE CONSOLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Owner 2026-11-06: "IF THEY TRY TO LEAVE THE GAME BEFORE THE HANDS ARE
 *    COMPLETED, THEY SHOULD RECEIVE A FULL SCREEN POP UP THAT SAYS, YOUR HAND
 *    COUNT IS NOT COMPLETED, ARE YOU SURE YOU WANT TO LEAVE? YOU WILL BE
 *    BLINDED OFF FOR THE REMAINING HANDS."
 *
 *   Owner 2026-11-10, superseding the opaque full screen backdrop: "UPGRADE
 *    THIS POP UP NOTIFICATION TO LOOK LIKE THE OTHERS, ITS BLOCKING THE WHOLE
 *    SCREEN, AND IS NOT SMARTER.POKER LOOK AND FEEL."
 *
 * Every leave door (menu, tab, back arrow, leave-after-this-hand) passes
 * through TablePage.handleLeaveTable, which opens this before anything is
 * sent. Stay keeps the player at the table, unchanged. Leave asks the engine
 * again with the confirmation; the seat is then blinded off - dealt in and
 * folded, posting its blinds - until the owed hands are played, and the chips
 * return to the wallet then.
 *
 * #ClubArenaConsole: the riveted console the other table popups use (Time
 * Banks), the spade master's sibling family whose wide header well carries
 * the owner's whole sentence at a readable size. The title is engraved in the
 * header well, the
 * count prints in red ink on the glass, and the two answers are the plates
 * painted into the foot: Leave in red ink on the steel plate, Stay And Play
 * on the blue glass, which takes focus. Nothing is drawn. The scrim is
 * translucent, so the table stays in view behind the question.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HIT_RUN_CONFIRM_CONSEQUENCE,
  HIT_RUN_CONFIRM_QUESTION,
  HIT_RUN_CONFIRM_TITLE,
  handsRemainingText,
} from '../../lib/hitAndRun';
import { SpadeConsole } from '../console/SpadeConsole';
import './HitRunLeaveConfirm.css';

export interface HitRunLeaveConfirmProps {
  /** Hands still owed; the dialog is closed when null. */
  handsRemaining: number | null;
  onStay: () => void;
  onLeave: () => void | Promise<void>;
}

export default function HitRunLeaveConfirm({
  handsRemaining,
  onStay,
  onLeave,
}: HitRunLeaveConfirmProps): React.ReactElement | null {
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const stayRef = useRef<HTMLButtonElement>(null);
  const open = handsRemaining !== null && handsRemaining > 0;

  useEffect(() => {
    if (!open) {
      leavingRef.current = false;
      setLeaving(false);
      return;
    }
    stayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !leavingRef.current) onStay();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onStay]);

  if (!open) return null;

  const leave = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      await onLeave();
    } finally {
      leavingRef.current = false;
      setLeaving(false);
    }
  };

  // Portalled to the page body: a table behind a hidden tab, or behind the
  // multi-table container, still shows its question over everything.
  return createPortal(
    <div
      className="hit-run-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="hit-run-confirm-title"
      aria-describedby="hit-run-confirm-desc"
      data-testid="hit-run-confirm"
    >
      <div className="hit-run-confirm__dialog ac-popup">
        <SpadeConsole
          as="div"
          family="riveted"
          title={HIT_RUN_CONFIRM_TITLE}
          titleId="hit-run-confirm-title"
          plates={{
            secondary: {
              label: leaving ? 'Leaving' : 'Leave',
              ink: 'red',
              className: 'hit-run-confirm__btn hit-run-confirm__btn--leave',
              onClick: () => void leave(),
              disabled: leaving,
            },
            primary: {
              label: 'Stay And Play',
              ink: 'white',
              buttonRef: stayRef,
              className: 'hit-run-confirm__btn hit-run-confirm__btn--stay',
              onClick: onStay,
              disabled: leaving,
            },
          }}
        >
          <div className="hit-run-confirm__count" data-testid="hit-run-confirm-count">
            <span className="hit-run-confirm__number sc-ink--red">{handsRemaining}</span>
            <span className="hit-run-confirm__unit sc-label sc-ink--muted">
              {handsRemainingText(handsRemaining)}
            </span>
          </div>
          <p id="hit-run-confirm-desc" className="sc-copy sc-copy--center hit-run-confirm__desc">
            {HIT_RUN_CONFIRM_QUESTION} {HIT_RUN_CONFIRM_CONSEQUENCE}
          </p>
        </SpadeConsole>
      </div>
    </div>,
    document.body
  );
}
