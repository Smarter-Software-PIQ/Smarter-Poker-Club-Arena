import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: transport }));
vi.mock('../../src/services/SoundService', () => ({
  soundService: { playBuyInConfirm: vi.fn() },
  haptic: { light: vi.fn() },
}));
import { useCashSeatEntry } from '../../src/components/table/useCashSeatEntry';
import BuyInModal from '../../src/components/table/BuyInModal';
import { openFeederBuyIn } from '../../scripts/ci/verify-plo-lightning-lifecycle.mjs';
const table = '33333333-3333-4333-8333-333333333333';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// This adapter runs the witness's role locators on real rendered components.
// Only browser transport and the admission response are isolated here.
function locator(root: () => HTMLElement | undefined, role: string, options: any): any {
  const find = () => {
    const element = root();
    return element
      ? (within(element).queryAllByRole(role, options)[0] as HTMLElement | undefined)
      : undefined;
  };
  return {
    first() {
      return this;
    },
    isVisible: async () => !!find(),
    click: async () => {
      await act(async () => {
        fireEvent.click(find()!);
      });
    },
    waitFor: async () => {
      await waitFor(() => expect(find()).toBeTruthy());
    },
    getByRole: (childRole: string, childOptions: any) =>
      locator(() => find()!, childRole, childOptions),
  };
}

it('takes a feeder chair through actual admission before opening the real purchase sheet, without buying', async () => {
  const purchase = vi.fn();
  transport.rpc.mockResolvedValue({
    data: { ok: true, action: 'seat', table_id: table, seat_number: 4 },
    error: null,
  });
  function AssignedTable() {
    const [chair, setChair] = useState(0);
    const enter = useCashSeatEntry({
      tableId: table,
      userId: 'player',
      gameId: 'game',
      openBuyIn: setChair,
      goToTable: vi.fn(),
      showWaitlist: vi.fn(),
      notify: vi.fn(),
    });
    return (
      <>
        <button aria-label="Seat 1: Open - Click To Sit" onClick={() => enter(1)}>
          Sit
        </button>
        <output data-testid="assigned-chair">{chair}</output>
        <BuyInModal
          isOpen={chair > 0}
          onClose={() => setChair(0)}
          onConfirm={purchase}
          minBuyIn={100}
          maxBuyIn={400}
          accountBalance={400}
          bigBlind={2}
          gameType="plo4"
        />
      </>
    );
  }
  render(<AssignedTable />);
  expect(screen.queryByRole('dialog')).toBeNull(); // the failed production witness's actual starting state
  const page = {
    waitForURL: async (matches: (url: URL) => boolean) =>
      expect(matches(new URL(`https://smarter.poker/hub/club-arena/table/${table}`))).toBe(true),
    getByRole: (role: string, options: any) => locator(() => document.body, role, options),
  };
  await openFeederBuyIn(page);
  expect(screen.getByTestId('assigned-chair').textContent).toBe('4');
  expect(screen.getByRole('slider', { name: 'Buy-In Amount' }).getAttribute('max')).toBe('400');
  expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('fn_cash_game_join', { p_game_id: 'game' });
  expect(purchase).not.toHaveBeenCalled();
  await openFeederBuyIn(page); // an already-present sheet spends no second seat request
  expect(transport.rpc).toHaveBeenCalledTimes(1);
  expect(purchase).not.toHaveBeenCalled();
});

it('accepts the real purchase sheet arriving while an ordinary chair click is blocked, without another admission or purchase', async () => {
  const purchase = vi.fn();
  let showOffer: () => void;
  function OfferedTable() {
    const [open, setOpen] = useState(false);
    showOffer = () => setOpen(true);
    return (
      <>
        <button aria-label="Seat 1: Open - Click To Sit">Sit</button>
        <BuyInModal
          isOpen={open}
          onClose={() => setOpen(false)}
          onConfirm={purchase}
          minBuyIn={100}
          maxBuyIn={400}
          accountBalance={400}
          bigBlind={2}
          gameType="plo4"
        />
      </>
    );
  }
  render(<OfferedTable />);
  const blockedClick = vi.fn(async () => {
    await act(async () => {
      showOffer();
    });
    throw new Error('The arriving buy-in overlay intercepts pointer events');
  });
  const page = {
    waitForURL: async () => {},
    getByRole: (role: string, options: any) => {
      if (role === 'button') return { first: () => ({ click: blockedClick }) };
      return locator(() => document.body, role, options);
    },
  };
  await openFeederBuyIn(page);
  expect(screen.getByRole('slider', { name: 'Buy-In Amount' }).getAttribute('max')).toBe('400');
  expect(blockedClick).toHaveBeenCalledTimes(1);
  expect(transport.rpc).not.toHaveBeenCalled();
  expect(purchase).not.toHaveBeenCalled();
});

it('preserves a blocked chair failure when no actual purchase sheet arrived', async () => {
  const failure = new Error('Table artwork did not finish loading');
  const page = {
    waitForURL: async () => {},
    getByRole: (role: string, options: any) =>
      role === 'button'
        ? {
            first: () => ({
              click: async () => {
                throw failure;
              },
            }),
          }
        : locator(() => document.body, role, options),
  };
  await expect(openFeederBuyIn(page)).rejects.toBe(failure);
});
