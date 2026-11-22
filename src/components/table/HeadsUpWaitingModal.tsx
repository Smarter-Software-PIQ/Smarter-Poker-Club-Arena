/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HEADS UP WAITING MODAL — Empty Heads-Up Sit N Go Opponent Choice & Invite
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * When a player sits down at an empty Heads-Up Sit N Go, asks whether they are
 * waiting for a specific player to join or want to play against anyone.
 * Choosing "Specific Player" immediately surfaces the table's direct invite
 * link with Copy / Share routed through src/lib/share.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  copyText,
  gameInviteText,
  hasShareSheet,
  shareButtonLabel,
  shareLink,
} from '../../lib/share';
import { ShareLinkFallback } from '../common/ShareLinkFallback';
import { SpadeConsole } from '../console/SpadeConsole';
import { OnlineFriendInvitePicker } from './OnlineFriendInvitePicker';
import './HeadsUpWaitingModal.css';

export type HeadsUpWaitMode = 'specific' | 'anyone';

export interface HeadsUpFriendInviteTarget {
  tableId: string;
  tournamentId?: string | null;
  clubId?: string | null;
  inviteCode?: string | null;
  inviteToken?: string | null;
}

export interface HeadsUpWaitingModalProps {
  isOpen: boolean;
  /** 'choice' asks specific vs anyone; 'invite' jumps straight to the invite link. */
  initialStep?: 'choice' | 'invite';
  tableName: string;
  inviteUrl: string;
  /** Optional target context enabling inline one-tap online friend invites. */
  friendInviteTarget?: HeadsUpFriendInviteTarget | null;
  /** True while persisting the player's wait-mode choice to the server. */
  busy?: boolean;
  /** Honest inline error when persisting wait mode failed. */
  errorMessage?: string | null;
  onChooseSpecific: () => void | boolean | Promise<boolean | void>;
  onChooseAnyone: () => void | boolean | Promise<boolean | void>;
  onClose: () => void;
  onNotify?: (kind: 'success' | 'info', message: string) => void;
}

