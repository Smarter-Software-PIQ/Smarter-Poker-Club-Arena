/**
 * EMERG lane PACK 2026-11-19: the depth the PLO4 and PLO5/6/8 Omaha pack gates
 * read (OmahaPackDepth.ts; omahaPackEffectiveDepth, omahaPackClampDeepDepth,
 * both default off). Recorded geometry only (hand ids, stacks, bets; no cards).
 */
import { describe, expect, it } from 'vitest';
import {
  OMAHA_PACK_DEPTH_BASES,
  omahaAggressorSeat,
  omahaPackDepth,
  omahaPackDepthBindingIsConsistent,
} from './OmahaPackDepth.js';
import { omahaVariantSpot } from '../../benchmark/OmahaVariantPolicyEvidence.js';
import { plo4ReferenceSpot } from '../../benchmark/Plo4PolicyEvidence.js';
import { evaluateOmahaVariantPolicy } from './OmahaVariantLivePolicy.js';
import { evaluatePlo4LivePolicy } from '../plo4/Plo4LivePolicy.js';
import { HorseLogic } from '../HorseLogic.js';
import { horseJournalJson } from '../../services/horseDecisionJournal/record.js';

const MAX = 250;
// Hand 5e9a7188 (PLO5 Lightning 1/2), flop: a person (seat 3, 104.5 bb
// covered) bets 10; a Horse (seat 5, 253.35 bb covered) calls; the Horse in
// seat 6 (341.075 bb covered) faces the bet. Recorded depthBB 253.35, reason
// depth_or_ante_outside_pack.
const bb = 2;
const hand5e9a7188 = {
  hero: { stack: 682.15, bet: 0 },
  active: [
    { seat: 3, stack: 199, bet: 10, is_all_in: false },
    { seat: 5, stack: 496.7, bet: 10, is_all_in: false },
  ],
  currentBet: 10,
  aggressorSeat: 3,
};

describe('Omaha pack depth (EMERG PACK, hand 5e9a7188)', () => {
  it('both options off: the legacy deepest-live-opponent number and basis, exactly', () => {
    const h = hand5e9a7188;
    const d = omahaPackDepth(h.hero, h.active, h.currentBet, bb, h.aggressorSeat, MAX);
    expect(d.depth).toBeCloseTo(253.35, 6);
    expect(d.depth > MAX).toBe(true); // the pack refused this decision live
    expect(d.basis).toBe('stack_plus_street_bet_vs_deepest_contesting_opponent');
    expect(
      omahaPackDepth(h.hero, h.active, h.currentBet, bb, h.aggressorSeat, MAX, {
        effective: false,
        clamp: false,
      })
    ).toEqual(d);
  });

  it('omahaPackEffectiveDepth: the depth is against the person who bet, not the Horse who called', () => {
    const h = hand5e9a7188;
    const d = omahaPackDepth(h.hero, h.active, h.currentBet, bb, h.aggressorSeat, MAX, {
      effective: true,
    });
    expect(d.depth).toBeCloseTo(104.5, 6);
    expect(d.basis).toBe('stack_plus_street_bet_vs_opponents_contesting_this_bet');
    expect(
      omahaPackDepthBindingIsConsistent(d.depth, 341.075, d.opponentCover / bb, d.basis, MAX)
    ).toBe(true);
  });

  it('effective depth keeps a player still to act and never shrinks an unopened street', () => {
    const h = hand5e9a7188;
    const behind = [...h.active, { seat: 1, stack: 900, bet: 0, is_all_in: false }];
    const d = omahaPackDepth(h.hero, behind, h.currentBet, bb, h.aggressorSeat, MAX, {
      effective: true,
    });
    expect(d.depth).toBeCloseTo(341.075, 6); // the deep player behind can still play
    const open = omahaPackDepth(h.hero, h.active, 0, bb, null, MAX, { effective: true });
    expect(open.basis).toBe('stack_plus_street_bet_vs_deepest_contesting_opponent');
    expect(open.depth).toBeCloseTo(253.35, 6);
  });

  it('omahaPackClampDeepDepth: a depth above the deepest band is played in that band', () => {
    const h = hand5e9a7188;
    const d = omahaPackDepth(h.hero, h.active, h.currentBet, bb, h.aggressorSeat, MAX, {
      clamp: true,
    });
    expect(d.depth).toBe(MAX);
    expect(d.basis).toBe(
      'stack_plus_street_bet_vs_deepest_contesting_opponent_clamped_to_deepest_band'
    );
    expect(omahaPackDepthBindingIsConsistent(MAX, 341.075, 253.35, d.basis, MAX)).toBe(true);
    // a clamped basis on a depth that was inside the band is not a valid receipt
    expect(omahaPackDepthBindingIsConsistent(MAX, 341.075, 104.5, d.basis, MAX)).toBe(false);
    // both on: the effective depth is inside the band, no clamp
    const both = omahaPackDepth(h.hero, h.active, h.currentBet, bb, h.aggressorSeat, MAX, {
      effective: true,
      clamp: true,
    });
    expect(both.depth).toBeCloseTo(104.5, 6);
  });

  it('no live opponent stays a refused (non-finite) depth; unknown bases are refused', () => {
    expect(
      Number.isFinite(
        omahaPackDepth({ stack: 100, bet: 0 }, [], 0, 1, null, MAX, { clamp: true }).depth
      )
    ).toBe(false);
    expect(omahaPackDepthBindingIsConsistent(100, 100, 200, 'deepest', MAX)).toBe(false);
    expect(OMAHA_PACK_DEPTH_BASES).toHaveLength(4);
  });

  it('the aggressor is the last full bet or raise of another player on this street', () => {
    const hist = [
      { userId: 'p', seat: 3, stage: 'preflop', action: 'raise' },
      { userId: 'p', seat: 3, stage: 'flop', action: 'bet' },
      { userId: 'h5', seat: 5, stage: 'flop', action: 'call' },
    ];
    expect(omahaAggressorSeat('h6', 'flop', hist)).toBe(3);
    expect(omahaAggressorSeat('h6', 'turn', hist)).toBeNull();
  });
});

