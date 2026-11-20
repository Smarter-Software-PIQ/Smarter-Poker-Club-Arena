/**
 * omahaFacingBetIsPricedByEquity (default OFF; EMERG lane FACING 2026-11-19).
 * Law: in PLO4/PLO5 cash, facing a person's wager, a final fold whose
 * calibrated equity times the measured realization beats the price becomes
 * the call, the call survives the response validator, nothing else changes,
 * and the option off is byte-identical. Recorded spots are named by hand id
 * only (anonymised fixtures, HorseOmahaFlopFacingBetEv.test-support.ts).
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
} from './horseDecision/responseValidation.js';
import {
  OMAHA_FACING_EQUITY_CALIBRATION,
  OMAHA_FACING_EQUITY_PROVENANCE,
  omahaFacingBetIsPricedByEquityRule,
  omahaFacingEquityAdmitsCall,
  omahaFacingEquityCalibrated,
  omahaFacingEquitySpot,
  omahaFacingEquityVerdict,
  omahaFacingRawEquity,
} from './HorseOmahaFacingBetEquity.js';
import {
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
  type RecordedFlopFacingBet,
} from './HorseOmahaFlopFacingBetEv.test-support.js';
import { RECORDED_FACING_BETS, expand } from './HorseOmahaFacingBetEv.test-support.js';
import type { Card } from '../types.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const ON: HorseDecideOpts = { omahaFacingBetIsPricedByEquity: true };
const c = (t: string): Card =>
  ({
    rank: t[0],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[t[1]]!,
  }) as Card;
const cards = (s: string): Card[] => s.match(/../g)!.map(c);

type Spot = { flop: RecordedFlopFacingBet } | { later: (typeof RECORDED_FACING_BETS)[number] };
/** The recorded state with the bettor marked a person (the rule's scope). */
function personState(r: Spot) {
  const { fx, node } = 'flop' in r ? expandFlop(r.flop, {}) : expand(r.later);
  const st = stateAt(fx, node);
  for (const p of st.gs.players)
    if (p.seat !== st.hero.seat) (p as { is_horse?: boolean }).is_horse = false;
  return st;
}
function decide(r: Spot, opts: HorseDecideOpts, seed: number) {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
  seedFastRandom(seed);
  const st = personState(r);
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  return { st, d, fires: drainFires().map((f) => f.feature) };
}

describe('omahaFacingBetIsPricedByEquity: the equity', () => {
  it('is deterministic in the cards and exact on a made river nut', () => {
    const hole = cards('AsKsQhJh');
    const board = cards('TsJsQs2d3c');
    expect(omahaFacingRawEquity(hole, board, 1)).toBe(1);
    const a = omahaFacingRawEquity(cards('7c6d5h4s'), cards('KdKhAc'), 2);
    const b = omahaFacingRawEquity(cards('6d7c4s5h'), cards('AcKhKd'), 2);
    expect(a).toBe(b);
    expect(a!).toBeGreaterThan(0);
    expect(a!).toBeLessThan(0.5);
  });

  it('refuses duplicate cards', () => {
    expect(omahaFacingRawEquity(cards('AsKsQhJh'), cards('AsJsQs'), 1)).toBeNull();
  });

  it('every calibration cell is monotone and a sparse cell gives no verdict', () => {
    for (const street of ['flop', 'turn', 'river'] as const)
      for (const m of ['hu', 'mw'] as const) {
        const k = OMAHA_FACING_EQUITY_CALIBRATION[street][m];
        for (let i = 1; i < k.length; i++) {
          expect(k[i][0]).toBeGreaterThan(k[i - 1][0]);
          expect(k[i][1]).toBeGreaterThanOrEqual(k[i - 1][1]);
        }
      }
    expect(omahaFacingEquityCalibrated('river', false, 0.9)).toBeNull();
    // Persons' river bets are value-heavy: a raw half is worth well under a half.
    expect(omahaFacingEquityCalibrated('river', true, 0.5)!).toBeLessThan(0.35);
  });
});

describe('omahaFacingBetIsPricedByEquity: provenance', () => {
  it('every constant is fitted on public information; hidden cards only grade', () => {
    expect(OMAHA_FACING_EQUITY_PROVENANCE.calibration).toMatch(/^public: /);
    expect(OMAHA_FACING_EQUITY_PROVENANCE.calibration).toMatch(/revealed at showdown/);
    expect(OMAHA_FACING_EQUITY_PROVENANCE.realization).toMatch(/^public: /);
    expect(OMAHA_FACING_EQUITY_PROVENANCE.hiddenCards).toMatch(/no constant/);
  });
});

