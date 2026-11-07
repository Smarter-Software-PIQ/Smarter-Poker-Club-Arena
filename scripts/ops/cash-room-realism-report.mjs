// scripts/ops/cash-room-realism-report.mjs
//
// THE CASH ROOM, MEASURED AGAINST ITS OWN TARGETS (owner request 2026-11-07).
//
// A read-only check an agent or the owner runs on demand. It is never a
// watcher: no schedule, no cron, no alert, no write. It reads production inside
// one `BEGIN READ ONLY` transaction and reports, per hour of the Chicago day and
// per weekday, for cash games:
//
//   - average table fullness (seated / max_players over tables with anyone seated)
//   - share of running games with a second table running
//   - waiting-list length (and, on FULL games, whether a line is showing)
//   - session length, seat to leave (cash_player_session opened_at -> closed_at)
//   - table opens and breaks (tables.opened_at / tables.break_started_at)
//
// each split people / horses as aggregate counts only. No account id, name or
// per-account figure ever leaves the query: the output says how many seats
// horses held, never which seats. It is still staff-only output; the horse flag
// is read from profiles.is_horse inside the database and summed there.
//
// Targets are the room's own rules in server/src/services/HorseBehavior.ts
// (#9875 "the room follows the clock"): the 75% seated floor, the FULL share
// per band (CASH_SHAPE_MIX), the second-table rate per band weighted by game
// (secondTableRateFor) and a FULL game's line of 1..4. The constants are copied
// here because this script runs under plain node;
// tests/unit/cashRoomRealismReport.test.ts pins every copy to HorseBehavior.ts.
//
// Usage:
//   node scripts/ops/cash-room-realism-report.mjs --sql <since-UTC> <through-UTC>
//       prints the read-only SQL (paste into any read-only SQL path)
//   node scripts/ops/cash-room-realism-report.mjs --run <since-UTC> <through-UTC>
//       runs it through psql with the same environment-only libpq handoff as
//       scripts/horse-human-scoreboard.mjs (PGDATABASE / PGSERVICE)
//   node scripts/ops/cash-room-realism-report.mjs --api <since-UTC> <through-UTC>
//       sends the single SELECT to the Supabase management API with
//       read_only: true (SUPABASE_ACCESS_TOKEN; SUPABASE_PROJECT_REF optional),
//       the read-only path scripts/horse-measure/TUNING.md documents
//   node scripts/ops/cash-room-realism-report.mjs --from-json <file|->
//       aggregates the one JSON object the SQL returns, produced elsewhere
//   add --json to print only the JSON report (default: text table, then JSON)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scoreboardConnectionEnvironment } from '../horse-human-scoreboard.mjs';

// ── Targets (mirrors of HorseBehavior.ts, pinned by the unit test) ─────────────
export const MIN_SEATED_FRACTION = 0.75;
export const MAX_HORSE_WAIT = 5;
/** A FULL game keeps 1..4 names on its line (HorseBehavior FULL shape). */
export const FULL_LINE_RANGE = Object.freeze([1, 4]);
export const CASH_SHAPE_MIX = Object.freeze({
  peak: { full: 0.55, short: 0.33 },
  evening: { full: 0.5, short: 0.35 },
  day: { full: 0.4, short: 0.4 },
  late: { full: 0.3, short: 0.45 },
  early: { full: 0.25, short: 0.45 },
  dawn: { full: 0.22, short: 0.45 },
});
export const SECOND_TABLE_RATE = Object.freeze({
  peak: 70,
  evening: 60,
  day: 50,
  late: 30,
  early: 20,
  dawn: 15,
});
const POPULAR_VARIANTS = new Set(['nlh', 'plo4', 'plo5', 'plo6']);
const NICHE_VARIANTS = new Set(['flh', 'flo8', 'plo8', 'short_deck', 'pineapple']);

