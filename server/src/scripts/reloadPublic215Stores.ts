/** One explicit loopback administrative request; credentials stay in the running
 * engine process environment. No retries, promotion, timers or game mutations. */
import { pathToFileURL } from 'node:url';
import {
  v31ControlAckValid,
  v31ControlIdentity,
} from '../engine/horseDecision/v31ReloadControl.js';
export function validateReloadReceipt(
  value: unknown,
  id: { requestId: string; datasetId: string; checksum: string },
  operation: 'reload' | 'status'
) {
  const r = value as any;
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).sort().join(',') !==
      'checksum,datasetId,expectedCells,requestId,state,workers' ||
    r.requestId !== id.requestId ||
    r.datasetId !== id.datasetId ||
    r.checksum !== id.checksum ||
    r.state !== 'complete' ||
    !Number.isSafeInteger(r.expectedCells) ||
    r.expectedCells < 1 ||
    r.expectedCells > 10000 ||
    !Array.isArray(r.workers) ||
    r.workers.length !== 8
  )
    throw Error('V31_RELOAD_INCOMPLETE');
  const seen = new Set<number>();
  for (const ack of r.workers) {
    if (!ack || typeof ack !== 'object') throw Error('V31_RELOAD_ACK');
    const { worker, ...body } = ack;
    if (
      !Number.isInteger(worker) ||
      worker < 0 ||
      worker > 7 ||
      seen.has(worker) ||
      !v31ControlAckValid(body) ||
      body.operation !== operation ||
      body.requestId !== id.requestId ||
      !body.ok ||
      body.error !== null ||
      body.count !== r.expectedCells ||
      body.dataset?.id !== id.datasetId ||
      body.dataset.checksum !== id.checksum
    )
      throw Error('V31_RELOAD_ACK');
    seen.add(worker);
  }
  return r;
}
/**
 * `clear` proves every worker EMPTY after the activation revoked this engine's
 * serving binding: it sends one ordinary reload of the still-active dataset,
 * which each worker's serving gate turns into the empty store, and accepts only
 * eight distinct worker acknowledgments that each hold zero cells and no
 * dataset after running that load (a worker still busy with an older load is
 * not proof, and is refused so the caller clears again).
 */
export function validateClearReceipt(
  value: unknown,
  id: { requestId: string; datasetId: string; checksum: string }
) {
  const r = value as any;
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).sort().join(',') !==
      'checksum,datasetId,expectedCells,requestId,state,workers' ||
    r.requestId !== id.requestId ||
    r.datasetId !== id.datasetId ||
    r.checksum !== id.checksum ||
    !Array.isArray(r.workers) ||
    r.workers.length !== 8
  )
    throw Error('V31_CLEAR_INCOMPLETE');
  const seen = new Set<number>();
  for (const ack of r.workers) {
    if (!ack || typeof ack !== 'object') throw Error('V31_CLEAR_ACK');
    const { worker, ...body } = ack;
    if (
      !Number.isInteger(worker) ||
      worker < 0 ||
      worker > 7 ||
      seen.has(worker) ||
      !v31ControlAckValid(body) ||
      body.operation !== 'reload' ||
      body.requestId !== id.requestId ||
      body.count !== 0 ||
      body.dataset !== null ||
      body.error === 'control_capacity_or_reload_busy' ||
      body.error === 'request_identity_conflict'
    )
      throw Error('V31_CLEAR_ACK');
    seen.add(worker);
  }
  return { requestId: r.requestId, datasetId: r.datasetId, checksum: r.checksum, emptyWorkers: 8 };
}
/** The host kills this process by PID on timeout; it also exits on its own first. */
const PROCESS_DEADLINE_MS = 160_000;
async function main() {
  setTimeout(() => {
    console.error('V31_RELOAD_PROCESS_DEADLINE');
    process.exit(124);
  }, PROCESS_DEADLINE_MS).unref();
  const [operation, requestId, datasetId, checksum, ...extra] = process.argv.slice(2);
  const id = { requestId, datasetId, checksum };
  if (extra.length || !['reload', 'status', 'clear'].includes(operation) || !v31ControlIdentity(id))
    throw Error('V31_RELOAD_EXACT_ARGUMENTS');
  const key = process.env.INTERNAL_API_KEY;
  if (!key) throw Error('V31_RELOAD_EXISTING_AUTH_UNAVAILABLE');
  const port = process.env.PORT ?? '8080';
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) > 65535 || Number(port) < 1)
    throw Error('V31_RELOAD_PORT');
  const url = new URL(`http://127.0.0.1:${port}/internal/gto-v31/reload`);
  if (operation === 'status') for (const [k, v] of Object.entries(id)) url.searchParams.set(k, v);
  const post = operation !== 'status';
  // A timeout is UNKNOWN, never an instruction to repeat POST. Use status with
  // the SAME retained identity for a fresh eight-worker read.
  const response = await fetch(url, {
    method: post ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    ...(post ? { body: JSON.stringify(id) } : {}),
    signal: AbortSignal.timeout(150000),
  });
  const value = await response.json();
  if (operation === 'clear') {
    // An emptied worker reports a partial reload (409); nothing else is accepted.
    if (response.status !== 409 && response.status !== 200)
      throw Error('V31_CLEAR_HTTP_' + response.status);
    process.stdout.write(
      JSON.stringify({
        format: 'v31_explicit_store_clear_receipt_v1',
        operation,
        observedAt: new Date().toISOString(),
        sourceSha: process.env.GIT_COMMIT_SHA,
        receipt: validateClearReceipt(value, id),
      }) + '\n'
    );
    return;
  }
  if (!response.ok) throw Error('V31_RELOAD_HTTP_' + response.status);
  const receipt = validateReloadReceipt(value, id, operation as 'reload' | 'status');
  process.stdout.write(
    JSON.stringify({
      format: 'v31_explicit_store_control_receipt_v1',
      operation,
      observedAt: new Date().toISOString(),
      sourceSha: process.env.GIT_COMMIT_SHA,
      receipt,
    }) + '\n'
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('V31_RELOAD_OUTCOME_UNCONFIRMED_USE_STATUS_WITH_SAME_ID');
    process.exitCode = 1;
  });
