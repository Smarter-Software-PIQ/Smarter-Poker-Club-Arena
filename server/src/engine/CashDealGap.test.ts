import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CashDealGapRecorder, CASH_NEXT_HAND_LIMIT_MS } from './CashDealGap.js';

describe('the cash next-hand start is measured to the actual start (Dan 2026-11-05)', () => {
  it('reports n, p50, p95, p99, max and every gap over two seconds, per table too', () => {
    const r = new CashDealGapRecorder();
    const now = 1_000_000_000;
    for (let i = 1; i <= 100; i++) r.record({ tableId: 'a', gapMs: 1800 + i, at: now });
    r.record({ tableId: 'b', gapMs: 3500, at: now });
    const s = r.snapshot(now);
    expect(CASH_NEXT_HAND_LIMIT_MS).toBe(2000);
    expect(s.n).toBe(101);
    expect(s.maxMs).toBe(3500);
    r.record({ tableId: 'a', gapMs: 2000, at: now }); // exactly the limit is not over
    expect(r.snapshot(now).over).toBe(1);
    expect(s.byTable.b).toMatchObject({ n: 1, over: 1, maxMs: 3500 });
    expect(s.slowest[0]).toMatchObject({ tableId: 'b', gapMs: 3500 });
    expect(s.p50Ms).toBeLessThan(s.p95Ms!);
  });

  it('starts at the completion stamp, stops right before the controller starts, cash only', () => {
    const src = readFileSync(new URL('./ServerTableEngineDealing.ts', import.meta.url), 'utf8');
    const anchor = src.indexOf('this.cashDealGapAnchorMs =');
    expect(anchor).toBeGreaterThan(-1);
    // The whole assignment statement, up to its terminating semicolon.
    const statement = src.slice(anchor, src.indexOf(';', anchor));
    expect(statement).toContain('!this.isTournamentTable()');
    expect(statement).toContain('!this.gapSawIdle');
    expect(statement).toContain('!this.gapHadRebuyPause');
    const rec = src.indexOf('cashDealGap.record(');
    const start = src.indexOf('await this.runOriginalController(');
    expect(rec).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(rec);
    expect(src.slice(rec, start)).not.toMatch(/await /);
    const health = readFileSync(new URL('../GameServer.ts', import.meta.url), 'utf8');
    expect(health).toContain('cashNextHandStart: cashDealGap.snapshot()');
  });
});
