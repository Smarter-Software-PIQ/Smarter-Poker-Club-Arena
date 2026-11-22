import { readFileSync } from 'node:fs';
/**
 * omahaMathCore law tests (lane MATHCORE 2026-11-19). Hand references are
 * hand numbers only; the recorded spots are the existing flop fixtures
 * (HorseOmahaFlopFacingBetEv.test-support.ts, the Horse's own cards).
 */
import { selectionScore } from './OmahaMathCoreWire.js';
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
import {
  applyRealizationCalibration,
  decideOmahaMathCore,
  OMAHA_MATH_CORE_REALIZATION_CALIBRATION,
  OMAHA_MATH_CORE_WORK_BUDGET,
  realizationCalibrationCell,
  cbetRaiseShare,
  OMAHA_MATH_CORE_CBET_RAISE_READ,
  type CoreState,
} from './OmahaMathCore.js';
import { omahaMathCoreRule, omahaMathCoreState } from './OmahaMathCoreRule.js';
import {
  OMAHA_MATH_CORE_ALLOWED_PROVENANCE,
  OMAHA_MATH_CORE_TABLES,
} from './OmahaMathCoreTables.js';
import {
  OMAHA_MATH_CORE_ALL_STREETS,
  OMAHA_MATH_CORE_CHANGE_MARGIN_K,
  OMAHA_MATH_CORE_RAISE_OVER_CALL_MARGIN_K,
  omahaMathCoreChangeMarginK,
  omahaMathCoreRiverAllInCommitOk,
  omahaMathCorePlo5RiverFoldToCall,
  OMAHA_MATH_CORE_RIVER_ALLIN_COMMIT_MARGIN_K,
  omahaMathCoreFoldBoundaryRawOk,
  omahaMathCoreStreetAdmitted,
} from './OmahaMathCoreRule.js';

