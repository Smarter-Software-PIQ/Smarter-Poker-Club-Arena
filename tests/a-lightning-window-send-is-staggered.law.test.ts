import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-07: root-cause the Lightning RPC 500s. fn_lightning_integrity_report
// timed out (8 s) at every maintenance release - 02:05, 08:05, 14:05, 14:12,
// 19:21 UTC - because every Cluster sent its wall-clock-aligned window at the
// same instant into a database still draining its release. Each Cluster now
// sends at its own stable offset after its window closes.
const runner = readFileSync('server/src/lightning/LightningShadowRunner.ts', 'utf8');
const worker = readFileSync('server/src/lightning/LightningClusterWorker.ts', 'utf8');

describe('a Lightning window send is staggered across Clusters', () => {
  it('the production worker spreads the sends', () => {
    expect(worker).toContain('flushSpreadMs: LIGHTNING_SHADOW_FLUSH_SPREAD_MS,');
    expect(runner).toContain('export const LIGHTNING_SHADOW_FLUSH_SPREAD_MS = 60_000;');
  });

  it('the offset runs from the close, not the nominal window end', () => {
    expect(runner).toContain('sendAtMs: Number.isFinite(closedAtMs) ? closedAtMs + offset');
    expect(runner).toContain(
      'this.closeWindow(this.windowStartMs, this.windowStartMs + cfg.windowMs, cfg, nowMs);'
    );
  });

  it('a waiting window is sent on the next pass or at stop, never by a timer', () => {
    expect(runner).toContain('this.sendDue(pass.nowMs);');
    expect(runner).toContain('this.sendDue(Number.POSITIVE_INFINITY);');
    const spreadBlock = runner.slice(
      runner.indexOf('private sendDue('),
      runner.indexOf('private sendDue(') + 600
    );
    expect(spreadBlock).not.toMatch(/setTimeout|setInterval/);
  });

  it('the behaviour is proved in the server suite', () => {
    expect(
      readFileSync('server/src/lightning/LightningShadowFlushSpread.test.ts', 'utf8')
    ).toContain('after a freeze, Clusters resuming on the same pass do not send on that pass');
  });
});
