import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COST_BAR,
  COST_GROUPS,
  formatCostReport,
  overBar,
  overBarByOption,
  quantile,
  readCostStates,
  summarize,
  untimed,
} from '../../scripts/ops/horse-option-cost.mjs';

const row = (name: string, on: number[], extra: Record<string, unknown> = {}) => ({
  name,
  releaseDefault: 'off',
  productionRow: null,
  liveOn: false,
  states: 100,
  all: { on: summarize(on), off: summarize(on.map(() => 1)) },
  applied: {
    n: on.length,
    on: summarize(on),
    off: summarize(on.map(() => 1)),
    added: summarize(on.map((x) => x - 1)),
    over50: on.filter((x) => x > 50).length,
    groups: {},
  },
  ...extra,
});

describe('horse option cost harness (scripts/ops/horse-option-cost.mjs)', () => {
  it('summarizes p50 / p95 / max and an empty list as nulls', () => {
    const ms = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantile(ms, 0.5)).toBe(51);
    expect(summarize(ms)).toEqual({ n: 100, p50: 51, p95: 96, max: 100 });
    expect(summarize([])).toEqual({ n: 0, p50: null, p95: null, max: null });
  });

  it('flags every bar breach (p95 > 10, max > 25, any over 50) and never an option that never applied', () => {
    expect(COST_BAR).toEqual({ p95: 10, max: 25, hard: 50 });
    expect(overBar(row('fast', Array(40).fill(2)))).toEqual([]);
    expect(overBar(row('slowTail', [...Array(99).fill(2), 30]))).toEqual(['max 30 > 25 ms']);
    expect(overBar(row('slow', Array(40).fill(60)))).toEqual([
      'p95 60 > 10 ms',
      'max 60 > 25 ms',
      '40 over 50 ms',
    ]);
    expect(overBar(row('never', []))).toEqual([]);
  });

  it('tells an option that is slow from a decision that is slow with the option off too', () => {
    expect(overBarByOption(row('own', Array(40).fill(60)))).toBe(true);
    const shared = row('shared', [...Array(99).fill(2), 30]);
    shared.applied.added = summarize([...Array(99).fill(0.5), 1]);
    expect(overBar(shared)).toEqual(['max 30 > 25 ms']);
    expect(overBarByOption(shared)).toBe(false);
  });

  it('compares decisions without their own clock readings', () => {
    const a = JSON.stringify(
      { action: 'call', amount: 4, latencyMs: 1.2, g: { elapsedMs: 3 } },
      untimed
    );
    const b = JSON.stringify(
      { action: 'call', amount: 4, latencyMs: 9.9, g: { elapsedMs: 1 } },
      untimed
    );
    expect(a).toBe(b);
    expect(a).toBe('{"action":"call","amount":4,"g":{}}');
  });

  it('reads only the games Horses play from a state set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cost-states-'));
    writeFileSync(join(dir, 'states-plo5_cash_hu.ndjson'), '{"a":1}\n{"a":2}\n');
    writeFileSync(join(dir, 'states-plo6_cash.ndjson'), '{"a":3}\n');
    writeFileSync(join(dir, 'states-bombsrc_plo4.ndjson'), '{"a":4}\n');
    const st = readCostStates(dir);
    expect(st.map((s: { group: string; idx: number }) => `${s.group}:${s.idx}`)).toEqual([
      'plo5_cash_hu:0',
      'plo5_cash_hu:1',
    ]);
    expect(COST_GROUPS).not.toContain('plo6_cash');
  });

  it('writes the over-the-bar list first, then the off and live-on tables, the unmeasured, and how to re-run', () => {
    const text = formatCostReport(
      {
        states: 100,
        memory: 'some',
        node: 'v24',
        cpus: 8,
        cpuModel: 'M',
        loadStart: [1, 1, 1],
        optionsAsOf: 'x',
        startedUtc: 'y',
        dist: '/d',
      },
      { loadEnd: [2, 2, 2] },
      [
        row('slowOption', Array(40).fill(60)),
        row('liveRule', Array(40).fill(2), { liveOn: true, releaseDefault: 'on' }),
        { name: 'heldRule', offOnly: 'hold', skipped: 'x' },
      ]
    );
    const at = (s: string) => text.indexOf(s);
    expect(at('## Over The Bar Because Of The Option (1)')).toBeGreaterThan(0);
    expect(text).toContain(
      '| slowOption | off | 40 | 60 | 60 | 60 | 59 | 59 | 59 | 1 | p95 60 > 10 ms; max 60 > 25 ms; 40 over 50 ms |'
    );
    // its added time has a median of 59 ms: the option's own cost, so nothing is listed as the decision's alone
    expect(at('## Over The Bar On The Decision Alone (0)')).toBeGreaterThan(0);
    expect(at('## Not Live-On')).toBeGreaterThan(at('## Over The Bar On The Decision Alone'));
    expect(at('## Live-On (baseline) (1)')).toBeGreaterThan(at('## Not Live-On'));
    expect(text).toContain('- heldRule: off-only (hold)');
    expect(text).toContain('compiled build (tsc)');
    expect(at('## How To Re-Run')).toBeGreaterThan(at('## Not Measured'));
  });
});
