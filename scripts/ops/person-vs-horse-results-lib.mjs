/**
 * People vs Horses results: are real people winning or losing against the Horses, per game, and
 * is the difference bigger than luck?
 *
 * Pure functions only (no I/O). The CLI (person-vs-horse-results.mjs) runs one read-only query and
 * hands its JSON to buildReport. Method, verified meaning of `profit`, the fixed verdict rules and
 * the limits are written down in docs/ops/person-vs-horse-results.md; keep the two in step.
 *
 * What is counted: one row per person per hand ("person-hand"), for people (profiles.is_horse is
 * not true) whose profile is not marked deleted, in hands where at least one Horse was dealt in
 * (fewer people in the hand than players dealt). The hands and who sat in them come from
 * hand_history (has_human hands only); each person's result is ca_hand_facts.net, the net chips
 * for the hand after rake, divided by the hand's big blind.
 *
 * Never ca_hand_player_stat: it keeps only each player's newest ~1,000 hands, so a past window
 * shrinks as people keep playing. Never ca_hand_player_facts either: it leaves out bomb-pot antes
 * and books a blind nobody posted in a bomb pot. ca_hand_facts is written once per hand by the
 * hand_history trigger, is never pruned, and its `invested` sums to the stored pot on every hand
 * checked. assertSourceComplete stops the report (exit 70) if it ever holds fewer person-hands
 * than hand_history says were played.
 *
 * Luck: hands of one person in one sitting are not independent, so the standard error of bb/100 is
 * computed by clustering on person-session (one person, one game, cash or tournament, hands no
 * more than SESSION_GAP_MINUTES apart, never crossing a split instant).
 *
 * Privacy: the query returns sums per person-session. A person is an opaque number plus the first
 * four characters of the account id; no name, full account id, hand id or card leaves the database.
 */

export const DEFAULT_RANGE_DAYS = 7;
export const MAX_RANGE_DAYS = 92;
export const MAX_SPLITS = 8;
export const SESSION_GAP_MINUTES = 30;
export const STATEMENT_TIMEOUT_SECONDS = 60;

/** Fixed verdict rules. Changing one changes a standing gate: update the doc and the tests. */
export const MIN_HANDS_PER_WINDOW = 2000;
export const MAX_TOP_PERSON_SHARE = 0.6;
export const Z_THRESHOLD = 2;
export const CI_Z = 1.96;

export const MODES = Object.freeze(['cash', 'tournament', 'all']);
export const BY_DIMENSIONS = Object.freeze(['day', 'hour', 'player', 'stake', 'table-size']);

export const VERDICT_TEXT = Object.freeze({
  too_few: 'too few hands to judge',
  no_change: 'no measurable change',
  better: 'people doing better than before',
  worse: 'people doing worse than before',
});

export const GATE_CLEAN = 0;
export const GATE_PEOPLE_BETTER = 1;
export const GATE_TOO_FEW = 2;
export const EXIT_USAGE = 64;
export const EXIT_FAILED = 70;

const GAME_RE = /^[a-z0-9_]{1,24}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const DAY_MS = 86_400_000;

// ── Options ────────────────────────────────────────────────────────────────────────────────────

