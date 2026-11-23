/**
 * INVITE TO GAME FROM A LOBBY SURFACE (2026-11-22).
 *
 * The tournament page, the lobby cards and the lobby panel all offer Invite To
 * Game. For a Spin, a Heads Up or a satellite still taking seats, the invite
 * now holds a seat for the friend (src/lib/privateGameInvite.ts): the inviter
 * confirms the buy-in on the same "Invite A Friend" console the table uses,
 * the private game is opened (or their own seat held in place), and the
 * inviter is taken to that table - the answer to their own tap - where the
 * link with its token is waiting under "Seat Held For Your Friend".
 *
 * A SIT & GO TOO (2026-11-23). A six or nine seat Sit & Go (an ordinary one,
 * or a "Starts When Full" satellite run as one) holds up to seats - 1 seats
 * for the friends the inviter chooses, in place: the inviter is registered
 * through the normal registration door if they are not in it yet, and every
 * other seat still fills as usual. It has no table before it starts, so the
 * inviter lands on its tournament page, where the link is waiting under
 * "Seats Held For Your Friends" (usePrivateSitAndGoHold). A surface that is
 * already that page passes `onSitAndGoHeld` and opens it in place.
 *
 * `offer(row)` answers whether the private flow took the invite. When it
 * answers false (another format, a started game, an engine that does not
 * honour held seats) the surface shares its ordinary link exactly as before.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppNavigate } from '../context/InTabLobbyContext';
import { PrivateGameInviteModal } from '../components/table/PrivateGameInviteModal';
import {
  inviteToPrivateGame,
  isPrivateInviteFormat,
  isSitAndGoInviteFormat,
  privateGameHoldsSupported,
  privateGameRefusalText,
  privateSeatsChoosable,
  privateSeatsHoldable,
  privateSitAndGoHoldsSupported,
  type PrivateGameHold,
} from '../lib/privateGameInvite';

export interface PrivateInviteRow {
  id: string;
  name?: string | null;
  status?: string | null;
  variant?: string | null;
  max_players?: number | null;
  maxPlayers?: number | null;
  format_contract?: unknown;
  /** Entries already in the field, when the surface knows them (bounds the friend chooser). */
  current_players?: number | null;
  buy_in_amount?: number | string | null;
  buy_in_fee?: number | string | null;
  started_at?: string | null;
  /** The inviter already holds an entry here: their own seat is held in place, nothing is bought. */
  alreadySeated?: boolean;
}

interface Target {
  tournamentId: string;
  name: string;
  seats: number;
  cost: number;
  spin: boolean;
  sitAndGo: boolean;
  maxHoldable: number;
  alreadySeated: boolean;
}

export function usePrivateGameInviteLauncher(
  notify?: (kind: 'success' | 'error', message: string) => void,
  /** The surface is this Sit & Go's own page: show the held seats there instead of navigating. */
  onSitAndGoHeld?: (hold: PrivateGameHold) => void
) {
  const navigate = useAppNavigate();
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask the engine once up front, so the tap that invites reads a settled
  // answer and a share sheet opened from it keeps the tap's activation.
  useEffect(() => {
    void privateGameHoldsSupported();
  }, []);

  const offer = useCallback(async (row: PrivateInviteRow | null | undefined): Promise<boolean> => {
    if (!row?.id || !isPrivateInviteFormat(row)) return false;
    const status = String(row.status ?? '').toUpperCase();
    if ((status && !['ANNOUNCED', 'REGISTERING'].includes(status)) || row.started_at) return false;
    const sitAndGo = isSitAndGoInviteFormat(row);
    if (!(await (sitAndGo ? privateSitAndGoHoldsSupported() : privateGameHoldsSupported())))
      return false;
    const seats = Number(row.max_players ?? row.maxPlayers ?? 0);
    const alreadySeated = row.alreadySeated === true;
    setError(null);
    setTarget({
      tournamentId: row.id,
      name: String(row.name ?? ''),
      seats,
      // Printed only when the surface knows the exact price; the charge is the seat door's.
      cost:
        row.buy_in_amount === undefined ? NaN : Number(row.buy_in_amount ?? 0) + Number(row.buy_in_fee ?? 0),
      spin: String(row.variant ?? '').toLowerCase() === 'spin',
      sitAndGo,
      maxHoldable: sitAndGo
        ? privateSeatsChoosable(seats, row.current_players ?? null, alreadySeated)
        : privateSeatsHoldable(seats),
      alreadySeated,
    });
    return true;
  }, []);

  const start = useCallback(
    async (seatsHeld: number) => {
      if (!target || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await inviteToPrivateGame(target.tournamentId, seatsHeld);
        if (res.ok && res.sitAndGo && res.hold) {
          setTarget(null);
          notify?.(
            'success',
            res.registered ? 'You Are Registered, Seats Held For Your Friends' : 'Seats Held For Your Friends'
          );
          if (onSitAndGoHeld) onSitAndGoHeld(res.hold);
          else navigate(`/tournaments/${encodeURIComponent(res.hold.tournamentId)}?held=1`);
          return;
        }
        if (!res.ok || !res.hold?.tableId) {
          setError(privateGameRefusalText(res.reason));
          return;
        }
        setTarget(null);
        notify?.(
          'success',
          res.created ? 'Private Game Opened, Your Seat Is Bought' : 'Seat Held For Your Friend'
        );
        navigate(`/table/${res.hold.tableId}?held=1`);
      } catch {
        setError(privateGameRefusalText(undefined));
      } finally {
        setBusy(false);
      }
    },
    [busy, navigate, notify, onSitAndGoHeld, target]
  );

  /* Wrapped so a tap inside the dialog never also reaches the card or
     backdrop the surface rendered it in (their own click handlers). */
  const element = target ? (
    <span onClick={(e) => e.stopPropagation()}>
    <PrivateGameInviteModal
      isOpen
      step="start"
      formatLabel={
        target.spin ? 'Spin' : target.seats === 2 ? 'Heads Up Sit N Go' : `${target.seats} Seat Sit N Go`
      }
      sitAndGo={target.sitAndGo}
      tableName={target.name}
      costLabel={Number.isFinite(target.cost) && target.cost > 0 ? target.cost.toLocaleString() : ''}
      maxHoldable={target.maxHoldable}
      alreadySeated={target.alreadySeated}
      hold={null}
      inviteUrl=""
      busy={busy}
      errorMessage={error}
      onStart={(seats) => void start(seats)}
      onCancelHold={() => undefined}
      onTakeSeat={() => undefined}
      onClose={() => {
        if (!busy) setTarget(null);
      }}
    />
    </span>
  ) : null;

  return { offer, element };
}
