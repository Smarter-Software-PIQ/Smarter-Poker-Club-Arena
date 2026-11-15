/**
 * THE CALL-DOWN READS ONLY EVIDENCE IT CAN SEE (2026-11-15, Hold'em Strategy lane, opponent classifier C7; options
 * holdemCallDownExcludesCurrentHand (F1) and holdemCallDownNeedsStyleEvidence (F2), each read === true, default OFF).
 *
 * The heads-up memory review (HU-MEM-013, Hold'em section V6) found two defects in the legacy lifetime call-down
 * multiplier (HorseMind.legacyExploit: aggression ratio above 2.5 on 12+ actions sets callDownMod 1.2):
 *  F1 the hand being decided is observed into the counters before the read, so the bets the Horse is facing push the
 *     ratio over the line: the prior read gives 1.00 and the decision's read 1.20 against the same bets;
 *  F2 reduced to two at a short or full table, the scope's own bucket is under SCOPE_MIN_HANDS so the pooled tallies
 *     answer the multiplier, while the style read used for the decision reads the scope's own counters and has no
 *     evidence, so the value-bettor exemption cannot act on the read that widened the call.
 * Both change decisions in exactly the spots they repair, so each ships behind its own option.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  decide,
  install,
  turnPotBet,
  VILLAIN,
  HERO,
} from './HorseOpponentStyle.contexts.test-support.js';
import { raiser } from './maniacReadGrid.test-support.js';
import type { ActionRecord, SeatPlayer } from '../types.js';

afterEach(() => {
  HorseMind.reset();
  HorseMind.setDecisionScope(null);
});

const spot = turnPotBet('cash');
const history = spot.gs.actionHistory as ActionRecord[];
const fired = (name: string): number =>
  drainFires()
    .filter((f) => f.feature === name)
    .reduce((n, f) => n + f.fires, 0);

/** prior lifetime tallies 28 aggressive / 12 passive (ratio 2.33, under the line); this hand adds 3 aggressive. */
const priorUnderTheLine = () => {
  install({ stats: { hands: 40, aggr: 28, passive: 12 }, counters: null }, 'cash');
  HorseMind.observe(history, spot.gs.players as SeatPlayer[]);
};

describe('F1: the bets being faced are not history about the bettor', () => {
  it('currentHandWagers counts the hand as observe counts it', () => {
    const w = HorseMind.currentHandWagers(history);
    expect(w[VILLAIN]).toEqual({ aggr: 3, passive: 0, postAggr: 2, postPassive: 0 });
    expect(w[HERO]).toEqual({ aggr: 0, passive: 2, postAggr: 0, postPassive: 1 });
    const forced = [{ ...history[0], origin: 'forced' } as ActionRecord];
    expect(HorseMind.currentHandWagers(forced)).toEqual({});
  });
  it('today: the prior read is neutral and the decision read widens to 1.2 on the same bets', () => {
    install({ stats: { hands: 40, aggr: 28, passive: 12 }, counters: null }, 'cash');
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBe(1);
    HorseMind.setDecisionScope(null);
    priorUnderTheLine();
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBeCloseTo(1.2, 9);
  });
  it('with the option on the read is the prior read, and the receipt fires', () => {
    priorUnderTheLine();
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({ currentHandWagers: HorseMind.currentHandWagers(history) });
    enableBrainTelemetry();
    drainFires();
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBe(1);
    expect(fired('holdem_call_down_excludes_current_hand_seen')).toBe(1);
  });
  it('a bettor over the line on his history alone is still read as aggressive', () => {
    install({ stats: { hands: 40, aggr: 36, passive: 12 }, counters: null }, 'cash');
    HorseMind.observe(history, spot.gs.players as SeatPlayer[]);
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({ currentHandWagers: HorseMind.currentHandWagers(history) });
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBeCloseTo(1.2, 9);
  });
  it("the decision plumbs the wagers only with the option on, in hold'em", () => {
    priorUnderTheLine();
    const opts = { mind: true, observeMind: false };
    HorseLogic.prepareOriginalReads(spot.hero, spot.gs as never, opts as never);
    expect(HorseMind.currentDecisionReadOptions().currentHandWagers).toBeUndefined();
    HorseMind.setDecisionScope(null);
    HorseLogic.prepareOriginalReads(
      spot.hero,
      spot.gs as never,
      {
        ...opts,
        holdemCallDownExcludesCurrentHand: true,
      } as never
    );
    expect(HorseMind.currentDecisionReadOptions().currentHandWagers?.[VILLAIN]?.aggr).toBe(3);
    HorseMind.setDecisionScope(null);
    const omaha = { ...spot.gs, gameVariant: 'plo4' };
    HorseLogic.prepareOriginalReads(
      spot.hero,
      omaha as never,
      {
        ...opts,
        holdemCallDownExcludesCurrentHand: true,
      } as never
    );
    expect(HorseMind.currentDecisionReadOptions().currentHandWagers).toBeUndefined();
  });
  it('through a decision: the receipt fires only with the option on; off is unchanged', () => {
    install({ stats: { hands: 40, aggr: 28, passive: 12 }, counters: null }, 'cash');
    const off = decide(spot, {});
    install({ stats: { hands: 40, aggr: 28, passive: 12 }, counters: null }, 'cash');
    const on = decide(spot, { holdemCallDownExcludesCurrentHand: true });
    expect(off.fires.holdem_call_down_excludes_current_hand_seen ?? 0).toBe(0);
    expect(on.fires.holdem_call_down_excludes_current_hand_seen ?? 0).toBeGreaterThan(0);
    install({ stats: { hands: 40, aggr: 28, passive: 12 }, counters: null }, 'cash');
    expect(decide(spot, {}).digest).toBe(off.digest);
  });
});

