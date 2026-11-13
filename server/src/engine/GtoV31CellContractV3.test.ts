import { beforeEach, describe, expect, it } from 'vitest';
import type { ActionRecord } from '../types.js';
import {
  GTO_V31_LINE_CLASS_V3,
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
  gtoV31FeatureContractVersion,
  gtoV31RangeProvenanceRefusal,
  gtoV31RowCellContract,
  replaceGtoPostflopV31,
  replaceGtoPostflopV31Async,
  type GtoPostflopV31Row,
} from './GtoPostflopV31.js';
import { CELL, rangeProvenanceFor } from '../services/V31LoaderFixture.js';
import {
  bind as bindPublic215,
  fixture as public215Fixture,
} from './__tests__/public215Fixture.js';
import {
  PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256,
  PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256,
  PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256,
} from './GtoPublicHist215Contracts.js';
import { public215NpyHeader } from '../scripts/buildPublicHist215Features.js';
import { public215Digest } from './GtoPublicHist215Model.js';
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

type Tree = { rootPot: number; stack: number; preflop: ActionRecord[] };
const PILOT_TREE: Tree = { rootPot: ROOT_POT, stack: STACK, preflop: PREFLOP };

/** Replays a Pio node (OOP = BB, IP = BTN) as the live action history the engine records. */
function replay(node: string, allInAsAction = false, tree: Tree = PILOT_TREE) {
  const history: ActionRecord[] = [...tree.preflop];
  const streets = ['flop', 'turn', 'river'] as const;
  let street = 0;
  let actor = 0;
  let wager = false;
  let target = 0;
  const own = [0, 0];
  const total = [0, 0];
  let pot = tree.rootPot;
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
      const allIn = chips === tree.stack;
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
    hero: { seat: hero, bet: own[heroIndex], stack: tree.stack - total[heroIndex] },
    opponent: {
      seat: hero === BB ? BTN : BB,
      bet: own[1 - heroIndex],
      stack: tree.stack - total[1 - heroIndex],
      is_all_in: false,
    },
    currentBet: target,
  };
}

function contextV3(node: string, allInAsAction = false, tree: Tree = PILOT_TREE) {
  const s = replay(node, allInAsAction, tree);
  return classifyGtoDecisionContextV3({
    street: s.street,
    hero: s.hero,
    opponents: [s.opponent],
    actionHistory: s.history,
    currentBet: s.currentBet,
    pot: s.pot,
    effectiveRootChips: tree.stack,
  });
}

