// scripts/ops/shadow-read-report-lib.mjs
// Pure, deterministic core logic for the Horse live shadow readback CLI.
// Zero production I/O or secret reads: all database and /health inputs are passed in.

import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_HEALTH_URL = 'https://engine.smarter.poker/health';
export const DEFAULT_FALLBACK_WINDOW_MINUTES = 60;
export const COMPLETED_SHADOW_FLUSH_GRACE_MS = 90_000;
export const STARVATION_MIN_SAMPLES = 100;
export const STARVATION_ALERT_PCT = 1.0;
export const WILSON_Z_95 = 1.959963984540054;

export const SHADOW_STATES = Object.freeze(['shadow', 'on_shadow']);
export const VERDICTS = Object.freeze(['HEALTHY_ACTIVE', 'HEALTHY_IDLE', 'ROLLBACK_TRIGGERED']);

export const OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,99}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i;
const MUTATING_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|MERGE|REPLACE)\b/i;

// --- Validators & SQL safety -------------------------------------------------------------------

export function assertSafeOptionName(option) {
  if (typeof option !== 'string' || !OPTION_NAME_RE.test(option.trim())) {
    throw new Error(`Invalid option name "${String(option)}": must match ${OPTION_NAME_RE.source}`);
  }
  return option.trim();
}

export function validateIsoTimestamp(raw, label = '--since') {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid ${label}: expected ISO-8601 UTC timestamp string`);
  }
  const trimmed = raw.trim();
  if (!ISO_TIMESTAMP_RE.test(trimmed)) {
    throw new Error(
      `Invalid ${label} "${raw}": must be an ISO-8601 timestamp with timezone (e.g. 2026-11-22T15:00:00Z)`
    );
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid ${label} "${raw}": unparseable timestamp`);
  }
  return new Date(ms).toISOString();
}

export function validateHealthUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Invalid --health-url: expected non-empty http(s) URL');
  }
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid --health-url "${raw}": malformed URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid --health-url "${raw}": protocol must be http: or https:`);
  }
  return parsed.toString();
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL query must be a non-empty string');
  }
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error('Refusing non-SELECT SQL in read-only shadow report');
  }
  const withoutStrings = trimmed.replace(/'(?:''|[^'])*'/g, "''");
  if (withoutStrings.includes(';')) {
    throw new Error('Refusing multi-statement SQL in read-only shadow report');
  }
  if (MUTATING_SQL_RE.test(withoutStrings)) {
    throw new Error('Refusing mutating SQL keyword in read-only shadow report');
  }
  return trimmed;
}

export function sqlLiteral(value) {
  if (typeof value !== 'string') {
    throw new Error(`sqlLiteral expects a string, got ${typeof value}`);
  }
  if (value.includes('\0')) {
    throw new Error('sqlLiteral refuses strings containing NUL bytes');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

// --- CLI argument parsing & Supabase CLI helpers -----------------------------------------------

export function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let option = null;
  let since = null;
  let until = null;
  let healthUrl = DEFAULT_HEALTH_URL;
  let supabaseWorkdir = null;
  let skipHealth = false;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--skip-health') {
      skipHealth = true;
    } else if (arg === '--since') {
      const next = args[++i];
      if (!next) throw new Error('--since requires an ISO-8601 timestamp argument');
      since = validateIsoTimestamp(next, '--since');
    } else if (arg.startsWith('--since=')) {
      since = validateIsoTimestamp(arg.slice('--since='.length), '--since');
    } else if (arg === '--until') {
      const next = args[++i];
      if (!next) throw new Error('--until requires an ISO-8601 timestamp argument');
      until = validateIsoTimestamp(next, '--until');
    } else if (arg.startsWith('--until=')) {
      until = validateIsoTimestamp(arg.slice('--until='.length), '--until');
    } else if (arg === '--health-url') {
      const next = args[++i];
      if (!next) throw new Error('--health-url requires a URL argument');
      healthUrl = validateHealthUrl(next);
    } else if (arg.startsWith('--health-url=')) {
      healthUrl = validateHealthUrl(arg.slice('--health-url='.length));
    } else if (arg === '--supabase-workdir') {
      const next = args[++i];
      if (!next) throw new Error('--supabase-workdir requires a directory path');
      supabaseWorkdir = next;
    } else if (arg.startsWith('--supabase-workdir=')) {
      supabaseWorkdir = arg.slice('--supabase-workdir='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (option === null) {
      option = assertSafeOptionName(arg);
    } else {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }
  }

  if (!help && option === null) {
    throw new Error('Missing required <option> positional argument');
  }

  if (since && until && Date.parse(until) < Date.parse(since)) {
    throw new Error(`Invalid window: --until (${until}) is earlier than --since (${since})`);
  }

  return {
    option,
    since,
    until,
    healthUrl,
    supabaseWorkdir,
    skipHealth,
    json,
    help,
  };
}

export function resolveLinkedSupabaseWorkdir({
  cwd = process.cwd(),
  gitCommonDirRunner,
  pathExists = existsSync,
} = {}) {
  const localRef = path.join(cwd, 'supabase', '.temp', 'project-ref');
  if (pathExists(localRef)) {
    return cwd;
  }
  if (typeof gitCommonDirRunner === 'function') {
    const rawCommon = String(gitCommonDirRunner(cwd) ?? '').trim();
    if (rawCommon) {
      const resolvedCommon = path.isAbsolute(rawCommon) ? rawCommon : path.resolve(cwd, rawCommon);
      const primaryCheckout = path.dirname(resolvedCommon);
      if (pathExists(path.join(primaryCheckout, 'supabase', '.temp', 'project-ref'))) {
        return primaryCheckout;
      }
      return primaryCheckout;
    }
  }
  return cwd;
}

export function parseSupabaseJsonOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new Error('Supabase query returned empty output');
  }
  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(text);
  if (parsed === undefined) {
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      parsed = tryParse(text.slice(firstBracket, lastBracket + 1));
    }
  }
  if (parsed === undefined) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParse(text.slice(firstBrace, lastBrace + 1));
    }
  }
  if (parsed === undefined) {
    throw new Error(`Failed to parse Supabase JSON output: ${text.slice(0, 200)}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new Error('Unexpected JSON shape from Supabase query output');
}

