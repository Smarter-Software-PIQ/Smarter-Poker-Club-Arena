import { describe, expect, it } from 'vitest';
import {
  V31_EXACT_SCHEME,
  V31_R9_CANDIDATE_SCHEMES,
  v31CoverageKey,
  v31CoverageReport,
  v31DepthBand,
  v31NodeRoleBand,
  v31TableBand,
  v31TextureBand,
  type V31CoverageRecord,
  type V31KeyingScheme,
} from './GtoV31HumanCoverage.js';

function rec(over: Partial<V31CoverageRecord> = {}): V31CoverageRecord {
  return {
    decisionId: 'h:1',
    handId: 'h',
    createdAt: '2026-10-01T00:00:00Z',
    street: 'turn',
    status: 'keyed',
    facesHuman: true,
    liveOpponents: 1,
    tableSize: 6,
    potType: 'srp',
    heroPosition: 'BTN',
    opponentPosition: 'BB',
    stackBB: 95,
    texture: 'Brud',
    nodeRole: 'barrel',
    facingKind: 'none',
    facingSizeBucket: 'none',
    heroInPosition: true,
    preflopAggressor: 'hero',
    multiwayOrder: null,
    ...over,
  };
}

const R9: V31KeyingScheme = {
  name: 'r9',
  tableSize: 'band3',
  positions: 'relative',
  depth: 'exact',
  texture: 'suitPair',
  potType: 'lrpOwn',
  nodeRole: 'merged',
  facingSize: 'any',
  multiway: 'class',
};

