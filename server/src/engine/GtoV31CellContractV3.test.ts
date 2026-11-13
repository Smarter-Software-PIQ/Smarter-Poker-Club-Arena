import { beforeEach, describe, expect, it } from 'vitest';
import type { ActionRecord } from '../types.js';
import {
  GTO_V31_LINE_CLASS_V3,
  GTO_V31_MAX_DEPTH_BB_V3,
  classifyGtoDecisionContext,
  classifyGtoDecisionContextV3,
  gtoV31DepthCandidatesV3,
  gtoV31LineClassV3,
  gtoV31LineClassValidV3,
  gtoV31SnapDepthBucketV3,
} from './GtoDecisionContext.js';
import { depthCandidates, snapDepthBucket } from './GtoPostflop.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  _clearGtoPostflopV31,
  gtoStreetAdviceV31,
  gtoStreetAdviceV31V3,
  gtoV31CellMatrix,
  gtoV31RangeProvenanceRefusal,
  gtoV31RowCellContract,
  replaceGtoPostflopV31,
  replaceGtoPostflopV31Async,
  type GtoPostflopV31Row,
} from './GtoPostflopV31.js';
import { CELL, rangeProvenanceFor } from '../services/V31LoaderFixture.js';
// The World Hub pipeline's own answers for every decision node of the
// turn/river pilot tree (65 tree lines, runout 5c Jd, 600-chip pot, 20,000
// chips): pio_upi.analyze_node(cell_contract='v3') and pio_upi.line_class_v3.
import PILOT from './GtoV31CellContractV3.pilot.json' with { type: 'json' };

const BB = 2;
const BTN = 1;
const STACK = 20_000;
const ROOT_POT = 600;
const PREFLOP: ActionRecord[] = [
  { seat: BTN, stage: 'preflop', action: 'raise', amount: 250 } as ActionRecord,
  { seat: BB, stage: 'preflop', action: 'call', amount: 150 } as ActionRecord,
];

/** Replays a Pio node (OOP = BB, IP = BTN) as the live action history the engine records. */
function replay(node: string, allInAsAction = false) {
  const history: ActionRecord[] = [...PREFLOP];
  const streets = ['flop', 'turn', 'river'] as const;
  let street = 0;
  let actor = 0;
  let wager = false;
  let target = 0;
  const own = [0, 0];
  const total = [0, 0];
  let pot = ROOT_POT;
  for (const token of node.split(':').slice(2)) {
    if (/^[2-9TJQKA][cdhs]$/.test(token)) {
      street += 1;
      actor = 0;
      wager = false;
      target = 0;
      own[0] = own[1] = 0;
      continue;
    }
    const seat = actor === 0 ? BB : BTN;
    const stage = streets[street];
    if (token === 'c') {
      if (wager) {
        const delta = target - own[actor];
        history.push({ seat, stage, action: 'call', amount: delta } as ActionRecord);
        own[actor] += delta;
        total[actor] += delta;
        pot += delta;
        wager = false;
      } else history.push({ seat, stage, action: 'check', amount: 0 } as ActionRecord);
    } else {
      const chips = Number(token.slice(1));
      const streetTarget = chips - (total[actor] - own[actor]);
      const allIn = chips === STACK;
      history.push({
        seat,
        stage,
        action: allIn && allInAsAction ? 'all_in' : wager ? 'raise' : 'bet',
        amount: streetTarget,
        ...(allIn && allInAsAction ? { isFullRaise: true } : {}),
      } as ActionRecord);
      const delta = streetTarget - own[actor];
      own[actor] = streetTarget;
      total[actor] += delta;
      pot += delta;
      target = streetTarget;
      wager = true;
    }
    actor = 1 - actor;
  }
  const hero = actor === 0 ? BB : BTN;
  const heroIndex = actor;
  return {
    street: streets[street],
    history,
    pot,
    hero: { seat: hero, bet: own[heroIndex], stack: STACK - total[heroIndex] },
    opponent: {
      seat: hero === BB ? BTN : BB,
      bet: own[1 - heroIndex],
      stack: STACK - total[1 - heroIndex],
      is_all_in: false,
    },
    currentBet: target,
  };
}