function contextV2(node: string, tree: Tree = PILOT_TREE) {
  const s = replay(node, false, tree);
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
      // the v2 key's varying fields on one tree: street, hero seat, role, facing, size bucket
      const k = `${street}|${replay(e.node).hero.seat}|${c?.nodeRole}|${c?.facingKind}|${c?.facingSizeBucket}`;
      v2.set(k, (v2.get(k) ?? 0) + 1);
    }
    // The World Hub test on the same tree finds the same: 86 v2-keyable nodes on 25 keys, 13 of
    // which hold more than one line (74 nodes); the other 11 nodes are leads v2 cannot key at all.
    const colliding = [...v2.values()].filter((n) => n > 1);
    expect([v2.size, colliding.length, colliding.reduce((a, b) => a + b, 0)]).toEqual([25, 13, 74]);
    expect([...v2.values()].reduce((a, b) => a + b, 0)).toBe(86);
  });

  // Review B5 m4: beyond the one pilot tree. Four generated two-player trees (other pots, stacks,
  // the preflop aggressor on either seat, other size menus, all-ins), every decision node of each.
  // The line each node should carry is written down independently while the tree is generated;
  // the v3 key (street, role, facing, size bucket, line) must be one-to-one with it: different
  // bucketed public lines never share a key, and only sizes in one bucket share one (the fourth
  // tree offers 0.33 and 0.5 pot, both small: the pipeline refuses such a tree, see World Hub
  // test_two_sizes_in_one_bucket_on_one_line_are_refused_not_merged).
  it('keys every decision node of four generated trees by exactly its bucketed public line', () => {
    const THREE_BET: ActionRecord[] = [
      { seat: BTN, stage: 'preflop', action: 'raise', amount: 250 } as ActionRecord,
      { seat: BB, stage: 'preflop', action: 'raise', amount: 800 } as ActionRecord,
      { seat: BTN, stage: 'preflop', action: 'call', amount: 550 } as ActionRecord,
    ];
    const trees = [
      { rootPot: 600, stack: 20_000, preflop: PREFLOP, bets: [0.33, 0.75, 1.5], raises: [0.4] },
      { rootPot: 1_700, stack: 15_000, preflop: THREE_BET, bets: [0.5, 1], raises: [1.5] },
      { rootPot: 600, stack: 4_000, preflop: PREFLOP, bets: [0.25, 2], raises: [0.8] },
      { rootPot: 1_000, stack: 20_000, preflop: PREFLOP, bets: [0.33, 0.5], raises: [0.75] },
    ];
    const bucket = (f: number) => (f < 0.6 ? 'small' : f < 1.1 ? 'mid' : 'big');
    const totals: number[] = [];
    for (const [index, t] of trees.entries()) {
      const nodes: Array<{ node: string; line: string }> = [];
      const walk = (
        path: string[],
        street: number,
        actor: number,
        spent: number[],
        start: number[],
        target: number,
        wager: boolean,
        raised: boolean,
        checked: boolean,
        pot: number,
        lines: string[][]
      ): void => {
        nodes.push({ node: path.join(':'), line: lines.map((l) => l.join('.')).join('/') });
        const next = (
          token: string,
          name: string,
          street2: number,
          ...rest: [number, number[], number[], number, boolean, boolean, boolean, number]
        ) => {
          const l = lines.map((x) => [...x]);
          l[l.length - 1].push(name);
          walk([...path, token], street2, ...rest, l);
        };
        const close = (token: string, name: string, s2: number[], pot2: number, allIn: boolean) => {
          if (street === 2 || allIn) return; // the river closes, or nobody has chips behind
          const l = lines.map((x) => [...x]);
          l[l.length - 1].push(name);
          l.push([]);
          walk(
            [...path, token, ['5c', 'Jd'][street]],
            street + 1,
            0,
            s2,
            [...s2],
            0,
            false,
            false,
            false,
            pot2,
            l
          );
        };
        const street0 = spent[actor] - start[actor];
        if (!wager) {
          // check: closes after a check, else passes the action
          if (checked) close('c', 'x', spent, pot, false);
          else next('c', 'x', street, 1 - actor, spent, start, 0, false, false, true, pot);
          const sizes = t.bets.map((f) => [Math.round(f * pot), 'b-' + bucket(f)] as const);
          for (const [amt, name] of [...sizes, [t.stack - spent[actor] + street0, 'a'] as const]) {
            const cum = start[actor] + amt;
            if (cum > t.stack || (name !== 'a' && cum >= t.stack)) continue;
            const s2 = [...spent];
            s2[actor] = cum;
            next(`b${cum}`, name, street, 1 - actor, s2, start, amt, true, false, false, pot + amt);
          }
          return;
        }
        // facing a wager: call closes the street; one raise per street, then call only
        const toCall = target - street0;
        const s2 = [...spent];
        s2[actor] = start[actor] + target;
        close('c', 'c', s2, pot + toCall, s2[actor] >= t.stack);
        if (raised || s2[actor] >= t.stack) return;
        const sizes = t.raises.map(
          (f) => [target + Math.round(f * (pot + toCall)), 'r-' + bucket(f)] as const
        );
        for (const [to, name] of [...sizes, [t.stack - start[actor], 'a'] as const]) {
          const cum = start[actor] + to;
          if (cum > t.stack || (name !== 'a' && cum >= t.stack)) continue;
          const s3 = [...spent];
          s3[actor] = cum;
          next(
            `b${cum}`,
            name,
            street,
            1 - actor,
            s3,
            start,
            to,
            true,
            true,
            false,
            pot + (to - street0)
          );
        }
      };
      walk(['r', '0'], 0, 0, [0, 0], [0, 0], 0, false, false, false, t.rootPot, [[]]);
      const keyOf = new Map<string, string>(); // v3 key -> expected line
      const lineOf = new Map<string, string>(); // expected line (with street) -> v3 key
      let v2Collisions = 0;
      const v2Keys = new Map<string, Set<string>>();
      for (const { node, line } of nodes) {
        const street = line.split('/').length;
        const c = contextV3(node, false, t);
        expect(c, `tree ${index} ${node}`).not.toBeNull();
        expect(c?.lineClass, `tree ${index} ${node}`).toBe(line);
        expect(contextV3(node, true, t)?.lineClass, `tree ${index} ${node} all-in`).toBe(line);
        const hero = replay(node, false, t).hero.seat;
        const k = `${street}|${hero}|${c?.nodeRole}|${c?.facingKind}|${c?.facingSizeBucket}|${c?.lineClass}`;
        expect(keyOf.get(k) ?? line, `tree ${index}: ${k} names two lines`).toBe(line);
        expect(lineOf.get(`${street}|${line}`) ?? k, `tree ${index}: ${line} has two keys`).toBe(k);
        keyOf.set(k, line);
        lineOf.set(`${street}|${line}`, k);
        const old = contextV2(node, t);
        if (old) {
          const k2 = `${street}|${hero}|${old.nodeRole}|${old.facingKind}|${old.facingSizeBucket}`;
          v2Keys.set(k2, (v2Keys.get(k2) ?? new Set()).add(line));
        }
      }
      for (const lines of v2Keys.values()) if (lines.size > 1) v2Collisions += 1;
      expect(v2Collisions, `tree ${index}: v2 keys collide`).toBeGreaterThan(0);
      // one key per distinct bucketed line; all nodes distinct except same-bucket sizes (tree 3)
      expect(keyOf.size).toBe(lineOf.size);
      if (index < 3) expect(keyOf.size, `tree ${index}`).toBe(nodes.length);
      else expect(keyOf.size).toBeLessThan(nodes.length);
      totals.push(nodes.length, keyOf.size, v2Keys.size);
    }
    // [decision nodes, v3 keys, v2 keys] per tree: 5,594 nodes, every one keyed by its own line
    // except tree 3's same-bucket pairs; v2 serves them all with 148 keys.
    expect(totals).toEqual([3410, 3410, 43, 484, 484, 37, 436, 436, 37, 1264, 302, 31]);
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

// ── Review B5 M1: feature contract hist215-v3 and cell contract v3 are tied ──
const SCHEMA: Record<string, string> = {
  'holdem-public-hist215-v1': PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256,
  'holdem-public-hist215-v2': PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256,
  'holdem-public-hist215-v3': PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256,
};
const WIDTH: Record<string, number> = {
  'holdem-public-hist215-v1': 215,
  'holdem-public-hist215-v2': 246,
  'holdem-public-hist215-v3': 248,
};
/** A public215 model row declaring `feature` under cell contract v2 (no declaration) or v3. */
function public215Row(feature: string, cell: 'v2' | 'v3', over: Record<string, unknown> = {}) {
  const row = public215Fixture(cell === 'v3' ? 200 : 80);
  Object.assign(row, {
    feature_contract_version: feature,
    feature_schema_checksum: SCHEMA[feature],
    ...(cell === 'v3' ? { cell_contract_version: 'v3', line_class: 'x.b-mid.c/x' } : {}),
    ...over,
  });
  Object.assign(row.public_template.context, {
    depth_bucket: row.depth_bucket,
    node_role: row.node_role,
    facing_kind: row.facing_kind,
    facing_size_bucket: row.facing_size_bucket,
  });
  row.public_training_provenance.feature_schema_checksum = row.feature_schema_checksum;
  row.public_model.feature_count = WIDTH[feature];
  bindPublic215(row);
  // the build receipt's cases carry one feature vector of the contract's width
  for (const c of row.public_model_build_receipt.cases)
    c.features_f64 = Array(WIDTH[feature]).fill(c.features_f64[0]);
  row.model_build_receipt_checksum = public215Digest(row.public_model_build_receipt);
  return row;
}

describe('V31 cell contract v3: feature contract hist215-v3 requires cell contract v3, and back', () => {
  beforeEach(() => _clearGtoPostflopV31());

  it('knows hist215-v3 only with the v3 declaration and the older public215 contracts only without it', () => {
    const v3 = { cell_contract_version: 'v3' };
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ feature_contract_version: 'holdem-public-hist215-v3' }, null], // v2 row: refused, as on main
      [{ feature_contract_version: 'holdem-public-hist215-v3', cell_contract_version: null }, null],
      [{ feature_contract_version: 'holdem-public-hist215-v3', cell_contract_version: 'v4' }, null],
      [{ feature_contract_version: 'holdem-public-hist215-v3', ...v3 }, 'holdem-public-hist215-v3'],
      [{ feature_contract_version: 'holdem-public-hist215-v1', ...v3 }, null],
      [{ feature_contract_version: 'holdem-public-hist215-v2', ...v3 }, null],
      // v2 answers are the pre-v3 answers
      [{ feature_contract_version: 'holdem-public-hist215-v1' }, 'holdem-public-hist215-v1'],
      [{ feature_contract_version: 'holdem-public-hist215-v2' }, 'holdem-public-hist215-v2'],
      [{ feature_contract_version: 'rank-suit-count-v1' }, 'rank-suit-count-v1'],
      [{ feature_contract_version: 'holdem-board-relative-v2' }, 'holdem-board-relative-v2'],
      [{ feature_contract_version: null }, null],
      [{}, 'rank-suit-count-v1'],
      // a matrix row keeps its hand-key contract under v3 (no public215 encoder is involved)
      [{ feature_contract_version: 'rank-suit-count-v1', ...v3 }, 'rank-suit-count-v1'],
      [{ feature_contract_version: 'holdem-board-relative-v2', ...v3 }, 'holdem-board-relative-v2'],
      [{ ...v3 }, 'rank-suit-count-v1'],
    ];
    for (const [value, expected] of cases)
      expect(gtoV31FeatureContractVersion(value), JSON.stringify(value)).toBe(expected);
  });

  it('admits the matched pairs and refuses both mismatch directions at the store', () => {
    // matched: v2 cell + hist215-v1/v2, v3 cell + hist215-v3
    expect(replaceGtoPostflopV31([public215Row('holdem-public-hist215-v1', 'v2')])).toBe(1);
    expect(replaceGtoPostflopV31([public215Row('holdem-public-hist215-v2', 'v2')])).toBe(1);
    expect(replaceGtoPostflopV31([public215Row('holdem-public-hist215-v3', 'v3')])).toBe(1);
    // direction 1: a dataset on the old (line-less) cell keys claims the v3 feature format.
    // The review's case: an overbet facing cell with a 248-wide model, no cell_contract_version.
    const overbet = {
      node_role: 'facing_bet',
      facing_kind: 'bet',
      facing_size_bucket: 'big',
      action_specs: {
        f: { family: 'fold', size_unit: 'none', size_value: null, all_in: false },
        c: { family: 'call', size_unit: 'none', size_value: null, all_in: false },
      },
    };
    for (const row of [
      public215Row('holdem-public-hist215-v3', 'v2'),
      public215Row('holdem-public-hist215-v3', 'v2', overbet),
      public215Row('holdem-public-hist215-v3', 'v2', {
        cell_contract_version: null,
        line_class: null,
      }),
    ]) {
      expect(gtoV31RowCellContract(row)).toBe('v2');
      expect(gtoV31FeatureContractVersion(row)).toBeNull(); // the loader's v31_feature_contract_unknown
      expect(() => replaceGtoPostflopV31([row])).toThrow('v31_uncertified_or_malformed_cell');
    }
    // direction 2: a dataset on v3 (line-keyed) cells claims an older public215 feature format
    for (const feature of ['holdem-public-hist215-v1', 'holdem-public-hist215-v2']) {
      const row = public215Row(feature, 'v3');
      expect(gtoV31RowCellContract(row)).toBe('v3');
      expect(gtoV31FeatureContractVersion(row)).toBeNull();
      expect(() => replaceGtoPostflopV31([row])).toThrow('v31_uncertified_or_malformed_cell');
    }
    // a refused replacement keeps the last complete store
    expect(replaceGtoPostflopV31([public215Row('holdem-public-hist215-v1', 'v2')])).toBe(1);
    expect(() =>
      replaceGtoPostflopV31([public215Row('holdem-public-hist215-v3', 'v2', overbet)])
    ).toThrow();
    expect(gtoStreetAdviceV31V3({ ...consult({ stackBB: 80 }), v3: null })).toEqual({
      hit: false,
      miss: 'worker_required',
    });
  });

  it('frames NumPy feature batches at every contract width and no other', () => {
    for (const width of [215, 246, 248]) expect(() => public215NpyHeader(1, width)).not.toThrow();
    for (const width of [0, 214, 247, 249, 300])
      expect(() => public215NpyHeader(1, width)).toThrow();
  });
});
