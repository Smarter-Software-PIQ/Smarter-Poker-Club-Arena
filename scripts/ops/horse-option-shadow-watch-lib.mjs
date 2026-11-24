// scripts/ops/horse-option-shadow-watch-lib.mjs
// Pure core of the read-only Horse option shadow watcher (horse-option-shadow-watch.mjs).
// It builds read-only SELECTs and turns their rows into a report and a one-line VERDICT. No I/O here.
//
// What a live shadow trial is read from (one shadow row globally, so the shared counters are the option's):
//   ca_horse_style_switch                 the option's switch row (state) and its companions'
//   horse_brain_flush_receipts.fires      option_shadow_<option>_<changed|same>[_person]_seen,
//                                         option_shadow_<option>_dir_<from>_to_<to>[_person]_seen (hold'em stage),
//                                         the stage's guards and skips, and the option's own acted receipts
//   horse_brain_flush_receipts.latency    option_shadow_stage_redecide, option_shadow_redecide,
//                                         option_shadow_stage_redecide_game_<game>, option_shadow_stage_redecide_cpu
//   horse_error_log                       errors in the window

export const OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,99}$/;
export const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
export const RELEASE_PREFIX_RE = /^[0-9a-f]{7,40}$/;
export const ACTED_PREFIX_RE = /^[a-z][a-z0-9_]{2,99}$/;

/** LATENCY_BUCKET_MS of BrainTelemetry: 10 buckets, <=1 <=2 <=5 <=10 <=15 <=25 <=50 <=100 <=200 >200. */
export const LATENCY_BUCKET_MS = Object.freeze([1, 2, 5, 10, 15, 25, 50, 100, 200]);
/** A re-decision share over 100 ms at or above this makes the trial DIRTY. */
export const OVER_100_MS_DIRTY_PCT = 1;

/**
 * The receipts an option fires only when it ACTS. In shadow the acted decision passes nothing for the option and
 * the re-decision runs with telemetry suspended, so any of these in the window is an acted leak (must be 0).
 * `unlessOn`: the leak check does not apply while one of these options (or the option itself) is on or on_shadow.
 */
export const ACTED_RECEIPTS = Object.freeze({
  omahaMathCorePlo5Flop: Object.freeze({
    prefixes: Object.freeze(['omaha_math_core_']),
    unlessOn: Object.freeze(['omahaMathCore']),
  }),
  holdemValueAndCallsArePriced: Object.freeze({
    prefixes: Object.freeze(['holdem_priced_']),
    unlessOn: Object.freeze([]),
  }),
  holdemTournamentAllInCallIsPriced: Object.freeze({
    prefixes: Object.freeze(['holdem_tournament_all_in_call_', 'holdem_tournament_postflop_']),
    unlessOn: Object.freeze([]),
  }),
  cashDefenceTrimColdCalls: Object.freeze({
    prefixes: Object.freeze(['cash_defence_trim_cold_calls_']),
    unlessOn: Object.freeze([]),
  }),
});

/** The counters of the stage and the shadow that are not the option's own (one shadow row globally). */
export const GUARD_FEATURES = Object.freeze({
  breaker: 'option_shadow_stage_self_disabled_seen',
  breakerSkips: 'option_shadow_skipped_stage_disabled_seen',
  redecideFailed: 'option_shadow_redecide_failed_seen',
  unencodable: 'option_shadow_unencodable_seen',
  scaleMismatch: 'option_shadow_scale_mismatch_seen',
  receiptDropped: 'option_shadow_stage_receipt_dropped_seen',
  wallOnlySlow: 'option_shadow_stage_wall_only_slow_seen',
});