// Read at run time, not imported: a 4.6 MB JSON import makes tsc type the whole literal and
// pushes the server compile past the default 4 GB heap (CI native-smoke OOM on #11515).
const publicTables: unknown = JSON.parse(
  readFileSync(new URL('./publicTables.v4-pooled.json', import.meta.url), 'utf8')
);
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
  it('the choice is the largest lower confidence bound (EV - SE) of the legal actions priced (argmax law)', () => {
    // COREWIRE (PROVE-2 winner's curse): ranked by EV minus its own standard error
    for (const s of facing) {
      const { receipt } = decideOmahaMathCore(s, { now });
      const best = Math.max(...receipt.evs.map((e) => selectionScore(e)));
      const chosen = receipt.evs.find(
        (e) => e.action === receipt.choice.action && e.amount === receipt.choice.amount
      )!;
      expect(selectionScore(chosen)).toBeCloseTo(best, 1);
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

describe('omahaMathCore self-play and split switch', () => {
  it('every responder is priced on the one pooled measured cell (no person/Horse key in any fold source)', () => {
    const st = spot({ hole: 'AhKhQs7d2c', board: 'Jh8s2s', pot: 100, toCall: 0 });
    const { receipt } = decideOmahaMathCore(st, { now });
    const bets = receipt.evs.filter((x) => x.action === 'bet');
    expect(bets.length).toBeGreaterThan(0);
    for (const e of bets) {
      expect(e.foldSource).not.toMatch(
        /\|person\b|\|horse\b|vs_horse|vs_person|horse_present|persons_only|self-consistent Horse/
      );
    }
  });
  it('preflop with omahaMathCorePreflop off: the core computes and receipts (shadow) and the decision stands', () => {
    const r = RECORDED_FLOP_FACING_BETS[0];
    const { fx, node } = expandFlop(r);
    const st = stateAt(fx, node);
    const gs = { ...st.gs, stage: 'preflop' as const, communityCards: [] };
    const incoming = { action: 'fold' as const, thinkTime: 1 };
    const out = omahaMathCoreRule(
      incoming,
      st.hero,
      gs as never,
      { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
      (d) => d
    );
    expect(out.action).toBe('fold');
    if (out.omahaMathCore) {
      expect(out.omahaMathCore.applied).toBe(false);
      if (out.omahaMathCore.error === null) expect(out.omahaMathCore.shadow).toBe(true);
    }
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
      const { d, st } = decide(r, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
      } as HorseDecideOpts);
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
        ...OMAHA_MATH_CORE_ALL_STREETS,
      });
      expect(refusal).toBeNull();
    }
  });
  it('the admission needs the gate: a changed wager_rules action without it is not admitted by the core admission', () => {
    for (const r of recs) {
      const { d, st } = decide(r, {
        omahaMathCore: true,
        ...OMAHA_MATH_CORE_ALL_STREETS,
      } as HorseDecideOpts);
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
          ...OMAHA_MATH_CORE_ALL_STREETS,
        })
      ).toBe(true);
      // a receipt naming another action is never admitted
      const other = { action: after.action === 'fold' ? 'call' : 'fold', amount: null };
      expect(
        omahaMathCoreAdmits(d as never, other as never, 'plo5', {
          player: st.hero,
          gameState: st.gs,
          omahaMathCore: true,
          ...OMAHA_MATH_CORE_ALL_STREETS,
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
    const out = omahaMathCoreRule(
      incoming,
      st.hero,
      st.gs,
      { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
      () => {
        throw new Error('boom');
      }
    );
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
      const on = run({ omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS } as HorseDecideOpts);
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
      expect(
        omahaMathCoreRule(
          incoming,
          st.hero,
          st.gs,
          { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
          (d) => d
        )
      ).toBe(incoming);
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

describe('omahaMathCore equity terminates without the clock (frozen replay clock)', () => {
  it('returns with a frozen clock even when no joint draw can succeed', async () => {
    const { equityVsPools, buildPool, seededRng: rng } = await import('./OmahaMathCoreEquity.js');
    const hero = parseCardString('AhKhQs7d2c');
    const board = parseCardString('Jh8s2s4c9d');
    const pool = buildPool(hero, board, 5, 40, 1, rng('frozen'));
    const one = {
      parts: [{ idx: Int32Array.from([pool.order[0]]), weight: 1 }],
      label: 'one holding',
    };
    // two seats that must hold the same single holding: every joint draw collides
    const r = equityVsPools(hero, board, pool, [one, one], rng('x'), {
      targetSe: 0.01,
      minSamples: 400,
      maxSamples: 4000,
      now: () => 0,
    });
    expect(Number.isNaN(r.equity)).toBe(true);
    const s = equityVsPools(hero, board, pool, [one], rng('y'), {
      targetSe: 0.01,
      minSamples: 400,
      maxSamples: 4000,
      now: () => 0,
    });
    expect(Number.isFinite(s.equity)).toBe(true);
  });
});

describe('omahaMathCore per-street admission (lead 10:55 PM, lane COREWIRE-2) and prove-it-to-change-it', () => {
  const recs = RECORDED_FLOP_FACING_BETS.slice(0, 12);
  it('admits a street only by its own game x street flag; default all OFF; PLO6 never', () => {
    const none = { omahaMathCore: true };
    for (const v of ['plo4', 'plo5'])
      for (const s of ['flop', 'turn', 'river'])
        expect(omahaMathCoreStreetAdmitted(v, s, none)).toBe(false);
    const river5 = { omahaMathCore: true, omahaMathCorePlo5River: true };
    expect(omahaMathCoreStreetAdmitted('plo5', 'river', river5)).toBe(true);
    expect(omahaMathCoreStreetAdmitted('plo5', 'turn', river5)).toBe(false);
    expect(omahaMathCoreStreetAdmitted('plo4', 'river', river5)).toBe(false);
    expect(
      omahaMathCoreStreetAdmitted('plo6', 'river', { ...river5, ...OMAHA_MATH_CORE_ALL_STREETS })
    ).toBe(false);
    expect(omahaMathCoreStreetAdmitted('plo5', 'preflop', OMAHA_MATH_CORE_ALL_STREETS)).toBe(false);
  });
  it('a street that is not admitted is not the core decision: the core does no work there (same object back, no receipt, no legalizer call, no clock read)', () => {
    // lane CORE-POOLED-2 latency (lead order Nov 21; VERIFIER V60): replaces the COREWIRE-2 shadow receipt
    for (const r of recs.slice(0, 6)) {
      const { fx, node } = expandFlop(r);
      const st = stateAt(fx, node);
      const incoming = { action: 'fold' as const, thinkTime: 1 };
      let legalized = 0;
      let clockReads = 0;
      const out = omahaMathCoreRule(
        incoming,
        st.hero,
        st.gs,
        { omahaMathCore: true, omahaMathCorePlo5Turn: true, omahaMathCorePlo4Turn: true },
        (d) => {
          legalized++;
          return d;
        },
        () => {
          clockReads++;
          return 0;
        }
      );
      expect(out).toBe(incoming);
      expect(out.omahaMathCore).toBeUndefined();
      expect(legalized).toBe(0);
      expect(clockReads).toBe(0);
    }
  });
  it('core off: the realization placement changes nothing (same decision object back, no receipt) on every recorded PLO5 flop state', () => {
    let n = 0;
    for (const r of recs) {
      const { fx, node } = expandFlop(r);
      const st = stateAt(fx, node);
      for (const incoming of [
        { action: 'fold' as const, thinkTime: 1 },
        { action: 'call' as const, amount: 1, thinkTime: 1 },
      ]) {
        for (const opts of [{}, { omahaMathCore: false, ...OMAHA_MATH_CORE_ALL_STREETS }]) {
          const out = omahaMathCoreRule(incoming, st.hero, st.gs, opts, (d) => d);
          expect(out).toBe(incoming);
          expect(out.omahaMathCore).toBeUndefined();
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('the core changes today action only when its best beats it by more than k standard errors; else the receipt says kept and executes today action', () => {
    expect(OMAHA_MATH_CORE_CHANGE_MARGIN_K).not.toBeNull();
    let kept = 0;
    let changed = 0;
    for (const r of recs) {
      const { fx, node } = expandFlop(r);
      const st = stateAt(fx, node);
      const incoming = { action: 'fold' as const, thinkTime: 1 };
      const out = omahaMathCoreRule(
        incoming,
        st.hero,
        st.gs,
        { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
        (d) => d
      );
      const rc = out.omahaMathCore!;
      expect(rc.applied).toBe(true);
      // the executed action is the receipt's, always
      expect(out.action).toBe(rc.action);
      const k = rc.core!.kept;
      if (k) {
        kept++;
        expect(out.action).toBe('fold');
        // kept because the calibrated gap is within k SE, or (a change across the fold boundary) because the raw,
        // uncalibrated gap is (a factor above 1 can lift a calibrated price over the bar: CORE-POOLED-4 raise 1.034)
        const bestE = rc.core!.evs.find(
          (e) => `${e.action}${e.amount !== null ? ' ' + e.amount : ''}` === k.best
        )!;
        const foldE = rc.core!.evs.find((e) => e.action === 'fold')!;
        const K = OMAHA_MATH_CORE_CHANGE_MARGIN_K as number;
        expect(
          k.gap <= K * k.se + 0.01 ||
            !omahaMathCoreFoldBoundaryRawOk(bestE as never, foldE as never, 'fold', bestE.action, K)
        ).toBe(true);
      } else if (out.action !== 'fold') {
        changed++;
        const best = rc.core!.evs.find((e) => e.action === out.action)!;
        const fold = rc.core!.evs.find((e) => e.action === 'fold')!;
        const se = Math.hypot(best.se ?? 0, fold.se ?? 0);
        expect(best.ev - fold.ev).toBeGreaterThan(
          (OMAHA_MATH_CORE_CHANGE_MARGIN_K as number) * se - 1e-9
        );
      }
    }
    expect(kept + changed).toBeGreaterThan(0);
  });
});

describe('omahaMathCore class margin (CORE-3 criterion 1: call -> raise below all-in graded +326 +- 104 bb on Nov 18)', () => {
  it('in PLO5 a raise instead of a call needs k = 2 standard errors; PLO4, call -> all-in and every other change keep k = 5', () => {
    expect(OMAHA_MATH_CORE_RAISE_OVER_CALL_MARGIN_K).toBe(2);
    expect(omahaMathCoreChangeMarginK('call', 'raise', 'plo5')).toBe(2);
    expect(omahaMathCoreChangeMarginK('call', 'raise', 'plo4')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('call', 'raise', 'plo6')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('call', 'all_in', 'plo5')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('fold', 'raise', 'plo5')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('fold', 'call', 'plo5')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('check', 'bet', 'plo5')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
    expect(omahaMathCoreChangeMarginK('raise', 'call', 'plo5')).toBe(
      OMAHA_MATH_CORE_CHANGE_MARGIN_K
    );
  });
  it('facing a bet with call as today action, a kept call states k = 2 and a change to raise beats call by more than 2 SE', () => {
    let seen = 0;
    for (const r of RECORDED_FLOP_FACING_BETS.slice(0, 12)) {
      const { fx, node } = expandFlop(r);
      const st = stateAt(fx, node);
      const incoming = { action: 'call' as const, thinkTime: 1 };
      const out = omahaMathCoreRule(
        incoming,
        st.hero,
        st.gs,
        { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS },
        (d) => d
      );
      const rc = out.omahaMathCore!;
      if (!rc.applied) continue;
      seen++;
      const k = rc.core!.kept;
      if (k && k.best.startsWith('raise'))
        expect(k.k).toBe(
          String(st.gs.gameVariant).toLowerCase() === 'plo5' ? 2 : OMAHA_MATH_CORE_CHANGE_MARGIN_K
        );
      if (!k && out.action === 'raise') {
        const best = rc.core!.evs.find(
          (e) => e.action === 'raise' && Math.abs((e.amount ?? 0) - (out.amount ?? 0)) <= 0.011
        )!;
        const call = rc.core!.evs.find((e) => e.action === 'call')!;
        expect(best.ev - call.ev).toBeGreaterThan(
          2 * Math.hypot(best.se ?? 0, call.se ?? 0) - 1e-9
        );
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('omahaMathCore deterministic work budget (COREWIRE-2, gate G6: five-way flops 60166976 took 200-254 ms unboxed)', () => {
  it('a five-way flop under a frozen clock finishes inside the work budget and decides identically twice', () => {
    const opp = (seat: number) => ({
      seat,
      stack: 1000,
      bet: 0,
      folded: false,
      allIn: false,
      streetAction: 'check' as const,
      calledPrevStreet: false,
      prevAggressor: false,
      position: 'BB' as const,
      preflopLevel: 'call' as const,
    });
    const s = spot({
      hole: 'AsKdQh9c8c',
      board: 'Ts7h2d',
      opponents: [1, 2, 3, 4, 6].map(opp) as never,
    });
    const a = decideOmahaMathCore(s, { now: () => 0 }).receipt;
    const b = decideOmahaMathCore(s, { now: () => 0 }).receipt;
    expect(a.choice).toEqual(b.choice);
    // past the budget each call takes at most the 600-draw floor; the core makes a bounded number of calls
    expect(a.samples * 5).toBeLessThan(OMAHA_MATH_CORE_WORK_BUDGET + 60 * 600 * 5);
  });
});

describe('omahaMathCore realization calibration (CORE-4: the core prices only what its lines realise)', () => {
  it('provenance is allowed (population_all_cards_capped since CORE-POOLED-4), every cell is measured (n >= minN) and positive', () => {
    const C = OMAHA_MATH_CORE_REALIZATION_CALIBRATION;
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(C.provenance)).toBe(true);
    for (const [k, c] of Object.entries(C.cells)) {
      expect(c.n, k).toBeGreaterThanOrEqual(C.minN);
      expect(c.r, k).toBeGreaterThan(0);
      expect(k.split('|')[0]).not.toBe('plo6');
    }
  });
  it('fold is never calibrated; PLO6, preflop and the river are never calibrated', () => {
    for (const a of ['fold', 'check', 'call', 'bet', 'raise', 'all_in'])
      for (const st of ['preflop', 'river'])
        expect(realizationCalibrationCell('plo5', st, a)).toBeNull();
    for (const a of ['check', 'call', 'bet', 'raise', 'all_in'])
      for (const st of ['flop', 'turn'])
        expect(realizationCalibrationCell('plo6', st, a)).toBeNull();
    expect(realizationCalibrationCell('plo5', 'flop', 'fold')).toBeNull();
    // criterion 2: the turn failed the cross-validated grade and is not calibrated (PLO4 and PLO5)
    for (const a of ['check', 'call', 'bet', 'raise']) {
      expect(realizationCalibrationCell('plo5', 'turn', a)).toBeNull();
      expect(realizationCalibrationCell('plo4', 'turn', a)).toBeNull();
      // lane CORE-EXTEND (criteria sha e8793e34): PLO4 flop takes ONE population factor for every action
      expect(realizationCalibrationCell('plo4', 'flop', a)?.r).toBe(0.7984);
    }
    expect(realizationCalibrationCell('plo4', 'flop', 'fold')).toBeNull();
  });
  it('a responder own cbet raise share is shrunk n/(n+20) to the pooled share, within [0, 1 - fold]; no record -> pooled (CORE-EXTEND-5)', () => {
    expect(cbetRaiseShare(0.1, 0.5, null)).toBeNull();
    expect(cbetRaiseShare(0.1, 0.5, { opps: 0, raises: 0 })).toBeNull();
    expect(cbetRaiseShare(0.1, 0.5, { opps: 20, raises: 10 })!.r).toBeCloseTo(
      (10 + 20 * 0.1) / 40,
      12
    );
    expect(cbetRaiseShare(0.1, 0.5, { opps: 1000, raises: 1000 })!.r).toBe(0.5);
    expect(cbetRaiseShare(0.1, 0.5, { opps: 1000, raises: 0 })!.r).toBeCloseTo(
      (20 * 0.1) / 1020,
      12
    );
    expect(OMAHA_MATH_CORE_CBET_RAISE_READ.streets).toEqual({ plo4: ['flop'] });
  });
  it('ev = raw - (1 - r) x showdown term (CORE-POOLED-4 placement), se unchanged, the raw price on the receipt; a candidate without a showdown term is left alone', () => {
    const evs = [
      {
        action: 'fold',
        amount: null,
        adds: 0,
        ev: 0,
        equity: null,
        se: 0,
        foldProb: 0,
        foldSource: null,
        range: null,
      },
      {
        action: 'call',
        amount: 10,
        adds: 10,
        ev: 20,
        sd: 24,
        equity: 0.5,
        se: 4,
        foldProb: 0,
        foldSource: null,
        range: null,
      },
      {
        action: 'raise',
        amount: 40,
        adds: 40,
        ev: 7,
        sd: 50,
        equity: 0.5,
        se: 3,
        foldProb: 0.3,
        foldSource: null,
        range: null,
      },
      {
        action: 'call',
        amount: 10,
        adds: 10,
        ev: 5,
        equity: 0.5,
        se: 1,
        foldProb: 0,
        foldSource: null,
        range: null,
      },
    ] as never[];
    applyRealizationCalibration(evs, 'plo5', 'flop');
    const r = realizationCalibrationCell('plo5', 'flop', 'call')!.r;
    const [f, c, ra, bare] = evs as unknown as {
      ev: number;
      se: number;
      calibration?: { raw: number };
    }[];
    expect(f.ev).toBe(0);
    // only the showdown term is scaled: fold equity, the chips added and later streets are not
    expect(c.ev).toBeCloseTo(20 - (1 - r) * 24, 9);
    expect(c.se).toBe(4);
    expect(c.calibration!.raw).toBe(20);
    const rr = realizationCalibrationCell('plo5', 'flop', 'raise')!.r;
    expect(ra.ev).toBeCloseTo(7 - (1 - rr) * 50, 9);
    expect(ra.calibration!.raw).toBe(7);
    expect(bare.ev).toBe(5);
    expect(bare.calibration ?? null).toBeNull();
  });
  it('a factor above 1 never by itself turns a fold into a raise: the raise must beat the fold at its raw price (r = 1)', () => {
    // the guard is about any factor above 1: since the full-window factors (raise 0.8184) no applied cell is above 1,
    // so the law uses the sample-era raise factor as its example; the guard must hold whatever a future fit gives
    const rr = 1.0342;
    expect(rr).toBeGreaterThan(1);
    const fold = { ev: 0, se: 0 };
    // raw -1 (fold equity plus equity as priced loses to the fold); the factor lifts the calibrated price to +9
    const lifted = { ev: -1 + (rr - 1) * 300, se: 0.1, calibration: { raw: -1, rawSe: 0.1 } };
    expect(lifted.ev).toBeGreaterThan(5 * 0.1);
    expect(omahaMathCoreFoldBoundaryRawOk(lifted, fold, 'fold', 'raise', 5)).toBe(false);
    // raw +0.4 with SE 0.1: inside 5 SE at the raw price, still refused whatever the calibrated price says
    expect(
      omahaMathCoreFoldBoundaryRawOk(
        { ev: 12, se: 0.1, calibration: { raw: 0.4, rawSe: 0.1 } },
        fold,
        'fold',
        'raise',
        5
      )
    ).toBe(false);
    // a raise that wins at the raw price passes this test (the calibrated margin is then applied by the rule)
    expect(
      omahaMathCoreFoldBoundaryRawOk(
        { ev: 12, se: 0.1, calibration: { raw: 8, rawSe: 0.1 } },
        fold,
        'fold',
        'raise',
        5
      )
    ).toBe(true);
  });
  it('a PLO5 flop decision carries the calibration on every non-fold candidate; a river decision on none', () => {
    const flop = decideOmahaMathCore(
      spot({ hole: 'AsKdQh9c8c', board: 'Ts7h2d', pot: 60, toCall: 20 }),
      {
        now: () => 0,
      }
    ).receipt;
    for (const e of flop.evs) {
      if (e.action === 'fold') expect(e.calibration ?? null).toBeNull();
      else expect(e.calibration?.r).toBeGreaterThan(0);
    }
    const river = decideOmahaMathCore(
      spot({ hole: 'AsKdQh9c8c', board: 'Ts7h2d3c4s', street: 'river', pot: 60, toCall: 20 }),
      { now: () => 0 }
    ).receipt;
    for (const e of river.evs) expect(e.calibration ?? null).toBeNull();
  });
});

describe('omahaMathCore fold boundary (CORE-4: a calibrated price alone never folds a call nor adds a call)', () => {
  const cal = (ev: number, se: number, raw: number, rawSe: number) => ({
    ev,
    se,
    calibration: { raw, rawSe },
  });
  it('continue -> fold needs the raw price too: a call worth +10 raw is not folded by its calibrated -3', () => {
    const fold = { ev: 0, se: 0 };
    const call = cal(-3, 0.2, 10, 1);
    expect(omahaMathCoreFoldBoundaryRawOk(fold, call, 'call', 'fold', 5)).toBe(false);
    expect(omahaMathCoreFoldBoundaryRawOk(fold, cal(-3, 0.2, -8, 1), 'call', 'fold', 5)).toBe(true);
  });
  it('fold -> call needs the raw price too, and the calibrated test still applies in the rule', () => {
    const fold = { ev: 0, se: 0 };
    expect(omahaMathCoreFoldBoundaryRawOk(cal(4, 0.5, 20, 2), fold, 'fold', 'call', 5)).toBe(true);
    expect(omahaMathCoreFoldBoundaryRawOk(cal(4, 0.5, 2, 2), fold, 'fold', 'call', 5)).toBe(false);
  });
  it('changes between continuing actions are not touched by the raw test', () => {
    expect(
      omahaMathCoreFoldBoundaryRawOk(cal(9, 1, -50, 1), cal(1, 1, 99, 1), 'call', 'raise', 5)
    ).toBe(true);
    expect(
      omahaMathCoreFoldBoundaryRawOk(cal(9, 1, -50, 1), cal(1, 1, 99, 1), 'check', 'bet', 5)
    ).toBe(true);
  });
});

describe('omahaMathCore river all-in commit margin (RIVER-CORE criterion 2: 7 of 7 fold -> all-in river changes met real equity 0)', () => {
  const K = OMAHA_MATH_CORE_RIVER_ALLIN_COMMIT_MARGIN_K;
  it('a PLO5 river fold -> all-in (or a call / raise of the whole stack) needs K_allin standard errors', () => {
    expect(K).toBe(25);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        21.7 * 10,
        10,
        200,
        0
      )
    ).toBe(false);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        25.1 * 10,
        10,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'call', amount: 200 },
        100,
        10,
        200,
        0
      )
    ).toBe(false);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'raise', amount: 250 },
        100,
        10,
        200,
        50
      )
    ).toBe(false);
  });
  it('with an exact price (SE 0) the gap must exceed K_allin % of the stack committed', () => {
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        49,
        0,
        200,
        0
      )
    ).toBe(false);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        51,
        0,
        200,
        0
      )
    ).toBe(true);
  });
  it('never applies to a call that leaves chips behind, to other streets, to PLO4 / PLO6, or to changes not from a fold', () => {
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'fold',
        { action: 'call', amount: 80 },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'turn',
        'fold',
        { action: 'all_in', amount: null },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo4',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo6',
        'river',
        'fold',
        { action: 'all_in', amount: null },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'call',
        { action: 'all_in', amount: null },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
    expect(
      omahaMathCoreRiverAllInCommitOk(
        'plo5',
        'river',
        'check',
        { action: 'bet', amount: 200 },
        1,
        1,
        200,
        0
      )
    ).toBe(true);
  });
});

describe('omahaMathCore PLO5 river scope (RIVER-CORE criterion 3: fold -> plain call only)', () => {
  const ev = (action: string, amount: number | null, e: number, se: number | null) => ({
    action,
    amount,
    ev: e,
    se,
  });
  it('turns a fold into a plain call only when the call beats the fold by K standard errors', () => {
    const evs = [ev('fold', null, 0, 0), ev('call', 40, 30, 5), ev('raise', 160, 90, 5)];
    expect(omahaMathCorePlo5RiverFoldToCall('fold', evs, 200, 5)).toEqual({
      action: 'call',
      amount: 40,
    });
    expect(omahaMathCorePlo5RiverFoldToCall('fold', evs, 200, 7)).toBeNull();
  });
  it('never calls off a stack, never acts unless today folds, and an exact price needs a positive gap', () => {
    const offs = [ev('fold', null, 0, 0), ev('call', 200, 80, 1)];
    expect(omahaMathCorePlo5RiverFoldToCall('fold', offs, 200, 5)).toBeNull();
    const evs = [ev('fold', null, 0, 0), ev('call', 40, 30, 1)];
    for (const today of ['check', 'call', 'bet', 'raise', 'all_in'])
      expect(omahaMathCorePlo5RiverFoldToCall(today, evs, 200, 5)).toBeNull();
    expect(
      omahaMathCorePlo5RiverFoldToCall(
        'fold',
        [ev('fold', null, 0, 0), ev('call', 40, 0.5, 0)],
        200,
        5
      )
    ).toEqual({ action: 'call', amount: 40 });
    expect(
      omahaMathCorePlo5RiverFoldToCall(
        'fold',
        [ev('fold', null, 0, 0), ev('call', 40, -0.5, 0)],
        200,
        5
      )
    ).toBeNull();
  });
});
