import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc: mock.rpc } }));
import { readExactHorseOpponentProfiles } from './HorseExactOpponentMemory.js';
import { admitCompletedHandExactRead, admitOpponentMemoryRead } from './HorseOpponentMemory.js';
import { isOpponentMemoryBusyRefusal } from './errorReporter.js';

/* COMPLETED-HAND EXACT READS ARE ADMITTED ON THEIR OWN (2026-11-15). On
   2026-11-14 19:09Z-19:30Z the post-commit exact read timed out behind a Free
   Buy rebuy lock queue; each failure closed the gate the decision-path reader
   shares for 1.5 s (50 timeouts became 223 busy refusals,
   observation-06d45e7d-20261114/MEMORY-READ-ROOT-CAUSE.md). These cases fail on
   the code before the fix, where both readers share one gate. Only Date is
   faked; timers and AbortSignal stay real. */
const id = '10000000-0000-4000-8000-000000000001';
const domain = { version: 1, speed: 'table', ante: 'none' } as const;
let clock = Date.now();
beforeEach(() => {
  clock += 60_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  mock.rpc.mockReset().mockReturnValue({ abortSignal: mock.abortSignal });
  mock.abortSignal
    .mockReset()
    .mockResolvedValue({ data: null, error: { code: '57014', message: 'canceled' } });
});
afterEach(() => vi.useRealTimers());

it('a timed-out completed-hand exact read leaves the decision-path gate open', async () => {
  await expect(
    readExactHorseOpponentProfiles([id], 'nlh', 'tournament', 'full', domain)
  ).rejects.toThrow('exact public memory unavailable');
  await expect(admitOpponentMemoryRead(async () => 'decision read')).resolves.toBe('decision read');
});

it('keeps its own 1.5 s bound after a failure, and reopens after it', async () => {
  await expect(
    readExactHorseOpponentProfiles([id], 'nlh', 'tournament', 'full', domain)
  ).rejects.toThrow('exact public memory unavailable');
  const refused = await admitCompletedHandExactRead(async () => 'second').catch((e) => e);
  expect(isOpponentMemoryBusyRefusal(refused)).toBe(true);
  vi.setSystemTime(clock + 1501);
  await expect(admitCompletedHandExactRead(async () => 'later')).resolves.toBe('later');
});

it('a failed decision-path read does not close the completed-hand gate', async () => {
  await expect(
    admitOpponentMemoryRead(async () => {
      throw Object.assign(new Error('opponent memory unavailable: 57014'), { code: '57014' });
    })
  ).rejects.toThrow();
  await expect(admitCompletedHandExactRead(async () => 'completed read')).resolves.toBe(
    'completed read'
  );
});
