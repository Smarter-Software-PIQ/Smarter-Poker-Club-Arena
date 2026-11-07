import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Owner, 2026-11-06: show players how many of their five daily Free Buy
// tickets are left, and say plainly when a registration is refused for want
// of one. The book is the event's own gaming day (20261107043307).

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  findTicket: vi.fn(),
  navigate: vi.fn(),
  readBalance: vi.fn(),
  readUnit: vi.fn(),
  registerPlayer: vi.fn(),
  ticketBook: vi.fn(),
  reportError: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: {
    findTournamentEntryTicket: mocks.findTicket,
    readTournamentUnitCents: mocks.readUnit,
    registerPlayer: mocks.registerPlayer,
    getFreeBuyTicketsForEvent: mocks.ticketBook,
  },
}));
vi.mock('../../src/context/InTabLobbyContext', () => ({
  useInTabLobby: () => null,
  useAppNavigate: () => mocks.navigate,
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1', username: 'Player' } }),
}));
vi.mock('../../src/services/WalletService', () => ({
  WalletService: { readPlayerBalance: mocks.readBalance },
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  }),
}));
vi.mock('../../src/core/MasterBus', () => ({ masterBus: { emit: mocks.emit } }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: mocks.rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: mocks.reportError }));

import { SignUpHost } from '../../src/components/tournament/signUpDialog';
import { useTournamentRegistration } from '../../src/hooks/useTournamentRegistration';
import { resetTournamentStartHoldCacheForTests } from '../../src/hooks/useTournamentStartHold';
import {
  FREE_BUY_TICKET_REFUSAL_TEXT,
  freeBuyTicketCardValue,
  freeBuyTicketDayWord,
  freeBuyTicketRefusalReason,
  freeBuyTicketsExhausted,
  freeBuyTicketsLeftLine,
  parseFreeBuyTicketBook,
} from '../../src/utils/freeBuyTickets';

const freeBuy = {
  id: 'free-buy-1',
  name: 'Morning Free Buy (NLH)',
  buy_in_amount: 0,
  buy_in_fee: 0,
  start_time: '2030-01-01T14:30:00.000Z',
  status: 'REGISTERING',
  club_id: 'fade0000-0000-0000-0000-000000000001',
};
const book = (remaining: number, extra: Record<string, unknown> = {}) =>
  parseFreeBuyTicketBook({
    applies: true,
    gaming_day: '2030-01-01',
    today: true,
    allotment: 5,
    used: 5 - remaining,
    remaining,
    used_here: false,
    ...extra,
  });

describe('the Free Buy ticket book reads as a player would say it', () => {
  it('parses the RPC answer and refuses a malformed one', () => {
    expect(book(3)).toEqual({
      applies: true,
      gamingDay: '2030-01-01',
      today: true,
      allotment: 5,
      used: 2,
      remaining: 3,
      usedHere: false,
    });
    expect(parseFreeBuyTicketBook({ applies: false })?.applies).toBe(false);
    expect(parseFreeBuyTicketBook(null)).toBeNull();
    expect(parseFreeBuyTicketBook({ applies: true, remaining: 3 })).toBeNull();
    expect(
      parseFreeBuyTicketBook({
        applies: true,
        gaming_day: 'soon',
        allotment: 5,
        used: 0,
        remaining: 5,
      })
    ).toBeNull();
  });

  it('names the event day: today, or its weekday when the event is on a later gaming day', () => {
    expect(freeBuyTicketCardValue(book(3)!)).toBe('Uses 1 Of 3 Left Today');
    const saturday = book(1, { today: false, gaming_day: '2026-11-07' })!;
    expect(freeBuyTicketDayWord(saturday)).toBe('For Saturday');
    expect(freeBuyTicketCardValue(saturday)).toBe('Uses 1 Of 1 Left For Saturday');
    expect(freeBuyTicketsLeftLine(book(4)!)).toBe('4 Of 5 Free Buy Tickets Left Today');
  });

  it('is exhausted only with none left and none already held on the event', () => {
    expect(freeBuyTicketsExhausted(book(0))).toBe(true);
    expect(freeBuyTicketsExhausted(book(0, { used_here: true }))).toBe(false);
    expect(freeBuyTicketsExhausted(book(1))).toBe(false);
    expect(freeBuyTicketsExhausted(null)).toBe(false);
    expect(freeBuyTicketsExhausted(parseFreeBuyTicketBook({ applies: false }))).toBe(false);
  });

  it('recognises the two refusals the redeem raises, and nothing else', () => {
    expect(
      freeBuyTicketRefusalReason({
        code: 'P0001',
        message: "FREE_BUY_TICKETS_USED_TODAY: all five of today's Free Buy tickets are used",
      })
    ).toBe('free_buy_tickets_used_today');
    expect(
      freeBuyTicketRefusalReason({
        message: 'FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT: one per event',
      })
    ).toBe('free_buy_ticket_already_used_for_event');
    expect(
      freeBuyTicketRefusalReason({ message: 'canceling statement due to statement timeout' })
    ).toBeNull();
    expect(freeBuyTicketRefusalReason(null)).toBeNull();
  });

  it('says it without em dashes, and says no chips were charged', () => {
    for (const text of Object.values(FREE_BUY_TICKET_REFUSAL_TEXT)) {
      expect(text).not.toMatch(/—/);
      expect(text).toMatch(/No Chips Were Charged\.$/);
    }
  });
});