/** A full ISO instant with an explicit zone -> epoch ms. Anything else is refused. */
export function parseInstant(name, raw) {
  const text = String(raw ?? '').trim();
  if (!ISO_RE.test(text)) {
    throw new Error(`${name} must be an ISO instant with a zone, such as 2026-11-22T03:13:56Z`);
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${name} is not a valid instant: ${text}`);
  return ms;
}

/** Epoch ms -> the UTC text used in SQL and in the report (seconds when there are no millis). */
export function isoUtc(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function parseGames(raw) {
  const games = String(raw ?? '')
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
  if (games.length === 0) throw new Error('--games needs at least one game, such as plo5');
  for (const g of games) {
    if (!GAME_RE.test(g)) throw new Error(`--games has an invalid game name: ${g}`);
  }
  return [...new Set(games)].sort();
}

/**
 * Resolve parsed arguments into a checked query plan. `nowMs` is injected so a run is repeatable.
 */
export function resolvePlan(
  { since = null, until = null, games = null, mode = 'all', splitAt = [], by = null } = {},
  nowMs = Date.now()
) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  if (by !== null && !BY_DIMENSIONS.includes(by)) {
    throw new Error(`--by must be one of ${BY_DIMENSIONS.join(', ')}`);
  }
  const untilMs = until === null ? nowMs : until;
  const sinceMs = since === null ? untilMs - DEFAULT_RANGE_DAYS * DAY_MS : since;
  if (!(sinceMs < untilMs)) throw new Error('--since must be earlier than --until');
  if (untilMs - sinceMs > MAX_RANGE_DAYS * DAY_MS) {
    throw new Error(`the time range may not be longer than ${MAX_RANGE_DAYS} days`);
  }
  const splits = [...new Set(splitAt)].sort((a, b) => a - b);
  if (splits.length > MAX_SPLITS)
    throw new Error(`--split-at takes at most ${MAX_SPLITS} instants`);
  for (const s of splits) {
    if (!(s > sinceMs && s < untilMs)) {
      throw new Error(`--split-at ${isoUtc(s)} must lie strictly between --since and --until`);
    }
  }
  return {
    sinceMs,
    untilMs,
    splits,
    mode,
    games: games === null ? null : [...games],
    by,
  };
}

// ── The single read-only query ─────────────────────────────────────────────────────────────────

function sqlInstant(ms) {
  const text = isoUtc(ms);
  if (!/^[0-9T:.Z-]+$/.test(text)) throw new Error('unexpected instant text');
  return `TIMESTAMPTZ '${text}'`;
}

function dimensionSql(by) {
  switch (by) {
    case null:
      return `''`;
    case 'day':
      return `to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    case 'hour':
      return `to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24') || ':00'`;
    case 'player':
      return `(dense_rank() OVER (ORDER BY s.user_id))::text`;
    case 'stake':
      return `(s.big_blind::float8)::text`;
    case 'table-size':
      return `s.n_players::text`;
    default:
      throw new Error(`unknown --by dimension: ${by}`);
  }
}

/**
 * One WITH ... SELECT, bounded by [since, until) on hand_history.created_at and only over has_human
 * hands (a partial index), filtered to the asked mode and games before anything else is read. Who
 * sat in each hand comes from hand_history.players; each person's result is looked up in
 * ca_hand_facts by its primary key (hand_id, user_id). Everything is summed in SQL to one row per
 * person-session and breakdown value, plus the person-hand count hand_history expects and the
 * count ca_hand_facts holds, for assertSourceComplete.
 *
 * The ca_hand_facts lookup is a LATERAL primary-key probe on purpose: ca_hand_facts has over 100
 * million rows, and as a plain join the planner (which overestimates the seated rows a hundredfold)
 * hashes the whole table and runs past the statement timeout.
 */
