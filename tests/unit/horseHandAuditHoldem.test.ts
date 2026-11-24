import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import {
  classOf,
  comboIndex,
  evalCards,
  exactEquity,
  handClass,
  multiwayEquity,
  parseCard,
  preflopMatrix,
} from '../../scripts/ops/horse-hand-audit-holdem-eval.mjs';
import {
  EXIT_FAILED,
  EXIT_TOO_FEW,
  EXIT_USAGE,
  audit,
  bluffShareOf,
  buildHandsSql,
  buildTournamentSql,
  gradeNode,
  makeModel,
  measureBluffShares,
  measureFrequencies,
  parseHand,
  resolvePlan,
  seatNets,
} from '../../scripts/ops/horse-hand-audit-holdem-lib.mjs';
import {
  compareWindows,
  decisionsCsv,
  handsCsv,
} from '../../scripts/ops/horse-hand-audit-holdem-report.mjs';
import {
  READ_ONLY_SESSION_PREFIX,
  parseArgs,
  runCli,
} from '../../scripts/ops/horse-hand-audit-holdem.mjs';

const P = (s: string) => s.split(' ').map(parseCard);
const MATRIX = preflopMatrix({ samples: 40 });

/** A synthetic heads-up cash hand in the SQL output shape (made-up ids). Seat 1 = button/SB Horse, seat 2 = BB person. */
function mkHand({
  id = 'h1',
  riverAction = 'call',
  mucked2 = 'false',
}: { id?: string; riverAction?: string; mucked2?: string } = {}) {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const seats = (s1: number, b1: number, t1: number, s2: number, b2: number, t2: number) => [
    [1, s1, b1, t1, 0, 0, 0],
    [2, s2, b2, t2, 0, 0, 0],
  ];
  const acts: unknown[] = [
    ['1', 'preflop', 'sb', 1, 'forced', null, null, null, null, null],
    ['2', 'preflop', 'bb', 2, 'forced', null, null, null, null, null],
    ['1', 'preflop', 'raise', 6, 'horse_policy', 3, 1, 2, seats(199, 1, 1, 198, 2, 2), 'false'],
    ['2', 'preflop', 'call', 4, 'player', 8, 4, 6, seats(194, 6, 6, 198, 2, 2), 'false'],
    ['2', 'flop', 'check', 0, 'player', 12, 0, 0, seats(194, 0, 6, 194, 0, 6), 'false'],
    ['1', 'flop', 'bet', 6, 'horse_policy', 12, 0, 0, seats(194, 0, 6, 194, 0, 6), 'false'],
    ['2', 'flop', 'call', 6, 'player', 18, 6, 6, seats(188, 6, 12, 194, 0, 6), 'false'],
    ['2', 'turn', 'check', 0, 'player', 24, 0, 0, seats(188, 0, 12, 188, 0, 12), 'false'],
    ['1', 'turn', 'check', 0, 'horse_policy', 24, 0, 0, seats(188, 0, 12, 188, 0, 12), 'false'],
    ['2', 'river', 'bet', 16, 'player', 24, 0, 0, seats(188, 0, 12, 188, 0, 12), 'false'],
    [
      '1',
      'river',
      riverAction,
      riverAction === 'call' ? 16 : 0,
      'horse_policy',
      40,
      16,
      16,
      seats(188, 0, 12, 172, 16, 28),
      'false',
    ],
  ];
  const sd = riverAction === 'call';
  const shown: Record<string, unknown> = {};
  if (sd) {
    shown[A] = [
      { rank: 'K', suit: 'clubs' },
      { rank: 'Q', suit: 'diamonds' },
    ];
    if (mucked2 === 'false')
      shown[B] = [
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
      ];
  }
  return {
    hand: {
      id,
      ts: '2026-11-23T12:00:00Z',
      tid: null,
      bb: 2,
      sb: 1,
      btn: 1,
      board: ['Kh', '7d', '2c', '9s', '3h'],
      build: 'testbuild000',
      rake: 0,
      pl: [
        [1, A, 'HorseOne', 200, true],
        [2, B, 'PersonTwo', 200, false],
      ],
      sd: sd
        ? [
            [1, A, 'false'],
            [2, B, mucked2],
          ]
        : [],
      shown: sd ? shown : null,
      win: sd ? [[B, 56]] : [[B, 24]],
      pots: [[sd ? 56 : 24, [A, B]]],
      stage: null,
      acts: sd ? acts : [...acts, ['2', 'river', 'return', 16, null, null, null, null, null, null]],
    },
  };
}

