import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRE_RELEASE_BASELINE,
  buildReport,
  chicagoReleaseInstant,
  compareToBaseline,
  coverage,
  isReadOnlyStatement,
  meanFromSums,
  mergeCells,
  parseReceiptsResult,
  parseSpotsResult,
  rate,
  renderMarkdown,
  renderReceiptsSql,
  renderSpotsSql,
  resolveWindow,
  resultSection,
  slices,
  summarize,
  summarizeReceipts,
  type SpotCell,
} from './RiverBluffLiveReport.js';

const KIT = resolve(process.cwd(), '../scripts/horse-measure');
const SPOTS_SQL = readFileSync(resolve(KIT, 'sql/river-bluff-spots.sql'), 'utf8');
const RECEIPTS_SQL = readFileSync(resolve(KIT, 'sql/river-bluff-receipts.sql'), 'utf8');

const zero = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const cell = (over: Partial<SpotCell>): SpotCell => ({
  v: 'nlh',
  fmt: 'cash',
  ways: 'hu',
  line: 'checked_to',
  gt: 'std',
  style: 'regular',
  who: 'horse',
  spots: 10,
  bets: 3,
  known: 10,
  known_bets: 3,
  air_spots: 4,
  air_bets: 1,
  bet_out: [3, 3, 2, 1, 0, 0.9, 1.5, 3, 6, 20],
  air_out: [1, 1, 1, 0, 0, 0.3, 0.5, 1, 4, 16],
  ...over,
});

const mcpText = (column: string, obj: unknown) =>
  `{"result":"Below is the result ... <untrusted-data-abc>\\n${JSON.stringify([{ [column]: obj }]).replace(/"/g, '\\"')}\\n</untrusted-data-abc> ..."}`;

describe('river bluff live report: parsing', () => {
  const spots = {
    section: 'river_bluff_spots',
    window: ['2026-11-08T10:05:00Z', '2026-11-08T12:05:00Z'],
    cells: [cell({})],
  };

  it('reads a spots result from raw management API JSON and from MCP wrapper text', () => {
    const raw = parseSpotsResult(JSON.stringify([{ report: spots }]));
    expect(raw.window).toEqual(spots.window);
    expect(raw.cells).toHaveLength(1);
    const wrapped = parseSpotsResult(mcpText('report', spots));
    expect(wrapped).toEqual(raw);
    expect(resultSection(mcpText('report', spots))).toBe('spots');
  });

  it('refuses a malformed or inconsistent spots result instead of reading it as empty', () => {
    expect(() => parseSpotsResult(JSON.stringify([]))).toThrow(/exactly one row/);
    expect(() =>
      parseSpotsResult(JSON.stringify([{ report: { ...spots, section: 'x' } }]))
    ).toThrow(/not a river-bluff-spots/);
    expect(() =>
      parseSpotsResult(
        JSON.stringify([{ report: { ...spots, window: ['2026-11-08T10:05', 'b'] } }])
      )
    ).toThrow(/window/);
    expect(() =>
      parseSpotsResult(JSON.stringify([{ report: { ...spots, cells: undefined } }]))
    ).toThrow(/cells/);
    const bad = (c: Partial<SpotCell>) =>
      JSON.stringify([{ report: { ...spots, cells: [cell(c)] } }]);
    expect(() => parseSpotsResult(bad({ bets: 11 }))).toThrow(/inconsistent/);
    expect(() => parseSpotsResult(bad({ air_bets: 5 }))).toThrow(/inconsistent/);
    expect(() =>
      parseSpotsResult(bad({ bet_out: [2, 3, 2, 1, 0, 0, 0, 0, 0, 0] as SpotCell['bet_out'] }))
    ).toThrow(/outcome vector/);
    expect(() =>
      parseSpotsResult(bad({ air_out: [1, 1] as unknown as SpotCell['air_out'] }))
    ).toThrow(/10 finite/);
    expect(() => parseSpotsResult(bad({ style: '' }))).toThrow(/missing style/);
  });

  it('reads a receipts result and refuses bad rows', () => {
    const r = {
      section: 'river_bluff_receipts',
      days: ['2026-11-07', '2026-11-08'],
      rows: [
        ['2026-11-07', 'control', 'decide_nlh', null, 100],
        ['2026-11-07', 'bet', 'river_bluff_baseline_junk', 'baseline HU (#9803): junk', 0],
      ],
    };
    const parsed = parseReceiptsResult(mcpText('receipts', r));
    expect(parsed.rows[1]).toEqual({
      day: '2026-11-07',
      kind: 'bet',
      feature: 'river_bluff_baseline_junk',
      layer: 'baseline HU (#9803): junk',
      fires: 0,
    });
    expect(resultSection(JSON.stringify([{ receipts: r }]))).toBe('receipts');
    expect(() =>
      parseReceiptsResult(
        JSON.stringify([{ receipts: { ...r, rows: [['2026-11-07', 'nope', 'x', null, 1]] } }])
      )
    ).toThrow(/bad kind/);
    expect(() =>
      parseReceiptsResult(
        JSON.stringify([{ receipts: { ...r, rows: [['2026-11-07', 'bet', 'x', null, -1]] } }])
      )
    ).toThrow(/bad fires/);
    expect(resultSection('nothing here')).toBeNull();
  });
});

