/**
 * OMAHA MULTIWAY AND BLUFF DISCIPLINE (2026-11-16; three options, each default
 * OFF and read `=== true`; HorseOmahaMultiwayDiscipline.ts).
 *
 *  - omahaMultiwayRiverCallNeedsStrength: a multiway river call or raise
 *    without a nut-class hand is the multiway exact-hand verdict (call or
 *    fold, never a raise); heads-up, nut class and a fold are untouched;
 *  - omahaNoRiverBluffIntoValueLeader: a river bet below the showdown-value
 *    line into a measured value leader who showed strength is a check unless
 *    the fold-equity comparison says bet; no read, a non-leader, no strength
 *    shown or a nut-flush blocker keep today's decision;
 *  - omahaMultiwayWeakHandNoBet: a multiway turn or river bet with one pair
 *    or less and no nut-class or combo draw is a check unless the EV
 *    comparison says bet; heads-up and a nut draw keep today's decision.
 *
 * Every class runs many seeds and asserts per seed. Unset, false and a
 * truthy non-boolean decide byte-identically; no option draws a random
 * number; every changed decision is legal and admitted by the receipt
 * validator; receipts describe the final action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import {
  omahaBetVsCheckEv,
  omahaBetVsCheckOpponents,
  omahaMultiwayRiverCallSpot,
  omahaMultiwayRiverCallVerdict,
  omahaMultiwayValueShare,
  omahaMultiwayWeakHandSpot,
  omahaRiverBluffIntoValueLeaderSpot,
  omahaShownRangeShare,
  omahaShownLine,
  OMAHA_DISCIPLINE_PRIOR_FOLD,
} from './HorseOmahaMultiwayDiscipline.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (t: string): Card[] =>
  (t.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 16 }, (_, i) => 7100 + i);

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
/** PLO5 river ThQd4h7h2d: seat 1 bets `bet`, seat 2 calls (or folded), the Horse in seat 3 closes. */
function riverFacing(hole: string, bet: number, opts: { headsUp?: boolean } = {}): Node {
  const hu = opts.headsUp === true;
  const history: [number, string, string, number][] = [
    ...PRE3,
    [1, 'flop', 'check', 0],
    [2, 'flop', 'bet', 20],
    [3, 'flop', 'call', 20],
    [1, 'flop', 'call', 20],
    [1, 'turn', 'check', 0],
    [2, 'turn', 'check', 0],
    [3, 'turn', 'check', 0],
    [1, 'river', 'bet', bet],
  ];
  if (hu) history.push([2, 'river', 'fold', 0]);
  else history.push([2, 'river', 'call', bet]);
  return mk({
    variant: 'plo5',
    hero: 3,
    hole,
    board: 'ThQd4h7h2d',
    dealer: 3,
    seats: [
      [1, 1500, bet, 41 + bet],
      [2, 1500, hu ? 0 : bet, hu ? 41 : 41 + bet, hu],
      [3, 1500, 0, 41],
    ],
    history,
    pot: 123 + (hu ? 1 : 2) * bet,
    toCall: bet,
    currentBet: bet,
    legal: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: 2 * bet,
    maxRaiseTo: 123 + 4 * bet,
  });
}
/** PLO4 heads-up river, the Horse on the button checked to; seat 1 3-bet, bet the flop (called), checked the turn and the river (pricingfix state 65's line). */
function riverCheckedTo(
  hole: string,
  board: string,
  pot = 120,
  opts: { flopBet?: boolean } = {}
): Node {
  const flopBet = opts.flopBet !== false;
  return mk({
    variant: 'plo4',
    hero: 2,
    hole,
    board,
    dealer: 2,
    seats: [
      [1, 300, 0, pot / 2],
      [2, 141, 0, pot / 2],
    ],
    history: [
      [2, 'preflop', 'sb', 1],
      [1, 'preflop', 'bb', 2],
      [2, 'preflop', 'raise', 6],
      [1, 'preflop', 'raise', 18],
      [2, 'preflop', 'call', 12],
      ...((flopBet
        ? [
            [1, 'flop', 'bet', 36],
            [2, 'flop', 'call', 36],
          ]
        : [
            [1, 'flop', 'check', 0],
            [2, 'flop', 'check', 0],
          ]) as [number, string, string, number][]),
      [1, 'turn', 'check', 0],
      [2, 'turn', 'check', 0],
      [1, 'river', 'check', 0],
    ],
    pot,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: pot,
  });
}
/** PLO4 three-way turn Kh9c4d2s: seat 1 bet the flop, seats 2 and 3 called; turn checked to the Horse on the button (headsUp: seat 2 folded the flop). */
function multiwayTurn(hole: string, opts: { headsUp?: boolean } = {}): Node {
  const hu = opts.headsUp === true;
  return mk({
    variant: 'plo4',
    hero: 3,
    hole,
    board: 'Kh9c4d2s',
    dealer: 3,
    seats: [
      [1, 400, 0, 17],
      [2, 400, 0, hu ? 7 : 17, hu],
      [3, 400, 0, 17],
    ],
    history: [
      ...PRE3,
      [1, 'flop', 'bet', 10],
      [2, 'flop', hu ? 'fold' : 'call', hu ? 0 : 10],
      [3, 'flop', 'call', 10],
      [1, 'turn', 'check', 0],
      ...((hu ? [] : [[2, 'turn', 'check', 0]]) as [number, string, string, number][]),
    ],
    pot: hu ? 41 : 51,
    toCall: 0,
    currentBet: 0,
    legal: ['check', 'bet', 'all_in'],
    minRaiseTo: 2,
    maxRaiseTo: hu ? 41 : 51,
  });
}

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  amounts: (number | undefined)[];
  fires: string[][];
  next: number[];
  refusals: (string | null)[];
}
type Reads = (userId: string) => OmahaReadConditional | null;
function play(build: () => Node, opts: HorseDecideOpts, reads?: Reads): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], amounts: [], fires: [], next: [], refusals: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(((id: string) =>
        reads(id)) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = structuredClone(
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never)
    );
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.amounts.push(d.amount);
    out.fires.push(drainFires().map((f) => f.feature));
    out.refusals.push(
      horseDecisionReceiptRefusal(structuredClone(d), st.gs.gameVariant as string, {
        player: st.hero,
        gameState: st.gs,
      })
    );
    vi.restoreAllMocks();
  }
  return out;
}
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const count = (o: Outcome, a: string) => o.actions.filter((x) => x === a).length;
const isBet = (a: string) => a === 'bet' || a === 'all_in' || a === 'raise';