describe('evaluator', () => {
  it('ranks categories and kickers', () => {
    const v = (s: string) => evalCards(P(s));
    expect(v('As Ks Qs Js Ts 2c 3d') >> 20).toBe(8);
    expect(v('Ah 2c 3d 4s 5h 9c Kd') >> 20).toBe(4);
    expect(v('Ah Ad Ac Kd Kh 2c 3c') >> 20).toBe(6);
    expect(v('2h 2d 3c 3d 4h 4s Ac') >> 20).toBe(2);
    expect(v('Ah Ad Kc Kd Qh Qs 2c')).toBeGreaterThan(v('Ah Ad Kc Kd Jh Js 3c'));
    expect(v('Ah Kh 2h 3h 9h Kd Kc') >> 20).toBe(5);
    expect(v('9c 8d 7h 6s 5c 4c 2d')).toBeGreaterThan(v('8c 7d 6h 5s 4c 2c 2d'));
  });
  it('enumerates exact equity (two outs on the flop)', () => {
    const [qq, tt] = exactEquity([P('Qs Qd'), P('Th Tc')], P('Ts 9s 9h'));
    expect(qq).toBeCloseTo(0.0889, 3);
    expect(tt).toBeCloseTo(0.9111, 3);
  });
  it('combines heads-up equities into a multiway share', () => {
    expect(multiwayEquity([0.6])).toBeCloseTo(0.6, 9);
    expect(multiwayEquity([0.5, 0.5])).toBeCloseTo(1 / 3, 9);
    expect(multiwayEquity([1, 1])).toBe(1);
    expect(multiwayEquity([0, 0.7])).toBe(0);
  });
  it('classifies made hands and preflop classes', () => {
    expect(handClass(P('Ah Kd'), P('Ac 7d 2s'))).toBe('top pair good kicker');
    expect(handClass(P('8h 8d'), P('Ac 7d 2s'))).toBe('second pair');
    expect(handClass(P('5h 4d'), P('Ac 7d 2s Kh Qd'))).toBe('no pair');
    const [a, b] = P('Ah Kh');
    expect(classOf(a, b)).not.toBe(classOf(P('Ah Kd')[0], P('Ah Kd')[1]));
    expect(comboIndex(a, b)).toBe(comboIndex(b, a));
  });
});

describe('shown-cards rule in the SQL', () => {
  const sql = buildHandsSql({
    since: Date.parse('2026-11-24T00:00:00Z'),
    until: Date.parse('2026-11-24T06:00:00Z'),
    mode: 'all',
    peopleOnly: true,
  });
  it('reads hole cards only through unmucked showdown seats', () => {
    const uses = sql.match(/hole_cards[^,\n]*/g) ?? [];
    // the CTE carries the column; the only reads are keyed by a showdown seat's user_id
    expect(uses.filter((u) => !/^hole_cards$/.test(u.trim()))).toEqual([
      "hole_cards -> (s->>'user_id'))",
      "hole_cards ? (s->>'user_id'))",
    ]);
    expect(sql).toContain("WHERE s->>'mucked' = 'false' AND hh.hole_cards ? (s->>'user_id')");
    expect(sql).not.toMatch(/jsonb_each\(\s*\w*\.?hole_cards/);
    expect(sql).not.toMatch(/'cards'|->'cards'|->>'cards'/);
    expect(sql).not.toMatch(/->'hand'|summary/);
  });
  it('is one bounded, read-only SELECT', () => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
    expect(sql).toMatch(
      /created_at >= '2026-11-24T00:00:00.000Z'::timestamptz AND h.created_at < '2026-11-24T06:00:00.000Z'/
    );
    expect(() => assertReadOnlySql(buildTournamentSql({ since: 0, until: 1 }))).not.toThrow();
    expect(READ_ONLY_SESSION_PREFIX).toBe(
      "SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '60s'; "
    );
  });
  it('a mucked seat contributes no cards even if the row carried them', () => {
    const row = mkHand({ mucked2: 'true' });
    const H = parseHand(row)!;
    expect(H.shown.size).toBe(1);
    expect(H.sd.get(2)!.mucked).toBe(true);
  });
});

describe('replay, results and grading', () => {
  const rows = [mkHand(), mkHand({ id: 'h2', riverAction: 'fold' })];
  const hands = rows.map((r) => parseHand(r)!);
  const model = makeModel({
    matrix: MATRIX,
    freqs: measureFrequencies(hands),
    bluffs: measureBluffShares(hands),
  });
  it('replays raise-to amounts and nets', () => {
    const d = hands[0].decisions;
    expect(d[0]).toMatchObject({ kind: 'raise', inc: 5, to: 6, node: 'unopened' });
    expect(d[1]).toMatchObject({ kind: 'call', node: 'vsOpen' });
    expect(d.map((x) => x.kind)).toEqual([
      'raise',
      'call',
      'check',
      'bet',
      'call',
      'check',
      'check',
      'bet',
      'call',
    ]);
    expect([...seatNets(hands[0]).values()]).toEqual([-28, 28]);
    expect([...seatNets(hands[1]).values()]).toEqual([-12, 12]);
  });
  it('grades the shown Horse exactly and the unshown one by node', () => {
    const res = audit(rows, { model });
    const ex = res.exact.filter((r) => r.hand === 'h1');
    expect(ex.map((r) => r.d.street)).toEqual(['preflop', 'flop', 'turn', 'river']);
    const turn = ex.find((r) => r.d.street === 'turn')!;
    expect(turn.verdict).toBe('MISTAKE');
    expect(turn.type).toBe('missed value bet');
    expect(turn.cost).toBeGreaterThan(0.5);
    expect(turn.hindEq).toBeLessThan(0.1);
    expect(res.exact.some((r) => r.hand === 'h2')).toBe(false);
    expect(res.rangeRows.filter((r) => r.hand === 'h2').length).toBe(4);
    const csv = decisionsCsv(res).trim().split('\n');
    expect(csv.length).toBe(1 + res.exact.length + res.rangeRows.length);
    expect(handsCsv(res)).toContain('h1,');
  });
});

