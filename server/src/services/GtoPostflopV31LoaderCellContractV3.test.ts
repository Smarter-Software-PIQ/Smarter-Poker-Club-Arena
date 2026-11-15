// FLOP-5 D6: the loader reads the v3 cell readers only when the default-OFF
// switch is on; a v2 row read through them loads exactly as through the v2
// readers; a v3 row loads into a store that declares cell contract v3.
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
import { loadGtoPostflopV31Evaluation, stopGtoPostflopV31Loader } from './GtoPostflopV31Loader.js';
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
