import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: state.rpc } }));
import ClubRosterService, {
  mapRosterRow,
  textTwinSelect,
} from '../../src/services/ClubRosterService';
import { CASHIER_ROSTER_SELECT, mapCashierRoster } from '../../src/lib/cashierRoster';
import { selectTextTwins } from '../../src/lib/selectTextTwins';
import { playerRecordMoney } from '../../src/utils/playerRecordMoney';
import { formatWalletChips } from '../../src/utils/format';

/** Past a JavaScript number's 15 significant digits: JSON.parse would round it. */
const HUGE = '123456789012345678.91';

function builder(data: unknown) {
  const b = {
    select(columns: string) {
      state.select(columns);
      return b;
    },
    setHeader() {
      return b;
    },
    abortSignal: () => Promise.resolve({ data, error: null }),
  };
  return b;
}

beforeEach(() => {
  state.rpc.mockReset();
  state.select.mockReset();
});

describe('exact decimal twins (Dan 2026-11-13: real figures print whole)', () => {
  it('a roster row keeps each well-formed twin and drops a redacted or malformed one', () => {
    const m = mapRosterRow({
      user_id: 'u',
      player_wallet: 1.2345678901234568e17,
      player_wallet_text: HUGE,
      agent_wallet: null,
      agent_wallet_text: '5.00',
      total_fees: 3,
      total_fees_text: 'not a number',
    });
    expect(m.player_wallet_text).toBe(HUGE);
    expect(m.agent_wallet_text).toBeUndefined();
    expect(m.total_fees_text).toBeUndefined();
    expect(formatWalletChips(m.player_wallet_text ?? m.player_wallet)).toBe(
      '123,456,789,012,345,678.91'
    );
  });

  it('the Player Record prints a twin digit for digit and a number to cents', () => {
    expect(playerRecordMoney(HUGE, true)).toBe('+123,456,789,012,345,678.91');
    expect(playerRecordMoney('-1042.67', true)).toBe('-1,042.67');
    expect(playerRecordMoney('0.00', true)).toBe('0.00');
    expect(playerRecordMoney(393.95, true)).toBe('+393.95');
    expect(playerRecordMoney(0.1 + 0.2)).toBe('0.30');
    expect(playerRecordMoney(null)).toBe('Restricted');
    expect(playerRecordMoney(Number.NaN)).toBe('-');
  });

  it('win and loss windows carry cash, mtt and net twins', async () => {
    const window = {
      cash: -2.5,
      mtt: 1,
      net: -1.5,
      cash_text: '-2.50',
      mtt_text: '1.00',
      net_text: HUGE,
    };
    state.rpc.mockReturnValue(
      builder({ as_of: '2026-11-14', today: window, week: window, month: window, overall: window })
    );
    const wl = await ClubRosterService.getMemberWinLoss('club', 'u');
    expect(wl?.overall).toMatchObject({ cash_text: '-2.50', mtt_text: '1.00', net_text: HUGE });
  });

  it('the downline and the roster overview ask for their money columns as text', async () => {
    state.rpc.mockReturnValue(
      builder([
        {
          user_id: 'd',
          chip_balance: 7,
          chip_balance_text: '7.00',
          total_fees: 2,
          total_fees_text: HUGE,
        },
      ])
    );
    const rows = await ClubRosterService.getDownline('club', 'u');
    expect(state.select).toHaveBeenCalledWith(
      '*,chip_balance_text:chip_balance::text,total_fees_text:total_fees::text'
    );
    expect(rows[0]).toMatchObject({ chip_balance_text: '7.00', total_fees_text: HUGE });
    expect(textTwinSelect(['a', 'b'])).toBe('*,a_text:a::text,b_text:b::text');
  });

  it('the cashier roster keeps its wallet twin', () => {
    expect(CASHIER_ROSTER_SELECT).toBe('*,chip_balance_text:chip_balance::text');
    const [row] = mapCashierRoster(
      [
        {
          user_id: 'p',
          role_rank: 1,
          chip_balance: 1.2345678901234568e17,
          chip_balance_text: HUGE,
        },
      ],
      'viewer'
    );
    expect(row.chipBalanceText).toBe(HUGE);
    const [plain] = mapCashierRoster([{ user_id: 'q', role_rank: 1, chip_balance: 4 }], 'viewer');
    expect(plain.chipBalanceText).toBeUndefined();
  });

  it('a builder without a column list passes through unchanged', () => {
    const bare = { then: undefined };
    expect(selectTextTwins(bare, '*')).toBe(bare);
    const b = builder(null);
    selectTextTwins(b, '*,x_text:x::text');
    expect(state.select).toHaveBeenCalledWith('*,x_text:x::text');
  });
});
