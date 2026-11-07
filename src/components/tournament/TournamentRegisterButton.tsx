import type { ButtonHTMLAttributes } from 'react';
import { useFitText } from '../lobby/game-cards/useFitText';
import './TournamentRegisterButton.css';

/**
 * Live registration text on the compact plate derived from the approved master.
 *
 * TWO LINES FOR LATE REGISTRATION (Dan 2026-11-06, binding): "IT SHOULD SAY,
 * 1ST LINE 'LATE REGISTER' 2ND LINE X LEVELS REMAINING (NO "") MAKE SURE THE
 * FONT ON THE 2ND LINE IS SLIGHTLY SMALLER SO IT FITS." The countdown used to
 * ride in brackets on the same label and wrapped wherever it happened to break
 * ("LATE REGISTER (2 / LEVELS REMAINING)"). A `subline` now prints as its own
 * second line at a smaller size, with no brackets; both lines shrink together
 * if the plate is too narrow for the longer one.
 */
export function TournamentRegisterButton({
  children,
  subline,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: string;
  subline?: string;
}) {
  const textRef = useFitText<HTMLSpanElement>(
    subline ? `${children}\n${subline}` : children,
    1,
    0.55,
    subline ? {} : { wrapBelow: 0.85, maxLines: 2 }
  );
  return (
    <button
      type="button"
      className={`tournament-register-button ${className}`}
      aria-label={subline ? `${children}, ${subline}` : undefined}
      {...props}
    >
      <span className="tournament-register-button__face">
        {subline ? (
          <span
            className="tournament-register-button__text tournament-register-button__text--stacked"
            ref={textRef}
          >
            <span className="tournament-register-button__line">{children}</span>
            <span className="tournament-register-button__subline">{subline}</span>
          </span>
        ) : (
          <span className="tournament-register-button__text" ref={textRef}>
            {children}
          </span>
        )}
      </span>
    </button>
  );
}
