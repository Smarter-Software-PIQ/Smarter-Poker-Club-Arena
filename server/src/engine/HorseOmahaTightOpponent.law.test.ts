/**
 * OMAHA PREFLOP ADJUSTMENT AGAINST PROVEN TIGHT OPPONENTS: MATCHED FIXED-INPUT
 * LAW (owner order 2026-11-13, option omahaTightOpponent, default off).
 *
 * Fixed four-handed PLO4 and PLO5 preflop spots, fixed hero hands, one seed
 * list. Only the opponents' remembered public history and the option change:
 *
 *  - off: the option absent or anything but true decides exactly as today
 *    (byte-identical decisions), and nothing tight-related fires;
 *  - on, RESPECT: the big blind facing a pot-sized button open from a PROVEN
 *    tight raiser flats the hand it 3-bets against the same open otherwise,
 *    with the receipt plo_tight_raiser_respected;
 *  - on, STEAL: the button first in, with both blinds PROVEN tight folders,
 *    opens the hand it folds otherwise, with the receipt plo_tight_blinds_steal;
 *  - on, against unknown, sparse (under the evidence floor), presumed,
 *    loose-passive and maniac opponents, and a tight player who has started
 *    raising, the decision is byte-identical to off and nothing fires;
 *  - binding: respect reads the raiser faced (a tight player who folded does
 *    not make an unknown raiser respected, and an unknown folded seat does not
 *    stop a tight raiser being respected); steal needs EVERY player left to
 *    act proven (one unknown blind stops it; a tight folded seat counts for
 *    nothing);
 *  - Hold'em and Omaha hi-lo (PLO8) decide byte-identically with the option on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, decayAndAdd } from './HorseOpponentExploit.js';
import {
  omahaTightOpenerRespect,
  omahaTightRead,
  omahaTightReRaiserRespect,
  omahaTightSteal,
} from './HorseOmahaTightOpponent.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseDeepDiveCapture } from './HorseDeepDiveReceipt.js';
import { decisionRequest } from '../testing/horseRegression/plan/fixture.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < spec.length; i += 2)
    out.push({ rank: spec[i] as CardRank, suit: SUIT[spec[i + 1]] });
  return out;
};
const HERO = '86000000-0000-4000-8000-000000000007';
/** button in the respect spot, big blind in the steal spot */
const RAISER = '40000000-0000-4000-8000-0000000000a1';
/** small blind in both spots */
const SB = '40000000-0000-4000-8000-0000000000b2';
/** the under-the-gun seat, folded in both spots */
const UTG = '40000000-0000-4000-8000-0000000000c3';
const TABLE = 4;
const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005];

const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
    ...over,
  }) as SeatPlayer;

type Kind =
  | 'unknown'
  | 'sparse'
  | 'tight'
  | 'loose_passive'
  | 'maniac'
  | 'average'
  | 'tight_then_raising';

/** One preflop action per hand: raise on `raiseEvery`, call on `callEvery`, else fold. */
function playHands(
  userId: string,
  variant: string,
  hands: number,
  tag: string,
  act: (h: number) => 'raise' | 'call' | 'fold'
): void {
  const scope = readScopeOf(variant, TABLE);
  for (let h = 0; h < hands; h++) {
    const a = act(h);
    const acts = [
      {
        stage: 'preflop',
        seat: 3,
        userId,
        action: a,
        amount: a === 'raise' ? 7 : a === 'call' ? 2 : 0,
        ...(a === 'raise' ? { isFullRaise: true } : {}),
        origin: 'player',
        timestamp: h * 10 + 1,
      },
    ] as unknown as ActionRecord[];
    HorseMind.observeHandComplete(`${tag}:${variant}:${h}`, acts, 2, null, scope);
  }
}
const tightAct = (h: number) => (h % 25 === 0 ? 'raise' : 'fold');
function remember(userId: string, kind: Kind, variant: string): void {
  if (kind === 'sparse') playHands(userId, variant, 8, `${userId}:s`, tightAct);
  if (kind === 'tight') playHands(userId, variant, 200, `${userId}:t`, tightAct);
  // limps four hands in five, never raises
  if (kind === 'loose_passive')
    playHands(userId, variant, 200, `${userId}:lp`, (h) => (h % 5 === 0 ? 'fold' : 'call'));
  if (kind === 'maniac')
    playHands(userId, variant, 200, `${userId}:m`, (h) => (h % 5 < 3 ? 'raise' : 'call'));
  // raises one hand in four, plays one in three: a Horse-like player
  if (kind === 'average')
    playHands(userId, variant, 200, `${userId}:a`, (h) =>
      h % 4 === 0 ? 'raise' : h % 12 === 1 ? 'call' : 'fold'
    );
  if (kind === 'tight_then_raising') {
    playHands(userId, variant, 200, `${userId}:t`, tightAct);
    playHands(userId, variant, 12, `${userId}:r`, (h) => (h % 2 === 0 ? 'raise' : 'fold'));
  }
}

