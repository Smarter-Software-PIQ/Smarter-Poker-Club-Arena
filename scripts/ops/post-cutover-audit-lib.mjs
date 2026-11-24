import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_HEALTH_URL = 'https://engine.smarter.poker/health';
export const DEFAULT_COMPARE_HOURS = 1;
export const DEFAULT_MAX_REGISTRY_AGE_SEC = 300;
export const STARVATION_MIN_SAMPLES = 100;
export const STARVATION_ALERT_PCT = 1.0;

const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i;
const MUTATING_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|MERGE|REPLACE)\b/i;

export function validateHexSha(raw, label = 'sha') {
  if (typeof raw !== 'string') {
    throw new Error(`Invalid ${label}: expected hex SHA string`);
  }
  const trimmed = raw.trim().toLowerCase();
  if (!HEX_SHA_RE.test(trimmed)) {
    throw new Error(`Invalid ${label} "${raw}": must be 7-40 hexadecimal characters`);
  }
  return trimmed;
}

export function validateCompareHours(raw) {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 168) {
    throw new Error(`Invalid --compare-hours "${raw}": must be a number in (0, 168]`);
  }
  return value;
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL query must be a non-empty string');
  }
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error('Refusing non-SELECT SQL in read-only audit');
  }
  // Strip single-quoted literals before checking for mutating tokens or semicolons.
  const withoutStrings = trimmed.replace(/'(?:''|[^'])*'/g, "''");
  if (withoutStrings.includes(';')) {
    throw new Error('Refusing multi-statement SQL in read-only audit');
  }
  if (MUTATING_SQL_RE.test(withoutStrings)) {
    throw new Error('Refusing mutating SQL keyword in read-only audit');
  }
  return trimmed;
}

export function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const expectShas = [];
  let compareHours = DEFAULT_COMPARE_HOURS;
  let healthUrl = DEFAULT_HEALTH_URL;
  let maxRegistryAgeSec = DEFAULT_MAX_REGISTRY_AGE_SEC;
  let supabaseWorkdir = null;
  let json = false;
  let strictLatency = false;
  let exploitSplitAt = null;
  let strictExploit = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--strict-latency') {
      strictLatency = true;
    } else if (arg === '--strict-exploit') {
      strictExploit = true;
    } else if (arg === '--exploit-split-at') {
      const next = args[++i];
      if (!next)
        throw new Error('--exploit-split-at requires an ISO instant such as 2026-11-24T04:00:00Z');
      exploitSplitAt = validateExploitSplitAt(next);
    } else if (arg.startsWith('--exploit-split-at=')) {
      exploitSplitAt = validateExploitSplitAt(arg.slice('--exploit-split-at='.length));
    } else if (arg === '--expect-sha') {
      const next = args[++i];
      if (!next) throw new Error('--expect-sha requires a commit SHA argument');
      expectShas.push(validateHexSha(next, '--expect-sha'));
    } else if (arg.startsWith('--expect-sha=')) {
      expectShas.push(validateHexSha(arg.slice('--expect-sha='.length), '--expect-sha'));
    } else if (arg === '--compare-hours') {
      const next = args[++i];
      if (next === undefined) throw new Error('--compare-hours requires a numeric argument');
      compareHours = validateCompareHours(next);
    } else if (arg.startsWith('--compare-hours=')) {
      compareHours = validateCompareHours(arg.slice('--compare-hours='.length));
    } else if (arg === '--health-url') {
      const next = args[++i];
      if (!next) throw new Error('--health-url requires a URL argument');
      healthUrl = next;
    } else if (arg.startsWith('--health-url=')) {
      healthUrl = arg.slice('--health-url='.length);
    } else if (arg === '--max-registry-age-sec') {
      const next = Number(args[++i]);
      if (!Number.isFinite(next) || next <= 0) {
        throw new Error('--max-registry-age-sec must be a positive number');
      }
      maxRegistryAgeSec = next;
    } else if (arg.startsWith('--max-registry-age-sec=')) {
      const next = Number(arg.slice('--max-registry-age-sec='.length));
      if (!Number.isFinite(next) || next <= 0) {
        throw new Error('--max-registry-age-sec must be a positive number');
      }
      maxRegistryAgeSec = next;
    } else if (arg === '--supabase-workdir') {
      const next = args[++i];
      if (!next) throw new Error('--supabase-workdir requires a path argument');
      supabaseWorkdir = next;
    } else if (arg.startsWith('--supabase-workdir=')) {
      supabaseWorkdir = arg.slice('--supabase-workdir='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    expectShas,
    compareHours,
    healthUrl,
    maxRegistryAgeSec,
    supabaseWorkdir,
    json,
    strictLatency,
    exploitSplitAt,
    strictExploit,
    help,
  };
}

