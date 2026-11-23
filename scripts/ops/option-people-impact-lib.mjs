/**
 * Option people impact: did people do better or worse against the horses after a live change?
 *
 * Pure functions only (no I/O). The CLI (option-people-impact.mjs) runs one read-only query and
 * hands its JSON to buildImpactReport. Owner request 2026-11-22 20:18 America/Chicago
 * ("how else can this be improved"): today an activation is watched for errors and faults, never
 * for whether the horses keep winning against real people.
 *
 * What is measured, per change event (a ca_horse_style_switch_audit row whose state changed, or a
 * ca_engine_runtime_settings_versions row):
 *   - hands with at least one person and at least one horse dealt in (ca_hand_facts, people read
 *     from profiles.is_horse = false; a hand has a horse when fewer people than players_dealt),
 *   - in the games the change governs (variant set, cash or tournament, heads-up tables only for
 *     heads-up options),
 *   - people's combined net big blinds per hand after rake (ca_hand_facts.net_bb summed over every
 *     person in the hand, so person-to-person transfers cancel and only the people-vs-horses result
 *     and rake remain),
 *   - in a window before the change and a window after it (default 24 hours each, the after window
 *     ends at the read time when the change is recent),
 *   - reported as bb/100 with its standard error, the difference and a plain verdict.
 *
 * Aggregate only: the query returns per-minute sums (count, sum, sum of squares). No hand id,
 * account id, name or card ever leaves the database.
 *
 * Limits a reader must keep in mind:
 *   - before/after is not a controlled experiment; other changes in the same games inside the
 *     windows are counted and shown as "confounded by N";
 *   - an option acts only on the decisions it governs, so its effect is diluted by every other hand
 *     in those games; "no clear change" is the usual honest answer on a few hundred hands;
 *   - Lightning tables are not separated from table play.
 */

export const DEFAULT_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = 168;
export const DEFAULT_LOOKBACK_DAYS = 14;
export const MAX_LOOKBACK_DAYS = 14;
export const DEFAULT_MIN_HANDS = 200;
export const Z_THRESHOLD = 2;

export const ALL_VARIANTS = Object.freeze([
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo8',
  'short_deck',
  'pineapple',
]);

const PLO45 = Object.freeze(['plo4', 'plo5']);

/**
 * Explicit scopes for options whose games are known exactly. Everything else falls back to the
 * option's recorded scope text, then to its name. `hu: true` means heads-up tables only.
 */
export const OPTION_SCOPE_TABLE = Object.freeze({
  holdemValueAndCallsArePriced: { variants: ['nlh'], mode: 'cash', hu: false },
  holdemTournamentAllInCallIsPriced: { variants: ['nlh'], mode: 'tournament', hu: false },
  holdemRiverFullHouseValueIsPriced: { variants: ['nlh'], mode: 'all', hu: false },
  huBbDefendsUnreadToPrice: { variants: ['nlh'], mode: 'all', hu: true },
  omahaBlanketRowsOffInPlo45Cash: { variants: PLO45, mode: 'cash', hu: false },
  omahaBluffCatcherFoldVsValueLeader: { variants: PLO45, mode: 'all', hu: false },
  omahaUnderpairNoMultiwayFlopContinue: { variants: PLO45, mode: 'all', hu: false },
  omahaMathCorePlo5Flop: { variants: ['plo5'], mode: 'all', hu: false },
  vpipFloorLimpOnly: { variants: ALL_VARIANTS, mode: 'cash', hu: false },
  lightningVpipFloorLimpOnly: {
    variants: ['nlh', 'plo4', 'plo5', 'plo6'],
    mode: 'cash',
    hu: false,
  },
});

/** Runtime settings versions carry the PLO4/PLO5 cash-only blanket off-list. */
export const RUNTIME_SETTINGS_SCOPE = Object.freeze({ variants: PLO45, mode: 'cash', hu: false });

