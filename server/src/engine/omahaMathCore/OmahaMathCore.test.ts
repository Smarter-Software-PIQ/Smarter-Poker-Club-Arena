/**
 * omahaMathCore law tests (lane MATHCORE 2026-11-19). Hand references are
 * hand numbers only; the recorded spots are the existing flop fixtures
 * (HorseOmahaFlopFacingBetEv.test-support.ts, the Horse's own cards).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../../types.js';
import { evaluateOmahaHand, compareHands } from '../PokerEngine.js';
import { HorseLogic, type HorseDecideOpts } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import { replayProfiles, stateAt } from '../HorseComplaintReplay.js';
import {
  horseDecisionReceiptRefusal,
  omahaMathCoreAdmits,
  omahaMathCoreGate,
} from '../horseDecision/responseValidation.js';
import {
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
} from '../HorseOmahaFlopFacingBetEv.test-support.js';
import { omahaBest, parseCardString } from './OmahaMathCoreEval.js';
import { seededRng } from './OmahaMathCoreEquity.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';
import { omahaMathCoreRule, omahaMathCoreState } from './OmahaMathCoreRule.js';
import {
  OMAHA_MATH_CORE_ALLOWED_PROVENANCE,
  OMAHA_MATH_CORE_TABLES,
} from './OmahaMathCoreTables.js';
import publicTables from './publicTables.v3.json' with { type: 'json' };

const now = () => performance.now();
const DECK: Card[] = Array.from({ length: 52 }, (_, i) => ({
  rank: '23456789TJQKA'[i >> 2] as Card['rank'],
  suit: (['clubs', 'diamonds', 'hearts', 'spades'] as const)[i & 3],
}));
const LIVE = replayProfiles('cash').find((p) => p.live)!;

function spot(
  input: Omit<Partial<CoreState>, 'hole' | 'board'> & { hole: string; board: string }
): CoreState {
  const { hole, board, ...p } = input;
  const toCall = p.toCall ?? 0;
  const pot = p.pot ?? 100;
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street: p.street ?? 'flop',
    pot,
    toCall,
    heroBet: 0,
    heroStack: p.heroStack ?? 1000,
    currentBet: toCall,
    minRaiseTo: toCall > 0 ? toCall * 2 : 2,
    maxRaiseTo: toCall > 0 ? toCall + pot + toCall : pot,
    bigBlind: 2,
    legal: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    heroSeat: 5,
    heroPosition: 'BTN',
    ip: true,
    opponents: [
      {
        seat: 2,
        user: 'u2',
        person: true,
        stack: 1000,
        bet: toCall,
        folded: false,
        allIn: false,
        streetAction: toCall > 0 ? 'wager' : 'check',
        calledPrevStreet: false,
        prevAggressor: false,
        position: 'BB',
        preflopLevel: 'call',
      },
    ],
    aggressorSeat: toCall > 0 ? 2 : null,
    line: toCall > 0 ? 'stab' : null,
    band: toCall > 0 ? 'pot' : null,
    wagerFrac: toCall > 0 ? toCall / (pot - toCall) : 0,
    heroWagerLine: toCall > 0 ? 'raise' : 'stab',
    preflopRaises: 0,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: `${hole}|${board}|${pot}|${toCall}`,
    ...p,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as CoreState;
}

describe('omahaMathCore evaluator', () => {
  it('ranks exactly like PokerEngine.evaluateOmahaHand (2 hole + 3 board) on 1,500 random pairs', () => {
    const rng = seededRng('eval-law');
    for (let it = 0; it < 1500; it++) {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      const hc = it % 2 ? 5 : 4;
      for (let i = 0; i < 2 * hc + 5; i++) {
        const j = i + Math.floor(rng() * (52 - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const a = deck.slice(0, hc),
        b = deck.slice(hc, 2 * hc),
        board = deck.slice(2 * hc, 2 * hc + 5);
      const mine = Math.sign(omahaBest(a, hc, board, 5) - omahaBest(b, hc, board, 5));
      const ref = Math.sign(
        compareHands(
          evaluateOmahaHand(
            a.map((c) => DECK[c]),
            board.map((c) => DECK[c])
          ),
          evaluateOmahaHand(
            b.map((c) => DECK[c]),
            board.map((c) => DECK[c])
          )
        )
      );
      expect(mine).toBe(ref);
    }
  });
});

describe('omahaMathCore decision laws', () => {
  const facing = [
    spot({ hole: 'AhKhQs7d2c', board: 'Jh8s2s', pot: 189, toCall: 81 }),
    spot({ hole: '9h8h7c6d', board: 'Th5s2c', pot: 200, toCall: 100 }),
    spot({ hole: 'AsKs9c8d', board: 'Th5s2cQd3h', street: 'river', pot: 300, toCall: 100 }),
    spot({ hole: 'QsJsTh9h', board: 'KsQh2d', pot: 120, toCall: 60 }),
    spot({ hole: 'AdAcKs7h', board: 'Ah9c4d', pot: 150, toCall: 50 }),
  ];
  it('the choice is the largest EV of the legal actions priced (argmax law)', () => {
    for (const s of facing) {
      const { receipt } = decideOmahaMathCore(s, { now });
      const best = Math.max(...receipt.evs.map((e) => e.ev));
      expect(receipt.choice.ev).toBe(best);
      for (const e of receipt.evs)
        expect(s.legal.includes(e.action) || e.action === 'bet').toBe(true);
    }
  });
  it('never folds when the call is worth more than nothing by more than its sampling error', () => {
    for (const s of facing) {
      const { receipt } = decideOmahaMathCore(s, { now });
      const call = receipt.evs.find(
        (e) => e.action === 'call' || (e.action === 'all_in' && e.adds === receipt.toCall)
      );
      if (call && call.se !== null && call.ev > call.se * (receipt.pot + receipt.toCall))
        expect(receipt.choice.action).not.toBe('fold');
    }
  });
  it('a set of aces facing a flop bet never folds; the strongest made hand gets chips in', () => {
    const { receipt } = decideOmahaMathCore(facing[4], { now });
    expect(receipt.choice.action).not.toBe('fold');
  });
  it('preflop: aces double-suited facing a raise put chips in (raise or all-in) when EV says so; never fold', () => {
    const s = spot({
      hole: 'AhAsKhQs',
      board: '',
      street: 'preflop',
      pot: 21,
      toCall: 14,
      heroStack: 200,
      line: null,
      band: null,
      heroWagerLine: 'raise',
      preflopRaises: 1,
      opponents: [
        {
          seat: 2,
          user: 'u2',
          person: true,
          stack: 200,
          bet: 14,
          folded: false,
          allIn: false,
          streetAction: 'wager',
          calledPrevStreet: false,
          prevAggressor: false,
          position: 'CO',
          preflopLevel: 'open',
        },
      ],
    });
    const { receipt } = decideOmahaMathCore(s, { now });
    expect(receipt.choice.action).not.toBe('fold');
    const raiseEv = Math.max(
      ...receipt.evs.filter((e) => e.action === 'raise' || e.action === 'all_in').map((e) => e.ev)
    );
    const callEv = receipt.evs.find((e) => e.action === 'call')!.ev;
    if (raiseEv > callEv) expect(['raise', 'all_in']).toContain(receipt.choice.action);
  });
  it('#60156608 type: a 5-bet is chosen only when its EV beats the call (the call stands otherwise)', () => {
    const s = spot({
      hole: 'AhKdQcQs',
      board: '',
      street: 'preflop',
      pot: 150,
      toCall: 80,
      heroStack: 600,
      line: null,
      band: null,
      heroWagerLine: 'raise',
      preflopRaises: 4,
      opponents: [
        {
          seat: 2,
          user: 'u2',
          person: true,
          stack: 520,
          bet: 110,
          folded: false,
          allIn: false,
          streetAction: 'wager',
          calledPrevStreet: false,
          prevAggressor: false,
          position: 'BTN',
          preflopLevel: '4bet',
        },
      ],
    });
    const { receipt } = decideOmahaMathCore(s, { now });
    const callEv = receipt.evs.find((e) => e.action === 'call')!.ev;
    const raises = receipt.evs.filter((e) => e.action === 'raise' || e.action === 'all_in');
    if (['raise', 'all_in'].includes(receipt.choice.action))
      for (const r of raises) expect(receipt.choice.ev).toBeGreaterThanOrEqual(callEv);
    if (raises.every((r) => r.ev < callEv))
      expect(receipt.choice.action).not.toMatch(/raise|all_in/);
  });
  it('is deterministic for the same request', () => {
    const a = decideOmahaMathCore(facing[0], { now }).receipt;
    const b = decideOmahaMathCore(facing[0], { now }).receipt;
    expect(a.choice).toEqual(b.choice);
    expect(a.evs.map((e) => e.ev)).toEqual(b.evs.map((e) => e.ev));
  });
  it('stays inside the decision budget (2 s minimum deadline) on a multiway turn spot', () => {
    const s = spot({
      hole: 'AhKhQs7d2c',
      board: 'Jh8s2s4c',
      street: 'turn',
      pot: 300,
      toCall: 100,
    });
    s.opponents.push({
      seat: 3,
      user: 'h3',
      person: false,
      stack: 900,
      bet: 100,
      folded: false,
      allIn: false,
      streetAction: 'call',
      calledPrevStreet: true,
      prevAggressor: false,
      position: 'CO',
      preflopLevel: 'call',
    });
    s.opponents.push({
      seat: 4,
      user: 'h4',
      person: false,
      stack: 900,
      bet: 0,
      folded: false,
      allIn: false,
      streetAction: 'none',
      calledPrevStreet: false,
      prevAggressor: false,
      position: 'BTN',
      preflopLevel: 'call',
    });
    const t = now();
    decideOmahaMathCore(s, { now });
    expect(now() - t).toBeLessThan(2000);
  });
});

describe('omahaMathCore tables: public information only (lead ruling 2026-11-19)', () => {
  it('every table the core loads has provenance public_actions or showdown_only', () => {
    expect(OMAHA_MATH_CORE_TABLES.length).toBeGreaterThan(0);
    for (const t of OMAHA_MATH_CORE_TABLES)
      expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(t.provenance)).toBe(true);
  });
  it('every cell of the shipped table names its provenance, and each is public_actions or showdown_only', () => {
    let cells = 0;
    for (const section of Object.values(publicTables as Record<string, unknown>)) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
      for (const cell of Object.values(section as Record<string, unknown>)) {
        if (
          !cell ||
          typeof cell !== 'object' ||
          !('n' in (cell as object) || 'hands' in (cell as object) || 'betRate' in (cell as object))
        )
          continue;
        cells++;
        expect(
          OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(
            String((cell as { provenance?: unknown }).provenance)
          )
        ).toBe(true);
      }
    }
    expect(cells).toBeGreaterThan(1000);
  });
});

describe('omahaMathCore wiring: final owner, admitted, OFF byte-identical (recorded flop spots)', () => {
  const recs = RECORDED_FLOP_FACING_BETS.slice(0, 12);
  const decide = (r: (typeof recs)[number], opts: HorseDecideOpts) => {
    HorseMind.reset();
    seedFastRandom(1);
    const { fx, node } = expandFlop(r);
    const st = stateAt(fx, node);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...opts,
    } as never);
    return { d, st };
  };
  it('OFF: the option absent and false give byte-identical decisions', () => {
    for (const r of recs.slice(0, 6)) {
      const a = decide(r, {}).d;
      const b = decide(r, { omahaMathCore: false } as HorseDecideOpts).d;
      expect(a.action).toBe(b.action);
      expect(a.amount).toBe(b.amount);
      expect(a.omahaMathCore).toBeUndefined();
      expect(b.omahaMathCore).toBeUndefined();
    }
  });
  it(`ON: on every recorded flop spot (hands ${recs.map((r) => r.n).join(', ')}) the final action is the core's choice and the validator admits it`, () => {
    for (const r of recs) {
      const { d, st } = decide(r, { omahaMathCore: true } as HorseDecideOpts);
      const rec = d.omahaMathCore!;
      expect(rec).toBeDefined();
      expect(rec.error).toBeNull();
      expect(rec.applied).toBe(true);
      expect(d.action).toBe(rec.action);
      expect(d.amount ?? null).toBe(rec.amount);
      expect(d.policyGraph?.finalAction.action).toBe(rec.action);
      const refusal = horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        player: st.hero,
        gameState: st.gs,
        omahaMathCore: true,
      });
      expect(refusal).toBeNull();
    }
  });
  it('the admission needs the gate: a changed wager_rules action without it is not admitted by the core admission', () => {
    for (const r of recs) {
      const { d, st } = decide(r, { omahaMathCore: true } as HorseDecideOpts);
      const after = { action: d.action, amount: d.amount ?? null };
      expect(
        omahaMathCoreAdmits(d as never, after as never, 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBe(false);
      expect(
        omahaMathCoreAdmits(d as never, after as never, 'plo5', {
          player: st.hero,
          gameState: st.gs,
          omahaMathCore: true,
        })
      ).toBe(true);
      // a receipt naming another action is never admitted
      const other = { action: after.action === 'fold' ? 'call' : 'fold', amount: null };
      expect(
        omahaMathCoreAdmits(d as never, other as never, 'plo5', {
          player: st.hero,
          gameState: st.gs,
          omahaMathCore: true,
        })
      ).toBe(false);
    }
  });
  it('gate: the request option, the delivered switch row or the previous row', () => {
    expect(omahaMathCoreGate({ omahaMathCore: true }, null)).toBe(true);
    expect(omahaMathCoreGate({}, null)).toBe(false);
    expect(omahaMathCoreGate(undefined, undefined)).toBe(false);
  });
  it('an exception keeps the incoming decision with an error receipt (never a fold it did not choose)', () => {
    const r = recs[0];
    const { fx, node } = expandFlop(r);
    const st = stateAt(fx, node);
    const incoming = { action: 'call' as const, amount: 10, thinkTime: 1 };
    const out = omahaMathCoreRule(incoming, st.hero, st.gs, { omahaMathCore: true }, () => {
      throw new Error('boom');
    });
    expect(out.action).toBe('call');
    expect(out.omahaMathCore?.applied).toBe(false);
    expect(out.omahaMathCore?.error).toContain('boom');
  });
  it('PLO6 (owner 8:26 PM: never touched): every recorded spot as PLO6 decides byte-identically with the option on', () => {
    for (const r of recs.slice(0, 8)) {
      const run = (opts: HorseDecideOpts) => {
        HorseMind.reset();
        seedFastRandom(1);
        const used = new Set((r.hole + r.board).match(/../g));
        const extra = ['2c', '2d', '3c', '3d', '4c', '4d', '5c', '5d'].filter((c) => !used.has(c));
        const hole = (r.hole + extra.join('')).slice(0, 12);
        const { fx, node } = expandFlop(r, { variant: 'plo6', hole });
        const st = stateAt(fx, node);
        return HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          observeMind: false,
          ...opts,
        } as never);
      };
      const off = run({});
      const on = run({ omahaMathCore: true } as HorseDecideOpts);
      expect(on.omahaMathCore).toBeUndefined();
      expect(on.action).toBe(off.action);
      expect(on.amount).toBe(off.amount);
      expect(JSON.stringify(on.policyGraph?.finalAction)).toBe(
        JSON.stringify(off.policyGraph?.finalAction)
      );
    }
  });
  it('out of scope (tournament, PLO6) the rule returns the decision unchanged', () => {
    const r = recs[0];
    for (const edit of [{ mode: 'tournament' as const }, { variant: 'plo6' as const }]) {
      const { fx, node } = expandFlop(r, edit);
      const st = stateAt(fx, node);
      const incoming = { action: 'fold' as const, thinkTime: 1 };
      expect(omahaMathCoreRule(incoming, st.hero, st.gs, { omahaMathCore: true }, (d) => d)).toBe(
        incoming
      );
    }
  });
  it('the state the core reads is built from the request only', () => {
    const r = recs[0];
    const { fx, node } = expandFlop(r);
    const st = stateAt(fx, node);
    const s = omahaMathCoreState(st.hero, st.gs);
    expect(s.street).toBe('flop');
    expect(s.toCall).toBeGreaterThan(0);
    expect(s.aggressorSeat).not.toBeNull();
  });
});
