import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
import { getArenaContext } from '../../src/services/ArenaContextService';

beforeEach(() => {
  vi.useFakeTimers();
  mocks.rpc.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it('settles an access read that never answers without granting access', async () => {
  let signal: AbortSignal | undefined;
  const pending = new Promise<never>(() => {});
  mocks.rpc.mockReturnValue({
    abortSignal: (value: AbortSignal) => {
      signal = value;
      return pending;
    },
    then: pending.then.bind(pending),
  });
  let outcome: unknown = 'pending';
  const result = getArenaContext('shark-club').then(
    (value) => {
      outcome = value;
    },
    (error) => {
      outcome = error;
    }
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('Arena Access Read Timed Out');
  expect(signal?.aborted).toBe(true);
  await result;
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a verified absent arena and clears the request deadline', async () => {
  const response = Promise.resolve({ data: null, error: null });
  mocks.rpc.mockReturnValue({ abortSignal: () => response, then: response.then.bind(response) });
  // A slug the server does not know is asked of the club resolver once (a
  // renamed club's former slug); no club and no rename answers it here.
  const absent = { select: () => absent, eq: () => absent, maybeSingle: async () => response };
  mocks.from.mockReturnValue(absent);
  await expect(getArenaContext('missing')).resolves.toBeNull();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves the actual request refusal without retrying', async () => {
  const response = Promise.resolve({ data: null, error: { message: 'access refused' } });
  mocks.rpc.mockReturnValue({ abortSignal: () => response, then: response.then.bind(response) });
  await expect(getArenaContext('private')).rejects.toThrow('access refused');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