const stat = (mean: number) => ({ mean, n: 30, engaged: null, excess: 0 });
const leader = {
  measured: true,
  valueLeader: true,
  tightReRaiser: false,
  riverCall: stat(0.3),
  foldToBet: stat(0.5),
} as unknown as OmahaReadConditional;
/** A measured value leader who almost never calls a river bet: the bluff is worth more than the check. */
const leaderFolds = {
  ...leader,
  riverCall: stat(0.03),
} as unknown as OmahaReadConditional;
const notLeader = { ...leader, valueLeader: false } as unknown as OmahaReadConditional;
const presumed = { ...leader, measured: false } as unknown as OmahaReadConditional;
/** A measured player who folds to almost every turn bet. */
const folder = {
  measured: true,
  valueLeader: false,
  tightReRaiser: false,
  riverCall: stat(0.05),
  foldToBet: stat(0.97),
} as unknown as OmahaReadConditional;

const MW: HorseDecideOpts = { omahaMultiwayRiverCallNeedsStrength: true };
const BLUFF: HorseDecideOpts = { omahaNoRiverBluffIntoValueLeader: true };
const WEAK: HorseDecideOpts = { omahaMultiwayWeakHandNoBet: true };
const ALL: HorseDecideOpts = { ...MW, ...BLUFF, ...WEAK };

/** Trips with a weak kicker facing a bet and a caller: the multiway verdict folds at every size here. */
const TRIPS = 'KsKc7d7c3h';
const RIVER_HANDS = ['KsKc7d7c3h', 'Ks9h8h3c2s', 'QsQcTd9h2h', 'Jh5h6c6d2s', 'KhJh9c9d3s'];
const RIVER_BETS = [20, 30, 40, 50];
/** Pricingfix state 65 (Horse cards only), its two-pair sibling 487 and a missed draw. */
const BLUFF_SPOTS: (() => Node)[] = [
  () => riverCheckedTo('3dKs2h8s', '4dJd9h7cJs'),
  () => riverCheckedTo('6dQh3cTs', '2s9c3s2h4s', 21),
  () => riverCheckedTo('KsQc5h6d', '4dJd9h7cJs'),
];
/** Top pair on the turn, three-way, no nut-class or combo draw. */
const WEAK_TURN = () => multiwayTurn('AsKd8c3h');

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('Omaha Multiway And Bluff Discipline: Off', () => {
  it('Unset, False And A Truthy Non-Boolean Decide Byte-Identically In Every Spot', () => {
    const builds: (() => Node)[] = [
      () => riverFacing(TRIPS, 30),
      () => riverFacing('KhJh9c9d3s', 40),
      ...BLUFF_SPOTS,
      WEAK_TURN,
    ];
    for (const build of builds) {
      const unset = play(build, {}, () => leader);
      for (const name of [
        'omahaMultiwayRiverCallNeedsStrength',
        'omahaNoRiverBluffIntoValueLeader',
        'omahaMultiwayWeakHandNoBet',
      ]) {
        for (const value of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
          const off = play(build, { [name]: value } as HorseDecideOpts, () => leader);
          expect(off.bytes).toEqual(unset.bytes);
          expect(off.next).toEqual(unset.next);
        }
      }
      for (const f of unset.fires.flat())
        expect(f.startsWith('omaha_multiway_') || f.startsWith('omaha_no_river_bluff')).toBe(false);
    }
  });
});

