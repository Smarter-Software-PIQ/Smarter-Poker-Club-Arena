/**
 * A hit is counted for each decision whose table, street and board match a
 * prewarm its worker stored (per decision, so hits can exceed prewarms). Until 2026-11-13 the check compared the
 * prewarm's table id with the decision's whole fence
 * (table:hand:seat:lease:token) and could never match: release 08c27924
 * executed 4,502 prewarms and counted no hit. Real worker, real decision.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetBrainWatchcountersForTest } from '../BrainTelemetry.js';
import { now } from '../../services/horseCorrectiveReview/kernelApproval.test-support.js';
import { harness, request } from './phase14Worker.test-support.js';
import { buildHorseDecisionKey } from './protocol.js';
import { streetPrewarmTable } from './workerRuntime.js';

afterEach(() => vi.restoreAllMocks());

async function hitsAfterPrewarm(tableOf: (fence: string) => string): Promise<number> {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  resetBrainWatchcountersForTest();
  const h = harness(false);
  const r = request();
  // A live fence: table, hand, seat, lease generation, turn token.
  r.fence = 'table-9:17:3:9:turn-token';
  r.decisionKey = buildHorseDecisionKey(r);
  await h.runtime.start();
  h.runtime.receive({
    type: 'PREWARM_STREET',
    fence: tableOf(r.fence),
    street: 'river',
    board: r.gameState.communityCards,
    variant: 'nlh',
    mode: 'cash',
  } as never);
  await h.runtime.drain();
  h.runtime.receive(r);
  await h.runtime.drain();
  expect(h.messages.some((m) => m.type === 'FAST_RESULT')).toBe(true);
  // The deltas the worker relays are the evidence; this in-process worker
  // also shares the module counters, so they are read from the messages.
  type Delta = { metric: string; reason: string; value: number };
  return (h.messages as Array<{ watchcounterDeltas?: Delta[] }>)
    .flatMap((m) => m.watchcounterDeltas ?? [])
    .filter((d) => d.metric === 'poker_horse_street_prewarm_total' && d.reason === 'hit_river')
    .reduce((sum, d) => sum + d.value, 0);
}

describe('a street prewarm is counted as consumed by the decision that uses it', () => {
  it('keys a fence by its table', () => {
    expect(streetPrewarmTable('t4:17:3:9:tok')).toBe('t4');
    expect(streetPrewarmTable('t4')).toBe('t4');
  });

  it('counts one hit when the decision is at the prewarmed table and board', async () => {
    // The table id exactly as the engine posts it, not derived from the fence.
    expect(await hitsAfterPrewarm(() => 'table-9')).toBe(1);
  });

  it('counts no hit for a prewarm posted for another table', async () => {
    expect(await hitsAfterPrewarm(() => 'some-other-table')).toBe(0);
  });
});