// --- Read-only SQL builders --------------------------------------------------------------------

export function buildOptionStateAndAuditSql(option) {
  const safeOpt = assertSafeOptionName(option);
  const optLit = sqlLiteral(safeOpt);
  return assertReadOnlySql(`
SELECT json_build_object(
  'switchRow', (
    SELECT row_to_json(s)
    FROM (
      SELECT option, state, updated_by, updated_at, note
      FROM public.ca_horse_style_switch
      WHERE option = ${optLit}
      LIMIT 1
    ) s
  ),
  'auditRows', (
    SELECT COALESCE(json_agg(row_to_json(a)), '[]'::json)
    FROM (
      SELECT id, option, old_state, new_state, changed_by, changed_at, note
      FROM public.ca_horse_style_switch_audit
      WHERE option = ${optLit}
      ORDER BY changed_at DESC, id DESC
      LIMIT 20
    ) a
  )
) AS meta
`);
}

export function buildShadowWindowBatchSql({ option, since, until }) {
  const safeOpt = assertSafeOptionName(option);
  const safeSince = validateIsoTimestamp(since, 'since');
  const safeUntil = validateIsoTimestamp(until, 'until');
  const sinceLit = sqlLiteral(safeSince);
  const untilLit = sqlLiteral(safeUntil);

  const pickupLikeLit = sqlLiteral(`option\\_switch\\_${safeOpt}\\_%\\_seen`);
  const shadowLikeLit = sqlLiteral(`option\\_shadow\\_${safeOpt}\\_%`);
  const shadowExactFeatures = [
    `option_shadow_${safeOpt}_same_seen`,
    `option_shadow_${safeOpt}_changed_seen`,
    `option_shadow_${safeOpt}_same_person_seen`,
    `option_shadow_${safeOpt}_changed_person_seen`,
  ]
    .map(sqlLiteral)
    .join(', ');

  return assertReadOnlySql(`
WITH window_receipts AS (
  SELECT worker_id, collected_at, fires, latency
  FROM public.horse_brain_flush_receipts
  WHERE collected_at >= ${sinceLit}::timestamptz
    AND collected_at <= ${untilLit}::timestamptz
),
expanded_fires AS (
  SELECT
    r.worker_id,
    f->>'feature' AS feature,
    COALESCE((f->>'fires')::bigint, 0) AS fires
  FROM window_receipts r,
       LATERAL jsonb_array_elements(r.fires) f
  WHERE jsonb_typeof(r.fires) = 'array'
),
filtered_fires AS (
  SELECT
    feature,
    sum(fires)::bigint AS fires,
    count(DISTINCT worker_id)::bigint AS distinct_workers
  FROM expanded_fires
  WHERE fires > 0
    AND (
      feature LIKE ${pickupLikeLit} ESCAPE '\\'
      OR feature LIKE ${shadowLikeLit} ESCAPE '\\'
      OR feature LIKE 'option\\_shadow\\_skipped\\_%' ESCAPE '\\'
      OR feature LIKE 'option\\_shadow\\_stage\\_%' ESCAPE '\\'
      OR feature IN (
        'option_shadow_redecide_failed_seen',
        'option_shadow_scale_mismatch_seen',
        'option_shadow_unencodable_seen',
        'option_shadow_rotated_out_seen',
        'option_shadow_rate_person_over_seen',
        'style_shadow_redecide_failed_seen',
        'horse_decision_refused_isolated',
        'phase15_execution_fallback'
      )
      OR feature LIKE 'option\\_switch\\_config\\_%' ESCAPE '\\'
      OR feature ILIKE '%alarm%'
      OR feature ILIKE '%illegal%'
      OR feature ILIKE '%exception%'
      OR feature ILIKE '%breaker%'
    )
  GROUP BY feature
),
expanded_latency AS (
  SELECT
    elem->>'scope' AS scope,
    COALESCE((elem->>'samples')::bigint, 0) AS samples,
    COALESCE((elem->>'totalMs')::double precision, 0) AS total_ms,
    COALESCE((elem->>'maxMs')::double precision, 0) AS max_ms,
    COALESCE((elem->'buckets'->>8)::bigint, 0) + COALESCE((elem->'buckets'->>9)::bigint, 0) AS over100
  FROM window_receipts r,
       LATERAL jsonb_array_elements(r.latency) elem
  WHERE jsonb_typeof(r.latency) = 'array'
),
grouped_latency AS (
  SELECT
    scope,
    sum(samples)::bigint AS samples,
    (sum(total_ms) / NULLIF(sum(samples), 0))::double precision AS avg_ms,
    max(max_ms)::double precision AS max_ms,
    sum(over100)::bigint AS over100
  FROM expanded_latency
  WHERE scope IS NOT NULL AND scope <> ''
  GROUP BY scope
  ORDER BY
    (scope IN ('nlh', 'style_read', 'option_shadow_redecide', 'option_shadow_stage_redecide', 'style_shadow_redecide')) DESC,
    sum(over100) DESC,
    sum(samples) DESC
  LIMIT 60
)
SELECT json_build_object(
  'receiptSummary', (
    SELECT row_to_json(rs)
    FROM (
      SELECT
        count(*)::bigint AS receipt_count,
        count(DISTINCT worker_id)::bigint AS active_workers,
        min(collected_at) AS first_collected_at,
        max(collected_at) AS last_collected_at
      FROM window_receipts
    ) rs
  ),
  'receiptFires', (
    SELECT COALESCE(json_agg(row_to_json(ff) ORDER BY ff.fires DESC, ff.feature ASC), '[]'::json)
    FROM filtered_fires ff
  ),
  'telemetryPickup', (
    SELECT COALESCE(json_agg(row_to_json(tp) ORDER BY tp.day DESC, tp.feature ASC), '[]'::json)
    FROM (
      SELECT day::text AS day, feature, fires::bigint AS fires, updated_at
      FROM public.horse_brain_telemetry
      WHERE day >= (${sinceLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND day <= (${untilLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND feature LIKE ${pickupLikeLit} ESCAPE '\\'
    ) tp
  ),
  'telemetryShadow', (
    SELECT COALESCE(json_agg(row_to_json(ts) ORDER BY ts.day DESC, ts.feature ASC), '[]'::json)
    FROM (
      SELECT day::text AS day, feature, fires::bigint AS fires, updated_at
      FROM public.horse_brain_telemetry
      WHERE day >= (${sinceLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND day <= (${untilLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND feature IN (${shadowExactFeatures})
    ) ts
  ),
  'telemetryFallbackSafetyAndSkips', (
    SELECT COALESCE(json_agg(row_to_json(tf) ORDER BY tf.fires DESC, tf.feature ASC), '[]'::json)
    FROM (
      SELECT day::text AS day, feature, fires::bigint AS fires, updated_at
      FROM public.horse_brain_telemetry
      WHERE day >= (${sinceLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND day <= (${untilLit}::timestamptz AT TIME ZONE 'UTC')::date
        AND updated_at >= ${sinceLit}::timestamptz
        AND fires > 0
        AND (
          feature LIKE 'option\\_shadow\\_skipped\\_%' ESCAPE '\\'
          OR feature LIKE 'option\\_shadow\\_stage\\_%' ESCAPE '\\'
          OR feature IN (
            'option_shadow_redecide_failed_seen',
            'option_shadow_scale_mismatch_seen',
            'option_shadow_unencodable_seen',
            'option_shadow_rotated_out_seen',
            'option_shadow_rate_person_over_seen',
            'style_shadow_redecide_failed_seen',
            'horse_decision_refused_isolated',
            'phase15_execution_fallback'
          )
          OR feature LIKE 'option\\_switch\\_config\\_%' ESCAPE '\\'
          OR feature ILIKE '%alarm%'
          OR feature ILIKE '%illegal%'
          OR feature ILIKE '%exception%'
          OR feature ILIKE '%breaker%'
        )
      LIMIT 100
    ) tf
  ),
  'errorLog', (
    SELECT json_build_object(
      'count', (
        SELECT count(*)::bigint
        FROM public.horse_error_log
        WHERE created_at >= ${sinceLit}::timestamptz
          AND created_at <= ${untilLit}::timestamptz
      ),
      'recent', (
        SELECT COALESCE(json_agg(row_to_json(el)), '[]'::json)
        FROM (
          SELECT id, horse_id, error_type, error_message, created_at
          FROM public.horse_error_log
          WHERE created_at >= ${sinceLit}::timestamptz
            AND created_at <= ${untilLit}::timestamptz
          ORDER BY created_at DESC
          LIMIT 10
        ) el
      )
    )
  ),
  'latency', (
    SELECT COALESCE(json_agg(row_to_json(gl)), '[]'::json)
    FROM grouped_latency gl
  )
) AS snapshot
`);
}