describe('Omaha Multiway River Call Needs Strength', () => {
  it('Trips Facing A Bet And A Caller Fold At Every Seed, With The Receipt On The Final Fold', () => {
    const st = riverFacing(TRIPS, 30);
    const mw = omahaMultiwayRiverCallSpot(st.hero, st.gs)!;
    expect(mw.field).toEqual([{ seat: 2, kind: 'caller' }]);
    expect(omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw, null, new Map())!.call).toBe(false);
    const off = play(() => riverFacing(TRIPS, 30), {});
    expect(count(off, 'call')).toBeGreaterThan(0);
    const on = play(() => riverFacing(TRIPS, 30), MW);
    expect(count(on, 'fold')).toBe(SEEDS.length);
    SEEDS.forEach((_, i) => {
      const changed = off.actions[i] !== 'fold';
      expect(on.fires[i].includes('omaha_multiway_river_call_folded')).toBe(changed);
      expect(on.fires[i].includes('omaha_multiway_river_call_folded_vetoed')).toBe(false);
      expect(on.refusals[i]).toBeNull();
    });
    // the rule draws nothing from the brain's random stream
    expect(on.next).toEqual(off.next);
  });

  it('Every Multiway River Decision Is The Verdict: A Call Only When It Clears The Margin, Never A Raise, A Fold Stays A Fold', () => {
    let changed = 0;
    for (const hole of RIVER_HANDS)
      for (const bet of RIVER_BETS) {
        const build = () => riverFacing(hole, bet);
        const st = build();
        const mw = omahaMultiwayRiverCallSpot(st.hero, st.gs);
        expect(mw).not.toBeNull();
        const v = omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw!, null, new Map())!;
        const off = play(build, {});
        const on = play(build, MW);
        SEEDS.forEach((_, i) => {
          expect(['fold', 'call']).toContain(on.actions[i]);
          if (off.actions[i] === 'fold') expect(on.actions[i]).toBe('fold');
          else if (!v.call) expect(on.actions[i]).toBe('fold');
          else expect(on.actions[i]).toBe('call');
          if (on.actions[i] === 'call') expect(on.amounts[i]).toBe(bet);
          if (on.actions[i] !== off.actions[i]) changed++;
          expect(on.refusals[i]).toBeNull();
        });
      }
    expect(changed).toBeGreaterThan(0);
  });

  it('The Field Costs The Call: The Same Hand And Price Heads-Up Is Worth More Than With A Caller', () => {
    for (const hole of RIVER_HANDS) {
      const st = riverFacing(hole, 30);
      const mw = omahaMultiwayRiverCallSpot(st.hero, st.gs)!;
      const v = omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw, null, new Map())!;
      expect(v.field).toBeLessThanOrEqual(1);
      expect(v.pWin).toBeLessThanOrEqual(v.headsUpPWin + 1e-9);
      // a measured caller who calls river bets often holds a wider range: never a smaller field factor
      const wide = new Map([[2, { ...leader, riverCall: stat(0.6) } as OmahaReadConditional]]);
      const vw = omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw, null, wide)!;
      expect(vw.field).toBeGreaterThanOrEqual(v.field - 1e-9);
      expect(vw.shares[0].measured).toBe(true);
      expect(v.shares[0].measured).toBe(false);
    }
  });

  it('Heads-Up, A Nut-Class Hand And The Flop Or Turn Keep Today’s Decision', () => {
    const builds: (() => Node)[] = [
      () => riverFacing(TRIPS, 30, { headsUp: true }),
      () => riverFacing('Ks9h8h3c2s', 40, { headsUp: true }),
      () => riverFacing('AhKh9s3d2c', 30),
    ];
    for (const build of builds) {
      const st = build();
      expect(omahaMultiwayRiverCallSpot(st.hero, st.gs)).toBeNull();
      const off = play(build, {});
      const on = play(build, MW);
      expect(on.bytes).toEqual(off.bytes);
    }
  });
});

