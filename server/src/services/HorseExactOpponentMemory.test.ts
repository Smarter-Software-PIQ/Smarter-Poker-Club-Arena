import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc: mock.rpc } }));
import { readExactHorseOpponentProfiles } from './HorseExactOpponentMemory.js';
import { freshExploitCounters } from '../engine/HorseOpponentExploit.js';
const id = '10000000-0000-4000-8000-000000000001';
const domain = { version: 1, speed: 'lightning', ante: 'big_blind' } as const;
const row = () => ({
  user_id: id,
  variant: 'plo6',
  mode: 'cash',
  size: 'short',
  public_memory_domain: domain,
  observed_hands: 1,
  initialized: true,
  counters: freshExploitCounters(),
});
beforeEach(() => {
  mock.rpc.mockReset().mockReturnValue({ abortSignal: mock.abortSignal });
  mock.abortSignal.mockReset().mockResolvedValue({ data: [row()], error: null });
});
it('reads only the exact saved public domain with a bounded original request', async () => {
  expect(await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)).toEqual([
    row(),
  ]);
  expect(mock.rpc).toHaveBeenCalledWith('fn_horse_exact_profiles_read', {
    p_user_ids: [id],
    p_variant: 'plo6',
    p_mode: 'cash',
    p_size: 'short',
    p_speed: 'lightning',
    p_ante: 'big_blind',
  });
  expect(mock.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it('does not query unknown original rules', async () => {
  expect(await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', null)).toEqual([]);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it.each(['legacy', 'wrong_speed', 'wrong_ante', 'wrong_variant', 'other_actor', 'duplicate'])(
  'refuses %s response without legacy fallback',
  async (fault) => {
    const r: any = row();
    if (fault === 'legacy') delete r.public_memory_domain;
    if (fault === 'wrong_speed') r.public_memory_domain = { ...domain, speed: 'table' };
    if (fault === 'wrong_ante') r.public_memory_domain = { ...domain, ante: 'none' };
    if (fault === 'wrong_variant') r.variant = 'plo4';
    if (fault === 'other_actor') r.user_id = '20000000-0000-4000-8000-000000000002';
    mock.abortSignal.mockResolvedValue({ data: fault === 'duplicate' ? [r, r] : [r], error: null });
    await expect(
      readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)
    ).rejects.toThrow('exact public memory unavailable');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  }
);

const fires = async () => {
  const telemetry = await import('../engine/BrainTelemetry.js');
  return new Map(telemetry.drainFires().map((f) => [f.feature, f.fires]));
};
// The shared admission gate closes for 1.5 s after a failed read. Each receipt
// test starts on its own later clock so one test's failure is not the next
// test's busy refusal; only Date is faked, timers and AbortSignal stay real.
let clock = Date.now();
const armTelemetry = async () => {
  clock += 60_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  const telemetry = await import('../engine/BrainTelemetry.js');
  telemetry.enableBrainTelemetry();
  telemetry.drainFires();
};
afterEach(() => vi.useRealTimers());
it('leaves an ok receipt and one latency bucket for a validated exact-domain read', async () => {
  await armTelemetry();
  await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain);
  const fired = await fires();
  expect(fired.get('horse_exact_memory_read_ok')).toBe(1);
  expect([...fired.keys()].filter((k) => k.startsWith('horse_exact_memory_read_ms_'))).toHaveLength(
    1
  );
  expect([...fired.keys()].filter((k) => k.startsWith('horse_opponent_memory_read_'))).toEqual([]);
});
it('leaves no receipt when unknown original rules skip the query', async () => {
  await armTelemetry();
  await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', null);
  expect((await fires()).size).toBe(0);
});
it.each([
  ['query error', { data: null, error: { code: 'PGRST000', message: 'down' } }, 'failed'],
  ['statement timeout', { data: null, error: { code: '57014', message: 'canceled' } }, 'timeout'],
  [
    'aborted request',
    { data: null, error: { code: '', name: 'AbortError', message: 'AbortError: aborted' } },
    'timeout',
  ],
] as const)('names a %s like the legacy reader does', async (_name, response, kind) => {
  await armTelemetry();
  mock.abortSignal.mockResolvedValue(response);
  await expect(
    readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)
  ).rejects.toThrow('exact public memory unavailable');
  const fired = await fires();
  expect(fired.get(`horse_exact_memory_read_${kind}`)).toBe(1);
  expect(fired.get('horse_exact_memory_read_ok')).toBeUndefined();
  expect(fired.get('horse_exact_memory_read_invalid')).toBeUndefined();
});
it('names an admission refusal busy and keeps the refusal identity for the caller', async () => {
  await armTelemetry();
  const { isOpponentMemoryBusyRefusal } = await import('./errorReporter.js');
  // Hold the shared admission closed with one pending read, then ask again.
  let release!: () => void;
  mock.abortSignal.mockReturnValueOnce(
    new Promise((resolve) => {
      release = () => resolve({ data: [row()], error: null });
    })
  );
  const { admitOpponentMemoryRead } = await import('./HorseOpponentMemory.js');
  const refusals: unknown[] = [];
  const holds = Array.from({ length: 8 }, () =>
    admitOpponentMemoryRead(() => new Promise<void>((resolve) => setTimeout(resolve, 5)))
  );
  await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain).catch((e) =>
    refusals.push(e)
  );
  await Promise.all(holds);
  release();
  expect(refusals).toHaveLength(1);
  expect(isOpponentMemoryBusyRefusal(refusals[0])).toBe(true);
  expect((await fires()).get('horse_exact_memory_read_busy')).toBe(1);
});
it('names a response that fails receipt validation invalid, apart from transport failures', async () => {
  await armTelemetry();
  const r: any = row();
  delete r.public_memory_domain;
  mock.abortSignal.mockResolvedValue({ data: [r], error: null });
  await expect(
    readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)
  ).rejects.toThrow('exact public memory unavailable');
  const fired = await fires();
  expect(fired.get('horse_exact_memory_read_invalid')).toBe(1);
  expect(fired.get('horse_exact_memory_read_failed')).toBeUndefined();
  expect(fired.get('horse_exact_memory_read_ok')).toBeUndefined();
});
