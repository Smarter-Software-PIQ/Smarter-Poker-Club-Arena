/**
 * Lane CORE-POOLED-3 (2026-11-21, lead-2 order): omahaMathCorePlo5Flop is back on the shadow stage table with
 * omahaMathCore as its companion. Its staged re-decision is picked only in a PLO5 cash flop decision (never PLO4,
 * PLO6, a tournament, a bomb pot, or the PLO5 preflop / turn / river), it carries omahaMathCore true only when the
 * flag is flipped to true, and no other core street flag is staged. Real recorded PLO5 decisions
 * (HorseOmahaPricedRules.fixture.json), every street the record holds.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_SHADOW_STAGE,
  optionShadowStageCompanions,
  optionShadowStageInScope,
} from './HorseOptionShadowStage.js';
import { recordedState, type RecordedDecision } from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';

const FLAG = 'omahaMathCorePlo5Flop';
const RECORDS = RECORDED as unknown as RecordedDecision[];
const picked = (player: unknown, gs: unknown) =>
  optionShadowStageInScope([FLAG, 'streetIQ'], player, gs).includes(FLAG);

describe('the staged math core flop flag', () => {
  it('is listed for PLO5 flop only, with omahaMathCore as its companion; no other core flag is staged', () => {
    expect(OPTION_SHADOW_STAGE[FLAG]).toEqual({
      games: [5],
      streets: ['flop'],
      companions: ['omahaMathCore'],
    });
    const core = Object.keys(OPTION_SHADOW_STAGE).filter((n) => n.startsWith('omahaMathCore'));
    expect(core).toEqual([FLAG]);
  });

  it('is picked on every recorded PLO5 flop decision and on no recorded preflop, turn or river decision', () => {
    const by: Record<string, [number, number]> = {};
    for (const r of RECORDS) {
      const { hero, gs } = recordedState(r);
      const row = (by[String(gs.stage)] ??= [0, 0]);
      row[0]++;
      if (picked(hero, gs)) row[1]++;
    }
    expect(by.flop![0]).toBeGreaterThanOrEqual(10);
    expect(by.flop![1]).toBe(by.flop![0]);
    for (const [street, [, n]] of Object.entries(by))
      if (street !== 'flop') expect(n, street).toBe(0);
  });

  it('is never picked on the same flop decisions as PLO4, PLO6, a tournament or a bomb pot', () => {
    for (const r of RECORDS.filter((x) => x.street === 'flop')) {
      const { hero, gs } = recordedState(r);
      const plo4Hero = { ...hero, cards: (hero.cards ?? []).slice(0, 4) };
      expect(picked(plo4Hero, { ...gs, gameVariant: 'plo4' })).toBe(false);
      expect(picked(hero, { ...gs, gameVariant: 'plo6' })).toBe(false);
      expect(picked(hero, { ...gs, gameMode: 'tournament' })).toBe(false);
      expect(picked(hero, { ...gs, bombPot: true })).toBe(false);
      expect(picked(hero, gs)).toBe(true);
    }
  });

  it('carries omahaMathCore true only when flipped to true and the core is not already on', () => {
    expect(optionShadowStageCompanions(FLAG, true, {})).toEqual({ omahaMathCore: true });
    expect(optionShadowStageCompanions(FLAG, true, { omahaMathCore: true })).toEqual({});
    expect(optionShadowStageCompanions(FLAG, false, {})).toEqual({});
  });
});
