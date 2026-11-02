// Streamed by scripts/ci/v31-atomic-promotion-host.sh into the serving engine
// container (`node --input-type=module -`) while the host engine lock is held.
// It uses the engine's own compiled database client and credentials, promotes
// exactly the evaluated epoch for the serving commit, and prints one JSON line.
// Exit 0: promoted now or already promoted for this epoch (re-run safe).
// Exit 10: refused before any change. Exit 20: outcome unknown.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const say = (value) => process.stdout.write(JSON.stringify({ stage: 'promote', ...value }) + '\n');

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

if (process.argv[1] === '-') {
  let code = 20;
  try {
    const { maintenanceSupabase } = await import(pathToFileURL(resolve('dist/services/supabase/client.js')).href);
    const [exit, body] = await promoteOnce(process.argv.slice(2), process.env, maintenanceSupabase);
    say(body);
    code = exit;
  } catch {
    say({ result: 'unknown' });
  }
  process.exit(code);
}
