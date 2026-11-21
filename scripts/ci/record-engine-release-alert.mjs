/**
 * Raise a durable engine_alerts row whenever an auto-deploy-hetzner release
 * run does not ship (excluding clean superseded stand-downs).
 *
 * Incident 075013fd (Lane 1): failed or refused engine releases must never die
 * silently in a GitHub Actions log; every failed release raises a critical
 * `EngineReleaseFailed` alert via `public.fn_record_engine_alerts(jsonb)` so
 * it lands in `engine_alerts` and `operational_alert_events`.
 *
 * Best-effort: exits 0 with a warning if the alert DB call fails, so it never
 * masks the authoritative receipt verdict.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function buildReleaseFailureAlert(env) {
  const shipped = (env.SHIPPED || '').trim() === 'true';
  const releaseResult = (env.RELEASE_RESULT || '').trim();
  if (shipped || releaseResult === 'superseded') {
    return null;
  }

  const runId = (env.RUN_ID || 'unknown').trim().slice(0, 120) || 'unknown';
  const targetSha = (env.TARGET_SHA || 'unknown').trim().slice(0, 64) || 'unknown';
  const shortSha = targetSha.slice(0, 8);
  const exitStage = (env.EXIT_STAGE || '').trim().slice(0, 120) || 'unknown';
  const exitOutcome = (env.EXIT_OUTCOME || '').trim().slice(0, 120) || 'failed';
  const exitError = (env.EXIT_ERROR || '').trim().slice(0, 500);
  const doorsResult = (env.DOORS_RESULT || '').trim().slice(0, 64);
  const doorsRefusal = (env.DOORS_REFUSAL || '').trim().slice(0, 300);
  const reason = (env.REASON || '').trim().slice(0, 500);
  const verified = (env.VERIFIED || '').trim().slice(0, 32);

  const parts = [
    reason || `Engine release ${shortSha} failed (run ${runId})`,
    `release_result=${releaseResult || 'unknown'}`,
    `verified=${verified || 'false'}`,
    `exit_stage=${exitStage}`,
    `exit_outcome=${exitOutcome}`,
  ];
  if (exitError) parts.push(`exit_error=${exitError}`);
  if (doorsResult && doorsResult !== 'success') {
    parts.push(`doors=${doorsResult}${doorsRefusal ? ` (${doorsRefusal})` : ''}`);
  }

  return {
    status: 'firing',
    fingerprint: `engine-release-failed:${runId}`,
    startsAt: new Date().toISOString(),
    labels: {
      alertname: 'EngineReleaseFailed',
      severity: 'critical',
      component: 'engine-release',
      run_id: runId,
      target_sha: targetSha,
      release_result: releaseResult || 'unknown',
      exit_stage: exitStage,
      exit_outcome: exitOutcome,
    },
    annotations: {
      summary: `Engine release ${shortSha} failed (run ${runId}, stage=${exitStage})`,
      description: parts.join(' | ').slice(0, 2000),
    },
  };
}

export function buildReleaseResolvedAlerts(env, openRows = []) {
  const shipped = (env.SHIPPED || '').trim() === 'true';
  const verified = (env.VERIFIED || '').trim() === 'true';
  if (!shipped || !verified || !Array.isArray(openRows) || openRows.length === 0) {
    return [];
  }

  const runId = (env.RUN_ID || 'unknown').trim().slice(0, 120) || 'unknown';
  const targetSha = (env.TARGET_SHA || 'unknown').trim().slice(0, 64) || 'unknown';
  const shortSha = targetSha.slice(0, 8);
  const releaseResult = (env.RELEASE_RESULT || 'sealed').trim().slice(0, 64) || 'sealed';
  const nowIso = new Date().toISOString();

  const seen = new Set();
  const resolved = [];
  for (const row of openRows) {
    const fp = typeof row?.fingerprint === 'string' ? row.fingerprint.trim() : '';
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    const prevLabels = row?.labels && typeof row.labels === 'object' ? row.labels : {};
    const startsAt =
      typeof row?.starts_at === 'string' && row.starts_at.trim()
        ? row.starts_at.trim()
        : row?.starts_at instanceof Date
          ? row.starts_at.toISOString()
          : nowIso;
    resolved.push({
      status: 'resolved',
      fingerprint: fp,
      startsAt,
      endsAt: nowIso,
      labels: {
        ...prevLabels,
        alertname: 'EngineReleaseFailed',
        severity: prevLabels.severity || 'critical',
        component: 'engine-release',
        resolved_by_run_id: runId,
        resolved_by_sha: targetSha,
      },
      annotations: {
        summary: `Engine release ${shortSha} verified live (run ${runId}, ${releaseResult})`,
        description: `Resolved prior EngineReleaseFailed (${fp}) after verified production ship of ${targetSha} in run ${runId} (${releaseResult}).`.slice(
          0,
          2000
        ),
      },
    });
    if (resolved.length >= 25) break;
  }
  return resolved;
}

function warn(message) {
  console.log(`::warning title=RELEASE FAILURE ALERT NOT RECORDED::${message}`);
  process.exit(0);
}

async function main() {
  const alert = buildReleaseFailureAlert(process.env);
  const shouldResolve =
    !alert &&
    (process.env.SHIPPED || '').trim() === 'true' &&
    (process.env.VERIFIED || '').trim() === 'true';

  if (!alert && !shouldResolve) {
    console.log('engine release cleanly superseded; no alert update required.');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) warn('DATABASE_URL is not configured.');

  let Client;
  try {
    ({ Client } = await import('pg'));
  } catch {
    warn('the pg module is unavailable on this runner.');
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  try {
    await client.connect();
    if (alert) {
      const { rows } = await client.query(
        'SELECT public.fn_record_engine_alerts($1::jsonb) AS receipts',
        [JSON.stringify([alert])]
      );
      console.log(
        `engine release failure alert recorded: ${alert.fingerprint} receipts=${JSON.stringify(rows[0]?.receipts ?? [])}`
      );
      return;
    }

    const { rows: openRows } = await client.query(
      `SELECT latest.fingerprint, latest.labels, latest.starts_at
         FROM (
           SELECT DISTINCT ON (fingerprint) fingerprint, status, labels, starts_at, created_at
             FROM public.engine_alerts
            WHERE alertname = 'EngineReleaseFailed'
              AND component = 'engine-release'
              AND created_at >= now() - interval '72 hours'
            ORDER BY fingerprint, created_at DESC, id DESC
         ) latest
        WHERE latest.status = 'firing'
        ORDER BY latest.created_at DESC
        LIMIT 25`
    );
    const resolvedAlerts = buildReleaseResolvedAlerts(process.env, openRows);
    if (resolvedAlerts.length === 0) {
      console.log('engine release verified live; no open EngineReleaseFailed alerts to resolve.');
      return;
    }
    const { rows } = await client.query(
      'SELECT public.fn_record_engine_alerts($1::jsonb) AS receipts',
      [JSON.stringify(resolvedAlerts)]
    );
    console.log(
      `engine release failure alerts auto-resolved (${resolvedAlerts.length}): receipts=${JSON.stringify(rows[0]?.receipts ?? [])}`
    );
  } catch (err) {
    warn(`${err?.message || err}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => warn(`${err?.message || err}`));
}
