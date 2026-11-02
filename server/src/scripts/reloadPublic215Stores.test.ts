import { describe, it, expect } from 'vitest';
import { validateClearReceipt, validateReloadReceipt } from './reloadPublic215Stores.js';
import { readFileSync } from 'node:fs';
const id = {
  requestId: '12345678-1234-4234-8234-123456789abc',
  datasetId: '12345678-1234-4234-8234-123456789abd',
  checksum: 'a'.repeat(64),
};
const good = () => ({
  ...id,
  state: 'complete',
  expectedCells: 107,
  workers: Array.from({ length: 8 }, (_, worker) => ({
    worker,
    type: 'V31_STORE_CONTROL_ACK',
    operation: 'reload',
    requestId: id.requestId,
    ok: true,
    count: 107,
    dataset: { id: id.datasetId, checksum: id.checksum },
    error: null,
  })),
});
describe('explicit store control consumer', () => {
  it('requires eight exact acknowledgments', () =>
    expect(validateReloadReceipt(good(), id, 'reload').workers).toHaveLength(8));
  it('refuses partial, duplicate, stale, mismatched, failed and wrong-operation replies', () => {
    for (const edit of [
      (r: any) => (r.state = 'partial'),
      (r: any) => r.workers.pop(),
      (r: any) => (r.workers[1].worker = 0),
      (r: any) => (r.workers[0].dataset.checksum = 'b'.repeat(64)),
      (r: any) => (r.workers[0].ok = false),
      (r: any) => (r.workers[0].operation = 'status'),
      (r: any) => (r.requestId = id.datasetId),
    ]) {
      const r = good();
      edit(r);
      expect(() => validateReloadReceipt(r, id, 'reload')).toThrow();
    }
  });
});

const emptied = () => ({
  ...id,
  state: 'partial',
  expectedCells: 107,
  workers: Array.from({ length: 8 }, (_, worker) => ({
    worker,
    type: 'V31_STORE_CONTROL_ACK',
    operation: 'reload',
    requestId: id.requestId,
    ok: false,
    count: 0,
    dataset: null,
    error: 'active_store_identity_not_confirmed',
  })),
});
describe('a revoked activation proves every worker empty', () => {
  it('accepts only eight distinct workers that each ran the load and hold no dataset', () =>
    expect(validateClearReceipt(emptied(), id)).toEqual({ ...id, emptyWorkers: 8 }));
  it('refuses a worker still holding cells, a busy worker, missing or duplicate workers and stale requests', () => {
    for (const edit of [
      (r: any) =>
        Object.assign(r.workers[3], {
          count: 107,
          dataset: { id: id.datasetId, checksum: id.checksum },
        }),
      (r: any) => (r.workers[5].error = 'control_capacity_or_reload_busy'),
      (r: any) => r.workers.pop(),
      (r: any) => (r.workers[1].worker = 0),
      (r: any) => (r.workers[2].requestId = '12345678-1234-4234-8234-123456789abe'),
      (r: any) => (r.workers[0].operation = 'status'),
      (r: any) => (r.checksum = 'b'.repeat(64)),
    ]) {
      const r = emptied();
      edit(r);
      expect(() => validateClearReceipt(r, id)).toThrow();
    }
  });
  it('the worker thread arms the serving gate before it can receive any store control message', () => {
    const worker = readFileSync(
      new URL('../engine/horseDecision/worker.ts', import.meta.url),
      'utf8'
    );
    const start = worker.indexOf('if (!isMainThread && parentPort) {');
    const gate = worker.indexOf('requireGtoV31ServingBinding(process.env.GIT_COMMIT_SHA);', start);
    expect(start).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(start);
    for (const later of ['createV31WorkerControl({', "port.on('message'", 'void runtime.start();'])
      expect(worker.indexOf(later, start)).toBeGreaterThan(gate);
  });
  it('live decision workers arm the serving gate before their first V31 load', () => {
    const runtime = readFileSync(
      new URL('../engine/horseDecision/workerRuntime.ts', import.meta.url),
      'utf8'
    );
    const gate = runtime.indexOf('requireGtoV31ServingBinding(process.env.GIT_COMMIT_SHA);');
    expect(gate).toBeGreaterThan(0);
    expect(runtime.indexOf('return loadGtoPostflopV31();', gate)).toBeGreaterThan(gate);
    expect(runtime.slice(0, gate)).not.toMatch(/\bloadGtoPostflopV31\(\)/);
  });
});