export function buildResultsSql(plan) {
  const { sinceMs, untilMs, splits, mode, games, by } = plan;
  if (!(Number.isFinite(sinceMs) && Number.isFinite(untilMs) && sinceMs < untilMs)) {
    throw new Error('the query needs a time range');
  }
  if (untilMs - sinceMs > MAX_RANGE_DAYS * DAY_MS) {
    throw new Error(`the time range may not be longer than ${MAX_RANGE_DAYS} days`);
  }
  const filters = [];
  if (mode === 'cash') filters.push('AND h.tournament_id IS NULL');
  else if (mode === 'tournament') filters.push('AND h.tournament_id IS NOT NULL');
  else if (mode !== 'all') throw new Error(`unknown mode: ${mode}`);
  if (games !== null) {
    if (!Array.isArray(games) || games.length === 0) throw new Error('games must not be empty');
    for (const g of games) if (!GAME_RE.test(g)) throw new Error(`invalid game name: ${g}`);
    filters.push(
      `AND lower(coalesce(h.game_variant, 'nlh')) IN (${games.map((g) => `'${g}'`).join(', ')})`
    );
  }
  const windowSql =
    splits.length === 0
      ? '0'
      : splits
          .map((s) => `CASE WHEN m.created_at >= ${sqlInstant(s)} THEN 1 ELSE 0 END`)
          .join(' + ');
  const agg = (cols) => `coalesce(jsonb_agg(jsonb_build_object(${cols})), '[]'::jsonb)`;
  return `WITH people AS MATERIALIZED (
  SELECT id, (status IS DISTINCT FROM 'deleted') AS counted
  FROM public.profiles
  WHERE is_horse IS NOT TRUE
), dealt AS MATERIALIZED (
  SELECT h.id AS hand_id, h.created_at, (h.tournament_id IS NULL) AS is_cash,
         lower(coalesce(h.game_variant, 'nlh')) AS game_variant,
         coalesce(h.big_blind, 0)::numeric AS big_blind,
         jsonb_array_length(coalesce(h.players, '[]'::jsonb)) AS n_players, h.players
  FROM public.hand_history h
  WHERE h.has_human
    AND h.created_at >= ${sqlInstant(sinceMs)} AND h.created_at < ${sqlInstant(untilMs)}
    ${filters.join('\n    ')}
), seated AS MATERIALIZED (
  SELECT DISTINCT d.hand_id, d.created_at, d.is_cash, d.game_variant, d.big_blind, d.n_players,
         p.id AS user_id, p.counted
  FROM dealt d
  CROSS JOIN LATERAL jsonb_array_elements(d.players) e
  JOIN people p ON p.id::text = e->>'userId'
), picked AS MATERIALIZED (
  SELECT s.*, f.net AS profit, f.went_to_showdown AS showdown, (f.hand_id IS NOT NULL) AS in_source
  FROM seated s
  LEFT JOIN LATERAL (
    SELECT x.hand_id, x.net, x.went_to_showdown
    FROM public.ca_hand_facts x
    WHERE x.hand_id = s.hand_id AND x.user_id = s.user_id
    LIMIT 1
  ) f ON true
), marked AS MATERIALIZED (
  SELECT r.*, count(*) OVER (PARTITION BY r.hand_id) AS people_in_hand,
         (r.in_source AND r.profit IS NOT NULL AND r.big_blind > 0 AND r.n_players > 0) AS usable
  FROM picked r
), kept AS (
  SELECT m.user_id, m.hand_id, m.created_at, m.is_cash, m.game_variant, m.n_players, m.big_blind,
         (m.profit / m.big_blind)::float8 AS bb, coalesce(m.showdown, false) AS sd,
         ${windowSql} AS w
  FROM marked m
  WHERE m.counted AND m.usable AND m.people_in_hand < m.n_players
), stepped AS (
  SELECT k.*,
         CASE WHEN k.created_at - lag(k.created_at) OVER seq > interval '${SESSION_GAP_MINUTES} minutes'
              THEN 1 ELSE 0 END AS step
  FROM kept k
  WINDOW seq AS (PARTITION BY k.user_id, k.game_variant, k.is_cash, k.w ORDER BY k.created_at, k.hand_id)
), sessioned AS MATERIALIZED (
  SELECT s.*,
         sum(s.step) OVER (PARTITION BY s.user_id, s.game_variant, s.is_cash, s.w
                           ORDER BY s.created_at, s.hand_id) AS sess,
         dense_rank() OVER (ORDER BY s.user_id) AS pn,
         ${dimensionSql(by)} AS d
  FROM stepped s
), cells AS (
  SELECT w, game_variant AS g, is_cash AS c, d, pn, sess, min(left(user_id::text, 4)) AS p4,
         count(*) AS n, sum(bb) AS s, sum(bb * bb) AS ss,
         count(*) FILTER (WHERE sd) AS sdn, coalesce(sum(bb) FILTER (WHERE sd), 0) AS sds
  FROM sessioned
  GROUP BY w, game_variant, is_cash, d, pn, sess
), hands AS (
  SELECT w, game_variant AS g, is_cash AS c, d, count(DISTINCT hand_id) AS h
  FROM sessioned
  GROUP BY GROUPING SETS ((w, game_variant, is_cash, d), (w, game_variant, is_cash))
)
SELECT jsonb_build_object(
  'read_at', now(),
  'cells', (SELECT ${agg(`'w', w, 'g', g, 'c', c, 'd', d, 'pn', pn, 'sess', sess, 'p4', p4, 'n', n, 's', s, 'ss', ss, 'sdn', sdn, 'sds', sds`)} FROM cells),
  'hands', (SELECT ${agg(`'w', w, 'g', g, 'c', c, 'd', d, 'h', h`)} FROM hands),
  'left_out', (SELECT jsonb_build_object(
      'deleted_accounts', count(*) FILTER (WHERE NOT counted),
      'unusable', count(*) FILTER (WHERE counted AND NOT usable),
      'no_horse', count(*) FILTER (WHERE counted AND usable AND people_in_hand >= n_players))
    FROM marked),
  'source', (SELECT jsonb_build_object(
      'table', 'ca_hand_facts',
      'expected', count(*),
      'found', count(*) FILTER (WHERE in_source))
    FROM marked)
) AS report`;
}