// --- Window resolution -------------------------------------------------------------------------

function parseTimestampMs(raw) {
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function resolveShadowWindow({
  switchRow = null,
  auditRows = [],
  explicitSince = null,
  explicitUntil = null,
  nowMs = Date.now(),
}) {
  const orderedAudits = (Array.isArray(auditRows) ? auditRows : [])
    .filter((row) => row && parseTimestampMs(row.changed_at) !== null)
    .slice()
    .sort((a, b) => {
      const diff = parseTimestampMs(b.changed_at) - parseTimestampMs(a.changed_at);
      if (diff !== 0) return diff;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

  const latestAudit = orderedAudits[0] ?? null;
  const latestShadowTransition =
    orderedAudits.find((row) => SHADOW_STATES.includes(String(row.new_state ?? ''))) ?? null;

  let sinceMs;
  let sinceSource;
  if (explicitSince) {
    sinceMs = Date.parse(validateIsoTimestamp(explicitSince, '--since'));
    sinceSource = 'cli_arg';
  } else if (latestShadowTransition) {
    sinceMs = parseTimestampMs(latestShadowTransition.changed_at);
    sinceSource = 'audit_shadow_transition';
  } else if (latestAudit) {
    sinceMs = parseTimestampMs(latestAudit.changed_at);
    sinceSource = 'audit_latest_transition';
  } else if (switchRow && parseTimestampMs(switchRow.updated_at) !== null) {
    sinceMs = parseTimestampMs(switchRow.updated_at);
    sinceSource = 'switch_updated_at';
  } else {
    sinceMs = nowMs - DEFAULT_FALLBACK_WINDOW_MINUTES * 60_000;
    sinceSource = 'fallback_60m';
  }

  const currentState = switchRow?.state ? String(switchRow.state) : null;
  const isCurrentlyShadow = currentState !== null && SHADOW_STATES.includes(currentState);

  // If the shadow run already exited (latestShadowTransition followed by an exit audit row),
  // locate the earliest exit transition strictly after latestShadowTransition.
  let shadowExitRow = null;
  if (latestShadowTransition && !isCurrentlyShadow) {
    const shadowStartMs = parseTimestampMs(latestShadowTransition.changed_at);
    const exitsAfter = orderedAudits
      .filter((row) => {
        const ts = parseTimestampMs(row.changed_at);
        if (ts === null || ts < shadowStartMs) return false;
        if (row.id !== undefined && row.id === latestShadowTransition.id) return false;
        return (
          SHADOW_STATES.includes(String(row.old_state ?? '')) &&
          !SHADOW_STATES.includes(String(row.new_state ?? ''))
        );
      })
      .sort((a, b) => parseTimestampMs(a.changed_at) - parseTimestampMs(b.changed_at));
    shadowExitRow = exitsAfter[0] ?? null;
  }

  let untilMs;
  let untilSource;
  let shadowRunCompleted = false;
  if (explicitUntil) {
    untilMs = Date.parse(validateIsoTimestamp(explicitUntil, '--until'));
    untilSource = 'cli_arg';
    shadowRunCompleted = Boolean(shadowExitRow);
  } else if (!explicitSince && sinceSource === 'audit_shadow_transition' && shadowExitRow) {
    const exitMs = parseTimestampMs(shadowExitRow.changed_at);
    untilMs = Math.min(nowMs, exitMs + COMPLETED_SHADOW_FLUSH_GRACE_MS);
    untilSource = 'audit_shadow_exit_plus_flush_grace';
    shadowRunCompleted = true;
  } else {
    untilMs = nowMs;
    untilSource = 'now';
    shadowRunCompleted = Boolean(shadowExitRow && !isCurrentlyShadow);
  }

  if (untilMs < sinceMs) {
    untilMs = sinceMs;
  }

  const elapsedMs = Math.max(0, untilMs - sinceMs);
  const elapsedMinutes = Math.round((elapsedMs / 60_000) * 100) / 100;

  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    sinceSource,
    untilSource,
    elapsedMinutes,
    elapsedLabel: formatElapsedLabel(elapsedMinutes),
    shadowRunCompleted,
    shadowTransitionState: latestShadowTransition?.new_state
      ? String(latestShadowTransition.new_state)
      : null,
    shadowStartedAt: latestShadowTransition?.changed_at
      ? new Date(parseTimestampMs(latestShadowTransition.changed_at)).toISOString()
      : null,
    shadowExitedAt: shadowExitRow?.changed_at
      ? new Date(parseTimestampMs(shadowExitRow.changed_at)).toISOString()
      : null,
    latestAudit,
  };
}

export function formatElapsedLabel(elapsedMinutes) {
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return '+0m';
  if (elapsedMinutes < 1) {
    return `+${Math.round(elapsedMinutes * 60)}s`;
  }
  return `+${Math.round(elapsedMinutes)}m`;
}

// --- Statistics: Wilson 95% CI & shadow counters -----------------------------------------------

function roundNum(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function computeWilson95(successes, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n === 0) {
    return {
      rate: null,
      ratePct: null,
      ci95Low: null,
      ci95High: null,
      ci95LowPct: null,
      ci95HighPct: null,
    };
  }
  const k = Math.min(n, Math.max(0, Math.floor(Number(successes) || 0)));
  const p = k / n;
  const z = WILSON_Z_95;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfWidth = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  const low = Math.max(0, center - halfWidth);
  const high = Math.min(1, center + halfWidth);

  return {
    rate: roundNum(p, 6),
    ratePct: roundNum(p * 100, 2),
    ci95Low: roundNum(low, 6),
    ci95High: roundNum(high, 6),
    ci95LowPct: roundNum(low * 100, 2),
    ci95HighPct: roundNum(high * 100, 2),
  };
}

// --- Evaluators --------------------------------------------------------------------------------

export function evaluateLiveHealth(health, httpStatus = 200) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return {
      status: 'degraded',
      httpStatus,
      releaseSha: null,
      liveness: null,
      settlementStatus: null,
      stalledTableCount: null,
      activeTables: null,
      maintenancePhase: null,
      decisionPhase: null,
      recoverableRequestErrors: null,
      lastRecoverableRequestError: null,
      issues: [`HTTP ${httpStatus}: /health response is not a JSON object`],
    };
  }

  const issues = [];
  if (httpStatus !== 200) {
    issues.push(`http_status=${httpStatus}`);
  }
  const rawSha =
    typeof health.releaseSha === 'string' ? health.releaseSha.trim().toLowerCase() : '';
  const releaseSha = HEX_SHA_RE.test(rawSha) ? rawSha : null;
  if (!releaseSha) {
    issues.push('releaseSha_missing_or_invalid');
  }
  if (health.liveness !== undefined && health.liveness !== 'ok') {
    issues.push(`liveness=${String(health.liveness)}`);
  }
  if (health.settlementStatus !== undefined && health.settlementStatus !== 'ok') {
    issues.push(`settlementStatus=${String(health.settlementStatus)}`);
  }
  const stalledTableCount =
    typeof health.stalledTableCount === 'number' && Number.isFinite(health.stalledTableCount)
      ? health.stalledTableCount
      : null;
  if (stalledTableCount !== null && stalledTableCount > 0) {
    issues.push(`stalledTableCount=${stalledTableCount}`);
  }
  const activeTables =
    typeof health.activeTables === 'number' && Number.isFinite(health.activeTables)
      ? health.activeTables
      : null;
  const maintenancePhase = health.maintenance?.phase ?? null;

  const lhd =
    health.liveHorseDecision &&
    typeof health.liveHorseDecision === 'object' &&
    !Array.isArray(health.liveHorseDecision)
      ? health.liveHorseDecision
      : null;
  const decisionPhase = lhd?.phase ?? null;
  if (decisionPhase !== null && decisionPhase !== 'ready') {
    issues.push(`liveHorseDecision.phase=${String(decisionPhase)}`);
  }
  const recoverableRequestErrors =
    typeof lhd?.recoverableRequestErrors === 'number' &&
    Number.isFinite(lhd.recoverableRequestErrors)
      ? lhd.recoverableRequestErrors
      : null;
  const lastRecoverableRequestError =
    typeof lhd?.lastRecoverableRequestError === 'string' && lhd.lastRecoverableRequestError.trim()
      ? lhd.lastRecoverableRequestError.trim()
      : null;
  if (recoverableRequestErrors !== null && recoverableRequestErrors > 0) {
    const errDetail = lastRecoverableRequestError ? `(${lastRecoverableRequestError})` : '';
    issues.push(
      `liveHorseDecision.recoverableRequestErrors=${recoverableRequestErrors}${errDetail}`
    );
  }

  return {
    status: issues.length === 0 ? 'ok' : 'degraded',
    httpStatus,
    releaseSha,
    liveness: health.liveness ?? null,
    settlementStatus: health.settlementStatus ?? null,
    stalledTableCount,
    activeTables,
    maintenancePhase,
    decisionPhase,
    recoverableRequestErrors,
    lastRecoverableRequestError,
    issues,
  };
}

