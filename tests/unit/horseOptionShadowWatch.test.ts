// tests/unit/horseOptionShadowWatch.test.ts
// The read-only Horse option shadow watcher (scripts/ops/horse-option-shadow-watch.mjs): arguments, the SELECTs it
// sends, and the report and VERDICT it draws from rows, for a hold'em and a PLO option.
import { describe, expect, it } from 'vitest';
import {
  ACTED_RECEIPTS,
  buildWatchQueries,
  evaluateWatch,
  formatWatchReport,
  histogramQuantile,
  parseWatchArgs,
} from '../../scripts/ops/horse-option-shadow-watch-lib.mjs';
import { runWatch } from '../../scripts/ops/horse-option-shadow-watch.mjs';

const SINCE = '2026-11-24T15:00:00Z';
const HOLDEM = 'holdemValueAndCallsArePriced';
const PLO = 'omahaMathCorePlo5Flop';

const fire = (feature: string, fires: number) => ({ feature, fires: String(fires) });
const lat = (scope: string, buckets: number[], maxMs: number) => ({
  scope,
  samples: String(buckets.reduce((a, b) => a + b, 0)),
  total_ms: String(buckets.reduce((a, b) => a + b, 0) * 10),
  max_ms: String(maxMs),
  ...Object.fromEntries(buckets.map((b, i) => [`b${i}`, String(b)])),
});

function cleanHoldemRows() {
  return {
    switchRows: [{ option: HOLDEM, state: 'shadow', updated_at: '2026-11-24T15:00:05Z' }],
    workers: [{ workers: '8', receipts: '120', first_at: SINCE, last_at: '2026-11-24T16:00:00Z' }],
    fires: [
      fire(`option_shadow_${HOLDEM}_same_seen`, 90),
      fire(`option_shadow_${HOLDEM}_changed_seen`, 10),
      fire(`option_shadow_${HOLDEM}_same_person_seen`, 9),
      fire(`option_shadow_${HOLDEM}_changed_person_seen`, 3),
      fire(`option_shadow_${HOLDEM}_dir_call_to_fold_seen`, 4),
      fire(`option_shadow_${HOLDEM}_dir_call_to_fold_person_seen`, 2),
      fire(`option_shadow_${HOLDEM}_dir_raise_to_call_seen`, 3),
      fire(`option_shadow_${HOLDEM}_dir_check_to_bet_seen`, 2),
      fire(`option_shadow_${HOLDEM}_dir_size_seen`, 1),
      fire(`option_shadow_${HOLDEM}_dir_size_person_seen`, 1),
      fire('option_shadow_skipped_stage_horse_only_seen', 40),
    ],
    latency: [
      lat('option_shadow_stage_redecide', [0, 10, 50, 30, 10, 0, 0, 0, 0, 0], 14),
      lat('option_shadow_stage_redecide_game_nlh_cash', [0, 8, 40, 20, 8, 0, 0, 0, 0, 0], 14),
      lat('option_shadow_stage_redecide_game_nlh_lightning', [0, 2, 10, 10, 2, 0, 0, 0, 0, 0], 12),
    ],
    errors: [],
  };
}

describe('arguments', () => {
  it('takes the option, --since, --release, --acted-prefix and --json', () => {
    expect(
      parseWatchArgs([
        HOLDEM,
        '--since',
        SINCE,
        '--release',
        'abcdef1',
        '--acted-prefix',
        'x_y_z',
        '--json',
      ])
    ).toEqual({
      option: HOLDEM,
      since: SINCE,
      release: 'abcdef1',
      actedPrefixes: ['x_y_z'],
      json: true,
      help: false,
    });
  });
  it('refuses a bad option name, a missing or non-UTC --since, a bad release and a bad prefix', () => {
    expect(() => parseWatchArgs(["x'; drop", '--since', SINCE])).toThrow(/option/);
    expect(() => parseWatchArgs([HOLDEM])).toThrow(/--since/);
    expect(() => parseWatchArgs([HOLDEM, '--since', '2026-11-24 15:00'])).toThrow(/--since/);
    expect(() => parseWatchArgs([HOLDEM, '--since', "2026-11-24T15:00:00Z'"])).toThrow(/--since/);
    expect(() => parseWatchArgs([HOLDEM, '--since', SINCE, '--release', 'XYZ'])).toThrow(/release/);
    expect(() => parseWatchArgs([HOLDEM, '--since', SINCE, '--acted-prefix', "a'b"])).toThrow(
      /prefix/
    );
    expect(() => parseWatchArgs([HOLDEM, '--since', SINCE, '--nope'])).toThrow(/unknown flag/);
  });
});