/**
 * The guard against a truncated source. The query counts the person-hands hand_history says were
 * played in the range (`expected`) and how many of them ca_hand_facts holds (`found`). Any shortfall,
 * or output without the counts (such as a file saved by an older version of this report), throws,
 * so the CLI exits EXIT_FAILED instead of giving a verdict on part of the hands.
 */
export function assertSourceComplete(row) {
  const src = row?.source;
  const expected = Number(src?.expected);
  const found = Number(src?.found);
  if (!src || !Number.isInteger(expected) || !Number.isInteger(found) || expected < 0) {
    throw new Error(
      'the query output has no source count, so it cannot be shown to hold every hand; refusing to report'
    );
  }
  if (found < expected) {
    throw new Error(
      `the result source holds ${fmtInt(found)} of the ${fmtInt(expected)} person-hands hand_history has for this range (${fmtInt(expected - found)} missing); refusing to report on part of the hands`
    );
  }
  return { table: String(src.table ?? ''), expected, found };
}

/** Unwrap the CLI's JSON (an array with one row, or the object itself). */
export function unwrapReportRow(raw) {
  let v = raw;
  if (v && !Array.isArray(v) && Array.isArray(v.rows)) v = v.rows;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'report' in v) v = v.report;
  if (typeof v === 'string') v = JSON.parse(v);
  if (!v || typeof v !== 'object' || !Array.isArray(v.cells)) {
    throw new Error('Unexpected query output: no cells');
  }
  return v;
}

// ── Statistics ─────────────────────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Results of a set of person-session clusters ({pn, sess, n, s, ss, sdn, sds}; rows that share a
 * person and session are merged first, so one sitting is always one cluster).
 *
 * bb/100 is the ratio 100 * sum(bb) / hands. Its clustered standard error is the usual
 * linearised one: with G clusters, mean m, cluster sums s_g and sizes n_g,
 *   Var(m) = G / (G - 1) * sum_g (s_g - m * n_g)^2 / N^2.
 * With fewer than two clusters it cannot be estimated and is null.
 */
export function clusterStats(cells) {
  const merged = new Map();
  for (const c of cells) {
    const key = `${c.pn}:${c.sess}`;
    let m = merged.get(key);
    if (!m) {
      m = { pn: c.pn, n: 0, s: 0, ss: 0, sdn: 0, sds: 0 };
      merged.set(key, m);
    }
    m.n += num(c.n);
    m.s += num(c.s);
    m.ss += num(c.ss);
    m.sdn += num(c.sdn);
    m.sds += num(c.sds);
  }
  const clusters = [...merged.values()].filter((c) => c.n > 0);
  let n = 0;
  let s = 0;
  let ss = 0;
  let sdn = 0;
  let sds = 0;
  const perPerson = new Map();
  for (const c of clusters) {
    n += c.n;
    s += c.s;
    ss += c.ss;
    sdn += c.sdn;
    sds += c.sds;
    perPerson.set(c.pn, (perPerson.get(c.pn) ?? 0) + c.n);
  }
  const out = {
    personHands: n,
    people: perPerson.size,
    sessions: clusters.length,
    topPersonShare: n > 0 ? Math.max(...perPerson.values()) / n : null,
    bb: s,
    bbPer100: null,
    sdPerHand: null,
    sePer100: null,
    ciLow: null,
    ciHigh: null,
    showdownHands: sdn,
    showdownBb: sds,
    nonShowdownBb: s - sds,
  };
  if (n === 0) return out;
  const mean = s / n;
  out.bbPer100 = 100 * mean;
  if (n > 1) out.sdPerHand = Math.sqrt(Math.max(0, (ss - (s * s) / n) / (n - 1)));
  const g = clusters.length;
  if (g > 1) {
    let sq = 0;
    for (const c of clusters) {
      const r = c.s - mean * c.n;
      sq += r * r;
    }
    out.sePer100 = (100 * Math.sqrt((g / (g - 1)) * sq)) / n;
    out.ciLow = out.bbPer100 - CI_Z * out.sePer100;
    out.ciHigh = out.bbPer100 + CI_Z * out.sePer100;
  }
  return out;
}

