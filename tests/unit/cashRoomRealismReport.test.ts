/**
 * The cash-room realism report (scripts/ops/cash-room-realism-report.mjs):
 * its aggregation against a hand-checked fixture, its targets pinned to the
 * room's own rules in HorseBehavior.ts, and its read-only, no-identity shape.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CASH_SHAPE_MIX,
  SECOND_TABLE_RATE,
  MAX_HORSE_WAIT,
  aggregateRealism,
  bandFor,
  chicagoClock,
  gameRateClass,
  histogramMedian,
  rateForClass,
  realismQuery,
  realismSQL,
  realismWindow,
  renderText,
  runRealism,
} from '../../scripts/ops/cash-room-realism-report.mjs';
import * as HB from '../../server/src/services/HorseBehavior';

const SCRIPT = resolve(__dirname, '../../scripts/ops/cash-room-realism-report.mjs');

// 2026-11-07T01:00Z is Friday 19:00 in Chicago (CST): the weekend peak band.
const FIXTURE = {
  since: '2026-11-07T01:00:00+00:00',
  through: '2026-11-07T01:30:00+00:00',
  step_minutes: 15,
  samples: [
    {
      at: '2026-11-07T01:00:00+00:00',
      rate_class: 'popular',
      games_running: 4,
      games_two_tables: 2,
      games_full: 2,
      full_games_with_line: 1,
      full_games_line_total: 3,
      seated_people: 6,
      seated_horses: 24,
      capacity: 36,
      waiting_people: 2,
      waiting_horses: 1,
    },
    {
      at: '2026-11-07T01:00:00+00:00',
      rate_class: 'quarter',
      games_running: 2,
      games_two_tables: 0,
      games_full: 1,
      full_games_with_line: 1,
      full_games_line_total: 1,
      seated_people: 0,
      seated_horses: 10,
      capacity: 12,
      waiting_people: 0,
      waiting_horses: 1,
    },
  ],
  sessions: [
    {
      hour_start: '2026-11-07T01:00:00+00:00',
      horse: false,
      sessions: 2,
      minutes: 100,
      histogram: [0, 0, 0, 1, 1, 0, 0, 0],
    },
    {
      hour_start: '2026-11-07T01:00:00+00:00',
      horse: true,
      sessions: 4,
      minutes: 400,
      histogram: [0, 0, 0, 0, 2, 2, 0, 0],
    },
  ],
  table_events: [
    { hour_start: '2026-11-07T01:00:00+00:00', kind: 'open', n: 3 },
    { hour_start: '2026-11-07T01:00:00+00:00', kind: 'break', n: 1 },
  ],
};

describe('cash-room realism report: aggregation', () => {
  const report = aggregateRealism(FIXTURE);
  const fri19 = report.by_weekday_hour[4].hours[19];

  it('places the sample in Friday 19:00 Chicago, the peak band', () => {
    expect(chicagoClock(Date.parse(FIXTURE.samples[0].at))).toEqual({
      hour: 19,
      dow: 5,
      date: '2026-11-06',
    });
    expect(fri19.band).toBe('peak');
    expect(report.by_hour[19].sample_instants).toBe(2); // 01:00 and the empty 01:15
    expect(report.by_weekday[4].weekday).toBe('Fri');
  });

  it('fullness is seated over seats on running tables, split people / horses', () => {
    for (const cell of [report.by_hour[19], report.by_weekday[4], fri19, report.overall]) {
      expect(cell.fullness.actual).toBe(0.833); // 40 / 48
      expect(cell.fullness.people_share_of_seats).toBe(0.125); // 6 / 48
      expect(cell.fullness.horse_share_of_seats).toBe(0.708); // 34 / 48
      expect(cell.fullness.target_min).toBe(0.75);
      expect(cell.fullness.meets_target).toBe(true);
      expect(cell.fullness.avg_games_running).toBe(3); // 6 games over 2 instants
    }
  });

  it('full-game and second-table shares carry the band and per-game targets', () => {
    expect(fri19.full_games).toEqual({ actual: 0.5, target: 0.55 });
    // popular at peak = min(90, 91) = 90; quarter = floor(72 / 4) = 18
    // (4 x 90 + 2 x 18) / 100 / 6 = 0.66
    expect(fri19.second_table).toEqual({ actual: 0.333, target: 0.66 });
  });

  it('waiting lists: per instant, and whether a FULL game is showing a line', () => {
    expect(fri19.waiting_list).toMatchObject({
      avg_names_per_instant: 2,
      avg_people_per_instant: 1,
      avg_horses_per_instant: 1,
      full_games_showing_a_line: 0.667,
      full_games_showing_a_line_target: 1,
      avg_line_on_full_games: 1.33,
      avg_line_on_full_games_target: [1, 4],
    });
  });

  it('sessions: count, mean and the median bucket, people and horses apart', () => {
    expect(fri19.sessions.people).toEqual({
      sessions: 2,
      mean_minutes: 50,
      median_bucket: '30-60m',
    });
    expect(fri19.sessions.horses).toEqual({
      sessions: 4,
      mean_minutes: 100,
      median_bucket: '60-120m',
    });
    expect(histogramMedian([0, 0, 0, 0, 0, 0, 0, 1])).toBe('480m+');
    expect(histogramMedian([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('table opens and breaks, and per-day rates over the days the cell covers', () => {
    expect(fri19.tables).toEqual({ opens: 3, breaks: 1, opens_per_day: 3, breaks_per_day: 1 });
  });

  it('a Chicago weekday that spans two UTC dates counts as one day', () => {
    const friday = aggregateRealism({
      since: '2026-11-06T06:00:00+00:00', // Friday 00:00 CST
      through: '2026-11-07T06:00:00+00:00', // Saturday 00:00 CST
      step_minutes: 15,
      samples: [],
      sessions: [],
      table_events: [{ hour_start: '2026-11-07T01:00:00+00:00', kind: 'open', n: 24 }],
    });
    expect(friday.by_weekday[4].tables.opens_per_day).toBe(24);
    expect(friday.by_weekday[4].sample_instants).toBe(96);
  });

  it('an hour with no data reports nulls, never zeros dressed as measurements', () => {
    const empty = report.by_hour[10];
    expect(empty.sample_instants).toBe(0);
    expect(empty.fullness.actual).toBeNull();
    expect(empty.fullness.meets_target).toBeNull();
    expect(empty.second_table.actual).toBeNull();
  });

  it('renders a text table and rejects malformed input', () => {
    const text = renderText(report);
    expect(text).toContain('BY HOUR (Chicago)');
    expect(text).toContain('BY WEEKDAY');
    expect(text.split('\n').find((l) => l.startsWith('19:00'))).toContain('83%');
    expect(() => aggregateRealism({})).toThrow();
    expect(() =>
      aggregateRealism({ ...FIXTURE, samples: [{ ...FIXTURE.samples[0], rate_class: 'x' }] })
    ).toThrow();
    expect(() =>
      aggregateRealism({ ...FIXTURE, sessions: [{ ...FIXTURE.sessions[0], histogram: [1] }] })
    ).toThrow();
  });

  it('identifies no account: the output carries no id of any kind', () => {
    const out = JSON.stringify(report);
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(out).not.toMatch(/user_id|player_id|alias|display_name/);
  });
});

describe('cash-room realism report: targets are the room rules in HorseBehavior.ts', () => {
  it('copies the band tables exactly', () => {
    expect(CASH_SHAPE_MIX).toEqual(HB.CASH_SHAPE_MIX);
    expect(SECOND_TABLE_RATE).toEqual(HB.SECOND_TABLE_RATE);
    expect(MAX_HORSE_WAIT).toBe(HB.MAX_HORSE_WAIT);
  });

  it('the band clock agrees with roomBandAt for every hour of a week, both DST sides', () => {
    for (const start of [Date.parse('2026-10-26T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z')])
      for (let ms = start; ms < start + 7 * 86400000; ms += 3600000) {
        const { hour, dow } = chicagoClock(ms);
        expect(bandFor(dow, hour)).toBe(HB.roomBandAt(ms));
      }
  });

  it('the per-game rate class reproduces secondTableRateFor for every band and game', () => {
    const variants = [
      'nlh',
      'plo4',
      'plo5',
      'plo6',
      'plo8',
      'flh',
      'flo8',
      'short_deck',
      'pineapple',
      'other',
    ];
    const blinds = [0.1, 0.25, 1, 2, 3, 5, 10];
    for (const band of Object.keys(HB.SECOND_TABLE_RATE) as HB.RoomBand[])
      for (const v of variants)
        for (const bb of blinds)
          expect(rateForClass(band, gameRateClass(bb, v))).toBe(HB.secondTableRateFor(band, bb, v));
  });

  it('the SQL classifies games with the same variant lists and blind bounds', () => {
    const sql = realismQuery('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
    expect(sql).toContain("IN ('flh','flo8','plo8','short_deck','pineapple')");
    expect(sql).toContain("IN ('nlh','plo4','plo5','plo6')");
    expect(sql).toContain('coalesce(g.bb, 0) >= 5');
    expect(sql).toContain('g.bb >= 0.25 AND g.bb <= 2');
  });
});

describe('cash-room realism report: a read-only check, never a watcher', () => {
  it('the psql form is one READ ONLY transaction and the query writes nothing', () => {
    const sql = realismSQL('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
    expect(sql.startsWith('BEGIN READ ONLY;')).toBe(true);
    expect(sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|CALL)\b/i
    );
    expect(sql).not.toMatch(/\bnow\(\)|clock_timestamp/); // the window is explicit
  });

  it('refuses unbounded, reversed, off-grid and injected windows', () => {
    for (const [a, b] of [
      ["2026-11-01T00:00:00Z'; DELETE FROM profiles;--", '2026-11-02T00:00:00Z'],
      ['2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['2026-09-01T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['2026-11-01T00:07:00Z', '2026-11-02T00:00:00Z'],
      ['2026-02-30T00:00:00Z', '2026-03-02T00:00:00Z'],
    ])
      expect(() => realismWindow(a, b)).toThrow();
  });

  it('--api sends only the SELECT with read_only: true and aggregates the reply', async () => {
    let sent: { url: string; body: { query: string; read_only: boolean } } | null = null;
    const fetch = async (url: string, init: { body: string }) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, text: async () => JSON.stringify([{ report: JSON.stringify(FIXTURE) }]) };
    };
    const r = await runRealism(
      ['--api', '2026-11-07T01:00:00Z', '2026-11-07T01:30:00Z', '--json'],
      {
        fetch,
        env: { SUPABASE_ACCESS_TOKEN: 'token' },
      }
    );
    expect(r.code).toBe(0);
    expect(sent!.url).toBe(
      'https://api.supabase.com/v1/projects/kuklfnapbkmacvwxktbh/database/query'
    );
    expect(sent!.body.read_only).toBe(true);
    expect(sent!.body.query.startsWith('WITH params AS')).toBe(true);
    expect(JSON.parse(r.output).overall.fullness.actual).toBe(0.833);
  });

  it('a failure reports a stage code only, never provider text', async () => {
    const fetch = async () => ({ ok: false, text: async () => 'password=secret host=db' });
    const r = await runRealism(['--api', '2026-11-07T01:00:00Z', '2026-11-07T01:30:00Z'], {
      fetch,
      env: { SUPABASE_ACCESS_TOKEN: 'token' },
    });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.output)).toEqual({ ok: false, reason: 'query_failed' });
    const none = await runRealism(['--api', '2026-11-07T01:00:00Z', '2026-11-07T01:30:00Z'], {
      env: {},
    });
    expect(JSON.parse(none.output).reason).toBe('connection_configuration');
  });

  it('--from-json aggregates a saved reply', async () => {
    const r = await runRealism(['--from-json', 'saved.json'], {
      readFile: () => JSON.stringify(FIXTURE),
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain('BY WEEKDAY');
  });

  it('has no timer, schedule or alert of its own', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(
      /setInterval\(|setTimeout\(|node-cron|crontab|hooks\.slack|nodemailer|sendMail/i
    );
  });
});
