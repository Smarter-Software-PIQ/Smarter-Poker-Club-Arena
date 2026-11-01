import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  withTournamentScheduleCreateIntent as submit,
  ScheduleCreateRefusedError,
} from '../../src/services/TournamentScheduleCreateIntent';
const scope = { userId: 'user', clubId: 'club', unionId: null };
const payload = { clubId: 'club', unionId: null, name: 'Daily', config: { type: 'mtt' } };
const key = 'ca:tournament-schedule-create:v1:user:club:club';
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  let lane = Promise.resolve();
  vi.stubGlobal('navigator', {
    locks: {
      request: (_key: string, _options: unknown, work: (lock: unknown) => Promise<unknown>) => {
        const next = lane.then(() => work({ name: _key }));
        lane = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('durable schedule create identity', () => {
  it('refuses an externally owned browser lock without waiting indefinitely', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('navigator', {
        locks: {
          request: (_key: string, options: any, callback: any) =>
            options?.ifAvailable ? Promise.resolve(callback(null)) : new Promise(() => {}),
        },
      });
      const send = vi.fn(async () => 'schedule');
      let outcome: unknown;
      void submit({ ...scope, userId: 'externally-locked' }, payload, send).catch((error) => {
        outcome = error;
      });
      await vi.advanceTimersByTimeAsync(12001);
      expect(outcome).toBeInstanceOf(Error);
      expect(String(outcome)).toContain('Active In Another Tab');
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('persists before I/O and recovers the same request after a lost acknowledgement and module reload', async () => {
    let original = '';
    await expect(
      submit(scope, payload, async (id) => {
        original = id;
        expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(id);
        expect(JSON.parse(sessionStorage.getItem(key)!).payload).toEqual(payload);
        throw new Error('Response Lost');
      })
    ).rejects.toThrow('Response Lost');
    vi.resetModules();
    const reloaded = await import('../../src/services/TournamentScheduleCreateIntent');
    const send = vi.fn(async () => 'original-schedule');
    expect(await reloaded.withTournamentScheduleCreateIntent(scope, payload, send)).toBe(
      'original-schedule'
    );
    expect(send).toHaveBeenCalledWith(original);
  });
  it('coalesces equal simultaneous requests and allocates a fresh identity for a confirmed new intent', async () => {
    const send = vi.fn(async (_id: string) => 'schedule');
    await Promise.all([submit(scope, payload, send), submit(scope, payload, send)]);
    expect(send).toHaveBeenCalledTimes(1);
    const first = send.mock.calls[0][0];
    await submit(scope, payload, send);
    expect(send.mock.calls[1][0]).not.toBe(first);
  });
  it('refuses changed settings while the old acknowledgement is unknown, with no second write', async () => {
    const send = vi.fn(async () => {
      throw new Error('Unknown');
    });
    await expect(submit(scope, payload, send)).rejects.toThrow('Unknown');
    await expect(submit(scope, { ...payload, name: 'Edited' }, send)).rejects.toThrow(
      'Earlier Schedule Save Is Unconfirmed'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not mistake JSON object key order for different settings', async () => {
    let original = '';
    await expect(
      submit(scope, payload, async (id) => {
        original = id;
        throw new Error('Unknown');
      })
    ).rejects.toThrow();
    const send = vi.fn(async () => 'schedule');
    await submit(
      scope,
      { config: { type: 'mtt' }, name: 'Daily', unionId: null, clubId: 'club' },
      send
    );
    expect(send).toHaveBeenCalledWith(original);
  });
  it('keeps another tab newer pending request intact', async () => {
    const original = crypto.randomUUID(),
      newer = crypto.randomUUID();
    sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, requestId: original, state: 'pending', payload })
    );
    const shared = JSON.stringify({ version: 1, requestId: newer, state: 'pending', payload });
    localStorage.setItem(key, shared);
    const send = vi.fn(async () => 'schedule');
    await submit(scope, payload, send);
    expect(send).toHaveBeenCalledWith(original);
    expect(localStorage.getItem(key)).toBe(shared);
  });
  it('refuses unavailable storage before any RPC', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage Failed');
      },
    });
    const send = vi.fn(async () => 'schedule');
    await expect(submit(scope, payload, send)).rejects.toThrow('Storage Failed');
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects corrupt scope evidence without overwriting it', async () => {
    const raw = JSON.stringify({
      version: 1,
      requestId: crypto.randomUUID(),
      state: 'pending',
      payload: { ...payload, clubId: 'other' },
    });
    sessionStorage.setItem(key, raw);
    const send = vi.fn(async () => 'schedule');
    await expect(submit(scope, payload, send)).rejects.toThrow('Could Not Be Verified');
    expect(send).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it('separates accounts and refuses missing browser lock support before I/O', async () => {
    let first = '';
    await expect(
      submit(scope, payload, async (id) => {
        first = id;
        throw new Error('Unknown');
      })
    ).rejects.toThrow();
    const send = vi.fn(async (_id: string) => 'schedule');
    await submit({ ...scope, userId: 'other' }, payload, send);
    expect(send.mock.calls[0][0]).not.toBe(first);
    vi.stubGlobal('navigator', {});
    await expect(submit(scope, payload, send)).rejects.toThrow('Cannot Safely Save');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('allows corrected settings only after a definite refusal, retaining the original key', async () => {
    let original = '';
    await expect(
      submit(scope, payload, async (id) => {
        original = id;
        throw new ScheduleCreateRefusedError('Refused');
      })
    ).rejects.toThrow('Refused');
    const send = vi.fn(async () => 'accepted');
    await submit(scope, { ...payload, name: 'Corrected' }, send);
    expect(send).toHaveBeenCalledWith(original);
    expect(JSON.parse(localStorage.getItem(key)!).state).toBe('resolved');
  });
});