/**
 * The fixed verdict for an earlier window against a later one. Rules, in order:
 *   1. too few hands to judge: fewer than MIN_HANDS_PER_WINDOW person-hands in either window, or
 *      one person played more than MAX_TOP_PERSON_SHARE of either window's hands, or either window
 *      has fewer than two person-sessions (no standard error exists);
 *   2. no measurable change: |z| < Z_THRESHOLD;
 *   3. people doing better / worse than before: z >= Z_THRESHOLD / z <= -Z_THRESHOLD.
 */
export function compareWindows(before, after) {
  const out = { diffPer100: null, sePer100: null, z: null, verdict: 'too_few', reason: '' };
  if (before.bbPer100 !== null && after.bbPer100 !== null) {
    out.diffPer100 = after.bbPer100 - before.bbPer100;
  }
  if (before.sePer100 !== null && after.sePer100 !== null) {
    out.sePer100 = Math.sqrt(before.sePer100 ** 2 + after.sePer100 ** 2);
    if (out.sePer100 > 0 && out.diffPer100 !== null) out.z = out.diffPer100 / out.sePer100;
  }
  const reasons = [];
  for (const [name, w] of [
    ['before', before],
    ['after', after],
  ]) {
    const small = w.personHands < MIN_HANDS_PER_WINDOW;
    const dominated = w.topPersonShare !== null && w.topPersonShare > MAX_TOP_PERSON_SHARE;
    if (small) {
      reasons.push(
        `${fmtInt(w.personHands)} person-hands ${name}, ${fmtInt(MIN_HANDS_PER_WINDOW)} needed`
      );
    }
    if (dominated) {
      reasons.push(
        `one person played ${fmtPct(w.topPersonShare)} of the hands ${name}, the limit is ${fmtPct(MAX_TOP_PERSON_SHARE)}`
      );
    }
    if (!small && !dominated && w.sePer100 === null) {
      reasons.push(`fewer than two sittings ${name}`);
    }
  }
  if (reasons.length > 0 || out.z === null) {
    out.reason = reasons.join('; ') || 'the results do not vary, so luck cannot be measured';
    return out;
  }
  if (Math.abs(out.z) < Z_THRESHOLD) out.verdict = 'no_change';
  else out.verdict = out.z > 0 ? 'better' : 'worse';
  out.reason = `z = ${fmtSigned(out.z, 2)}, a change counts from ${Z_THRESHOLD}`;
  return out;
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────────

function modeName(isCash) {
  return isCash ? 'cash' : 'tournament';
}

function dimensionSort(by) {
  if (by === 'stake' || by === 'table-size' || by === 'player') {
    return (a, b) => Number(a) - Number(b);
  }
  return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
}

/** Query output + plan -> the report object (also the --json output). */
export function buildReport(raw, plan) {
  const row = unwrapReportRow(raw);
  assertSourceComplete(row);
  const bounds = [plan.sinceMs, ...plan.splits, plan.untilMs];
  const windows = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    windows.push({ index: i + 1, from: isoUtc(bounds[i]), to: isoUtc(bounds[i + 1]) });
  }
  const handCount = new Map();
  for (const h of Array.isArray(row.hands) ? row.hands : []) {
    handCount.set(`${h.g}|${h.c}|${h.w}|${h.d ?? '*'}`, num(h.h));
  }
  const byGame = new Map();
  for (const c of row.cells) {
    const key = `${c.g}|${c.c}`;
    if (!byGame.has(key)) byGame.set(key, { game: String(c.g), isCash: c.c === true, cells: [] });
    byGame.get(key).cells.push(c);
  }
  const statsFor = (g, cells, w, d) => ({
    window: w + 1,
    hands: handCount.get(`${g.game}|${g.isCash}|${w}|${d ?? '*'}`) ?? 0,
    ...clusterStats(cells),
  });
  const games = [...byGame.values()]
    .sort((a, b) =>
      a.game === b.game ? Number(b.isCash) - Number(a.isCash) : a.game < b.game ? -1 : 1
    )
    .map((g) => {
      const perWindow = windows.map((_, w) =>
        statsFor(
          g,
          g.cells.filter((c) => num(c.w) === w),
          w,
          null
        )
      );
      const comparisons = [];
      for (let w = 1; w < windows.length; w++) {
        comparisons.push({
          splitAt: windows[w].from,
          before: w,
          after: w + 1,
          ...compareWindows(perWindow[w - 1], perWindow[w]),
        });
      }
      const out = { game: g.game, mode: modeName(g.isCash), windows: perWindow, comparisons };
      if (plan.by !== null) {
        const keys = [...new Set(g.cells.map((c) => String(c.d)))].sort(dimensionSort(plan.by));
        const prefixes = new Map();
        if (plan.by === 'player') {
          for (const c of g.cells) prefixes.set(String(c.d), String(c.p4 ?? '').slice(0, 4));
        }
        const seen = new Map();
        out.breakdown = keys.map((k) => {
          let label = k;
          if (plan.by === 'player') {
            const p = prefixes.get(k) || '????';
            const nth = (seen.get(p) ?? 0) + 1;
            seen.set(p, nth);
            label = nth === 1 ? p : `${p} (${nth})`;
          } else if (plan.by === 'stake') label = `bb ${k}`;
          else if (plan.by === 'table-size') label = `${k} dealt in`;
          return {
            label,
            windows: windows.map((_, w) =>
              statsFor(
                g,
                g.cells.filter((c) => num(c.w) === w && String(c.d) === k),
                w,
                plan.by === 'player' ? undefined : k
              )
            ),
          };
        });
        if (plan.by === 'player') {
          // A hand is not split between people; the per-person count of hands is the person-hands.
          for (const b of out.breakdown) for (const w of b.windows) w.hands = w.personHands;
        }
      }
      return out;
    });
  const left = row.left_out ?? {};
  return {
    title: 'People vs Horses results',
    readAt: row.read_at ?? null,
    since: isoUtc(plan.sinceMs),
    until: isoUtc(plan.untilMs),
    splits: plan.splits.map(isoUtc),
    mode: plan.mode,
    gamesAsked: plan.games,
    by: plan.by,
    rules: {
      minPersonHandsPerWindow: MIN_HANDS_PER_WINDOW,
      maxTopPersonShare: MAX_TOP_PERSON_SHARE,
      zThreshold: Z_THRESHOLD,
      sessionGapMinutes: SESSION_GAP_MINUTES,
      intervalZ: CI_Z,
    },
    leftOut: {
      deletedAccountPersonHands: num(left.deleted_accounts),
      personHandsWithNoHorseDealtIn: num(left.no_horse),
      unusableRows: num(left.unusable),
    },
    windows,
    games,
  };
}