export function classifySafetyFeature(feature) {
  if (typeof feature !== 'string' || !feature) return null;
  const lower = feature.toLowerCase();

  // Order matters: check explicit config errors and shadow breakers first.
  if (lower.startsWith('option_switch_config_') || lower.includes('config_error')) {
    return 'configError';
  }
  if (
    lower === 'option_shadow_stage_self_disabled_seen' ||
    lower === 'option_shadow_redecide_failed_seen' ||
    lower === 'style_shadow_redecide_failed_seen' ||
    lower === 'horse_decision_refused_isolated' ||
    lower.includes('breaker')
  ) {
    return 'breaker';
  }
  if (lower.includes('alarm')) {
    return 'alarm';
  }
  if (lower.includes('illegal')) {
    return 'illegal';
  }
  if (lower === 'phase15_execution_fallback' || lower.includes('exception')) {
    // Exclude benign poker-strategy rule exception counters (e.g. small_pot_near_nut_value_flat_exception).
    if (lower.endsWith('_flat_exception')) {
      return null;
    }
    return 'exception';
  }
  return null;
}

export function summarizeLatencyRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return {
      status: 'unknown',
      starvationAlert: false,
      alertedScopes: [],
      topHotNode: null,
      highlights: {
        nlh: null,
        styleRead: null,
        shadow: null,
        shadowStage: null,
        styleShadow: null,
      },
      scopes: [],
    };
  }

  const scopes = list
    .filter((r) => r && typeof r.scope === 'string' && r.scope.trim() !== '')
    .map((r) => {
      const samples = Number(r.samples) || 0;
      const over100msCount = Number(r.over100) || 0;
      const over100msPct =
        samples > 0 ? Math.round((over100msCount / samples) * 100_000) / 1000 : 0;
      const starvationAlert =
        samples >= STARVATION_MIN_SAMPLES && over100msCount * 100 > samples * STARVATION_ALERT_PCT;
      return {
        scope: r.scope,
        samples,
        avgMs: roundNum(r.avg_ms, 2),
        maxMs: roundNum(r.max_ms, 2),
        over100msCount,
        over100msPct,
        starvationAlert,
      };
    });

  const byScope = new Map(scopes.map((s) => [s.scope, s]));
  const hotNodes = scopes
    .filter((s) => s.scope.startsWith('phase15_node_') && s.over100msCount > 0)
    .sort((a, b) => b.over100msCount - a.over100msCount || (b.maxMs ?? 0) - (a.maxMs ?? 0));
  const topHotNode = hotNodes[0]?.scope ?? null;

  const alertedScopes = scopes
    .filter((s) => !s.scope.startsWith('phase15_node_') && s.starvationAlert)
    .map((s) => ({
      scope: s.scope,
      samples: s.samples,
      over100msCount: s.over100msCount,
      over100msPct: s.over100msPct,
      maxMs: s.maxMs,
    }));

  const starvationAlert = alertedScopes.length > 0;

  return {
    status: starvationAlert ? 'warn' : 'pass',
    starvationAlert,
    alertedScopes,
    topHotNode,
    highlights: {
      nlh: byScope.get('nlh') ?? null,
      styleRead: byScope.get('style_read') ?? null,
      shadow: byScope.get('option_shadow_redecide') ?? null,
      shadowStage: byScope.get('option_shadow_stage_redecide') ?? null,
      styleShadow: byScope.get('style_shadow_redecide') ?? null,
    },
    scopes: scopes.slice(0, 30),
  };
}

