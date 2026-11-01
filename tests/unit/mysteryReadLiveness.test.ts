import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { MysteryBountyService } from '../../src/services/MysteryBountyService';

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
describe('mystery read liveness', () => {
  it.each(['inventory', 'awards', 'leaderboard'] as const)(
    'bounds a stalled %s read and ignores its late success',
    async (kind) => {
      let finish!: (value: unknown) => void;
      const response = new Promise((resolve) => {
        finish = resolve;
      });
      let signal: AbortSignal | undefined;
      rpc.mockReturnValue(
        Object.assign(response, {
          abortSignal: (value: AbortSignal) => {
            signal = value;
            return response;
          },
        })
      );
      let outcome = 'pending';
      const request =
        kind === 'inventory'
          ? MysteryBountyService.getInventory('event', { strict: true })
          : kind === 'awards'
            ? MysteryBountyService.getAllAwards('event', { strict: true })
            : MysteryBountyService.getLeaderboard('event', { strict: true });
      void request.then(
        () => {
          outcome = 'success';
        },
        () => {
          outcome = 'unknown';
        }
      );
      await vi.advanceTimersByTimeAsync(12_000);
      expect(outcome).toBe('unknown');
      expect(signal?.aborted).toBe(true);
      finish({ data: { total: 0, rows: [], tiers: [] }, error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toBe('unknown');
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  );
  it('bounds a stalled later page without returning a partial award list', async () => {
    let signal: AbortSignal | undefined;
    rpc.mockImplementation((_name, params) => {
      const response =
        params.p_offset === 0
          ? Promise.resolve({
              data: {
                total: 201,
                rows: Array.from({ length: 200 }, (_, i) => ({ award_id: `award-${i}` })),
              },
              error: null,
            })
          : new Promise(() => {});
      return Object.assign(response, {
        abortSignal: (value: AbortSignal) => {
          signal = value;
          return response;
        },
      });
    });
    let outcome = 'pending';
    void MysteryBountyService.getAllAwards('event').then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'unknown';
      }
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(outcome).toBe('unknown');
    expect(signal?.aborted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
