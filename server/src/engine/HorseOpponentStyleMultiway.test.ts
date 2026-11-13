/**
 * Multiway (3 players) variants of the fixtures the river bluff-catch cap folds heads-up (DEVELOPMENT data): a third
 * live player overcalls the bettor. The read must key to the BETTOR: with the value-heavy read on the bettor the
 * bluff-catcher still folds; with the same read moved to the third player (and none on the bettor) nothing changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { VILLAIN, decide, install } from './HorseOpponentStyle.contexts.test-support.js';
import { FX, ON, THIRD, spotOf, supply, villainOf } from './HorseOpponentStyle.fixtures.test-support.js';

const IDS = ['F017', 'F018', 'F019', 'F021', 'F026', 'F032'];
afterEach(() => vi.restoreAllMocks());

/** Install a fixture's read on `who` (VILLAIN or THIRD) only. */
function installOn(who: string, f: (typeof FX)[number]) {
  const v = villainOf(f);
  HorseMind.reset();
  HorseMind.importStats([{ user_id: who, ...v.stats }]);
  HorseMind.importDurableOpponentProfiles([{ user_id: who, variant: 'nlh', mode: f.format, size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed: 'table', ante: 'none' }, counters: v.counters } as never]);
  HorseMind.importPostReleaseObservations([{ user_id: who, variant: 'nlh', mode: f.format, size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
}

describe('multiway: the bluff-catch read keys to the bettor', () => {
  for (const id of IDS) {
    const f = FX.find((x) => x.id === id)!;
    it(`${id} 3-way: the cap is computed from the bettor's read only, never widens, and the third player's read changes nothing`, () => {
      const spot = spotOf(f, true);
      installOn(VILLAIN, f);
      const off = decide(spot);
      installOn(VILLAIN, f);
      const seen: string[] = [];
      const real = HorseMind.styleRead.bind(HorseMind);
      vi.spyOn(HorseMind, 'styleRead').mockImplementation((u: string) => (seen.push(u), real(u)));
      const on = decide(spot, ON);
      vi.restoreAllMocks();
      expect(new Set(seen)).toEqual(new Set([VILLAIN]));
      expect(on.fires.style_bluff_catch_cap_seen, id).toBeGreaterThan(0);
      const rank: Record<string, number> = { fold: 0, call: 1, raise: 2, all_in: 3 };
      expect(rank[on.decision.action], id).toBeLessThanOrEqual(rank[off.decision.action]);
      console.log(`multiway ${id}: OFF ${off.decision.action}, ON ${on.decision.action}`);

      installOn(THIRD, f);
      const offT = decide(spot);
      installOn(THIRD, f);
      const onT = decide(spot, ON);
      expect(onT.fires.style_bluff_catch_cap_seen ?? 0, id).toBe(0);
      expect(onT.digest, id).toBe(offT.digest);
    });
  }
  it('heads-up variants are unchanged by the multiway support (same six still fold)', () => {
    for (const id of IDS) {
      const f = FX.find((x) => x.id === id)!;
      install(villainOf(f), f.format);
      supply(f.format);
      expect(decide(spotOf(f), ON).decision.action, id).toBe('fold');
    }
  });
});
