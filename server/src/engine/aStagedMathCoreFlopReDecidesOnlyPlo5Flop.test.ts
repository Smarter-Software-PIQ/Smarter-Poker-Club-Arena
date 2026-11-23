/**
 * Lane CORE-POOLED-3 (2026-11-21) & PLO-OWNER lead-4 lane core-repair (2026-11-22): all six math core street flags
 * (PLO5/PLO4 x flop/turn/river) are on OPTION_SHADOW_STAGE with omahaMathCore as their companion and listed in
 * OPTION_SWITCH_RELEASE_DEFAULT_OFF so the registry accepts `shadow` for each. Every staged street flag is picked
 * ONLY on its exact (game, street) in cash play (never another street, never another Omaha variant, never PLO6,
 * never a tournament, never a bomb pot), carries omahaMathCore true only when flipped to true, and the parent
 * omahaMathCore switch itself is never staged. Real recorded Omaha decisions (HorseOmahaPricedRules.fixture.json),
 * every street the record holds.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_SHADOW_STAGE,
  optionShadowStageCompanions,
  optionShadowStageInScope,
} from './HorseOptionShadowStage.js';
import {
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';
import { recordedState, type RecordedDecision } from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';

const STREET_FLAGS = [
  { flag: 'omahaMathCorePlo5Flop', game: 5 as const, variant: 'plo5', street: 'flop' },
  { flag: 'omahaMathCorePlo4Flop', game: 4 as const, variant: 'plo4', street: 'flop' },
  { flag: 'omahaMathCorePlo5Turn', game: 5 as const, variant: 'plo5', street: 'turn' },
  { flag: 'omahaMathCorePlo5River', game: 5 as const, variant: 'plo5', street: 'river' },
  { flag: 'omahaMathCorePlo4Turn', game: 4 as const, variant: 'plo4', street: 'turn' },
  { flag: 'omahaMathCorePlo4River', game: 4 as const, variant: 'plo4', street: 'river' },
] as const;

const RECORDS = RECORDED as unknown as RecordedDecision[];
const picked = (flag: string, player: unknown, gs: unknown) =>
  optionShadowStageInScope([flag, 'streetIQ'], player, gs).includes(flag);

describe('the staged math core street flags', () => {
  it('list all six PLO4/PLO5 postflop street flags with exact (game, street) and companion omahaMathCore; no other core flag is staged', () => {
    for (const { flag, game, street } of STREET_FLAGS) {
      expect(OPTION_SHADOW_STAGE[flag], flag).toEqual({
        games: [game],
        streets: [street],
        companions: ['omahaMathCore'],
      });
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF, flag).toContain(flag);
      expect(OPTION_SWITCH_SHADOW_NAMES, flag).toContain(flag);
    }
    const core = Object.keys(OPTION_SHADOW_STAGE).filter((n) => n.startsWith('omahaMathCore'));
    expect(core).toEqual(STREET_FLAGS.map((s) => s.flag));
    expect(core).not.toContain('omahaMathCore');
  });

  it('picks each street flag on every recorded decision of its exact (game, street) and on no other street or variant', () => {
    for (const { flag, variant, street } of STREET_FLAGS) {
      const otherVariant = variant === 'plo5' ? 'plo4' : 'plo5';
      const by: Record<string, [number, number]> = {};
      let otherVariantHits = 0;
      for (const r of RECORDS) {
        const { hero, gs } = recordedState(r);
        const heroForVariant =
          variant === 'plo4' ? { ...hero, cards: (hero.cards ?? []).slice(0, 4) } : hero;
        const gsForVariant = { ...gs, gameVariant: variant };
        const stName = String(gsForVariant.stage);
        const row = (by[stName] ??= [0, 0]);
        row[0]++;
        if (picked(flag, heroForVariant, gsForVariant)) row[1]++;

        const heroForOther =
          otherVariant === 'plo4' ? { ...hero, cards: (hero.cards ?? []).slice(0, 4) } : hero;
        if (picked(flag, heroForOther, { ...gs, gameVariant: otherVariant })) otherVariantHits++;
      }
      expect(by[street]?.[0] ?? 0, `${flag} ${street} total`).toBeGreaterThanOrEqual(5);
      expect(by[street]?.[1], `${flag} ${street} picked`).toBe(by[street]?.[0]);
      for (const [stName, [, n]] of Object.entries(by)) {
        if (stName !== street) expect(n, `${flag} off-street ${stName}`).toBe(0);
      }
      expect(otherVariantHits, `${flag} wrong variant ${otherVariant}`).toBe(0);
    }
  });

  it('never picks any street flag on PLO6, a tournament, or a bomb pot', () => {
    for (const { flag, variant, street } of STREET_FLAGS) {
      const matching = RECORDS.filter((x) => x.street === street);
      expect(matching.length, `${flag} ${street} fixtures`).toBeGreaterThanOrEqual(5);
      for (const r of matching) {
        const { hero, gs } = recordedState(r);
        const heroForVariant =
          variant === 'plo4' ? { ...hero, cards: (hero.cards ?? []).slice(0, 4) } : hero;
        const gsForVariant = { ...gs, gameVariant: variant };
        expect(picked(flag, hero, { ...gs, gameVariant: 'plo6' }), `${flag} plo6`).toBe(false);
        expect(
          picked(flag, heroForVariant, { ...gsForVariant, gameMode: 'tournament' }),
          `${flag} tournament`
        ).toBe(false);
        expect(
          picked(flag, heroForVariant, { ...gsForVariant, bombPot: true }),
          `${flag} bombPot`
        ).toBe(false);
        expect(picked(flag, heroForVariant, gsForVariant), `${flag} cash`).toBe(true);
      }
    }
  });

  it('carries omahaMathCore true only when flipped to true and the core is not already on', () => {
    for (const { flag } of STREET_FLAGS) {
      expect(optionShadowStageCompanions(flag, true, {}), flag).toEqual({ omahaMathCore: true });
      expect(optionShadowStageCompanions(flag, true, { omahaMathCore: true }), flag).toEqual({});
      expect(optionShadowStageCompanions(flag, false, {}), flag).toEqual({});
    }
  });
});