function indexFeatureRows(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.feature !== 'string') continue;
    const prev = map.get(row.feature) ?? {
      feature: row.feature,
      fires: 0,
      distinctWorkers: 0,
      lastUpdatedAt: null,
    };
    prev.fires += Number(row.fires) || 0;
    const workers = Number(row.distinct_workers) || 0;
    if (workers > prev.distinctWorkers) prev.distinctWorkers = workers;
    if (row.updated_at) {
      const nextMs = parseTimestampMs(row.updated_at);
      const prevMs = parseTimestampMs(prev.lastUpdatedAt);
      if (nextMs !== null && (prevMs === null || nextMs > prevMs)) {
        prev.lastUpdatedAt = new Date(nextMs).toISOString();
      }
    }
    map.set(row.feature, prev);
  }
  return map;
}

export function buildShadowReadReport({
  option,
  switchRow = null,
  auditRows = [],
  windowMeta,
  dbSnapshot = {},
  health = null,
  measuredAt = new Date().toISOString(),
}) {
  const safeOpt = assertSafeOptionName(option);
  const warnings = [];

  if (!switchRow) {
    warnings.push(`Option "${safeOpt}" has no row in public.ca_horse_style_switch`);
  }
  if (health && health.status === 'unreachable') {
    warnings.push(`Engine /health unreachable: ${health.error ?? 'unknown error'}`);
  }

  const currentState = switchRow?.state ? String(switchRow.state) : null;
  const targetPickupState =
    currentState && SHADOW_STATES.includes(currentState)
      ? currentState
      : (windowMeta.shadowTransitionState ?? currentState ?? 'shadow');
  const pickupFeature = `option_switch_${safeOpt}_${targetPickupState}_seen`;

  const receiptSummaryRaw = dbSnapshot.receiptSummary ?? {};
  const receiptCount = Number(receiptSummaryRaw.receipt_count) || 0;
  const activeWorkers = Number(receiptSummaryRaw.active_workers) || 0;
  const useReceipts = receiptCount > 0;
  const telemetrySource = useReceipts
    ? 'horse_brain_flush_receipts'
    : 'horse_brain_telemetry_fallback';

  const receiptFireMap = indexFeatureRows(dbSnapshot.receiptFires);
  const telemetryPickupMap = indexFeatureRows(dbSnapshot.telemetryPickup);
  const telemetryShadowMap = indexFeatureRows(dbSnapshot.telemetryShadow);
  const telemetryFallbackMap = indexFeatureRows(dbSnapshot.telemetryFallbackSafetyAndSkips);

  // 1. Worker pickup (horse_brain_telemetry + window flush receipts)
  const pickupTelemetryEntry = telemetryPickupMap.get(pickupFeature) ?? null;
  const pickupReceiptEntry = receiptFireMap.get(pickupFeature) ?? null;
  const pickupTelemetryCount = pickupTelemetryEntry?.fires ?? 0;
  const pickupReceiptCount = pickupReceiptEntry?.fires ?? 0;
  const pickupByState = {};
  for (const [feat, entry] of telemetryPickupMap.entries()) {
    const prefix = `option_switch_${safeOpt}_`;
    if (feat.startsWith(prefix) && feat.endsWith('_seen')) {
      const st = feat.slice(prefix.length, -'_seen'.length);
      pickupByState[st] = {
        feature: feat,
        telemetryTableCount: entry.fires,
        windowReceiptCount: receiptFireMap.get(feat)?.fires ?? 0,
        distinctWorkers: receiptFireMap.get(feat)?.distinctWorkers ?? 0,
        lastUpdatedAt: entry.lastUpdatedAt,
      };
    }
  }
  const pickup = {
    stateChecked: targetPickupState,
    feature: pickupFeature,
    count: useReceipts && pickupReceiptCount > 0 ? pickupReceiptCount : pickupTelemetryCount,
    telemetryTableCount: pickupTelemetryCount,
    windowReceiptCount: pickupReceiptCount,
    distinctWorkers: pickupReceiptEntry?.distinctWorkers ?? 0,
    lastUpdatedAt: pickupTelemetryEntry?.lastUpdatedAt ?? null,
    byState: pickupByState,
  };

  // 2. Shadow re-decision counts & Wilson 95% CIs
  const shadowSourceMap = useReceipts ? receiptFireMap : telemetryShadowMap;
  const sameFeat = `option_shadow_${safeOpt}_same_seen`;
  const changedFeat = `option_shadow_${safeOpt}_changed_seen`;
  const samePersonFeat = `option_shadow_${safeOpt}_same_person_seen`;
  const changedPersonFeat = `option_shadow_${safeOpt}_changed_person_seen`;

  const same = shadowSourceMap.get(sameFeat)?.fires ?? 0;
  const changed = shadowSourceMap.get(changedFeat)?.fires ?? 0;
  const total = same + changed;
  const samePerson = shadowSourceMap.get(samePersonFeat)?.fires ?? 0;
  const changedPerson = shadowSourceMap.get(changedPersonFeat)?.fires ?? 0;
  const totalPerson = samePerson + changedPerson;

  const overallWilson = computeWilson95(changed, total);
  const personWilson = computeWilson95(changedPerson, totalPerson);

  const shadow = {
    source: telemetrySource,
    overall: {
      same,
      changed,
      total,
      changeRate: overallWilson.rate,
      changeRatePct: overallWilson.ratePct,
      ci95Low: overallWilson.ci95Low,
      ci95High: overallWilson.ci95High,
      ci95LowPct: overallWilson.ci95LowPct,
      ci95HighPct: overallWilson.ci95HighPct,
    },
    person: {
      same: samePerson,
      changed: changedPerson,
      total: totalPerson,
      changeRate: personWilson.rate,
      changeRatePct: personWilson.ratePct,
      ci95Low: personWilson.ci95Low,
      ci95High: personWilson.ci95High,
      ci95LowPct: personWilson.ci95LowPct,
      ci95HighPct: personWilson.ci95HighPct,
    },
    horseOnly: {
      same: Math.max(0, same - samePerson),
      changed: Math.max(0, changed - changedPerson),
      total: Math.max(0, total - totalPerson),
    },
    peopleFirstShare: total > 0 ? roundNum(totalPerson / total, 6) : null,
    peopleFirstSharePct: total > 0 ? roundNum((totalPerson / total) * 100, 2) : null,
    telemetryTableTotals: {
      same: telemetryShadowMap.get(sameFeat)?.fires ?? 0,
      changed: telemetryShadowMap.get(changedFeat)?.fires ?? 0,
      samePerson: telemetryShadowMap.get(samePersonFeat)?.fires ?? 0,
      changedPerson: telemetryShadowMap.get(changedPersonFeat)?.fires ?? 0,
    },
  };

  // 3. Shadow skip counters
  const skipSourceMap = useReceipts ? receiptFireMap : telemetryFallbackMap;
  const getFire = (feat) => skipSourceMap.get(feat)?.fires ?? 0;
  const skips = {
    source: telemetrySource,
    backlog: getFire('option_shadow_skipped_backlog_seen'),
    backlogPerson: getFire('option_shadow_skipped_backlog_person_seen'),
    budget: getFire('option_shadow_skipped_budget_seen'),
    budgetPerson: getFire('option_shadow_skipped_budget_person_seen'),
    rate: getFire('option_shadow_skipped_rate_seen'),
    ratePerson: getFire('option_shadow_skipped_rate_person_seen'),
    ratePersonOver: getFire('option_shadow_rate_person_over_seen'),
    scale: getFire('option_shadow_skipped_scale_seen'),
    scalePerson: getFire('option_shadow_skipped_scale_person_seen'),
    stageDisabled: getFire('option_shadow_skipped_stage_disabled_seen'),
    stageDisabledPerson: getFire('option_shadow_skipped_stage_disabled_person_seen'),
    stageHorseOnly: getFire('option_shadow_skipped_stage_horse_only_seen'),
    stageSelfDisabled: getFire('option_shadow_stage_self_disabled_seen'),
    redecideFailed: getFire('option_shadow_redecide_failed_seen'),
    scaleMismatch: getFire('option_shadow_scale_mismatch_seen'),
    unencodable: getFire('option_shadow_unencodable_seen'),
    rotatedOut: getFire('option_shadow_rotated_out_seen'),
    stageReceiptDropped: getFire('option_shadow_stage_receipt_dropped_seen'),
  };
  skips.totalSkipped =
    skips.backlog +
    skips.budget +
    skips.rate +
    skips.scale +
    skips.stageDisabled +
    skips.stageHorseOnly;

  // 4. Safety counters (horse_error_log + alarm/configError/illegal/exception/breaker)
  const errorLogRaw = dbSnapshot.errorLog ?? {};
  const horseErrorLogCount = Number(errorLogRaw.count) || 0;
  const horseErrorLogRecent = Array.isArray(errorLogRaw.recent) ? errorLogRaw.recent : [];

  const safetyCounts = {
    alarm: 0,
    configError: 0,
    illegal: 0,
    exception: 0,
    breaker: 0,
  };
  const safetyFeatures = [];
  for (const entry of skipSourceMap.values()) {
    if (entry.fires <= 0) continue;
    const category = classifySafetyFeature(entry.feature);
    if (!category) continue;
    safetyCounts[category] += entry.fires;
    safetyFeatures.push({
      category,
      feature: entry.feature,
      fires: entry.fires,
      distinctWorkers: entry.distinctWorkers,
    });
  }
  safetyFeatures.sort((a, b) => b.fires - a.fires || a.feature.localeCompare(b.feature));

  const safety = {
    source: telemetrySource,
    horseErrorLogCount,
    horseErrorLogRecent,
    counts: safetyCounts,
    features: safetyFeatures,
    totalAlerts:
      horseErrorLogCount +
      safetyCounts.alarm +
      safetyCounts.configError +
      safetyCounts.illegal +
      safetyCounts.exception +
      safetyCounts.breaker,
  };

  // 5. Latency summary
  const latency = summarizeLatencyRows(dbSnapshot.latency);

  // 6. Deterministic verdict
  const rollbackReasons = [];
  if (safety.horseErrorLogCount > 0) {
    rollbackReasons.push(`horse_error_log=${safety.horseErrorLogCount}`);
  }
  if (safety.counts.breaker > 0) {
    rollbackReasons.push(`breaker=${safety.counts.breaker}`);
  }
  if (safety.counts.alarm > 0) {
    rollbackReasons.push(`alarm=${safety.counts.alarm}`);
  }
  if (safety.counts.configError > 0) {
    rollbackReasons.push(`config_error=${safety.counts.configError}`);
  }
  if (safety.counts.illegal > 0) {
    rollbackReasons.push(`illegal=${safety.counts.illegal}`);
  }
  if (safety.counts.exception > 0) {
    rollbackReasons.push(`exception=${safety.counts.exception}`);
  }
  if (latency.starvationAlert) {
    rollbackReasons.push(
      `latency_starvation=${latency.alertedScopes.map((s) => `${s.scope}:${s.over100msPct}%`).join(',')}`
    );
  }
  if (health && health.status === 'degraded') {
    for (const issue of health.issues ?? []) {
      rollbackReasons.push(`health:${issue}`);
    }
  }

  let verdict;
  let verdictReason;
  if (rollbackReasons.length > 0) {
    verdict = 'ROLLBACK_TRIGGERED';
    verdictReason = rollbackReasons.join('; ');
  } else if (currentState && SHADOW_STATES.includes(currentState) && shadow.overall.total > 0) {
    verdict = 'HEALTHY_ACTIVE';
    verdictReason = 'active_shadow_with_samples';
  } else {
    verdict = 'HEALTHY_IDLE';
    if (currentState && SHADOW_STATES.includes(currentState)) {
      verdictReason = 'active_shadow_zero_redecisions_yet';
    } else if (windowMeta.shadowRunCompleted) {
      verdictReason = `shadow_run_completed_now_${currentState ?? 'unlisted'}`;
    } else {
      verdictReason = `switch_not_in_shadow_state_${currentState ?? 'unlisted'}`;
    }
  }

  const switchState = {
    option: safeOpt,
    exists: Boolean(switchRow),
    state: currentState,
    updatedBy: switchRow?.updated_by ?? null,
    updatedAt: switchRow?.updated_at ?? null,
    note: switchRow?.note ?? null,
  };

  const latestAudit = windowMeta.latestAudit
    ? {
        id: windowMeta.latestAudit.id ?? null,
        oldState: windowMeta.latestAudit.old_state ?? null,
        newState: windowMeta.latestAudit.new_state ?? null,
        changedBy: windowMeta.latestAudit.changed_by ?? null,
        changedAt: windowMeta.latestAudit.changed_at ?? null,
        note: windowMeta.latestAudit.note ?? null,
      }
    : null;

  const report = {
    measuredAt,
    option: safeOpt,
    verdict,
    verdictReason,
    rollbackReasons,
    warnings,
    switchState,
    latestAudit,
    auditCount: Array.isArray(auditRows) ? auditRows.length : 0,
    window: {
      since: windowMeta.since,
      until: windowMeta.until,
      sinceSource: windowMeta.sinceSource,
      untilSource: windowMeta.untilSource,
      elapsedMinutes: windowMeta.elapsedMinutes,
      elapsedLabel: windowMeta.elapsedLabel,
      shadowRunCompleted: windowMeta.shadowRunCompleted,
      shadowStartedAt: windowMeta.shadowStartedAt,
      shadowExitedAt: windowMeta.shadowExitedAt,
      receiptCount,
      activeWorkers,
    },
    health,
    pickup,
    shadow,
    skips,
    safety,
    latency,
    inboxReceipt: '',
  };

  report.inboxReceipt = formatInboxReceipt(report);
  return report;
}