describe('F2: with no style evidence the pooled tallies do not widen the call-down', () => {
  /** pooled tallies only: ratio 4.0 on 50 actions; no scoped bucket, no exploit counters. */
  const pooledManiac = () =>
    install({ stats: { hands: 60, aggr: 40, passive: 10 }, counters: null }, 'cash', 'short');
  it('today: reduced to two at a short table the multiplier widens while the style read is unknown', () => {
    pooledManiac();
    HorseMind.setDecisionScope('holdem:short' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    expect(HorseMind.styleRead(VILLAIN).evidence.state).not.toBe('supported_individual_read');
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBeCloseTo(1.2, 9);
  });
  it('with the option on it stays neutral, and the receipt fires', () => {
    pooledManiac();
    HorseMind.setDecisionScope('holdem:short' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({ holdemCallDownNeedsStyleEvidence: true });
    enableBrainTelemetry();
    drainFires();
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBe(1);
    expect(fired('holdem_call_down_needs_style_evidence_seen')).toBe(1);
  });
  it('a style read with individual evidence keeps the multiplier as it was', () => {
    install(
      {
        stats: { hands: 60, aggr: 40, passive: 10 },
        counters: raiser({ hands: 43.78, pfr: 0.3, rfi: 0.4 }),
      },
      'cash',
      'short'
    );
    HorseMind.setDecisionScope('holdem:short' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    const offMod = HorseMind.exploit(VILLAIN, true, {}).callDownMod;
    const supported = HorseMind.styleRead(VILLAIN).evidence.state === 'supported_individual_read';
    HorseMind.setDecisionReadOptions({ holdemCallDownNeedsStyleEvidence: true });
    const onMod = HorseMind.exploit(VILLAIN, true, {}).callDownMod;
    expect(supported).toBe(true);
    expect(onMod).toBe(offMod);
  });
  it("outside hold'em nothing changes", () => {
    pooledManiac();
    HorseMind.setDecisionScope('omaha:short' as never, 'plo4', 'cash');
    HorseMind.setDecisionReadOptions({});
    const offMod = HorseMind.exploit(VILLAIN, true, {}).callDownMod;
    HorseMind.setDecisionReadOptions({ holdemCallDownNeedsStyleEvidence: true });
    expect(HorseMind.exploit(VILLAIN, true, {}).callDownMod).toBe(offMod);
  });
});
