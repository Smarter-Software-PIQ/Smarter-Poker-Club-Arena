/**
 * omahaMultiwayCheckedToBetIsPriced (lane MULTIWAY-BET 2026-11-19, default OFF, read `=== true`;
 * HorseOmahaMultiwayDiscipline.ts section 4). Synthetic cards only (no recorded hand, no opponent cards).
 *
 *  - off: unset, false and a truthy non-boolean decide byte-identically, draw the same randoms, fire nothing;
 *  - scope: multiway, nothing to call, not re-raised before the flop, PLO4/PLO5 cash; heads-up, a re-raised pot,
 *    PLO6, a bet to face and a tournament are out;
 *  - the verdict is priced, not classed: the same two pair bets where it is ahead of the ranges and checks where it
 *    is not, air checks, the cost of the check counts only the players still to act;
 *  - through decide: a strong multiway check that today's brain checks becomes a priced bet (fails before the
 *    option, passes with it), legal and admitted by the receipt validator, and the receipt names the final action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import {
  OMAHA_MW_CHECKED_TO_RESPONSE,
  omahaMultiwayCheckedToBetSpot,
  omahaMultiwayCheckedToBetVerdict,
  omahaMwContinueShare,
} from './HorseOmahaMultiwayDiscipline.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (t: string): Card[] =>
  (t.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99];

interface Spec {
  variant: 'plo4' | 'plo5';
  hero: number;
  hole: string;
  board: string;
  dealer: number;
  /** seat, behind, street bet, hand total, folded */
  seats: [number, number, number, number, boolean?][];
  history: [number, string, string, number][];
  pot: number;
  toCall: number;
  currentBet: number;
  legal: string[];
  minRaiseTo?: number | null;
  maxRaiseTo?: number | null;
}
/** A synthetic decision node in the complaint-fixture form (seat n is user `p<n>`). */
function mk(s: Spec) {
  const n = s.board.length / 2;
  const street = n === 5 ? 'river' : n === 4 ? 'turn' : 'flop';
  const actions = s.history.map(([seat, stage, action, amount], i) => ({
    ord: i + 1,
    seat,
    stage,
    action,
    amount,
    origin: seat === s.hero ? 'horse_policy' : 'player',
  }));
  const node = {
    ord: actions.length + 1,
    seat: s.hero,
    stage: street,
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: s.pot,
      mode: 'cash',
      seats: s.seats.map(([seat, b, bet, tot, f]) => [seat, b, bet, tot, 0, 0, f ? 1 : 0]),
      boards: [s.board],
      street,
      toCall: s.toCall,
      currentBet: s.currentBet,
      minRaiseTo: s.minRaiseTo ?? null,
      maxRaiseTo: s.maxRaiseTo ?? null,
      legalActions: s.legal,
      dealerSeat: s.dealer,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: s.variant,
      structure: 'pot_limit',
      actorSeat: s.hero,
      bombPot: false,
      tournamentStage: { status: 'not_applicable', version: 1 },
    },
  };
  const fx = {
    version: 1,
    slug: 'synthetic',
    title: 'synthetic',
    complaint: '',
    handId: 'synthetic',
    fmt: 'cash',
    variant: s.variant,
    players: s.seats.map(([seat]) => ({ seat, isHorse: seat === s.hero })),
    hole: { [String(s.hero)]: cards(s.hole) },
    actions: [...actions, node],
    forbidden: [],
    seeds: [],
  } as unknown as ComplaintFixture;
  return stateAt(fx, node as never);
}
type Node = ReturnType<typeof mk>;

