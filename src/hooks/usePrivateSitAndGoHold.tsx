/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SIT & GO'S HELD SEATS, ON ITS OWN PAGE (2026-11-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A six or nine seat Sit & Go has no table until it starts, so where a Spin or
 * Heads Up shows its held seat on the felt (TablePage), a Sit & Go shows it
 * on its tournament page, with the same dialog (PrivateGameInviteModal):
 *
 *   held     the inviter, after Invite To Game (`?held=1`, or in place when
 *            the invite was made from this page): the time left, how many
 *            held seats still wait, the link with the hold's token, Share,
 *            Cancel Hold;
 *   invitee  a friend who opened that link (`?invite=<token>`) and is not
 *            registered: "Your Seat Is Held", Take Seat. Take Seat is admitted
 *            by fn_accept_private_game_invite and then registers through the
 *            page's ordinary Sign Up card and registration door;
 *   expired  the inviter, told in plain words when the hold runs out unused.
 *
 * Read on arrival and when the registration changes; one read at the hold's
 * end, never a poll. The database decides what happened.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PrivateGameInviteModal, type PrivateGameInviteStep } from '../components/table/PrivateGameInviteModal';
import {
  acceptPrivateGameInvite,
  cancelPrivateGameHold,
  isSitAndGoInviteFormat,
  privateGameRefusalText,
  privateSitAndGoInviteUrl,
  readPrivateGameHold,
  rememberPrivateInviteToken,
  type PrivateGameHold,
} from '../lib/privateGameInvite';

export interface SitAndGoHoldSubject {
  id: string;
  name?: string | null;
  status?: string | null;
  variant?: string | null;
  max_players?: number | null;
  format_contract?: unknown;
  started_at?: string | null;
}

export function usePrivateSitAndGoHold(opts: {
  tournament: SitAndGoHoldSubject | null;
  userId: string | null | undefined;
  isRegistered: boolean;
  /** The `invite` token this page was opened with, when it is the real route. */
  inviteToken: string | null;
  /** `?held=1`: the inviter arrived from Invite To Game. */
  heldParam: boolean;
  inviteCode: string | null | undefined;
  /** The page's ordinary registration (Sign Up card, then the door). */
  onRegister: () => void;
  notify?: (kind: 'success' | 'info' | 'error', message: string) => void;
}) {
  const { tournament, userId, isRegistered, inviteToken, heldParam, inviteCode, onRegister, notify } = opts;
  const [hold, setHold] = useState<PrivateGameHold | null>(null);
  const [step, setStep] = useState<PrivateGameInviteStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const tournamentId = tournament?.id ?? null;
  const open =
    !!tournament &&
    isSitAndGoInviteFormat(tournament) &&
    ['ANNOUNCED', 'REGISTERING'].includes(String(tournament.status ?? '').toUpperCase()) &&
    !tournament.started_at;
  const signedIn = !!userId && userId !== 'guest';

  useEffect(() => {
    if (tournamentId) rememberPrivateInviteToken(tournamentId, inviteToken);
  }, [tournamentId, inviteToken]);

  useEffect(() => {
    setHold(null);
    setStep(null);
    setError(null);
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId || !open || !signedIn) return;
    let cancelled = false;
    void (async () => {
      const next = await readPrivateGameHold(tournamentId, inviteToken);
      if (cancelled) return;
      setHold(next);
      if (!next?.live) return;
      if (next.isCreator && heldParam) setStep((s) => s ?? 'held');
      else if (!next.isCreator && next.tokenValid && !isRegistered) setStep((s) => s ?? 'invitee');
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, open, signedIn, inviteToken, heldParam, isRegistered]);

  /* When the inviter's hold runs out unanswered, say so in plain words. One
     read at the hold's end, not a poll: the database decides what happened. */
  useEffect(() => {
    if (!hold?.isCreator || !hold.live || hold.expiresAtMs === null || !tournamentId || !open) return;
    const timer = window.setTimeout(
      () => {
        void (async () => {
          const next = await readPrivateGameHold(tournamentId, null);
          setHold(next);
          if (next && next.outcome === 'expired') {
            setStep('expired');
            notifyRef.current?.('info', 'Your Friends Did Not Join In Time, The Held Seats Are Open Again');
          }
        })();
      },
      Math.max(1500, hold.expiresAtMs - Date.now() + 1500)
    );
    return () => window.clearTimeout(timer);
  }, [hold, tournamentId, open]);

  /** The invite was made on this page: show the held seats here. */
  const showHeld = useCallback((next: PrivateGameHold) => {
    setHold(next);
    setError(null);
    setStep('held');
  }, []);

  /** Invite To Game again while a hold is live: reopen it rather than start another. */
  const reopenHeld = useCallback((): boolean => {
    if (!hold?.isCreator || !hold.live) return false;
    setError(null);
    setStep('held');
    return true;
  }, [hold]);

  const cancel = useCallback(async () => {
    if (!tournamentId || busy) return;
    setBusy(true);
    try {
      if (await cancelPrivateGameHold(tournamentId)) {
        setHold((prev) => (prev ? { ...prev, live: false, outcome: 'cancelled' } : prev));
        setStep(null);
        notifyRef.current?.('info', 'Hold Cancelled, The Seats Are Open To Anyone');
      } else {
        setError('Could Not Cancel The Hold, Please Try Again');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, tournamentId]);

  /* The friend's Take Seat: admitted by the token first, before any money
     moves, then the page's ordinary registration, which the database's entry
     guard judges by the same rule. */
  const takeSeat = useCallback(async () => {
    if (!tournamentId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const admission = await acceptPrivateGameInvite(tournamentId, inviteToken);
      if (!admission.unavailable && !admission.allowed) {
        setError(privateGameRefusalText(admission.reason));
        return;
      }
      setStep(null);
      onRegister();
    } finally {
      setBusy(false);
    }
  }, [busy, inviteToken, onRegister, tournamentId]);

  const element =
    tournament && step ? (
      <PrivateGameInviteModal
        isOpen
        step={step}
        sitAndGo
        formatLabel={`${Number(tournament.max_players) || ''} Seat Sit N Go`.trim()}
        tableName={String(tournament.name ?? '')}
        costLabel=""
        maxHoldable={Math.max(1, (Number(tournament.max_players) || 2) - 1)}
        alreadySeated={isRegistered}
        hold={hold}
        inviteUrl={
          hold?.isCreator
            ? privateSitAndGoInviteUrl({
                tournamentId: hold.tournamentId,
                inviteToken: hold.inviteToken,
                inviteCode: inviteCode ?? null,
              })
            : ''
        }
        friendInviteTarget={null}
        busy={busy}
        errorMessage={error}
        onStart={() => undefined}
        onCancelHold={() => void cancel()}
        onTakeSeat={() => void takeSeat()}
        onClose={() => {
          if (busy) return;
          setStep(null);
          setError(null);
        }}
        onNotify={(kind, message) => notifyRef.current?.(kind, message)}
      />
    ) : null;

  return { element, hold, showHeld, reopenHeld };
}
