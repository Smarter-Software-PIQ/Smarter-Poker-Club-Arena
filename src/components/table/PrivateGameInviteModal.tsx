/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRIVATE GAME INVITE MODAL — A Seat Held For Your Friend (2026-11-22)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Invite To Game on a Spin, a Heads Up or a Heads Up satellite holds a seat for
 * the friend the inviter sends the link to (src/lib/privateGameInvite.ts). This
 * one dialog carries every moment of it, on the same SpadeConsole chassis and
 * plates as HeadsUpWaitingModal (no new painted art, no CSS control):
 *
 *   start    the inviter confirms: buy in now (or keep the seat already
 *            bought) and hold 1 seat, or 2 at a Spin;
 *   held     "Seat Held For Your Friend", the time left, the link, Share,
 *            Cancel Hold, and the one-tap online friend invite;
 *   invitee  the friend's landing: "Your Seat Is Held", Take Seat;
 *   expired  the inviter told in plain words that the hold ran out.
 *
 * A SIT & GO (2026-11-23, `sitAndGo`): up to seats - 1 seats are held in a six
 * or nine seat field, so `start` carries a friend count (Fewer / More, the
 * dialog's existing inline buttons, no new paint) and the words say what a
 * Sit & Go does: the inviter registers, the held seats wait for the friends,
 * every other seat fills as usual, and the game starts when every seat is
 * taken.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText, gameInviteText, hasShareSheet, shareButtonLabel, shareLink } from '../../lib/share';
import { formatHoldRemaining, type PrivateGameHold } from '../../lib/privateGameInvite';
import { ShareLinkFallback } from '../common/ShareLinkFallback';
import { SpadeConsole } from '../console/SpadeConsole';
import { OnlineFriendInvitePicker } from './OnlineFriendInvitePicker';
import './HeadsUpWaitingModal.css';

export type PrivateGameInviteStep = 'start' | 'held' | 'invitee' | 'expired';

export interface PrivateGameInviteModalProps {
  isOpen: boolean;
  step: PrivateGameInviteStep;
  /** "Spin", "Heads Up Sit N Go", "Satellite". */
  formatLabel: string;
  tableName: string;
  /** The buy-in as the player reads it, e.g. "10". Empty when already seated. */
  costLabel: string;
  /** 1 at a Heads Up, 2 at a Spin, up to seats - 1 at a Sit & Go. */
  maxHoldable: number;
  /** A six or nine seat Sit & Go, held in place: registration words, a friend count. */
  sitAndGo?: boolean;
  /** The inviter already owns a seat at this game: nothing more is bought. */
  alreadySeated: boolean;
  hold: PrivateGameHold | null;
  inviteUrl: string;
  friendInviteTarget?: {
    tableId: string;
    tournamentId?: string | null;
    clubId?: string | null;
    inviteCode?: string | null;
    inviteToken?: string | null;
  } | null;
  busy?: boolean;
  errorMessage?: string | null;
  onStart: (seatsHeld: number) => void;
  onCancelHold: () => void;
  onTakeSeat: () => void;
  onClose: () => void;
  onNotify?: (kind: 'success' | 'info', message: string) => void;
}