function contextV3(node: string, allInAsAction = false) {
  const s = replay(node, allInAsAction);
  return classifyGtoDecisionContextV3({
    street: s.street,
    hero: s.hero,
    opponents: [s.opponent],
    actionHistory: s.history,
    currentBet: s.currentBet,
    pot: s.pot,
    effectiveRootChips: STACK,
  });
}

function contextV2(node: string) {
  const s = replay(node);
  return classifyGtoDecisionContext({
    street: s.street,
    hero: s.hero,
    opponents: [s.opponent],
    actionHistory: s.history,
    currentBet: s.currentBet,
    pot: s.pot,
  });
}

describe('V31 cell contract v3: depth buckets', () => {
  it('adds 200 above 173 bb and leaves every v2 answer unchanged', () => {
    for (const [stack, bucket] of [
      [5, 10],
      [12, 10],
      [13, 20],
      [30, 20],
      [31, 40],
      [60, 40],
      [61, 80],
      [110, 80],
      [111, 150],
      [150, 150],
      [173, 150],
      [173.5, 200],
      [199, 200],
      [250, 200],
      [400, 200],
    ] as const) {
      expect(gtoV31SnapDepthBucketV3(stack)).toBe(bucket);
    }
    expect(gtoV31SnapDepthBucketV3(0)).toBe(40);
    expect(gtoV31SnapDepthBucketV3(Number.NaN)).toBe(40);
    // v2 is untouched: everything above 110 bb is still 150.
    for (const stack of [111, 173.5, 199, 250, 400]) expect(snapDepthBucket(stack)).toBe(150);
    expect(depthCandidates(199)).toEqual([150, 80]);
    expect(gtoV31DepthCandidatesV3(199)).toEqual([200, 150]);
    expect(gtoV31DepthCandidatesV3(160)).toEqual([150, 200]);
    expect(gtoV31DepthCandidatesV3(90)).toEqual([80, 150]);
    expect(GTO_V31_MAX_DEPTH_BB_V3).toBe(400);
  });
});

