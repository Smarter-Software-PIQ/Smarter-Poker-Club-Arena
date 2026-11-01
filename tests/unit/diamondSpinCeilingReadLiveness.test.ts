import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { withDiamondSpinCeilings } from '../../src/services/diamondSpinCeilings';
import { reportError } from '../../src/utils/errorReporter';
const board = [
  {
    id: 'spin',
    format_contract: 'spin-v1',
    tournament_type: 'SPIN',
    variant: 'spin',
    arena: { id: 'arena', asset: 'diamonds', is_platform: true, union_id: null },
  },
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});
it('lets the board finish with an unknown ceiling when enrichment stalls', async () => {
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  rpc.mockReturnValue(
    Object.assign(response, {
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return response;
      },
    })
  );
  let outcome: unknown = 'pending';
  void withDiamondSpinCeilings(board).then((value) => {
    outcome = value;
  });
  await vi.advanceTimersByTimeAsync(12_000);
  expect(outcome).toBe(board);
  expect(signal?.aborted).toBe(true);
  expect(reportError).toHaveBeenCalledTimes(1);
  finish({ data: [{ tournament_id: 'spin', max_multiplier: 10 }], error: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBe(board);
  expect(rpc).toHaveBeenCalledTimes(1);
});
