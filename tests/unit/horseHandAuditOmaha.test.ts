import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import {
  category,
  eval5,
  holdingPool,
  isNutsExact,
  omaha,
  parseCard,
  rangeEquity,
  rng,
} from '../../scripts/ops/horse-hand-audit-omaha-lib/omaha.mjs';
import { auditSql } from '../../scripts/ops/horse-hand-audit-omaha-lib/sql.mjs';
import { parseHand, shownCards } from '../../scripts/ops/horse-hand-audit-omaha-lib/hand.mjs';
import { nodeFoldCost } from '../../scripts/ops/horse-hand-audit-omaha-lib/rangetier.mjs';
import { mistakeClass } from '../../scripts/ops/horse-hand-audit-omaha-lib/grade.mjs';
import { aggregate } from '../../scripts/ops/horse-hand-audit-omaha-lib/aggregate.mjs';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_TOO_FEW,
  EXIT_USAGE,
  EXIT_WORSE,
  buildAudit,
  exitCodeFor,
  runCli,
} from '../../scripts/ops/horse-hand-audit-omaha.mjs';

const FIXTURE = resolve(__dirname, '../fixtures/horse-hand-audit-omaha/hands.json');
const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const tables = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../scripts/ops/horse-hand-audit-omaha-lib/range-tables.json'),
    'utf8'
  )
);
const C = (s: string) =>
  s
    .split(' ')
    .map((x) =>
      parseCard(
        x.slice(0, -1) + { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[x.slice(-1) as 's']
      )
    );
const FAST = { M: 400, N: 600, seed: 7 };

describe('Omaha evaluator', () => {
  it('ranks the categories and the wheel', () => {
    expect(
      category(eval5(...(C('As Ks Qs Js Ts') as [number, number, number, number, number])))
    ).toBe(8);
    expect(
      category(eval5(...(C('5s 4d 3c 2h Ah') as [number, number, number, number, number])))
    ).toBe(4);
    expect(
      eval5(...(C('6s 5d 4c 3h 2h') as [number, number, number, number, number]))
    ).toBeGreaterThan(eval5(...(C('5s 4d 3c 2h Ah') as [number, number, number, number, number])));
    expect(
      eval5(...(C('As Ad Kc Kh 2d') as [number, number, number, number, number]))
    ).toBeGreaterThan(eval5(...(C('As Ad Qc Qh Kd') as [number, number, number, number, number])));
  });
  it('uses exactly two hole cards and three board cards', () => {
    expect(category(omaha(C('Ah Kd 2s 3c'), C('9s 8s 7s 4s Jd')))).not.toBe(5);
    expect(category(omaha(C('Ah Ks 2s 3c'), C('9s 8s 7d 4s Jd')))).toBe(5);
    expect(category(omaha(C('Ah Kd 2c 3c'), C('9s 9h 9d 9c Jd')))).toBeLessThan(7);
  });
  it('knows the nuts and gives seeded, sane equity', () => {
    expect(isNutsExact(C('Ah Kh 2c 3d'), C('Qh Jh Th 2s 5d'))).toBe(true);
    expect(isNutsExact(C('Ac Kd 2c 3d'), C('Qh Jh Th 2s 5d'))).toBe(false);
    const hero = C('As Ah Kd Kc');
    const run = () => {
      const r = rng(1);
      const pool = holdingPool(hero, 4, 300, r);
      return rangeEquity(hero, [], [{ weights: pool.map(() => 1) }], pool, 2000, r)!.eq;
    };
    const e = run();
    expect(e).toBeGreaterThan(0.6);
    expect(e).toBeLessThan(0.73);
    expect(run()).toBe(e);
  });
});

describe('shown cards only', () => {
  it('selects hole cards only through the showdown list, skipping mucked entries', () => {
    const sql = auditSql({ from: '2026-11-23T00:00:00Z', to: '2026-11-23T06:00:00Z' });
    expect(() => assertReadOnlySql(sql)).not.toThrow();
    const hc = sql.slice(
      sql.indexOf("(select jsonb_object_agg(s->>'user_id', h.hole_cards"),
      sql.indexOf('from hand_history h')
    );
    expect(hc).toContain("coalesce((s->>'mucked')::boolean, false) = false");
    expect(hc).toContain('h.showdown');
    // every mention of hole_cards sits inside that showdown-filtered column
    const all = sql.split('hole_cards').length - 1;
    const inside = hc.split('hole_cards').length - 1;
    expect(all).toBe(inside);
    expect(all).toBeGreaterThan(0);
    // winner rows are selected without their hand cards
    expect(sql).not.toMatch(/h\.winners w,/);
    expect(sql).toContain(
      "jsonb_build_object('userId', w->>'userId', 'amount', w->'amount', 'potIndex', w->'potIndex')"
    );
  });
  it('the parser ignores cards of a mucked or unlisted player even if a row carries them', () => {
    const third = rows[2];
    expect(shownCards(third).has('h1')).toBe(false);
    expect(shownCards(third).has('p1')).toBe(true);
    expect(shownCards({ ...rows[0], sd: [] }).size).toBe(0);
  });
});

describe('grading from saved hands', () => {
  const out = buildAudit(rows, { tables, opts: FAST });
  const river = (id: string) =>
    out.decisions.find(
      (d: { hand_id: string; street: string }) => d.hand_id === id && d.street === 'river'
    );
  it('reconciles money and keeps every hand', () => {
    expect(out.summary.hands).toBe(3);
    for (const r of rows) {
      const h = parseHand(r);
      expect(h.players.reduce((s: number, p: { inv: number }) => s + p.inv, 0)).toBeCloseTo(6, 6);
    }
  });
  it('a river call with the nuts is not a mistake', () => {
    const d = river('00000000-0000-4000-8000-000000000001');
    expect(d.tier).toBe('A');
    expect(d.act_taken).toBe('call');
    expect(d.ev_taken_bb).toBeGreaterThan(0);
    expect(d.mtype === 'called too light' || d.mtype === 'paid off (river call)').toBe(false);
  });
  it('a river call with nine high against a pot bet is a HARD mistake with a cost', () => {
    const d = river('00000000-0000-4000-8000-000000000002');
    expect(d.tier).toBe('A');
    expect(d.verdict).toBe('MISTAKE');
    expect(d.mclass).toBe('HARD');
    expect(['called too light', 'paid off (river call)']).toContain(d.mtype);
    expect(d.cost_bb).toBeGreaterThan(0.5);
    expect(d.hind_cost_bb).toBeGreaterThan(0);
  });
  it('a mucked Horse is graded only in the range tier', () => {
    const ds = out.decisions.filter(
      (d: { hand_id: string }) => d.hand_id === '00000000-0000-4000-8000-000000000003'
    );
    expect(ds.length).toBeGreaterThan(0);
    expect(ds.every((d: { tier: string }) => d.tier === 'B')).toBe(true);
  });
  it('model-dependent gaps are OPPORTUNITY, not chips lost', () => {
    expect(mistakeClass('missed bet (fold equity)', 'flop', { eqc: 0.9 })).toBe('OPPORTUNITY');
    expect(mistakeClass('missed value bet', 'river', { eqc: 0.6 }, true)).toBe('OPPORTUNITY');
    expect(mistakeClass('missed value bet', 'river', { eqc: 0.6 }, false)).toBe('HARD');
    expect(mistakeClass('called too light', 'river', { eqc: 0 })).toBe('HARD');
  });
});

describe('range tier fold cost', () => {
  const edges = tables.binEdges;
  it('folding against a pure value range costs nothing', () => {
    const nuts = edges.slice(0, -1).map((_: number, i: number) => (i === 0 ? 1 : 0));
    expect(nodeFoldCost({ bettorHist: nuts, edges, s: 0.5, xc: 0.3 }).over).toBe(0);
  });
  it('folding against a range of air costs chips; a high fold rate alone does not', () => {
    const air = edges
      .slice(0, -1)
      .map((_: number, i: number, a: number[]) => (i === a.length - 1 ? 1 : 0));
    expect(nodeFoldCost({ bettorHist: air, edges, s: 0.5, xc: 0.3 }).over).toBeGreaterThan(0.1);
    const value = edges.slice(0, -1).map((_: number, i: number) => (i < 3 ? 1 / 3 : 0));
    expect(nodeFoldCost({ bettorHist: value, edges, s: 1, xc: 0.2 }).over).toBe(0);
  });
});

describe('exit codes', () => {
  const quiet = { stdout: () => undefined, stderr: () => undefined, opts: FAST };
  const range = ['--since', '2026-11-23T00:00:00Z', '--until', '2026-11-24T00:00:00Z'];
  it('2 when there are too few hands, 0 otherwise', () => {
    expect(runCli(['--from-json', FIXTURE, ...range, '--min-hands', '10'], quiet)).toBe(
      EXIT_TOO_FEW
    );
    expect(runCli(['--from-json', FIXTURE, ...range, '--min-hands', '1', '--json'], quiet)).toBe(
      EXIT_OK
    );
  });
  it('64 for usage errors and 70 for failures', () => {
    expect(runCli(['--bogus'], quiet)).toBe(EXIT_USAGE);
    expect(runCli([...range, '--split-at', '2026-12-01T00:00:00Z'], quiet)).toBe(EXIT_USAGE);
    expect(
      runCli(['--since', '2026-11-01T00:00:00Z', '--until', '2026-11-24T00:00:00Z'], quiet)
    ).toBe(EXIT_USAGE);
    expect(runCli(['--from-json', '/nonexistent/file.json', ...range], quiet)).toBe(EXIT_FAILED);
  });
  it('1 when a HARD leak versus people got worse after the split', () => {
    const mk = (time: string) => ({
      hand_id: 'x',
      time,
      tier: 'A',
      verdict: 'MISTAKE',
      mclass: 'HARD',
      mtype: 'called too light',
      street: 'river',
      opp_person: 'y',
      cost_bb: 10,
      pos: 'IP',
      into: 'hu',
      act_taken: 'call',
    });
    const hands = [
      {
        hand_id: 'a',
        time: '2026-11-23T01:00:00Z',
        n_people: 50,
        perPerson: [],
        day: 'd',
        game: 'plo5',
      },
      {
        hand_id: 'b',
        time: '2026-11-23T20:00:00Z',
        n_people: 50,
        perPerson: [],
        day: 'd',
        game: 'plo5',
      },
    ];
    const decisions = Array.from({ length: 6 }, () => mk('2026-11-23T21:00:00Z'));
    const s = aggregate({ hands, decisions, nodes: [], splitAt: '2026-11-23T12:00:00Z' });
    expect(s.split.worse.length).toBe(1);
    expect(exitCodeFor(s, 1)).toBe(EXIT_WORSE);
    expect(
      exitCodeFor(
        aggregate({ hands, decisions: [], nodes: [], splitAt: '2026-11-23T12:00:00Z' }),
        1
      )
    ).toBe(EXIT_OK);
  });
});
