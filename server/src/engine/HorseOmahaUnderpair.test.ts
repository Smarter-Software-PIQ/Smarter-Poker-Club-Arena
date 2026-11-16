/**
 * OMAHA UNDERPAIR RULES (2026-11-15; options
 * omahaNoCallColdFourBetWithoutPremium and omahaUnderpairNoMultiwayFlopContinue,
 * default OFF), on the recorded hand 59518335 (PLO5 1/2 cash, anonymised to
 * seats): the button re-raised an open and two calls with a pair of queens and
 * three low cards (decision 7), called the big blind's cold 4-bet (decision
 * 13), called a flop bet and a call on K-T-6 with the underpair and a gutshot
 * (decision 16) and put its last chips in on the turn (decision 19).
 *
 *  - the cells: what a cold re-raise is, what an underpair without a draw is,
 *    what a bet and a call is, and the two price bounds;
 *  - each option in the decision: unset, false and a truthy non-boolean decide
 *    byte-identically; on, the recorded continue folds with its receipt and
 *    draws nothing from the brain's random stream; aces, a premium structure,
 *    a set, a flush draw, a nut wrap, top pair, a heads-up flop and a small
 *    price keep today's decision; the fold is admitted by the worker receipt
 *    validator; the other recorded decisions are unchanged.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import {
  UNDERPAIR_KEEP_PRICE,
  omahaColdFourBetCell,
  omahaColdFourBetFaced,
  omahaFlopBetAndCallFaced,
  omahaUnderpairFlopCell,
  omahaUnderpairNoDraw,
  type UnderpairAction,
} from './HorseOmahaUnderpair.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import RECORDED from './HorseOmahaUnderpair.fixture.json';

const FX = RECORDED as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 16 }, (_, i) => 5000 + i);

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Variation {
  hole?: string;
  variant?: 'plo4' | 'plo5' | 'plo8';
  node?: (pn: ComplaintPublicNode) => void;
  actions?: (fx: ComplaintFixture) => void;
}
function spot(ord: number, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  v.actions?.(fx);
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
  if (v.variant) {
    fx.variant = v.variant;
    node.publicNode!.variant = v.variant;
  }
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}

interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
/** A digest of the whole decision (timings aside), so a difference fails with a short message. */
const decisionBytes = (d: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(withoutMeasurements(d)))
    .digest('hex')
    .slice(0, 16);
function playMany(ord: number, opts: HorseDecideOpts, v: Variation = {}): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(s);
    const st = spot(ord, v);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    });
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const continues = (o: Outcome) =>
  o.actions.filter((a) => a === 'call' || a === 'raise' || a === 'all_in').length;
const folds = (o: Outcome) => o.actions.filter((a) => a === 'fold').length;

// ─── the cells ──────────────────────────────────────────────────────────────

const act = (seat: number, action: string, stage = 'preflop', full = false): UnderpairAction => ({
  stage,
  seat,
  action,
  isFullRaise: full,
});

