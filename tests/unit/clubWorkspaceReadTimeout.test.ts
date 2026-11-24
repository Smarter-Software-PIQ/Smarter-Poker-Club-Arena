/**
 * The club workspace names its own read deadline (2026-11-24). supabase-js
 * returns `{ error: AbortError }` instead of throwing when its signal aborts,
 * so a deadline that only labelled thrown errors reached the error sink as an
 * anonymous "signal is aborted without reason", indistinguishable from an
 * auth lock timeout while diagnosing GRANDmasterFLUSH's fault card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withClubWorkspaceReadTimeout } from '../../src/contexts/clubWorkspaceReadTimeout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A read shaped like supabase-js: an aborted signal RESOLVES with an error. */
function supabaseShapedRead(signal: AbortSignal) {
  return new Promise<{ data: null; error: { message: string } | null }>((resolve) => {
    signal.addEventListener('abort', () =>
      resolve({ data: null, error: { message: 'AbortError: signal is aborted without reason' } })
    );
  });
}

describe('withClubWorkspaceReadTimeout', () => {
  it('names its deadline when the read resolves with an abort error', async () => {
    const outcome = withClubWorkspaceReadTimeout(supabaseShapedRead, 'Club membership lookup');
    const settled = expect(outcome).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Club membership lookup timed out after 10000ms.',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  it('names its deadline when the read throws on abort', async () => {
    const outcome = withClubWorkspaceReadTimeout(
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        ),
      'Club identity lookup'
    );
    const settled = expect(outcome).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  it('passes an answer, and an error the read itself returned, straight through', async () => {
    await expect(
      withClubWorkspaceReadTimeout(async () => ({ data: { role: 'player' }, error: null }), 'x')
    ).resolves.toEqual({ data: { role: 'player' }, error: null });
    const refused = { data: null, error: { message: 'permission denied' } };
    await expect(withClubWorkspaceReadTimeout(async () => refused, 'x')).resolves.toBe(refused);
  });
});