export function PrivateGameInviteModal({
  isOpen,
  step,
  formatLabel,
  tableName,
  costLabel,
  maxHoldable,
  sitAndGo = false,
  alreadySeated,
  hold,
  inviteUrl,
  friendInviteTarget,
  busy = false,
  errorMessage = null,
  onStart,
  onCancelHold,
  onTakeSeat,
  onClose,
  onNotify,
}: PrivateGameInviteModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /* How many friends a Sit & Go holds for. Starts at one; never above what
     the field can hold. The database bounds it again under its lock. */
  const most = Math.max(1, Math.floor(maxHoldable) || 1);
  const [friends, setFriends] = useState(1);
  useEffect(() => {
    setFriends((n) => Math.min(Math.max(1, n), most));
  }, [most]);
  useEffect(() => {
    if (step === 'start') setFriends(1);
  }, [step, isOpen]);

  useEffect(() => {
    setCopied(false);
    setFallbackUrl('');
  }, [inviteUrl, step]);

  // The countdown the player reads. Display only: the database owns the end.
  useEffect(() => {
    if (!isOpen || (step !== 'held' && step !== 'invitee')) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isOpen, step]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open && dialog.isConnected && typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          /* already modal or detached mid-transition */
        }
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  const share = useCallback(async () => {
    setFallbackUrl('');
    const outcome = await shareLink({
      source: 'PrivateGameInviteModal.share',
      title: tableName || formatLabel,
      text: gameInviteText(tableName || formatLabel),
      url: inviteUrl,
    });
    if (outcome === 'copied') {
      setCopied(true);
      onNotify?.('success', 'Game Invite Link Copied');
    } else if (outcome === 'shared') {
      onNotify?.('success', 'Game Invite Link Shared');
    } else if (outcome === 'failed') {
      setFallbackUrl(inviteUrl);
    }
  }, [formatLabel, inviteUrl, onNotify, tableName]);

  const copyOnly = useCallback(async () => {
    setFallbackUrl('');
    if (await copyText(inviteUrl, 'PrivateGameInviteModal.copy')) {
      setCopied(true);
      onNotify?.('success', 'Game Invite Link Copied');
    } else {
      setFallbackUrl(inviteUrl);
    }
  }, [inviteUrl, onNotify]);

  const left = formatHoldRemaining(hold?.expiresAtMs ?? null, now);
  const seatsWord = (hold?.seatsHeld ?? 1) === 1 ? 'Seat' : 'Seats';
  const friendsWord = friends === 1 ? 'Seat' : 'Seats';

  let body = null;
  if (step === 'start' && sitAndGo) {
    body = (
      <SpadeConsole
        as="div"
        onClose={onClose}
        eyebrow={formatLabel}
        title="Invite Your Friends"
        titleId="private-invite-title"
        pill="Seats Held"
        pillInk="gold"
        plates={{
          secondary: { label: 'Not Now', disabled: busy, onClick: onClose },
          primary: {
            ink: 'white',
            label: busy ? 'Holding Seats...' : `Hold ${friends} ${friendsWord}`,
            disabled: busy,
            onClick: () => onStart(friends),
          },
        }}
      >
        <p className="hu-waiting-dialog__prompt">
          {alreadySeated
            ? 'Your Entry Is Already Bought. Choose How Many Seats To Hold For The Friends You Send The Link To.'
            : `You Register ${costLabel ? `For ${costLabel} ` : 'At The Normal Price '}Now, And The Seats You Choose Are Held For The Friends You Send The Link To.`}
        </p>
        {most > 1 && (
          <div className="hu-waiting-dialog__linkbox" data-testid="private-invite-friend-count">
            <button
              type="button"
              className="hu-waiting-dialog__copy-inline"
              disabled={busy || friends <= 1}
              onClick={() => setFriends((n) => Math.max(1, n - 1))}
            >
              Fewer
            </button>
            <span className="hu-waiting-dialog__url" aria-live="polite">
              {`${friends} ${friends === 1 ? 'Friend' : 'Friends'} Of Up To ${most}`}
            </span>
            <button
              type="button"
              className="hu-waiting-dialog__copy-inline"
              disabled={busy || friends >= most}
              onClick={() => setFriends((n) => Math.min(most, n + 1))}
            >
              More
            </button>
          </div>
        )}
        <p className="hu-waiting-dialog__hint">
          Nobody Else Can Take A Held Seat For 10 Minutes, And Every Other Seat Fills As Usual. The
          Game Starts When Every Seat Is Taken. If Your Friends Do Not Register In Time, The Held
          Seats Open And The Game Fills As Usual.
        </p>
        {errorMessage && (
          <p className="hu-waiting-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
      </SpadeConsole>
    );
  } else if (step === 'start') {
    body = (
      <SpadeConsole
        as="div"
        onClose={onClose}
        eyebrow={formatLabel}
        title="Invite A Friend"
        titleId="private-invite-title"
        pill="Private Game"
        pillInk="gold"
        plates={{
          secondary:
            maxHoldable >= 2
              ? { label: 'Hold 2 Seats', disabled: busy, onClick: () => onStart(2) }
              : { label: 'Not Now', disabled: busy, onClick: onClose },
          primary: {
            ink: 'white',
            label: busy ? 'Holding Seat...' : maxHoldable >= 2 ? 'Hold 1 Seat' : 'Hold The Seat',
            disabled: busy,
            onClick: () => onStart(1),
          },
        }}
      >
        <p className="hu-waiting-dialog__prompt">
          {alreadySeated
            ? 'Your Seat Is Already Bought. The Open Seat Is Held For The Friend You Send The Link To.'
            : `You Buy In ${costLabel ? `For ${costLabel} ` : 'At The Normal Price '}Now At A Private Table Of This Game, And The Other Seat Is Held For The Friend You Send The Link To.`}
        </p>
        <p className="hu-waiting-dialog__hint">
          Nobody Else Can Take A Held Seat For 10 Minutes. If Your Friend Does Not Sit Down In
          Time, The Seat Opens And The Game Fills As Usual.
        </p>
        {errorMessage && (
          <p className="hu-waiting-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
      </SpadeConsole>
    );
  } else if (step === 'held') {
    body = (
      <SpadeConsole
        as="div"
        onClose={onClose}
        eyebrow={formatLabel}
        title={`${seatsWord} Held For Your Friend`}
        titleId="private-invite-title"
        pill={`${left} Left`}
        pillInk="blue"
        plates={{
          secondary: { label: 'Cancel Hold', disabled: busy, onClick: onCancelHold },
          primary: {
            ink: 'white',
            label: copied ? 'Link Copied' : shareButtonLabel(),
            onClick: () => void share(),
          },
        }}
      >
        <p className="hu-waiting-dialog__prompt">
          {sitAndGo
            ? `Send This Link To Your Friends. Nobody Else Can Take The Held ${seatsWord} Until The Time Runs Out, And The Game Starts When Every Seat Is Taken.`
            : `Send This Link To Your Friend. The Game Starts When They Sit Down, And Nobody Else Can Take The Held ${seatsWord} Until The Time Runs Out.`}
        </p>
        {sitAndGo && hold && hold.heldOpen > 0 && (
          <p className="hu-waiting-dialog__hint">
            {`${hold.heldOpen} Held ${hold.heldOpen === 1 ? 'Seat Is' : 'Seats Are'} Still Waiting For Your Friends.`}
          </p>
        )}
        <div className="hu-waiting-dialog__linkbox">
          <span className="hu-waiting-dialog__url">{inviteUrl}</span>
          {hasShareSheet() && (
            <button type="button" className="hu-waiting-dialog__copy-inline" onClick={() => void copyOnly()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        {fallbackUrl && (
          <div className="hu-waiting-dialog__fallback">
            <ShareLinkFallback url={fallbackUrl} label="Game Invite Link" />
          </div>
        )}
        {errorMessage && (
          <p className="hu-waiting-dialog__error" role="alert">
            {errorMessage}
          </p>
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
                tableName={tableName || formatLabel}
                inviteCode={friendInviteTarget.inviteCode}
                inviteToken={friendInviteTarget.inviteToken}
                onInviteSent={(contact) => onNotify?.('success', `Invite Sent To ${contact.displayName}`)}
              />
            )}
          </div>
        )}
      </SpadeConsole>
    );
  } else if (step === 'invitee') {
    body = (
      <SpadeConsole
        as="div"
        onClose={onClose}
        eyebrow={formatLabel}
        title="Your Seat Is Held"
        titleId="private-invite-title"
        pill={`${left} Left`}
        pillInk="gold"
        plates={{
          secondary: { label: 'Not Now', disabled: busy, onClick: onClose },
          primary: { ink: 'white', label: busy ? 'Opening Seat...' : 'Take Seat', disabled: busy, onClick: onTakeSeat },
        }}
      >
        <p className="hu-waiting-dialog__prompt">
          {`${hold?.inviterName || 'Your Friend'} Is Holding A Seat For You At This Table.`}
        </p>
        <p className="hu-waiting-dialog__hint">
          {sitAndGo
            ? 'Take It Before The Time Runs Out. You Register At The Normal Price, And The Game Starts When Every Seat Is Taken.'
            : 'Take It Before The Time Runs Out. You Buy In At The Normal Price When You Sit Down.'}
        </p>
        {errorMessage && (
          <p className="hu-waiting-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
      </SpadeConsole>
    );
  } else {
    body = (
      <SpadeConsole
        as="div"
        onClose={onClose}
        eyebrow={formatLabel}
        title={sitAndGo ? 'Your Friends Did Not Join In Time' : 'Your Friend Did Not Join In Time'}
        titleId="private-invite-title"
        pill="Seat Open"
        pillInk="silver"
        plates={{ primary: { ink: 'white', label: 'OK', onClick: onClose } }}
      >
        <p className="hu-waiting-dialog__prompt">
          {sitAndGo
            ? 'The Held Seats Are Open Again. The Game Will Fill And Start As Usual, And You Keep Your Entry.'
            : 'The Held Seat Is Open Again. The Game Will Fill And Start As Usual, And You Keep Your Seat.'}
        </p>
      </SpadeConsole>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="hu-waiting-dialog"
      aria-labelledby="private-invite-title"
      data-testid="private-game-invite-modal"
      data-step={step}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {isOpen && <div className="hu-waiting-dialog__shell">{body}</div>}
    </dialog>
  );
}