describe('both pack gates read the options (PLO4 Phase 10, PLO5 Phase 11)', () => {
  it('PLO5: a 600 bb heads-up spot is refused by default and admitted in the 250 bb band with the clamp', () => {
    const s = omahaVariantSpot('plo5', 'turn', 2);
    const deep = s.state.bigBlind * 600;
    for (const p of [s.hero, ...s.state.players]) p.stack = deep;
    const off = evaluateOmahaVariantPolicy(s.hero, s.state, s.baseline, null, 'shadow', () => 0);
    expect(off.receipt.reason).toBe('depth_or_ante_outside_pack');
    const on = evaluateOmahaVariantPolicy(
      s.hero,
      s.state,
      s.baseline,
      null,
      'shadow',
      () => 0,
      1,
      true,
      undefined,
      false,
      { clamp: true }
    );
    expect(on.receipt.reason).not.toBe('depth_or_ante_outside_pack');
    expect(on.receipt.depthBB).toBe(250);
    expect(on.receipt.inputs?.depth.basis).toBe(
      'stack_plus_street_bet_vs_deepest_contesting_opponent_clamped_to_deepest_band'
    );
    expect(() => horseJournalJson(on.receipt)).not.toThrow();
    const dOff = HorseLogic.decide(s.hero, s.state, 'balanced', {}, { mind: false });
    expect(dOff.omahaVariantPolicy?.reason).toBe('depth_or_ante_outside_pack');
    const dOn = HorseLogic.decide(
      s.hero,
      s.state,
      'balanced',
      {},
      { mind: false, omahaPackClampDeepDepth: true }
    );
    expect(dOn.omahaVariantPolicy?.reason).not.toBe('depth_or_ante_outside_pack');
    expect(dOn.policyFallback).toBeUndefined();
  });
  it('PLO4: the same, through the Phase 10 gate', () => {
    const input = plo4ReferenceSpot('premium_open');
    const deep = input.state.bigBlind * 600;
    input.hero.stack = deep;
    input.state.players[0] = { ...input.hero, cards: [] };
    input.state.players[1].stack = deep;
    const off = evaluatePlo4LivePolicy(
      input.hero,
      input.state,
      input.baseline,
      null,
      'shadow',
      () => 0
    );
    expect(off.receipt.reason).toBe('depth_or_ante_outside_pack');
    const on = evaluatePlo4LivePolicy(
      input.hero,
      input.state,
      input.baseline,
      null,
      'shadow',
      () => 0,
      undefined,
      false,
      { clamp: true }
    );
    expect(on.receipt.reason).not.toBe('depth_or_ante_outside_pack');
    expect(on.receipt.depthBB).toBe(250);
    expect(on.receipt.inputs?.depth.effectiveBB).toBe(250);
    const dOn = HorseLogic.decide(
      input.hero,
      input.state,
      'balanced',
      {},
      { mind: false, omahaPackClampDeepDepth: true }
    );
    expect(dOn.plo4Policy?.reason).not.toBe('depth_or_ante_outside_pack');
  });
});
