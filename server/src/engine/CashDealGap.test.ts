import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CashDealGapRecorder,
  CASH_NEXT_HAND_LIMIT_MS,
  CASH_NEXT_HAND_BREACH_TAG,
  reportCashNextHandBreach,
} from './CashDealGap.js';

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
    // Every sample over the limit also leaves its durable breach line, there.
    const report = src.indexOf('reportCashNextHandBreach({', rec);
    expect(report).toBeGreaterThan(rec);
    expect(start).toBeGreaterThan(report);
    expect(src.slice(rec, report)).toContain('gapMs > CASH_NEXT_HAND_LIMIT_MS');
    const health = readFileSync(new URL('../GameServer.ts', import.meta.url), 'utf8');
    expect(health).toContain('cashNextHandStart: cashDealGap.snapshot()');
  });
});

describe('every cash next-hand breach leaves one durable log line (2026-11-10)', () => {
  it('writes exactly one line over the limit, none at or under it, and no card or credential', () => {
    const lines: string[] = [];
    const base = {
      tableId: 'tbl-1',
      handNumber: 41,
      nextHandNumber: 42,
      at: 1_700_000_000_000,
      stages: {
        await_post_hand_tasks: 900.4,
        load_next_hand_inputs: 300,
        next_hand_rest: 700,
        deal: 601,
        // Anything that is not a plain phase name or a duration is dropped.
        'holeCards:As Kd': 1,
        token: 'secret' as unknown as number,
      },
      settlement: {
        complete: false,
        spansMs: { hand_history: 1800, rake_distribution: 40 },
        threw: ['hand_history'],
      },
      // Fields the engine must never pass through, even if handed them.
      holeCards: ['As', 'Kd'],
      accessToken: 'eyJsecret',
    };
    reportCashNextHandBreach({ ...base, gapMs: CASH_NEXT_HAND_LIMIT_MS }, (l) => lines.push(l));
    reportCashNextHandBreach({ ...base, gapMs: 1500 }, (l) => lines.push(l));
    expect(lines).toHaveLength(0);
    reportCashNextHandBreach({ ...base, gapMs: 2501 }, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(`${CASH_NEXT_HAND_BREACH_TAG} {`)).toBe(true);
    const rec = JSON.parse(lines[0].slice(CASH_NEXT_HAND_BREACH_TAG.length + 1));
    expect(rec).toEqual({
      v: 1,
      tableId: 'tbl-1',
      handNumber: 41,
      nextHandNumber: 42,
      gapMs: 2501,
      limitMs: 2000,
      at: 1_700_000_000_000,
      stages: {
        await_post_hand_tasks: 900,
        load_next_hand_inputs: 300,
        next_hand_rest: 700,
        deal: 601,
      },
      settlement: {
        complete: false,
        spansMs: { hand_history: 1800, rake_distribution: 40 },
        threw: ['hand_history'],
      },
    });
    expect(lines[0]).not.toMatch(/holeCards|accessToken|secret|token|"As"|"Kd"|As Kd/);
  });
});
