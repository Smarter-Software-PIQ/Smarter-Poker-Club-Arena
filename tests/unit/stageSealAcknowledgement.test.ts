import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
import { sealStagePlan, verifySealedStagePlan } from '../../src/services/TournamentStageService';
import type { SealedStagePlanBody } from '../../src/utils/multiDaySchedule';
const plan: SealedStagePlanBody = {
  time_zone: 'America/Chicago',
  stages: [
    { stage_no: 1, end_after_level: 20 },
    { stage_no: 2, scheduled_start_utc: '2026-11-04T01:00:00.000Z' },
  ],
};
const reply = () => ({
  ok: true,
  tournament_id: 'event-1',
  plan: { time_zone: plan.time_zone, stage_count: 2 },
  stages: [
    { stage_no: 1, end_after_level: 20, scheduled_start_utc: null },
    { stage_no: 2, end_after_level: null, scheduled_start_utc: '2026-11-04T01:00:00+00:00' },
  ],
});
function respond(data: unknown, error: unknown = null) {
  rpc.mockImplementation(() => ({ abortSignal: vi.fn().mockResolvedValue({ data, error }) }));
}
beforeEach(() => {
  rpc.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
describe('the original stage seal has a bounded, verified outcome', () => {
  it('expires an unanswered seal, aborts its transport and ignores a late success', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let release!: (value: unknown) => void;
    rpc.mockReturnValue({
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const result = sealStagePlan('event-1', plan);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toEqual({ ok: false, reason: 'seal_outcome_unknown' });
    expect(signal?.aborted).toBe(true);
    release({
      data: { ok: true, tournament_id: 'event-1', stage_count: 2, plan_hash: 'a'.repeat(32) },
      error: null,
    });
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts only the exact event and complete canonical seal receipt', async () => {
    const good = {
      ok: true,
      replay: true,
      tournament_id: 'event-1',
      stage_count: 2,
      plan_hash: 'a'.repeat(32),
    };
    respond(good);
    expect(await sealStagePlan('event-1', plan)).toMatchObject({ ok: true, replay: true });
    for (const bad of [
      { ...good, tournament_id: 'other' },
      { ...good, stage_count: 3 },
      { ...good, plan_hash: null },
      { ok: true },
    ]) {
      respond(bad);
      expect(await sealStagePlan('event-1', plan)).toEqual({
        ok: false,
        reason: 'seal_outcome_unknown',
      });
    }
  });
  it('verifies persisted stage values independently after any acknowledgement', async () => {
    respond(reply());
    expect(await verifySealedStagePlan('event-1', plan)).toBe(true);
    for (const bad of [
      { ...reply(), tournament_id: 'other' },
      { ...reply(), plan: null },
      { ...reply(), plan: { time_zone: 'UTC', stage_count: 2 } },
      { ...reply(), stages: [reply().stages[0], reply().stages[0]] },
      {
        ...reply(),
        stages: [
          reply().stages[0],
          { ...reply().stages[1], scheduled_start_utc: '2026-11-05T01:00:00Z' },
        ],
      },
      { ...reply(), stages: [{ ...reply().stages[0], end_after_level: 21 }, reply().stages[1]] },
    ]) {
      respond(bad);
      expect(await verifySealedStagePlan('event-1', plan)).toBe(false);
    }
  });
  it('bounds a missing readback and preserves unknown rather than one-day', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    rpc.mockReturnValue({
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return new Promise(() => {});
      },
    });
    const read = verifySealedStagePlan('event-1', plan);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await read).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
