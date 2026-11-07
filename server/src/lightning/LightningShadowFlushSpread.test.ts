/**
 * ONE CLUSTER'S SEND IS NOT EVERY CLUSTER'S SEND (2026-11-07).
 *
 * Every Cluster closed its wall-clock-aligned window on the same pass second
 * and sent fn_lightning_integrity_report (mean 569 ms) at the same instant.
 * After a maintenance release that instant met a saturated database: 02:05,
 * 08:05, 14:05, 14:12 and 19:21 UTC, each report hit the 8 s statement
 * timeout and its window was dropped.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
const { parseLightningShadowConfig } = await import('./LightningConfig.js');
const { LightningTelemetry } = await import('./LightningTelemetry.js');
const { LightningShadowRunner, LIGHTNING_SHADOW_FLUSH_SPREAD_MS, lightningShadowFlushOffsetMs } =
  await import('./LightningShadowRunner.js');

const ON = { lightning_shadow_matcher: true, integrity_telemetry: true, shadow_window_ms: 60_000 };
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = uid(901);
const P2 = uid(902);

function runnerFor(clusterId: string, spreadMs: number) {
  const calls: string[] = [];
  const rpc = vi.fn(async (fn: string) => {
    calls.push(fn);
    return { data: { ok: true }, error: null };
  });
  const runner = new LightningShadowRunner(clusterId, {
    rpc: rpc as never,
    telemetry: new LightningTelemetry(),
    logger: quiet,
    now: () => new Date(0),
    clock: () => 0,
    flushSpreadMs: spreadMs,
  });
  runner.configure(parseLightningShadowConfig(ON));
  const pass = (nowMs: number) =>
    runner.observe({
      nowMs,
      presence: { connected: [P1, P2], disconnected: [] },
      kind: 'form',
      ok: true,
      matcherVersion: 'm1',
      groups: [],
    });
  const evidence = () => {
    runner.handDealt('h-1', [P1, P2]);
    runner.decision('h-1', P1, 900);
    runner.decision('h-1', P2, 1_100);
  };
  return { runner, calls, pass, evidence };
}

describe('a Cluster sends its closed window at its own offset', () => {
  it('the offset is stable per Cluster, inside the spread, never past half a window', () => {
    const a = lightningShadowFlushOffsetMs(uid(1), 60_000, 300_000);
    expect(lightningShadowFlushOffsetMs(uid(1), 60_000, 300_000)).toBe(a);
    for (let i = 0; i < 200; i++) {
      const o = lightningShadowFlushOffsetMs(uid(i), 60_000, 300_000);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(60_000);
      expect(lightningShadowFlushOffsetMs(uid(i), 60_000, 40_000)).toBeLessThan(20_000);
    }
    const spread = new Set(
      Array.from({ length: 50 }, (_, i) =>
        Math.floor(lightningShadowFlushOffsetMs(uid(i), 60_000, 300_000) / 6_000)
      )
    );
    expect(spread.size).toBeGreaterThanOrEqual(7); // 50 Clusters land in most tenths
    expect(lightningShadowFlushOffsetMs(uid(1), 0, 300_000)).toBe(0);
    expect(LIGHTNING_SHADOW_FLUSH_SPREAD_MS).toBe(60_000);
  });

  it('nothing is sent at the close; the window goes once its offset has passed', async () => {
    const cluster = uid(7);
    const offset = lightningShadowFlushOffsetMs(cluster, 60_000, 60_000);
    const { runner, calls, pass, evidence } = runnerFor(cluster, 60_000);
    pass(1_000);
    evidence();
    pass(61_000); // closes [0, 60 000)
    await runner.settled();
    expect(calls).toEqual([]);
    if (offset > 0) {
      pass(61_000 + offset - 1);
      await runner.settled();
      expect(calls).toEqual([]);
    }
    pass(61_000 + offset);
    await runner.settled();
    expect(calls.sort()).toEqual(['fn_lightning_integrity_report', 'fn_lightning_shadow_record']);
  });

  it('after a freeze, Clusters resuming on the same pass do not send on that pass', async () => {
    // The 19:21 shape: every window ended minutes ago; the first pass after
    // the release closes them all at the same instant.
    const resumedAt = 10 * 60_000 + 3_000;
    const clusters = [uid(11), uid(12), uid(13), uid(14)].map((id) => ({
      id,
      offset: lightningShadowFlushOffsetMs(id, 60_000, 60_000),
      ...runnerFor(id, 60_000),
    }));
    for (const c of clusters) {
      c.pass(1_000);
      c.evidence();
      c.pass(resumedAt);
    }
    await Promise.all(clusters.map((c) => c.runner.settled()));
    // Only a Cluster whose own offset is zero may send at the release instant.
    for (const c of clusters) expect(c.calls.length > 0).toBe(c.offset === 0);
    for (const c of clusters) {
      c.pass(resumedAt + c.offset);
      await c.runner.settled();
      expect(c.calls).toContain('fn_lightning_integrity_report');
    }
  });

  it('a window waiting for its offset is sent when the runner stops', async () => {
    const cluster = uid(21);
    const { runner, calls, pass, evidence } = runnerFor(cluster, 60_000);
    pass(1_000);
    evidence();
    pass(61_000);
    await runner.stop();
    expect(calls).toContain('fn_lightning_integrity_report');
  });

  it('without a spread the send is at the close, as before', async () => {
    const { runner, calls, pass, evidence } = runnerFor(uid(31), 0);
    pass(1_000);
    evidence();
    pass(61_000);
    await runner.settled();
    expect(calls).toContain('fn_lightning_integrity_report');
  });
});