describe('omahaFacingBetIsPricedByEquity: PLO6 is untouched (owner 2026-11-19 8:26 PM)', () => {
  // Six-card hands on the recorded flops (the hero's own five plus one unseen card).
  const sixOf = (r: RecordedFlopFacingBet): string | null => {
    const used = new Set((r.hole + r.board).match(/../g));
    for (const card of ['2c', '2d', '3c', '3d', '4c', '4d', '5c', '5d'])
      if (!used.has(card)) return r.hole + card;
    return null;
  };
  it('a PLO6 decision facing a person is byte-identical with the option on', () => {
    let n = 0;
    for (const r of RECORDED_FLOP_FACING_BETS) {
      const hole = sixOf(r);
      if (hole === null) continue;
      for (const seed of [1, 2]) {
        const play = (opts: HorseDecideOpts): string => {
          enableBrainTelemetry();
          HorseMind.reset();
          drainFires();
          seedFastRandom(seed);
          const { fx, node } = expandFlop(r, { variant: 'plo6', hole });
          const st = stateAt(fx, node);
          for (const p of st.gs.players)
            if (p.seat !== st.hero.seat) (p as { is_horse?: boolean }).is_horse = false;
          expect(omahaFacingEquitySpot(st.hero, st.gs)).toBeNull();
          const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
            telemetry: true,
            observeMind: false,
            ...opts,
          } as never);
          return JSON.stringify(withoutMeasurements(d));
        };
        expect(play(ON)).toBe(play({}));
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('omahaFacingBetIsPricedByEquity: the law on recorded spots', () => {
  const spots: Spot[] = [
    ...RECORDED_FLOP_FACING_BETS.map((flop) => ({ flop })),
    ...RECORDED_FACING_BETS.map((later) => ({ later })),
  ];

  it('off is byte-identical, and on changes only folds, only to the validated call', () => {
    let flips = 0;
    for (const r of spots)
      for (const seed of [1, 2]) {
        const base = decide(r, {}, seed);
        const off = decide(r, { omahaFacingBetIsPricedByEquity: false }, seed);
        expect(JSON.stringify(withoutMeasurements(off.d))).toBe(
          JSON.stringify(withoutMeasurements(base.d))
        );
        const on = decide(r, ON, seed);
        if (base.d.action !== 'fold') {
          expect(JSON.stringify(withoutMeasurements(on.d))).toBe(
            JSON.stringify(withoutMeasurements(base.d))
          );
          continue;
        }
        if (on.d.action === 'fold') continue;
        flips++;
        expect(['call', 'all_in']).toContain(on.d.action);
        expect(on.fires).toContain('omaha_facing_bet_equity_call');
        const spot = omahaFacingEquitySpot(on.st.hero, on.st.gs)!;
        const v = omahaFacingEquityVerdict(spot, on.st.hero.cards, on.st.gs.communityCards)!;
        expect(v.call).toBe(true);
        expect(v.realized - v.price).toBeGreaterThan(v.margin);
        // The flipped call survives the response validator end to end.
        expect(
          horseDecisionReceiptRefusal(structuredClone(on.d), String(on.st.gs.gameVariant), {
            player: on.st.hero,
            gameState: on.st.gs,
          })
        ).toBeNull();
        // ... and through the gate loop the worker client runs before the
        // decision reaches the table (client.ts), so it is never replaced by
        // the liveness fallback (ServerTableEngineTurns.ts worker_fallback).
        expect(
          horseDecisionReceiptRefusalForGates(
            structuredClone(on.d),
            String(on.st.gs.gameVariant),
            { player: on.st.hero, gameState: on.st.gs },
            [false],
            [false],
            [false]
          )
        ).toBeNull();
      }
    expect(flips).toBeGreaterThan(0);
  });

  it('a Horse bettor, a tournament or PLO6 is outside the spot', () => {
    const r = spots[0];
    const st = personState(r);
    expect(omahaFacingEquitySpot(st.hero, st.gs)).not.toBeNull();
    const horses = structuredClone(st);
    for (const p of horses.gs.players) (p as { is_horse?: boolean }).is_horse = true;
    expect(omahaFacingEquitySpot(horses.hero, horses.gs)).toBeNull();
    expect(omahaFacingEquitySpot(st.hero, { ...st.gs, gameVariant: 'plo6' } as never)).toBeNull();
    expect(
      omahaFacingEquitySpot(st.hero, { ...st.gs, gameMode: 'tournament' } as never)
    ).toBeNull();
  });

  it('the rule leaves a non-fold and an off switch alone', () => {
    const st = personState(spots[0]);
    const call = { action: 'call', amount: 1 };
    expect(omahaFacingBetIsPricedByEquityRule(call, st.hero, st.gs, true, (d) => d)).toBe(call);
    const fold = { action: 'fold' };
    expect(omahaFacingBetIsPricedByEquityRule(fold, st.hero, st.gs, false, (d) => d)).toBe(fold);
  });

  it('the validator admits only the exact chips of the call', () => {
    const st = personState(spots[0]);
    const spot = omahaFacingEquitySpot(st.hero, st.gs)!;
    expect(omahaFacingEquityAdmitsCall(st.hero, st.gs, spot.paid + 1)).toBe(false);
    expect(omahaFacingEquityAdmitsCall(st.hero, st.gs, null)).toBe(false);
  });
});
