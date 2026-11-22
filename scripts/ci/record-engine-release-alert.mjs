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
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { buildEpisodeResolve, engineAlertEpisodeId } from './engine-alert-episode.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function gitIsAncestor(ancestor, descendant) {
  if (!SHA_RE.test(String(ancestor || '')) || !SHA_RE.test(String(descendant || ''))) {
    return false;
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

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

  const fingerprint = `engine-release-failed:${runId}`;
  return {
    status: 'firing',
    fingerprint,
    startsAt: new Date().toISOString(),
    labels: {
      alertname: 'EngineReleaseFailed',
      severity: 'critical',
      component: 'engine-release',
      // The producer episode reliability intake pairs this firing row with
      // the row that later resolves it (engine-alert-episode.mjs). Without it
      // intake keys the member by this row's own id and no resolve can match.
      engine_alert_episode_id: engineAlertEpisodeId(fingerprint),
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
 * A REDELIVERY OF A SHIPPED SHA IS NOT A FAILED RELEASE (incident 484c4cee,
 * 2026-11-21). Run 44841264851 failed at prepare at 00:19 UTC for e2140d2d,
 * which sibling run 44841245126 had sealed and verified at 00:10, and paged a
 * critical incident about an engine that was serving. Before raising, the
 * append-only ca_engine_deploy_attempts receipts are read: when another run
 * already shipped this exact SHA, nothing is raised and the shipped run is
 * named. Returns that run, or null.
 */
export function shippedSibling(alert, receipts, isAncestor) {
  if (!alert) return null;
  const sha = alert.labels.target_sha;
  const run = alert.labels.run_id;
  const rows = Array.isArray(receipts) ? receipts : [];
  const exact = rows.find(
    (r) => r && r.shipped === true && r.target_sha === sha && r.run_id !== run
  );
  if (exact) return exact.run_id;
  if (typeof isAncestor === 'function' && SHA_RE.test(String(sha || ''))) {
    const newer = rows.find(
      (r) =>
        r &&
        r.shipped === true &&
        r.run_id !== run &&
        typeof r.target_sha === 'string' &&
        SHA_RE.test(r.target_sha) &&
        isAncestor(sha, r.target_sha) === true
    );
    if (newer) return newer.run_id;
  }
  return null;
}

/**
 * Resolve every open EngineReleaseFailed row after a verified ship. Each
 * resolve is built FROM its firing row (buildEpisodeResolve), so it carries
 * that row's exact alertname, component, fingerprint, startsAt and
 * engine_alert_episode_id and intake closes the same member. A firing row with
 * no episode (written before 2026-11-21) cannot be resolved by any appended
 * row; it is returned in `unresolvable` and named in the log, never sent as a
 * resolve that intake would record as resolved_not_of_this_episode.
 */
export function planReleaseResolutions(env, openRows = []) {
  const shipped = (env.SHIPPED || '').trim() === 'true';
  const superseded = (env.RELEASE_RESULT || '').trim() === 'superseded';
  const verified = (env.VERIFIED || '').trim() === 'true';
  const plan = { resolved: [], unresolvable: [] };
  if ((!shipped && !superseded) || !verified || !Array.isArray(openRows) || openRows.length === 0) {
    return plan;
  }

  const runId = (env.RUN_ID || 'unknown').trim().slice(0, 120) || 'unknown';
  const targetSha = (env.TARGET_SHA || 'unknown').trim().slice(0, 64) || 'unknown';
  const shortSha = targetSha.slice(0, 8);
  const releaseResult = (env.RELEASE_RESULT || 'sealed').trim().slice(0, 64) || 'sealed';

  const seen = new Set();
  for (const row of openRows) {
    const fp = typeof row?.fingerprint === 'string' ? row.fingerprint.trim() : '';
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    const alert = buildEpisodeResolve(
      {
        ...row,
        alertname: row?.alertname || 'EngineReleaseFailed',
        component: row?.component || 'engine-release',
      },
      {
        summary: `Engine release ${shortSha} verified live (run ${runId}, ${releaseResult})`,
        description: `Resolved prior EngineReleaseFailed (${fp}) after verified production ship of ${targetSha} in run ${runId} (${releaseResult}).`,
        extraLabels: { resolved_by_run_id: runId, resolved_by_sha: targetSha },
      }
    );
    if (alert) plan.resolved.push(alert);
    else plan.unresolvable.push(fp);
    if (plan.resolved.length >= 25) break;
  }
  return plan;
}

export function buildReleaseResolvedAlerts(env, openRows = []) {
  return planReleaseResolutions(env, openRows).resolved;
}

function warn(message) {
  console.log(`::warning title=RELEASE FAILURE ALERT NOT RECORDED::${message}`);
  process.exit(0);
}

async function main() {
  const alert = buildReleaseFailureAlert(process.env);
  const shipped = (process.env.SHIPPED || '').trim() === 'true';
  const superseded = (process.env.RELEASE_RESULT || '').trim() === 'superseded';
  const verified = (process.env.VERIFIED || '').trim() === 'true';
  const shouldResolve = !alert && (shipped || superseded) && verified;

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
      const receipts = await client.query(
        'SELECT run_id, target_sha, shipped FROM public.ca_engine_deploy_attempts WHERE shipped ORDER BY at DESC LIMIT 25'
      );
      const sibling = shippedSibling(alert, receipts.rows, gitIsAncestor);
      if (sibling) {
        console.log(
          `engine release ${alert.labels.target_sha} was already shipped or superseded by run ${sibling}; no failure alert raised.`
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
      return;
    }

    // public.engine_alerts has received_at, not created_at (a created_at
    // filter here made every auto-resolve throw before it sent anything).
    const { rows: openRows } = await client.query(
      `SELECT latest.fingerprint, latest.alertname, latest.component, latest.severity,
              latest.labels, latest.starts_at
         FROM (
           SELECT DISTINCT ON (fingerprint) fingerprint, alertname, component, severity,
                  status, labels, starts_at, received_at
             FROM public.engine_alerts
            WHERE alertname = 'EngineReleaseFailed'
              AND component = 'engine-release'
              AND received_at >= now() - interval '14 days'
            ORDER BY fingerprint, received_at DESC, id DESC
         ) latest
        WHERE latest.status = 'firing'
        ORDER BY latest.received_at DESC
        LIMIT 25`
    );
    const plan = planReleaseResolutions(process.env, openRows);
    for (const fp of plan.unresolvable) {
      console.log(
        `::warning title=ENGINE ALERT HAS NO EPISODE::${fp} predates engine_alert_episode_id; no appended row can resolve it.`
      );
    }
    const resolvedAlerts = plan.resolved;
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