describe('a cold re-raise of the Horse’s own re-raise', () => {
  const posts = [act(5, 'sb'), act(6, 'bb'), act(6, 'ante')];
  it('the recorded line: open, two calls, hero re-raises, the big blind re-raises cold', () => {
    const h = [
      ...posts,
      act(1, 'raise', 'preflop', true),
      act(2, 'call'),
      act(3, 'call'),
      act(4, 'raise', 'preflop', true),
      act(5, 'fold'),
      act(6, 'raise', 'preflop', true),
      act(1, 'call'),
    ];
    expect(omahaColdFourBetFaced(h, 4)).toBe(6);
    expect(omahaColdFourBetFaced(FX.actions.filter((a) => a.ord < 13) as never, 4)).toBe(6);
  });
  it('the opener’s or a caller’s 4-bet is not cold; nor is a 3-bet; nor a raise over someone else', () => {
    const open = [...posts, act(1, 'raise', 'preflop', true), act(2, 'call')];
    expect(
      omahaColdFourBetFaced(
        [...open, act(4, 'raise', 'preflop', true), act(1, 'raise', 'preflop', true)],
        4
      )
    ).toBeNull();
    expect(
      omahaColdFourBetFaced(
        [...open, act(4, 'raise', 'preflop', true), act(2, 'raise', 'preflop', true)],
        4
      )
    ).toBeNull();
    // hero opened, the big blind re-raised: two raises only
    expect(
      omahaColdFourBetFaced(
        [...posts, act(4, 'raise', 'preflop', true), act(6, 'raise', 'preflop', true)],
        4
      )
    ).toBeNull();
    // a cold 4-bet over another player's 3-bet, hero only called
    expect(
      omahaColdFourBetFaced(
        [...open, act(3, 'raise', 'preflop', true), act(6, 'raise', 'preflop', true)],
        4
      )
    ).toBeNull();
    // an all-in call after hero's re-raise is not a raise
    expect(
      omahaColdFourBetFaced([...open, act(4, 'raise', 'preflop', true), act(6, 'all_in')], 4)
    ).toBeNull();
  });

  const input = (hole: string, stack: number, toCall: number, pot: number, variant = 'plo5') => ({
    variant,
    street: 'preflop',
    hole: cards(hole),
    board: [],
    preflopRaises: 3,
    action: 'call',
    toCall,
    stack,
    pot,
    hiLo: false,
    multiBoard: false,
    bombPot: false,
    tournament: false,
    allInOrFold: false,
  });
  it('the price bound: all in, or no more behind than the call, and paying against aces', () => {
    // recorded: 130 to call, 350.4 behind, pot 431: 220.4 left after the call
    expect(omahaColdFourBetCell(input('7c4c8hQhQs', 350.4, 130, 431))!.fold).toBe(true);
    // the same hand, the call is the stack: kept on its price against aces
    const allIn = omahaColdFourBetCell(input('7c4c8hQhQs', 130, 130, 431))!;
    expect(allIn.fold).toBe(false);
    expect(allIn.equity!).toBeGreaterThan(allIn.price);
    // exactly the call left behind is still committed; a chip more is not
    expect(omahaColdFourBetCell(input('7c4c8hQhQs', 260, 130, 431))!.fold).toBe(false);
    expect(omahaColdFourBetCell(input('7c4c8hQhQs', 261, 130, 431))!.fold).toBe(true);
    // aces and a premium structure are not this cell's
    expect(omahaColdFourBetCell(input('AcAd8hQh4s', 350.4, 130, 431))).toBeNull();
    expect(omahaColdFourBetCell(input('KcKdQcJd4s', 350.4, 130, 431))).toBeNull();
    // out of scope
    expect(
      omahaColdFourBetCell({ ...input('7c4c8hQhQs', 350.4, 130, 431), hiLo: true })
    ).toBeNull();
    expect(
      omahaColdFourBetCell({ ...input('7c4c8hQhQs', 350.4, 130, 431), tournament: true })
    ).toBeNull();
    expect(omahaColdFourBetCell(input('7c4c8hQhQsJd', 350.4, 130, 431, 'plo6'))).toBeNull();
  });
});

