/**
 * A BOUNTY-ONLY EVENT KEEPS THE REFERENCE ACTION.
 *
 * Finding HVH2D-TRN-001, direction 2 (two-day Human vs Horse study,
 * 2026-11-12). In a Midday Free Buy, a progressive knockout with no prize
 * pool (every chip of value is a head), the tournament utility arbiter
 * replaced folds, checks and small raises with all-ins 23 times in the
 * exported originals: 34o at 115 big blinds, K5o at 111, with a human in the
 * hand in most of them.
 *
 * The arbiter weights payout by prize / (prize + bounty). With no prize pool
 * that weight is zero, so chips have no modeled worth and the only thing
 * counted is the head won or lost in this hand. A stack that covers the table
 * cannot bust, so its all-in scores as a free shot at a head, even when the
 * same candidate loses chips on average. The priced pool of zero is correct
 * for this event; the model is outside its range.
 *
 * The arbiter now reports `chip_value_not_modeled` for such an event and the
 * reference action stands. A bounty event that also has a prize pool is
 * evaluated exactly as before.
 *
 * The request is the anonymised decision-time body of hand f4b00018 from the
 * production journal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import type { SeatPlayer } from '../types.js';
import FIXTURE from './ABountyOnlyEventKeepsTheReferenceAction.fixture.json';

interface Decided {
  action: string;
  tournamentUtility?: { baselineAction: string; selectedAction: string };
  tournamentUtilityRefusal?: string;
}

function decide(
  feed: Record<string, number | boolean> = {},
  shape: (gs: HorseGameStateV2, player: SeatPlayer) => void = () => {}
): Decided {
  const gs = structuredClone(FIXTURE.gameState) as unknown as HorseGameStateV2;
  const player = structuredClone(FIXTURE.player) as unknown as SeatPlayer;
  Object.assign(gs.tournament as object, feed);
  shape(gs, player);
  seedFastRandom(1);
  HorseMind.reset();
  return HorseLogic.decide(
    player,
    gs,
    FIXTURE.style as never,
    FIXTURE.mods as never,
    {}
  ) as unknown as Decided;
}

describe('a bounty-only event keeps the reference action (HVH2D-TRN-001 direction 2)', () => {
  afterEach(() => HorseMind.reset());

  it('is 34o at 115 big blinds, covering the table, in a knockout with no prize pool', () => {
    const gs = FIXTURE.gameState;
    const hero = FIXTURE.player;
    expect(hero.cards.map((c) => c.rank).sort()).toEqual(['3', '4']);
    expect(Math.round(hero.stack / gs.bigBlind)).toBe(115);
    const others = gs.players.filter((p) => p.seat !== hero.seat).map((p) => p.stack);
    expect(Math.max(...others)).toBeLessThan(hero.stack);
    expect(gs.tournament.isPko).toBe(true);
    expect(gs.tournament.prizePoolCents).toBe(0);
    expect(gs.tournament.bountyPoolCents).toBe(49_500);
  });

  it('folds, and says the arbiter did not evaluate because chips have no modeled worth', () => {
    const decision = decide();
    // Before the correction this request returned a raise: reference fold,
    // tournament_utility all_in (+0.066 pool points of head value against a
    // chip expectation of -198), wager_rules raise.
    expect(decision.action).toBe('fold');
    expect(decision.tournamentUtility).toBeUndefined();
    expect(decision.tournamentUtilityRefusal).toBe('chip_value_not_modeled');
  });

  it('still evaluates the same knockout once it has a prize pool', () => {
    const decision = decide({ prizePoolCents: 50_000 });
    expect(decision.tournamentUtilityRefusal).toBeUndefined();
    expect(decision.tournamentUtility?.baselineAction).toBe('fold');
    expect(decision.action).toBe('fold');
  });
});

describe('where the stand-down applies and where it does not', () => {
  afterEach(() => HorseMind.reset());
  const REFUSAL = 'chip_value_not_modeled';

  it('returns a legal action from the reference when it stands down', () => {
    const decision = decide();
    expect(FIXTURE.gameState.legalActions).toContain(decision.action);
    const graph = (decision as unknown as { policyGraph: { finalAction: { action: string } } })
      .policyGraph;
    expect(graph.finalAction.action).toBe(decision.action);
  });

  it('stands down for a covered stack too, not only for one that covers the table', () => {
    // Move 4,000 chips from hero to one opponent: the table total is unchanged.
    const decision = decide({}, (gs, player) => {
      const hero = gs.players.find((p) => p.seat === player.seat)!;
      const other = gs.players.find((p) => p.seat !== player.seat && !p.is_folded)!;
      hero.stack -= 4_000;
      player.stack -= 4_000;
      other.stack += 4_000;
      expect(other.stack).toBeGreaterThan(hero.stack);
    });
    expect(decision.tournamentUtilityRefusal).toBe(REFUSAL);
    expect(FIXTURE.gameState.legalActions).toContain(decision.action);
  });

  it('does not apply to a knockout with any prize pool, however small', () => {
    expect(decide({ prizePoolCents: 100 }).tournamentUtilityRefusal).not.toBe(REFUSAL);
  });

  it('does not apply to an event with no bounty pool', () => {
    const decision = decide({
      isPko: false,
      isBounty: false,
      bountyPoolCents: 0,
      bountyFactor: 0,
      meanBountyCents: 0,
      rebuyBountyContributionCents: 0,
    });
    expect(decision.tournamentUtilityRefusal).not.toBe(REFUSAL);
  });

  it('does not apply to a satellite, whose seats are tickets recorded apart from the pool', () => {
    const decision = decide({ satellite: true, satelliteSeats: 1 });
    expect(decision.tournamentUtilityRefusal).not.toBe(REFUSAL);
  });
});
