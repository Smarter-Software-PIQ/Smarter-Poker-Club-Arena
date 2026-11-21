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
 *
 * A SHIPPED TARGET RESOLVES ITS OWN FAILURES (incident 484c4cee, 2026-11-21).
 * The failure fingerprint is per run, so nothing ever resolved it: run
 * 44841264851 failed at prepare while its sibling run 44841245126 had already
 * sealed the same SHA, and the critical incident stayed escalated after the
 * engine it complained about was serving. When this run SHIPS, every
 * EngineReleaseFailed still firing for this exact target SHA is resolved
 * through the same door, naming the run that shipped it. A failure for any
 * other SHA is left firing.
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

/**
 * Resolutions for every failure still firing for the exact SHA this run
 * shipped. `firing` rows are engine_alerts rows ({ fingerprint, labels }).
 */
export function buildReleaseResolutions(env, firing) {
  if ((env.SHIPPED || '').trim() !== 'true') return [];
  const targetSha = (env.TARGET_SHA || '').trim();
  if (!/^[0-9a-f]{40}$/.test(targetSha)) return [];
  const runId = (env.RUN_ID || 'unknown').trim().slice(0, 120) || 'unknown';
  return (Array.isArray(firing) ? firing : [])
    .filter(
      (row) =>
        row &&
        typeof row.fingerprint === 'string' &&
        row.fingerprint.startsWith('engine-release-failed:') &&
        row.labels &&
        row.labels.alertname === 'EngineReleaseFailed' &&
        row.labels.target_sha === targetSha
    )
    .map((row) => ({
      status: 'resolved',
      fingerprint: row.fingerprint,
      startsAt: row.starts_at || new Date().toISOString(),
      endsAt: new Date().toISOString(),
      labels: { ...row.labels, severity: 'info' },
      annotations: {
        summary: `Engine release ${targetSha.slice(0, 8)} shipped (run ${runId}); the earlier failure for this SHA is resolved`,
        description: `release ${targetSha} was sealed and independently proved by run ${runId}`,
      },
    }));
}

function warn(message) {
  console.log(`::warning title=RELEASE FAILURE ALERT NOT RECORDED::${message}`);
  process.exit(0);
}

async function main() {
  const alert = buildReleaseFailureAlert(process.env);
  const shipped = (process.env.SHIPPED || '').trim() === 'true';
  if (!alert && !shipped) {
    console.log('engine release cleanly superseded; no failure alert required.');
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
    if (!alert) {
      const firing = await client.query(
        `SELECT fingerprint, labels, starts_at FROM public.engine_alerts
          WHERE alertname = 'EngineReleaseFailed' AND status = 'firing'
            AND labels->>'target_sha' = $1`,
        [(process.env.TARGET_SHA || '').trim()]
      );
      const resolutions = buildReleaseResolutions(process.env, firing.rows);
      if (resolutions.length === 0) {
        console.log('engine release shipped; no earlier failure for this SHA is firing.');
        return;
      }
      const { rows } = await client.query(
        'SELECT public.fn_record_engine_alerts($1::jsonb) AS receipts',
        [JSON.stringify(resolutions)]
      );
      console.log(
        `engine release shipped; resolved ${resolutions.length} earlier failure(s): ${JSON.stringify(rows[0]?.receipts ?? [])}`
      );
      return;
    }
    const { rows } = await client.query(
      'SELECT public.fn_record_engine_alerts($1::jsonb) AS receipts',
      [JSON.stringify([alert])]
    );
    console.log(
      `engine release failure alert recorded: ${alert.fingerprint} receipts=${JSON.stringify(rows[0]?.receipts ?? [])}`
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