const PRE3: [number, string, string, number][] = [
  [1, 'preflop', 'sb', 1],
  [2, 'preflop', 'bb', 2],
  [3, 'preflop', 'raise', 7],
  [1, 'preflop', 'call', 6],
  [2, 'preflop', 'call', 5],
];
/** PLO4 three-way turn Kh9c4d2s checked to the Horse in seat 3 (first: the Horse acts first, seats 1 and 2 behind). */
function turn3(
  hole: string,
  opts: { first?: boolean; reraised?: boolean; variant?: string } = {}
): Node {
  const pre: [number, string, string, number][] = opts.reraised
    ? [
        [1, 'preflop', 'sb', 1],
        [2, 'preflop', 'bb', 2],
        [3, 'preflop', 'raise', 7],
        [1, 'preflop', 'raise', 21],
        [2, 'preflop', 'call', 19],
        [3, 'preflop', 'call', 14],
      ]
    : PRE3;
  const pot = opts.reraised ? 63 + 30 : 21 + 30;
  return mk({
    variant: (opts.variant ?? 'plo4') as 'plo4',
    hero: 3,
    hole,
    board: 'Kh9c4d2s',
    dealer: opts.first ? 2 : 3,
    seats: [
      [1, 400, 0, pot / 3],
      [2, 400, 0, pot / 3],
      [3, 400, 0, pot / 3],
    ],
    history: [
      ...pre,
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
      [3, 'flop', 'bet', 10],
      [1, 'flop', 'call', 10],
      [2, 'flop', 'call', 10],
      ...((opts.first
        ? []
        : [
            [1, 'turn', 'check', 0],
            [2, 'turn', 'check', 0],
          ]) as [number, string, string, number][]),
    ],
    pot,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: pot,
  });
}
/** PLO4 heads-up turn (seat 2 folded the flop). */
function turnHeadsUp(hole: string): Node {
  return mk({
    variant: 'plo4',
    hero: 3,
    hole,
    board: 'Kh9c4d2s',
    dealer: 3,
    seats: [
      [1, 400, 0, 17],
      [2, 400, 0, 7, true],
      [3, 400, 0, 17],
    ],
    history: [
      ...PRE3,
      [1, 'flop', 'bet', 10],
      [2, 'flop', 'fold', 0],
      [3, 'flop', 'call', 10],
      [1, 'turn', 'check', 0],
    ],
    pot: 41,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: 41,
  });
}
/** PLO5 four-way flop Th7c2d, nothing bet, the Horse in seat 4 first to act after the blinds checked (seat 3 behind). */
function flop4(hole: string): Node {
  return mk({
    variant: 'plo5',
    hero: 4,
    hole,
    board: 'Th7c2d',
    dealer: 3,
    seats: [
      [1, 400, 0, 7],
      [2, 400, 0, 7],
      [3, 400, 0, 7],
      [4, 400, 0, 7],
    ],
    history: [
      [1, 'preflop', 'sb', 1],
      [2, 'preflop', 'bb', 2],
      [4, 'preflop', 'raise', 7],
      [3, 'preflop', 'call', 7],
      [1, 'preflop', 'call', 6],
      [2, 'preflop', 'call', 5],
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
    ],
    pot: 28,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: 28,
  });
}
/** PLO4 three-way river Kh9c4d2s5h checked to the Horse. */
function river3(hole: string): Node {
  return mk({
    variant: 'plo4',
    hero: 3,
    hole,
    board: 'Kh9c4d2s5h',
    dealer: 3,
    seats: [
      [1, 400, 0, 17],
      [2, 400, 0, 17],
      [3, 400, 0, 17],
    ],
    history: [
      ...PRE3,
      [1, 'flop', 'check', 0],
      [2, 'flop', 'check', 0],
      [3, 'flop', 'bet', 10],
      [1, 'flop', 'call', 10],
      [2, 'flop', 'call', 10],
      [1, 'turn', 'check', 0],
      [2, 'turn', 'check', 0],
      [3, 'turn', 'check', 0],
      [1, 'river', 'check', 0],
      [2, 'river', 'check', 0],
    ],
    pot: 51,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: 51,
  });
}

const TOP_SET = 'KsKd7c6c';
const AIR = 'JsTs8h7d';
const SPOTS: (() => Node)[] = [
  () => turn3(TOP_SET),
  () => turn3(AIR),
  () => turn3(TOP_SET, { first: true }),
  () => turnHeadsUp(TOP_SET),
  () => flop4('ThTd7s6s5c'),
  () => flop4('AsQs8h5d3c'),
  () => river3(TOP_SET),
];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});
const bytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) =>
    typeof v === 'number' &&
    [
      'latencyMs',
      'analysisMs',
      'simulationMs',
      'policyMs',
      'utilityLatencyMs',
      'elapsedMs',
    ].includes(k)
      ? undefined
      : v
  );
