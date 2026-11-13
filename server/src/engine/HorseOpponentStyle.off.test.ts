import { describe, expect, it } from 'vitest';
import { ALL_SPOTS, VILLAINS, decide, install, type Mode } from './HorseOpponentStyle.contexts.test-support.js';
import { OFF_DIGESTS } from './HorseOpponentStyle.off-digests.js';

/** Every style option OFF reproduces the commit before the style read, decision for decision (action, amount, RNG position). */
describe('style read: every option OFF equals current behaviour', () => {
  for (const mode of ['cash', 'tournament', 'bubble'] as Mode[])
    it(`${mode}: 60 pinned decisions are byte-identical, absent or explicitly false, and no style receipt fires`, () => {
      let n = 0;
      for (const spot of ALL_SPOTS(mode))
        for (const [vn, v] of Object.entries(VILLAINS))
          for (const opts of [{}, { styleValueBettorNotManiac: false, styleBigBetHonesty: false, styleRaiseRespect: false, styleTightReRaiserRespect: false, styleCarryOverWeight: 0 }]) {
            install(v, mode);
            const r = decide(spot, opts);
            expect(r.digest, `${spot.name}/${vn}`).toBe(OFF_DIGESTS[`${spot.name}/${vn}`]);
            expect(Object.keys(r.fires).filter((f) => f.startsWith('style_'))).toEqual([]);
            n++;
          }
      expect(n).toBe(120);
    });
});
