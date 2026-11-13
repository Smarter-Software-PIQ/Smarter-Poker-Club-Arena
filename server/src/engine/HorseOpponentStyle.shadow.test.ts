/**
 * STYLE READ SHADOW (2026-11-13): every option in shadow commits exactly the OFF decision. The 120 pinned decisions
 * of HorseOpponentStyle.off.test.ts (action, amount, RNG position), run with every option in shadow, are
 * byte-identical; no option's applied receipt fires; and shadow did compute (options engaged where they would act).
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_SPOTS,
  VILLAINS,
  decide,
  install,
  type Mode,
} from './HorseOpponentStyle.contexts.test-support.js';
import { OFF_DIGESTS } from './HorseOpponentStyle.off-digests.js';
import { STYLE_SWITCH_OPTIONS } from './HorseStyleSwitch.js';
import { clearStyleShadowEngaged, takeStyleShadowEngaged } from './HorseStyleShadow.js';

/** The receipts an option fires only when it APPLIES its adjustment. */
const APPLIED = [
  'style_value_bettor_not_maniac_seen',
  'style_big_bet_honesty_seen',
  'style_bluff_catch_cap_seen',
  'style_bluff_catch_cap_bounty_priced_seen',
  'style_raise_respect_seen',
  'style_tight_opener_respect_seen',
  'style_tight_reraiser_respect_seen',
  'style_pre_repair_fold_rate_discounted_seen',
  'style_value_extraction_seen',
  'style_fold_bluff_seen',
];

describe('style read: every option in shadow commits the OFF decision', () => {
  const engagedTotal = new Map<string, number>();
  for (const mode of ['cash', 'tournament', 'bubble'] as Mode[])
    it(`${mode}: the pinned decisions are byte-identical with all options in shadow, and nothing is applied`, () => {
      let n = 0;
      for (const spot of ALL_SPOTS(mode))
        for (const [vn, v] of Object.entries(VILLAINS))
          for (const opts of [
            { styleShadow: STYLE_SWITCH_OPTIONS },
            { styleShadow: STYLE_SWITCH_OPTIONS, styleFoldBluff: false, styleRaiseRespect: false },
          ]) {
            install(v, mode);
            clearStyleShadowEngaged();
            const r = decide(spot, opts as never);
            expect(r.digest, `${spot.name}/${vn}`).toBe(OFF_DIGESTS[`${spot.name}/${vn}`]);
            expect(
              Object.keys(r.fires).filter((f) => APPLIED.includes(f)),
              `${spot.name}/${vn}`
            ).toEqual([]);
            for (const e of takeStyleShadowEngaged())
              engagedTotal.set(e.option, (engagedTotal.get(e.option) ?? 0) + 1);
            n++;
          }
      expect(n).toBe(120);
    });
  it('shadow computed: options engaged on the pinned spots where they would have acted', () => {
    expect([...engagedTotal.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