describe('V31 human-coverage keying', () => {
  it('bands follow the engine depth boundaries and the declared table bands', () => {
    expect([10, 12, 13, 30, 31, 60, 61, 110, 111].map((s) => v31DepthBand(s, 'exact'))).toEqual([
      '10',
      '10',
      '20',
      '20',
      '40',
      '40',
      '80',
      '80',
      '150',
    ]);
    expect(v31DepthBand(11, 'band3')).toBe('10');
    expect(v31DepthBand(25, 'band3')).toBe('20');
    expect(v31DepthBand(45, 'band3')).toBe('40+');
    expect(v31DepthBand(400, 'band3')).toBe('40+');
    expect([2, 3, 6, 7, 10].map((n) => v31TableBand(n, 'band3'))).toEqual([
      'hu',
      'sh',
      'sh',
      'fr',
      'fr',
    ]);
    expect(v31TableBand(9, 'band2')).toBe('ring');
    expect(v31TextureBand('Brud', 'noHigh')).toBe('rud');
    expect(v31TextureBand('Brud', 'suitPair')).toBe('ru');
    expect(v31NodeRoleBand('delayed_cbet', 'merged')).toBe('agg_bet');
    expect(v31NodeRoleBand('probe', 'merged')).toBe('lead');
    expect(v31NodeRoleBand('check_raise', 'merged')).toBe('facing_raise');
    expect(v31NodeRoleBand('facing_bet', 'merged')).toBe('facing_bet');
  });

  it('the exact scheme keys only what the engine keys: heads-up, never lrp, never multiway', () => {
    expect(v31CoverageKey(rec(), V31_EXACT_SCHEME)).toBe(
      'hu|BTNvBB|turn|6|srp|80|Brud|barrel|none'
    );
    expect(v31CoverageKey(rec({ potType: 'lrp' }), V31_EXACT_SCHEME)).toBeNull();
    expect(
      v31CoverageKey(
        rec({ status: 'multiway', liveOpponents: 2, multiwayOrder: 'first' }),
        V31_EXACT_SCHEME
      )
    ).toBeNull();
    expect(v31CoverageKey(rec({ stackBB: null }), V31_EXACT_SCHEME)).toBeNull();
  });

  it('coarser schemes merge contexts the exact scheme keeps apart', () => {
    const a = rec({ tableSize: 4, heroPosition: 'BTN', texture: 'Arud' });
    const b = rec({ tableSize: 6, heroPosition: 'CO', texture: 'Lrud', nodeRole: 'delayed_cbet' });
    expect(v31CoverageKey(a, V31_EXACT_SCHEME)).not.toBe(v31CoverageKey(b, V31_EXACT_SCHEME));
    expect(v31CoverageKey(a, R9)).toBe(v31CoverageKey(b, R9));
    expect(v31CoverageKey(rec({ potType: 'lrp' }), R9)).toContain('|lrp|');
    expect(v31CoverageKey(rec({ potType: 'lrp' }), { ...R9, potType: 'lrpAsSrp' })).toContain(
      '|srp|'
    );
  });

  it('the multiway class keys 3-way and 4+-way pots by order and aggressor', () => {
    const three = rec({
      status: 'multiway',
      liveOpponents: 2,
      multiwayOrder: 'last',
      opponentPosition: null,
    });
    const four = rec({
      status: 'multiway',
      liveOpponents: 4,
      multiwayOrder: 'first',
      preflopAggressor: 'opponent',
    });
    expect(v31CoverageKey(three, R9)).toBe('mw|3|last|hero|turn|sh|srp|80|ru|agg_bet|*');
    expect(v31CoverageKey(four, R9)).toBe('mw|4+|first|opponent|turn|sh|srp|80|ru|agg_bet|*');
    const hux = rec({ status: 'unkeyable', why: ['third_party_postflop_action'] });
    expect(v31CoverageKey(hux, R9)).toBe('hux|ip:hero|turn|sh|srp|80|ru|agg_bet|*');
    expect(v31CoverageKey({ ...hux, why: ['no_root_stack'] }, R9)).toBeNull();
    // The engine declines multiway leads; the class keys them by the coarse role.
    const lead = { ...three, nodeRole: null, fallbackRole: 'lead' as const };
    expect(v31CoverageKey(lead, R9)).toBe('mw|3|last|hero|turn|sh|srp|80|ru|lead|*');
    expect(v31CoverageKey(lead, { ...R9, multiway: 'none' })).toBeNull();
  });

  it('a heads-up donk is keyed only by a scheme that adds the donk role', () => {
    const donk = rec({
      status: 'unkeyable',
      why: ['no_node_context'],
      nodeRole: null,
      fallbackRole: 'donk',
    });
    expect(v31CoverageKey(donk, V31_EXACT_SCHEME)).toBeNull();
    expect(v31CoverageKey(donk, { ...R9, nodeRole: 'merged' })).toBeNull();
    expect(v31CoverageKey(donk, { ...R9, nodeRole: 'mergedPlusDonk' })).toBe(
      'hu|ip:hero|turn|sh|srp|80|ru|donk|*'
    );
  });

  it('selects cells before the split and measures coverage after it', () => {
    const early = [
      rec({ decisionId: 'a' }),
      rec({ decisionId: 'b' }),
      rec({ decisionId: 'c', texture: 'Mtpc' }),
    ];
    const late = [
      rec({ decisionId: 'd', createdAt: '2026-11-01T00:00:00Z' }),
      rec({ decisionId: 'e', createdAt: '2026-11-01T00:00:00Z', texture: 'Ltuc' }),
      rec({ decisionId: 'f', createdAt: '2026-11-01T00:00:00Z', facesHuman: false }),
      rec({ decisionId: 'g', createdAt: '2026-11-01T00:00:00Z', street: 'flop' }),
    ];
    const r = v31CoverageReport([...early, ...late], V31_EXACT_SCHEME, {
      streets: ['turn', 'river'],
      budgets: [1, 2],
      splitAt: '2026-10-15T00:00:00Z',
    });
    expect(r.decisions).toBe(5);
    expect(r.selectionDecisions).toBe(3);
    expect(r.heldOutDecisions).toBe(2);
    expect(r.distinctKeys).toBe(3);
    expect(r.keysWith2Plus).toBe(1);
    // One cell (the Brud key) serves d but not the unseen Ltuc spot.
    expect(r.curve[0]).toEqual({
      cells: 1,
      machineHours: 0.1,
      heldOutCoveragePct: 50,
      inSampleCoveragePct: 60,
    });
    expect(r.curve[1].heldOutCoveragePct).toBe(50);
    expect(r.ceilingPct).toBe(100);
  });

  it('every candidate scheme has a unique name and keys the canonical record', () => {
    const names = V31_R9_CANDIDATE_SCHEMES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of V31_R9_CANDIDATE_SCHEMES) expect(v31CoverageKey(rec(), s)).not.toBeNull();
  });
});