describe('Omaha Multiway River Call Needs Strength: The Multiway Value Region', () => {
  it('Is Derived, Not Stated: Heads-Up It Is The Share, Into N Players Its Weakest Hand Is Best Against All N As Often As Heads-Up', () => {
    for (const v1 of [0.45, 0.3, 0.2, 0.12, 0.1]) {
      expect(omahaMultiwayValueShare(v1, 1)).toBe(v1);
      let last = v1;
      for (const n of [2, 3, 4]) {
        const vn = omahaMultiwayValueShare(v1, n);
        expect((1 - vn) ** n).toBeCloseTo(1 - v1, 12);
        expect(vn).toBeLessThan(last);
        last = vn;
      }
    }
    expect(omahaMultiwayValueShare(0.3, 0)).toBe(0.3);
    expect(omahaMultiwayValueShare(Number.NaN, 2)).toBe(0);
  });

  it('The Verdict Prices The Bettor With It: One Caller Beside Him Is Two Players Bet Into', () => {
    for (const bet of RIVER_BETS) {
      const st = riverFacing(TRIPS, bet);
      const mw = omahaMultiwayRiverCallSpot(st.hero, st.gs)!;
      const v = omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw, null, new Map())!;
      expect(v.valueShare).toBeCloseTo(omahaMultiwayValueShare(mw.spot.valueShare, 2), 4);
      expect(v.valueShare).toBeLessThan(mw.spot.valueShare);
    }
  });

  it('Does Not Over-Fold Near-Nut Hands: The Second-Nut Flush Still Calls A Bet And A Call At Every Size Here', () => {
    // ThQd4h7h2d: Kh Jh is the king-high flush, beaten only by the ace-high flush
    for (const bet of RIVER_BETS) {
      const st = riverFacing('KhJh9c8s3d', bet);
      const mw = omahaMultiwayRiverCallSpot(st.hero, st.gs)!;
      expect(mw).not.toBeNull();
      expect(omahaMultiwayRiverCallVerdict(st.hero, st.gs, mw, null, new Map())!.call).toBe(true);
    }
  });
});

describe('Omaha No River Bluff Into Value Leader', () => {
  it('A Bluff Into A Measured Value Leader Who Showed Strength Checks At Every Seed', () => {
    let bluffs = 0;
    for (const build of BLUFF_SPOTS) {
      const st = build();
      const spot = omahaRiverBluffIntoValueLeaderSpot(st.hero, st.gs);
      expect(spot).not.toBeNull();
      expect(spot!.shownSeats).toEqual([1]);
      const off = play(build, {}, () => leader);
      const on = play(build, BLUFF, () => leader);
      SEEDS.forEach((_, i) => {
        expect(isBet(on.actions[i])).toBe(false);
        if (isBet(off.actions[i])) {
          bluffs++;
          expect(on.actions[i]).toBe('check');
          expect(on.fires[i]).toContain('omaha_no_river_bluff_into_value_leader_checked');
        } else expect(on.bytes[i]).toEqual(off.bytes[i]);
        expect(on.refusals[i]).toBeNull();
      });
      expect(on.next).toEqual(off.next);
    }
    expect(bluffs).toBeGreaterThan(0);
  });

  it('No Read, A Presumed Read, A Measured Non-Leader And The Mind Off Keep Today’s Decision', () => {
    for (const build of BLUFF_SPOTS) {
      const off = play(build, {}, () => leader);
      expect(play(build, BLUFF).bytes).toEqual(play(build, {}).bytes);
      expect(play(build, BLUFF, () => presumed).bytes).toEqual(off.bytes);
      expect(play(build, BLUFF, () => notLeader).bytes).toEqual(off.bytes);
      expect(play(build, { ...BLUFF, mind: false }, () => leader).bytes).toEqual(
        play(build, { mind: false }, () => leader).bytes
      );
    }
  });

  it('The Fold-Equity Comparison Keeps The Bet When The Leader Almost Never Calls The River', () => {
    for (const build of BLUFF_SPOTS) {
      const st = build();
      const ev = omahaBetVsCheckEv(
        st.hero,
        st.gs,
        st.gs.pot * 0.75,
        omahaBetVsCheckOpponents(st.hero, st.gs, 'river', new Map([[1, leaderFolds]]))
      )!;
      expect(ev.bet).toBe(true);
      expect(play(build, BLUFF, () => leaderFolds).bytes).toEqual(
        play(build, {}, () => leaderFolds).bytes
      );
    }
  });

  it('No Strength Shown On This Hand Or A Nut-Flush Blocker Keeps Today’s Decision', () => {
    const builds: (() => Node)[] = [
      () => riverCheckedTo('3dKs2h8s', '4dJd9h7cJs', 120, { flopBet: false }),
      // the ace of diamonds on a three-diamond river: the blocker bluffs own it
      () => riverCheckedTo('Ad5c6h8s', '4dJd9h7d2s'),
    ];
    for (const build of builds) {
      expect(play(build, BLUFF, () => leader).bytes).toEqual(play(build, {}, () => leader).bytes);
    }
    const st = builds[0]();
    expect(omahaRiverBluffIntoValueLeaderSpot(st.hero, st.gs)).toBeNull();
  });
});