describe('the queries', () => {
  it('are SELECTs only, scoped to the window, and read the option and its acted receipts', () => {
    const q = buildWatchQueries({
      option: PLO,
      since: SINCE,
      release: 'b31db25',
      actedPrefixes: [],
    });
    for (const sql of Object.values(q)) {
      expect(sql.startsWith('SELECT ')).toBe(true);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|CREATE)\b/i);
    }
    expect(q.switchRows).toContain(`'${PLO}', 'omahaMathCore'`);
    expect(q.fires).toContain(`'2026-11-24T15:00:00Z'::timestamptz`);
    expect(q.fires).toContain(`LIKE 'b31db25%'`);
    expect(q.fires).toContain(String.raw`LIKE 'omaha\_math\_core\_%'`);
    expect(q.fires).toContain(String.raw`LIKE 'option\_shadow\_%'`);
    expect(q.latency).toContain(String.raw`LIKE 'option\_shadow\_%'`);
  });
  it('every hold-em option staged today has its acted receipts known', () => {
    for (const o of [
      'holdemValueAndCallsArePriced',
      'holdemTournamentAllInCallIsPriced',
      'cashDefenceTrimColdCalls',
    ])
      expect(Object.hasOwn(ACTED_RECEIPTS, o), o).toBe(true);
  });
});