describe('node grading keeps theoretical and actual cost apart', () => {
  const node = (fold: number) => ({
    key: 'k',
    n0: { fc: 'cash', street: 'river', node: 'vsBet', line: 'barrel', opp: 'person' },
    n: 100,
    fold,
    call: 100 - fold,
    raise: 0,
    check: 0,
    bet: 0,
    worked: 0,
    potBb: 100 * 30,
    be: 100 * 0.333,
    toCallBb: 100 * 10,
    betPotBb: 0,
    betS: 0,
    pfCost: 0,
    pfN: 0,
  });
  const B = (bluffs: number, n: number) =>
    new Map([
      ['C|person|river|barrel|1', { n, k: bluffs }],
      ['C|person|river|barrel', { n, k: bluffs }],
      ['C|person|river', { n, k: bluffs }],
      ['C|river', { n, k: bluffs }],
    ]);
  it('a fold above break-even against bettors who rarely bluff is not charged as a fold', () => {
    const v = gradeNode(node(80), { B: B(1, 200) } as never);
    expect(v.theory).toBeGreaterThan(0);
    expect(v.evbc).toBeLessThan(0);
    expect(v.leakAction).not.toBe('fold');
    expect(v.verdict).not.toBe('over-fold');
  });
  it('the same fold rate against bettors who bluff half the time is a real leak', () => {
    const v = gradeNode(node(80), { B: B(100, 200) } as never);
    expect(v.verdict).toBe('over-fold');
    expect(v.perDecisionCost).toBeGreaterThan(0);
  });
  it('calls below the price against a value-heavy line are charged', () => {
    const v = gradeNode(node(10), { B: B(0, 400) } as never, new Map([['cash|river', 0.5]]));
    expect(v.verdict).toBe('calls below the price');
    expect(v.leakAction).toBe('call');
  });
  it('measured bluff share shrinks toward equilibrium', () => {
    expect(
      bluffShareOf(null, { tour: false, who: 'person', street: 'river', line: 'barrel', s: 0.5 })
    ).toBeCloseTo(0.25, 5);
    expect(
      bluffShareOf(B(0, 1000), {
        tour: false,
        who: 'person',
        street: 'river',
        line: 'barrel',
        s: 0.5,
      })
    ).toBeLessThan(0.01);
  });
  it('flags a leak node that got worse', () => {
    const now = new Map([['k', { ...node(80), verdict: 'over-fold' }]]);
    const before = new Map([['k', { ...node(50), verdict: 'fine' }]]);
    expect(compareWindows(now as never, before as never).length).toBe(1);
    expect(compareWindows(before as never, now as never).length).toBe(0);
  });
});

describe('CLI', () => {
  const NOW = Date.parse('2026-11-23T18:00:00Z');
  it('parses flags and plans windows', () => {
    const o = parseArgs(['--mode', 'cash', '--all', '--since', '2026-11-23T00:00:00Z', '--json']);
    expect(o).toMatchObject({ mode: 'cash', peopleOnly: false, json: true });
    const plan = resolvePlan({ ...o, until: NOW }, NOW);
    expect(plan.compare.until).toBe(plan.current.since);
    expect(() => parseArgs(['--mode', 'omaha'])).toThrow();
  });
  it('exit codes: usage 64, failed read 70, too few hands 2', () => {
    const quiet = { stdout: () => {}, stderr: () => {}, now: () => NOW, matrix: MATRIX };
    expect(runCli(['--bogus'], quiet)).toBe(EXIT_USAGE);
    expect(
      runCli([], {
        ...quiet,
        query: () => {
          throw new Error('down');
        },
      })
    ).toBe(EXIT_FAILED);
    let out = '';
    const code = runCli(['--mode', 'cash', '--json'], {
      ...quiet,
      stdout: (s: string) => (out = s),
      query: (sql: string) =>
        sql.includes('tournament_players')
          ? []
          : [mkHand(), mkHand({ id: 'h2', riverAction: 'fold' })],
    });
    expect(code).toBe(EXIT_TOO_FEW);
    expect(JSON.parse(out).coverage.hands.cash).toBe(2);
  });
});