describe('an underpair without a draw facing a flop bet and a call', () => {
  const flop = cards('6cKsTh');
  it('the hand: one pair below the top card, no flush draw, no nut open-ended or wrap draw', () => {
    expect(omahaUnderpairNoDraw(cards('7c4c8hQhQs'), flop)).toBe(true); // recorded: queens, gutshot
    expect(omahaUnderpairNoDraw(cards('Tc4c8h2h3s'), flop)).toBe(true); // middle pair
    expect(omahaUnderpairNoDraw(cards('Kc4c8hQhQs'), flop)).toBe(false); // top pair
    expect(omahaUnderpairNoDraw(cards('AcAd8h4h3s'), flop)).toBe(false); // overpair
    expect(omahaUnderpairNoDraw(cards('Tc6d8h4h3s'), flop)).toBe(false); // two pair
    expect(omahaUnderpairNoDraw(cards('TcTd8h4h3s'), flop)).toBe(false); // set
    expect(omahaUnderpairNoDraw(cards('7c4c8h2h3s'), flop)).toBe(false); // no pair
    expect(omahaUnderpairNoDraw(cards('AcQdJh9h9s'), flop)).toBe(false); // nut wrap
    expect(omahaUnderpairNoDraw(cards('QcQdJh9h3s'), flop)).toBe(true); // seven nut outs only
    expect(omahaUnderpairNoDraw(cards('7c4c8hQhQs'), cards('6hKsTh'))).toBe(false); // flush draw
    expect(omahaUnderpairNoDraw(cards('7c4c8hQhQs'), cards('6cKsKh'))).toBe(false); // paired flop
    expect(omahaUnderpairNoDraw(cards('7c4c8hQhQs'), cards('6cKsTh7s'))).toBe(false); // not a flop
  });
  it('the bet and the call: two live opponents, the call after the last aggression', () => {
    const live = new Set([1, 6]);
    const f = (seat: number, action: string, full = false) => act(seat, action, 'flop', full);
    expect(omahaFlopBetAndCallFaced([f(6, 'bet', true), f(1, 'call')], 4, live)).toBe(true);
    expect(omahaFlopBetAndCallFaced([f(6, 'bet', true)], 4, live)).toBe(false);
    expect(omahaFlopBetAndCallFaced([f(6, 'check'), f(1, 'bet', true)], 4, live)).toBe(false);
    // the caller has since folded to a raise, or was raised over: no call stands
    expect(omahaFlopBetAndCallFaced([f(6, 'bet', true), f(1, 'call')], 4, new Set([6]))).toBe(
      false
    );
    expect(
      omahaFlopBetAndCallFaced([f(6, 'bet', true), f(1, 'call'), f(6, 'raise', true)], 4, live)
    ).toBe(false);
    // hero's own bet, raised and called
    expect(
      omahaFlopBetAndCallFaced([f(4, 'bet', true), f(6, 'raise', true), f(1, 'call')], 4, live)
    ).toBe(true);
    expect(omahaFlopBetAndCallFaced([f(4, 'bet', true), f(6, 'call'), f(1, 'call')], 4, live)).toBe(
      false
    );
  });
  it('the price bound: kept under a tenth of the resulting pot', () => {
    const input = (toCall: number, pot: number) => ({
      variant: 'plo5',
      street: 'flop',
      hole: cards('7c4c8hQhQs'),
      board: flop,
      action: 'call',
      toCall,
      stack: 220.4,
      pot,
      betAndCall: true,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    });
    const recorded = omahaUnderpairFlopCell(input(139, 839))!;
    expect(recorded.fold).toBe(true);
    expect(recorded.price).toBeCloseTo(139 / 978, 6);
    expect(UNDERPAIR_KEEP_PRICE).toBe(0.1);
    expect(omahaUnderpairFlopCell(input(80, 839))!.fold).toBe(false); // 8.7%
    expect(omahaUnderpairFlopCell(input(100, 839))!.fold).toBe(true); // 10.6%
    expect(omahaUnderpairFlopCell({ ...input(139, 839), betAndCall: false })).toBeNull();
    expect(omahaUnderpairFlopCell({ ...input(139, 839), hiLo: true })).toBeNull();
    expect(omahaUnderpairFlopCell({ ...input(139, 839), bombPot: true })).toBeNull();
    expect(omahaUnderpairFlopCell({ ...input(139, 839), tournament: true })).toBeNull();
    expect(omahaUnderpairFlopCell({ ...input(139, 839), street: 'turn' })).toBeNull();
    expect(omahaUnderpairFlopCell({ ...input(139, 839), action: 'fold' })).toBeNull();
  });
});

// ─── the recorded decisions ─────────────────────────────────────────────────

const COLD: HorseDecideOpts = { omahaNoCallColdFourBetWithoutPremium: true };
const FLOP: HorseDecideOpts = { omahaUnderpairNoMultiwayFlopContinue: true };
const BOTH: HorseDecideOpts = { ...COLD, ...FLOP };