function decide(build: () => Node, opts: HorseDecideOpts, seed: number) {
  HorseMind.reset();
  vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => null) as never);
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(seed);
  const st = build();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    ...opts,
  } as never);
  const out = {
    d,
    st,
    bytes: bytes(d),
    next: fastRandom(),
    fires: drainFires().map((f) => f.feature),
    refused: horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant), {
      player: st.hero,
      gameState: st.gs,
    }),
  };
  vi.restoreAllMocks();
  return out;
}

describe('omahaMultiwayCheckedToBetIsPriced off', () => {
  it('unset, false and a truthy non-boolean decide byte-identically, draw the same randoms and fire nothing', () => {
    for (const build of SPOTS)
      for (const seed of SEEDS) {
        const unset = decide(build, {}, seed);
        for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
          const off = decide(build, { omahaMultiwayCheckedToBetIsPriced: v }, seed);
          expect(off.bytes).toEqual(unset.bytes);
          expect(off.next).toEqual(unset.next);
          expect(off.fires.filter((f) => f.startsWith('omaha_multiway_checked_to_bet'))).toEqual(
            []
          );
        }
      }
  });
});

describe('omahaMultiwayCheckedToBetSpot', () => {
  it('multiway with nothing to call, not re-raised, PLO4/PLO5 cash', () => {
    const s = omahaMultiwayCheckedToBetSpot(turn3(TOP_SET).hero, turn3(TOP_SET).gs);
    expect(s?.street).toBe('turn');
    expect(s?.opponents.map((o) => o.behind)).toEqual([false, false]);
    const first = turn3(TOP_SET, { first: true });
    expect(
      omahaMultiwayCheckedToBetSpot(first.hero, first.gs)?.opponents.every((o) => o.behind)
    ).toBe(true);
    const f = flop4('ThTd7s6s5c');
    const fs = omahaMultiwayCheckedToBetSpot(f.hero, f.gs);
    expect(fs?.street).toBe('flop');
    expect(fs?.opponents.filter((o) => o.behind).map((o) => o.seat)).toEqual([3]);
  });
  it('the river is out of scope (its measured response did not hold out of sample)', () => {
    const r = river3(TOP_SET);
    expect(omahaMultiwayCheckedToBetSpot(r.hero, r.gs)).toBeNull();
  });
  it('heads-up, a re-raised pot, PLO6, a bet to face and a tournament are out', () => {
    const hu = turnHeadsUp(TOP_SET);
    expect(omahaMultiwayCheckedToBetSpot(hu.hero, hu.gs)).toBeNull();
    const rr = turn3(TOP_SET, { reraised: true });
    expect(omahaMultiwayCheckedToBetSpot(rr.hero, rr.gs)).toBeNull();
    const p6 = turn3(TOP_SET);
    expect(
      omahaMultiwayCheckedToBetSpot(p6.hero, { ...p6.gs, gameVariant: 'plo6' } as never)
    ).toBeNull();
    const t = turn3(TOP_SET);
    expect(
      omahaMultiwayCheckedToBetSpot(t.hero, { ...t.gs, toCall: 10, currentBet: 10 } as never)
    ).toBeNull();
    expect(
      omahaMultiwayCheckedToBetSpot(t.hero, { ...t.gs, gameMode: 'tournament' } as never)
    ).toBeNull();
  });
});