describe('V31 cell contract v3: the line class', () => {
  it('names the pilot lines exactly as the World Hub pipeline does', () => {
    expect(PILOT.tree_lines_sha256).toBe(
      '7e7435718385fb94aa58bbaddb7fecdb3299d7f8160e88ec27343d1455fb7d78'
    );
    expect(PILOT.nodes.length).toBe(97);
    for (const entry of PILOT.nodes) {
      for (const allInAsAction of [false, true]) {
        const v3 = contextV3(entry.node, allInAsAction);
        expect(v3, entry.node).not.toBeNull();
        expect(v3?.lineClass, entry.node).toBe(entry.line_class);
        expect(v3?.nodeRole, entry.node).toBe(entry.node_role);
        expect(v3?.facingKind, entry.node).toBe(entry.facing_kind);
        expect(v3?.facingSizeBucket, entry.node).toBe(entry.facing_size_bucket);
      }
    }
  });

  it('gives every pilot decision node its own key where v2 collides', () => {
    const v3Keys = new Set(
      PILOT.nodes.map((e) => `${e.node_role}|${e.facing_size_bucket}|${e.line_class}`)
    );
    expect(v3Keys.size).toBe(PILOT.nodes.length);
    const v2 = new Map<string, number>();
    for (const e of PILOT.nodes) {
      const c = contextV2(e.node);
      if (e.node_role === 'donk') {
        expect(c).toBeNull(); // v2 declines a lead into the previous aggressor, as before
        continue;
      }
      expect(c).toEqual({
        nodeRole: e.node_role,
        facingKind: e.facing_kind,
        facingSizeBucket: e.facing_size_bucket,
      });
      const street = e.node.split(':').filter((t) => /^[2-9TJQKA][cdhs]$/.test(t)).length;
      const k = `${street}|${c?.nodeRole}|${c?.facingKind}|${c?.facingSizeBucket}`;
      v2.set(k, (v2.get(k) ?? 0) + 1);
    }
    expect([...v2.values()].filter((n) => n > 1).length).toBeGreaterThan(0);
  });

  it('separates a 0.75-pot and a 1.5-pot flop bet on the turn and river', () => {
    expect(contextV3('r:0:c:b450:c:5c:c')?.lineClass).toBe('x.b-mid.c/x');
    expect(contextV3('r:0:c:b900:c:5c:c')?.lineClass).toBe('x.b-big.c/x');
    expect(contextV2('r:0:c:b450:c:5c:c')).toEqual(contextV2('r:0:c:b900:c:5c:c'));
    expect(contextV3('r:0:c:b900')).toMatchObject({
      nodeRole: 'facing_bet',
      facingSizeBucket: 'big',
      lineClass: 'x.b-big',
    });
  });

  it('names the flop root lead into the preflop raiser donk, which v2 declines', () => {
    expect(contextV2('r:0')).toBeNull();
    expect(contextV3('r:0')).toEqual({
      nodeRole: 'donk',
      facingKind: 'none',
      facingSizeBucket: 'none',
      lineClass: '',
    });
    expect(contextV3('r:0:c')).toEqual({
      nodeRole: 'cbet',
      facingKind: 'none',
      facingSizeBucket: 'none',
      lineClass: 'x',
    });
  });

  it('refuses a line it cannot name', () => {
    const s = replay('r:0:c:b450');
    const base = {
      street: s.street,
      heroSeat: BB,
      opponentSeat: BTN,
      actionHistory: s.history,
      pot: s.pot,
      effectiveRootChips: STACK,
    };
    expect(gtoV31LineClassV3(base)).toBe('x.b-mid');
    expect(gtoV31LineClassV3({ ...base, heroSeat: BTN, opponentSeat: BB })).toBe('x.b-mid'); // either seat names the same public line
    expect(
      gtoV31LineClassV3({
        ...base,
        actionHistory: [
          ...s.history,
          { seat: 3, stage: 'flop', action: 'call', amount: 450 } as ActionRecord,
        ],
      })
    ).toBeNull();
    expect(
      gtoV31LineClassV3({
        ...base,
        actionHistory: [
          ...s.history,
          { seat: BB, stage: 'flop', action: 'fold', amount: 0 } as ActionRecord,
        ],
      })
    ).toBeNull();
    expect(gtoV31LineClassV3({ ...base, pot: 450 })).toBeNull();
    expect(gtoV31LineClassV3({ ...base, effectiveRootChips: 0 })).toBeNull();
    expect(gtoV31LineClassV3({ ...base, street: 'preflop' })).toBeNull();
    expect(gtoV31LineClassV3({ ...base, opponentSeat: BB })).toBeNull();
  });

  it('validates the grammar and the street', () => {
    for (const ok of ['', 'x', 'x.b-mid.r-small.a', 'x.x/', 'x.b-big.c/x.b-mid.c/x'])
      expect(GTO_V31_LINE_CLASS_V3.test(ok)).toBe(true);
    for (const bad of ['x.', '.x', 'b-huge', 'x/x/x/x', 'x..x', 'X', 'b-mid c'])
      expect(GTO_V31_LINE_CLASS_V3.test(bad)).toBe(false);
    expect(gtoV31LineClassValidV3('x.x/', 'turn')).toBe(true);
    expect(gtoV31LineClassValidV3('x.x/', 'flop')).toBe(false);
    expect(gtoV31LineClassValidV3('x.x/x/', 'river')).toBe(true);
    expect(gtoV31LineClassValidV3(null, 'flop')).toBe(false);
  });
});

// ── The store: v3 rows, keys, consult and range provenance ─────────────────
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (v: string): Card[] =>
  (v.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUITS[c[1]] }));
const BOARD = cards('Qh9d7c2h'); // texture Brud, the fixture cell's
const V3: GtoPostflopV31Row = {
  ...structuredClone(CELL),
  cell_contract_version: 'v3',
  line_class: 'x.b-mid.c/x',
  depth_bucket: 200,
};
const consult = (over: Record<string, unknown> = {}) => ({
  street: 'turn' as const,
  family: 'cash' as const,
  objective: 'cash_ev' as const,
  utilityContext: 'cash_ev' as const,
  tableSize: 2,
  potType: 'limped' as const,
  heroPosition: 'SB' as const,
  opponentPosition: 'BB' as const,
  stackBB: 199,
  board: BOARD,
  hand: 'AKs',
  holeCards: cards('AsKs'),
  nodeRole: 'barrel' as const,
  facingKind: 'none' as const,
  facingSizeBucket: 'none' as const,
  ...over,
});
const context = (lineClass = 'x.b-mid.c/x') => ({
  nodeRole: 'barrel' as const,
  facingKind: 'none' as const,
  facingSizeBucket: 'none' as const,
  lineClass,
});
/** v3 registration entry: the cell and its runtime mapping name the contract and the line. */
function provenanceV3(row: GtoPostflopV31Row) {
  const [entry] = rangeProvenanceFor([row]) as Array<Record<string, any>>;
  for (const part of [entry.cell, entry.runtime_mapping]) {
    part.cell_contract = 'v3';
    part.line_class = row.line_class;
  }
  return [entry];
}