export function HeadsUpWaitingModal({
  isOpen,
  initialStep = 'choice',
  tableName,
  inviteUrl,
  friendInviteTarget,
  busy = false,
  errorMessage = null,
  onChooseSpecific,
  onChooseAnyone,
  onClose,
  onNotify,
}: HeadsUpWaitingModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(false);
  const [step, setStep] = useState<'choice' | 'invite'>(initialStep);
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize the step only when transitioning from closed -> open so changing
  // parent props while the modal is already open on 'invite' never bounces the
  // player back to the 'choice' step.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep(initialStep);
      setCopied(false);
      setFallbackUrl('');
      setShowFriendPicker(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialStep]);

  useEffect(() => {
    setCopied(false);
    setFallbackUrl('');
  }, [inviteUrl]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  // Sync open state with the native top-layer <dialog> API.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open && dialog.isConnected && typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          /* ignore InvalidStateError if already modal or detached mid-transition */
        }
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen]);

  // Listen for native close (Esc, backdrop light dismiss, programmatic close).
  // Use a ref so parent render ticks never tear down and rebind this listener.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = '';
      onCloseRef.current();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  // Progressive enhancement fallback for Safari where <dialog closedby="any">
  // is not yet implemented: require press AND release outside the dialog box.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof HTMLDialogElement === 'undefined') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = outside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const markCopied = useCallback(() => {
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2400);
  }, []);

  const handleCopyOnly = useCallback(async () => {
    setFallbackUrl('');
    const ok = await copyText(inviteUrl, 'HeadsUpWaitingModal.copy');
    if (ok) {
      markCopied();
      onNotify?.('success', 'Game Invite Link Copied');
    } else {
      setFallbackUrl(inviteUrl);
    }
  }, [inviteUrl, markCopied, onNotify]);

  const handlePrimaryShare = useCallback(async () => {
    setFallbackUrl('');
    const outcome = await shareLink({
      source: 'HeadsUpWaitingModal.share',
      title: tableName || 'Heads Up Sit N Go',
      text: gameInviteText(tableName || 'Heads Up Sit N Go'),
      url: inviteUrl,
    });
    if (outcome === 'copied') {
      markCopied();
      onNotify?.('success', 'Game Invite Link Copied');
    } else if (outcome === 'shared') {
      onNotify?.('success', 'Game Invite Link Shared');
    } else if (outcome === 'failed') {
      setFallbackUrl(inviteUrl);
    }
  }, [inviteUrl, markCopied, onNotify, tableName]);

  const handlePickSpecific = useCallback(() => {
    if (busy) return;
    const result = onChooseSpecific();
    if (result && typeof (result as Promise<boolean | void>).then === 'function') {
      void (result as Promise<boolean | void>).then((ok) => {
        if (ok !== false) setStep('invite');
      });
      return;
    }
    if (result !== false) setStep('invite');
  }, [busy, onChooseSpecific]);

  const handlePickAnyone = useCallback(() => {
    if (busy) return;
    const result = onChooseAnyone();
    if (result && typeof (result as Promise<boolean | void>).then === 'function') {
      void (result as Promise<boolean | void>).then((ok) => {
        if (ok !== false) onClose();
      });
      return;
    }
    if (result !== false) onClose();
  }, [busy, onChooseAnyone, onClose]);

  const showShareSheet = hasShareSheet();

  return (
    <dialog
      ref={dialogRef}
      className="hu-waiting-dialog"
      aria-labelledby="hu-waiting-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {isOpen && (
        <div className="hu-waiting-dialog__shell">
          {step === 'choice' ? (
            <SpadeConsole
              as="div"
              onClose={onClose}
              eyebrow="Heads Up Sit N Go"
              title="Waiting For Opponent"
              titleId="hu-waiting-title"
              pill="1 / 2 Seated"
              pillInk="gold"
              plates={{
                secondary: {
                  label: 'Play Anyone',
                  disabled: busy,
                  onClick: handlePickAnyone,
                },
                primary: {
                  ink: 'white',
                  label: 'Specific Player',
                  disabled: busy,
                  onClick: handlePickSpecific,
                },
              }}
            >
              <p className="hu-waiting-dialog__prompt">
                Are You Waiting For A Specific Player To Join, Or Do You Want To Play Against
                Anyone?
              </p>
              <p className="hu-waiting-dialog__hint">
                Choose Specific Player To Get An Invite Link You Can Send Directly To Your Opponent.
              </p>
              {errorMessage && (
                <p className="hu-waiting-dialog__error" role="alert">
                  {errorMessage}
                </p>
              )}
            </SpadeConsole>
          ) : (
            <SpadeConsole
              as="div"
              onClose={onClose}
              eyebrow="Heads Up Sit N Go"
              title="Invite Player"
              titleId="hu-waiting-title"
              pill="Holding Seat"
              pillInk="blue"
              plates={{
                secondary: {
                  label: 'Done',
                  onClick: onClose,
                },
                primary: {
                  ink: 'white',
                  label: copied ? 'Link Copied' : shareButtonLabel(),
                  onClick: () => void handlePrimaryShare(),
                },
              }}
            >
              <p className="hu-waiting-dialog__prompt">
                Send This Invite Link To Your Opponent So They Can Sit Directly Across From You.
              </p>
              <div className="hu-waiting-dialog__linkbox">
                <span className="hu-waiting-dialog__url">{inviteUrl}</span>
                {showShareSheet && (
                  <button
                    type="button"
                    className="hu-waiting-dialog__copy-inline"
                    onClick={() => void handleCopyOnly()}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {fallbackUrl && (
                <div className="hu-waiting-dialog__fallback">
                  <ShareLinkFallback url={fallbackUrl} label="Game Invite Link" />
                </div>
              )}
              {friendInviteTarget?.tableId && (
                <div className="hu-waiting-dialog__friends-section">
                  <button
                    type="button"
                    className="hu-waiting-dialog__friends-toggle"
                    aria-expanded={showFriendPicker}
                    onClick={() => setShowFriendPicker((prev) => !prev)}
                  >
                    {showFriendPicker ? 'Hide Online Friends' : 'Invite Online Friend'}
                  </button>
                  {showFriendPicker && (
                    <OnlineFriendInvitePicker
                      mode="inline"
                      kind="tournament"
                      tableId={friendInviteTarget.tableId}
                      tournamentId={friendInviteTarget.tournamentId}
                      clubId={friendInviteTarget.clubId}
                      tableName={tableName || 'Heads Up Sit N Go'}
                      inviteCode={friendInviteTarget.inviteCode}
                      inviteToken={friendInviteTarget.inviteToken}
                      onInviteSent={(contact) =>
                        onNotify?.('success', `Invite Sent To ${contact.displayName}`)
                      }
                    />
                  )}
                </div>
              )}
            </SpadeConsole>
          )}
        </div>
      )}
    </dialog>
  );
}