describe('Omaha Multiway Weak Hand No Bet', () => {
  it('Top Pair Three-Way On The Turn Checks At Every Seed With The Population Prior', () => {
    const st = WEAK_TURN();
    expect(omahaMultiwayWeakHandSpot(st.hero, st.gs)).toBe('turn');
    const off = play(WEAK_TURN, {});
    const on = play(WEAK_TURN, WEAK);
    expect(off.actions.filter(isBet).length).toBeGreaterThan(0);
    SEEDS.forEach((_, i) => {
      expect(isBet(on.actions[i])).toBe(false);
      expect(on.fires[i].includes('omaha_multiway_weak_hand_bet_checked')).toBe(
        isBet(off.actions[i])
      );
      expect(on.refusals[i]).toBeNull();
    });
    expect(on.next).toEqual(off.next);
  });

  it('Players Who Fold To Almost Every Bet Make The Bet Worth More: Today’s Decision Stands', () => {
    const st = WEAK_TURN();
    const reads = new Map([
      [1, folder],
      [2, folder],
    ]);
    expect(
      omahaBetVsCheckEv(
        st.hero,
        st.gs,
        30,
        omahaBetVsCheckOpponents(st.hero, st.gs, 'turn', reads)
      )!.bet
    ).toBe(true);
    expect(play(WEAK_TURN, WEAK, () => folder).bytes).toEqual(
      play(WEAK_TURN, {}, () => folder).bytes
    );
  });

  it('Heads-Up, A Nut Straight Draw And Two Pair Keep Today’s Decision', () => {
    const builds: (() => Node)[] = [
      () => multiwayTurn('AsKd8c3h', { headsUp: true }),
      // queen-jack: any ten makes the king-high straight, the nuts on that river
      () => multiwayTurn('QsJd8c3h'),
      () => multiwayTurn('AsKd9d3h'),
    ];
    for (const build of builds) {
      const st = build();
      expect(omahaMultiwayWeakHandSpot(st.hero, st.gs)).toBeNull();
      expect(play(build, WEAK).bytes).toEqual(play(build, {}).bytes);
    }
  });

  it('The Shown Range Narrows With Each Street Of Strength', () => {
    const st = WEAK_TURN();
    expect(omahaShownRangeShare(omahaShownLine(1, st.gs, 'turn'))).toBeCloseTo(0.4, 6);
    expect(omahaShownRangeShare(omahaShownLine(2, st.gs, 'turn'))).toBeCloseTo(0.45, 6);
    expect(OMAHA_DISCIPLINE_PRIOR_FOLD.turn).toBe(0.31);
  });
});

describe('Omaha Multiway And Bluff Discipline: All Three Together', () => {
  it('Never Leaves An Illegal Or Unadmitted Decision And Never Raises In Their Spots', () => {
    const builds: (() => Node)[] = [
      ...RIVER_HANDS.map((h) => () => riverFacing(h, 30)),
      ...BLUFF_SPOTS,
      WEAK_TURN,
    ];
    for (const build of builds) {
      const st = build();
      const on = play(build, ALL, () => leader);
      SEEDS.forEach((_, i) => {
        expect(st.gs.legalActions).toContain(on.actions[i]);
        expect(on.actions[i]).not.toBe('raise');
        expect(on.refusals[i]).toBeNull();
        for (const f of on.fires[i])
          expect(f.endsWith('_vetoed') && f.startsWith('omaha_multiway')).toBe(false);
      });
    }
  });
});
