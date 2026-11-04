// Streamed by scripts/ci/v31-atomic-promotion-host.sh into the serving engine
// container (`node --input-type=module - <mode> ...`). It uses the engine's own
// compiled database client and credentials and prints one JSON line.
//   promote dataset checksum engine serving
//   bind    dataset engine serving closure_digest bound_by
//   revoke  dataset serving revoked_by
// Exit 0: done now or already done (re-run safe). Exit 10: refused before any
// change. Exit 20: outcome unknown. A hard deadline exits 124 by itself.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BY = /^[A-Za-z0-9:._/@-]{1,200}$/;
const STEP_DEADLINE_MS = 45_000;

export async function promoteOnce(args, env, client) {
  const [datasetId, checksum, engineSha, servingSha, ...extra] = args;
  if (extra.length || !UUID.test(datasetId ?? '') || !HEX.test(checksum ?? '') || !SHA.test(engineSha ?? '') ||
      !SHA.test(servingSha ?? '')) return [10, { result: 'refused', reason: 'arguments' }];
  if (env.GIT_COMMIT_SHA !== servingSha) return [10, { result: 'refused', reason: 'serving_identity' }];
  const read = async () => {
    const { data, error } = await client.rpc('ca_gto_v31_certification_status', { p_dataset_id: datasetId });
    const rows = data?.datasets;
    if (error || !Array.isArray(rows) || rows.length !== 1 || rows[0]?.dataset_id !== datasetId) throw Error('status');
    return rows[0];
  };
  let before;
  try { before = await read(); } catch { return [10, { result: 'refused', reason: 'status_unavailable' }]; }
  const epoch = before.current_epoch;
  if (before.dataset_checksum !== checksum || !epoch || epoch.engine_commit !== engineSha)
    return [10, { result: 'refused', reason: 'epoch_mismatch' }];
  if (before.state === 'active' && epoch.promoted_at && SHA.test(epoch.promoted_serving_commit ?? ''))
    return [0, { result: 'already-promoted', epochNo: epoch.epoch_no, engineCommit: engineSha,
      promotedServingCommit: epoch.promoted_serving_commit }];
  if (before.state !== 'candidate' || epoch.promoted_at) return [10, { result: 'refused', reason: 'not_candidate' }];
  let response;
  try {
    response = await client.rpc('fn_gto_v31_promote_dataset_epoch', {
      p_dataset_id: datasetId, p_engine_commit: engineSha, p_serving_commit: servingSha,
    });
  } catch { return [20, { result: 'unknown' }]; }
  // A raised gate (P0001) rolled the whole promotion transaction back.
  if (response.error) return response.error.code === 'P0001'
    ? [10, { result: 'refused', reason: 'gates', message: String(response.error.message).slice(0, 300) }]
    : [20, { result: 'unknown' }];
  let after;
  try { after = await read(); } catch { return [20, { result: 'unknown' }]; }
  if (response.data !== checksum || after.state !== 'active' || after.current_epoch?.epoch_id !== epoch.epoch_id ||
      after.current_epoch?.promoted_serving_commit !== servingSha) return [20, { result: 'unknown' }];
  return [0, { result: 'promoted', epochNo: epoch.epoch_no, engineCommit: engineSha, servingCommit: servingSha }];
}

/** Bind exactly the serving commit the workflow proved closure-identical to the promoted epoch. */
export async function bindOnce(args, env, client) {
  const [datasetId, engineSha, servingSha, digest, boundBy, ...extra] = args;
  if (extra.length || !UUID.test(datasetId ?? '') || !SHA.test(engineSha ?? '') || !SHA.test(servingSha ?? '') ||
      !HEX.test(digest ?? '') || !BY.test(boundBy ?? '')) return [10, { result: 'refused', reason: 'arguments' }];
  if (env.GIT_COMMIT_SHA !== servingSha) return [10, { result: 'refused', reason: 'serving_identity' }];
  let response;
  try {
    response = await client.rpc('fn_gto_v31_bind_serving', { p_dataset_id: datasetId, p_engine_commit: engineSha,
      p_serving_commit: servingSha, p_closure_digest: digest, p_bound_by: boundBy,
      p_reason: `Closure-identical serving engine ${servingSha} verified for epoch engine ${engineSha}` });
  } catch { return [20, { result: 'unknown' }]; }
  if (response.error) return response.error.code === 'P0001'
    ? [10, { result: 'refused', reason: 'gates', message: String(response.error.message).slice(0, 300) }]
    : [20, { result: 'unknown' }];
  let admission;
  try { admission = await client.rpc('fn_gto_v31_serving_admission', { p_engine_commit: servingSha }); }
  catch { return [20, { result: 'unknown' }]; }
  if (admission.error || admission.data?.admitted !== true || admission.data?.active?.dataset_id !== datasetId)
    return [20, { result: 'unknown' }];
  return [0, { result: response.data?.bound ? 'bound' : 'already-bound', servingCommit: servingSha }];
}

/** Close the open binding; proven by an admission read that refuses the serving commit. */
export async function revokeOnce(args, env, client) {
  const [datasetId, servingSha, revokedBy, ...extra] = args;
  if (extra.length || !UUID.test(datasetId ?? '') || !SHA.test(servingSha ?? '') || !BY.test(revokedBy ?? ''))
    return [10, { result: 'refused', reason: 'arguments' }];
  let response;
  try {
    response = await client.rpc('fn_gto_v31_revoke_serving', { p_dataset_id: datasetId, p_serving_commit: servingSha,
      p_revoked_by: revokedBy, p_reason: 'Activation did not complete on all eight workers; serving the empty store' });
  } catch { return [20, { result: 'unknown' }]; }
  if (response.error) return [20, { result: 'unknown' }];
  let admission;
  try { admission = await client.rpc('fn_gto_v31_serving_admission', { p_engine_commit: servingSha }); }
  catch { return [20, { result: 'unknown' }]; }
  if (admission.error || admission.data?.admitted !== false) return [20, { result: 'unknown' }];
  return [0, { result: response.data === true ? 'revoked' : 'not-bound' }];
}

export const MODES = Object.freeze({ promote: promoteOnce, bind: bindOnce, revoke: revokeOnce });

if (process.argv[1] === '-') {
  const mode = process.argv[2];
  const say = (value) => process.stdout.write(JSON.stringify({ stage: mode, ...value }) + '\n');
  // The host also kills this process by PID; this deadline makes it exit on its own first.
  setTimeout(() => { say({ result: 'unknown', reason: 'deadline' }); process.exit(124); }, STEP_DEADLINE_MS).unref();
  let code = 20;
  try {
    if (!Object.hasOwn(MODES, mode)) { say({ result: 'refused', reason: 'mode' }); process.exit(10); }
    const { maintenanceSupabase } = await import(pathToFileURL(resolve('dist/services/supabase/client.js')).href);
    const [exit, body] = await MODES[mode](process.argv.slice(3), process.env, maintenanceSupabase);
    say(body);
    code = exit;
  } catch {
    say({ result: 'unknown' });
  }
  process.exit(code);
}