/**
 * The gate for a switch runbook. Needs at least one split. People measurably better than before
 * any split wins over everything (exit 1); otherwise any comparison that cannot be judged, or no
 * hands at all, is exit 2; otherwise clean (exit 0). "Worse than before" is clean.
 */
export function gateResult(report) {
  const comparisons = report.games.flatMap((g) =>
    g.comparisons.map((c) => ({ game: g.game, mode: g.mode, ...c }))
  );
  const name = (c) => `${c.game} ${c.mode} at ${c.splitAt}`;
  const better = comparisons.filter((c) => c.verdict === 'better');
  if (better.length > 0) {
    return {
      exitCode: GATE_PEOPLE_BETTER,
      line: `GATE 1: people measurably better than before the split (${better.map(name).join('; ')})`,
    };
  }
  const tooFew = comparisons.filter((c) => c.verdict === 'too_few');
  if (comparisons.length === 0 || tooFew.length > 0) {
    return {
      exitCode: GATE_TOO_FEW,
      line:
        comparisons.length === 0
          ? 'GATE 2: too few hands to judge (no hands in the range)'
          : `GATE 2: too few hands to judge (${tooFew.map(name).join('; ')})`,
    };
  }
  return {
    exitCode: GATE_CLEAN,
    line: 'GATE 0: clean, people are not measurably better than before',
  };
}

// ── Text output ────────────────────────────────────────────────────────────────────────────────

export function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtSigned(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const fixed = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (Number(Math.abs(n).toFixed(digits)) === 0) return fixed;
  return `${n < 0 ? '-' : '+'}${fixed}`;
}

