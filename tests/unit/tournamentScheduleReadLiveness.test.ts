import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { tournamentScheduleService } from '../../src/services/TournamentScheduleService';

function query(answer: Promise<unknown>) {
  const builder: any = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    abortSignal: vi.fn(),
    then: answer.then.bind(answer),
  };
  for (const key of ['select', 'eq', 'order', 'abortSignal']) builder[key].mockReturnValue(builder);
  vi.spyOn(supabase, 'from').mockClear().mockReturnValue(builder);
  return builder;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('schedule reads preserve unknown outcomes', () => {
  it('refuses a failed read instead of reporting an empty schedule', async () => {
    query(Promise.resolve({ data: null, error: { message: 'Unavailable' } }));
    await expect(tournamentScheduleService.listForUnion('union')).rejects.toThrow();
  });
  it('settles a never-answering read within the shared read budget', async () => {
    vi.useFakeTimers();
    const builder = query(new Promise(() => {}));
    let outcome = 'pending';
    void tournamentScheduleService.listForUnion('union').then(
      () => {
        outcome = 'loaded';
      },
      () => {
        outcome = 'unknown';
      }
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(outcome).toBe('unknown');
    expect(builder.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
  it('does not invent an empty list from a malformed success response', async () => {
    query(Promise.resolve({ data: null, error: null }));
    await expect(tournamentScheduleService.listForUnion('union')).rejects.toThrow();
  });
  it('accepts a genuinely empty result', async () => {
    query(Promise.resolve({ data: [], error: null }));
    await expect(tournamentScheduleService.listForUnion('union')).resolves.toEqual([]);
  });
});
describe('schedule acknowledgements require a positive receipt', () => {
  it.each(['activate', 'deactivate'])('rejects a malformed %s receipt', async (action) => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: { ok: 'false' }, error: null } as never);
    await expect(
      tournamentScheduleService.setActive('schedule', action === 'activate')
    ).rejects.toThrow();
  });
});

describe('schedule create receipt', () => {
  it.each([
    { ok: 'false', schedule_id: 'id' },
    { ok: true, schedule_id: 5 },
    { ok: true, schedule_id: ' ' },
  ])('rejects an unproven create receipt %j', async (data) => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data, error: null } as never);
    await expect(
      tournamentScheduleService.upsert({
        clubId: 'club',
        name: 'Daily',
        daysOfWeek: [1],
        startTimesUtc: ['18:00'],
        config: { type: 'mtt' },
      })
    ).rejects.toThrow();
  });
});