/** The SQL groups games into these, by the same test secondTableRateFor uses. */
export function gameRateClass(bigBlind, variant) {
  const bb = Number(bigBlind) || 0;
  const v = String(variant ?? '').toLowerCase();
  if (bb >= 5 || NICHE_VARIANTS.has(v)) return 'quarter';
  if (bb >= 0.25 && bb <= 2 && POPULAR_VARIANTS.has(v)) return 'popular';
  return 'base';
}

/** Same integer arithmetic as HorseBehavior.secondTableRateFor. */
export function rateForClass(band, rateClass) {
  const base = SECOND_TABLE_RATE[band];
  if (rateClass === 'quarter') return Math.floor((base + 2) / 4);
  if (rateClass === 'popular') return Math.min(90, Math.floor((base * 13 + 5) / 10));
  return base;
}

// ── Chicago clock (same definitions as HorseBehavior.roomBandAt) ──────────────
const chicagoFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});
const chicagoDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const ISO_DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function chicagoClock(ms) {
  const parts = Object.fromEntries(
    chicagoFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value])
  );
  return {
    hour: Number(parts.hour) % 24,
    dow: ISO_DOW[parts.weekday],
    date: chicagoDateFmt.format(new Date(ms)),
  };
}

export function bandFor(dow, hour) {
  if ((dow === 5 || dow === 6) && hour >= 18) return 'peak';
  if ((dow === 6 || dow === 7) && hour < 4) return 'peak';
  if (hour >= 18) return 'evening';
  if (hour >= 10) return 'day';
  if (hour >= 4) return dow <= 4 ? 'dawn' : 'early';
  return 'late';
}

// ── Window and SQL ────────────────────────────────────────────────────────────
export const STEP_MINUTES = 15;
const MAX_WINDOW_DAYS = 28;
/** Session-length histogram edges in minutes; the last bucket is open-ended. */
export const SESSION_EDGES = [5, 15, 30, 60, 120, 240, 480];

function instant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw Error('Explicit UTC timestamps required (YYYY-MM-DDTHH:MM:SSZ)');
  return value;
}

export function realismWindow(since, through) {
  const a = instant(since);
  const b = instant(through);
  const span = Date.parse(b) - Date.parse(a);
  if (span <= 0 || span > MAX_WINDOW_DAYS * 86400000)
    throw Error(`Window must be positive and at most ${MAX_WINDOW_DAYS} days`);
  if (Date.parse(a) % (STEP_MINUTES * 60000) !== 0)
    throw Error(`since must sit on a ${STEP_MINUTES}-minute boundary`);
  return { since: a, through: b };
}

