/**
 * A PARKED EVENT CALL THAT RUNS OUT ITS DEADLINE IS AN ORDINARY TIMEOUT, NOT A
 * FATAL (2026-11-19).
 *
 * The event database bulkhead (#11354) made one attempt wait for its event's
 * permit inside the attempt's own deadline. The deadline rejects the
 * attempt's `boundary` promise, but that promise only gains a handler at the
 * Promise.race after the permit arrives. A call that was still parked when
 * its deadline fired therefore rejected a promise nobody was watching, and
 * index.ts turns every unhandledRejection into "FATAL - draining for
 * supervisor restart": one tournament's busy boot could drain the whole engine.
 * The caller must see `supabase_timeout`, and nothing may reach the process.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ fetches: [] as Array<typeof fetch> }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { global: { fetch: typeof fetch } }) => {
    captured.fetches.push(options.global.fetch);
    return {};
  },
}));
vi.mock('../errorReporter.js', () => ({ reportError: vi.fn() }));

const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const unhandled = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  captured.fetches.length = 0;
  vi.stubEnv('SUPABASE_TIMEOUT_MS', '100');
  process.on('unhandledRejection', unhandled);
  await import('./client.js');
});

afterEach(() => {
  process.off('unhandledRejection', unhandled);
  unhandled.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('a call parked behind its event bound times out with no unhandled rejection', async () => {
  const { eventDatabaseBulkhead } = await import('./eventDatabaseBulkhead.js');
  const { runWithTournamentDataAuthority } = await import('./dataActorContext.js');
  // Fill this event's whole bound so the next call parks.
  const held = Array.from({ length: 24 }, () => eventDatabaseBulkhead.acquire(TOURNAMENT));
  expect(held.every((permit) => !(permit instanceof Promise))).toBe(true);
  const transport = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  try {
    const outcome = await runWithTournamentDataAuthority(
      { tournamentId: TOURNAMENT, leaseGeneration: '22222222-2222-4222-8222-222222222222' },
      () =>
        captured.fetches[0]('https://example.test/rest/v1/rpc/x', { method: 'POST' }).then(
          () => 'success',
          (error: Error) => error.message
        )
    );
    expect(outcome).toBe('supabase_timeout');
    // Let any stray rejection surface before judging the process hook.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  } finally {
    for (const permit of held) eventDatabaseBulkhead.release(permit as never, 'neutral');
  }
});
