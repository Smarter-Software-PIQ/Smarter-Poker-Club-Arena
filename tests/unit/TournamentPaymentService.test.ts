import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
import {
  getMyTournamentPayments,
  parseTournamentPaymentPage,
} from '../../src/services/TournamentPaymentService';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'payment',
  tournament_id: 'event',
  tournament_name: 'Friday Final',
  club_id: 'club',
  kind: 'place',
  amount_owed: 12.5,
  amount_paid: 0,
  created_at: '2026-09-09T21:00:00.123456+00:00',
  updated_at: '2026-09-09T21:01:00+00:00',
  ...over,
});
const page = (payments = [row()], over: Record<string, unknown> = {}) => ({
  user_id: 'player',
  payments,
  has_more: false,
  next_before_created_at: null,
  next_before_id: null,
  ...over,
});
beforeEach(() => {
  rpc.mockReset();
});
function answered(value: unknown) {
  const promise = Promise.resolve(value);
  const builder = {
    abortSignal: (_signal: AbortSignal) => builder,
    then: promise.then.bind(promise),
  };
  return builder;
}

describe('Tournament Payment Read Model', () => {
  it.each([
    [12.5, 12.5, 'paid', 0],
    [12.5, 2.25, 'partially_paid', 10.25],
    [12.5, 0, 'owed', 12.5],
    [0, 0, 'not_due', 0],
    ['0.30', '0.10', 'partially_paid', 0.2],
  ])('classifies owed %s and paid %s as %s', (owed, paid, state, remaining) => {
    const result = parseTournamentPaymentPage(
      page([row({ amount_owed: owed, amount_paid: paid })]),
      'player'
    );
    expect(result.payments[0]).toMatchObject({ state, remaining });
  });

  it.each([null, '', 'NaN', Infinity, -1, '12 chips', 0.001])(
    'rejects invalid money %s',
    (amount) => {
      expect(() =>
        parseTournamentPaymentPage(page([row({ amount_paid: amount })]), 'player')
      ).toThrow();
    }
  );

  it('rejects overpayment and mismatched account or view', () => {
    expect(() => parseTournamentPaymentPage(page([row({ amount_paid: 13 })]), 'player')).toThrow();
    expect(() => parseTournamentPaymentPage(page(), 'someone-else')).toThrow();
    expect(() =>
      parseTournamentPaymentPage(page(), 'player', { tournamentId: 'other-event' })
    ).toThrow();
    expect(() => parseTournamentPaymentPage(page(), 'player', { clubId: 'other-club' })).toThrow();
  });

  it('retains the exact database cursor and refuses a cursor unrelated to the last record', () => {
    const envelope = page([row()], {
      has_more: true,
      next_before_created_at: row().created_at,
      next_before_id: 'payment',
    });
    expect(parseTournamentPaymentPage(envelope, 'player').next).toEqual({
      createdAt: row().created_at,
      id: 'payment',
    });
    expect(() =>
      parseTournamentPaymentPage({ ...envelope, next_before_id: 'wrong' }, 'player')
    ).toThrow();
    expect(() => parseTournamentPaymentPage({ ...envelope, payments: [] }, 'player')).toThrow();
  });

  it('keeps missing records unconfirmed and never invents a paid row', () => {
    expect(parseTournamentPaymentPage(page([]), 'player')).toEqual({ payments: [], next: null });
  });

  it('uses the authenticated RPC without accepting a caller-selected user and propagates failures', async () => {
    rpc.mockReturnValueOnce(answered({ data: page(), error: null }));
    const cursor = { createdAt: row().created_at, id: 'previous' };
    await getMyTournamentPayments('player', { tournamentId: 'event', clubId: 'club' }, cursor);
    expect(rpc).toHaveBeenCalledWith('fn_ca_my_tournament_payments', {
      p_tournament_id: 'event',
      p_club_id: 'club',
      p_before_created_at: cursor.createdAt,
      p_before_id: 'previous',
      p_limit: 50,
    });
    const failure = { code: '42501', message: 'denied' };
    rpc.mockReturnValueOnce(answered({ data: null, error: failure }));
    await expect(getMyTournamentPayments('player')).rejects.toEqual(failure);
  });
});

afterEach(() => vi.useRealTimers());
it.each([null, { createdAt: '2026-09-09T21:00:00Z', id: 'previous' }])(
  'settles a stalled payment read as unknown, including later pages (%s)',
  async (cursor) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let release!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      release = resolve;
    });
    const builder = {
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return builder;
      },
      then: response.then.bind(response),
    };
    rpc.mockReturnValue(builder);
    let outcome = 'pending';
    const result = getMyTournamentPayments('player', {}, cursor).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'unknown';
      }
    );
    await vi.advanceTimersByTimeAsync(12000);
    expect(outcome).toBe('unknown');
    expect(signal?.aborted).toBe(true);
    release({ data: page(), error: null });
    await result;
    expect(outcome).toBe('unknown');
    expect(rpc).toHaveBeenCalledTimes(1);
  }
);