// --- Formatters --------------------------------------------------------------------------------

function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtPct(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return 'n/a';
  return `${Number(pct).toFixed(2)}%`;
}

function fmtScopeCompact(label, s) {
  if (!s) return `${label}=n/a`;
  return `${label}=${s.avgMs ?? 'n/a'}/${s.maxMs ?? 'n/a'}ms(${Number(s.over100msPct ?? 0).toFixed(2)}%>100ms,n=${fmtInt(s.samples)})`;
}

export function formatInboxReceipt(report) {
  const stateTag = report.switchState?.state ?? 'unlisted';
  const shaShort = report.health?.releaseSha ? report.health.releaseSha.slice(0, 8) : 'unknown';
  const tables =
    report.health?.activeTables !== null && report.health?.activeTables !== undefined
      ? String(report.health.activeTables)
      : 'n/a';
  const stalled =
    report.health?.stalledTableCount !== null && report.health?.stalledTableCount !== undefined
      ? String(report.health.stalledTableCount)
      : 'n/a';

  const ov = report.shadow.overall;
  const pe = report.shadow.person;
  const ovCi =
    ov.total > 0
      ? `${fmtPct(ov.changeRatePct)} CI95 ${fmtPct(ov.ci95LowPct)}-${fmtPct(ov.ci95HighPct)}`
      : 'n/a';
  const peCi =
    pe.total > 0
      ? `${fmtPct(pe.changeRatePct)} CI95 ${fmtPct(pe.ci95LowPct)}-${fmtPct(pe.ci95HighPct)}`
      : 'n/a';

  const sk = report.skips;
  const sf = report.safety;
  const hl = report.latency.highlights;
  const shadowLat = hl.shadow ?? hl.shadowStage ?? hl.styleShadow ?? null;

  const parts = [
    `SHADOW-READ ${report.option} [${stateTag} | ${report.window.elapsedLabel} | ${report.verdict}]`,
    `sha=${shaShort} tables=${tables} stalled=${stalled}`,
    `pickup=${fmtInt(report.pickup.count)}(${report.pickup.distinctWorkers}w/${report.pickup.stateChecked})`,
    `redec=${fmtInt(ov.total)} chg=${fmtInt(ov.changed)}(${ovCi})`,
    `person=${fmtInt(pe.total)}(${fmtPct(report.shadow.peopleFirstSharePct)} share) chg=${fmtInt(pe.changed)}(${peCi})`,
    `skips(backlog=${fmtInt(sk.backlog)} budget=${fmtInt(sk.budget)} rate=${fmtInt(sk.rate)} self_dis=${fmtInt(sk.stageSelfDisabled)} fail=${fmtInt(sk.redecideFailed)})`,
    `safety(err=${sf.horseErrorLogCount} alarm=${sf.counts.alarm} cfg=${sf.counts.configError} ill=${sf.counts.illegal} exc=${sf.counts.exception} brk=${sf.counts.breaker})`,
    `lat(${fmtScopeCompact('nlh', hl.nlh)}, ${fmtScopeCompact('style', hl.styleRead)}, ${fmtScopeCompact('shadow', shadowLat)})`,
    `window=${report.window.since.slice(0, 19)}Z..${report.window.until.slice(0, 19)}Z`,
  ];

  if (report.rollbackReasons.length > 0) {
    parts.push(`triggers=[${report.rollbackReasons.join(', ')}]`);
  }

  return parts.join(' | ');
}