describe('river bluff live report: statistics', () => {
  it('rate and mean say "no data" rather than zero', () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, p: null, se: null });
    expect(rate(3, 12).p).toBeCloseTo(0.25);
    expect(rate(3, 12).se).toBeCloseTo(Math.sqrt((0.25 * 0.75) / 12));
    expect(meanFromSums(0, 0, 0)).toEqual({ n: 0, mean: null, se: null });
    expect(meanFromSums(1, 5, 25)).toEqual({ n: 1, mean: 5, se: null });
    // values 1, 3, 5: mean 3, sample variance 4, se 2 / sqrt(3)
    const m = meanFromSums(3, 9, 35);
    expect(m.mean).toBeCloseTo(3);
    expect(m.se).toBeCloseTo(2 / Math.sqrt(3));
  });

  it('merges slices by every dimension and pools by the asked ones', () => {
    const a = cell({});
    const b = cell({});
    const c = cell({
      v: 'plo4',
      spots: 5,
      bets: 0,
      known: 5,
      known_bets: 0,
      air_spots: 1,
      air_bets: 0,
      bet_out: [...zero] as SpotCell['bet_out'],
      air_out: [...zero] as SpotCell['air_out'],
    });
    const merged = mergeCells([a, b, c]);
    expect(merged).toHaveLength(2);
    expect(merged.find((x) => x.v === 'nlh')?.spots).toBe(20);
    expect(merged.find((x) => x.v === 'nlh')?.bet_out[8]).toBe(12);
    expect(a.spots).toBe(10); // inputs untouched
    const [all] = summarize(merged, []);
    expect(all.spots).toBe(25);
    expect(all.betRate.p).toBeCloseTo(6 / 25);
    expect(all.airShareOfBets.p).toBeCloseTo(2 / 6);
    expect(all.airBetRate.p).toBeCloseTo(2 / 9);
    expect(all.bluff.fold.p).toBe(1);
    expect(all.bluff.breakEven).toBeCloseTo(0.3);
    expect(all.bluff.foldMargin).toBeCloseTo(0.7);
    expect(all.bluff.ev.mean).toBeCloseTo(4);
    const plo = summarize(merged, ['v']).find((s) => s.key.v === 'plo4');
    expect(plo?.bluff.fold.p).toBeNull();
    expect(plo?.bluff.ev.mean).toBeNull();
  });

  it('compares bet frequency with the pre-release baseline, and says no data where there is none', () => {
    const s = summarize(
      [
        cell({
          spots: 4328,
          bets: 1277,
          known: 4328,
          known_bets: 1277,
          bet_out: [1277, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ],
      ['v']
    );
    const d = compareToBaseline(s);
    const nlh = d.find((x) => x.v === 'nlh');
    expect(nlh?.now.p).toBeCloseTo(1277 / 4328);
    expect(nlh?.delta).toBeCloseTo((100 * 1277) / 4328 - 29.5);
    expect(d.find((x) => x.v === 'plo4')?.delta).toBeNull();
    expect(Object.keys(PRE_RELEASE_BASELINE.betRate)).toEqual([
      'nlh',
      'plo4',
      'plo6',
      'plo5',
      'flo8',
    ]);
  });
});

describe('river bluff live report: coverage, slices and receipts', () => {
  it('names gaps and overlaps instead of reading missing time as quiet', () => {
    const S = '2026-11-08T10:00:00Z';
    const E = '2026-11-08T16:00:00Z';
    expect(coverage(S, E, slices(S, E, 2)).complete).toBe(true);
    const gap = coverage(S, E, [
      ['2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z'],
      ['2026-11-08T14:00:00Z', '2026-11-08T16:00:00Z'],
    ]);
    expect(gap.complete).toBe(false);
    expect(gap.gaps).toEqual([['2026-11-08T12:00:00Z', '2026-11-08T14:00:00Z']]);
    const over = coverage(S, E, [
      ['2026-11-08T10:00:00Z', '2026-11-08T13:00:00Z'],
      ['2026-11-08T12:00:00Z', '2026-11-08T16:00:00Z'],
    ]);
    expect(over.overlaps).toEqual([['2026-11-08T12:00:00Z', '2026-11-08T13:00:00Z']]);
    expect(coverage(S, E, []).gaps).toEqual([[S, E]]);
    expect(slices(S, '2026-11-08T15:00:00Z', 2).at(-1)).toEqual([
      '2026-11-08T14:00:00Z',
      '2026-11-08T15:00:00Z',
    ]);
    expect(() => slices('2026-11-08T10:00', E, 2)).toThrow(/offset/);
  });

  it('keeps NO_DATA (silent controls), ZERO and FIRED apart', () => {
    const r = summarizeReceipts({
      days: ['2026-11-07', '2026-11-09'],
      rows: [
        { day: '2026-11-07', kind: 'control', feature: 'decide_nlh', layer: null, fires: 10 },
        {
          day: '2026-11-07',
          kind: 'bet',
          feature: 'river_bluff_baseline_junk',
          layer: 'junk',
          fires: 0,
        },
        { day: '2026-11-07', kind: 'bet', feature: 'v53_river_bluff', layer: 'V53', fires: 12 },
        { day: '2026-11-08', kind: 'control', feature: 'decide_nlh', layer: null, fires: 0 },
        {
          day: '2026-11-08',
          kind: 'bet',
          feature: 'river_bluff_baseline_junk',
          layer: 'junk',
          fires: 0,
        },
        {
          day: '2026-11-08',
          kind: 'bet',
          feature: 'river_lead_bluff_leadBlank',
          layer: 'lead',
          fires: 0,
        },
        {
          day: '2026-11-07',
          kind: 'other',
          feature: 'river_bluff_baseline_check',
          layer: null,
          fires: 40,
        },
      ],
    });
    expect(r.liveDays).toEqual(['2026-11-07']);
    expect(r.deadDays).toEqual(['2026-11-08', '2026-11-09']);
    const by = Object.fromEntries(r.layers.map((l) => [l.feature, l]));
    expect(by.river_bluff_baseline_junk.status).toBe('ZERO');
    expect(by.v53_river_bluff.status).toBe('FIRED');
    expect(by.v53_river_bluff.firstDay).toBe('2026-11-07');
    expect(by.river_lead_bluff_leadBlank.status).toBe('NO_DATA');
    expect(r.other).toEqual([{ feature: 'river_bluff_baseline_check', fires: 40 }]);
  });

  it('a report over no rows says NO DATA, never a zero rate', () => {
    const r = buildReport({
      window: ['2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z'],
      slices: [{ window: ['2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z'], cells: [] }],
      receipts: null,
    });
    expect(r.status).toBe('NO_DATA');
    expect(r.overall).toBeNull();
    expect(r.coverage.complete).toBe(true);
    const md = renderMarkdown(r);
    expect(md).toContain('## NO DATA');
    expect(md).toContain('NO DATA: no receipts result supplied.');
    expect(md).not.toMatch(/0\.0%/);
  });

  it('flags a live window where none of the new layers fired', () => {
    const r = buildReport({
      window: ['2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z'],
      slices: [{ window: ['2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z'], cells: [cell({})] }],
      receipts: {
        days: ['2026-11-08', '2026-11-08'],
        rows: [
          { day: '2026-11-08', kind: 'control', feature: 'decide_nlh', layer: null, fires: 5 },
          {
            day: '2026-11-08',
            kind: 'bet',
            feature: 'river_bluff_baseline_junk',
            layer: 'junk',
            fires: 0,
          },
        ],
      },
    });
    expect(r.status).toBe('DATA');
    expect(r.notes.join(' ')).toMatch(/No receipt of the new river bluff layers fired/);
    expect(renderMarkdown(r)).toContain('## By Variant');
  });
});

describe('river bluff live report: the default window', () => {
  const health = {
    releaseSha: '92e26a9fbf4b6646b18e43d5a9a79c68a1a15ca4',
    bootPhases: { processStartedAt: '2026-11-08T10:01:12.000Z' },
  };
  const now = '2026-11-08T13:00:00.123Z';

  it('starts at the boot that serves the commit, and refuses to guess otherwise', () => {
    expect(resolveWindow({ health, containsCommit: true, now })).toMatchObject({
      status: 'RELEASED',
      start: '2026-11-08T10:01:12Z',
      end: '2026-11-08T13:00:00Z',
    });
    expect(resolveWindow({ health, containsCommit: false, now }).status).toBe('NOT_RELEASED');
    expect(resolveWindow({ health, containsCommit: null, now }).status).toBe('UNKNOWN');
    expect(resolveWindow({ health: null, containsCommit: true, now }).status).toBe('UNKNOWN');
    expect(resolveWindow({ health: { releaseSha: 'zz' }, containsCommit: true, now }).status).toBe(
      'UNKNOWN'
    );
    const earlier = resolveWindow({
      health,
      containsCommit: true,
      now,
      firstBootStart: '2026-11-07T10:05:00Z',
    });
    expect(earlier).toMatchObject({ status: 'RELEASED', start: '2026-11-07T10:05:00Z' });
  });

  it('04:05 America/Chicago follows daylight saving time', () => {
    expect(chicagoReleaseInstant('2026-11-08')).toBe('2026-11-08T10:05:00Z');
    expect(chicagoReleaseInstant('2026-11-01')).toBe('2026-11-01T10:05:00Z');
    expect(chicagoReleaseInstant('2026-10-31')).toBe('2026-10-31T09:05:00Z');
    expect(chicagoReleaseInstant('2026-03-08')).toBe('2026-03-08T09:05:00Z');
    expect(chicagoReleaseInstant('2026-03-07')).toBe('2026-03-07T10:05:00Z');
    expect(() => chicagoReleaseInstant('2026-3-7')).toThrow();
  });
});

describe('river bluff live report: the statements only read', () => {
  it('the read-only check refuses writes, second statements and hidden literals', () => {
    expect(isReadOnlyStatement("select 1 from t where a = 'drop table x'")).toBe(true);
    expect(isReadOnlyStatement('-- delete\nwith a as (select 1) select * from a')).toBe(true);
    expect(isReadOnlyStatement('delete from t')).toBe(false);
    expect(isReadOnlyStatement('select 1; select 2')).toBe(false);
    expect(isReadOnlyStatement('select 1 into t2')).toBe(false);
    expect(isReadOnlyStatement('select $$x$$')).toBe(false);
    expect(isReadOnlyStatement("select E'\\x'")).toBe(false);
    expect(isReadOnlyStatement("select 'open")).toBe(false);
    expect(isReadOnlyStatement('select pg_sleep(1)')).toBe(false);
    expect(isReadOnlyStatement('select set_config(1)')).toBe(false);
  });

  it('both templates render to one bounded read-only statement with literal bounds', () => {
    const s = renderSpotsSql(SPOTS_SQL, '2026-11-08T10:05:00Z', '2026-11-08T12:05:00Z');
    expect(s).not.toMatch(/:START|:END/);
    expect(s).toContain("'2026-11-08T10:05:00Z'::timestamptz");
    expect(s).toContain("'2026-11-08T12:05:00Z'::timestamptz");
    expect(s).toContain("interval '3 days'");
    expect(s).toContain('limit 300');
    expect(isReadOnlyStatement(s)).toBe(true);
    const r = renderReceiptsSql(RECEIPTS_SQL, '2026-11-08', '2026-11-09');
    expect(r).toContain("'2026-11-08'::date");
    expect(isReadOnlyStatement(r)).toBe(true);
    for (const f of [
      'river_bluff_baseline_junk',
      'river_bluff_multiway_selected_3way',
      'river_lead_bluff_leadDraw',
      'river_bluff_hilo_scoop',
      'v54_river_bluff',
      'v53_river_scare_bluff',
    ])
      expect(r).toContain(`'${f}'`);
  });

  it('refuses unsafe or unbounded windows', () => {
    expect(() => renderSpotsSql(SPOTS_SQL, '2026-11-08T10:05:00', '2026-11-08T12:05:00Z')).toThrow(
      /offset/
    );
    expect(() =>
      renderSpotsSql(SPOTS_SQL, "2026-11-08T10:05:00Z'; drop", '2026-11-08T12:05:00Z')
    ).toThrow(/offset/);
    expect(() => renderSpotsSql(SPOTS_SQL, '2026-11-08T12:05:00Z', '2026-11-08T10:05:00Z')).toThrow(
      /after/
    );
    expect(() => renderSpotsSql(SPOTS_SQL, '2026-11-08T00:00:00Z', '2026-11-09T00:00:01Z')).toThrow(
      /24 hours/
    );
    expect(() => renderReceiptsSql(RECEIPTS_SQL, '2026-11-09', '2026-11-08')).toThrow(/precede/);
    expect(() => renderReceiptsSql(RECEIPTS_SQL, '2026-09-01', '2026-11-08')).toThrow(/62 days/);
  });
});

describe('river bluff live report: silent telemetry renders as no data', () => {
  it('a layer on a day without controls prints "-" and NO_DATA, never a 0 count', () => {
    const md = renderMarkdown(
      buildReport({
        window: ['2026-11-09T10:05:00Z', '2026-11-09T12:05:00Z'],
        slices: [{ window: ['2026-11-09T10:05:00Z', '2026-11-09T12:05:00Z'], cells: [] }],
        receipts: {
          days: ['2026-11-09', '2026-11-09'],
          rows: [
            {
              day: '2026-11-09',
              kind: 'bet',
              feature: 'river_bluff_baseline_junk',
              layer: 'junk',
              fires: 0,
            },
          ],
        },
      })
    );
    expect(md).toContain('| junk | river_bluff_baseline_junk | - | NO_DATA | - |');
    expect(md).toContain('Telemetry controls silent on 2026-11-09');
  });
});
