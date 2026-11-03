import { describe, it, expect, vi } from 'vitest';
import { cashVariantVisible } from '../../src/components/lobby/cashBoardVisibility';
import { cashBoardComparator } from '../../src/components/lobby/cashBoardOrder';
import { foldLightningHandForLeave } from '../../src/lib/preActionSync';

describe('fixed-limit explicit selection', () => {
  it('keeps NLH and PLO visible by default and requires opting in to FLH/FLO8', () => {
    for (const variant of ['nlh', 'plo4', 'plo5', 'plo6'])
      expect(cashVariantVisible(variant, 'ALL')).toBe(true);
    for (const variant of ['flh', 'flo8']) {
      expect(cashVariantVisible(variant, 'ALL')).toBe(false);
      expect(cashVariantVisible(variant, 'ALL', true)).toBe(true);
      expect(cashVariantVisible(variant, 'LIMIT')).toBe(true);
    }
  });
  it.each(['recommended', 'stakes_high', 'stakes_low', 'players', 'starting_soon'])(
    'keeps limit below every other cash game for %s',
    (sort) => {
      const rows = [
        { game_variant: 'flh', big_blind: 10, current_players: 9 },
        { game_variant: 'nlh', big_blind: 1, current_players: 1 },
        { game_variant: 'flo8', big_blind: 0.1, current_players: 8 },
        { game_variant: 'plo4', big_blind: 2, current_players: 2 },
      ];
      const ordered = rows.sort(cashBoardComparator(sort, 'ALL')).map((r) => r.game_variant);
      expect(ordered.slice(0, 2).sort()).toEqual(['nlh', 'plo4']);
      expect(ordered.slice(2).sort()).toEqual(['flh', 'flo8']);
    }
  );
});
describe('Lightning leave folds only its captured hand', () => {
  it('sends one explicit auto-fold with exact hand identity', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    expect(
      await foldLightningHandForLeave({
        tableId: 'room',
        handId: 'hand-a',
        currentHandId: () => 'hand-a',
        send,
      })
    ).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith('room', 'auto_fold', undefined, 'hand-a');
  });
  it('refuses an unconfirmed fold but never retries it into the next hand', async () => {
    const send = vi.fn().mockResolvedValue({ success: false, error: 'Network' });
    expect(
      await foldLightningHandForLeave({
        tableId: 'room',
        handId: 'hand-a',
        currentHandId: () => 'hand-a',
        send,
      })
    ).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await foldLightningHandForLeave({
        tableId: 'room',
        handId: 'hand-a',
        currentHandId: () => 'hand-b',
        send,
      })
    ).toBe(true);
    expect(send.mock.calls.every((call) => call[3] === 'hand-a')).toBe(true);
  });
});