describe('V31 cell contract v3: the store (dormant)', () => {
  beforeEach(() => _clearGtoPostflopV31());

  it('declares v2 for every existing row shape and v3 only for an exact v3 row', () => {
    expect(gtoV31RowCellContract(CELL)).toBe('v2');
    expect(gtoV31RowCellContract({ ...CELL, cell_contract_version: null, line_class: null })).toBe(
      'v2'
    );
    expect(gtoV31RowCellContract(V3)).toBe('v3');
    expect(gtoV31RowCellContract({ ...CELL, line_class: 'x' })).toBeNull();
    expect(gtoV31RowCellContract({ ...V3, cell_contract_version: 'v4' as never })).toBeNull();
    expect(gtoV31RowCellContract({ ...V3, line_class: 'x.b-mid' })).toBeNull(); // a flop line on a turn cell
    expect(gtoV31RowCellContract({ ...V3, line_class: undefined })).toBeNull();
  });

  it('serves a v2 store exactly as before, with or without a v3 context', () => {
    expect(replaceGtoPostflopV31([CELL])).toBe(1);
    const v2 = gtoStreetAdviceV31(consult({ stackBB: 80 }));
    expect(v2).toMatchObject({ hit: true, depthBucket: 80, nodeRole: 'barrel' });
    expect(gtoStreetAdviceV31V3({ ...consult({ stackBB: 80 }), v3: context() })).toEqual(v2);
    expect(gtoStreetAdviceV31V3({ ...consult({ stackBB: 80 }), v3: null })).toEqual(v2);
    expect(
      gtoV31CellMatrix({ ...consult({ stackBB: 80 }), texture: 'Brud', nodeRole: 'barrel' })
    ).not.toBeNull();
    // 199 bb is still served by the v2 150 / 80 buckets, never 200
    expect(gtoStreetAdviceV31(consult({ stackBB: 199 }))).toMatchObject({
      hit: true,
      depthBucket: 80,
    });
  });

  it('keys a v3 store by the line and the 200 bb bucket, and only through the v3 consult', () => {
    expect(replaceGtoPostflopV31([V3])).toBe(1);
    expect(gtoStreetAdviceV31(consult())).toEqual({ hit: false, miss: 'no_line_class' });
    expect(gtoStreetAdviceV31V3({ ...consult(), v3: null })).toEqual({
      hit: false,
      miss: 'no_line_class',
    });
    expect(gtoStreetAdviceV31V3({ ...consult(), v3: context('x.b-mid') })).toEqual({
      hit: false,
      miss: 'no_line_class',
    });
    const hit = gtoStreetAdviceV31V3({ ...consult(), v3: context() });
    expect(hit).toMatchObject({ hit: true, depthBucket: 200, nodeRole: 'barrel' });
    expect(hit.hit && hit.cell.endsWith('|v3|x.b-mid.c/x')).toBe(true);
    // the 1.5-pot flop line is another cell: no substitution
    expect(gtoStreetAdviceV31V3({ ...consult(), v3: context('x.b-big.c/x') })).toEqual({
      hit: false,
      miss: 'no_cell',
    });
    // 160 bb: primary 150 (absent), fallback 200 (served)
    expect(gtoStreetAdviceV31V3({ ...consult({ stackBB: 160 }), v3: context() })).toMatchObject({
      hit: true,
      depthBucket: 200,
    });
    expect(gtoV31CellMatrix({ ...consult(), texture: 'Brud', nodeRole: 'barrel' })).toBeNull();
  });

  it('admits the donk role only in a v3 dataset', () => {
    const donk = { ...V3, node_role: 'donk' as const, line_class: 'x.b-mid.c/' };
    expect(replaceGtoPostflopV31([donk])).toBe(1);
    expect(
      gtoStreetAdviceV31V3({ ...consult(), v3: { ...context('x.b-mid.c/'), nodeRole: 'donk' } })
    ).toMatchObject({ hit: true, nodeRole: 'donk' });
    expect(() => replaceGtoPostflopV31([{ ...CELL, node_role: 'donk' as const }])).toThrow(
      'v31_uncertified_or_malformed_cell'
    );
  });

  it('refuses every malformed or mixed v3 dataset and every v2 row it refused before', () => {
    for (const bad of [
      { ...CELL, line_class: 'x.b-mid.c/x' }, // a v2 row with a line
      { ...CELL, depth_bucket: 200 }, // 200 bb without v3
      { ...V3, depth_bucket: 300 },
      { ...V3, line_class: 'x.b-huge.c/x' },
      { ...V3, line_class: '' }, // a flop line on a turn cell
      { ...V3, cell_contract_version: 'v4' },
      { ...CELL, depth_bucket: 30 }, // refused before, still refused
      { ...V3, node_role: 'donk', facing_kind: 'bet', facing_size_bucket: 'mid' },
    ]) {
      expect(() => replaceGtoPostflopV31([bad as GtoPostflopV31Row])).toThrow(
        'v31_uncertified_or_malformed_cell'
      );
    }
    expect(() =>
      replaceGtoPostflopV31([
        { ...V3, dataset_cells: 2 },
        { ...CELL, dataset_cells: 2, texture_class: 'Brpd' },
      ])
    ).toThrow('v31_dataset_seal_mismatch');
    // two v3 cells on different lines are two cells; the same line twice is a duplicate
    expect(
      replaceGtoPostflopV31([
        { ...V3, dataset_cells: 2 },
        { ...V3, dataset_cells: 2, line_class: 'x.b-big.c/x' },
      ])
    ).toBe(2);
    expect(() =>
      replaceGtoPostflopV31([
        { ...V3, dataset_cells: 2 },
        { ...V3, dataset_cells: 2 },
      ])
    ).toThrow(/v31_duplicate_cell/);
  });

  it('admits a v3 cell only with a v3 provenance entry naming its line', async () => {
    const key = 'turn|cash|cash_ev|cash_ev|2|limped|SB|BB|200|Brud|barrel|none|none|v3|x.b-mid.c/x';
    const good = provenanceV3(V3);
    expect(good[0].game).toMatchObject({ depth_bucket: 200, effective_stack_chips: 20_000 });
    expect(gtoV31RangeProvenanceRefusal(good, key, V3.manifest_checksum)).toBeNull();
    const v2Entry = rangeProvenanceFor([V3]); // no contract, no line: a v2 entry
    expect(gtoV31RangeProvenanceRefusal(v2Entry, key, V3.manifest_checksum)).toBe('missing_cell');
    const otherLine = provenanceV3({ ...V3, line_class: 'x.b-big.c/x' });
    expect(gtoV31RangeProvenanceRefusal(otherLine, key, V3.manifest_checksum)).toBe('missing_cell');
    const badMapping = provenanceV3(V3);
    delete badMapping[0].runtime_mapping.line_class;
    expect(gtoV31RangeProvenanceRefusal(badMapping, key, V3.manifest_checksum)).toBe('mapping');
    const forced = provenanceV3(V3);
    forced[0].range_construction = 'forced';
    expect(gtoV31RangeProvenanceRefusal(forced, key, V3.manifest_checksum)).toBe('forced');
    const wrongStack = provenanceV3(V3);
    wrongStack[0].game.effective_stack_chips = 15_000;
    expect(gtoV31RangeProvenanceRefusal(wrongStack, key, V3.manifest_checksum)).toBe('game');
    // a v3 entry never admits the v2 cell of the same 13 fields
    const v2Key = 'turn|cash|cash_ev|cash_ev|2|limped|SB|BB|80|Brud|barrel|none|none';
    expect(
      gtoV31RangeProvenanceRefusal(
        provenanceV3({ ...V3, depth_bucket: 80 }),
        v2Key,
        CELL.manifest_checksum
      )
    ).toBe('missing_cell');
    expect(await replaceGtoPostflopV31Async([V3], () => true, good)).toBe(1);
    expect(await replaceGtoPostflopV31Async([V3], () => true, v2Entry)).toBe(0);
    expect(await replaceGtoPostflopV31Async([CELL], () => true, rangeProvenanceFor([CELL]))).toBe(
      1
    );
  });
});
