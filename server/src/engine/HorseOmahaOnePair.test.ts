/**
 * OMAHA ONE-PAIR DISCIPLINE (option omahaOnePairDiscipline, default on by owner order 2026-11-15).
 *
 * Owner complaints of 2026-11-14 (PLO5 cash): hands 59407629 and 59430325,
 * a river value bet with one pair; hand 59431232, a river check-call of a
 * pot-sized bet after the flush and the straight completed with a hand that
 * beats no value hand; hands 59426444 and 59417700, a stack-off with one pair
 * on a connected flop. None of these hands has a complaint fixture, so their
 * nodes are built here as constructed states (anonymised seats, no names) or
 * as variations of the existing anonymised complaint fixtures (another
 * hand's public record with the Horse's cards changed).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import {
  omahaNutClassOuts,
  omahaOnePairDiscipline,
  omahaOnePairOrLess,
  type OmahaOnePairContext,
} from './HorseOmahaOnePair.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import SET_RAISES_TURN from './horseComplaints/plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';
import TOP_SET_RIVER from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';
import TOP_TWO_JAMS from './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';

const FA = SET_RAISES_TURN as unknown as ComplaintFixture;
const F1 = TOP_SET_RIVER as unknown as ComplaintFixture;
const FB = TOP_TWO_JAMS as unknown as ComplaintFixture;

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const ON = { omahaOnePairDiscipline: true };
const OFF = { omahaOnePairDiscipline: false };
const NO_BLUFF: OmahaOnePairContext = { declaredBluff: false, bettorOverBluffs: () => false };

function spot(
  base: ComplaintFixture,
  ord: number,
  hole: string,
  node?: (pn: ComplaintPublicNode) => void,
  actions?: (fx: ComplaintFixture) => void
) {
  const fx = JSON.parse(JSON.stringify(base)) as ComplaintFixture;
  actions?.(fx);
  const a = fx.actions.find((x) => x.ord === ord)!;
  fx.hole[String(a.seat)] = cards(hole);
  node?.(a.publicNode!);
  return stateAt(fx, a);
}

interface Run {
  action: string;
  amount: number | null;
  fires: string[];
}
function decideMany(s: ReturnType<typeof spot>, opts: Record<string, unknown> = {}): Run[] {
  enableBrainTelemetry();
  return SEEDS.map((seed) => {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    return {
      action: d.action,
      amount: typeof d.amount === 'number' ? d.amount : null,
      fires: drainFires().map((f) => f.feature),
    };
  });
}
const count = (runs: Run[], action: string) => runs.filter((r) => r.action === action).length;

/** A constructed heads-up node: hero seat 1, opponent seat 2. */
function built(o: {
  variant?: string;
  stage: 'flop' | 'turn' | 'river';
  board: string;
  hole: string;
  pot: number;
  toCall: number;
  heroStack: number;
  heroBet?: number;
  oppStack: number;
  oppBet?: number;
  history?: { seat: number; stage: string; action: string; amount: number }[];
  legal?: string[];
  extra?: Partial<HorseGameStateV2>;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = {
    seat: 1,
    user_id: 'seat-1',
    stack: o.heroStack,
    bet: o.heroBet ?? 0,
    cards: cards(o.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const opp = {
    seat: 2,
    user_id: 'seat-2',
    stack: o.oppStack,
    bet: o.oppBet ?? 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  } as unknown as SeatPlayer;
  const gs = {
    gameVariant: o.variant ?? 'plo5',
    stage: o.stage,
    communityCards: cards(o.board),
    players: [hero, opp],
    pot: o.pot,
    toCall: o.toCall,
    currentBet: (o.heroBet ?? 0) + o.toCall,
    bigBlind: 2,
    dealerSeat: 2,
    actionHistory: o.history ?? [],
    legalActions:
      o.legal ?? (o.toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in']),
    ...o.extra,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const d = (action: HorseDecision['action'], amount?: number): HorseDecision =>
  amount === undefined ? { action, thinkTime: 0 } : { action, amount, thinkTime: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('the measures', () => {
  it('one pair or less: high card, one pair, or the board pair plus one own pair', () => {
    expect(omahaOnePairOrLess(cards('AhKs9c8h2s'), cards('AcJd5s7h3c'))).toBe(true);
    expect(omahaOnePairOrLess(cards('KhQs9c8d2s'), cards('AcJd5s7h3c'))).toBe(true);
    // Kings over the board's sevens: the board pair plus one own pair.
    expect(omahaOnePairOrLess(cards('KhKs9c4h2s'), cards('AcJd7s7h3c'))).toBe(true);
    // Two pair of hero's own and a set are more than one pair.
    expect(omahaOnePairOrLess(cards('AhJs9c8h2s'), cards('AcJd5s7h3c'))).toBe(false);
    expect(omahaOnePairOrLess(cards('JhJs9c8h2s'), cards('AcJd5s7h3c'))).toBe(false);
  });

  it('nut-class outs count the next cards that make the nuts or a top full house', () => {
    // Queens with jack-ten on 9-8-2 rainbow: the queens and sevens make the nut straight.
    expect(omahaNutClassOuts(cards('QhQsJcTd'), cards('9s8h2c'))).toBeGreaterThanOrEqual(4);
    // A bare overpair has no nut-class outs (a set is not nut class).
    expect(omahaNutClassOuts(cards('QhQs7c3d'), cards('Js9h8c'))).toBeLessThan(4);
  });
});

describe('rule 1: the river is not bet for value with one pair (hands 59407629, 59430325)', () => {
  const river = () =>
    built({
      stage: 'river',
      board: 'KsJd2dTc4c',
      hole: 'KhAh8s7h3s',
      pot: 420,
      toCall: 0,
      heroStack: 800,
      oppStack: 800,
    });

  it('a one-pair bet becomes a check; a declared bluff keeps its bet; off changes nothing', () => {
    const { hero, gs } = river();
    expect(omahaOnePairDiscipline(d('bet', 300), hero, gs, true, NO_BLUFF)).toMatchObject({
      decision: { action: 'check' },
      changed: 'river_value_bet_checked',
    });
    expect(
      omahaOnePairDiscipline(d('bet', 300), hero, gs, true, { ...NO_BLUFF, declaredBluff: true })
        .changed
    ).toBeNull();
    expect(omahaOnePairDiscipline(d('bet', 300), hero, gs, false, NO_BLUFF).changed).toBeNull();
    expect(omahaOnePairDiscipline(d('check'), hero, gs, true, NO_BLUFF).changed).toBeNull();
  });

  it('two pair of its own, PLO6, hi-lo, a bomb pot and a second board are left alone', () => {
    const { hero, gs } = river();
    hero.cards = cards('KhJh8s7h3s');
    expect(omahaOnePairDiscipline(d('bet', 300), hero, gs, true, NO_BLUFF).changed).toBeNull();
    for (const extra of [
      { gameVariant: 'plo6' },
      { gameVariant: 'plo8' },
      { bombPot: true },
      { boardCount: 2 },
      { allInOrFold: true },
    ]) {
      const b = river();
      if (extra.gameVariant === 'plo6') b.hero.cards = cards('KhAh8s7h3s6d');
      Object.assign(b.gs, extra);
      expect(
        omahaOnePairDiscipline(d('bet', 300), b.hero, b.gs, true, NO_BLUFF).changed
      ).toBeNull();
    }
  });

  it('a one-pair river raise becomes a call', () => {
    const { hero, gs } = built({
      stage: 'river',
      board: 'KsJd2d8c4h',
      hole: 'KhAh9s7h3s',
      pot: 300,
      toCall: 50,
      heroStack: 800,
      oppStack: 800,
      oppBet: 50,
      history: [{ seat: 2, stage: 'river', action: 'bet', amount: 50 }],
    });
    expect(omahaOnePairDiscipline(d('raise', 300), hero, gs, true, NO_BLUFF)).toMatchObject({
      decision: { action: 'call', amount: 50 },
      changed: 'river_value_raise_flatted',
    });
  });

  it('at a recorded river node checked to the Horse, top pair never bets with the rule on', () => {
    // Hand 59414191's river record (straight possible), the Horse given top pair.
    const s = spot(FA, 22, 'KhAh8s7h3s');
    expect(s.gs.stage).toBe('river');
    const off = decideMany(s, OFF);
    const on = decideMany(s, ON);
    // Non-vacuity: the brain bets this top pair with the rule off.
    expect(count(off, 'bet') + count(off, 'all_in')).toBeGreaterThan(0);
    // With the rule on, any remaining wager is a declared river bluff.
    for (const r of on)
      if (r.action === 'bet' || r.action === 'all_in')
        expect(r.fires.some((f) => f.includes('bluff'))).toBe(true);
    expect(
      on.filter((r) => r.fires.includes('omaha_one_pair_river_value_bet_checked')).length
    ).toBe(count(off, 'bet') + count(off, 'all_in') - (count(on, 'bet') + count(on, 'all_in')));
  });
});

describe('rule 2: no river call that beats no value hand (hand 59431232)', () => {
  // Checked flop, a third-pot turn bet called, the river completes the flush
  // and the straight and the opponent bets the pot.
  const river = (bet = 300, hole = 'AhAs9c8h2s', potBefore = 300) =>
    built({
      stage: 'river',
      board: 'Kc7c3dJc9d',
      hole,
      pot: potBefore + bet,
      toCall: bet,
      heroStack: 900,
      oppStack: 900 - bet,
      oppBet: bet,
      history: [
        { seat: 2, stage: 'flop', action: 'check', amount: 0 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'turn', action: 'check', amount: 0 },
        { seat: 1, stage: 'turn', action: 'bet', amount: 70 },
        { seat: 2, stage: 'turn', action: 'call', amount: 70 },
        { seat: 2, stage: 'river', action: 'bet', amount: bet },
      ],
    });

  it('one pair and two pair fold to a pot-sized bet; a set or a flush is not judged here', () => {
    const one = river();
    expect(omahaOnePairDiscipline(d('call', 300), one.hero, one.gs, true, NO_BLUFF)).toMatchObject({
      decision: { action: 'fold' },
      changed: 'river_beaten_call_folded',
    });
    const two = river(300, 'KhJs9c8h2s');
    expect(omahaOnePairDiscipline(d('call', 300), two.hero, two.gs, true, NO_BLUFF).changed).toBe(
      'river_beaten_call_folded'
    );
    const set = river(300, 'KhKs6c8h2s');
    expect(
      omahaOnePairDiscipline(d('call', 300), set.hero, set.gs, true, NO_BLUFF).changed
    ).toBeNull();
    const flush = river(300, 'AcQc6s8h2s');
    expect(
      omahaOnePairDiscipline(d('call', 300), flush.hero, flush.gs, true, NO_BLUFF).changed
    ).toBeNull();
  });

  it('the line is 0.66 pot; a measured over-bluffer is called; off changes nothing', () => {
    const at = river(198);
    expect(omahaOnePairDiscipline(d('call', 198), at.hero, at.gs, true, NO_BLUFF).changed).toBe(
      'river_beaten_call_folded'
    );
    const under = river(150);
    expect(
      omahaOnePairDiscipline(d('call', 150), under.hero, under.gs, true, NO_BLUFF).changed
    ).toBeNull();
    const one = river();
    expect(
      omahaOnePairDiscipline(d('call', 300), one.hero, one.gs, true, {
        declaredBluff: false,
        bettorOverBluffs: (seat) => seat === 2,
      }).changed
    ).toBeNull();
    expect(
      omahaOnePairDiscipline(d('call', 300), one.hero, one.gs, false, NO_BLUFF).changed
    ).toBeNull();
  });

  it('a board where no straight or flush is possible keeps the call', () => {
    const { hero, gs } = built({
      stage: 'river',
      board: 'Kc7h2dKs3c',
      hole: 'AhAs9c8h4s',
      pot: 600,
      toCall: 300,
      heroStack: 900,
      oppStack: 600,
      oppBet: 300,
      history: [{ seat: 2, stage: 'river', action: 'bet', amount: 300 }],
    });
    expect(omahaOnePairDiscipline(d('call', 300), hero, gs, true, NO_BLUFF).changed).toBeNull();
  });

  // Hand 59401453's river record (straights possible), the lead cut to 0.7
  // of the pot (under V81's 0.9 line) and the Horse given top two pair.
  const lead70 = () => lead70Node();

  it('at a recorded river lead of 0.7 pot, top two pair folds with the rule on on every seed', () => {
    const s = lead70();
    expect(s.gs.toCall).toBe(130);
    const off = decideMany(s, OFF);
    const on = decideMany(s, ON);
    expect(count(off, 'fold')).toBeLessThan(SEEDS.length);
    expect(count(on, 'fold')).toBe(SEEDS.length);
  });

  it('a measured postflop over-bluffer is still called at that node', () => {
    const s = lead70();
    const off = decideMany(s, OFF);
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation(((id: string) =>
      id === 'p1'
        ? {
            stats: {
              betCheckedTo: { engaged: 'high', mean: 0.9, n: 9 },
              foldToBet: { n: 0, mean: 0 },
            },
          }
        : null) as never);
    const on = decideMany(s, { ...ON, mind: undefined });
    expect(
      on.filter((r) => r.fires.includes('omaha_one_pair_river_beaten_call_folded')).length
    ).toBe(0);
    expect(count(off, 'fold')).toBeLessThan(SEEDS.length);
  });
});

function lead70Node() {
  return spot(
    F1,
    23,
    'AdQc5h4s3s',
    (pn) => {
      pn.pot = 314;
      pn.toCall = 130;
      pn.currentBet = 130;
      pn.seats[0] = [1, 904.8, 130, 208, 2, 0, 0];
    },
    (fx) => {
      fx.actions.find((x) => x.ord === 22)!.amount = 130;
    }
  );
}

describe('rule 3: no one-pair stack-off on the flop or turn (hands 59426444, 59417700)', () => {
  // A connected flop, an overpair with no draw.
  const flop = (toCall: number, heroStack = 400, oppBet = toCall, pot = 60 + toCall) =>
    built({
      stage: 'flop',
      board: 'Js9h8c',
      hole: 'QhQs7d3d2c',
      pot,
      toCall,
      heroStack,
      oppStack: 1000,
      oppBet,
      history: [{ seat: 2, stage: 'flop', action: 'bet', amount: oppBet }],
    });

  it('a raise with a small call becomes a call', () => {
    const { hero, gs } = flop(40);
    expect(omahaOnePairDiscipline(d('raise', 180), hero, gs, true, NO_BLUFF)).toMatchObject({
      decision: { action: 'call', amount: 40 },
      changed: 'one_pair_raise_flatted',
    });
    expect(omahaOnePairDiscipline(d('call', 40), hero, gs, true, NO_BLUFF).changed).toBeNull();
  });

  it('a call or a raise of a stack-sized wager folds', () => {
    const { hero, gs } = flop(250);
    expect(omahaOnePairDiscipline(d('call', 250), hero, gs, true, NO_BLUFF)).toMatchObject({
      decision: { action: 'fold' },
      changed: 'one_pair_stack_off_folded',
    });
    expect(omahaOnePairDiscipline(d('all_in'), hero, gs, true, NO_BLUFF).changed).toBe(
      'one_pair_raise_folded'
    );
    expect(omahaOnePairDiscipline(d('call', 250), hero, gs, false, NO_BLUFF).changed).toBeNull();
  });

  it('a stack-sized call at a long price, a hand with nut-class outs, and two pair keep their line', () => {
    // The pot already lays far more than a third: price under 0.25.
    const cheap = flop(250, 400, 250, 1200);
    expect(
      omahaOnePairDiscipline(d('call', 250), cheap.hero, cheap.gs, true, NO_BLUFF).changed
    ).toBeNull();
    const wrap = flop(250);
    wrap.hero.cards = cards('QhQsTd7d2c');
    expect(omahaNutClassOuts(wrap.hero.cards, wrap.gs.communityCards)).toBeGreaterThanOrEqual(4);
    expect(
      omahaOnePairDiscipline(d('call', 250), wrap.hero, wrap.gs, true, NO_BLUFF).changed
    ).toBeNull();
    const twoPair = flop(250);
    twoPair.hero.cards = cards('Jh9s7d3d2c');
    expect(
      omahaOnePairDiscipline(d('call', 250), twoPair.hero, twoPair.gs, true, NO_BLUFF).changed
    ).toBeNull();
    // A bet facing no wager is never touched on the flop.
    const lead = flop(0, 400, 0, 60);
    expect(
      omahaOnePairDiscipline(d('bet', 60), lead.hero, lead.gs, true, NO_BLUFF).changed
    ).toBeNull();
  });

  it('at a recorded flop node facing a small bet, one pair never raises with the rule on', () => {
    // Hand 59416584's flop record (wheel and broadway straights possible),
    // the Horse given a bare pair of kings under the ace.
    const s = spot(FB, 16, 'KsKd9c8h2s');
    const on = decideMany(s, ON);
    expect(
      count(on, 'raise') +
        on.filter((r) => r.action === 'all_in' && s.hero.stack > (s.gs.toCall ?? 0)).length
    ).toBe(0);
  });
});

describe('the worker receipt', () => {
  it('a river bet turned into a check, and a raise turned into a call, are admitted', () => {
    const s = spot(FA, 22, 'KhAh8s7h3s');
    for (const seed of SEEDS) {
      seedFastRandom(seed);
      HorseMind.reset();
      const dec = structuredClone(
        HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, { mind: false, ...ON } as never)
      );
      expect(
        horseDecisionReceiptRefusal(structuredClone(dec), 'plo5', {
          player: s.hero,
          gameState: s.gs,
        })
      ).toBeNull();
    }
  });
});

describe('with the option off nothing changes', () => {
  // Every decision node of three anonymised PLO5 complaint fixtures plus the
  // three one-pair variations above, eight seeds: the option absent and the
  // option false decide identically, and the digest of those decisions
  // equals the one recorded on the base commit 033173b4 (before this change
  // existed; the engine files reverted, this test file run against them).
  const BASE_DIGEST = 'b559b1e049a15104f3d174378c7d8200c9a7b0f638f27fb62b1d7c21ce2a7125';
  it('absent and true are identical (on by default); every new rule false equals the base commit, on the sample', () => {
    const nodes: { name: string; s: ReturnType<typeof stateAt> }[] = [];
    for (const fx of [FA, F1, FB])
      for (const a of fx.actions)
        if (a.publicNode && fx.hole[String(a.seat)])
          nodes.push({ name: `${fx.slug}:${a.ord}`, s: stateAt(fx, a) });
    nodes.push({ name: 'river-top-pair', s: spot(FA, 22, 'KhAh8s7h3s') });
    nodes.push({ name: 'river-lead-top-pair', s: spot(F1, 23, 'AdKc5h4s3s') });
    nodes.push({ name: 'river-lead70-two-pair', s: lead70Node() });
    nodes.push({ name: 'flop-kings', s: spot(FB, 16, 'KsKd9c8h2s') });
    const lines: string[] = [];
    for (const { name, s } of nodes)
      for (const seed of SEEDS.slice(0, 8)) {
        const run = (opts: Record<string, unknown>) => {
          seedFastRandom(seed);
          HorseMind.reset();
          const r = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
            mind: false,
            ...opts,
          } as never);
          return `${r.action}:${r.amount ?? ''}`;
        };
        // The base commit 033173b4 had these four off or absent.
        const base = run({
          omahaOnePairDiscipline: false,
          omahaBeatenMadeHandDefense: false,
          omahaNutClassValueSize: false,
          omahaReraisedPotDiscipline: false,
        });
        expect(run({})).toBe(run({ omahaOnePairDiscipline: true }));
        lines.push(`${name}:${seed}:${base}`);
      }
    expect(lines.length).toBeGreaterThan(80);
    const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
    expect(digest).toBe(BASE_DIGEST);
  });
});
