import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import {
  BY_DIMENSIONS,
  EXIT_FAILED,
  EXIT_USAGE,
  MAX_RANGE_DAYS,
  MAX_TOP_PERSON_SHARE,
  MIN_HANDS_PER_WINDOW,
  MODES,
  Z_THRESHOLD,
  assertSourceComplete,
  buildReport,
  buildResultsSql,
  clusterStats,
  compareWindows,
  formatReportText,
  gateResult,
  parseGames,
  parseInstant,
  resolvePlan,
} from '../../scripts/ops/person-vs-horse-results-lib.mjs';
import {
  READ_ONLY_SESSION_PREFIX,
  parseArgs,
  queryReadOnly,
  runCli,
} from '../../scripts/ops/person-vs-horse-results.mjs';

const DAY = 86_400_000;
const SINCE = Date.parse('2026-11-20T00:00:00Z');
const SPLIT = Date.parse('2026-11-22T03:13:56Z');
const UNTIL = Date.parse('2026-11-23T00:00:00Z');

/** One person-session of `n` hands that each won `bb` (so ss = n * bb^2), `sdn` at showdown. */
function cell(w, pn, sess, n, bb, extra = {}) {
  return {
    w,
    g: 'plo5',
    c: true,
    d: '',
    pn,
    sess,
    p4: `a${pn}b0-full-account-id-must-never-print`,
    n,
    s: n * bb,
    ss: n * bb * bb,
    sdn: n / 4,
    sds: (n / 4) * bb * 2,
    ...extra,
  };
}

/** A window stats object for compareWindows. */
function win(personHands, bbPer100, sePer100, topPersonShare = 0.3) {
  return { personHands, bbPer100, sePer100, topPersonShare };
}

/**
 * Fixture query output: plo5 cash, people at -10 bb/100 before the split and +30 bb/100 after it
 * across enough people and sittings to judge; nlh cash far too small to judge.
 */
function fixtureRows() {
  const cells = [];
  const before = [-0.4, 0.1, -0.2, 0.3, -0.3, -0.1, 0.2, -0.4];
  const after = [0.2, 0.5, 0.1, 0.4, 0.3, 0.2, 0.5, 0.2];
  before.forEach((bb, i) => cells.push(cell(0, (i % 4) + 1, Math.floor(i / 4), 300, bb)));
  after.forEach((bb, i) => cells.push(cell(1, (i % 4) + 1, Math.floor(i / 4), 300, bb)));
  cells.push(cell(0, 2, 0, 40, 1.5, { g: 'nlh' }));
  cells.push(cell(1, 2, 0, 60, -0.5, { g: 'nlh' }));
  return [
    {
      report: {
        read_at: '2026-11-23T00:00:05+00:00',
        cells,
        hands: [
          { w: 0, g: 'plo5', c: true, d: null, h: 2300 },
          { w: 1, g: 'plo5', c: true, d: null, h: 2350 },
          { w: 0, g: 'nlh', c: true, d: null, h: 40 },
          { w: 1, g: 'nlh', c: true, d: null, h: 60 },
        ],
        left_out: { deleted_accounts: 12, unusable: 1, no_horse: 7 },
        source: { table: 'ca_hand_facts', expected: 4920, found: 4920 },
      },
    },
  ];
}

const FIXTURE_ARGS = [
  '--since',
  '2026-11-20T00:00:00Z',
  '--until',
  '2026-11-23T00:00:00Z',
  '--split-at',
  '2026-11-22T03:13:56Z',
  '--mode',
  'cash',
];

