import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: state.rpc } }));
import ClubRosterService, { PERIOD_SUMMARY_SELECT } from '../../src/services/ClubRosterService';
import { feeFigure, winLossChips } from '../../src/utils/format';
beforeEach(() => state.rpc.mockReset());
it('reads the selected period once and keeps fee cents beside its profit/loss', async () => {
  state.rpc.mockReturnValue({
    select() {
      return this;
    },
    setHeader() {
      return this;
    },
    abortSignal: () =>
      Promise.resolve({
        data: [{ user_id: 'a', cash: -2, mtt: 1, net: -1, fees: '66.63', downline_fees: '155.09' }],
        error: null,
      }),
  });
  expect(await ClubRosterService.getMembersWinLoss('club', ['a'], 'week')).toEqual(
    new Map([['a', { cash: -2, mtt: 1, net: -1, fees: 66.63, downline_fees: 155.09 }]])
  );
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('ca_club_members_period_summary', {
    p_club_id: 'club',
    p_user_ids: ['a'],
    p_period: 'week',
  });
});
it('rejects an old or incomplete summary instead of treating missing fees as zero', async () => {
  state.rpc.mockReturnValue({
    select() {
      return this;
    },
    setHeader() {
      return this;
    },
    abortSignal: () =>
      Promise.resolve({ data: [{ user_id: 'a', cash: -2, mtt: 1, net: -1 }], error: null }),
  });
  await expect(ClubRosterService.getMembersWinLoss('club', ['a'], 'week')).rejects.toThrow(
    'The Period Fee Response Was Incomplete'
  );
});

it('keeps the exact decimal text of a figure a JavaScript number cannot hold', async () => {
  const select = vi.fn(function (this: unknown) {
    return this;
  });
  state.rpc.mockReturnValue({
    select,
    setHeader() {
      return this;
    },
    abortSignal: () =>
      Promise.resolve({
        data: [
          {
            user_id: 'a',
            cash: 0,
            mtt: 0,
            net: 123456789012345680,
            fees: 0.1,
            downline_fees: 0,
            net_text: '123456789012345678.91',
            fees_text: '0.000000000001',
            downline_fees_text: '0.00',
          },
        ],
        error: null,
      }),
  });
  const figure = (await ClubRosterService.getMembersWinLoss('club', ['a'], 'week')).get('a');
  expect(select).toHaveBeenCalledWith(PERIOD_SUMMARY_SELECT);
  expect(PERIOD_SUMMARY_SELECT).toContain('net_text:net::text');
  expect(figure?.net_text).toBe('123456789012345678.91');
  expect(figure?.fees_text).toBe('0.000000000001');
  expect(winLossChips(figure?.net_text ?? figure?.net)).toBe('+123,456,789,012,345,678.91');
  expect(feeFigure(figure?.fees_text ?? figure?.fees)).toBe('0.000000000001');
});
