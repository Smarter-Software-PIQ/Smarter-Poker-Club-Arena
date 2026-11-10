/**
 * A FALLBACK SAYS WHICH PATH REJECTED IT (2026-11-09).
 *
 * HorseDecisionFallbacks fired at 91 fallbacks a minute while the worker's
 * health read expiredJobs 0, queueDepth 0 and recoverableRequestErrors 0.
 * `poker_horse_decision_fallbacks_total` was one unlabelled number, so the
 * rejection path could not be read off `/metrics`.
 *
 * The counter now carries `reason` from a closed set. This file pins: the set,
 * the pure error-to-reason mapping, the real client rejections that carry each
 * name, the labelled increment at the one fallback site, and that every reason
 * is on the always-on registry at zero. It is observability only: nothing here
 * asserts or changes which decisions fall back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HORSE_DECISION_FALLBACK_REASONS,
  horseDecisionFallbackReason,
  markHorseDecisionRejection,
  type HorseDecisionFallbackReason,
} from './fallbackReason.js';
import {
  HorseDecisionAbortedError,
  HorseDecisionExpiredError,
  LiveHorseDecisionWorkerClient,
} from './client.js';
import type { LiveHorseDecisionSnapshot } from './protocol.js';
import { HORSE_REQUEST_MAX_BYTES, HorseRequestCapacityError } from './requestRetentionBudget.js';
import {
  alwaysOnPrometheusLines,
  horseDecisionFallbacksTotal,
} from '../../observability/engineInstruments.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

class SilentWorker {
  private errorListener: ((error: Error) => void) | null = null;
  postMessage(): void {}
  on(event: string, listener: (value: never) => void): this {
    if (event === 'error') this.errorListener = listener as unknown as (error: Error) => void;
    return this;
  }
  terminate(): Promise<number> {
    return Promise.resolve(0);
  }
  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

const snapshot = (extra: Record<string, unknown> = {}): LiveHorseDecisionSnapshot =>
  ({
    generation: 1,
    fence: 'fence-1',
    decisionKey: 'key-1',
    decisionTimeMs: 1_800_000,
    player: { seat: 1, user_id: 'horse-1' },
    gameState: { heroSeat: 1, actionHistory: [], ...extra },
  }) as unknown as LiveHorseDecisionSnapshot;

const rejection = async (pending: Promise<unknown>): Promise<unknown> =>
  pending.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('the fallback reason is a closed set', () => {
  it('is exactly these values', () => {
    expect([...HORSE_DECISION_FALLBACK_REASONS]).toEqual([
      'expired',
      'capacity_refused',
      'shard_failed',
      'shard_stopping',
      'enqueue_failed',
      'validation_failed',
      'result_refused',
      'post_result_failed',
      'unknown',
    ]);
  });

  it('maps each produced rejection to its reason', () => {
    expect(horseDecisionFallbackReason(new HorseDecisionExpiredError())).toBe('expired');
    expect(horseDecisionFallbackReason(new HorseRequestCapacityError())).toBe('capacity_refused');
    const stamped: Exclude<HorseDecisionFallbackReason, 'unknown'>[] = [
      'expired',
      'capacity_refused',
      'shard_failed',
      'shard_stopping',
      'enqueue_failed',
      'validation_failed',
      'result_refused',
      'post_result_failed',
    ];
    for (const reason of stamped) {
      expect(horseDecisionFallbackReason(markHorseDecisionRejection(new Error('x'), reason))).toBe(
        reason
      );
    }
  });

  it('maps anything unrecognized to unknown and never reads the message', () => {
    for (const value of [
      new Error('horse decision expired after 8000ms'),
      new Error('live horse decision worker is stopping'),
      new TypeError('shard_failed'),
      new HorseDecisionAbortedError(),
      { horseDecisionRejection: 'not_a_reason' },
      'expired',
      42,
      null,
      undefined,
    ]) {
      expect(horseDecisionFallbackReason(value)).toBe('unknown');
    }
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('no');
        },
      }
    );
    expect(horseDecisionFallbackReason(hostile)).toBe('unknown');
  });

  it('keeps the first stamp, stays off the enumerable surface and never throws', () => {
    const error = new Error('worker core lost');
    expect(markHorseDecisionRejection(error, 'shard_failed')).toBe(error);
    markHorseDecisionRejection(error, 'enqueue_failed');
    expect(horseDecisionFallbackReason(error)).toBe('shard_failed');
    expect(Object.keys(error)).toEqual([]);
    expect(error.message).toBe('worker core lost');
    // A capacity refusal passing through the enqueue catch stays a capacity refusal.
    expect(
      horseDecisionFallbackReason(
        markHorseDecisionRejection(new HorseRequestCapacityError(), 'enqueue_failed')
      )
    ).toBe('capacity_refused');
    const frozen = Object.freeze(new Error('frozen'));
    expect(() => markHorseDecisionRejection(frozen, 'shard_failed')).not.toThrow();
    expect(horseDecisionFallbackReason(frozen)).toBe('unknown');
    expect(markHorseDecisionRejection('text', 'shard_failed')).toBe('text');
  });
});

describe('the real client names its rejections', () => {
  it('a terminal shard failure, and every enqueue after it, is shard_failed', async () => {
    const worker = new SilentWorker();
    const client = new LiveHorseDecisionWorkerClient({
      workerFactory: () => worker as never,
      onFatal: () => undefined,
    });
    client.ready().catch(() => undefined);
    const queued = client.decideFast(snapshot());
    worker.emitError(new Error('worker core lost'));
    const first = await rejection(queued);
    expect((first as Error).message).toBe('worker core lost');
    expect(horseDecisionFallbackReason(first)).toBe('shard_failed');
    expect(horseDecisionFallbackReason(await rejection(client.decideFast(snapshot())))).toBe(
      'shard_failed'
    );
  });

  it('a job that outlives its deadline is expired', async () => {
    vi.useFakeTimers();
    const client = new LiveHorseDecisionWorkerClient({
      workerFactory: () => new SilentWorker() as never,
      onFatal: () => undefined,
    });
    client.ready().catch(() => undefined);
    const pending = rejection(client.decideFast(snapshot(), undefined, { deadlineMs: 5 }));
    await vi.advanceTimersByTimeAsync(6);
    const error = await pending;
    expect(error).toBeInstanceOf(HorseDecisionExpiredError);
    expect(horseDecisionFallbackReason(error)).toBe('expired');
    await client.stop().catch(() => undefined);
  });

  it('an oversized request is capacity_refused and a stopping shard is shard_stopping', async () => {
    const client = new LiveHorseDecisionWorkerClient({
      workerFactory: () => new SilentWorker() as never,
      onFatal: () => undefined,
    });
    client.ready().catch(() => undefined);
    const oversized = await rejection(
      client.decideFast(snapshot({ padding: 'x'.repeat(HORSE_REQUEST_MAX_BYTES + 1) }))
    );
    expect(oversized).toBeInstanceOf(HorseRequestCapacityError);
    expect(horseDecisionFallbackReason(oversized)).toBe('capacity_refused');

    const stopping = client.stop();
    const refused = await rejection(client.decideFast(snapshot()));
    expect((refused as Error).message).toBe('live horse decision worker is stopping');
    expect(horseDecisionFallbackReason(refused)).toBe('shard_stopping');
    await stopping.catch(() => undefined);
  });

  it('the remaining paths are stamped where the source produces them', () => {
    const client = read('./client.ts');
    const lane = read('./lane.ts');
    expect(client).toContain(
      "const error = markHorseDecisionRejection(new Error(message.message), 'validation_failed');"
    );
    expect(client).toContain("markHorseDecisionRejection(error, 'result_refused');");
    expect(client).toContain(
      "return Promise.reject(markHorseDecisionRejection(error, 'enqueue_failed'));"
    );
    expect(client).toContain("throw markHorseDecisionRejection(error, 'post_result_failed');");
    expect(lane).toContain("throw markHorseDecisionRejection(error, 'post_result_failed');");
    expect(client).toContain("markHorseDecisionRejection(error, 'shard_failed');");
  });
});

describe('the counter carries the reason', () => {
  const turns = read('../ServerTableEngineTurns.ts');

  it('the one fallback site increments with the classified reason, inside its own try', () => {
    expect(turns.match(/horseDecisionFallbacksTotal\.inc\(/g)?.length).toBe(1);
    const at = turns.indexOf('EngineMetrics.horseDecisionFallbacksTotal.inc(1, {');
    expect(at).toBeGreaterThan(0);
    const site = turns.slice(at - 200, at + 260);
    expect(site).toContain('try {');
    expect(site).toContain('reason: horseDecisionFallbackReason(error),');
    expect(site).toContain('/* metrics must never affect gameplay */');
    expect(turns).toContain(
      "fastDecision = Promise.reject(markHorseDecisionRejection(error, 'enqueue_failed'));"
    );
  });

  it('every reason is registered at zero and a labelled increment lands on its series', () => {
    const value = (reason: string): number => {
      const line = alwaysOnPrometheusLines().find((l) =>
        l.startsWith(`poker_horse_decision_fallbacks_total{reason="${reason}"}`)
      );
      return line ? Number(line.split(' ').pop()) : NaN;
    };
    for (const reason of HORSE_DECISION_FALLBACK_REASONS)
      expect(value(reason), reason).toBeGreaterThanOrEqual(0);
    const series = alwaysOnPrometheusLines().filter((l) =>
      l.startsWith('poker_horse_decision_fallbacks_total')
    );
    expect(series.length).toBe(HORSE_DECISION_FALLBACK_REASONS.length);
    const before = value('shard_failed');
    horseDecisionFallbacksTotal.inc(1, {
      reason: horseDecisionFallbackReason(
        markHorseDecisionRejection(new Error('x'), 'shard_failed')
      ),
    });
    expect(value('shard_failed')).toBe(before + 1);
  });
});

describe('the alert reads the counter across every reason', () => {
  it('keeps its expression and no longer asserts expiry as the cause', () => {
    const rules = read('../../../../infra/monitoring/alert-rules.yml');
    const at = rules.indexOf('- alert: HorseDecisionFallbacks');
    const rule = rules.slice(at, rules.indexOf('- alert: ', at + 10));
    expect(rule).toContain(
      'expr: sum(rate(poker_horse_decision_fallbacks_total[10m])) * 60 > 5'
    );
    expect(rule).toContain('severity: critical');
    expect(rule).toContain('poker_horse_decision_fallbacks_total by reason');
    expect(rule).not.toContain('is failing or expiring jobs');
    for (const reason of HORSE_DECISION_FALLBACK_REASONS) expect(rule).toContain(reason);
  });
});