describe('omahaNoCallColdFourBetWithoutPremium on the recorded cold 4-bet (decision 13)', () => {
  it('today continues with every seed (the spot is live)', () => {
    expect(continues(playMany(13, {}))).toBe(SEEDS.length);
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = playMany(13, {});
    for (const opts of [
      { omahaNoCallColdFourBetWithoutPremium: false },
      { omahaNoCallColdFourBetWithoutPremium: 1 as unknown as boolean },
    ])
      expect(playMany(13, opts).bytes).toEqual(unset.bytes);
  });

  it('on: the continue folds, with the receipt, drawing nothing from the random stream', () => {
    const off = playMany(13, {});
    const on = playMany(13, COLD);
    expect(folds(on)).toBe(SEEDS.length);
    expect(hasFire(on, 'omaha_no_call_cold_four_bet_without_premium')).toBe(SEEDS.length);
    expect(on.next).toEqual(off.next);
    // the Horse's own judged VPIP at the table's floor: today calls, the option folds
    const own = (pn: ComplaintPublicNode) => {
      pn.ownVpip = { hands: 30, vpip: 55 };
    };
    expect(playMany(13, {}, { node: own }).actions).toEqual(SEEDS.map(() => 'call'));
    expect(folds(playMany(13, COLD, { node: own }))).toBe(SEEDS.length);
  });

  it('aces and a premium structure keep today’s decision', () => {
    for (const hole of ['7c4cAhQhAs', 'KcKdQcJd4s', 'JcTc9d8d4s']) {
      const off = playMany(13, {}, { hole });
      const on = playMany(13, COLD, { hole });
      expect(on.bytes).toEqual(off.bytes);
      expect(hasFire(on, 'omaha_no_call_cold_four_bet_without_premium')).toBe(0);
    }
  });

  it('the opener’s own 4-bet (not cold) keeps today’s decision', () => {
    // The 4-bet comes from the opener in seat 1 instead of the big blind.
    const openerFourBets = (fx: ComplaintFixture) => {
      const fourBet = fx.actions.find((a) => a.ord === 9)!;
      fourBet.seat = 1;
      const call = fx.actions.find((a) => a.ord === 10)!;
      call.seat = 6;
    };
    const off = playMany(13, {}, { actions: openerFourBets });
    const on = playMany(13, COLD, { actions: openerFourBets });
    expect(continues(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
  });

  it('a call that is the stack is priced against aces and kept', () => {
    const short = (pn: ComplaintPublicNode) => {
      const hero = pn.seats.find((s) => s[0] === 4)!;
      hero[1] = 130;
      pn.maxRaiseTo = 180;
      pn.minRaiseTo = null;
      pn.legalActions = ['fold', 'call', 'all_in'];
    };
    const off = playMany(13, {}, { node: short });
    const on = playMany(13, COLD, { node: short });
    expect(continues(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
    expect(hasFire(on, 'omaha_no_call_cold_four_bet_without_premium_priced_in')).toBe(
      continues(off)
    );
  });

  it('PLO4 gets the rule; Hi-Lo does not', () => {
    const plo4 = { hole: '7c4cQhQs', variant: 'plo4' as const };
    const off4 = playMany(13, {}, plo4);
    const on4 = playMany(13, COLD, plo4);
    expect(folds(on4)).toBe(SEEDS.length);
    expect(hasFire(on4, 'omaha_no_call_cold_four_bet_without_premium')).toBe(continues(off4));
    const plo8 = { hole: '7c4cQhQs', variant: 'plo8' as const };
    expect(playMany(13, COLD, plo8).bytes).toEqual(playMany(13, {}, plo8).bytes);
  });

  it('the fold is admitted by the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = spot(13);
      const d = structuredClone(
        HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...COLD })
      );
      expect(d.action).toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });
});

describe('omahaUnderpairNoMultiwayFlopContinue on the recorded flop (decision 16)', () => {
  it('today calls with every seed (the spot is live)', () => {
    expect(playMany(16, {}).actions).toEqual(SEEDS.map(() => 'call'));
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = playMany(16, {});
    for (const opts of [
      { omahaUnderpairNoMultiwayFlopContinue: false },
      { omahaUnderpairNoMultiwayFlopContinue: 1 as unknown as boolean },
    ])
      expect(playMany(16, opts).bytes).toEqual(unset.bytes);
  });

  it('on: the call folds, with the receipt, drawing nothing from the random stream', () => {
    const off = playMany(16, {});
    const on = playMany(16, FLOP);
    expect(folds(on)).toBe(SEEDS.length);
    expect(hasFire(on, 'omaha_underpair_no_multiway_flop_continue')).toBe(SEEDS.length);
    expect(on.next).toEqual(off.next);
  });

  it('a set, top pair, an overpair, a flush draw and a nut wrap keep today’s decision', () => {
    for (const hole of ['7c4cTdTcQs', '7c4c8hKhQs', '7c4cAdAc8s', '7c4c8hQhJd', 'AcQdJh9h9s']) {
      const v =
        hole === '7c4c8hQhJd'
          ? {
              hole: '7c4c8hQhQs',
              node: (pn: ComplaintPublicNode) => {
                pn.boards = ['6hKsTh'];
              },
            }
          : { hole };
      const off = playMany(16, {}, v);
      const on = playMany(16, FLOP, v);
      expect([hole, on.bytes]).toEqual([hole, off.bytes]);
      expect(hasFire(on, 'omaha_underpair_no_multiway_flop_continue')).toBe(0);
    }
  });

  it('heads-up on the flop (the caller folded before the flop) is unchanged', () => {
    // The opener folds to the 4-bet instead of calling: the flop is hero against the bettor.
    const headsUp: Variation = {
      actions: (fx) => {
        const call = fx.actions.find((a) => a.ord === 10)!;
        call.action = 'fold';
        call.amount = 0;
        fx.actions = fx.actions.filter((a) => a.ord !== 15);
      },
      node: (pn) => {
        const opener = pn.seats.find((s) => s[0] === 1)!;
        opener[1] = 1417.9;
        opener[2] = 0;
        opener[3] = 9;
        opener[6] = 1;
        pn.pot = 529;
      },
    };
    const off = playMany(16, {}, headsUp);
    const on = playMany(16, FLOP, headsUp);
    expect(continues(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
  });

  it('a small price is kept, with its receipt', () => {
    const cheap = (pn: ComplaintPublicNode) => {
      // The bet and the call are 60 each: 60 to call into 681, 8.1% of the resulting pot.
      for (const s of pn.seats)
        if (s[0] === 1 || s[0] === 6) {
          s[1] += 79;
          s[2] = 60;
          s[3] -= 79;
        }
      pn.pot = 681;
      pn.toCall = 60;
      pn.currentBet = 60;
    };
    const lower = (fx: ComplaintFixture) => {
      for (const a of fx.actions) if (a.ord === 14 || a.ord === 15) a.amount = 60;
    };
    const off = playMany(16, {}, { node: cheap, actions: lower });
    const on = playMany(16, FLOP, { node: cheap, actions: lower });
    expect(continues(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
    expect(hasFire(on, 'omaha_underpair_no_multiway_flop_continue_priced_in')).toBe(continues(off));
  });

  it('PLO4 gets the rule; Hi-Lo does not', () => {
    const plo4 = { hole: '7c8hQhQs', variant: 'plo4' as const };
    const off4 = playMany(16, {}, plo4);
    const on4 = playMany(16, FLOP, plo4);
    expect(continues(on4)).toBe(0);
    expect(hasFire(on4, 'omaha_underpair_no_multiway_flop_continue')).toBe(continues(off4));
    const plo8 = { hole: '7c8hQhQs', variant: 'plo8' as const };
    expect(playMany(16, FLOP, plo8).bytes).toEqual(playMany(16, {}, plo8).bytes);
  });

  it('the fold is admitted by the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = spot(16);
      const d = structuredClone(
        HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...FLOP })
      );
      expect(d.action).toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });
});

describe('the other recorded decisions', () => {
  it('the re-raise (7) and the priced turn all-in (19) are unchanged with both options on', () => {
    for (const ord of [7, 19]) {
      const off = playMany(ord, {});
      const on = playMany(ord, BOTH);
      expect(on.bytes).toEqual(off.bytes);
      expect(on.next).toEqual(off.next);
    }
  });

  it('each option leaves the other’s node alone', () => {
    expect(playMany(13, FLOP).bytes).toEqual(playMany(13, {}).bytes);
    expect(playMany(16, COLD).bytes).toEqual(playMany(16, {}).bytes);
  });
});

// ─── in the league (anonymised seats) ───────────────────────────────────────

describe('in the league', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `underpair_off_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: {},
          b: {
            omahaNoCallColdFourBetWithoutPremium: false,
            omahaUnderpairNoMultiwayFlopContinue: false,
          },
        },
        60,
        4610001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on: no illegal action and no fallback', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `underpair_on_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: {
            omahaNoCallColdFourBetWithoutPremium: true,
            omahaUnderpairNoMultiwayFlopContinue: true,
          },
          b: {},
        },
        60,
        4620001
      );
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 300_000);
});
