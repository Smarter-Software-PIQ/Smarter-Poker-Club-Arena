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
  privateGameHoldsSupported,
  privateGameRefusalText,
  privateSeatsHoldable,
} from '../lib/privateGameInvite';

export interface PrivateInviteRow {
  id: string;
  name?: string | null;
  status?: string | null;
  variant?: string | null;
  max_players?: number | null;
  maxPlayers?: number | null;
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
  alreadySeated: boolean;
}

export function usePrivateGameInviteLauncher(notify?: (kind: 'success' | 'error', message: string) => void) {
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
    if (!(await privateGameHoldsSupported())) return false;
    setError(null);
    setTarget({
      tournamentId: row.id,
      name: String(row.name ?? ''),
      seats: Number(row.max_players ?? row.maxPlayers ?? 0),
      // Printed only when the surface knows the exact price; the charge is the seat door's.
      cost:
        row.buy_in_amount === undefined ? NaN : Number(row.buy_in_amount ?? 0) + Number(row.buy_in_fee ?? 0),
      spin: String(row.variant ?? '').toLowerCase() === 'spin',
      alreadySeated: row.alreadySeated === true,
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
    [busy, navigate, notify, target]
  );

  /* Wrapped so a tap inside the dialog never also reaches the card or
     backdrop the surface rendered it in (their own click handlers). */
  const element = target ? (
    <span onClick={(e) => e.stopPropagation()}>
    <PrivateGameInviteModal
      isOpen
      step="start"
      formatLabel={target.spin ? 'Spin' : target.seats === 2 ? 'Heads Up Sit N Go' : 'Sit N Go'}
      tableName={target.name}
      costLabel={Number.isFinite(target.cost) && target.cost > 0 ? target.cost.toLocaleString() : ''}
      maxHoldable={privateSeatsHoldable(target.seats)}
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