interface Spot {
  variant: string;
  kind: 'respect' | 'steal';
  hole: string;
}
/** The big blind faces a pot-sized button open; UTG and the small blind folded. */
function respectGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(2, HERO, s.hole, { bet: 2, totalInvested: 2, stack: 198, is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199, is_folded: true }),
      hero,
      seat(3, UTG, '', { is_folded: true }),
      seat(4, RAISER, '', { bet: 7, totalInvested: 7, stack: 193 }),
    ],
    communityCards: [],
    pot: 10,
    currentBet: 7,
    toCall: 5,
    minRaise: 5,
    minRaiseTo: 12,
    maxRaiseTo: 24,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
      {
        stage: 'preflop',
        seat: 4,
        userId: RAISER,
        action: 'raise',
        amount: 7,
        isFullRaise: true,
        timestamp: 4,
      },
      { stage: 'preflop', seat: 1, userId: SB, action: 'fold', amount: 0, timestamp: 5 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}
/** The button is first in after UTG folds; both blinds are left to act. */
function stealGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(4, HERO, s.hole, { is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199 }),
      seat(2, RAISER, '', { bet: 2, totalInvested: 2, stack: 198 }),
      seat(3, UTG, '', { is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 3,
    currentBet: 2,
    toCall: 2,
    minRaise: 2,
    minRaiseTo: 4,
    maxRaiseTo: 7,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: s.variant === 'nlh' ? 'no_limit' : 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The whole decision, with only wall-clock timings (latencyMs, elapsedMs) removed. */
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Outcome {
  decisions: string[];
  actions: string[];
  fires: Set<string>;
}
function play(
  s: Spot,
  kinds: Partial<Record<'raiser' | 'sb' | 'utg', Kind>>,
  opts: HorseDecideOpts
): Outcome {
  const decisions: string[] = [];
  const actions: string[] = [];
  const fires = new Set<string>();
  enableBrainTelemetry();
  for (const seed of SEEDS) {
    HorseMind.reset();
    remember(RAISER, kinds.raiser ?? 'unknown', s.variant);
    remember(SB, kinds.sb ?? 'unknown', s.variant);
    remember(UTG, kinds.utg ?? 'unknown', s.variant);
    drainFires();
    seedFastRandom(seed);
    const { hero, gs } = s.kind === 'respect' ? respectGs(s) : stealGs(s);
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
    decisions.push(decisionBytes(d));
    actions.push(d.action);
    for (const f of drainFires()) if (/^plo_tight_/.test(f.feature)) fires.add(f.feature);
  }
  return { decisions, actions, fires };
}
const ON: HorseDecideOpts = { omahaTightOpponent: true };
const OFF: HorseDecideOpts = {};

const SPOTS: Spot[] = [
  { variant: 'plo4', kind: 'respect', hole: 'TsQcKcJd' },
  { variant: 'plo5', kind: 'respect', hole: 'Kd6sQdJsTs' },
  { variant: 'plo4', kind: 'steal', hole: 'Qh7s8d5h' },
  { variant: 'plo5', kind: 'steal', hole: 'Jh4c2cKcTh' },
];
/** The proven-tight table for each spot: the raiser faced, or both blinds. */
const tightTable = (s: Spot) =>
  s.kind === 'respect'
    ? ({ raiser: 'tight' } as const)
    : ({ raiser: 'tight', sb: 'tight' } as const);

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe.each(SPOTS)('omahaTightOpponent, $variant $kind ($hole)', (s) => {
  it('off: absent, false or a non-boolean truthy value decide byte-identically, nothing fires', () => {
    const table = tightTable(s);
    const absent = play(s, table, OFF);
    for (const opts of [
      { omahaTightOpponent: false },
      { omahaTightOpponent: 1 as unknown as boolean },
    ]) {
      const o = play(s, table, opts);
      expect(o.decisions).toEqual(absent.decisions);
      expect([...o.fires]).toEqual([]);
    }
    expect([...absent.fires]).toEqual([]);
  });

  it('on: against proven tight players the committed action changes, with the receipt', () => {
    const table = tightTable(s);
    const off = play(s, table, OFF);
    const on = play(s, table, ON);
    if (s.kind === 'respect') {
      expect(new Set(off.actions)).toEqual(new Set(['raise']));
      expect(new Set(on.actions)).toEqual(new Set(['call']));
      expect([...on.fires]).toEqual(['plo_tight_raiser_respected']);
    } else {
      expect(new Set(off.actions)).toEqual(new Set(['fold']));
      expect(new Set(on.actions)).toEqual(new Set(['raise']));
      expect([...on.fires]).toEqual(['plo_tight_blinds_steal']);
    }
  });

  it('on: unknown, sparse, loose-passive, maniac, Horse-like and re-raising players get the baseline', () => {
    for (const kind of [
      'unknown',
      'sparse',
      'loose_passive',
      'maniac',
      'average',
      'tight_then_raising',
    ] as Kind[]) {
      const table = s.kind === 'respect' ? { raiser: kind } : { raiser: kind, sb: kind };
      const off = play(s, table, OFF);
      const on = play(s, table, ON);
      expect(on.decisions, kind).toEqual(off.decisions);
      expect([...on.fires], kind).toEqual([]);
    }
  });

  it('binding: the raiser faced (respect) or every player left to act (steal)', () => {
    if (s.kind === 'respect') {
      // Tight players who folded do not make the raiser respected: neither an
      // unknown (presumed) raiser nor a loose-passive one, whose read is on
      // evidence and carries no wide raise read that could mask a wrong seat.
      for (const raiser of ['unknown', 'loose_passive'] as const) {
        const wrongSeat = { raiser, sb: 'tight', utg: 'tight' } as const;
        const off = play(s, wrongSeat, OFF);
        const on = play(s, wrongSeat, ON);
        expect(on.decisions, raiser).toEqual(off.decisions);
        expect([...on.fires], raiser).toEqual([]);
      }
      // An unknown folded seat does not stop a tight raiser being respected.
      const tightRaiser = play(s, { raiser: 'tight', sb: 'unknown', utg: 'unknown' }, ON);
      expect(new Set(tightRaiser.actions)).toEqual(new Set(['call']));
      expect([...tightRaiser.fires]).toEqual(['plo_tight_raiser_respected']);
    } else {
      // One unknown blind left to act stops the steal, whichever blind it is,
      // and a tight folded seat counts for nothing.
      for (const table of [
        { raiser: 'tight', sb: 'unknown', utg: 'tight' },
        { raiser: 'unknown', sb: 'tight', utg: 'tight' },
      ] as const) {
        const off = play(s, table, OFF);
        const on = play(s, table, ON);
        expect(on.decisions).toEqual(off.decisions);
        expect([...on.fires]).toEqual([]);
      }
      const both = play(s, { raiser: 'tight', sb: 'tight', utg: 'unknown' }, ON);
      expect(new Set(both.actions)).toEqual(new Set(['raise']));
    }
  });
});

describe("omahaTightOpponent: Hold'em and Omaha hi-lo are untouched", () => {
  it.each([
    { variant: 'nlh', hole: 'Qh7s' },
    { variant: 'nlh', hole: '9c8c' },
    { variant: 'plo8', hole: 'Qh7s8d5h' },
    { variant: 'plo8', hole: 'Ah2s8d5h' },
  ])('$variant $hole steal spot with tight blinds', ({ variant, hole }) => {
    const s: Spot = { variant, kind: 'steal', hole };
    const off = play(s, { raiser: 'tight', sb: 'tight' }, OFF);
    const on = play(s, { raiser: 'tight', sb: 'tight' }, ON);
    expect(on.decisions).toEqual(off.decisions);
    expect([...on.fires]).toEqual([]);
  });
});

describe('HorseOmahaTightOpponent: the read and the bar shifts', () => {
  const tightCounters = (hands: number, raiseEvery: number) => {
    const c = freshExploitCounters();
    for (let h = 0; h < hands; h++) {
      const raise = h % raiseEvery === 0;
      const inc = freshExploitCounters();
      inc.hands = 1;
      inc.fHands = 1;
      inc.rfiOpp = 1;
      inc.fRfiOpp = 1;
      if (raise) {
        inc.vpip = 1;
        inc.pfr = 1;
        inc.fPfr = 1;
        inc.rfi = 1;
        inc.fRfi = 1;
      }
      decayAndAdd(c, inc);
    }
    return c;
  };
  it('the evidence floor: under 15 decayed hands there is no read at all', () => {
    expect(omahaTightRead(tightCounters(10, 1000), 'omaha:short', 'plo4', null)).toBeNull();
    const r = omahaTightRead(tightCounters(200, 25), 'omaha:short', 'plo4', null)!;
    expect(r.raiser).toBe(true);
    expect(r.folder).toBe(true);
  });
  it('never outside Omaha, and never for a player the exploit read calls wide', () => {
    expect(omahaTightRead(tightCounters(200, 25), 'holdem:short', 'nlh', null)).toBeNull();
    const c = tightCounters(200, 25);
    const neutral = { mean: 0.3, n: 40, engaged: null, excess: 0 };
    const wide = {
      stats: {
        vpip: { ...neutral, engaged: 'high' },
        pfr: neutral,
        rfi: neutral,
        threeBet: neutral,
      },
    } as never;
    const r = omahaTightRead(c, 'omaha:short', 'plo4', wide)!;
    expect(r.raiser).toBe(false);
    expect(r.folder).toBe(false);
  });
  it('six-handed (full scope): a 4% raiser is proven (raise-first-in at most half the Horse mean), a 10% raiser is not', () => {
    expect(omahaTightRead(tightCounters(200, 25), 'omaha:full', 'plo4', null)!.raiser).toBe(true);
    const ten = omahaTightRead(tightCounters(200, 10), 'omaha:full', 'plo4', null)!;
    expect(ten.raiser).toBe(false);
    expect(ten.folder).toBe(false);
  });
  it('the shifts only ever continue less (respect) or open more (steal), within bounds', () => {
    const r = omahaTightRead(tightCounters(200, 25), 'omaha:short', 'plo5', null);
    const o = omahaTightOpenerRespect(r)!;
    expect(o.maxBarMove).toBeGreaterThan(0);
    expect(o.maxBarMove).toBeLessThanOrEqual(0.1);
    expect(o.callBump).toBeGreaterThan(0);
    const re = omahaTightReRaiserRespect(r)!;
    expect(re.fourBetBump).toBeGreaterThan(0);
    expect(re.callBump).toBeGreaterThan(0);
    expect(omahaTightOpenerRespect(null)).toBeNull();
    const st = omahaTightSteal([r, r], 7, 3)!;
    expect(st.openWiden).toBeGreaterThan(0);
    expect(st.openWiden).toBeLessThanOrEqual(0.1);
    expect(st.breakEven).toBeCloseTo(0.7, 6);
    expect(omahaTightSteal([r, null], 7, 3)).toBeNull();
    expect(omahaTightSteal([], 7, 3)).toBeNull();
  });
});

describe('omahaTightOpponent: the rewound counterfactual is invisible to the deep-dive receipt', () => {
  it.each([
    { variant: 'plo4', hole: '5c8h6s4h' },
    { variant: 'plo5', hole: '5c8h6s4hAc' },
  ])(
    '$variant $hole: same intent on and off, identical deep-dive rule counts',
    ({ variant, hole }) => {
      const s: Spot = { variant, kind: 'respect', hole };
      const run = (opts: HorseDecideOpts) => {
        enableBrainTelemetry();
        HorseMind.reset();
        remember(RAISER, 'tight', variant);
        drainFires();
        seedFastRandom(SEEDS[0]);
        const { hero, gs } = respectGs(s);
        const capture = new HorseDeepDiveCapture(decisionRequest());
        const d = HorseLogic.decide(
          hero,
          gs,
          'balanced',
          {},
          { telemetry: true, ...opts },
          undefined,
          undefined,
          capture
        );
        const fires = drainFires().map((f) => f.feature);
        return { d, rules: capture.finish(d, null).rules, fires };
      };
      const off = run(OFF);
      const on = run(ON);
      expect(on.d.action).toBe(off.d.action);
      expect(on.fires).toContain('plo_tight_opponent_considered');
      expect(off.rules.some((r) => r.evaluated > 0)).toBe(true);
      expect(on.rules).toEqual(off.rules);
    }
  );
});
