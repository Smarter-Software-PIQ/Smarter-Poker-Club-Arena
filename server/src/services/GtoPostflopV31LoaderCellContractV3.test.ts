// FLOP-5 D6: the loader reads the v3 cell readers only when the live switch
// gives gtoV31CellContractV3Serving true; a v2 row read through them loads
// exactly as through the v2 readers; a v3 row loads into a store that declares
// cell contract v3. N3: a bound live worker whose admitted active dataset reads
// empty through the v2 reader probes the v3 reader once and raises an alarm
// when that dataset is a v3 one; a load that serves cells makes no extra call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn() }));
vi.mock('./supabase/client.js', () => ({
  supabase: {
    rpc: (...args: unknown[]) => Promise.resolve(transport.rpc(...args)),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));
vi.mock('./errorReporter.js', () => ({ reportError: transport.report }));
import {
  _resetGtoV31ServingBinding,
  gtoPostflopV31CellContractV3Alarm,
  loadGtoPostflopV31Evaluation,
  loadGtoPostflopV31Once,
  requireGtoV31ServingBinding,
  stopGtoPostflopV31Loader,
} from './GtoPostflopV31Loader.js';
import {
  _clearGtoPostflopV31,
  gtoPostflopV31EvaluationCount,
  gtoStreetAdviceV31,
  gtoV31StoreCellContract,
} from '../engine/GtoPostflopV31.js';
import { _setGtoV31CellContractV3ServingForTest } from '../engine/GtoV31CellContractV3Serving.js';
import { evaluationCell } from './V31LoaderFixture.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (v: string): Card[] =>
  (v.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUITS[c[1]] }));
const lookup = (checksum: string) =>
  gtoStreetAdviceV31({
    street: 'turn',
    family: 'cash',
    objective: 'cash_ev',
    utilityContext: 'cash_ev',
    tableSize: 2,
    potType: 'limped',
    heroPosition: 'SB',
    opponentPosition: 'BB',
    stackBB: 80,
    board: cards('Qh9d7c2h'),
    hand: 'AKs',
    holeCards: cards('AsKs'),
    nodeRole: 'barrel',
    facingKind: 'none',
    facingSizeBucket: 'none',
    datasetChecksum: checksum,
  });

beforeEach(() => {
  transport.rpc.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
});
afterEach(() => {
  stopGtoPostflopV31Loader();
  _clearGtoPostflopV31();
  _setGtoV31CellContractV3ServingForTest(null);
  _resetGtoV31ServingBinding();
  transport.report.mockReset();
  vi.restoreAllMocks();
});

describe('V31 loader and cell contract v3 (dormant)', () => {
  it('reads the v2 reader by default, exactly as before', async () => {
    const row = evaluationCell();
    transport.rpc.mockResolvedValueOnce({ data: [row], error: null });
    await loadGtoPostflopV31Evaluation(row.dataset_id);
    expect(transport.rpc).toHaveBeenCalledWith('fn_gto_v31_evaluation_cells', {
      p_dataset_id: row.dataset_id,
      p_offset: 0,
      p_limit: 500,
    });
    expect(transport.rpc).not.toHaveBeenCalledWith(
      'fn_gto_v31_evaluation_cells_v3',
      expect.anything()
    );
  });

  it('with the switch on, a v2 row read through the v3 reader loads identically', async () => {
    const row = evaluationCell();
    transport.rpc.mockResolvedValueOnce({ data: [row], error: null });
    const off = await loadGtoPostflopV31Evaluation(row.dataset_id);
    const offLookup = lookup(row.dataset_checksum);
    _clearGtoPostflopV31();
    _setGtoV31CellContractV3ServingForTest(true);
    transport.rpc.mockResolvedValueOnce({
      data: [{ ...row, cell_contract_version: null, line_class: null }],
      error: null,
    });
    const on = await loadGtoPostflopV31Evaluation(row.dataset_id);
    expect(transport.rpc).toHaveBeenLastCalledWith('fn_gto_v31_evaluation_cells_v3', {
      p_dataset_id: row.dataset_id,
      p_offset: 0,
      p_limit: 500,
    });
    expect(on).toEqual(off);
    expect(lookup(row.dataset_checksum)).toEqual(offLookup);
    expect(gtoV31StoreCellContract(row.dataset_checksum)).toBe('v2');
  });

  it('with the switch on, v3 rows load into a store that declares cell contract v3', async () => {
    _setGtoV31CellContractV3ServingForTest(true);
    const row = {
      ...evaluationCell(),
      cell_contract_version: 'v3',
      line_class: 'x.b-mid.c/x',
      depth_bucket: 200,
    };
    transport.rpc.mockResolvedValueOnce({ data: [row], error: null });
    await loadGtoPostflopV31Evaluation(row.dataset_id);
    expect(gtoPostflopV31EvaluationCount(row.dataset_checksum)).toBe(1);
    expect(gtoV31StoreCellContract(row.dataset_checksum)).toBe('v3');
    // The v2 consult never answers from it.
    expect(lookup(row.dataset_checksum)).toEqual({ hit: false, miss: 'no_line_class' });
  });

  it('a missing v3 reader fails the load and changes nothing', async () => {
    _setGtoV31CellContractV3ServingForTest(true);
    transport.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not find the function' },
    });
    await expect(loadGtoPostflopV31Evaluation(evaluationCell().dataset_id)).rejects.toThrow(
      'Could not find the function'
    );
    expect(gtoPostflopV31EvaluationCount('7'.repeat(64))).toBe(0);
  });
});