export function formatShadowReportText(report) {
  const lines = [];
  lines.push(`=== Shadow Read Report: ${report.option} ===`);
  lines.push(`Verdict: ${report.verdict} (${report.verdictReason})`);
  lines.push(`Measured at: ${report.measuredAt}`);
  lines.push(
    `Window: ${report.window.since} .. ${report.window.until} (${report.window.elapsedLabel}, since=${report.window.sinceSource}, until=${report.window.untilSource})`
  );
  lines.push(
    `Switch: state=${report.switchState.state ?? 'unlisted'} updated_at=${report.switchState.updatedAt ?? 'n/a'} by=${report.switchState.updatedBy ?? 'n/a'}`
  );
  if (report.latestAudit) {
    lines.push(
      `Latest audit #${report.latestAudit.id}: ${report.latestAudit.oldState ?? 'null'} -> ${report.latestAudit.newState ?? 'null'} at ${report.latestAudit.changedAt ?? 'n/a'}`
    );
  }
  if (report.health) {
    if (report.health.status === 'skipped') {
      lines.push('Health: skipped');
    } else if (report.health.status === 'unreachable') {
      lines.push(`Health: UNREACHABLE (${report.health.error ?? 'unknown'})`);
    } else {
      lines.push(
        `Health: ${report.health.status.toUpperCase()} sha=${report.health.releaseSha ?? 'n/a'} activeTables=${report.health.activeTables ?? 'n/a'} stalled=${report.health.stalledTableCount ?? 'n/a'} liveness=${report.health.liveness ?? 'n/a'}`
      );
    }
  }
  lines.push(
    `Pickup: ${report.pickup.feature} = ${fmtInt(report.pickup.count)} (telemetry_table=${fmtInt(report.pickup.telemetryTableCount)}, window_receipts=${fmtInt(report.pickup.windowReceiptCount)}, distinct_workers=${report.pickup.distinctWorkers})`
  );

  const ov = report.shadow.overall;
  const pe = report.shadow.person;
  lines.push(
    `Shadow overall (${report.shadow.source}): total=${fmtInt(ov.total)} same=${fmtInt(ov.same)} changed=${fmtInt(ov.changed)} rate=${fmtPct(ov.changeRatePct)} (95% Wilson CI: ${fmtPct(ov.ci95LowPct)} .. ${fmtPct(ov.ci95HighPct)})`
  );
  lines.push(
    `Shadow person-present: total=${fmtInt(pe.total)} (${fmtPct(report.shadow.peopleFirstSharePct)} people-first share) same=${fmtInt(pe.same)} changed=${fmtInt(pe.changed)} rate=${fmtPct(pe.changeRatePct)} (95% Wilson CI: ${fmtPct(pe.ci95LowPct)} .. ${fmtPct(pe.ci95HighPct)})`
  );

  const sk = report.skips;
  lines.push(
    `Skips: backlog=${fmtInt(sk.backlog)} (person=${fmtInt(sk.backlogPerson)}), budget=${fmtInt(sk.budget)} (person=${fmtInt(sk.budgetPerson)}), rate=${fmtInt(sk.rate)} (person=${fmtInt(sk.ratePerson)}, person_over=${fmtInt(sk.ratePersonOver)}), stage_self_disabled=${fmtInt(sk.stageSelfDisabled)}, redecide_failed=${fmtInt(sk.redecideFailed)}`
  );

  const sf = report.safety;
  lines.push(
    `Safety: horse_error_log=${sf.horseErrorLogCount}, alarm=${sf.counts.alarm}, config_error=${sf.counts.configError}, illegal=${sf.counts.illegal}, exception=${sf.counts.exception}, breaker=${sf.counts.breaker}`
  );
  if (sf.features.length > 0) {
    lines.push(
      `  Safety features: ${sf.features.map((f) => `${f.feature}=${f.fires}[${f.category}]`).join(', ')}`
    );
  }

  const hl = report.latency.highlights;
  lines.push(
    `Latency (${report.latency.status}, starvationAlert=${report.latency.starvationAlert}):`
  );
  for (const [label, sc] of [
    ['nlh', hl.nlh],
    ['style_read', hl.styleRead],
    ['option_shadow_redecide', hl.shadow],
    ['option_shadow_stage_redecide', hl.shadowStage],
  ]) {
    if (!sc) continue;
    lines.push(
      `  ${label}: n=${fmtInt(sc.samples)} avg=${sc.avgMs}ms max=${sc.maxMs}ms >100ms=${fmtInt(sc.over100msCount)} (${sc.over100msPct}%)`
    );
  }

  if (report.rollbackReasons.length > 0) {
    lines.push(`Rollback triggers: ${report.rollbackReasons.join('; ')}`);
  }
  if (report.warnings.length > 0) {
    lines.push(`Warnings: ${report.warnings.join('; ')}`);
  }

  lines.push('');
  lines.push('Inbox receipt:');
  lines.push(report.inboxReceipt);
  return lines.join('\n');
}