export const USAGE = `Usage:
  node scripts/ops/horse-option-shadow-watch.mjs <option> --since <ISO-8601 UTC, e.g. 2026-11-24T15:00:00Z>
      [--release <sha prefix>] [--acted-prefix <receipt prefix>]... [--json]

Read-only: SELECTs only, through \`supabase db query --linked\`. Prints the option's switch row, re-decisions,
agree/disagree (all and with a person dealt in), disagreement by direction, the stage breaker and guards, acted
leaks (must be 0), errors, re-decision latency over 100 ms, and one line VERDICT=CLEAN|DIRTY. Exit 0 CLEAN, 1 DIRTY,
2 when it cannot run.
`;

export function parseWatchArgs(argv) {
  const out = {
    option: null,
    since: null,
    release: null,
    actedPrefixes: [],
    json: false,
    help: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const a = args.shift();
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--since') out.since = args.shift() ?? '';
    else if (a === '--release') out.release = args.shift() ?? '';
    else if (a === '--acted-prefix') out.actedPrefixes.push(args.shift() ?? '');
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (out.option === null) out.option = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (out.help) return out;
  if (!out.option || !OPTION_NAME_RE.test(out.option))
    throw new Error(`invalid or missing option name: ${out.option ?? ''}`);
  if (!out.since || !SINCE_RE.test(out.since) || Number.isNaN(Date.parse(out.since)))
    throw new Error(`invalid or missing --since (ISO-8601 UTC ending in Z): ${out.since ?? ''}`);
  if (out.release !== null && !RELEASE_PREFIX_RE.test(out.release))
    throw new Error(`invalid --release (7-40 lowercase hex): ${out.release}`);
  for (const p of out.actedPrefixes)
    if (!ACTED_PREFIX_RE.test(p)) throw new Error(`invalid --acted-prefix: ${p}`);
  return out;
}

/** The acted receipt prefixes and the options that lift the leak check, for an option. */
export function actedReceiptsFor(option, extraPrefixes = []) {
  const known = Object.hasOwn(ACTED_RECEIPTS, option) ? ACTED_RECEIPTS[option] : null;
  const prefixes = [...new Set([...(known?.prefixes ?? []), ...extraPrefixes])];
  return { prefixes, unlessOn: [...(known?.unlessOn ?? [])], known: prefixes.length > 0 };
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const likeLit = (prefix) => lit(`${String(prefix).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/** The read-only SELECTs of one watch. Every input is validated by parseWatchArgs first. */
export function buildWatchQueries({ option, since, release = null, actedPrefixes = [] }) {
  if (!OPTION_NAME_RE.test(option)) throw new Error('unsafe option name');
  if (!SINCE_RE.test(since)) throw new Error('unsafe since');
  if (release !== null && !RELEASE_PREFIX_RE.test(release)) throw new Error('unsafe release');
  const acted = actedReceiptsFor(option, actedPrefixes);
  const switchNames = [option, ...acted.unlessOn];
  const window = `r.collected_at >= ${lit(since)}::timestamptz${
    release ? ` AND r.source_release LIKE ${likeLit(release)}` : ''
  }`;
  const featureFilters = [
    `e->>'feature' LIKE ${likeLit('option_shadow_')}`,
    ...acted.prefixes.map((p) => `e->>'feature' LIKE ${likeLit(p)}`),
  ].join(' OR ');
  return {
    switchRows: `SELECT option, state, updated_at FROM ca_horse_style_switch WHERE option IN (${switchNames
      .map(lit)
      .join(', ')}) ORDER BY option;`,
    workers: `SELECT count(DISTINCT r.worker_id) AS workers, count(*) AS receipts, min(r.collected_at) AS first_at, max(r.collected_at) AS last_at FROM horse_brain_flush_receipts r WHERE ${window};`,
    fires: `SELECT e->>'feature' AS feature, sum((e->>'fires')::bigint) AS fires FROM horse_brain_flush_receipts r, LATERAL jsonb_array_elements(r.fires) e WHERE ${window} AND (${featureFilters}) GROUP BY 1 ORDER BY 1;`,
    latency: `SELECT e->>'scope' AS scope, sum((e->>'samples')::bigint) AS samples, sum((e->>'totalMs')::double precision) AS total_ms, max((e->>'maxMs')::double precision) AS max_ms, ${Array.from(
      { length: 10 },
      (_, i) => `sum((e->'buckets'->>${i})::bigint) AS b${i}`
    ).join(
      ', '
    )} FROM horse_brain_flush_receipts r, LATERAL jsonb_array_elements(r.latency) e WHERE ${window} AND (e->>'scope' LIKE ${likeLit(
      'option_shadow_'
    )}) GROUP BY 1 ORDER BY 1;`,
    errors: `SELECT error_type, count(*) AS n, max(created_at) AS last_at FROM horse_error_log WHERE created_at >= ${lit(
      since
    )}::timestamptz GROUP BY 1 ORDER BY 2 DESC;`,
  };
}

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** The upper edge of the bucket the quantile falls in (an over-estimate, as BrainTelemetry's percentile). */
export function histogramQuantile(buckets, maxMs, q) {
  const n = buckets.reduce((a, b) => a + b, 0);
  if (n === 0) return null;
  const need = Math.ceil(q * n);
  let acc = 0;
  for (let i = 0; i < buckets.length; i++) {
    acc += buckets[i];
    if (acc >= need) return i < LATENCY_BUCKET_MS.length ? LATENCY_BUCKET_MS[i] : maxMs;
  }
  return maxMs;
}

function latencyRow(r) {
  const buckets = Array.from({ length: 10 }, (_, i) => num(r[`b${i}`]));
  const samples = num(r.samples);
  const maxMs = num(r.max_ms);
  const over100 = buckets[8] + buckets[9];
  return {
    scope: String(r.scope),
    samples,
    avgMs: samples ? num(r.total_ms) / samples : 0,
    p50Ms: histogramQuantile(buckets, maxMs, 0.5),
    p95Ms: histogramQuantile(buckets, maxMs, 0.95),
    maxMs,
    over50: buckets[7] + over100,
    over100,
    over100Pct: samples ? (100 * over100) / samples : 0,
  };
}

/**
 * The report of one watch from the rows of buildWatchQueries. Pure. The VERDICT is DIRTY when any of: no
 * re-decision in the window, an acted leak, the breaker tripped, a re-decision failed or could not be encoded, an
 * error in horse_error_log, re-decisions over 100 ms at 1% or more, or the acted-leak check cannot be made (no
 * acted receipt known for the option and none given with --acted-prefix, while it is in shadow).
 */
export function evaluateWatch({ option, since, release = null, actedPrefixes = [] }, rows) {
  const fires = new Map();
  for (const r of rows.fires ?? []) fires.set(String(r.feature), num(r.fires));
  const f = (k) => fires.get(k) ?? 0;
  const own = `option_shadow_${option}_`;
  const changed = f(`${own}changed_seen`);
  const same = f(`${own}same_seen`);
  const changedPerson = f(`${own}changed_person_seen`);
  const samePerson = f(`${own}same_person_seen`);
  const redecisions = changed + same;
  const personHands = changedPerson + samePerson;
  const directions = [];
  for (const [k, v] of fires) {
    if (!k.startsWith(`${own}dir_`) || !k.endsWith('_seen') || k.endsWith('_person_seen')) continue;
    const dir = k.slice(`${own}dir_`.length, -'_seen'.length);
    directions.push({ direction: dir, all: v, person: f(`${own}dir_${dir}_person_seen`) });
  }
  directions.sort((a, b) => b.all - a.all || a.direction.localeCompare(b.direction));
  const directionTotal = directions.reduce((a, d) => a + d.all, 0);
  const guards = Object.fromEntries(
    Object.entries(GUARD_FEATURES).map(([k, feat]) => [k, f(feat)])
  );
  const skips = [...fires]
    .filter(
      ([k]) =>
        k.startsWith('option_shadow_skipped_') ||
        k === 'option_shadow_rate_person_over_seen' ||
        k === 'option_shadow_rotated_out_seen'
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([feature, n]) => ({ feature, n }));
  const others = [...fires]
    .filter(
      ([k]) =>
        k.startsWith('option_shadow_') && /_(changed|same)_seen$/.test(k) && !k.startsWith(own)
    )
    .map(([feature, n]) => ({ feature, n }));

  const switchRows = (rows.switchRows ?? []).map((r) => ({
    option: String(r.option),
    state: String(r.state),
    updatedAt: r.updated_at ?? null,
  }));
  const stateOf = (name) => switchRows.find((r) => r.option === name)?.state ?? null;
  const optionState = stateOf(option);
  const acted = actedReceiptsFor(option, actedPrefixes);
  const lifted = [option, ...acted.unlessOn].some((n) =>
    ['on', 'on_shadow'].includes(stateOf(n) ?? '')
  );
  const leakRows = [...fires]
    .filter(([k]) => acted.prefixes.some((p) => k.startsWith(p)))
    .map(([feature, n]) => ({ feature, n }));
  const actedLeaks = leakRows.reduce((a, r) => a + r.n, 0);
  const leakCheck = lifted ? 'lifted' : acted.known ? 'checked' : 'unknown';

  const latency = (rows.latency ?? []).map(latencyRow);
  const redecideScopes = latency.filter(
    (l) =>
      l.scope === 'option_shadow_stage_redecide' ||
      l.scope === 'option_shadow_redecide' ||
      l.scope.startsWith('option_shadow_stage_redecide_game_')
  );
  const primary = latency.filter(
    (l) => l.scope === 'option_shadow_stage_redecide' || l.scope === 'option_shadow_redecide'
  );
  const primarySamples = primary.reduce((a, l) => a + l.samples, 0);
  const over100 = primary.reduce((a, l) => a + l.over100, 0);
  const over100Pct = primarySamples ? (100 * over100) / primarySamples : 0;
  const errors = (rows.errors ?? []).map((r) => ({
    errorType: String(r.error_type),
    n: num(r.n),
    lastAt: r.last_at ?? null,
  }));
  const errorTotal = errors.reduce((a, e) => a + e.n, 0);
  const w = (rows.workers ?? [])[0] ?? {};

  const reasons = [];
  if (redecisions === 0) reasons.push('no_redecisions');
  if (leakCheck === 'checked' && actedLeaks > 0) reasons.push('acted_leak');
  if (leakCheck === 'unknown') reasons.push('acted_leak_unchecked');
  if (guards.breaker > 0) reasons.push('breaker');
  if (guards.redecideFailed > 0) reasons.push('redecide_failed');
  if (guards.unencodable > 0) reasons.push('unencodable');
  if (errorTotal > 0) reasons.push('errors');
  if (over100Pct >= OVER_100_MS_DIRTY_PCT) reasons.push('latency_over_100ms');
  return {
    option,
    since,
    release,
    optionState,
    switchRows,
    workers: {
      workers: num(w.workers),
      receipts: num(w.receipts),
      firstAt: w.first_at ?? null,
      lastAt: w.last_at ?? null,
    },
    redecisions,
    changed,
    same,
    disagreePct: redecisions ? (100 * changed) / redecisions : 0,
    personHands,
    changedPerson,
    samePerson,
    directions,
    directionTotal,
    guards,
    skips,
    others,
    actedLeaks,
    leakRows,
    leakCheck,
    actedPrefixes: acted.prefixes,
    latency: redecideScopes,
    over100,
    over100Pct,
    errors,
    errorTotal,
    verdict: reasons.length === 0 ? 'CLEAN' : 'DIRTY',
    reasons,
  };
}

const pct = (n) => `${n.toFixed(2)}%`;
const ms = (n) => (n === null ? 'n/a' : `${Number(n).toFixed(1)}ms`);

/** The printed report: one section per question and the VERDICT line last. */
export function formatWatchReport(rep) {
  const L = [];
  L.push(
    `SHADOW WATCH ${rep.option} since=${rep.since}${rep.release ? ` release=${rep.release}*` : ''}`
  );
  L.push('--- switch rows ---');
  if (rep.switchRows.length === 0)
    L.push(`  (no row for ${rep.option}: release default, nothing in shadow)`);
  for (const r of rep.switchRows)
    L.push(`  ${r.option} state=${r.state} updated_at=${r.updatedAt}`);
  L.push(
    `--- flush receipts: workers=${rep.workers.workers} receipts=${rep.workers.receipts} first=${rep.workers.firstAt} last=${rep.workers.lastAt}`
  );
  L.push('--- re-decisions ---');
  L.push(
    `  all     re-decisions=${rep.redecisions} agree(same)=${rep.same} disagree(changed)=${rep.changed} (${pct(rep.disagreePct)})`
  );
  L.push(
    `  person  hands reached=${rep.personHands} agree=${rep.samePerson} disagree=${rep.changedPerson}`
  );
  L.push(`  horse   re-decisions=${rep.redecisions - rep.personHands}`);
  L.push("--- disagree by direction (hold'em stage) ---");
  if (rep.directions.length === 0) L.push('  (none)');
  for (const d of rep.directions)
    L.push(`  ${d.direction.padEnd(18)} all=${d.all} person=${d.person}`);
  if (rep.directions.length > 0 && rep.directionTotal !== rep.changed)
    L.push(
      `  (directions ${rep.directionTotal} of ${rep.changed} changed: PLO and inline re-decisions count no direction)`
    );
  L.push('--- breaker and guards ---');
  L.push(
    `  breaker(self_disabled)=${rep.guards.breaker} stage_disabled_skips=${rep.guards.breakerSkips} redecide_failed=${rep.guards.redecideFailed} unencodable=${rep.guards.unencodable} scale_mismatch=${rep.guards.scaleMismatch} receipt_dropped=${rep.guards.receiptDropped} wall_only_slow=${rep.guards.wallOnlySlow}`
  );
  for (const s of rep.skips) L.push(`  ${s.feature} = ${s.n}`);
  for (const o of rep.others) L.push(`  other option: ${o.feature} = ${o.n}`);
  L.push('--- acted leaks (must be 0) ---');
  if (rep.leakCheck === 'lifted')
    L.push(`  not applicable: the option or a companion is on/on_shadow (acted receipts expected)`);
  else if (rep.leakCheck === 'unknown')
    L.push('  UNCHECKED: no acted receipt known for this option; pass --acted-prefix <prefix>');
  else L.push(`  acted_leaks=${rep.actedLeaks} (prefixes ${rep.actedPrefixes.join(', ')})`);
  for (const r of rep.leakRows) L.push(`    ${r.feature} = ${r.n}`);
  L.push('--- errors (horse_error_log) ---');
  if (rep.errors.length === 0) L.push('  0');
  for (const e of rep.errors) L.push(`  ${e.errorType} n=${e.n} last=${e.lastAt}`);
  L.push('--- re-decision latency (over 100 ms) ---');
  if (rep.latency.length === 0) L.push('  (no re-decision timings in the window)');
  for (const l of rep.latency)
    L.push(
      `  ${l.scope.padEnd(46)} n=${l.samples} avg=${ms(l.avgMs)} p50<=${ms(l.p50Ms)} p95<=${ms(l.p95Ms)} max=${ms(l.maxMs)} >50ms=${l.over50} >100ms=${l.over100} (${pct(l.over100Pct)})`
    );
  L.push(
    `VERDICT=${rep.verdict} option=${rep.option} redecisions=${rep.redecisions} person=${rep.personHands} disagree=${pct(rep.disagreePct)} breaker=${rep.guards.breaker} acted_leaks=${rep.leakCheck === 'checked' ? rep.actedLeaks : rep.leakCheck} errors=${rep.errorTotal} over100ms=${rep.over100}${rep.reasons.length ? ` reasons=${rep.reasons.join(',')}` : ''}`
  );
  return L.join('\n');
}
