/**
 * Phase 14 evidence on a real worker (2026-11-13): why an admitted domain's
 * decision is outside the corrective kernel, and a DEEP second look that
 * reached it. Counting changes nothing the decision reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { now } from '../../services/horseCorrectiveReview/kernelApproval.test-support.js';
import { buildHorseDecisionKey } from './protocol.js';
import { harness, request, run } from './phase14Worker.test-support.js';

afterEach(() => vi.restoreAllMocks());

const phase14Notes = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((k) => k.startsWith('phase14_kernel_'));

describe('Phase 14 kernel evidence', () => {
  it('an eligible FAST decision counts eligible once and no refusal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const h = harness();
    const noted = vi.spyOn(h.deps, 'noteFeature');
    await run(h);
    expect(phase14Notes(noted)).toEqual(['phase14_kernel_eligible_seen']);
  });

  it('an admitted domain decision outside the family counts its first refusing check', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const h = harness();
    const noted = vi.spyOn(h.deps, 'noteFeature');
    const r = request();
    const opponent = r.gameState.players.find((p) => p.user_id !== r.player.user_id)!;
    opponent.is_all_in = false;
    opponent.stack = 50;
    r.decisionKey = buildHorseDecisionKey(r);
    const fast = await run(h, r);
    expect(phase14Notes(noted)).toEqual([
      'phase14_kernel_refused_original_opponent_not_all_in_seen',
    ]);
    expect(fast.decision.correctivePolicy).toBeUndefined();
  });

  it('a domain that is not admitted counts no refusal at all', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const h = harness(false);
    const noted = vi.spyOn(h.deps, 'noteFeature');
    await run(h);
    expect(phase14Notes(noted)).toEqual([]);
  });

  it('a DEEP second look that reached the kernel is counted apart from FAST', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const h = harness();
    const noted = vi.spyOn(h.deps, 'noteFeature');
    const fast = await run(h);
    h.runtime.receive({
      ...request(),
      type: 'DECIDE_DEEP',
      requestId: 2,
      rngBefore: fast.rngBefore,
      deepEquity: 2,
    });
    await h.runtime.drain();
    expect(h.messages.some((m) => m.type === 'DEEP_RESULT')).toBe(true);
    expect(phase14Notes(noted)).toEqual([
      'phase14_kernel_eligible_seen',
      'phase14_kernel_eligible_deep_seen',
    ]);
  });
});
