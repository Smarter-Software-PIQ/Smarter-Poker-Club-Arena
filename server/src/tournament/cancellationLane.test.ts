import { describe, expect, it, vi } from 'vitest';
import { CANCELLATION_LANE_ATTEMPTS, throughCancellationLane } from './cancellationLane.js';

const busy = { data: null, error: { code: '55P03' } };
const ok = { data: { ok: true }, error: null };
const noPause = async () => {};

describe('the cancellation lane is taken when a gap appears', () => {
  it('asks again only while the lane is busy, then returns the admitted result', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(busy)
      .mockResolvedValue(ok);
    expect(await throughCancellationLane(call, noPause)).toBe(ok);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('never repeats any other answer', async () => {
    for (const answer of [
      ok,
      { data: null, error: { code: '55000' } },
      { data: null, error: null },
    ]) {
      const call = vi.fn().mockResolvedValue(answer);
      expect(await throughCancellationLane(call, noPause)).toBe(answer);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it('stops at its fixed budget and reports the refusal', async () => {
    const call = vi.fn().mockResolvedValue(busy);
    expect(await throughCancellationLane(call, noPause)).toBe(busy);
    expect(call).toHaveBeenCalledTimes(CANCELLATION_LANE_ATTEMPTS);
  });
});
