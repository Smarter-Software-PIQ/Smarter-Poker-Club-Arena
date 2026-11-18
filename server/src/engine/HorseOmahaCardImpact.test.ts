/**
 * OMAHA CARD IMPACT (owner 2026-11-15 11:41; option omahaCardImpact, default
 * OFF; HorseOmahaCardImpact.ts).
 *
 * Recorded hands, anonymised to seat numbers (the fixtures of hands 59517323
 * and 59521326), and spots built from them by changing the Horse's cards and
 * the board:
 *
 *  - unset, false and a truthy non-boolean decide byte-identically and leave
 *    the brain's random stream where it was;
 *  - hand 59517323: the turn card that brings the nut flush draw is priced
 *    (more holdings beat the hand, seven river cards make the nuts) and the
 *    decision is kept, a bet being worth more than a check in the model; on
 *    the river that pairs the board every bet becomes a check, because the
 *    hands that call it beat the Horse more often than they lose to it;
 *  - hand 59521326: the nut straight stops being the nuts on the turn card
 *    that pairs the board; the bet becomes a third of the pot;
 *  - a freeroll (the nut straight with the nut flush draw on the turn): a
 *    check and a half-pot bet both become the full pot;
 *  - a river that misses his draws, top set: a check becomes a bet;
 *  - a river that completes the flush and the straights, top set out of
 *    position: a bet becomes a check;
 *  - the worker receipt validator admits every changed decision.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_CARD_IMPACT_MARGIN,
  omahaCardImpactCheckAdmissible,
  omahaCardImpactDecision,
  omahaCardImpactResetCache,
  omahaCardImpactScope,
} from './HorseOmahaCardImpact.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31];
const ON: HorseDecideOpts = { omahaCardImpact: true };
const HERO = 5;

type Node = ReturnType<typeof stateAt>;
const node =
  (fx: unknown, ord: number, edit: { hole?: string; board?: string } = {}) =>
  (): Node => {
    const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
    if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
    const n = f.actions.find((a) => a.ord === ord)!;
    if (edit.board) n.publicNode!.boards = [edit.board];
    return stateAt(f, n);
  };
const acesFlop = node(ACES, 14);
const acesTurn = node(ACES, 16);
const acesRiver = node(ACES, 18);
const straightTurn = node(STRAIGHT, 16);
const straightRiver = node(STRAIGHT, 18);
// The nut straight (3-6 on 2-4-5-9) with the nut heart draw, out of position.
const freerollTurn = node(STRAIGHT, 16, { hole: '6sAh3hKsQd', board: '2d4h5s9h' });
// Top set after the flop and turn bets were called; the river misses the
// heart draw and the straight draws around ten-nine.
const missedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s3s' });
// The same hand and line; the river completes the flush and three straights.
const completedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s8h' });
const ALL = [
  acesTurn,
  acesRiver,
  straightTurn,
  straightRiver,
  freerollTurn,
  missedRiver,
  completedRiver,
];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaCardImpactResetCache();
});

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  amounts: number[];
  fires: string[][];
  next: number[];
  refused: Array<string | null>;
}
function play(build: () => Node, opts: HorseDecideOpts): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], amounts: [], fires: [], next: [], refused: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => null) as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.amounts.push(d.amount ?? 0);
    out.fires.push(drainFires().map((f) => f.feature));
    out.refused.push(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: st.hero,
        gameState: st.gs,
      })
    );
    vi.restoreAllMocks();
  }
  return out;
}
const WAGERS = ['bet', 'raise', 'all_in'];
const wagers = (o: Outcome) => o.actions.filter((a) => WAGERS.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const check: HorseDecision = { action: 'check', thinkTime: 0 };
const bet = (amount: number): HorseDecision => ({ action: 'bet', amount, thinkTime: 0 });
const priced = (build: () => Node, legacy: HorseDecision) => {
  const st = build();
  return omahaCardImpactDecision(legacy, st.hero, st.gs, null)!;
};

describe('the fixtures are the recorded hands', () => {
  it('hands 59517323 and 59521326, no identity', () => {
    for (const fx of [ACES, STRAIGHT] as unknown as ComplaintFixture[]) {
      expect(recordedPathMatches(fx)).toBe(true);
      expect(JSON.stringify(fx)).not.toMatch(/userId|username/);
    }
    expect((ACES as unknown as ComplaintFixture).handId).toBe(
      'b84739da-6e6f-4627-97ee-564f18cc81d5'
    );
    expect((STRAIGHT as unknown as ComplaintFixture).handId).toBe(
      'da517455-224c-4918-8774-ddfee4e82512'
    );
  });
});

describe('omahaCardImpact off', () => {
  it('unset, false and a truthy non-boolean decide byte-identically and draw the same randoms', () => {
    for (const build of [acesFlop, ...ALL]) {
      const unset = play(build, {});
      for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
        const off = play(build, { omahaCardImpact: v });
        expect(off.bytes).toEqual(unset.bytes);
        expect(off.next).toEqual(unset.next);
      }
    }
  });
});

describe('scope', () => {
  it('turn and river, heads-up, nothing to call; the flop, PLO6, tournaments, hi-lo, a bet to call and a third player are outside', () => {
    for (const build of ALL) {
      const st = build();
      expect(omahaCardImpactScope(st.hero, st.gs)).not.toBeNull();
    }
    const flop = acesFlop();
    expect(omahaCardImpactScope(flop.hero, flop.gs)).toBeNull();
    expect(play(acesFlop, ON).bytes).toEqual(play(acesFlop, {}).bytes);
    const st = acesRiver();
    for (const over of [
      { gameVariant: 'plo6' },
      { gameMode: 'tournament' },
      { variantRules: { splitLow8OrBetter: true } },
      { toCall: 40, currentBet: 40 },
      { players: st.gs.players.map((p) => (p.seat === 2 ? { ...p, is_folded: false } : p)) },
    ])
      expect(omahaCardImpactScope(st.hero, { ...st.gs, ...over } as never)).toBeNull();
  });
});

describe('hand 59517323 (aces; turn brings the nut flush draw; river pairs the board)', () => {
  it('turn: more holdings beat the hand, seven river cards make the nuts; the decision is kept at every seed', () => {
    const r = priced(acesTurn, bet(233));
    expect(r.impact.own).toMatchObject({
      beatersBefore: 48,
      beatersNow: 78,
      nutsNow: false,
      nutOuts: 7,
      freeroll: false,
    });
    expect(r.impact.opp.aheadNow).toBeGreaterThan(r.impact.opp.aheadBefore);
    expect(r.impact.verdict).toBe('mixed');
    // The model prices a bet above a check: the owner's check is not forced.
    expect(r.legacy.ev).toBeGreaterThan(r.impact.options[0].ev);
    expect(r.changed).toBeNull();
    // A check is not turned into a bet either: no size is a value bet.
    expect(priced(acesTurn, check).changed).toBeNull();
    expect(r.impact.options.some((o) => o.value)).toBe(false);
    const off = play(acesTurn, {});
    const on = play(acesTurn, ON);
    expect(on.bytes).toEqual(off.bytes);
    expect(on.next).toEqual(off.next);
  });

  it('river: the recorded quarter-pot bet is called by better hands more than worse ones, and becomes a check', () => {
    const r = priced(acesRiver, bet(256));
    expect(r.legacy.value).toBe(false);
    expect(r.legacy.continueBeats).toBeGreaterThan(0.5);
    expect(r.changed).toBe('defence_check');
    expect(r.decision.action).toBe('check');
    expect(priced(acesRiver, check).changed).toBeNull();
    const off = play(acesRiver, {});
    const on = play(acesRiver, ON);
    expect(wagers(off)).toBeGreaterThan(0);
    expect(wagers(on)).toBe(0);
    expect(hasFire(on, 'omaha_card_impact_defence_check')).toBe(wagers(off));
    expect(hasFire(on, 'omaha_card_impact_changed')).toBe(wagers(off));
    on.actions.forEach((_, i) => {
      if (!WAGERS.includes(off.actions[i])) expect(on.bytes[i]).toEqual(off.bytes[i]);
    });
    expect(on.next).toEqual(off.next);
    expect(on.refused.every((x) => x === null)).toBe(true);
  });
});

describe('hand 59521326 (nut straight; the turn pairs the board)', () => {
  it('turn: the nuts before the card, not after; a third of his range moved ahead; the bet becomes a third of the pot', () => {
    const r = priced(straightTurn, bet(373));
    expect(r.impact.own).toMatchObject({ nutsBefore: true, nutsNow: false, beatersBefore: 0 });
    expect(r.impact.own.beatersNow).toBeGreaterThan(0);
    expect(r.impact.opp.aheadBefore).toBe(0);
    expect(r.impact.opp.improvedPast).toBeGreaterThan(0.25);
    expect(r.impact.verdict).toBe('bad');
    expect(r.changed).toBe('resized');
    expect(r.decision).toMatchObject({ action: 'bet', amount: 221 });
    expect(r.chosen.ev - r.legacy.ev).toBeGreaterThan(OMAHA_CARD_IMPACT_MARGIN * 669);
    // The model prices the small bet above the check: the check is not forced.
    expect(r.chosen.ev).toBeGreaterThan(r.impact.options[0].ev);
    const off = play(straightTurn, {});
    const on = play(straightTurn, ON);
    expect(wagers(off)).toBe(SEEDS.length);
    on.actions.forEach((a, i) => {
      expect(a).toBe('bet');
      expect(on.amounts[i]).toBe(221);
      expect(on.amounts[i]).toBeLessThan(off.amounts[i]);
    });
    expect(hasFire(on, 'omaha_card_impact_changed')).toBe(SEEDS.length);
    expect(hasFire(on, 'omaha_card_impact_defence_check')).toBe(0);
    expect(on.next).toEqual(off.next);
    expect(on.refused.every((x) => x === null)).toBe(true);
  });

  it('river: the check is kept, and a bet would be a check', () => {
    expect(play(straightRiver, ON).bytes).toEqual(play(straightRiver, {}).bytes);
    expect(priced(straightRiver, bet(467)).changed).toBe('defence_check');
  });
});

describe('a freeroll: the nut straight with the nut flush draw on the turn', () => {
  it('a check and a half-pot bet become the full pot; the full pot is kept', () => {
    const fromCheck = priced(freerollTurn, check);
    expect(fromCheck.impact.own).toMatchObject({ nutsNow: true, freeroll: true });
    expect(fromCheck.impact.own.freerollOuts).toBeGreaterThanOrEqual(8);
    expect(fromCheck.impact.verdict).toBe('good');
    expect(fromCheck.changed).toBe('freeroll_pot');
    expect(fromCheck.decision).toMatchObject({ action: 'bet', amount: 669 });
    expect(priced(freerollTurn, bet(335)).decision).toMatchObject({ action: 'bet', amount: 669 });
    expect(priced(freerollTurn, bet(669)).changed).toBeNull();
    const on = play(freerollTurn, ON);
    expect(on.actions.every((a) => a === 'bet')).toBe(true);
    expect(on.amounts.every((a) => a === 669)).toBe(true);
  });
});

describe('a river that misses his draws, top set', () => {
  it('a check becomes a value bet', () => {
    const r = priced(missedRiver, check);
    expect(r.impact.opp.missedDraws).toBeGreaterThan(0.3);
    expect(r.changed).toBe('press_bet');
    expect(r.chosen.value).toBe(true);
    expect(r.chosen.continueBeats).toBeLessThan(0.5);
    const off = play(missedRiver, {});
    const on = play(missedRiver, ON);
    expect(wagers(on)).toBe(SEEDS.length);
    expect(wagers(off)).toBeLessThan(SEEDS.length);
    expect(hasFire(on, 'omaha_card_impact_press_bet')).toBe(SEEDS.length - wagers(off));
    expect(on.next).toEqual(off.next);
    expect(on.refused.every((x) => x === null)).toBe(true);
  });
});

describe('a river that completes the flush and the straights, top set out of position', () => {
  it('most of his range moved ahead; a bet becomes a check and the check is kept', () => {
    const r = priced(completedRiver, bet(337));
    expect(r.impact.own).toMatchObject({ nutsBefore: true, nutsNow: false });
    expect(r.impact.opp.improvedPast).toBeGreaterThan(0.4);
    expect(r.impact.verdict).toBe('bad');
    expect(r.changed).toBe('defence_check');
    expect(wagers(play(completedRiver, ON))).toBe(0);
  });
});

describe('determinism and cost', () => {
  it('the same spot prices the same way twice and reads no brain random', () => {
    for (const build of ALL) {
      seedFastRandom(5);
      const a = priced(build, check);
      omahaCardImpactResetCache();
      const b = priced(build, check);
      expect(JSON.stringify(a.impact)).toEqual(JSON.stringify(b.impact));
      seedFastRandom(5);
      const first = fastRandom();
      seedFastRandom(5);
      priced(build, check);
      expect(fastRandom()).toBe(first);
    }
  });
});

describe('the worker receipt', () => {
  it('a bet that became a check is refused against a request in which the Horse holds a nut-class hand', () => {
    const st = acesRiver();
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => null) as never);
    seedFastRandom(2026);
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
    expect(d.action).toBe('check');
    expect(d.policyGraph?.transitions.find((t) => t.node === 'wager_rules')?.before?.action).toBe(
      'bet'
    );
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { player: st.hero, gameState: st.gs })
    ).toBeNull();
    const boat = node(ACES, 18, { hole: '5s5hQs7c4h' })();
    expect(omahaCardImpactCheckAdmissible(boat.hero, boat.gs)).toBe(false);
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: boat.hero,
        gameState: boat.gs,
      })
    ).toBe('policy_graph');
  });
});