describe('a v3 dataset active while v3 serving is off raises an alarm, never a silent empty store (N3)', () => {
  const COMMIT = 'a'.repeat(40);
  function live(datasetId: string, answers: Record<string, unknown>) {
    const active = { dataset_id: datasetId, dataset_checksum: '7'.repeat(64) };
    transport.rpc.mockImplementation((name: string) => {
      if (name === 'fn_gto_v31_serving_admission')
        return { data: { active, admitted: true }, error: null };
      const answer = answers[name];
      return answer instanceof Error
        ? { data: null, error: { message: answer.message } }
        : { data: answer ?? [], error: null };
    });
    requireGtoV31ServingBinding(COMMIT);
  }
  const calls = () => transport.rpc.mock.calls.map((c) => c[0] as string);
  const alarmed = () =>
    transport.report.mock.calls.filter(
      (c) => String((c[0] as Error)?.message) === 'v31_v3_dataset_active_while_v3_serving_off'
    ).length;

  it('probes the v3 reader once and alarms, once per dataset', async () => {
    const id = '33333333-3333-4333-8333-333333333331';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    live(id, {
      fn_gto_v31_active_cells: [],
      fn_gto_v31_active_cells_v3: [{ dataset_id: id, cell_contract_version: 'v3' }],
    });
    expect(await loadGtoPostflopV31Once()).toEqual({ ok: true, count: 0 });
    expect(calls().filter((n) => n === 'fn_gto_v31_active_cells_v3')).toHaveLength(1);
    expect(alarmed()).toBe(1);
    expect(
      error.mock.calls.some((c) =>
        String(c[0]).includes('V31_V3_DATASET_ACTIVE_WHILE_V3_SERVING_OFF')
      )
    ).toBe(true);
    expect(gtoPostflopV31CellContractV3Alarm()).toBe(id);
    await loadGtoPostflopV31Once();
    expect(alarmed()).toBe(1);
  });

  it('a v2 answer, an error or another dataset from the probe raises nothing', async () => {
    const id = '33333333-3333-4333-8333-333333333332';
    for (const probe of [
      [{ dataset_id: id, cell_contract_version: null }],
      new Error('Could not find the function'),
      [],
      [{ dataset_id: '33333333-3333-4333-8333-333333333339', cell_contract_version: 'v3' }],
    ]) {
      transport.report.mockReset();
      live(id, { fn_gto_v31_active_cells: [], fn_gto_v31_active_cells_v3: probe });
      expect((await loadGtoPostflopV31Once()).ok).toBe(true);
      expect(alarmed(), JSON.stringify(probe)).toBe(0);
    }
  });

  it('a load that serves cells makes no extra call, and re-arms the alarm', async () => {
    const id = '33333333-3333-4333-8333-333333333331';
    const row = { ...evaluationCell(), dataset_id: id };
    live(id, { fn_gto_v31_active_cells: [row] });
    await loadGtoPostflopV31Once();
    expect(calls()).not.toContain('fn_gto_v31_active_cells_v3');
    expect(gtoPostflopV31CellContractV3Alarm()).toBeNull();
  });

  it('with v3 serving on, or with no serving binding (offline), there is no probe', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    _setGtoV31CellContractV3ServingForTest(true);
    live(id, { fn_gto_v31_active_cells_v3: [] });
    await loadGtoPostflopV31Once();
    expect(calls().filter((n) => n === 'fn_gto_v31_active_cells_v3')).toHaveLength(1); // the read itself
    expect(alarmed()).toBe(0);
    _setGtoV31CellContractV3ServingForTest(null);
    transport.rpc.mockReset();
    _resetGtoV31ServingBinding();
    transport.rpc.mockImplementation(() => ({ data: [], error: null }));
    await loadGtoPostflopV31Once();
    expect(calls()).toEqual(['fn_gto_v31_active_cells']);
  });
});