function run(args, query = () => fixtureRows()) {
  const out = [];
  const err = [];
  const exitCode = runCli(args, {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    // the fixtures are report rows of the single read: hand them over for the plan's single-read SQL
    readReport: (plan) => query(buildResultsSql(plan)),
    now: () => UNTIL,
  });
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

describe('people vs Horses results', () => {
  describe('statistics', () => {
    // Three sittings: hands (3, 1), (0, 0), (1, 1, 1, 1). N = 8, sum = 8, mean = 1 bb.
    const known = [
      { pn: 1, sess: 0, n: 2, s: 4, ss: 10, sdn: 1, sds: 3 },
      { pn: 1, sess: 1, n: 2, s: 0, ss: 0, sdn: 0, sds: 0 },
      { pn: 2, sess: 0, n: 4, s: 4, ss: 4, sdn: 2, sds: 2 },
    ];

    it('clustered standard error matches the hand-worked answer', () => {
      const st = clusterStats(known);
      expect(st.personHands).toBe(8);
      expect(st.people).toBe(2);
      expect(st.sessions).toBe(3);
      expect(st.topPersonShare).toBe(0.5);
      expect(st.bb).toBe(8);
      expect(st.bbPer100).toBe(100);
      // Per-hand SD: sqrt((14 - 8^2 / 8) / 7).
      expect(st.sdPerHand).toBeCloseTo(Math.sqrt(6 / 7), 12);
      // Residuals s_g - m * n_g = 2, -2, 0. Var(m) = 3/2 * 8 / 64 = 0.1875. SE = 0.4330127 bb.
      expect(st.sePer100).toBeCloseTo(43.30127018922193, 9);
      expect(st.ciLow).toBeCloseTo(100 - 1.96 * 43.30127018922193, 9);
      expect(st.ciHigh).toBeCloseTo(100 + 1.96 * 43.30127018922193, 9);
      expect(st.showdownBb).toBe(5);
      expect(st.nonShowdownBb).toBe(3);
      expect(st.showdownHands).toBe(3);
    });

    it('a sitting split across breakdown rows is still one cluster', () => {
      const split = [
        { pn: 1, sess: 0, n: 1, s: 3, ss: 9, sdn: 1, sds: 3 },
        { pn: 1, sess: 0, n: 1, s: 1, ss: 1, sdn: 0, sds: 0 },
        ...known.slice(1),
      ];
      expect(clusterStats(split)).toEqual(clusterStats(known));
    });

    it('hands that move together inside a sitting widen the error, they are not independent', () => {
      // 4 sittings of 100 hands; inside a sitting every hand has the same result.
      const cells = [1, -1, 1, -1].map((bb, i) => ({
        pn: i,
        sess: 0,
        n: 100,
        s: 100 * bb,
        ss: 100,
        sdn: 0,
        sds: 0,
      }));
      const st = clusterStats(cells);
      const independent = (100 * st.sdPerHand) / Math.sqrt(st.personHands);
      // Clustered: sqrt(4/3 * 4 * 100^2) / 400 = 0.57735 bb = 57.7 bb/100; independent ~5 bb/100.
      expect(st.sePer100).toBeCloseTo(57.73502691896258, 9);
      expect(st.sePer100).toBeGreaterThan(10 * independent);
    });

    it('one sitting or no hands gives no standard error', () => {
      expect(clusterStats([known[0]]).sePer100).toBeNull();
      expect(clusterStats([known[0]]).ciLow).toBeNull();
      const none = clusterStats([]);
      expect(none.personHands).toBe(0);
      expect(none.bbPer100).toBeNull();
      expect(none.topPersonShare).toBeNull();
    });
  });

  describe('verdict rules', () => {
    it('the thresholds are the documented ones', () => {
      expect(MIN_HANDS_PER_WINDOW).toBe(2000);
      expect(MAX_TOP_PERSON_SHARE).toBe(0.6);
      expect(Z_THRESHOLD).toBe(2);
    });

    it('fewer than 2,000 person-hands in either window is too few', () => {
      expect(compareWindows(win(1999, 0, 3), win(5000, 100, 4)).verdict).toBe('too_few');
      expect(compareWindows(win(5000, 0, 3), win(1999, 100, 4)).verdict).toBe('too_few');
      expect(compareWindows(win(2000, 0, 3), win(2000, 100, 4)).verdict).toBe('better');
    });

    it('one person above 60% of either window is too few, whatever the size', () => {
      expect(compareWindows(win(50000, 0, 3, 0.61), win(50000, 100, 4)).verdict).toBe('too_few');
      expect(compareWindows(win(50000, 0, 3), win(50000, 100, 4, 0.61)).verdict).toBe('too_few');
      const r = compareWindows(win(50000, 0, 3), win(50000, 100, 4, 0.61));
      expect(r.reason).toContain('one person played 61% of the hands after');
      // Exactly 60% is allowed.
      expect(compareWindows(win(50000, 0, 3, 0.6), win(50000, 100, 4, 0.6)).verdict).toBe('better');
    });

    it('|z| below 2 is no measurable change; 2 or more is better or worse', () => {
      // SE of the difference = sqrt(3^2 + 4^2) = 5.
      const justUnder = compareWindows(win(3000, 0, 3), win(3000, 9.99, 4));
      expect(justUnder.z).toBeCloseTo(1.998, 9);
      expect(justUnder.verdict).toBe('no_change');
      const better = compareWindows(win(3000, 0, 3), win(3000, 10, 4));
      expect(better.z).toBe(2);
      expect(better.diffPer100).toBe(10);
      expect(better.sePer100).toBe(5);
      expect(better.verdict).toBe('better');
      expect(compareWindows(win(3000, 0, 3), win(3000, -10, 4)).verdict).toBe('worse');
      expect(compareWindows(win(3000, 0, 3), win(3000, -9.99, 4)).verdict).toBe('no_change');
    });

    it('no standard error means no verdict', () => {
      expect(compareWindows(win(3000, 0, null), win(3000, 500, 4)).verdict).toBe('too_few');
      expect(compareWindows(win(3000, 0, 0), win(3000, 500, 0)).verdict).toBe('too_few');
    });
  });

  describe('the query', () => {
    const TIME_BOUND =
      /h\.created_at >= TIMESTAMPTZ '2026-11-20T00:00:00Z' AND h\.created_at < TIMESTAMPTZ '2026-11-23T00:00:00Z'/g;
    const plans = [];
    for (const mode of MODES) {
      for (const by of [null, ...BY_DIMENSIONS]) {
        for (const games of [null, ['plo5'], ['nlh', 'plo4', 'plo5', 'plo6']]) {
          for (const splits of [[], [SPLIT], [SPLIT, SPLIT + 3_600_000]]) {
            plans.push({ sinceMs: SINCE, untilMs: UNTIL, splits, mode, games, by });
          }
        }
      }
    }

    it('every SQL string is one SELECT with a time bound on hand_history', () => {
      expect(plans.length).toBe(162);
      for (const plan of plans) {
        const sql = buildResultsSql(plan);
        expect(assertReadOnlySql(sql)).toBe(sql);
        expect(sql.startsWith('WITH ')).toBe(true);
        expect(sql).not.toContain(';');
        expect(sql).not.toMatch(/\b(set|begin|commit|do|into|lock|perform|execute)\b/i);
        expect(sql.match(TIME_BOUND)).toHaveLength(1);
        // The only tables read, each exactly once, the big one only under the time bound.
        expect(sql.match(/public\.[a-z_]+/g)).toEqual([
          'public.profiles',
          'public.hand_history',
          'public.ca_hand_facts',
        ]);
        // Only hands with a person in them, through the has_human partial index.
        expect(sql).toContain('WHERE h.has_human\n');
        expect(sql).toContain('is_horse IS NOT TRUE');
        expect(sql).toContain("status IS DISTINCT FROM 'deleted'");
      }
    });

    it('filters and splits land in the SQL', () => {
      const sql = buildResultsSql({
        sinceMs: SINCE,
        untilMs: UNTIL,
        splits: [SPLIT],
        mode: 'cash',
        games: ['plo5', 'plo6'],
        by: 'day',
      });
      expect(sql).toContain('AND h.tournament_id IS NULL');
      expect(sql).toContain("AND lower(coalesce(h.game_variant, 'nlh')) IN ('plo5', 'plo6')");
      expect(sql).toContain("m.created_at >= TIMESTAMPTZ '2026-11-22T03:13:56Z'");
      expect(sql).toContain("interval '30 minutes'");
      expect(
        buildResultsSql({
          sinceMs: SINCE,
          untilMs: UNTIL,
          splits: [],
          mode: 'tournament',
          games: null,
          by: null,
        })
      ).toContain('AND h.tournament_id IS NOT NULL');
    });

    it("reads every hand: never the stat table that keeps only each player's newest 1,000", () => {
      // ca_hand_player_stat is pruned to the newest ~1,000 rows per player, so a past window shrank
      // as people kept playing (2026-11-24). ca_hand_player_facts leaves out bomb-pot antes. The
      // result must come from ca_hand_facts, looked up per seated person by its primary key.
      for (const plan of plans) {
        const sql = buildResultsSql(plan);
        expect(sql).not.toContain('ca_hand_player_stat');
        expect(sql).not.toContain('ca_hand_player_facts');
        expect(sql).toContain('CROSS JOIN LATERAL jsonb_array_elements(d.players) e');
        expect(sql).toMatch(
          /LEFT JOIN LATERAL \(\s*SELECT x\.hand_id, x\.net, x\.went_to_showdown\s*FROM public\.ca_hand_facts x\s*WHERE x\.hand_id = s\.hand_id AND x\.user_id = s\.user_id\s*LIMIT 1\s*\) f ON true/
        );
        expect(sql).toContain('f.net AS profit');
        // The person-hands hand_history expects and the person-hands the source holds.
        expect(sql).toContain("'expected', count(*)");
        expect(sql).toContain("'found', count(*) FILTER (WHERE in_source)");
      }
    });

    it('refuses an unbounded or over-long range and anything that is not a plain game name', () => {
      const base = { splits: [], mode: 'all', games: null, by: null };
      expect(() => buildResultsSql({ ...base, sinceMs: NaN, untilMs: UNTIL })).toThrow(/range/);
      expect(() =>
        buildResultsSql({ ...base, sinceMs: UNTIL - (MAX_RANGE_DAYS + 1) * DAY, untilMs: UNTIL })
      ).toThrow(/92 days/);
      expect(() =>
        buildResultsSql({ ...base, sinceMs: SINCE, untilMs: UNTIL, games: ["x' OR 1=1 --"] })
      ).toThrow(/invalid game/);
      expect(() => parseGames("plo5,x'; drop table y")).toThrow(/invalid game/);
      expect(parseGames('PLO5, nlh,plo5')).toEqual(['nlh', 'plo5']);
    });

    it('is sent read-only with a 60 second limit, and nothing else in front', () => {
      expect(READ_ONLY_SESSION_PREFIX).toBe(
        "SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '60s'; "
      );
      const calls = [];
      const spawn = (bin, args) => {
        calls.push({ bin, args });
        return { status: 0, stdout: '[{"report":{"cells":[]}}]', stderr: '' };
      };
      const sql = buildResultsSql(plans[0]);
      queryReadOnly(sql, { supabaseWorkdir: '/nowhere', spawn });
      expect(calls).toHaveLength(1);
      expect(calls[0].bin).toBe('supabase');
      expect(calls[0].args.slice(0, 6)).toEqual([
        'db',
        'query',
        '--linked',
        '-o',
        'json',
        '--agent=no',
      ]);
      expect(calls[0].args.at(-1)).toBe(`${READ_ONLY_SESSION_PREFIX}${sql}`);
      expect(() =>
        queryReadOnly('UPDATE public.profiles SET status = 1', { supabaseWorkdir: '/x', spawn })
      ).toThrow(/non-SELECT/);
      expect(() => queryReadOnly('SELECT 1; SELECT 2', { supabaseWorkdir: '/x', spawn })).toThrow(
        /multi-statement/
      );
      expect(calls).toHaveLength(1);
    });
  });

  describe('arguments', () => {
    it('defaults to the last 7 days, every game, both modes', () => {
      const plan = resolvePlan(parseArgs([]), UNTIL);
      expect(plan).toEqual({
        sinceMs: UNTIL - 7 * DAY,
        untilMs: UNTIL,
        splits: [],
        mode: 'all',
        games: null,
        by: null,
      });
    });

    it('reads every documented option', () => {
      const o = parseArgs([
        ...FIXTURE_ARGS,
        '--games',
        'plo4,plo5',
        '--by',
        'table-size',
        '--gate',
        '--json',
      ]);
      const plan = resolvePlan(o, UNTIL);
      expect(plan).toEqual({
        sinceMs: SINCE,
        untilMs: UNTIL,
        splits: [SPLIT],
        mode: 'cash',
        games: ['plo4', 'plo5'],
        by: 'table-size',
      });
      expect(o.gate).toBe(true);
      expect(o.json).toBe(true);
    });

    it('refuses instants without a zone, splits outside the range, bad modes and a bare gate', () => {
      expect(() => parseInstant('--since', '2026-11-22 03:13:56')).toThrow(/ISO instant/);
      expect(() => parseInstant('--since', '2026-11-22T03:13:56')).toThrow(/ISO instant/);
      expect(parseInstant('--since', '2026-11-21T21:13:56-06:00')).toBe(SPLIT);
      expect(() => resolvePlan({ since: SINCE, until: UNTIL, splitAt: [UNTIL] }, UNTIL)).toThrow(
        /strictly between/
      );
      expect(() => resolvePlan({ since: UNTIL, until: SINCE }, UNTIL)).toThrow(/earlier/);
      expect(() => resolvePlan({ mode: 'sng' }, UNTIL)).toThrow(/--mode/);
      expect(() => resolvePlan({ by: 'name' }, UNTIL)).toThrow(/--by/);
      expect(() => parseArgs(['--gate'])).toThrow(/--split-at/);
      expect(() => parseArgs(['--frobnicate'])).toThrow(/Unknown argument/);
    });
  });

  describe('report and gate', () => {
    it('text output on fixture rows', () => {
      const { exitCode, out } = run(FIXTURE_ARGS);
      expect(exitCode).toBe(0);
      expect(out).toMatchInlineSnapshot(`
        "# People vs Horses results (read-only)

        Range: 2026-11-20T00:00:00Z to 2026-11-23T00:00:00Z (UTC). Read at 2026-11-23T00:00:05+00:00.
        Games: all. Mode: cash.
        Counted: hands with at least one Horse dealt in, people whose profile is not marked deleted. A result is the net chips a person won or lost in the hand after rake, in big blinds.
        Left out: 12 person-hands of deleted accounts, 7 person-hands with no Horse dealt in, 1 rows without a usable result or big blind.
        Luck: the SE and the 95% interval are clustered on person-session (one person, one game, hands no more than 30 minutes apart).

        Windows:
        - Window 1: 2026-11-20T00:00:00Z to 2026-11-22T03:13:56Z
        - Window 2: 2026-11-22T03:13:56Z to 2026-11-23T00:00:00Z

        ## nlh cash

        | Window | Hands | Person-hands | People | Top person | bb won | bb/100 | SD per hand | SE of bb/100 | 95% interval | Showdown bb | Non-showdown bb |
        | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
        | 1 | 40 | 40 | 1 | 100% | +60.0 | +150.0 | 0.0 | n/a | n/a | +30.0 | +30.0 |
        | 2 | 60 | 60 | 1 | 100% | -30.0 | -50.0 | 0.0 | n/a | n/a | -15.0 | -15.0 |

        Window 2 against window 1 (split at 2026-11-22T03:13:56Z): difference -200.0 bb/100, SE n/a, z n/a.
        Verdict for nlh cash at 2026-11-22T03:13:56Z: too few hands to judge (40 person-hands before, 2,000 needed; one person played 100% of the hands before, the limit is 60%; 60 person-hands after, 2,000 needed; one person played 100% of the hands after, the limit is 60%).

        ## plo5 cash

        | Window | Hands | Person-hands | People | Top person | bb won | bb/100 | SD per hand | SE of bb/100 | 95% interval | Showdown bb | Non-showdown bb |
        | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
        | 1 | 2,300 | 2,400 | 4 | 25% | -240.0 | -10.0 | 0.3 | 9.6 | -28.9 to +8.9 | -120.0 | -120.0 |
        | 2 | 2,350 | 2,400 | 4 | 25% | +720.0 | +30.0 | 0.1 | 5.3 | +19.5 to +40.5 | +360.0 | +360.0 |

        Window 2 against window 1 (split at 2026-11-22T03:13:56Z): difference +40.0 bb/100, SE 11.0, z +3.63.
        Verdict for plo5 cash at 2026-11-22T03:13:56Z: people doing better than before (z = +3.63, a change counts from 2).

        Rules: "too few hands to judge" when either window has fewer than 2,000 person-hands or one person played more than 60% of them; "no measurable change" when |z| is below 2; otherwise "people doing better than before" or "people doing worse than before"."
      `);
    });

    it('never prints more than four characters of an account id', () => {
      // With --by player the query's breakdown value is the person's opaque number.
      const perPerson = () => {
        const rows = fixtureRows();
        rows[0].report.cells = rows[0].report.cells.map((c) => ({ ...c, d: String(c.pn) }));
        return rows;
      };
      for (const extra of [[], ['--json'], ['--by', 'player'], ['--by', 'player', '--json']]) {
        const { out } = run([...FIXTURE_ARGS, ...extra], perPerson);
        expect(out).not.toContain('full-account-id');
        expect(out).not.toMatch(/a\db0-/);
      }
      const { out } = run([...FIXTURE_ARGS, '--by', 'player'], perPerson);
      expect(out).toContain('| a1b0 | 1 |');
      expect(out).toContain('| a4b0 | 2 |');
    });

    it('a breakdown adds rows without changing the per-game totals', () => {
      const rows = fixtureRows();
      const report = rows[0].report;
      // Put every plo5 sitting half on one day and half on the next.
      report.cells = report.cells.flatMap((c) =>
        c.g === 'plo5'
          ? ['2026-11-21', '2026-11-22'].map((d) => ({
              ...c,
              d,
              n: c.n / 2,
              s: c.s / 2,
              ss: c.ss / 2,
              sdn: c.sdn / 2,
              sds: c.sds / 2,
            }))
          : [{ ...c, d: '2026-11-21' }]
      );
      const plan = { sinceMs: SINCE, untilMs: UNTIL, splits: [SPLIT], mode: 'cash', games: null };
      const flat = buildReport(fixtureRows(), { ...plan, by: null });
      const byDay = buildReport(rows, { ...plan, by: 'day' });
      const plo5 = byDay.games.find((g) => g.game === 'plo5');
      expect(plo5.windows).toEqual(flat.games.find((g) => g.game === 'plo5').windows);
      expect(plo5.breakdown.map((b) => b.label)).toEqual(['2026-11-21', '2026-11-22']);
      expect(plo5.breakdown[0].windows[0].personHands).toBe(1200);
      expect(formatReportText(byDay)).toContain('### By day (UTC)');
    });

    it('gate: 1 when people are measurably better after the split', () => {
      const { exitCode, out } = run([...FIXTURE_ARGS, '--games', 'plo5', '--gate'], () => {
        const rows = fixtureRows();
        rows[0].report.cells = rows[0].report.cells.filter((c) => c.g === 'plo5');
        return rows;
      });
      expect(exitCode).toBe(1);
      expect(out).toContain(
        'GATE 1: people measurably better than before the split (plo5 cash at 2026-11-22T03:13:56Z)'
      );
    });

    it('gate: people better wins over a game that is too small to judge', () => {
      const { exitCode, out } = run([...FIXTURE_ARGS, '--gate', '--json']);
      expect(exitCode).toBe(1);
      expect(JSON.parse(out).gate.exitCode).toBe(1);
    });

    it('gate: 2 when a window is too small, or there are no hands at all', () => {
      const small = run([...FIXTURE_ARGS, '--games', 'nlh', '--gate'], () => {
        const rows = fixtureRows();
        rows[0].report.cells = rows[0].report.cells.filter((c) => c.g === 'nlh');
        return rows;
      });
      expect(small.exitCode).toBe(2);
      expect(small.out).toContain('GATE 2: too few hands to judge (nlh cash at');
      const empty = run([...FIXTURE_ARGS, '--gate'], () => [
        { report: { cells: [], hands: [], source: { expected: 0, found: 0 } } },
      ]);
      expect(empty.exitCode).toBe(2);
      expect(empty.out).toContain('No person-hands against Horses in this range.');
    });

    it('gate: 0 when nothing measurable changed, and when people do worse', () => {
      const flip = (swap) => () => {
        const rows = fixtureRows();
        rows[0].report.cells = rows[0].report.cells
          .filter((c) => c.g === 'plo5')
          .map((c) => (swap ? { ...c, w: 1 - c.w } : { ...c, s: c.w === 1 ? -c.n * 0.1 : c.s }));
        return rows;
      };
      const worse = run([...FIXTURE_ARGS, '--gate'], flip(true));
      expect(worse.exitCode).toBe(0);
      expect(worse.out).toContain('people doing worse than before');
      const flat = run([...FIXTURE_ARGS, '--gate'], flip(false));
      expect(flat.out).toContain('no measurable change');
      expect(flat.exitCode).toBe(0);
      expect(
        gateResult({
          games: [{ game: 'x', mode: 'cash', comparisons: [{ verdict: 'no_change' }] }],
        }).exitCode
      ).toBe(0);
    });

    it('a wrong argument or a failed read is never a gate answer', () => {
      expect(run(['--mode', 'sng']).exitCode).toBe(EXIT_USAGE);
      expect(run(['--gate']).exitCode).toBe(EXIT_USAGE);
      const failed = run([...FIXTURE_ARGS, '--gate'], () => {
        throw new Error('canceling statement due to statement timeout');
      });
      expect(failed.exitCode).toBe(EXIT_FAILED);
      expect(failed.err).toContain('statement timeout');
      expect([0, 1, 2]).not.toContain(EXIT_USAGE);
      expect([0, 1, 2]).not.toContain(EXIT_FAILED);
    });

    it('a source holding fewer person-hands than hand_history fails loudly, never a verdict', () => {
      // The 2026-11-24 failure: the source had lost the oldest hands of the busiest person, and the
      // report still printed totals and a gate answer for the shrunken window.
      for (const [found, missing] of [
        [4919, '1 missing'],
        [1845, '3,075 missing'],
        [0, '4,920 missing'],
      ]) {
        const short = run([...FIXTURE_ARGS, '--gate'], () => {
          const rows = fixtureRows();
          rows[0].report.source.found = found;
          return rows;
        });
        expect(short.exitCode).toBe(EXIT_FAILED);
        expect(short.out).toBe('');
        expect(short.err).toContain(
          `of the 4,920 person-hands hand_history has for this range (${missing})`
        );
        expect(short.err).not.toContain('GATE');
      }
      // Output without the counts (a file saved by the old report, say) is refused too.
      const noCounts = run([...FIXTURE_ARGS, '--gate'], () => {
        const rows = fixtureRows();
        delete rows[0].report.source;
        return rows;
      });
      expect(noCounts.exitCode).toBe(EXIT_FAILED);
      expect(noCounts.err).toContain('no source count');
      expect(run([...FIXTURE_ARGS, '--json']).exitCode).toBe(0);
    });

    it('the source guard on its own', () => {
      expect(
        assertSourceComplete({ source: { table: 'ca_hand_facts', expected: 833, found: 833 } })
      ).toEqual({
        table: 'ca_hand_facts',
        expected: 833,
        found: 833,
      });
      expect(assertSourceComplete({ source: { expected: '0', found: '0' } }).expected).toBe(0);
      expect(() => assertSourceComplete({ source: { expected: 833, found: 242 } })).toThrow(
        /holds 242 of the 833 person-hands .* \(591 missing\)/
      );
      for (const bad of [
        {},
        { source: null },
        { source: { expected: 5 } },
        { source: { expected: -1, found: 0 } },
      ]) {
        expect(() => assertSourceComplete(bad)).toThrow(/no source count/);
      }
    });

    it('--sql prints the query and reads nothing', () => {
      const { exitCode, out } = run([...FIXTURE_ARGS, '--sql'], () => {
        throw new Error('must not query');
      });
      expect(exitCode).toBe(0);
      expect(assertReadOnlySql(out)).toBe(out);
    });
  });

  describe('--by-option-receipt: hands where an option receipt fired against hands where it did not', () => {
    const RECEIPT_ARGS = [
      '--since',
      '2026-11-20T00:00:00Z',
      '--until',
      '2026-11-23T00:00:00Z',
      '--mode',
      'cash',
      '--by-option-receipt',
      'cashDefenceTrimColdCalls',
    ];

    it('the query stays one read-only SELECT and groups hands by the receipt, with the same filters', () => {
      const plan = resolvePlan({
        since: SINCE,
        until: UNTIL,
        mode: 'cash',
        games: ['nlh'],
        byOptionReceipt: 'cashDefenceTrimColdCalls',
      });
      const sql = buildResultsSql(plan);
      expect(assertReadOnlySql(sql)).toBe(sql);
      expect(sql).toContain('FROM public.ca_horse_hand_receipts r');
      expect(sql).toContain('WHERE r.hand_id = m.hand_id');
      expect(sql).toContain("split_part(r.receipt, ':', 1) = 'cashDefenceTrimColdCalls'");
      // Nothing else of the query moves: without the option it is the same text but for that one expression.
      const plain = buildResultsSql({ ...plan, byOptionReceipt: null });
      expect(plain).not.toContain('ca_horse_hand_receipts');
      const [head, rest] = sql.split('CASE WHEN EXISTS (');
      const tail = rest.slice(rest.indexOf('THEN 1 ELSE 0 END AS w') + 'THEN 1 ELSE 0 END'.length);
      expect(`${head}0${tail}`).toBe(plain);
      expect(sql).toContain('AND h.tournament_id IS NULL');
      expect(sql).toContain("IN ('nlh')");
      // The receipt text is never selected: no receipt, hand id or card leaves the query.
      expect(sql.match(/r\.receipt/g)).toHaveLength(1);
    });

    it('refuses anything that is not one plain option name, a split, and the gate', () => {
      for (const bad of [
        "x'; DROP TABLE y; --",
        'a b',
        '',
        'opt:call>fold',
        '9lives',
        'a'.repeat(65),
      ]) {
        expect(() => resolvePlan({ since: SINCE, until: UNTIL, byOptionReceipt: bad })).toThrow(
          /--by-option-receipt takes one option name/
        );
        expect(() =>
          buildResultsSql({
            sinceMs: SINCE,
            untilMs: UNTIL,
            splits: [],
            mode: 'all',
            games: null,
            by: null,
            byOptionReceipt: bad,
          })
        ).toThrow(/invalid option name/);
      }
      expect(() =>
        resolvePlan({ since: SINCE, until: UNTIL, splitAt: [SPLIT], byOptionReceipt: 'someOption' })
      ).toThrow(/cannot be combined with --split-at/);
      expect(() => parseArgs([...RECEIPT_ARGS, '--gate'])).toThrow(
        /cannot be combined with --by-option-receipt/
      );
      const usage = run([...RECEIPT_ARGS, '--split-at', '2026-11-22T03:13:56Z']);
      expect(usage.exitCode).toBe(EXIT_USAGE);
      expect(parseArgs(RECEIPT_ARGS).byOptionReceipt).toBe('cashDefenceTrimColdCalls');
      expect(run(['--by-option-receipt']).exitCode).toBe(EXIT_USAGE);
    });

    it('reports the two groups with the same clustered error and the same too-few-hands rules', () => {
      const { exitCode, out } = run(RECEIPT_ARGS);
      expect(exitCode).toBe(0);
      expect(out).toContain('Option receipt: cashDefenceTrimColdCalls.');
      expect(out).toContain('Window 1: hands in which no cashDefenceTrimColdCalls receipt fired');
      expect(out).toContain('Window 2: hands in which a cashDefenceTrimColdCalls receipt fired');
      expect(out).toContain('Window 2 against window 1 (receipt cashDefenceTrimColdCalls):');
      expect(out).not.toContain('split at');
      // The fixture's two windows, read as not fired / fired: plo5 can be judged, nlh cannot.
      const report = buildReport(
        fixtureRows(),
        resolvePlan({
          since: SINCE,
          until: UNTIL,
          mode: 'cash',
          byOptionReceipt: 'cashDefenceTrimColdCalls',
        })
      );
      expect(report.byOptionReceipt).toBe('cashDefenceTrimColdCalls');
      expect(report.windows.map((w) => w.receipt)).toEqual(['not_fired', 'fired']);
      expect(report.windows.every((w) => w.from === report.since && w.to === report.until)).toBe(
        true
      );
      const plo5 = report.games.find((g) => g.game === 'plo5');
      const nlh = report.games.find((g) => g.game === 'nlh');
      // Exactly what the split comparison computes from the same cells: one statistic, reused.
      const split = buildReport(
        fixtureRows(),
        resolvePlan({ since: SINCE, until: UNTIL, mode: 'cash', splitAt: [SPLIT] })
      );
      const splitPlo5 = split.games.find((g) => g.game === 'plo5');
      expect(plo5.windows).toEqual(splitPlo5.windows);
      expect({ ...plo5.comparisons[0], splitAt: null }).toEqual({
        ...splitPlo5.comparisons[0],
        splitAt: null,
      });
      expect(plo5.comparisons[0].splitAt).toBe('receipt cashDefenceTrimColdCalls');
      expect(plo5.comparisons[0].verdict).toBe('better');
      expect(plo5.comparisons[0].sePer100).toBeGreaterThan(0);
      expect(nlh.comparisons[0].verdict).toBe('too_few');
      expect(nlh.comparisons[0].reason).toMatch(/person-hands .* needed/);
      // A report without the option says nothing of receipts.
      expect(split.byOptionReceipt).toBeNull();
      expect(formatReportText(split)).not.toContain('Option receipt');
    });

    it('a source holding fewer person-hands than hand_history still fails loudly', () => {
      const short = fixtureRows();
      short[0].report.source.found = 100;
      const { exitCode, err } = run(RECEIPT_ARGS, () => short);
      expect(exitCode).toBe(EXIT_FAILED);
      expect(err).toMatch(/refusing to report on part of the hands/);
    });
  });
});