describe('omahaMultiwayCheckedToBetVerdict is priced, not classed', () => {
  const verdict = (n: Node) => {
    const spot = omahaMultiwayCheckedToBetSpot(n.hero, n.gs)!;
    return omahaMultiwayCheckedToBetVerdict(n.hero, n.gs, spot)!;
  };
  it('top set bets, air checks', () => {
    expect(verdict(turn3(TOP_SET)).amount).not.toBeNull();
    expect(verdict(turn3(AIR)).amount).toBeNull();
  });
  it('the same made class bets ahead of the ranges and checks behind them (two pair on the turn)', () => {
    // Kings and nines (top two) against fours and deuces (bottom two) on Kh9c4d2s: two pair both.
    expect(verdict(turn3('Kd9d7s6c')).amount).not.toBeNull();
    expect(verdict(turn3('4c2c8s7s')).amount).toBeNull();
  });
  it('the cost of the check counts only the players still to act', () => {
    expect(verdict(turn3(TOP_SET)).noBetBehind).toBe(1);
    const first = verdict(turn3(TOP_SET, { first: true }));
    expect(first.noBetBehind).toBeGreaterThan(0);
    expect(first.noBetBehind).toBeLessThan(1);
    expect(Object.keys(OMAHA_MW_CHECKED_TO_RESPONSE).sort()).toEqual([
      'flop|horse',
      'flop|person',
      'river|horse',
      'river|person',
      'turn|horse',
      'turn|person',
    ]);
  });
  it('a larger bet is continued less and a stronger hand continues more (measured curves, continuous)', () => {
    for (const street of ['flop', 'turn', 'river'])
      for (const horse of [false, true]) {
        expect(omahaMwContinueShare(street, horse, 1, 0.3)).toBeLessThan(
          omahaMwContinueShare(street, horse, 0.33, 0.3)
        );
        expect(omahaMwContinueShare(street, horse, 0.5, 0.05)).toBeGreaterThan(
          omahaMwContinueShare(street, horse, 0.5, 0.6)
        );
        expect(
          Math.abs(
            omahaMwContinueShare(street, horse, 0.5, 0.3) -
              omahaMwContinueShare(street, horse, 0.5001, 0.3001)
          )
        ).toBeLessThan(1e-3);
      }
  });
});

describe('omahaMultiwayCheckedToBetIsPriced on, through decide', () => {
  // Review B7: the option prices only the chain's final check: a decision it changes was a check and becomes a bet,
  // and a bet is never re-sized or removed. (With every Omaha option on, two identical decide calls already differ
  // in a flop bet size on main, so that arm cannot be compared call to call; the replay arm covers it.)
  it('changes only a final check into a bet', () => {
    for (const base of [{}])
      for (const build of SPOTS)
        for (const seed of SEEDS) {
          const off = decide(build, base, seed);
          const on = decide(build, { ...base, omahaMultiwayCheckedToBetIsPriced: true }, seed);
          if (on.d.action === off.d.action && (on.d.amount ?? null) === (off.d.amount ?? null))
            continue;
          expect(off.d.action).toBe('check');
          expect(on.d.action).toBe('bet');
          expect(on.refused).toBeNull();
        }
  });
  it('a strong multiway check becomes a priced bet; legal, admitted, and the receipt names the final bet', () => {
    // PLO5 four-way flop, top two pair checked to the Horse with one player behind: today's brain checks.
    // 2026-11-19: the hand is Ts7h9d4c3s. With the Omaha band fallback measuring in the band's unit
    // (AUDIT-FILES-B) the brain's own mixed flop bet takes Ts7h8h5d3c on seed 1 without the option; this
    // top two pair is checked on every seed, so the bet below is the option's.
    const build = () => flop4('Ts7h9d4c3s');
    const off = decide(build, {}, 1);
    expect(off.d.action).toBe('check');
    const on = decide(build, { omahaMultiwayCheckedToBetIsPriced: true }, 1);
    expect(on.d.action).toBe('bet');
    expect(on.d.amount).toBeGreaterThan(0);
    expect(on.d.amount!).toBeLessThanOrEqual(on.st.gs.pot);
    expect(on.refused).toBeNull();
    expect(on.fires).toContain('omaha_multiway_checked_to_bet_priced_bet');
    expect(on.fires).not.toContain('omaha_multiway_checked_to_bet_priced_bet_vetoed');
  });
  it('air keeps the check and fires the kept receipt; heads-up is untouched', () => {
    const on = decide(() => turn3(AIR), { omahaMultiwayCheckedToBetIsPriced: true }, 1);
    const off = decide(() => turn3(AIR), {}, 1);
    expect(on.d.action).toBe(off.d.action);
    const hu = decide(() => turnHeadsUp(TOP_SET), { omahaMultiwayCheckedToBetIsPriced: true }, 1);
    const huOff = decide(() => turnHeadsUp(TOP_SET), {}, 1);
    expect(hu.bytes).toEqual(huOff.bytes);
    expect(hu.fires.filter((f) => f.startsWith('omaha_multiway_checked_to_bet'))).toEqual([]);
  });
});
