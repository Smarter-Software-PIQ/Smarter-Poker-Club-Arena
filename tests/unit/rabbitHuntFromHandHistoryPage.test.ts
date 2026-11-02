/**
 * PREVIOUS-HAND RABBIT HUNT FROM THE HAND HISTORY PAGE (Dan 2026-11-01).
 *
 * The full Hand History page opened HandDetailModal with no rabbit handler,
 * so the Rabbit Hunt block never rendered on the one screen built for
 * previous hands. These pin the wiring and the purchase mapping; the engine
 * remains the authority on who may buy what.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const requestRabbitHunt = vi.fn();
const readRabbitHuntReceipt = vi.fn();
vi.mock('../../src/services/GameServerAPI', () => ({
  requestRabbitHunt: (...a: unknown[]) => requestRabbitHunt(...a),
  readRabbitHuntReceipt: (...a: unknown[]) => readRabbitHuntReceipt(...a),
}));

import {
  buyReplayRabbitHunt,
  readReplayRabbitReceipt,
} from '../../src/components/table/replayRabbitPurchase';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const squash = (t: string) => t.replace(/\s+/g, '');

beforeEach(() => {
  requestRabbitHunt.mockReset();
  readRabbitHuntReceipt.mockReset();
});

describe('the purchase the history page makes', () => {
  it('buys the named hand at the named table through the shared request', async () => {
    requestRabbitHunt.mockResolvedValue({
      success: true,
      cards: [{ rank: 'A', suit: 's' }],
      source: 'lifetime_vip',
      diamonds_spent: 0,
      vip_remaining: null,
      uses_remaining: null,
    });
    const r = await buyReplayRabbitHunt('table-1', 4242);
    expect(requestRabbitHunt).toHaveBeenCalledWith('table-1', 4242);
    expect(r.success).toBe(true);
    expect(r.cards).toHaveLength(1);
    expect(r.diamondsSpent).toBe(0);
  });

  it('passes the engine refusal through, and names an unloaded table plainly', async () => {
    requestRabbitHunt.mockResolvedValue({
      success: false,
      error: 'Rabbit Hunting A Previous Hand Is A VIP Feature',
    });
    expect((await buyReplayRabbitHunt('t', 1)).error).toBe(
      'Rabbit Hunting A Previous Hand Is A VIP Feature'
    );
    requestRabbitHunt.mockResolvedValue({ success: false, error: 'Table Not Ready' });
    expect((await buyReplayRabbitHunt('t', 1)).error).toBe(
      'Rabbit Hunt Is No Longer Available For That Hand'
    );
  });

  it('restores a reveal this login already bought, without a request', async () => {
    readRabbitHuntReceipt.mockResolvedValue({ success: true, cards: [{ rank: 'K', suit: 'h' }] });
    const r = await readReplayRabbitReceipt('t', 9);
    expect(r?.source).toBe('already_revealed');
    expect(requestRabbitHunt).not.toHaveBeenCalled();
  });
});

describe('the wiring', () => {
  it('the page hands the modal the purchase, the receipt, the player and the VIP flag', () => {
    const page = squash(read('src/pages/HandHistoryPage.tsx'));
    expect(page).toContain(squash('buyReplayRabbitHunt(detailHand.tableId as string, handNumber)'));
    expect(page).toContain(
      squash('readReplayRabbitReceipt(detailHand.tableId as string, handNumber)')
    );
    expect(page).toContain(squash('rabbitUserId={userId}'));
    expect(page).toContain(squash('rabbitIsVIP={viewerIsVip}'));
  });

  it("the adapter carries the hand's table, which the engine keys a run-out by", () => {
    expect(squash(read('src/lib/handHistoryAdapter.ts'))).toContain(
      squash('tableId: h.table_id ?? null')
    );
  });
});
