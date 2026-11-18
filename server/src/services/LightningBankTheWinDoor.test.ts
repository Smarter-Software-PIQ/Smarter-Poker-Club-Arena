import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./errorReporter.js', () => ({ reportError: () => undefined }));

import { startLightningBankTheWin, stopLightningBankTheWin } from './LightningBankTheWinDoor.js';
import {
  noteLightningHandForBankTheWin,
  resetLightningBankTheWin,
} from '../lightning/LightningBankTheWin.js';
import { bankTheWinMultiple } from './HorseBankTheWin.js';

const HORSE = 'horse-door-1';
const LINE = bankTheWinMultiple(HORSE) * 100;
const facts = (over: Record<string, unknown> = {}) => ({
  data: {
    found: true,
    table_id: 'anchor-1',
    stack: LINE + 1,
    leave_pending: false,
    start_basis: 100,
    hands_since_big_pot: 10,
    hands_owed: 0,
    blind_rank: 1,
    pool_players: 6,
    players_per_hand: 6,
    ...over,
  },
  error: null,
});
const ask = (session: string) =>
  noteLightningHandForBankTheWin({
    clusterId: 'c1',
    maxBuyIn: 100,
    participants: [
      {
        playerId: HORSE,
        poolSessionId: session,
        isHorse: true,
        blindRole: 'none',
        stackBefore: 100,
      },
    ],
    stacksAfter: new Map([[HORSE, LINE + 1]]),
  });
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  stopLightningBankTheWin();
  resetLightningBankTheWin();
  rpc.mockReset();
});

describe('the Lightning bank-the-win door', () => {
  it('leaves once through the ordinary Leave door when the pool facts say it is due', async () => {
    const leaveTable = vi.fn().mockResolvedValue({ success: true });
    startLightningBankTheWin(() => ({ leaveTable }));
    rpc.mockResolvedValue(facts());
    ask('ps-1');
    await flush();
    await flush();
    expect(leaveTable).toHaveBeenCalledTimes(1);
    expect(leaveTable).toHaveBeenCalledWith(HORSE);
    ask('ps-1');
    await flush();
    expect(leaveTable).toHaveBeenCalledTimes(1);
  });

  it('never sends a leave while hands are owed', async () => {
    const leaveTable = vi.fn();
    startLightningBankTheWin(() => ({ leaveTable }));
    rpc.mockResolvedValue(facts({ hands_owed: 4 }));
    ask('ps-2');
    await flush();
    await flush();
    expect(leaveTable).not.toHaveBeenCalled();
  });

  it('counts a refusal as one attempt and asks again on a later hand', async () => {
    const leaveTable = vi.fn().mockResolvedValue({ success: false, error: 'LEAVE_LOCKED' });
    startLightningBankTheWin(() => ({ leaveTable }));
    rpc.mockResolvedValue(facts());
    for (let i = 0; i < 4; i++) {
      ask('ps-3');
      await flush();
      await flush();
    }
    expect(leaveTable).toHaveBeenCalledTimes(3); // bounded
  });

  it('verifies an uncertain outcome instead of resending', async () => {
    const leaveTable = vi.fn().mockRejectedValue(new Error('timeout'));
    startLightningBankTheWin(() => ({ leaveTable }));
    rpc.mockResolvedValueOnce(facts()).mockResolvedValueOnce(facts({ leave_pending: true }));
    ask('ps-4');
    await flush();
    await flush();
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2); // read, then verify
    ask('ps-4');
    await flush();
    expect(leaveTable).toHaveBeenCalledTimes(1); // committed after all: never resent
  });
});
