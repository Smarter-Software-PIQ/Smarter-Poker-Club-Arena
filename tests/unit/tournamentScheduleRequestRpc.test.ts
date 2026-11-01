import { scheduleRpcResponse } from '../helpers/scheduleCreateFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../src/lib/supabase';
import { tournamentScheduleService } from '../../src/services/TournamentScheduleService';
const user = '00000000-0000-4000-8000-0000000000a1';
const draft = {
  clubId: 'club',
  name: 'Daily',
  daysOfWeek: [1],
  startTimesUtc: ['18:00'],
  config: { type: 'mtt' },
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('navigator', {
    locks: {
      request: (_key: string, _options: unknown, fn: (lock: unknown) => unknown) =>
        fn({ name: _key }),
    },
  });
  vi.spyOn(db, 'getAuthUser').mockResolvedValue({
    data: { user: { id: user } },
    error: null,
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('request-bound schedule RPC wiring', () => {
  it('does not replace unknown settings after a missing-contract response', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValueOnce(scheduleRpcResponse(Promise.reject(new Error('Lost'))) as never)
      .mockReturnValueOnce(
        scheduleRpcResponse({ data: null, error: { code: 'PGRST202' } }) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow('Lost');
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow('Safe Schedule Creation');
    await expect(tournamentScheduleService.upsert({ ...draft, name: 'Changed' })).rejects.toThrow(
      'Earlier Schedule Save Is Unconfirmed'
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('creates only through the installed request adapter and validates its actor/request receipt', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockImplementation(
        (_name, args: any) =>
          scheduleRpcResponse({
            data: {
              ok: true,
              schedule_id: 'schedule',
              request_id: args.p_request_id,
              user_id: args.p_user_id,
            },
            error: null,
          }) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).resolves.toBe('schedule');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('fn_create_tournament_schedule_request');
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_user_id: user,
      p_schedule: { id: null, name: 'Daily' },
    });
  });
  it('never falls back to the old writer when the adapter is missing', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValue(
        scheduleRpcResponse({
          data: null,
          error: { code: 'PGRST202', message: 'Not found' },
        } as never) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow(
      'The Original Request Is Retained'
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('fn_create_tournament_schedule_request');
  });
  it('keeps the original request when the transport or receipt is unknown', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValueOnce(scheduleRpcResponse(Promise.reject(new Error('Lost'))) as never)
      .mockReturnValueOnce(
        scheduleRpcResponse({
          data: { ok: true, schedule_id: 'schedule', request_id: 'wrong', user_id: user },
          error: null,
        } as never) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow('Lost');
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow(
      'Receipt Could Not Be Verified'
    );
    expect((rpc.mock.calls[0][1] as any).p_request_id).toBe(
      (rpc.mock.calls[1][1] as any).p_request_id
    );
  });
  it('updates an acknowledged row through the existing authority without a new create identity', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValue(
        scheduleRpcResponse({
          data: { ok: true, schedule_id: 'existing' },
          error: null,
        } as never) as never
      );
    await expect(tournamentScheduleService.upsert({ ...draft, id: 'existing' })).resolves.toBe(
      'existing'
    );
    expect(rpc).toHaveBeenCalledWith('fn_upsert_tournament_schedule', {
      p_schedule: expect.objectContaining({ id: 'existing' }),
    });
  });
  it('permits correcting an authoritative refusal without rotating the request identity', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockImplementationOnce(
        (_name, args: any) =>
          scheduleRpcResponse({
            data: {
              error: 'name_required',
              request_state: 'not_created',
              request_id: args.p_request_id,
              user_id: args.p_user_id,
            },
            error: null,
          }) as never
      )
      .mockImplementationOnce(
        (_name, args: any) =>
          scheduleRpcResponse({
            data: {
              ok: true,
              schedule_id: 'schedule',
              request_id: args.p_request_id,
              user_id: args.p_user_id,
            },
            error: null,
          }) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow(
      'Give the schedule a name'
    );
    await expect(tournamentScheduleService.upsert({ ...draft, name: 'Corrected' })).resolves.toBe(
      'schedule'
    );
    expect((rpc.mock.calls[0][1] as any).p_request_id).toBe(
      (rpc.mock.calls[1][1] as any).p_request_id
    );
  });
});

describe('request-bound create liveness', () => {
  it('releases a hung create, ignores its late receipt, and explicitly replays the same identity', async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: any) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise((resolve) => {
      resolveLate = resolve;
    });
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockImplementationOnce(
        () =>
          Object.assign(pending, {
            abortSignal: (value: AbortSignal) => {
              signal = value;
              return pending;
            },
          }) as never
      )
      .mockImplementation((_name, args: any) => {
        const reply = Promise.resolve({
          data: { ok: true, schedule_id: 'original', request_id: args.p_request_id, user_id: user },
          error: null,
        });
        return Object.assign(reply, { abortSignal: () => reply }) as never;
      });
    let outcome: unknown;
    const attempt = tournamentScheduleService.upsert({ ...draft, clubId: 'hung-create' }).then(
      (value) => {
        outcome = value;
      },
      (error) => {
        outcome = error;
      }
    );
    await vi.advanceTimersByTimeAsync(12_001);
    const requestId = (rpc.mock.calls[0][1] as any).p_request_id;
    try {
      expect(outcome).toBeInstanceOf(Error);
      expect(signal?.aborted).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      resolveLate({
        data: { ok: true, schedule_id: 'late', request_id: requestId, user_id: user },
        error: null,
      });
      await attempt;
    }
    await Promise.resolve();
    expect(outcome).toBeInstanceOf(Error);
    await expect(
      tournamentScheduleService.upsert({ ...draft, clubId: 'hung-create' })
    ).resolves.toBe('original');
    expect((rpc.mock.calls[1][1] as any).p_request_id).toBe(requestId);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('bounds an unanswered authentication read before creating any request or write', async () => {
    vi.useFakeTimers();
    let release!: (value: any) => void;
    vi.mocked(db.getAuthUser).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never
    );
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValue(scheduleRpcResponse({ data: null, error: null } as never) as never);
    let outcome: unknown;
    const attempt = tournamentScheduleService
      .upsert({ ...draft, clubId: 'hung-auth' })
      .catch((error) => {
        outcome = error;
      });
    await vi.advanceTimersByTimeAsync(12_001);
    try {
      expect(outcome).toBeInstanceOf(Error);
      expect(rpc).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
    } finally {
      release({ data: { user: null }, error: null });
      await attempt;
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('accepted request whose original schedule was retired', () => {
  it('requires a verified retirement receipt and permits only a subsequent explicit new intent', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockImplementationOnce(
        (_name, args: any) =>
          scheduleRpcResponse({
            data: {
              error: 'schedule_request_target_changed',
              request_state: 'retired',
              request_id: args.p_request_id,
              user_id: args.p_user_id,
              schedule_id: 'original',
            },
            error: null,
          }) as never
      )
      .mockImplementation(
        (_name, args: any) =>
          scheduleRpcResponse({
            data: {
              ok: true,
              schedule_id: 'new',
              request_id: args.p_request_id,
              user_id: args.p_user_id,
            },
            error: null,
          }) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow('Original Schedule');
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(
      tournamentScheduleService.upsert({ ...draft, name: 'New Explicit Intent' })
    ).resolves.toBe('new');
    expect((rpc.mock.calls[1][1] as any).p_request_id).not.toBe(
      (rpc.mock.calls[0][1] as any).p_request_id
    );
  });
  it('does not retire an intent from an unverified target-changed error', async () => {
    const rpc = vi
      .spyOn(db.supabase, 'rpc')
      .mockClear()
      .mockReturnValue(
        scheduleRpcResponse({
          data: {
            error: 'schedule_request_target_changed',
            request_state: 'retired',
            request_id: 'wrong',
            user_id: user,
            schedule_id: 'original',
          },
          error: null,
        }) as never
      );
    await expect(tournamentScheduleService.upsert(draft)).rejects.toThrow('Original Schedule');
    await expect(tournamentScheduleService.upsert({ ...draft, name: 'Changed' })).rejects.toThrow(
      'Earlier Schedule Save Is Unconfirmed'
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