function freezeScope(scope, basis) {
  return Object.freeze({
    variants: Object.freeze([...new Set(scope.variants)].sort()),
    mode: scope.mode,
    hu: Boolean(scope.hu),
    basis,
  });
}

/** Read variants and cash/tournament from a recorded scope sentence. Null when it names no game. */
export function scopeFromText(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  const variants = new Set();
  if (/\bnlh\b|hold'?em|no.limit/.test(s)) variants.add('nlh');
  if (/\bplo4\b/.test(s)) variants.add('plo4');
  if (/\bplo5\b/.test(s)) variants.add('plo5');
  if (/\bplo6\b/.test(s)) variants.add('plo6');
  if (/\bplo8\b|hi-?lo/.test(s)) variants.add('plo8');
  if (/\bomaha\b|\bplo\b/.test(s) && !/\bplo[4568]\b/.test(s)) {
    variants.add('plo4');
    variants.add('plo5');
  }
  if (/fixed.limit|\bflh\b/.test(s)) variants.add('flh');
  if (/short.deck/.test(s)) variants.add('short_deck');
  if (/pineapple/.test(s)) variants.add('pineapple');
  if (/\bflo8\b/.test(s)) variants.add('flo8');
  if (variants.size === 0) return null;
  const cash = /\bcash\b/.test(s);
  const tourn = /tournament/.test(s);
  const mode = cash && !tourn ? 'cash' : tourn && !cash ? 'tournament' : 'all';
  return { variants: [...variants], mode, hu: false };
}

/** Scope from the option's name alone (last resort). */
export function scopeFromName(name) {
  const n = String(name ?? '');
  let variants = ALL_VARIANTS;
  let hu = false;
  // A game named anywhere in the option name wins over the lane prefix (v46ShortDeck is Short
  // Deck, v58Plo6RiverNuts is PLO6, v24PloDefense is Omaha).
  if (/ShortDeck/i.test(n)) variants = ['short_deck'];
  else if (/Pineapple/i.test(n)) variants = ['pineapple'];
  else if (/^fixedLimit|FixedLimit/.test(n)) variants = ['flh', 'flo8'];
  else if (/HiLo|Plo8/i.test(n)) variants = ['plo8'];
  else if (/plo6/i.test(n)) variants = ['plo6'];
  else if (/Plo5/.test(n)) variants = ['plo5'];
  else if (/^(omaha|plo45)|Omaha|Plo/.test(n)) variants = PLO45;
  else if (/^lightning/i.test(n)) variants = ['nlh', 'plo4', 'plo5', 'plo6'];
  else if (/^(holdem|nash|hu[A-Z]|style|icm|tournamentUtility|v\d)/.test(n)) variants = ['nlh'];
  if (/^hu[A-Z]/.test(n)) hu = true;
  const mode = /Tournament/.test(n) ? 'tournament' : /Cash/.test(n) ? 'cash' : 'all';
  return { variants, mode, hu };
}

/**
 * Resolve where an option acts: explicit table, then recorded scope text, then name.
 * `scopeTexts` maps option name to the scope sentence from HorseOptionSwitch.ts OVERRIDES.
 */
export function resolveOptionScope(name, scopeTexts = {}) {
  if (Object.hasOwn(OPTION_SCOPE_TABLE, name)) {
    return freezeScope(OPTION_SCOPE_TABLE[name], 'declared');
  }
  const fromText = scopeFromText(scopeTexts[name]);
  if (fromText) {
    if (/^hu[A-Z]/.test(name)) fromText.hu = true;
    return freezeScope(fromText, 'scope text');
  }
  return freezeScope(scopeFromName(name), 'name');
}

/**
 * Pull `name: [OWNER, 'scope', ...]` scope sentences out of HorseOptionSwitch.ts source text.
 * Returns { [option]: scope }. Tolerates either quote style; ignores entries it cannot read.
 */
export function parseOverrideScopes(source) {
  const out = {};
  const src = String(source ?? '');
  const re =
    /^\s{2}([A-Za-z0-9_]+):\s*\[\s*([A-Za-z_]+|'[^']*'|"[^"]*"),\s*(['"])((?:\\.|(?!\3).)*)\3/gms;
  let m;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[4].replace(/\\(['"])/g, '$1');
  }
  return out;
}

/** True when two scopes can touch the same hand. */
export function scopesOverlap(a, b) {
  const shared = a.variants.some((v) => b.variants.includes(v));
  if (!shared) return false;
  if (a.mode !== 'all' && b.mode !== 'all' && a.mode !== b.mode) return false;
  return true;
}

function toMs(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${String(value)}`);
  return ms;
}

/**
 * Build change events from the query's audit and settings rows. A switch row whose state did not
 * change (on -> on reconfirmation) is not a change and is dropped.
 */
export function buildEvents({ audit = [], settings = [] } = {}, scopeTexts = {}) {
  const events = [];
  for (const row of audit) {
    const from = row.old_state ?? null;
    const to = row.new_state ?? null;
    if (from === to) continue;
    events.push({
      kind: 'switch',
      key: `audit #${row.id}`,
      option: row.option,
      from,
      to,
      atMs: toMs(row.changed_at),
      scope: resolveOptionScope(row.option, scopeTexts),
    });
  }
  for (const row of settings) {
    if (Number(row.version) <= 1) continue;
    events.push({
      kind: 'settings',
      key: `settings v${row.version}`,
      option: 'runtime settings (PLO4/PLO5 cash off-list)',
      from: `v${Number(row.version) - 1}`,
      to:
        row.rolled_back_from == null
          ? `v${row.version}`
          : `v${row.version} (= v${row.rolled_back_from})`,
      note: row.note ?? '',
      atMs: toMs(row.created_at),
      scope: freezeScope(RUNTIME_SETTINGS_SCOPE, 'declared'),
    });
  }
  events.sort((x, y) => x.atMs - y.atMs || x.key.localeCompare(y.key));
  return events;
}

/** Normalise the query's per-minute buckets. */
export function normalizeBuckets(rows = []) {
  return rows.map((r) => ({
    atMs: Number(r.m) * 1000,
    variant: String(r.v ?? ''),
    tournament: Boolean(r.t),
    hu: Boolean(r.hu),
    n: Number(r.n) || 0,
    sum: Number(r.s) || 0,
    sumSq: Number(r.ss) || 0,
  }));
}

function bucketInScope(b, scope) {
  if (!scope.variants.includes(b.variant)) return false;
  if (scope.mode === 'cash' && b.tournament) return false;
  if (scope.mode === 'tournament' && !b.tournament) return false;
  if (scope.hu && !b.hu) return false;
  return true;
}

/** People's result against horses over [fromMs, toMs) in a scope. */
export function windowStats(buckets, scope, fromMs, toMs) {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (const b of buckets) {
    if (b.atMs < fromMs || b.atMs >= toMs) continue;
    if (!bucketInScope(b, scope)) continue;
    n += b.n;
    sum += b.sum;
    sumSq += b.sumSq;
  }
  const mean = n > 0 ? sum / n : null;
  let se = null;
  if (n > 1) {
    const variance = Math.max(0, (sumSq - (sum * sum) / n) / (n - 1));
    se = Math.sqrt(variance / n);
  }
  return {
    hands: n,
    peopleNetBb: round(sum, 1),
    peopleBbPer100: mean == null ? null : round(100 * mean, 1),
    se100: se == null ? null : round(100 * se, 1),
  };
}

function round(x, dp) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/**
 * Compare the after window with the before window from the people's side. People doing worse
 * after the change means the horses are doing better.
 */
export function compareWindows(before, after, { minHands = DEFAULT_MIN_HANDS } = {}) {
  if (before.hands < minHands || after.hands < minHands) {
    return { delta100: null, seDelta100: null, z: null, verdict: 'too few hands' };
  }
  const delta = after.peopleBbPer100 - before.peopleBbPer100;
  const seDelta = Math.sqrt((before.se100 ?? 0) ** 2 + (after.se100 ?? 0) ** 2);
  // With no spread in either window the difference is exact; cap z at 99 so the verdict follows
  // its sign and the JSON stays finite.
  const z = seDelta > 0 ? delta / seDelta : delta === 0 ? 0 : Math.sign(delta) * 99;
  let verdict = 'no clear change';
  if (z <= -Z_THRESHOLD) verdict = 'horses doing better';
  else if (z >= Z_THRESHOLD) verdict = 'horses doing worse';
  return { delta100: round(delta, 1), seDelta100: round(seDelta, 1), z: round(z, 2), verdict };
}

/**
 * The full report: one row per change event in the lookback, newest first.
 */
export function buildImpactReport({
  events,
  buckets,
  readAtMs,
  windowHours = DEFAULT_WINDOW_HOURS,
  minHands = DEFAULT_MIN_HANDS,
}) {
  const w = windowHours * 3600000;
  const rows = events.map((e) => {
    const beforeFrom = e.atMs - w;
    const afterTo = Math.min(e.atMs + w, readAtMs);
    const before = windowStats(buckets, e.scope, beforeFrom, e.atMs);
    const after = windowStats(buckets, e.scope, e.atMs, afterTo);
    const confounders = events.filter(
      (o) =>
        o !== e && o.atMs >= beforeFrom && o.atMs < e.atMs + w && scopesOverlap(o.scope, e.scope)
    ).length;
    return {
      key: e.key,
      kind: e.kind,
      option: e.option,
      from: e.from,
      to: e.to,
      at: new Date(e.atMs).toISOString(),
      scope: e.scope,
      afterHours: round((afterTo - e.atMs) / 3600000, 1),
      before,
      after,
      confounders,
      ...compareWindows(before, after, { minHands }),
    };
  });
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    readAt: new Date(readAtMs).toISOString(),
    windowHours,
    minHands,
    zThreshold: Z_THRESHOLD,
    rows,
  };
}

