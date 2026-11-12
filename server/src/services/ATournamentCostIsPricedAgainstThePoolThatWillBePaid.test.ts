/**
 * A TOURNAMENT COST IS PRICED AGAINST THE POOL THAT WILL BE PAID.
 *
 * Finding HVH2D-NLH-001 (two-day Human vs Horse study, 2026-11-12). In an
 * All-In-Or-Fold Free Buy with a 500-chip guarantee, two Horses folded AKo
 * first in at 60 big blinds, 67 seconds apart. The production journal shows
 * the reference policy chose the jam both times and the tournament utility
 * arbiter replaced it with a fold. Its jam candidate carried an option value
 * of about -34 pool points: the cost of the automatic 1-chip rebuy after a
 * bust, priced as 100% of the prize pool, because `tournaments.prize_pool`
 * held the 1 chip collected so far and the context builder fed that figure
 * as the pool. The pool that event paid was its 500-chip guarantee.
 *
 * `deriveContext` now prices the larger of the collected pool and the
 * advertised guarantee until the pool is finalized, and reports what a
 * recovery adds to THAT pool.
 *
 * The decision half replays the anonymised decision-time request from the
 * journal. With the feed as recorded the arbiter folds, exactly as production
 * did; with the corrected feed the jam stands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { deriveContext } from './TournamentBrainContext.js';
import { HorseLogic, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import type { SeatPlayer } from '../types.js';
import FIXTURE from './ATournamentCostIsPricedAgainstThePoolThatWillBePaid.fixture.json';

const row = (over: Record<string, unknown> = {}) => ({
  format_contract: 'mtt-v2',
  effective_max_players: 1000,
  tournament_type: 'MTT',
  game_type: 'NLH',
  variant: 'freezeout',
  max_players: null,
  table_size: 9,
  payout_structure: [
    { place: 1, percentage: 50 },
    { place: 2, percentage: 30 },
    { place: 3, percentage: 20 },
  ],
  prize_pool: 1,
  prize_pool_finalized: false,
  bounty_pool: 0,
  is_pko: false,
  is_bounty: false,
  buy_in_amount: 0,
  buy_in_fee: 0,
  rebuy_cost: 1,
  rebuy_chips: 3000,
  starting_chips: 3000,
  ...over,
});

const context = (over: Record<string, unknown> = {}) =>
  deriveContext(row(over) as never, 441, 441, 3000);

describe('the priced pool is the pool that will be paid', () => {
  it('prices an unmet guarantee, not the chips collected so far', () => {
    expect(context().prizePoolCents).toBe(100);
    expect(context({ guaranteed_prize: 500 }).prizePoolCents).toBe(50_000);
    expect(context({ guaranteed_prize: '500' }).prizePoolCents).toBe(50_000);
  });

  it('prices the collected pool once it has passed the guarantee', () => {
    expect(context({ prize_pool: 800, guaranteed_prize: 500 }).prizePoolCents).toBe(80_000);
  });

  it('reads a finalized pool as written, whatever the guarantee says', () => {
    expect(
      context({ prize_pool: 500, prize_pool_finalized: true, guaranteed_prize: 700 }).prizePoolCents
    ).toBe(50_000);
  });

  it.each([undefined, null, 0, -5, 'not a number'])(
    'changes nothing for an event with no readable guarantee: %s',
    (guarantee) => {
      const before = context();
      const after = context({ guaranteed_prize: guarantee });
      expect(after.prizePoolCents).toBe(before.prizePoolCents);
      expect(after.rebuyPrizeContributionCents).toBe(before.rebuyPrizeContributionCents);
    }
  );

  it('counts only what a recovery adds to the paid pool', () => {
    const nominal = context().rebuyPrizeContributionCents;
    expect(nominal).not.toBeNull();
    expect(nominal as number).toBeGreaterThan(0);
    // Deep under the guarantee the purchase only fills the overlay.
    expect(context({ guaranteed_prize: 500 }).rebuyPrizeContributionCents).toBe(0);
    // Past the guarantee the whole contribution grows the pool.
    expect(context({ prize_pool: 800, guaranteed_prize: 500 }).rebuyPrizeContributionCents).toBe(
      nominal
    );
    // Crossing it, only the part above the guarantee does.
    const crossing = context({ prize_pool: 499.5, guaranteed_prize: 500 });
    expect(crossing.prizePoolCents).toBe(50_000);
    expect(crossing.rebuyPrizeContributionCents).toBe(
      Math.max(0, 49_950 + (nominal as number) - 50_000)
    );
  });

  it('builds, from the production row values, the feed the decision below is replayed with', () => {
    const built = context({ guaranteed_prize: FIXTURE.recorded.guaranteedPrizeUnits });
    expect(FIXTURE.recorded.collectedPrizeUnits).toBe(1);
    expect(FIXTURE.recorded.prizePoolCents).toBe(100);
    expect(built.prizePoolCents).toBe(50_000);
    expect(built.rebuyPrizeContributionCents).toBe(0);
  });
});

interface UtilityCandidate {
  id: string;
  bustProbability: number;
  optionEv: number;
  combinedUtility: number;
}

function decide(feed: { prizePoolCents: number; rebuyPrizeContributionCents: number }) {
  const gs = structuredClone(FIXTURE.gameState) as unknown as HorseGameStateV2;
  const player = structuredClone(FIXTURE.player) as unknown as SeatPlayer;
  Object.assign(gs.tournament as object, feed);
  seedFastRandom(1);
  HorseMind.reset();
  const decision = HorseLogic.decide(player, gs, FIXTURE.style as never, FIXTURE.mods as never, {});
  const utility = (
    decision as unknown as {
      tournamentUtility?: { baselineAction: string; candidates: UtilityCandidate[] };
    }
  ).tournamentUtility;
  const jam = utility?.candidates.find((c) => c.id === 'jam');
  const fold = utility?.candidates.find((c) => c.id === 'fold');
  return { action: decision.action, baseline: utility?.baselineAction, jam, fold };
}

describe('the AKo jam the arbiter folded (HVH2D-NLH-001)', () => {
  afterEach(() => HorseMind.reset());

  it('is an All-In-Or-Fold first-in spot at 60 big blinds with the rebuy open', () => {
    const gs = FIXTURE.gameState;
    expect(gs.allInOrFold).toBe(true);
    expect(gs.legalActions).toEqual(['fold', 'all_in']);
    expect(FIXTURE.player.stack / gs.bigBlind).toBe(60);
    expect(gs.tournament.rebuyOpen).toBe(true);
    expect(gs.tournament.prizePoolFinalized).toBe(false);
  });

  it('with the collected pool as the feed, the rebuy costs the whole pool and the jam is folded', () => {
    const recorded = decide({
      prizePoolCents: FIXTURE.recorded.prizePoolCents,
      rebuyPrizeContributionCents: FIXTURE.recorded.rebuyPrizeContributionCents,
    });
    expect(recorded.baseline).toBe('all_in');
    expect(recorded.jam).toBeDefined();
    // About -99.6 pool points per bust: a 1-chip rebuy against a 1-chip pool.
    expect(recorded.jam!.optionEv / recorded.jam!.bustProbability).toBeLessThan(-90);
    expect(recorded.action).toBe('fold');
  });

  it('with the pool that will be paid as the feed, the same request keeps the jam', () => {
    const corrected = decide({ prizePoolCents: 50_000, rebuyPrizeContributionCents: 0 });
    expect(corrected.baseline).toBe('all_in');
    expect(corrected.jam).toBeDefined();
    // The same rebuy is 0.2% of the pool; the option is worth almost nothing either way.
    expect(Math.abs(corrected.jam!.optionEv)).toBeLessThan(0.05);
    // On this sample the two candidates are now within a hundredth of a pool
    // point of each other, far inside the estimate's own uncertainty, so the
    // arbiter has no grounds to overrule the reference policy.
    expect(Math.abs(corrected.jam!.combinedUtility - corrected.fold!.combinedUtility)).toBeLessThan(
      0.05
    );
    expect(corrected.action).toBe('all_in');
  });
});
