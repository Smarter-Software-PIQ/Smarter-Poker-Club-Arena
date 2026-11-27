/**
 * LAW: A MOVE VERDICT IS SENT ONCE (2026-11-26).
 *
 * "tournament move destination seat is occupied" was logged 72 times in the 24
 * hours to 2026-11-26 21:45 UTC, in pairs about 0.1 to 0.9 s apart (for
 * example 19:16:26.750 / 19:16:26.883, a
 * late entrant having taken chair 9 of table 87dc859e at 19:16:26.684).
 * moveTournamentPlayerAtomically submitted every request twice, even after a
 * definite refusal: the door (fn_move_tournament_player) checks the request's
 * receipt before it refuses, so the second identical request read the same
 * chair, took the event lane and both tables' rows again for nothing, and
 * logged a second ERROR. PR #11980 (live since 2026-11-25 07:02 UTC) then
 * correctly asks once more with a fresh chair and a NEW request id.
 *
 * A first-attempt definite refusal is now final for that identity. Lock
 * contention (55P03, 40001, 40P01) and routing failures (PGRST202/203), which
 * read nothing, are still sent once more, and so is anything after an
 * ambiguous attempt or when an earlier invocation left the outcome unknown,
 * where only a replayed receipt can settle it.
 *
 * Ships with the next certified engine cutover after merge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../services/supabase.js', () => ({ supabase: { rpc } }));

import {
  moveTournamentPlayerAtomically,
  TournamentSeatMoveOutcomeUnknownError,
  TournamentSeatMoveRefusedError,
} from './tournamentSeatMoveRpc.js';

const input = {
  requestId: '00000000-0000-4000-8000-0000000000e1',
  tournamentId: '00000000-0000-4000-8000-0000000000e2',
  userId: '00000000-0000-4000-8000-0000000000e3',
  sourceTableId: '00000000-0000-4000-8000-0000000000e4',
  destinationTableId: '00000000-0000-4000-8000-0000000000e5',
  destinationSeatNumber: 9,
  sourceMode: 'live_source' as const,
};
const OCCUPIED = { code: '23505', message: 'tournament move destination seat is occupied' };

describe('a move verdict is sent once', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('an occupied chair is one request and one refusal the manager can re-plan from', async () => {
    rpc.mockResolvedValue({ data: null, error: OCCUPIED });
    const err = await moveTournamentPlayerAtomically(input).catch((e) => e);
    expect(err).toBeInstanceOf(TournamentSeatMoveRefusedError);
    expect(String(err.message)).toMatch(/destination seat is occupied/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['55P03', '40001', '40P01', 'PGRST202', 'PGRST203'])(
    'contention or routing %s, which read nothing, is still sent once more',
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: 'busy' } });
      await expect(moveTournamentPlayerAtomically(input)).rejects.toBeInstanceOf(
        TournamentSeatMoveRefusedError
      );
      expect(rpc).toHaveBeenCalledTimes(2);
    }
  );

  it('contention then an occupied chair is two requests and a refusal', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '55P03', message: 'lock timeout' } })
      .mockResolvedValueOnce({ data: null, error: OCCUPIED });
    await expect(moveTournamentPlayerAtomically(input)).rejects.toBeInstanceOf(
      TournamentSeatMoveRefusedError
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('after an ambiguous attempt, a refusal never ends the uncertainty without the receipt lookup', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
    const fetchReceipt = vi.fn().mockResolvedValue(new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchReceipt);
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
      .mockResolvedValueOnce({ data: null, error: OCCUPIED });
    await expect(moveTournamentPlayerAtomically(input)).rejects.toBeInstanceOf(
      TournamentSeatMoveOutcomeUnknownError
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fetchReceipt).toHaveBeenCalledTimes(1);
  });

  it('an identity whose outcome was already unknown is still resent for its replayed receipt', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
    const fetchReceipt = vi.fn().mockResolvedValue(new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetchReceipt);
    rpc.mockResolvedValue({ data: null, error: OCCUPIED });
    await expect(
      moveTournamentPlayerAtomically(input, { outcomeWasAlreadyUnknown: true })
    ).rejects.toBeInstanceOf(TournamentSeatMoveOutcomeUnknownError);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