function scopeLabel(scope) {
  const v = scope.variants.length === ALL_VARIANTS.length ? 'all games' : scope.variants.join('+');
  const m = scope.mode === 'all' ? 'cash+tournament' : scope.mode;
  return `${v} ${m}${scope.hu ? ' heads-up tables' : ''} (${scope.basis})`;
}

function cell(stats) {
  if (stats.hands === 0) return '0 hands';
  const se = stats.se100 == null ? '' : ` +/- ${stats.se100}`;
  return `${stats.hands} hands, ${stats.peopleNetBb} bb, ${stats.peopleBbPer100}${se} bb/100`;
}

/** Markdown for the archive report. `focus` options are listed first in their own section. */
export function formatImpactMarkdown(report, { focus = [] } = {}) {
  const lines = [];
  lines.push(
    `Read at ${report.readAt}. Window: ${report.windowHours}h before vs up to ${report.windowHours}h after each change.`
  );
  lines.push(
    `People's combined net big blinds per hand against horses (after rake), hands with at least one person and one horse. ` +
      `Verdict needs >= ${report.minHands} hands each side and |z| >= ${report.zThreshold}; ` +
      `"horses doing better" means people lost more (or won less) after the change.`
  );
  lines.push('');
  const header =
    '| Change | When (UTC) | Games | Before | After | Change in people bb/100 | Verdict | Other changes in window |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- |';
  const render = (r) =>
    `| ${r.option} ${r.from ?? 'none'} -> ${r.to ?? 'none'} (${r.key}) | ${r.at.slice(0, 16)} | ${scopeLabel(r.scope)} | ${cell(r.before)} | ${cell(r.after)}${r.afterHours < report.windowHours ? ` (${r.afterHours}h so far)` : ''} | ${r.delta100 == null ? 'n/a' : `${r.delta100} +/- ${r.seDelta100} (z ${r.z})`} | ${r.verdict} | ${r.confounders} |`;
  const focused = report.rows.filter(
    (r) => focus.includes(r.option) || (focus.includes('settings') && r.kind === 'settings')
  );
  if (focused.length) {
    lines.push('## Changes under review');
    lines.push('');
    lines.push(header, sep, ...focused.map(render), '');
  }
  const rest = report.rows.filter((r) => !focused.includes(r));
  lines.push('## Every other change in the lookback');
  lines.push('');
  lines.push(header, sep, ...rest.map(render), '');
  return lines.join('\n');
}