/** Hours of hands before the split that the optional Horse exploit report compares against. */
export const EXPLOIT_BEFORE_HOURS = 24;

/** An ISO instant with an explicit zone (the exploit report refuses anything else). */
export function validateExploitSplitAt(raw) {
  const text = String(raw ?? '').trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    throw new Error(
      '--exploit-split-at must be an ISO instant with a zone, such as 2026-11-24T04:00:00Z'
    );
  }
  return text;
}

/**
 * Optional step 7: scripts/ops/horse-exploit-report.mjs --split-at <cutover> --gate, read-only.
 * Non-blocking by default: a finding (exit 1) is a warning, too few hands (exit 2) and a failed
 * read are `unknown`. With --strict-exploit a finding or a failed read fails the audit; too few
 * hands stays `unknown` (it is no answer either way).
 */
export function evaluateExploitReport(result, { strict = false, splitAt, since, until } = {}) {
  const exitCode = result?.exitCode ?? null;
  const gateLine = result?.gateLine ?? null;
  const details = { splitAt, since, until, exitCode, gateLine, findings: result?.findings ?? [] };
  const base = { name: 'horse_exploit_report', failures: [], warnings: [], details };
  if (exitCode === 0) return { ...base, status: 'pass' };
  if (exitCode === 1) {
    const msg = `a Horse cell became or grew EXPLOITABLE after ${splitAt}: rollback trigger (${gateLine ?? 'see the report'})`;
    return strict
      ? { ...base, status: 'fail', failures: [msg] }
      : { ...base, status: 'warn', warnings: [msg] };
  }
  if (exitCode === 2) {
    return {
      ...base,
      status: 'unknown',
      warnings: [
        `too few Horse decisions after ${splitAt} to judge yet (${gateLine ?? 'exit 2'}); run again at +3 h`,
      ],
    };
  }
  const msg = `horse-exploit-report did not answer (exit ${exitCode ?? 'none'}${result?.error ? `: ${result.error}` : ''})`;
  return strict
    ? { ...base, status: 'fail', failures: [msg] }
    : { ...base, status: 'unknown', warnings: [msg] };
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
    // Supabase CLI occasionally writes notices around JSON; recover outermost array/object.
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

export function buildServingRegistrySql() {
  return assertReadOnlySql(`
SELECT
  release_sha,
  registry_digest,
  first_seen_at,
  seen_at,
  EXTRACT(EPOCH FROM (now() - seen_at))::double precision AS age_sec
FROM public.ca_horse_option_registry_serving
ORDER BY seen_at DESC
LIMIT 5
`);
}

export function buildResetTrapsSql() {
  return assertReadOnlySql(`
SELECT
  option,
  state,
  updated_by,
  updated_at,
  public.fn_ca_horse_option_registry_refusal(option, state) AS refusal
FROM public.ca_horse_style_switch
ORDER BY option ASC
`);
}

export function buildConfigAlarmsSql(compareHours) {
  const hours = validateCompareHours(compareHours);
  const secs = Math.max(1, Math.round(hours * 3600));
  return assertReadOnlySql(`
SELECT
  day::text AS day,
  feature,
  fires,
  updated_at
FROM public.horse_brain_telemetry
WHERE feature LIKE 'option_switch_config_%'
  AND fires > 0
  AND (
    updated_at >= now() - make_interval(secs => ${secs})
    OR day >= (now() AT TIME ZONE 'UTC')::date
  )
ORDER BY updated_at DESC, feature ASC
LIMIT 50
`);
}

export function buildFlushReceiptLatencySql(releaseSha, compareHours) {
  const hours = validateCompareHours(compareHours);
  const secs = Math.max(1, Math.round(hours * 3600));
  const releaseFilter = releaseSha
    ? `AND r.source_release = '${validateHexSha(releaseSha, 'releaseSha')}'`
    : '';
  return assertReadOnlySql(`
WITH expanded AS (
  SELECT
    elem->>'scope' AS scope,
    (elem->>'samples')::bigint AS samples,
    (elem->>'totalMs')::double precision AS total_ms,
    (elem->>'maxMs')::double precision AS max_ms,
    COALESCE((elem->'buckets'->>8)::bigint, 0) + COALESCE((elem->'buckets'->>9)::bigint, 0) AS over100
  FROM public.horse_brain_flush_receipts r,
       LATERAL jsonb_array_elements(r.latency) elem
  WHERE r.collected_at >= now() - make_interval(secs => ${secs})
    ${releaseFilter}
    AND jsonb_typeof(r.latency) = 'array'
)
SELECT
  scope,
  sum(samples)::bigint AS samples,
  (sum(total_ms) / NULLIF(sum(samples), 0))::double precision AS avg_ms,
  max(max_ms)::double precision AS max_ms,
  sum(over100)::bigint AS over100
FROM expanded
GROUP BY scope
ORDER BY sum(over100) DESC, sum(samples) DESC
LIMIT 40
`);
}

export function buildDailyDecisionLatencySql() {
  return assertReadOnlySql(`
SELECT
  scope,
  samples::bigint AS samples,
  (total_ms / NULLIF(samples, 0))::double precision AS avg_ms,
  max_ms::double precision AS max_ms,
  (COALESCE(buckets[9], 0) + COALESCE(buckets[10], 0))::bigint AS over100
FROM public.horse_decision_latency
WHERE day >= (now() AT TIME ZONE 'UTC')::date
ORDER BY (COALESCE(buckets[9], 0) + COALESCE(buckets[10], 0)) DESC, samples DESC
LIMIT 40
`);
}

export function shaMatches(candidate, target) {
  if (typeof candidate !== 'string' || typeof target !== 'string') return false;
  const a = candidate.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function evaluateLiveHealth(health, httpStatus = 200, { strictLatency = false } = {}) {
  const failures = [];
  const warnings = [];
  if (httpStatus !== 200) {
    failures.push(`HTTP status ${httpStatus} (expected 200)`);
  }
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    return {
      name: 'live_health',
      status: 'fail',
      releaseSha: null,
      failures: [...failures, 'health body is not a JSON object'],
      warnings,
      details: null,
    };
  }

  const rawSha =
    typeof health.releaseSha === 'string' ? health.releaseSha.trim().toLowerCase() : '';
  const releaseSha = HEX_SHA_RE.test(rawSha) ? rawSha : null;
  if (!releaseSha) {
    failures.push(`releaseSha missing or invalid (${String(health.releaseSha)})`);
  }
  if (health.liveness !== 'ok') {
    failures.push(`liveness=${String(health.liveness)} (expected ok)`);
  }
  if (health.settlementStatus !== 'ok') {
    failures.push(`settlementStatus=${String(health.settlementStatus)} (expected ok)`);
  }
  if (health.stalledTableCount !== 0) {
    failures.push(`stalledTableCount=${String(health.stalledTableCount)} (expected 0)`);
  }
  const maintenancePhase = health.maintenance?.phase ?? null;
  if (maintenancePhase !== 'idle') {
    failures.push(`maintenance.phase=${String(maintenancePhase)} (expected idle)`);
  }

  const resumeWaves =
    health.maintenance && 'resumeWaves' in health.maintenance
      ? health.maintenance.resumeWaves
      : (health.resumeWaves ?? null);
  let resumeWavesComplete = true;
  if (resumeWaves !== null && resumeWaves !== undefined) {
    if (typeof resumeWaves !== 'object' || Array.isArray(resumeWaves)) {
      resumeWavesComplete = false;
      failures.push('resumeWaves is malformed');
    } else {
      const total = Number(resumeWaves.total);
      const done = Number(resumeWaves.done);
      const finishedAt = resumeWaves.finishedAt ?? null;
      const tables = resumeWaves.tables != null ? Number(resumeWaves.tables) : null;
      const tablesResumed =
        resumeWaves.tablesResumed != null ? Number(resumeWaves.tablesResumed) : null;
      if (!Number.isFinite(total) || !Number.isFinite(done) || done < total) {
        resumeWavesComplete = false;
        failures.push(`resumeWaves incomplete (done=${done}/${total})`);
      }
      if (total > 0 && finishedAt === null) {
        resumeWavesComplete = false;
        failures.push('resumeWaves.finishedAt is null while total > 0');
      }
      if (
        tables !== null &&
        tablesResumed !== null &&
        Number.isFinite(tables) &&
        Number.isFinite(tablesResumed) &&
        tablesResumed < tables
      ) {
        resumeWavesComplete = false;
        failures.push(`resumeWaves tablesResumed=${tablesResumed}/${tables}`);
      }
    }
  }

  const lhd =
    health.liveHorseDecision &&
    typeof health.liveHorseDecision === 'object' &&
    !Array.isArray(health.liveHorseDecision)
      ? health.liveHorseDecision
      : null;
  let liveHorseDecisionDetails = null;
  if (lhd) {
    const phase = lhd.phase ?? null;
    const recoverableRequestErrors =
      typeof lhd.recoverableRequestErrors === 'number' &&
      Number.isFinite(lhd.recoverableRequestErrors)
        ? lhd.recoverableRequestErrors
        : null;
    const lastRecoverableRequestError =
      typeof lhd.lastRecoverableRequestError === 'string' && lhd.lastRecoverableRequestError.trim()
        ? lhd.lastRecoverableRequestError.trim()
        : null;
    const expiredJobs =
      typeof lhd.expiredJobs === 'number' && Number.isFinite(lhd.expiredJobs)
        ? lhd.expiredJobs
        : null;

    if (phase !== null && phase !== 'ready') {
      failures.push(`liveHorseDecision.phase=${String(phase)} (expected ready)`);
    }
    if (recoverableRequestErrors !== null && recoverableRequestErrors > 0) {
      const errDetail = lastRecoverableRequestError
        ? ` (lastRecoverableRequestError=${lastRecoverableRequestError})`
        : '';
      failures.push(
        `liveHorseDecision.recoverableRequestErrors=${recoverableRequestErrors}${errDetail}`
      );
    }
    if (expiredJobs !== null && expiredJobs > 0) {
      warnings.push(`liveHorseDecision.expiredJobs=${expiredJobs}`);
    }

    liveHorseDecisionDetails = {
      phase,
      recoverableRequestErrors,
      lastRecoverableRequestError,
      expiredJobs,
    };
  }

  const liveHealthLatency = health.horseDecisionLatency ?? null;
  if (liveHealthLatency && liveHealthLatency.starvationAlert === true) {
    const latencyMsg =
      `live /health horseDecisionLatency.starvationAlert=true` +
      ` (>100ms=${liveHealthLatency.over100msCount ?? '?'}/${liveHealthLatency.totalDecisions ?? '?'},` +
      ` ${liveHealthLatency.over100msPct ?? '?'}%, max=${liveHealthLatency.maxMs ?? '?'}ms` +
      `${liveHealthLatency.topHotNode ? `, topHotNode=${liveHealthLatency.topHotNode}` : ''})`;
    warnings.push(latencyMsg);
    if (strictLatency) {
      failures.push(latencyMsg);
    }
  }

  return {
    name: 'live_health',
    status: failures.length === 0 ? 'pass' : 'fail',
    releaseSha,
    failures,
    warnings,
    details: {
      httpStatus,
      releaseSha,
      liveness: health.liveness ?? null,
      settlementStatus: health.settlementStatus ?? null,
      stalledTableCount: health.stalledTableCount ?? null,
      maintenancePhase,
      resumeWaves,
      resumeWavesComplete,
      liveHorseDecision: liveHorseDecisionDetails,
      liveHealthLatency,
    },
  };
}

export function evaluateServingRegistry(
  rows,
  liveReleaseSha,
  maxAgeSec = DEFAULT_MAX_REGISTRY_AGE_SEC
) {
  const list = Array.isArray(rows) ? rows : [];
  const latest = list[0] ?? null;
  if (!liveReleaseSha) {
    return {
      name: 'serving_registry_freshness',
      status: 'fail',
      failures: ['cannot verify serving registry without a valid live releaseSha'],
      details: { liveReleaseSha: null, maxAgeSec, matchedRow: null, latestRow: latest },
    };
  }
  const matched =
    list.find(
      (r) =>
        String(r?.release_sha ?? '')
          .trim()
          .toLowerCase() === liveReleaseSha
    ) ??
    list.find((r) => shaMatches(r?.release_sha, liveReleaseSha)) ??
    null;

  const failures = [];
  if (!matched) {
    failures.push(
      `no row in ca_horse_option_registry_serving matches live releaseSha ${liveReleaseSha}` +
        (latest?.release_sha ? ` (latest serving is ${latest.release_sha})` : '')
    );
  } else {
    const ageSec = Number(matched.age_sec);
    if (!Number.isFinite(ageSec)) {
      failures.push(`serving registry age_sec is non-finite (${String(matched.age_sec)})`);
    } else if (ageSec < -60) {
      failures.push(`serving registry seen_at is in the future (${ageSec.toFixed(1)}s)`);
    } else if (ageSec > maxAgeSec) {
      failures.push(
        `serving registry for ${matched.release_sha} is stale (${ageSec.toFixed(1)}s > ${maxAgeSec}s)`
      );
    }
  }

  return {
    name: 'serving_registry_freshness',
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    details: {
      liveReleaseSha,
      maxAgeSec,
      matchedRow: matched
        ? {
            releaseSha: matched.release_sha,
            registryDigest: matched.registry_digest ?? null,
            seenAt: matched.seen_at ?? null,
            ageSec: Number.isFinite(Number(matched.age_sec)) ? Number(matched.age_sec) : null,
          }
        : null,
      latestRow: latest
        ? {
            releaseSha: latest.release_sha,
            seenAt: latest.seen_at ?? null,
            ageSec: Number.isFinite(Number(latest.age_sec)) ? Number(latest.age_sec) : null,
          }
        : null,
    },
  };
}

export function evaluateResetTraps(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const offendingRows = list
    .filter((row) => row && row.refusal !== null && row.refusal !== undefined)
    .map((row) => ({
      option: String(row.option ?? ''),
      state: String(row.state ?? ''),
      refusal: String(row.refusal),
      updatedBy: row.updated_by ?? null,
      updatedAt: row.updated_at ?? null,
    }));

  const failures =
    offendingRows.length > 0
      ? [
          `${offendingRows.length} reset trap(s) detected in ca_horse_style_switch: ` +
            offendingRows.map((r) => `${r.option}=${r.state} (${r.refusal})`).join(', '),
        ]
      : [];

  return {
    name: 'zero_reset_traps',
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    details: {
      totalRows: list.length,
      offendingCount: offendingRows.length,
      offendingRows,
    },
  };
}

export function evaluateConfigAlarms(rows, compareHours) {
  const list = Array.isArray(rows) ? rows : [];
  const alarms = list
    .filter((row) => row && Number(row.fires) > 0)
    .map((row) => ({
      day: row.day ?? null,
      feature: String(row.feature ?? ''),
      fires: Number(row.fires),
      updatedAt: row.updated_at ?? null,
    }));

  const failures =
    alarms.length > 0
      ? [
          `${alarms.length} option_switch_config_* alarm(s) found: ` +
            alarms.map((a) => `${a.feature}=${a.fires} (${a.day ?? 'unknown'})`).join(', '),
        ]
      : [];

  return {
    name: 'zero_config_alarms',
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    details: {
      compareHours,
      alarmCount: alarms.length,
      alarms,
    },
  };
}

export function evaluateCommitAncestry(expectShas, releaseSha, isAncestorFn) {
  if (!Array.isArray(expectShas) || expectShas.length === 0) {
    return {
      name: 'commit_ancestry',
      status: 'pass',
      failures: [],
      details: {
        releaseSha: releaseSha ?? null,
        checkedCount: 0,
        results: [],
        note: 'no --expect-sha supplied',
      },
    };
  }
  if (!releaseSha) {
    return {
      name: 'commit_ancestry',
      status: 'fail',
      failures: ['cannot verify commit ancestry without a valid live releaseSha'],
      details: {
        releaseSha: null,
        checkedCount: expectShas.length,
        results: expectShas.map((sha) => ({
          sha,
          isAncestor: false,
          reason: 'missing_release_sha',
        })),
      },
    };
  }

  const results = [];
  const failures = [];
  for (const sha of expectShas) {
    const verdict = isAncestorFn(sha, releaseSha);
    const ok = Boolean(verdict && verdict.ok);
    results.push({
      sha,
      isAncestor: ok,
      reason: ok ? null : (verdict?.reason ?? 'not_ancestor'),
    });
    if (!ok) {
      failures.push(
        `commit ${sha} is NOT an ancestor of live releaseSha ${releaseSha}` +
          (verdict?.reason ? ` (${verdict.reason})` : '')
      );
    }
  }

  return {
    name: 'commit_ancestry',
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    details: {
      releaseSha,
      checkedCount: expectShas.length,
      results,
    },
  };
}

function roundNum(val, decimals = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function summarizeLatencyRows(rows, { source, compareHours, strictLatency = false }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return {
      name: 'latency_summary',
      status: 'unknown',
      failures: [],
      warnings: [],
      details: {
        source,
        compareHours,
        reason: 'no_latency_rows_in_window',
        starvationAlert: false,
        alertedScopes: [],
        topHotNode: null,
        scopes: [],
      },
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
  const warnings = starvationAlert
    ? [
        `>100 ms starvation threshold (>1.0% with >=100 samples) exceeded in: ` +
          alertedScopes
            .map(
              (a) =>
                `${a.scope} (${a.over100msPct}% = ${a.over100msCount}/${a.samples}, max ${a.maxMs}ms)`
            )
            .join(', ') +
          (topHotNode ? `; topHotNode=${topHotNode}` : ''),
      ]
    : [];

  const status = starvationAlert ? (strictLatency ? 'fail' : 'warn') : 'pass';
  return {
    name: 'latency_summary',
    status,
    failures: strictLatency && starvationAlert ? [...warnings] : [],
    warnings,
    details: {
      source,
      compareHours,
      starvationAlert,
      alertedScopes,
      topHotNode,
      scopes: scopes.slice(0, 15),
    },
  };
}

function isMissingSchemaError(err) {
  const msg = String(err?.message ?? err ?? '');
  return /\b(42P01|42703)\b/i.test(msg) || /does not exist/i.test(msg);
}

export async function runPostCutoverAudit(options, deps) {
  const {
    expectShas = [],
    compareHours = DEFAULT_COMPARE_HOURS,
    healthUrl = DEFAULT_HEALTH_URL,
    maxRegistryAgeSec = DEFAULT_MAX_REGISTRY_AGE_SEC,
    strictLatency = false,
    exploitSplitAt = null,
    strictExploit = false,
  } = options;
  validateCompareHours(compareHours);
  const validatedExpectShas = expectShas.map((s) => validateHexSha(s, 'expectSha'));

  const auditedAt = (deps.now ? new Date(deps.now()) : new Date()).toISOString();

  // 1. Live /health check
  let liveHealthCheck;
  try {
    const res = await deps.fetchHealth(healthUrl);
    liveHealthCheck = evaluateLiveHealth(res.body, res.status, { strictLatency });
  } catch (err) {
    liveHealthCheck = {
      name: 'live_health',
      status: 'fail',
      releaseSha: null,
      failures: [
        `failed to fetch ${healthUrl}: ${err instanceof Error ? err.message : String(err)}`,
      ],
      details: null,
    };
  }
  const releaseSha = liveHealthCheck.releaseSha;

  const queryDb = async (sql) => {
    const safeSql = assertReadOnlySql(sql);
    return deps.querySupabase(safeSql);
  };

  // 2. Serving registry freshness
  let servingCheck;
  try {
    const rows = await queryDb(buildServingRegistrySql());
    servingCheck = evaluateServingRegistry(rows, releaseSha, maxRegistryAgeSec);
  } catch (err) {
    servingCheck = {
      name: 'serving_registry_freshness',
      status: 'fail',
      failures: [
        `failed to query ca_horse_option_registry_serving: ${err instanceof Error ? err.message : String(err)}`,
      ],
      details: null,
    };
  }

  // 3. Zero reset traps across ALL rows of ca_horse_style_switch
  let resetTrapsCheck;
  try {
    const rows = await queryDb(buildResetTrapsSql());
    resetTrapsCheck = evaluateResetTraps(rows);
  } catch (err) {
    resetTrapsCheck = {
      name: 'zero_reset_traps',
      status: 'fail',
      failures: [
        `failed to query ca_horse_style_switch reset traps: ${err instanceof Error ? err.message : String(err)}`,
      ],
      details: null,
    };
  }

  // 4. Zero config alarms in horse_brain_telemetry
  let configAlarmsCheck;
  try {
    const rows = await queryDb(buildConfigAlarmsSql(compareHours));
    configAlarmsCheck = evaluateConfigAlarms(rows, compareHours);
  } catch (err) {
    configAlarmsCheck = {
      name: 'zero_config_alarms',
      status: 'fail',
      failures: [
        `failed to query horse_brain_telemetry config alarms: ${err instanceof Error ? err.message : String(err)}`,
      ],
      details: null,
    };
  }

  // 5. Commit ancestry proof
  const ancestryCheck = evaluateCommitAncestry(validatedExpectShas, releaseSha, deps.isGitAncestor);

  // 6. Recent latency summary (gracefully degrades to explicit `unknown`, never fabricates)
  let latencyCheck;
  try {
    let rows = [];
    let source = 'horse_brain_flush_receipts';
    try {
      rows = await queryDb(buildFlushReceiptLatencySql(releaseSha, compareHours));
      if ((!Array.isArray(rows) || rows.length === 0) && releaseSha) {
        rows = await queryDb(buildFlushReceiptLatencySql(null, compareHours));
        source = 'horse_brain_flush_receipts_all_releases';
      }
    } catch (receiptErr) {
      if (!isMissingSchemaError(receiptErr)) {
        // Still attempt horse_decision_latency fallback before declaring unknown
      }
      rows = [];
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      try {
        rows = await queryDb(buildDailyDecisionLatencySql());
        source = 'horse_decision_latency';
      } catch (dailyErr) {
        latencyCheck = {
          name: 'latency_summary',
          status: 'unknown',
          failures: [],
          warnings: [],
          details: {
            source: 'unavailable',
            compareHours,
            reason: isMissingSchemaError(dailyErr)
              ? 'latency_table_or_column_missing'
              : `latency_query_error: ${dailyErr instanceof Error ? dailyErr.message : String(dailyErr)}`,
            starvationAlert: false,
            alertedScopes: [],
            topHotNode: null,
            scopes: [],
          },
        };
      }
    }

    if (!latencyCheck) {
      latencyCheck = summarizeLatencyRows(rows, { source, compareHours, strictLatency });
    }
  } catch (err) {
    latencyCheck = {
      name: 'latency_summary',
      status: 'unknown',
      failures: [],
      warnings: [],
      details: {
        source: 'unavailable',
        compareHours,
        reason: `latency_query_error: ${err instanceof Error ? err.message : String(err)}`,
        starvationAlert: false,
        alertedScopes: [],
        topHotNode: null,
        scopes: [],
      },
    };
  }

  const checks = [
    liveHealthCheck,
    servingCheck,
    resetTrapsCheck,
    configAlarmsCheck,
    ancestryCheck,
    latencyCheck,
  ];

  // 7. Optional: Horse exploit report across the cutover (read-only, non-blocking unless strict)
  if (exploitSplitAt) {
    const splitMs = Date.parse(validateExploitSplitAt(exploitSplitAt));
    const nowMs = deps.now ? deps.now() : Date.now();
    const window = {
      splitAt: new Date(splitMs).toISOString(),
      since: new Date(splitMs - EXPLOIT_BEFORE_HOURS * 3_600_000).toISOString(),
      until: new Date(nowMs).toISOString(),
    };
    let result;
    if (!(nowMs > splitMs)) {
      result = { exitCode: null, error: 'the split instant is not in the past' };
    } else if (typeof deps.runExploitReport !== 'function') {
      result = { exitCode: null, error: 'no exploit report runner' };
    } else {
      try {
        result = await deps.runExploitReport(window);
      } catch (err) {
        result = { exitCode: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
    checks.push(evaluateExploitReport(result, { strict: strictExploit, ...window }));
  }
  const failedChecks = checks.filter((c) => c.status === 'fail');
  const overallStatus = failedChecks.length === 0 ? 'PASS' : 'FAIL';

  return {
    auditedAt,
    healthUrl,
    releaseSha,
    compareHours,
    overallStatus,
    passed: overallStatus === 'PASS',
    checks,
  };
}

export function formatAuditReportText(report) {
  const lines = [];
  lines.push(`=== Post-Cutover Audit (${report.auditedAt}) ===`);
  lines.push(`Target: ${report.healthUrl} | Live SHA: ${report.releaseSha ?? 'unknown'}`);
  lines.push('');

  for (const check of report.checks) {
    const tag = String(check.status ?? 'unknown')
      .toUpperCase()
      .padEnd(7);
    lines.push(`[${tag}] ${check.name}`);
    if (check.name === 'live_health' && check.details) {
      const d = check.details;
      const rw =
        d.resumeWaves == null
          ? 'none'
          : `${d.resumeWaves.done}/${d.resumeWaves.total} (tables ${d.resumeWaves.tablesResumed ?? '?'}/${d.resumeWaves.tables ?? '?'})`;
      lines.push(
        `          liveness=${d.liveness} settlement=${d.settlementStatus} stalled=${d.stalledTableCount} maintenance=${d.maintenancePhase} resumeWaves=${rw}`
      );
      if (d.liveHorseDecision) {
        const lhd = d.liveHorseDecision;
        lines.push(
          `          liveHorseDecision: phase=${lhd.phase ?? 'n/a'} recoverableRequestErrors=${lhd.recoverableRequestErrors ?? 'n/a'} expiredJobs=${lhd.expiredJobs ?? 'n/a'}${lhd.lastRecoverableRequestError ? ` lastError=${lhd.lastRecoverableRequestError}` : ''}`
        );
      }
      if (d.liveHealthLatency) {
        const hl = d.liveHealthLatency;
        lines.push(
          `          live /health 5m latency: total=${hl.totalDecisions} >100ms=${hl.over100msCount} (${hl.over100msPct}%) max=${hl.maxMs}ms topHotNode=${hl.topHotNode ?? 'none'} starvationAlert=${hl.starvationAlert}`
        );
      }
    } else if (check.name === 'serving_registry_freshness' && check.details?.matchedRow) {
      const m = check.details.matchedRow;
      lines.push(
        `          release=${m.releaseSha} age=${m.ageSec != null ? `${m.ageSec.toFixed(1)}s` : 'unknown'} (limit <=${check.details.maxAgeSec}s) seen_at=${m.seenAt}`
      );
    } else if (check.name === 'zero_reset_traps' && check.details) {
      lines.push(
        `          rows=${check.details.totalRows} offending=${check.details.offendingCount}`
      );
    } else if (check.name === 'zero_config_alarms' && check.details) {
      lines.push(
        `          alarms=${check.details.alarmCount} (window=${check.details.compareHours}h + UTC today)`
      );
    } else if (check.name === 'commit_ancestry' && check.details) {
      if (check.details.checkedCount === 0) {
        lines.push(`          ${check.details.note}`);
      } else {
        for (const r of check.details.results) {
          lines.push(
            `          ${r.sha} -> ${r.isAncestor ? 'ANCESTOR' : `NOT ANCESTOR (${r.reason ?? 'unknown'})`}`
          );
        }
      }
    } else if (check.name === 'horse_exploit_report' && check.details) {
      const d = check.details;
      lines.push(
        `          split=${d.splitAt} window=${d.since}..${d.until} exit=${d.exitCode ?? 'none'}${d.gateLine ? ` ${d.gateLine}` : ''}`
      );
      for (const f of (d.findings ?? []).slice(0, 3)) lines.push(`          - ${f}`);
    } else if (check.name === 'latency_summary' && check.details) {
      const d = check.details;
      if (check.status === 'unknown') {
        lines.push(`          status=unknown source=${d.source} reason=${d.reason ?? 'unknown'}`);
      } else {
        lines.push(
          `          source=${d.source} window=${d.compareHours}h starvationAlert=${d.starvationAlert} topHotNode=${d.topHotNode ?? 'none'}`
        );
        for (const s of (d.scopes ?? []).slice(0, 6)) {
          lines.push(
            `          - ${s.scope}: samples=${s.samples} avg=${s.avgMs}ms max=${s.maxMs}ms >100ms=${s.over100msCount} (${s.over100msPct}%)${s.starvationAlert ? ' [ALERT]' : ''}`
          );
        }
      }
    }
    for (const f of check.failures ?? []) {
      lines.push(`          FAIL: ${f}`);
    }
    for (const w of check.warnings ?? []) {
      lines.push(`          WARN: ${w}`);
    }
  }

  lines.push('');
  lines.push(`OVERALL: ${report.overallStatus}`);
  return lines.join('\n');
}
