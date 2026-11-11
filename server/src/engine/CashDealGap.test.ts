import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CashDealGapRecorder,
  CASH_NEXT_HAND_LIMIT_MS,
  CASH_NEXT_HAND_BREACH_TAG,
  CashBreachLineBudget,
  CashNextHandSpan,
  reportCashNextHandBreach,
} from './CashDealGap.js';

const parse = (line: string) => JSON.parse(line.slice(CASH_NEXT_HAND_BREACH_TAG.length + 1));
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

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
      v: 2,
      tableId: 'tbl-1',
      outcome: 'dealt',
      counted: false,
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
        overlapping: true,
        complete: false,
        spansMs: { hand_history: 1800, rake_distribution: 40 },
        threw: ['hand_history'],
      },
    });
    expect(lines[0]).not.toMatch(/holeCards|accessToken|secret|token|"As"|"Kd"|As Kd/);
  });
});

describe('the breach line is monotonic, complete, partitioned, never silent, and bounded', () => {
  it('stages partition gapMs exactly, with no overlap, on the monotonic clock', () => {
    const t0 = 5_000.37;
    const span = new CashNextHandSpan('tbl-1', 41, 'post_hand_hold', t0);
    span.enter('await_post_hand_tasks', null, t0 + 0.6);
    span.enter('load_next_hand_inputs', null, t0 + 911.2);
    span.enter('next_hand_rest', null, t0 + 1203.49);
    span.restEnded = true;
    span.enter('deal', null, t0 + 2000.5);
    span.enter('dealing', null, t0 + 2100.51);
    span.enter('load_next_hand_inputs', null, t0 + 2400.4); // a repeated phase adds up
    const { gapMs, stages } = span.close(t0 + 3333.33);
    expect(gapMs).toBe(3333);
    expect(sum(stages)).toBe(gapMs);
    expect(stages.load_next_hand_inputs).toBe(
      Math.round(1203.49) - Math.round(911.2) + (3333 - 2400)
    );
    for (const v of Object.values(stages)) expect(v).toBeGreaterThanOrEqual(0);
    // Random phase walks: the sum is exact every time.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 500; n++) {
      const start = rnd() * 1e6;
      const s = new CashNextHandSpan('t', 1, 'a', start);
      let at = start;
      for (let k = 0; k < 1 + Math.floor(rnd() * 12); k++) {
        at += rnd() * 900;
        s.enter(['a', 'b', 'c', 'd'][Math.floor(rnd() * 4)], null, at);
      }
      const r = s.close(at + rnd() * 3000);
      expect(Math.abs(sum(r.stages) - r.gapMs)).toBeLessThanOrEqual(1);
      expect(sum(r.stages)).toBe(r.gapMs);
    }
  });

  it('settlement spans are labelled overlapping and are not stages', () => {
    const lines: string[] = [];
    const span = new CashNextHandSpan('tbl-1', 41, 'post_hand_hold', 0);
    span.enter('next_hand_rest', null, 1000);
    const { gapMs, stages } = span.close(2600);
    reportCashNextHandBreach(
      {
        tableId: 'tbl-1',
        handNumber: 41,
        nextHandNumber: 42,
        gapMs,
        at: 1,
        stages,
        settlement: { complete: true, spansMs: { hand_history: 2500 }, threw: [] },
      },
      (l) => lines.push(l),
      new CashBreachLineBudget()
    );
    const rec = parse(lines[0]);
    expect(rec.settlement.overlapping).toBe(true);
    expect(sum(rec.stages)).toBe(rec.gapMs);
    expect(rec.stages).not.toHaveProperty('hand_history');
  });

  it('an exclusion is labelled only for a wait seen before the rest ends, like the metric', () => {
    const a = new CashNextHandSpan('t', 1, 'post_hand_hold', 0);
    a.enter('idle_not_enough_players', 'waiting_for_players', 10);
    a.enter('rebuy_pause', 'rebuy_pause', 20);
    expect(a.excluded).toBe('waiting_for_players');
    const b = new CashNextHandSpan('t', 1, 'post_hand_hold', 0);
    b.restEnded = true;
    b.enter('parked_for_pause', 'parked_for_pause', 10);
    expect(b.excluded).toBeNull();
  });

  it('an abandoned or never-dealt wait over the limit leaves one aborted line with its reason', () => {
    const lines: string[] = [];
    const budget = new CashBreachLineBudget();
    const span = new CashNextHandSpan('tbl-9', 77, 'post_hand_hold', 0);
    span.enter('idle_not_enough_players', 'waiting_for_players', 300);
    const { gapMs, stages } = span.close(9000);
    const b = { tableId: 'tbl-9', handNumber: 77, nextHandNumber: null, gapMs, at: 1, stages };
    reportCashNextHandBreach(
      { ...b, outcome: 'aborted', reason: 'table_stopped', excluded: span.excluded },
      (l) => lines.push(l),
      budget
    );
    reportCashNextHandBreach(
      { ...b, outcome: 'aborted', reason: 'engine_killed:lease_proof_expired', gapMs: 1999 },
      (l) => lines.push(l),
      budget
    );
    expect(lines).toHaveLength(1);
    expect(parse(lines[0])).toMatchObject({
      outcome: 'aborted',
      reason: 'table_stopped',
      excluded: 'waiting_for_players',
      counted: false,
      nextHandNumber: null,
      gapMs: 9000,
    });
    expect(sum(parse(lines[0]).stages)).toBe(9000);
  });

  it('the engine stamps both clocks at the same instants and settles every exit', () => {
    const src = readFileSync(new URL('./ServerTableEngineDealing.ts', import.meta.url), 'utf8');
    // Start: the span opens on the completion stamp's own performance.now().
    const arm = src.slice(
      src.indexOf('protected armNextHandRest('),
      src.indexOf('static readonly BLIND_READ_LEAD_MS')
    );
    expect(arm).toContain('const monotonicMs = performance.now();');
    expect(arm).toContain(
      'new CashNextHandSpan(this.tableId, this.handCount, this.loopPhase, monotonicMs)'
    );
    expect(arm).toContain('this.lastCompletionAtMs = now;');
    // End: the span closes beside the metric's own stamp, before the controller.
    const rec = src.indexOf('cashDealGap.record(');
    const close = src.indexOf('const breachEnd = breachSpan?.close();');
    const start = src.indexOf('await this.runOriginalController(');
    expect(close).toBeGreaterThan(-1);
    expect(rec).toBeGreaterThan(close);
    expect(src.slice(close, rec)).not.toMatch(/await /);
    expect(start).toBeGreaterThan(rec);
    expect(src.slice(close, start)).toContain('gapMs: breachEnd.gapMs');
    // The metric keeps its Date.now() definition; the breach line never uses it.
    expect(src.slice(close, start)).toContain('gapMs: startAtMs - cashDealGapAnchor');
    const report = src.slice(src.indexOf('reportCashNextHandBreach({', close), start);
    expect(report).not.toMatch(/startAtMs -|Date\.now\(\) -/);
    // Never silent: loop exit, stop, kill, and a pass that came round undealt.
    expect(src).toMatch(/finally \{[\s\S]{0,300}this\.settleCashBreachSpan\(\s*'aborted'/);
    expect(src).toMatch(
      /override stop\(\): Promise<void> \{\s*this\.settleCashBreachSpan\('aborted', 'table_stopped'\);/
    );
    expect(src).toMatch(
      /protected override killForRestart\([\s\S]{0,200}this\.settleCashBreachSpan\(/
    );
    expect(src).toMatch(
      /while \(this\.running\) \{[\s\S]{0,400}this\.abandonCashBreachAttempt\(\);/
    );
    // No timer drives any of it.
    const breach = src.slice(
      src.indexOf('private settleCashBreachSpan('),
      src.indexOf('private cashBreachSettlement(')
    );
    expect(breach).not.toMatch(/setTimeout|setInterval|sleep\(/);
  });

  it('caps lines per process per rolling minute, then reports the dropped count once', () => {
    const lines: string[] = [];
    const budget = new CashBreachLineBudget(600, 60_000);
    const line = 'x';
    let t = 1000;
    for (let i = 0; i < 1000; i++) for (const l of budget.admit(line, (t += 10))) lines.push(l);
    // 1000 breaches in 10 s: 600 written, 400 counted.
    expect(lines).toHaveLength(600);
    const after = budget.admit(line, t + 60_000);
    expect(after).toHaveLength(2);
    expect(after[0].startsWith(CASH_NEXT_HAND_BREACH_TAG)).toBe(true);
    expect(parse(after[0])).toEqual({
      v: 2,
      summary: true,
      dropped: 400,
      maxLines: 600,
      windowMs: 60_000,
    });
    expect(after[1]).toBe('x');
    expect(budget.admit(line, t + 60_001)).toEqual(['x']);
  });
});