describe('the registration hook shows the tickets and refuses before Confirm when none are left', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTournamentStartHoldCacheForTests();
    mocks.rpc.mockResolvedValue({ data: { blocked: false }, error: null });
    mocks.findTicket.mockResolvedValue(null);
    mocks.readUnit.mockResolvedValue(1);
    mocks.readBalance.mockResolvedValue({ balance: 500 });
    mocks.registerPlayer.mockResolvedValue({ id: 'registration-1', table_id: 'table-1' });
  });

  it('prints the ticket this entry uses and the count left after registering', async () => {
    mocks.ticketBook.mockResolvedValueOnce(book(3)).mockResolvedValueOnce(book(2));
    render(<SignUpHost />);
    const hook = renderHook(() => useTournamentRegistration());
    let registration!: Promise<void>;
    act(() => {
      registration = hook.result.current.register(freeBuy);
    });
    await screen.findByRole('dialog');
    expect(screen.getByText('Free Buy Ticket')).toBeTruthy();
    expect(screen.getByText('Uses 1 Of 3 Left Today')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => registration);
    expect(mocks.registerPlayer).toHaveBeenCalledWith('free-buy-1', 'user-1', 'Player', null);
    expect(mocks.ticketBook).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'You Are Registered For Morning Free Buy (NLH). 2 Of 5 Free Buy Tickets Left Today.'
    );
  });

  it('with none left for that day, says so and never opens the card or registers', async () => {
    mocks.ticketBook.mockResolvedValueOnce(book(0));
    render(<SignUpHost />);
    const hook = renderHook(() => useTournamentRegistration());
    await act(async () => hook.result.current.register(freeBuy));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.registerPlayer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      FREE_BUY_TICKET_REFUSAL_TEXT.free_buy_tickets_used_today
    );
  });

  it('a book that could not be read prints no ticket line and leaves the decision to the server', async () => {
    mocks.ticketBook.mockResolvedValue(null);
    render(<SignUpHost />);
    const hook = renderHook(() => useTournamentRegistration());
    let registration!: Promise<void>;
    act(() => {
      registration = hook.result.current.register(freeBuy);
    });
    await screen.findByRole('dialog');
    expect(screen.queryByText('Free Buy Ticket')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => registration);
    expect(mocks.registerPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'You Are Registered For Morning Free Buy (NLH)'
    );
  });

  it('a paid event takes no ticket and is never asked about one', async () => {
    render(<SignUpHost />);
    const hook = renderHook(() => useTournamentRegistration());
    let registration!: Promise<void>;
    act(() => {
      registration = hook.result.current.register({ ...freeBuy, buy_in_amount: 50, buy_in_fee: 5 });
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sign Up' }));
    await act(async () => registration);
    await waitFor(() => expect(mocks.ticketBook).not.toHaveBeenCalled());
  });

  it('a refusal from the server shows its own words, not a generic failure', async () => {
    mocks.ticketBook.mockResolvedValue(book(1));
    mocks.registerPlayer.mockRejectedValue(
      new Error(FREE_BUY_TICKET_REFUSAL_TEXT.free_buy_ticket_already_used_for_event)
    );
    render(<SignUpHost />);
    const hook = renderHook(() => useTournamentRegistration());
    let registration!: Promise<void>;
    act(() => {
      registration = hook.result.current.register(freeBuy);
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => registration);
    expect(mocks.toastError).toHaveBeenCalledWith(
      FREE_BUY_TICKET_REFUSAL_TEXT.free_buy_ticket_already_used_for_event
    );
  });
});