/**
 * The single read-only query. One WITH statement (assertReadOnlySql refuses anything else); every
 * figure it returns is a per-minute aggregate.
 */
export function buildImpactSql({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  windowHours = DEFAULT_WINDOW_HOURS,
} = {}) {
  const days = Number(lookbackDays);
  const hours = Number(windowHours);
  if (!Number.isInteger(days) || days < 1 || days > MAX_LOOKBACK_DAYS) {
    throw new Error(`lookback days must be an integer 1..${MAX_LOOKBACK_DAYS}`);
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_WINDOW_HOURS) {
    throw new Error(`window hours must be an integer 1..${MAX_WINDOW_HOURS}`);
  }
  const factsSince = `now() - interval '${days} days' - interval '${hours} hours'`;
  return `WITH people AS MATERIALIZED (
  SELECT id FROM public.profiles WHERE is_horse = false
), facts AS MATERIALIZED (
  SELECT x.hand_id, x.played_at, x.game_variant, x.tournament_id IS NOT NULL AS tourn,
         x.players_dealt, x.net_bb
  FROM people p CROSS JOIN LATERAL (
    SELECT y.hand_id, y.played_at, y.game_variant, y.tournament_id, y.players_dealt, y.net_bb
    FROM public.ca_hand_facts y
    WHERE y.user_id = p.id AND y.played_at >= ${factsSince}
    ORDER BY y.played_at DESC
    LIMIT 200000
  ) x
), hands AS (
  SELECT hand_id, min(played_at) AS at, min(game_variant) AS v, bool_or(tourn) AS t,
         max(players_dealt) AS dealt, count(*) AS humans, sum(net_bb) AS bb
  FROM facts
  WHERE net_bb IS NOT NULL AND game_variant IS NOT NULL
  GROUP BY hand_id
), buckets AS (
  SELECT extract(epoch FROM date_trunc('minute', at))::bigint AS m, v, t, dealt = 2 AS hu,
         count(*) AS n, sum(bb) AS s, sum(bb * bb) AS ss
  FROM hands
  WHERE humans < dealt
  GROUP BY 1, 2, 3, 4
)
SELECT jsonb_build_object(
  'read_at', now(),
  'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('m', m, 'v', v, 't', t, 'hu', hu, 'n', n, 's', s, 'ss', ss)), '[]'::jsonb) FROM buckets),
  'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'option', a.option, 'old_state', a.old_state, 'new_state', a.new_state, 'changed_at', a.changed_at) ORDER BY a.changed_at), '[]'::jsonb)
            FROM public.ca_horse_style_switch_audit a WHERE a.changed_at >= now() - interval '${days} days'),
  'settings', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', s.version, 'rolled_back_from', s.rolled_back_from, 'note', s.note, 'created_at', s.created_at) ORDER BY s.version), '[]'::jsonb)
            FROM public.ca_engine_runtime_settings_versions s WHERE s.created_at >= now() - interval '${days} days')
) AS report`;
}

/** Unwrap the CLI's JSON (an array with one row, or the object itself). */
export function unwrapImpactRow(raw) {
  let v = raw;
  if (v && !Array.isArray(v) && Array.isArray(v.rows)) v = v.rows;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'report' in v) v = v.report;
  if (typeof v === 'string') v = JSON.parse(v);
  if (!v || typeof v !== 'object' || !Array.isArray(v.buckets)) {
    throw new Error('Unexpected query output: no buckets');
  }
  return v;
}
