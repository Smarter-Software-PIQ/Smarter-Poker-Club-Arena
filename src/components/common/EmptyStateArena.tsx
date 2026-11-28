/**
 * THE ARENA STATE SCREENS (#SmarterDesign batch U1, 2026-11-28)
 *
 * EmptyState, ErrorState and LoadingState as an arena page prints them: the
 * same words, roles, live regions and keys as the beacon panel in
 * EmptyState.tsx, on the arena kit's chrome state screen (ArenaOps.css,
 * .arena-ops-state). A separate module on purpose: EmptyState.tsx is in the
 * entry chunk, so its dress would reach every player's first paint. This
 * file and its sheets are imported only by the arena pages that use them, so
 * they ride those pages' lazy chunks. Render them only inside an
 * `.arena-workspace` root; every rule of the dress is scoped under it.
 */
import type { ReactNode } from 'react';
import { formatPopupText } from '../../utils/popupStyle';
import type { EmptyStateTone } from './EmptyState';
import '../ops/ArenaOps.css';
import './EmptyStateArena.css';

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  icon?: ReactNode;
  eyebrow?: string;
  tone?: EmptyStateTone;
  title: string;
  description?: string;
  action?: Action;
  secondaryAction?: Action;
  children?: ReactNode;
}

export function ArenaEmptyState({
  icon,
  eyebrow = 'Club Arena',
  tone = 'empty',
  title,
  description,
  action,
  secondaryAction,
  children,
}: Props) {
  return (
    <section
      className={`arena-ops-state arena-empty-state arena-empty-state--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="arena-empty-state__badge" aria-hidden="true">
        {icon || 'SP'}
      </span>
      <span className="arena-empty-state__eyebrow">{formatPopupText(eyebrow)}</span>
      <h3 className="arena-ops-state__title">{formatPopupText(title)}</h3>
      {description && <p className="arena-ops-state__message">{formatPopupText(description)}</p>}
      {(action || secondaryAction) && (
        <div className="arena-switch arena-ops-keys arena-ops-primary">
          {action && (
            <button type="button" onClick={action.onClick}>
              {formatPopupText(action.label)}
            </button>
          )}
          {secondaryAction && (
            <button type="button" onClick={secondaryAction.onClick}>
              {formatPopupText(secondaryAction.label)}
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function ArenaLoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="arena-ops-state arena-empty-state" role="status" aria-live="polite">
      <span className="arena-ops-state__meter" aria-hidden="true" />
      <p className="arena-ops-state__message">{formatPopupText(message)}</p>
    </div>
  );
}

export function ArenaErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <ArenaEmptyState
      icon="FAULT"
      eyebrow="Recovery Required"
      tone="error"
      title="This Surface Could Not Load"
      description={message}
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
    />
  );
}