export function fmtPlain(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(share) {
  if (share === null || share === undefined || !Number.isFinite(share)) return 'n/a';
  return `${Math.round(share * 100)}%`;
}

const STAT_HEADER =
  '| Hands | Person-hands | People | Top person | bb won | bb/100 | SD per hand | SE of bb/100 | 95% interval | Showdown bb | Non-showdown bb |';
const STAT_RULE = '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |';

function statCells(s) {
  const interval = s.ciLow === null ? 'n/a' : `${fmtSigned(s.ciLow)} to ${fmtSigned(s.ciHigh)}`;
  return `| ${fmtInt(s.hands)} | ${fmtInt(s.personHands)} | ${fmtInt(s.people)} | ${fmtPct(s.topPersonShare)} | ${fmtSigned(s.bb)} | ${fmtSigned(s.bbPer100)} | ${fmtPlain(s.sdPerHand)} | ${fmtPlain(s.sePer100)} | ${interval} | ${fmtSigned(s.showdownBb)} | ${fmtSigned(s.nonShowdownBb)} |`;
}

const BY_TITLE = Object.freeze({
  day: 'By day (UTC)',
  hour: 'By hour (UTC)',
  player: 'By person (first four characters of the account id)',
  stake: 'By stake (big blind)',
  'table-size': 'By table size (players dealt in)',
});

export function formatReportText(report, { gate = null } = {}) {
  const lines = [];
  lines.push('# People vs Horses results (read-only)');
  lines.push('');
  lines.push(`Range: ${report.since} to ${report.until} (UTC). Read at ${report.readAt ?? 'n/a'}.`);
  lines.push(
    `Games: ${report.gamesAsked ? report.gamesAsked.join(', ') : 'all'}. Mode: ${report.mode}.`
  );
  lines.push(
    'Counted: hands with at least one Horse dealt in, people whose profile is not marked deleted. A result is the net chips a person won or lost in the hand after rake, in big blinds.'
  );
  lines.push(
    `Left out: ${fmtInt(report.leftOut.deletedAccountPersonHands)} person-hands of deleted accounts, ${fmtInt(report.leftOut.personHandsWithNoHorseDealtIn)} person-hands with no Horse dealt in, ${fmtInt(report.leftOut.unusableRows)} rows without a usable result or big blind.`
  );
  lines.push(
    `Luck: the SE and the 95% interval are clustered on person-session (one person, one game, hands no more than ${report.rules.sessionGapMinutes} minutes apart).`
  );
  lines.push('');
  if (report.windows.length > 1) {
    lines.push('Windows:');
    for (const w of report.windows) lines.push(`- Window ${w.index}: ${w.from} to ${w.to}`);
    lines.push('');
  }
  if (report.games.length === 0) {
    lines.push('No person-hands against Horses in this range.');
    lines.push('');
  }
  for (const g of report.games) {
    lines.push(`## ${g.game} ${g.mode}`);
    lines.push('');
    lines.push(`| Window ${STAT_HEADER}`);
    lines.push(`| --- ${STAT_RULE}`);
    for (const s of g.windows) lines.push(`| ${s.window} ${statCells(s)}`);
    lines.push('');
    for (const c of g.comparisons) {
      lines.push(
        `Window ${c.after} against window ${c.before} (split at ${c.splitAt}): difference ${fmtSigned(c.diffPer100)} bb/100, SE ${fmtPlain(c.sePer100)}, z ${fmtSigned(c.z, 2)}.`
      );
      lines.push(
        `Verdict for ${g.game} ${g.mode} at ${c.splitAt}: ${VERDICT_TEXT[c.verdict]} (${c.reason}).`
      );
      lines.push('');
    }
    if (g.breakdown) {
      lines.push(`### ${BY_TITLE[report.by]}`);
      lines.push('');
      lines.push(`| ${report.by} | Window ${STAT_HEADER}`);
      lines.push(`| --- | --- ${STAT_RULE}`);
      for (const b of g.breakdown) {
        for (const s of b.windows) {
          if (s.personHands === 0) continue;
          lines.push(`| ${b.label} | ${s.window} ${statCells(s)}`);
        }
      }
      lines.push('');
    }
  }
  lines.push(
    `Rules: "${VERDICT_TEXT.too_few}" when either window has fewer than ${fmtInt(report.rules.minPersonHandsPerWindow)} person-hands or one person played more than ${fmtPct(report.rules.maxTopPersonShare)} of them; "${VERDICT_TEXT.no_change}" when |z| is below ${report.rules.zThreshold}; otherwise "${VERDICT_TEXT.better}" or "${VERDICT_TEXT.worse}".`
  );
  if (gate) {
    lines.push('');
    lines.push(gate.line);
  }
  return lines.join('\n');
}
