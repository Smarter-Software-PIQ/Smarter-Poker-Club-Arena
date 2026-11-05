/**
 * Horse release verification kit (scripts/horse-measure/horse-release-verify.py):
 * every template renders to read-only SQL with literal bounds, refuses bad
 * input, and the V79 combiner computes the hand-clustered mean / CI exactly.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const KIT = resolve(ROOT, 'scripts/horse-measure/horse-release-verify.py');
const run = (...args: string[]) => {
  const r = spawnSync('python3', [KIT, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const WRITE = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy)\b/i;
const body = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.split('--')[0])
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");

describe('horse release verification kit', () => {
  it('self-check passes: every template is read-only', () => {
    const r = run('check');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('ok');
  });

  it.each(['ladder', 'seat-jams', 'v78', 'v79', 'four-bet-fold', 'reshove', 'omaha-calls'])(
    '%s renders one read-only statement with literal window bounds',
    (mode) => {
      const r = run('sql', mode, '2026-11-03T00:00:00Z', '2026-11-03T04:00:00Z');
      expect(r.status, r.err).toBe(0);
      expect(r.out).not.toMatch(/:START|:END/);
      expect(r.out).toContain("'2026-11-03T00:00:00Z'::timestamptz");
      expect(r.out).toContain("'2026-11-03T04:00:00Z'::timestamptz");
      expect(WRITE.test(body(r.out))).toBe(false);
      const statements = body(r.out)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^(with|select)\b/i);
    }
  );

  it('activation renders with the liveness control and every upgrade receipt', () => {
    const r = run('sql', 'activation', '2026-11-03');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain("'2026-11-03'::date");
    for (const f of [
      'decide_nlh',
      'v74_nlh_open_size',
      'v76_retired_four_bet_bluff',
      'v77_seat_jam',
      'v78_no_committing_bluff_raise',
      'v79_top_pair_weak_kicker',
      'v80_top_pair_strong_kicker',
      'v81_omaha_big_bet_call_fold',
      'plan_fingerprint_recorded',
      'plan_fingerprint_aborted_stack_exposure_shift',
      'opponent_exploit_opportunity_scoped_observed',
      'opponent_memory_donor_stale',
      'v62_river_bettor_polarity',
      'hybrid_v1_cash_grinder_decided',
      'hybrid_v1_tournament_tricky_decided',
      'cash_nlh_three_bet_size',
    ])
      expect(r.out).toContain(`'${f}'`);
  });

  it('refuses malformed bounds and unknown modes', () => {
    expect(run('sql', 'v79', '2026-11-03', 'not-a-time').status).not.toBe(0);
    expect(run('sql', 'activation', '2026-11-03T00:00:00Z').status).not.toBe(0);
    expect(run('sql', 'nope', '2026-11-03T00:00:00Z', '2026-11-03T01:00:00Z').status).not.toBe(0);
  });

  it('slices refuse a non-positive step, a naive timestamp and an empty window', () => {
    expect(run('slices', '2026-11-03T00:00:00Z', '2026-11-03T10:00:00Z', '0').status).not.toBe(0);
    expect(run('slices', '2026-11-03T00:00:00Z', '2026-11-03T10:00:00Z', '-1').status).not.toBe(0);
    expect(run('slices', '2026-11-03T00:00:00', '2026-11-03T10:00:00Z', '4').status).not.toBe(0);
    expect(run('slices', '2026-11-03T10:00:00Z', '2026-11-03T10:00:00Z', '4').status).not.toBe(0);
    expect(run('sql', 'v79', '2026-11-03T00:00:00', '2026-11-03T04:00:00Z').status).not.toBe(0);
  });

  it('the read-only checker refuses statements that could write or hide text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-check-'));
    try {
      const bad = {
        two: 'select 1; select 2',
        into: 'select 1 into t',
        sideEffect: 'select pg_terminate_backend(1)',
        advisory: 'select pg_advisory_lock(1)',
        escapeString: "select E'x' as a",
        dollar: 'select $$x$$',
        unterminated: "select 'open",
        blockComment: 'select 1 /* hide */ ; delete from t',
        setOnly: 'set statement_timeout = 0',
      };
      for (const [name, sql] of Object.entries(bad)) {
        const f = join(dir, `${name}.sql`);
        writeFileSync(f, sql + '\n');
        expect(run('check-file', f).status, name).not.toBe(0);
      }
      const good = join(dir, 'good.sql');
      writeFileSync(good, "with a as (select 'it''s; delete' as x) select * from a\n");
      expect(run('check-file', good).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('combine-v79 gives no interval or verdict from a single hand and refuses malformed lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v79-one-'));
    try {
      const grid = new Array(22).fill(0).join(',');
      writeFileSync(join(dir, 'one.txt'), `A|weak_2_9|2|1|-40|1600|-80|4|0|0|${grid}\n`);
      const r = run('combine-v79', join(dir, 'one.txt'));
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('insufficient');
      expect(r.out).not.toContain('below 0');
      writeFileSync(join(dir, 'bad.txt'), 'A|weak_2_9|2|1\n');
      expect(run('combine-v79', join(dir, 'bad.txt')).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('slices a window into bounded calls', () => {
    const r = run('slices', '2026-11-03T00:00:00Z', '2026-11-03T10:00:00Z', '4');
    expect(r.out.trim().split('\n')).toEqual([
      '2026-11-03T00:00:00Z 2026-11-03T04:00:00Z',
      '2026-11-03T04:00:00Z 2026-11-03T08:00:00Z',
      '2026-11-03T08:00:00Z 2026-11-03T10:00:00Z',
    ]);
  });

  it('combine-v79 sums slices and computes the hand-clustered mean and CI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v79-combine-'));
    try {
      const grid = new Array(22).fill(0).join(',');
      // Two slices of one cell: hands with sums -10 (n 1), -30 (n 2), -20 (n 1).
      // Totals: n 4, hands 3, S -60, S2 100+900+400 = 1400, SN -10-60-20 = -90, N2 1+4+1 = 6.
      writeFileSync(join(dir, 'a.txt'), `A|weak_2_9|3|2|-40|1000|-70|5|0|0|${grid}\n`);
      writeFileSync(join(dir, 'b.txt'), `A|weak_2_9|1|1|-20|400|-20|1|0|0|${grid}\n`);
      const r = run('combine-v79', join(dir, 'a.txt'), join(dir, 'b.txt'));
      expect(r.status, r.err).toBe(0);
      const line = r.out.split('\n').find((l) => l.startsWith('A '))!;
      // mean = -60 / 4 = -15; ss = 1400 - 2(-15)(-90) + 225*6 = 50; se = sqrt(50*3/2)/4
      const se = Math.sqrt((50 * 3) / 2) / 4;
      expect(line).toContain('-15.00');
      expect(line).toContain((-15 - 1.96 * se).toFixed(2));
      expect(line).toContain((-15 + 1.96 * se).toFixed(2));
      expect(line).toContain('below 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const oneReadOnlyStatement = (sql: string) => {
  expect(WRITE.test(body(sql))).toBe(false);
  const statements = body(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatch(/^(with|select)\b/i);
};

describe('Phase 5 daily scorecard (read-only)', () => {
  it('the core statement covers one UTC day, every decide_* control and every receipt of activation.sql', () => {
    const r = run('sql', 'scorecard-core', '2026-11-04');
    expect(r.status, r.err).toBe(0);
    expect(r.out).not.toMatch(/:(START|END|DAY|RECEIPTS)\b/);
    expect(r.out).toContain("'2026-11-04'::date");
    expect(r.out).toContain("'2026-11-04T00:00:00Z'::timestamptz");
    expect(r.out).toContain("'2026-11-05T00:00:00Z'::timestamptz");
    expect(r.out).toContain("left(t.feature, 7) = 'decide_'");
    expect(r.out).toContain('h.has_human');
    const activation = run('sql', 'activation', '2026-11-04').out;
    const receipts = [...activation.matchAll(/\('([a-z0-9_]+)', '/g)].map((m) => m[1]);
    expect(receipts.length).toBeGreaterThan(25);
    for (const f of receipts) expect(r.out).toContain(`('${f}', '`);
    oneReadOnlyStatement(r.out);
  });

  it('the day plan is one core statement plus bounded V79/V80, reshove and V81 slices, each read-only', () => {
    const ids = run('scorecard', 'ids', '2026-11-04');
    expect(ids.status, ids.err).toBe(0);
    const lines = ids.out.trim().split('\n');
    expect(lines[0]).toBe('core 2026-11-04T00:00:00Z 2026-11-05T00:00:00Z');
    expect(lines.filter((l) => l.startsWith('v79-'))).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith('reshove-'))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith('omaha-'))).toHaveLength(6);
    const plan = JSON.parse(run('scorecard', 'plan', '2026-11-04').out) as Array<{
      id: string;
      sql: string;
    }>;
    expect(plan.map((p) => p.id)).toEqual(lines.map((l) => l.split(' ')[0]));
    for (const p of plan) oneReadOnlyStatement(p.sql);
    expect(run('scorecard', 'sql', '2026-11-04', 'v79-02').out).toContain(
      "'2026-11-04T12:00:00Z'::timestamptz"
    );
    expect(run('scorecard', 'sql', '2026-11-04', 'nope').status).not.toBe(0);
    expect(run('scorecard', 'ids', '2026-11-04', '--v79-hours', '12').out).toContain('v79-01');
    expect(run('scorecard', 'ids', '2026-11-04', '--bogus-hours', '1').status).not.toBe(0);
    expect(run('scorecard', 'ids', '2026-02-30').status).not.toBe(0);
    expect(run('sql', 'scorecard-core', '2026-11-04T00:00:00Z').status).not.toBe(0);
  });

  it('reshove slices carry additive sums so a day combines exactly', () => {
    const r = run('sql', 'reshove', '2026-11-04T00:00:00Z', '2026-11-04T12:00:00Z');
    for (const c of ['n_ev', 'sum_ev_bb', 'sum_sq_ev_bb', 'sum_net_bb']) expect(r.out).toContain(c);
  });

  it('assembles execute_sql outputs into one JSON and markdown report, with coverage, CIs and verdicts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-'));
    try {
      const wrap = (rows: unknown) =>
        JSON.stringify({
          result: `Below is the result of the SQL query.\n\n<untrusted-data-x1>\n${JSON.stringify(rows)}\n</untrusted-data-x1>\n\nUse this data.`,
        });
      const core = {
        section: 'core',
        day: '2026-11-04',
        controls: { decide_nlh: 1000, decide_omaha: 2000 },
        activation: [
          { feature: 'decide_nlh', upgrade: 'CONTROL: telemetry alive', fires: 1000 },
          { feature: 'v79_top_pair_weak_kicker', upgrade: 'V79', fires: 7 },
          { feature: 'v80_top_pair_strong_kicker', upgrade: 'V80', fires: 0 },
          { feature: 'v62_river_bettor_polarity', upgrade: 'V62 (opt-in: expected 0)', fires: 0 },
        ],
        cells: [
          {
            variant: 'nlh',
            format: 'cash',
            hands: 500,
            horse_seats: 3000,
            human_seats: 3,
            four_bet_hands: 100,
            four_bet_then_fold_hands: 10,
            human_hands: 3,
            horse_net_bb: 30,
            horse_net_bb_sq: 500,
            human_net_bb: -30,
            human_net_bb_sq: 500,
          },
        ],
      };
      writeFileSync(join(dir, 'core.json'), wrap([{ scorecard: core }]));
      const grid = new Array(22).fill(0).join(',');
      writeFileSync(
        join(dir, 'v79-00.json'),
        JSON.stringify([{ '?column?': `A|weak_2_9|3|2|-40|1000|-70|5|0|0|${grid}` }])
      );
      writeFileSync(
        join(dir, 'v79-01.json'),
        wrap([{ '?column?': `A|weak_2_9|1|1|-20|400|-20|1|0|0|${grid}` }])
      );
      writeFileSync(
        join(dir, 'reshove-00.json'),
        JSON.stringify([
          {
            opener_pos: 'UTG',
            tsize: 'd7+',
            depth: '15-20',
            n: 4,
            n_ev: 4,
            sum_ev_bb: 8,
            sum_sq_ev_bb: 40,
            sum_net_bb: 4,
          },
        ])
      );
      writeFileSync(join(dir, 'omaha-00.json'), JSON.stringify([{ rows: [] }]));
      const cells = join(dir, 'cells.json');
      writeFileSync(
        cells,
        JSON.stringify([
          {
            k: 'two_pair|pf>=0.9|all',
            n: 40,
            g: 38,
            m: -41.2,
            lo: -55.1,
            hi: -27.3,
            verdict: 'BELOW',
          },
        ])
      );
      const r = run('scorecard', 'assemble', '2026-11-04', dir, '--omaha-cells', cells);
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('PARTIAL');
      const rep = JSON.parse(readFileSync(join(dir, 'scorecard-2026-11-04.json'), 'utf8'));
      expect(rep.liveness).toBe('alive');
      expect(rep.coverage.complete).toBe(false);
      expect(rep.coverage.present).toEqual(['core', 'v79-00', 'v79-01', 'reshove-00', 'omaha-00']);
      expect(rep.coverage.missing).toContain('v79-02');
      const status = Object.fromEntries(
        rep.activation.map((a: { feature: string; status: string }) => [a.feature, a.status])
      );
      expect(status).toMatchObject({
        v79_top_pair_weak_kicker: 'firing',
        v80_top_pair_strong_kicker: 'SILENT',
        v62_river_bettor_polarity: 'expected 0',
      });
      const c = rep.cells[0];
      expect(c.four_bet_then_fold_rate).toBe(0.1);
      // Wilson 95% interval for 10 of 100.
      expect(c.four_bet_then_fold_ci[0]).toBeCloseTo(0.0552, 3);
      expect(c.four_bet_then_fold_ci[1]).toBeCloseTo(0.1744, 3);
      // Per-hand horse net: mean 10 bb, ss = 500 - 3*100 = 200, var 100, se sqrt(100/3); x100 for bb/100.
      expect(c.horse_bb_per_100).toBe(1000);
      const se = Math.sqrt(100 / 3) * 100;
      expect(c.horse_bb_per_100_ci[0]).toBeCloseTo(1000 - 1.96 * se, 1);
      const a = rep.v79.find((v: { cell: string }) => v.cell === 'A');
      expect(a).toMatchObject({
        kicker: 'weak_2_9',
        n: 4,
        hands: 3,
        mean_bb: -15,
        verdict: 'below 0',
        rule: 'V79',
      });
      expect(rep.reshove[0]).toMatchObject({ n: 4, mean_ev_bb: 2, mean_net_bb: 1 });
      expect(rep.v81.status).toBe('classified');
      const md = readFileSync(join(dir, 'scorecard-2026-11-04.md'), 'utf8');
      for (const s of [
        '# Horse daily scorecard, 2026-11-04',
        'Liveness: alive',
        'Silent receipts: v80_top_pair_strong_kicker',
        'two_pair|pf>=0.9|all',
        '| nlh | cash | 500 | 100 | 10 |',
      ])
        expect(md).toContain(s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a silent control makes every zero unknown, and missing omaha classification says what to run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-dead-'));
    try {
      const core = {
        controls: {},
        activation: [{ feature: 'v77_seat_jam', upgrade: 'V77', fires: 0 }],
        cells: [],
      };
      writeFileSync(join(dir, 'core.json'), JSON.stringify([{ scorecard: core }]));
      writeFileSync(join(dir, 'omaha-00.json'), JSON.stringify([{ rows: [] }]));
      writeFileSync(join(dir, 'v79-00.json'), 'not json at all');
      const r = run('scorecard', 'assemble', '2026-11-04', dir);
      expect(r.status, r.err).toBe(0);
      const rep = JSON.parse(readFileSync(join(dir, 'scorecard-2026-11-04.json'), 'utf8'));
      expect(rep.liveness).toMatch(/^DEAD/);
      expect(rep.activation[0].status).toBe('unknown (control silent)');
      expect(rep.coverage.unreadable.map((u: { id: string }) => u.id)).toEqual(['v79-00']);
      expect(rep.v81.status).toBe('not classified');
      expect(rep.v81.next).toContain('omaha-call-cells.ts --json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Phase 5 complaint extract (read-only)', () => {
  const HAND = 'd4ec1ccd-bae9-47c7-9abc-b09ae2492667';
  it('renders for a hand id: one statement, horse cards only, every action with its ordinal', () => {
    const r = run('sql', 'complaint-extract', HAND);
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`h.id = '${HAND}'::uuid`);
    expect(r.out).toContain('where p.is_horse');
    expect(r.out).toContain('with ordinality x(e, o)');
    expect(r.out).not.toMatch(/:(PICK|NEAR|ORDER)\b/);
    oneReadOnlyStatement(r.out);
  });

  it('renders for a table and a moment, and refuses anything that is not a uuid or an offset timestamp', () => {
    const r = run('sql', 'complaint-extract', HAND, '2026-11-02T08:55:00Z');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`h.table_id = '${HAND}'::uuid`);
    expect(r.out).toContain("'2026-11-02T08:55:00Z'::timestamptz");
    oneReadOnlyStatement(r.out);
    expect(run('sql', 'complaint-extract', "x'; delete from t; --").status).not.toBe(0);
    expect(run('sql', 'complaint-extract', HAND.toUpperCase()).status).not.toBe(0);
    expect(run('sql', 'complaint-extract', HAND, '2026-11-02T08:55:00').status).not.toBe(0);
    expect(run('sql', 'complaint-extract').status).not.toBe(0);
  });
});
