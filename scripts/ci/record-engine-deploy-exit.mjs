/**
 * Record where this auto-deploy-hetzner run's deploy job exited (Phase 6,
 * 2026-10-31).
 *
 * 0 of 22+ releases sealed from 2026-10-29 and every receipt said only "did
 * not prove a completed durable Hetzner release transaction". This writes one
 * append-only row to engine_deploy_exit_paths per run: the stage the run
 * stopped at, its outcome and error, the target sha and the run id.
 *
 * Best-effort: every error path exits 0 with a warning. The strict receipt
 * (record-engine-deploy-attempt.mjs) remains the run's authoritative record.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** The exit path as one pure function of the job results, so it is testable. */
export function deployExitPath(env) {
  const doors = (env.DOORS_RESULT || '').trim();
  const deploy = (env.DEPLOY_RESULT || '').trim();
  if (doors && doors !== 'success') {
    return {
      stage: 'engine-doors',
      outcome: doors,
      error: (env.DOORS_REFUSAL || '').trim() || `engine-doors job ended ${doors}`,
    };
  }
  if (!deploy || deploy === 'skipped') {
    return { stage: 'deploy', outcome: 'skipped', error: 'deploy job did not run' };
  }
  const stage = (env.EXIT_STAGE || '').trim();
  const outcome = (env.EXIT_OUTCOME || '').trim();
  if (!stage || stage === 'unknown') {
    // The naming step itself never ran (the job was killed or cancelled
    // before it): the job result is all there is, and it is said as such.
    return {
      stage: 'deploy',
      outcome: deploy,
      error: `deploy job ended ${deploy} before naming its exit path`,
    };
  }
  return {
    stage,
    outcome: outcome || deploy,
    error: (env.EXIT_ERROR || '').trim() || null,
  };
}

function warn(message) {
  console.log(`::warning title=DEPLOY EXIT PATH NOT RECORDED::${message}`);
  process.exit(0);
}

async function main() {
  const url = process.env.DATABASE_URL;
  const targetSha = (process.env.TARGET_SHA || '').trim();
  const runId = (process.env.RUN_ID || '').slice(0, 120);
  const exit = deployExitPath(process.env);
  console.log(
    `deploy exit path: stage=${exit.stage} outcome=${exit.outcome}` +
      (exit.error ? ` error=${exit.error}` : '')
  );
  if (!url) warn('DATABASE_URL is not configured.');
  if (!targetSha) warn('No target sha to record.');
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
    const { rows } = await client.query(
      'SELECT public.fn_ca_record_engine_deploy_exit($1, $2, $3, $4, $5, $6) AS id',
      [
        runId || null,
        targetSha,
        exit.stage,
        exit.outcome,
        exit.error,
        (process.env.RELEASE_RESULT || '').slice(0, 120) || null,
      ]
    );
    console.log(`deploy exit path recorded: ${rows[0]?.id}`);
  } catch (err) {
    warn(`${err?.message || err}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => warn(`${err?.message || err}`));
}
