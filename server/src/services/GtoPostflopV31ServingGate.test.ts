// The live-worker serving gate: a promoted V31 dataset is served only on an
// engine commit holding an open serving binding; anything else is the empty
// store, and two datasets are never held side by side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), registration: vi.fn() }));
// Every cell these loads serve carries a valid range-provenance declaration
// (GtoPostflopV31RangeProvenance.test.ts covers the refusals).
vi.mock('./supabase/client.js', () => ({
  supabase: {
    rpc: transport.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: transport.registration }) }),
    }),
  },
}));
vi.mock('./errorReporter.js', () => ({ reportError: transport.report }));
import {
  _resetGtoV31ServingBinding,
  loadGtoPostflopV31Once,
  requireGtoV31ServingBinding,
  stopGtoPostflopV31Loader,
} from './GtoPostflopV31Loader.js';
import {
  _clearGtoPostflopV31,
  gtoPostflopV31Count,
  gtoPostflopV31Dataset,
  replaceGtoPostflopV31,
} from '../engine/GtoPostflopV31.js';
import { CELL, rangeProvenanceFor } from './V31LoaderFixture.js';

const SERVING = 'b'.repeat(40);
const A = { dataset_id: CELL.dataset_id, dataset_checksum: CELL.dataset_checksum };
const B = { dataset_id: '22222222-2222-4222-8222-222222222222', dataset_checksum: '9'.repeat(64) };
const admission = (active: typeof A | null, admitted: boolean) => ({
  data: { active, admitted },
  error: null,
});
const names = () => transport.rpc.mock.calls.map(([name]) => name);

beforeEach(() => {
  transport.rpc.mockReset();
  transport.report.mockReset();
  transport.registration.mockReset();
  transport.registration.mockResolvedValue({
    data: { cell_provenance: rangeProvenanceFor([CELL]) },
    error: null,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  _clearGtoPostflopV31();
  expect(replaceGtoPostflopV31([structuredClone(CELL)])).toBe(1);
  requireGtoV31ServingBinding(SERVING);
});
afterEach(() => {
  stopGtoPostflopV31Loader();
  _resetGtoV31ServingBinding();
  _clearGtoPostflopV31();
  vi.restoreAllMocks();
});

describe('V31 serving binding gate', () => {
  it('an engine commit without an open binding serves the empty store and reports the refusal', async () => {
    transport.rpc.mockResolvedValueOnce(admission(A, false));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31Count()).toBe(0);
    expect(gtoPostflopV31Dataset()).toBeNull();
    expect(transport.rpc).toHaveBeenCalledWith('fn_gto_v31_serving_admission', {
      p_engine_commit: SERVING,
    });
    expect(names()).not.toContain('fn_gto_v31_active_cells');
    expect(transport.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'v31_serving_binding_refused' }),
      'GtoPostflopV31Loader.gate'
    );
  });
  it.each([undefined, '', 'abc', '0'.repeat(40)])(
    'a build without a provable commit (%s) never serves V31',
    async (commit) => {
      requireGtoV31ServingBinding(commit);
      await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 0 });
      expect(gtoPostflopV31Count()).toBe(0);
      expect(transport.rpc).not.toHaveBeenCalled();
    }
  );
  it('a bound engine loads the active dataset and re-reads the binding before swapping', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(A, true))
      .mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null })
      .mockResolvedValueOnce(admission(A, true));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 1 });
    expect(names()).toEqual([
      'fn_gto_v31_serving_admission',
      'fn_gto_v31_active_cells',
      'fn_gto_v31_serving_admission',
    ]);
    expect(gtoPostflopV31Dataset()).toMatchObject({
      id: A.dataset_id,
      checksum: A.dataset_checksum,
    });
  });
  it('a revocation that lands while pages are read wins: the store is emptied, not loaded', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(A, true))
      .mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null })
      .mockResolvedValueOnce(admission(A, false));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31Count()).toBe(0);
  });
  it('a newly active dataset never leaves the retired one served when its load fails (no two-dataset mix)', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(B, true))
      .mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } });
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: false, count: 0 });
    expect(gtoPostflopV31Dataset()).toBeNull();
  });
  it('rows of another dataset than the admitted one are refused and nothing is served', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(B, true))
      .mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null })
      .mockResolvedValueOnce(admission(B, true));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: false, count: 0 });
    expect(gtoPostflopV31Dataset()).toBeNull();
  });
  it('no active dataset is the ordinary authoritative empty store', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(null, false))
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce(admission(null, false));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 0 });
    expect(gtoPostflopV31Count()).toBe(0);
  });
  it.each([
    { data: null, error: { message: 'down' } },
    { data: { active: null, admitted: true }, error: null },
    { data: { active: { dataset_id: 'x', dataset_checksum: 'y' }, admitted: true }, error: null },
  ])(
    'an unreadable or malformed admission fails closed: the held dataset is dropped (%j)',
    async (reply) => {
      transport.rpc.mockResolvedValueOnce(reply);
      await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: false, count: 0 });
      expect(gtoPostflopV31Dataset()).toBeNull();
      expect(gtoPostflopV31Count()).toBe(0);
    }
  );
  it('an admission re-read that fails after the pages are collected also fails closed', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(A, true))
      .mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null })
      .mockRejectedValueOnce(new Error('connection reset'));
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: false, count: 0 });
    expect(gtoPostflopV31Dataset()).toBeNull();
  });
  it('a page failure on the admitted dataset keeps that admitted dataset (the binding was just proven)', async () => {
    transport.rpc
      .mockResolvedValueOnce(admission(A, true))
      .mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } });
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: false, count: 0 });
    expect(gtoPostflopV31Dataset()).toMatchObject({ id: A.dataset_id });
  });
  it('offline evaluators that never arm the gate keep reading the database active dataset', async () => {
    _resetGtoV31ServingBinding();
    transport.rpc.mockResolvedValueOnce({ data: [structuredClone(CELL)], error: null });
    await expect(loadGtoPostflopV31Once()).resolves.toEqual({ ok: true, count: 1 });
    expect(names()).toEqual(['fn_gto_v31_active_cells']);
  });
});