/** psql form: the query inside one read-only transaction. */
export function realismSQL(since, through) {
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '60000ms';
${realismQuery(since, through)};
COMMIT;
`;
}

/** The single read-only SELECT (management-API form sends it with read_only: true). */
export function realismQuery(since, through) {
  const w = realismWindow(since, through);
  const edges = SESSION_EDGES.join(', ');
  return `WITH params AS (
  SELECT timestamptz '${w.since}' AS since, timestamptz '${w.through}' AS through,
         interval '${STEP_MINUTES} minutes' AS step),
games AS (
  SELECT g.id, CASE
           WHEN coalesce(g.bb, 0) >= 5 OR lower(coalesce(g.variant, '')) IN ('flh','flo8','plo8','short_deck','pineapple') THEN 'quarter'
           WHEN g.bb >= 0.25 AND g.bb <= 2 AND lower(coalesce(g.variant, '')) IN ('nlh','plo4','plo5','plo6') THEN 'popular'
           ELSE 'base' END AS rate_class
    FROM public.cash_games g),
seats AS MATERIALIZED (
  SELECT c.table_id, t.cluster_id AS game_id, coalesce(t.max_players, 9) AS max_players,
         coalesce(p.is_horse, false) AS horse, c.opened_at, c.closed_at
    FROM public.cash_player_session c
    JOIN public.tables t ON t.id = c.table_id AND t.cluster_id IS NOT NULL
    LEFT JOIN public.profiles p ON p.id = c.player_id
    CROSS JOIN params
   WHERE c.scope_type = 'table' AND c.opened_at < params.through
     AND coalesce(c.closed_at, 'infinity') > params.since),
occ AS (
  SELECT g.at, s.game_id, s.table_id, max(s.max_players) AS max_players,
         count(*) FILTER (WHERE NOT s.horse) AS people, count(*) FILTER (WHERE s.horse) AS horses
    FROM seats s CROSS JOIN params
    CROSS JOIN LATERAL generate_series(
      date_bin(params.step, greatest(s.opened_at, params.since) - interval '1 microsecond', params.since) + params.step,
      least(coalesce(s.closed_at, params.through), params.through) - interval '1 microsecond',
      params.step) AS g(at)
   GROUP BY 1, 2, 3),
per_game AS (
  SELECT at, game_id, count(*) AS tables_running, sum(people) AS people, sum(horses) AS horses,
         sum(max_players) AS capacity, bool_and(people + horses >= max_players) AS full_game
    FROM occ GROUP BY 1, 2),
samples AS (
  SELECT generate_series(params.since, params.through - interval '1 microsecond', params.step) AS at FROM params),
line AS (
  SELECT w.game_id, coalesce(p.is_horse, false) AS horse, w.created_at,
         CASE WHEN w.status = 'waiting' THEN NULL ELSE w.updated_at END AS ended_at
    FROM public.cash_game_waitlist w LEFT JOIN public.profiles p ON p.id = w.user_id CROSS JOIN params
   WHERE w.created_at < params.through
     AND coalesce(CASE WHEN w.status = 'waiting' THEN NULL ELSE w.updated_at END, 'infinity') > params.since),
line_at AS (
  SELECT s.at, l.game_id, count(*) FILTER (WHERE NOT l.horse) AS waiting_people,
         count(*) FILTER (WHERE l.horse) AS waiting_horses
    FROM line l JOIN samples s ON s.at >= l.created_at AND s.at < coalesce(l.ended_at, 'infinity')
   GROUP BY 1, 2),
joined AS (
  SELECT coalesce(pg.at, la.at) AS at, coalesce(pg.game_id, la.game_id) AS game_id,
         coalesce(pg.tables_running, 0) AS tables_running, coalesce(pg.people, 0) AS people,
         coalesce(pg.horses, 0) AS horses, coalesce(pg.capacity, 0) AS capacity,
         coalesce(pg.full_game, false) AS full_game,
         coalesce(la.waiting_people, 0) AS waiting_people, coalesce(la.waiting_horses, 0) AS waiting_horses
    FROM per_game pg FULL JOIN line_at la ON la.at = pg.at AND la.game_id = pg.game_id),
sample_rows AS (
  SELECT j.at, coalesce(gm.rate_class, 'base') AS rate_class,
         count(*) FILTER (WHERE j.tables_running > 0) AS games_running,
         count(*) FILTER (WHERE j.tables_running >= 2) AS games_two_tables,
         count(*) FILTER (WHERE j.full_game) AS games_full,
         count(*) FILTER (WHERE j.full_game AND j.waiting_people + j.waiting_horses > 0) AS full_games_with_line,
         coalesce(sum(j.waiting_people + j.waiting_horses) FILTER (WHERE j.full_game), 0) AS full_games_line_total,
         sum(j.people) AS seated_people, sum(j.horses) AS seated_horses, sum(j.capacity) AS capacity,
         sum(j.waiting_people) AS waiting_people, sum(j.waiting_horses) AS waiting_horses
    FROM joined j LEFT JOIN games gm ON gm.id = j.game_id
   GROUP BY 1, 2),
session_rows AS (
  SELECT date_trunc('hour', c.opened_at) AS hour_start, coalesce(p.is_horse, false) AS horse,
         count(*) AS sessions, sum(extract(epoch FROM c.closed_at - c.opened_at) / 60.0) AS minutes,
         array_agg(width_bucket(extract(epoch FROM c.closed_at - c.opened_at) / 60.0,
                                ARRAY[${edges}]::numeric[])) AS buckets
    FROM public.cash_player_session c
    JOIN public.tables t ON t.id = c.table_id AND t.cluster_id IS NOT NULL
    LEFT JOIN public.profiles p ON p.id = c.player_id
    CROSS JOIN params
   WHERE c.scope_type = 'table' AND c.opened_at >= params.since AND c.opened_at < params.through
     AND c.closed_at IS NOT NULL
   GROUP BY 1, 2),
session_hist AS (
  SELECT hour_start, horse, sessions, minutes,
         (SELECT array_agg(coalesce(n, 0) ORDER BY b)
            FROM generate_series(0, ${SESSION_EDGES.length}) b
            LEFT JOIN (SELECT x AS bucket, count(*) AS n FROM unnest(buckets) x GROUP BY x) h ON h.bucket = b) AS histogram
    FROM session_rows),
table_events AS (
  SELECT date_trunc('hour', e.at) AS hour_start, e.kind, count(*) AS n
    FROM (
      SELECT t.opened_at AS at, 'open' AS kind FROM public.tables t WHERE t.cluster_id IS NOT NULL
      UNION ALL
      SELECT t.break_started_at, 'break' FROM public.tables t WHERE t.cluster_id IS NOT NULL
    ) e CROSS JOIN params
   WHERE e.at >= params.since AND e.at < params.through
   GROUP BY 1, 2)
SELECT jsonb_build_object(
  'since', (SELECT since FROM params), 'through', (SELECT through FROM params),
  'step_minutes', ${STEP_MINUTES},
  'session_edges_minutes', jsonb_build_array(${edges}),
  'sample_instants', (SELECT count(*) FROM samples),
  'samples', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.at, r.rate_class) FROM sample_rows r), '[]'::jsonb),
  'sessions', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hour_start, r.horse) FROM session_hist r), '[]'::jsonb),
  'table_events', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hour_start, r.kind) FROM table_events r), '[]'::jsonb)
)::text AS report`;
}

// ── Aggregation (pure; tested with a fixture) ─────────────────────────────────
const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw Error('Invalid number in report input');
  return n;
};
const ratio = (a, b) => (b > 0 ? a / b : null);
const round = (v, d = 3) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function emptyCell() {
  return {
    instants: new Set(),
    games_running: 0,
    games_two_tables: 0,
    games_full: 0,
    full_games_with_line: 0,
    full_games_line_total: 0,
    seated_people: 0,
    seated_horses: 0,
    capacity: 0,
    waiting_people: 0,
    waiting_horses: 0,
    second_table_target_x100: 0,
    full_target_sum: 0,
    sessions: { people: emptySessions(), horses: emptySessions() },
    opens: 0,
    breaks: 0,
    eventDays: new Set(),
  };
}
function emptySessions() {
  return { count: 0, minutes: 0, histogram: new Array(SESSION_EDGES.length + 1).fill(0) };
}

/** Median from a histogram, reported as the bucket it falls in. */
export function histogramMedian(histogram, edges = SESSION_EDGES) {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen * 2 >= total) {
      const lo = i === 0 ? 0 : edges[i - 1];
      return i < edges.length ? `${lo}-${edges[i]}m` : `${lo}m+`;
    }
  }
  return null;
}

function finishCell(c) {
  const seated = c.seated_people + c.seated_horses;
  const waiting = c.waiting_people + c.waiting_horses;
  const n = c.instants.size;
  const sess = (s) => ({
    sessions: s.count,
    mean_minutes: round(ratio(s.minutes, s.count), 1),
    median_bucket: histogramMedian(s.histogram),
  });
  return {
    sample_instants: n,
    fullness: {
      actual: round(ratio(seated, c.capacity)),
      target_min: MIN_SEATED_FRACTION,
      meets_target: c.capacity > 0 ? seated / c.capacity >= MIN_SEATED_FRACTION : null,
      people_share_of_seats: round(ratio(c.seated_people, c.capacity)),
      horse_share_of_seats: round(ratio(c.seated_horses, c.capacity)),
      avg_games_running: round(ratio(c.games_running, n), 1),
    },
    full_games: {
      actual: round(ratio(c.games_full, c.games_running)),
      target: round(ratio(c.full_target_sum, c.games_running)),
    },
    second_table: {
      actual: round(ratio(c.games_two_tables, c.games_running)),
      target: round(ratio(c.second_table_target_x100 / 100, c.games_running)),
    },
    waiting_list: {
      avg_names_per_instant: round(ratio(waiting, n), 2),
      avg_people_per_instant: round(ratio(c.waiting_people, n), 2),
      avg_horses_per_instant: round(ratio(c.waiting_horses, n), 2),
      full_games_showing_a_line: round(ratio(c.full_games_with_line, c.games_full)),
      full_games_showing_a_line_target: 1,
      avg_line_on_full_games: round(ratio(c.full_games_line_total, c.games_full), 2),
      avg_line_on_full_games_target: FULL_LINE_RANGE,
    },
    sessions: { people: sess(c.sessions.people), horses: sess(c.sessions.horses) },
    tables: {
      opens: c.opens,
      breaks: c.breaks,
      opens_per_day: round(ratio(c.opens, c.eventDays.size), 1),
      breaks_per_day: round(ratio(c.breaks, c.eventDays.size), 1),
    },
  };
}

/**
 * Aggregate the one JSON object realismSQL returns into per-hour, per-weekday
 * and hour x weekday cells, each with target vs actual.
 */
export function aggregateRealism(raw) {
  if (!raw || !Array.isArray(raw.samples) || !Array.isArray(raw.sessions))
    throw Error('Report input is not the realism query output');
  const byHour = Array.from({ length: 24 }, emptyCell);
  const byDow = Array.from({ length: 7 }, emptyCell);
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyCell));
  const overall = emptyCell();
  const cellsAt = (ms) => {
    const { hour, dow, date } = chicagoClock(ms);
    return {
      hour,
      dow,
      band: bandFor(dow, hour),
      day: date, // the Chicago calendar day, so a weekday is one day, not two UTC dates
      cells: [byHour[hour], byDow[dow - 1], matrix[dow - 1][hour], overall],
    };
  };

  for (const s of raw.samples) {
    const ms = Date.parse(s.at);
    if (!Number.isFinite(ms)) throw Error('Invalid sample instant');
    const cls = s.rate_class;
    if (!['popular', 'base', 'quarter'].includes(cls)) throw Error('Invalid rate class');
    const { band, cells } = cellsAt(ms);
    const running = num(s.games_running);
    for (const c of cells) {
      c.instants.add(ms);
      c.games_running += running;
      c.games_two_tables += num(s.games_two_tables);
      c.games_full += num(s.games_full);
      c.full_games_with_line += num(s.full_games_with_line);
      c.full_games_line_total += num(s.full_games_line_total);
      c.seated_people += num(s.seated_people);
      c.seated_horses += num(s.seated_horses);
      c.capacity += num(s.capacity);
      c.waiting_people += num(s.waiting_people);
      c.waiting_horses += num(s.waiting_horses);
      c.second_table_target_x100 += running * rateForClass(band, cls);
      c.full_target_sum += running * CASH_SHAPE_MIX[band].full;
    }
  }
  // Instants with no game running still count as instants (the room was empty).
  const step = num(raw.step_minutes ?? STEP_MINUTES) * 60000;
  if (raw.since && raw.through) {
    for (let ms = Date.parse(raw.since); ms < Date.parse(raw.through); ms += step)
      for (const c of cellsAt(ms).cells) c.instants.add(ms);
  }

  for (const s of raw.sessions) {
    const ms = Date.parse(s.hour_start);
    if (!Number.isFinite(ms)) throw Error('Invalid session hour');
    const hist = s.histogram;
    if (!Array.isArray(hist) || hist.length !== SESSION_EDGES.length + 1)
      throw Error('Invalid session histogram');
    const who = s.horse === true ? 'horses' : s.horse === false ? 'people' : null;
    if (!who) throw Error('Invalid session cohort');
    for (const c of cellsAt(ms).cells) {
      const t = c.sessions[who];
      t.count += num(s.sessions);
      t.minutes += num(s.minutes);
      hist.forEach((v, i) => (t.histogram[i] += num(v)));
    }
  }

  for (const e of raw.table_events ?? []) {
    const ms = Date.parse(e.hour_start);
    if (!Number.isFinite(ms)) throw Error('Invalid table event hour');
    if (!['open', 'break'].includes(e.kind)) throw Error('Invalid table event kind');
    for (const c of cellsAt(ms).cells) {
      if (e.kind === 'open') c.opens += num(e.n);
      else c.breaks += num(e.n);
    }
  }
  // Per-day rates divide by the calendar days the window covers in that cell.
  if (raw.since && raw.through) {
    for (let ms = Date.parse(raw.since); ms < Date.parse(raw.through); ms += 3600000) {
      const { day, cells } = cellsAt(ms);
      for (const c of cells) c.eventDays.add(day);
    }
  }

  return {
    report: 'cash-room-realism',
    since: raw.since ?? null,
    through: raw.through ?? null,
    step_minutes: raw.step_minutes ?? STEP_MINUTES,
    timezone: 'America/Chicago',
    targets_source: 'server/src/services/HorseBehavior.ts (#9875)',
    notes: [
      'fullness = seated / max_players over cash tables with at least one seat taken',
      'second table = a running game with two or more tables seated at the instant',
      'targets are per-instant weighted: the band (peak/evening/day/late/early/dawn) and each game rate class (secondTableRateFor)',
      'waiting-list rows count from created_at until updated_at once no longer waiting',
      'people/horses are aggregate counts only; no account is identified',
    ],
    overall: finishCell(overall),
    by_hour: byHour.map((c, hour) => ({ hour, ...finishCell(c) })),
    by_weekday: byDow.map((c, i) => ({ weekday: WEEKDAYS[i], ...finishCell(c) })),
    by_weekday_hour: matrix.map((row, i) => ({
      weekday: WEEKDAYS[i],
      hours: row.map((c, hour) => ({ hour, band: bandFor(i + 1, hour), ...finishCell(c) })),
    })),
  };
}

// ── Text table ────────────────────────────────────────────────────────────────
const pct = (v) => (v === null || v === undefined ? '   -' : `${Math.round(v * 100)}%`.padStart(4));
const fix = (v, w = 5) => (v === null || v === undefined ? '-' : String(v)).padStart(w);

export function renderText(report) {
  const head =
    'slot      fill/75%  ppl hrs  full/tgt  2nd/tgt  wait(p/h)  fullLine  sessP(n,mean)   sessH(n,mean)  open brk /day';
  const row = (label, c) =>
    [
      label.padEnd(9),
      `${pct(c.fullness.actual)}${c.fullness.meets_target === false ? '!' : ' '}`.padStart(9),
      pct(c.fullness.people_share_of_seats),
      pct(c.fullness.horse_share_of_seats),
      ` ${pct(c.full_games.actual)}/${pct(c.full_games.target)}`,
      ` ${pct(c.second_table.actual)}/${pct(c.second_table.target)}`,
      `  ${fix(c.waiting_list.avg_people_per_instant, 4)}/${fix(c.waiting_list.avg_horses_per_instant, 4)}`,
      `  ${pct(c.waiting_list.full_games_showing_a_line)}`,
      `   ${fix(c.sessions.people.sessions, 6)},${fix(c.sessions.people.mean_minutes, 6)}`,
      `  ${fix(c.sessions.horses.sessions, 6)},${fix(c.sessions.horses.mean_minutes, 6)}`,
      `  ${fix(c.tables.opens_per_day, 4)} ${fix(c.tables.breaks_per_day, 4)}`,
    ].join(' ');
  const lines = [
    `Cash room realism ${report.since} -> ${report.through} (Chicago time, ${report.step_minutes}-min samples)`,
    `targets: ${report.targets_source}; '!' = below the 75% seated floor`,
    '',
    'BY HOUR (Chicago)',
    head,
    ...report.by_hour.map((c) => row(`${String(c.hour).padStart(2, '0')}:00`, c)),
    '',
    'BY WEEKDAY',
    head,
    ...report.by_weekday.map((c) => row(c.weekday, c)),
    '',
    row('OVERALL', report.overall),
    '',
  ];
  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
/** The production project; --api reads it through the management API, read-only. */
export const DEFAULT_PROJECT_REF = 'kuklfnapbkmacvwxktbh';

export function parseRaw(text) {
  let value = JSON.parse(String(text).trim());
  // Management API: [{ report: "<json text>" }]; psql -At: the json text itself.
  if (Array.isArray(value)) {
    if (value.length !== 1 || typeof value[0]?.report !== 'string')
      throw Error('Unexpected query response shape');
    value = JSON.parse(value[0].report);
  }
  return value;
}

const USAGE =
  'Usage: node scripts/ops/cash-room-realism-report.mjs --sql|--run|--api <since-UTC> <through-UTC> [--json]\n' +
  '       node scripts/ops/cash-room-realism-report.mjs --from-json <file|-> [--json]\n' +
  '  --run  psql, environment-only libpq handoff (PGDATABASE/PGSERVICE)\n' +
  '  --api  Supabase management API, read_only: true (SUPABASE_ACCESS_TOKEN; SUPABASE_PROJECT_REF optional)\n';

export async function runRealism(args, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const env = io.env ?? process.env;
  const json = args.includes('--json');
  const rest = args.filter((a) => a !== '--json');
  const finish = (raw) => {
    const report = aggregateRealism(raw);
    const out = JSON.stringify(report, null, 2) + '\n';
    return { code: 0, output: json ? out : renderText(report) + '\n' + out };
  };
  // Only stage codes leave on failure: provider text may carry connection details.
  let reason = 'invalid_input';
  try {
    if (rest[0] === '--from-json' && rest.length === 2) {
      reason = 'invalid_report_input';
      return finish(parseRaw(readFile(rest[1] === '-' ? 0 : rest[1])));
    }
    if (rest.length !== 3 || !['--sql', '--run', '--api'].includes(rest[0]))
      return { code: 64, output: USAGE };
    const sql = realismSQL(rest[1], rest[2]);
    if (rest[0] === '--sql') return { code: 0, output: sql };
    if (rest[0] === '--api') {
      reason = 'connection_configuration';
      const token = env.SUPABASE_ACCESS_TOKEN;
      const ref = env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
      if (!token || !/^[a-z0-9]{20}$/.test(ref)) throw Error('config');
      reason = 'query_failed';
      const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: realismQuery(rest[1], rest[2]), read_only: true }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw Error('http');
      reason = 'query_response';
      return finish(parseRaw(await res.text()));
    }
    reason = 'connection_configuration';
    const pgEnv = {
      ...scoreboardConnectionEnvironment(env),
      PGAPPNAME: 'cash-room-realism-report',
    };
    reason = 'query_failed';
    const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      env: pgEnv,
      input: sql,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw Error('psql');
    reason = 'query_response';
    const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith('{'));
    return finish(parseRaw(line ?? ''));
  } catch {
    return { code: 1, output: JSON.stringify({ ok: false, reason }) + '\n' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRealism(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exitCode = result.code;
}