describe('the report and the VERDICT', () => {
  it('a clean hold-em trial: re-decisions, agree/disagree, directions, person hands, latency, CLEAN', () => {
    const rep = evaluateWatch({ option: HOLDEM, since: SINCE }, cleanHoldemRows());
    expect(rep.redecisions).toBe(100);
    expect(rep.changed).toBe(10);
    expect(rep.disagreePct).toBeCloseTo(10);
    expect(rep.personHands).toBe(12);
    expect(rep.directions.map((d) => [d.direction, d.all, d.person])).toEqual([
      ['call_to_fold', 4, 2],
      ['raise_to_call', 3, 0],
      ['check_to_bet', 2, 0],
      ['size', 1, 1],
    ]);
    expect(rep.actedLeaks).toBe(0);
    expect(rep.leakCheck).toBe('checked');
    expect(rep.latency.map((l) => l.scope)).toEqual([
      'option_shadow_stage_redecide',
      'option_shadow_stage_redecide_game_nlh_cash',
      'option_shadow_stage_redecide_game_nlh_lightning',
    ]);
    expect(rep.over100).toBe(0);
    expect(rep.verdict).toBe('CLEAN');
    const text = formatWatchReport(rep);
    expect(text.split('\n').at(-1)).toMatch(
      /^VERDICT=CLEAN option=holdemValueAndCallsArePriced redecisions=100 person=12 /
    );
    expect(text).toContain('call_to_fold');
  });
  it('an acted leak, the breaker, a failed re-decision, an error or slow re-decisions make it DIRTY', () => {
    const cases: Array<[string, (r: ReturnType<typeof cleanHoldemRows>) => void]> = [
      ['acted_leak', (r) => r.fires.push(fire('holdem_priced_value_raise_deferred', 1))],
      ['breaker', (r) => r.fires.push(fire('option_shadow_stage_self_disabled_seen', 1))],
      ['breaker', (r) => r.fires.push(fire('option_shadow_inline_self_disabled_seen', 1))],
      ['redecide_failed', (r) => r.fires.push(fire('option_shadow_redecide_failed_seen', 1))],
      ['errors', (r) => r.errors.push({ error_type: 'x', n: '1', last_at: SINCE } as never)],
      [
        'latency_over_100ms',
        (r) => r.latency.push(lat('option_shadow_redecide', [0, 0, 0, 0, 0, 0, 0, 0, 2, 0], 120)),
      ],
    ];
    for (const [reason, mutate] of cases) {
      const rows = cleanHoldemRows();
      mutate(rows);
      const rep = evaluateWatch({ option: HOLDEM, since: SINCE }, rows);
      expect(rep.verdict, reason).toBe('DIRTY');
      expect(rep.reasons, reason).toContain(reason);
      expect(formatWatchReport(rep).split('\n').at(-1)).toContain(`reasons=`);
    }
  });
  it('no re-decision in the window is not CLEAN', () => {
    const rows = cleanHoldemRows();
    rows.fires = [];
    expect(evaluateWatch({ option: HOLDEM, since: SINCE }, rows).reasons).toEqual([
      'no_redecisions',
    ]);
  });
  it('PLO: the math core flag reads like the old shell watcher, and its leak check is lifted while omahaMathCore is on', () => {
    const rows = {
      switchRows: [
        { option: 'omahaMathCore', state: 'off', updated_at: SINCE },
        { option: PLO, state: 'shadow', updated_at: SINCE },
      ],
      workers: [{ workers: '8', receipts: '10' }],
      fires: [
        fire(`option_shadow_${PLO}_same_seen`, 700),
        fire(`option_shadow_${PLO}_changed_seen`, 27),
        fire('omaha_math_core_flop_seen', 3),
      ],
      latency: [
        lat('option_shadow_stage_redecide', [0, 0, 100, 300, 200, 100, 22, 0, 5, 0], 195.8),
      ],
      errors: [],
    };
    const rep = evaluateWatch({ option: PLO, since: SINCE }, rows);
    expect(rep.redecisions).toBe(727);
    expect(rep.directions).toEqual([]);
    expect(rep.actedLeaks).toBe(3);
    expect(rep.reasons).toEqual(['acted_leak']);
    rows.switchRows[0]!.state = 'on';
    const lifted = evaluateWatch({ option: PLO, since: SINCE }, rows);
    expect(lifted.leakCheck).toBe('lifted');
    expect(lifted.verdict).toBe('CLEAN');
    expect(lifted.over100).toBe(5);
    // a staged re-decision is timed under both scopes: counted once
    rows.latency.push(
      lat('option_shadow_redecide', [0, 0, 100, 300, 200, 100, 22, 0, 5, 0], 195.8)
    );
    expect(evaluateWatch({ option: PLO, since: SINCE }, rows).over100).toBe(5);
    expect(lifted.over100Pct).toBeLessThan(1);
  });
  it('an option with no known acted receipt is DIRTY until --acted-prefix names one', () => {
    const rows = cleanHoldemRows();
    const o = 'someNewPricedOption';
    rows.switchRows = [{ option: o, state: 'shadow', updated_at: SINCE }];
    rows.fires = [fire(`option_shadow_${o}_same_seen`, 5)];
    expect(evaluateWatch({ option: o, since: SINCE }, rows).reasons).toEqual([
      'acted_leak_unchecked',
    ]);
    expect(
      evaluateWatch({ option: o, since: SINCE, actedPrefixes: ['some_new_'] }, rows).verdict
    ).toBe('CLEAN');
  });
  it('the histogram quantile is the upper bucket edge', () => {
    expect(histogramQuantile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 0.5)).toBeNull();
    expect(histogramQuantile([1, 1, 0, 0, 0, 0, 0, 0, 0, 0], 2, 0.5)).toBe(1);
    expect(histogramQuantile([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 250, 0.95)).toBe(250);
  });
});

describe('the CLI', () => {
  it('sends only SELECTs, prints the report and exits 0 on CLEAN, 1 on DIRTY, 2 on bad input', async () => {
    const sent: string[] = [];
    const out: string[] = [];
    const rows = cleanHoldemRows();
    const byQuery = (sql: string) => {
      sent.push(sql);
      if (sql.includes('ca_horse_style_switch')) return rows.switchRows;
      if (sql.includes('count(DISTINCT')) return rows.workers;
      if (sql.includes('r.fires')) return rows.fires;
      if (sql.includes('r.latency')) return rows.latency;
      return rows.errors;
    };
    const ok = await runWatch([HOLDEM, '--since', SINCE], {
      queryDb: byQuery,
      stdout: (s: string) => out.push(s),
    });
    expect(ok.exitCode).toBe(0);
    expect(sent).toHaveLength(5);
    for (const s of sent) expect(s.startsWith('SELECT ')).toBe(true);
    expect(out.join('\n')).toMatch(/VERDICT=CLEAN/);
    rows.fires.push(fire('option_shadow_stage_self_disabled_seen', 1));
    const dirty = await runWatch([HOLDEM, '--since', SINCE], {
      queryDb: byQuery,
      stdout: () => {},
    });
    expect(dirty.exitCode).toBe(1);
    const bad = await runWatch([HOLDEM], { queryDb: byQuery, stdout: () => {} });
    expect(bad.exitCode).toBe(2);
  });
});
