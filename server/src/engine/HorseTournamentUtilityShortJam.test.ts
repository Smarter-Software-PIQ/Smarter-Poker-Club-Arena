/**
 * The short stack's shove through the all-in button is priced by the
 * tournament utility in pot limit and fixed limit (reported 2026-11-14 by the
 * Feature Activation lane's decision spot matrix).
 *
 * A Horse with more than the call and less than the minimum bet or raise
 * holds a menu with the all-in button and no sized wager (both raise bounds
 * null). The controller executes that button as a wager of the whole stack.
 * The candidate builder built a pot-limit or fixed-limit jam only against a
 * numeric ceiling, so the shove was missing from the candidates and a
 * reference decision of `all_in` was refused as `baseline_not_modeled`.
 * No-limit built it and was priced.
 *
 * The same menu is also what a capped fixed-limit street and a seat that may
 * not reopen show, where the button is a call. So the builder is told, by
 * `shortAllInWagers`, and HorseLogic.phase7ShortAllInWagers answers it from
 * the controller's own clamp rule. Held here:
 * - the builder builds the whole-stack jam when told, and nothing new when
 *   not told (the joint owners, which do not say it, keep their candidates);
 * - the utility prices a reference `all_in` on that menu, exactly as no-limit
 *   prices the same shove, with fold equity set by the price of the raise;
 * - no-limit candidates are identical with and without the claim;
 * - on real HandController menus the claim is true exactly when pressing the
 *   button commits the whole stack, in both structures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, phase7ShortAllInWagers, type HorseDecideOpts } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import {
  buildTournamentActionCandidates,
  evaluateTournamentUtilityDetailed,
  type TournamentUtilityInput,
} from './HorseTournamentUtility.js';
import { horseTournamentUtilityInputSha256 } from './HorseTournamentUtilityEvidence.js';
import { HandController } from './HandController.js';
import { calculatePots } from './PokerEngine.js';
import { remainingVariantSpot } from '../benchmark/RemainingVariantPolicyEvidence.js';
import {
  controllerDecisionState,
  controllerSpotRandom,
} from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { forEachJointControllerSpot } from './multiway/JointControllerSpots.test-support.js';
import type { ActionType, HandConfig, SeatPlayer } from '../types.js';

type Structure = TournamentUtilityInput['bettingStructure'];
type BuilderInput = Parameters<typeof buildTournamentActionCandidates>[0];

function seat(id: string, seatNumber: number, stack: number, bet: number): SeatPlayer {
  return {
    seat: seatNumber,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: bet,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
}

/** Heads-up, the villain has 200 in and the hero 100 with 150 behind: 100 to
 * call, 250 all-in, and the minimum raise is to 300. */
function builderInput(structure: Structure, overrides: Partial<BuilderInput> = {}): BuilderInput {
  return {
    hero: seat('hero', 1, 150, 100),
    toCall: 100,
    legalActions: ['fold', 'call', 'all_in'],
    minRaiseTo: null,
    maxRaiseTo: null,
    pot: 300,
    currentBet: 200,
    bettingStructure: structure,
    baseline: { action: 'all_in', thinkTime: 0 },
    settlement: { chipUnit: 1 },
    ...overrides,
  };
}

function utilityInput(
  structure: Structure,
  overrides: Partial<TournamentUtilityInput> = {}
): TournamentUtilityInput {
  const hero = seat('hero', 1, 150, 100);
  const villain = seat('villain', 2, 800, 200);
  const players = [hero, villain];
  return {
    street: 'river',
    hero,
    players,
    pots: calculatePots(players),
    pot: 300,
    currentBet: 200,
    toCall: 100,
    legalActions: ['fold', 'call', 'all_in'],
    minRaiseTo: null,
    maxRaiseTo: null,
    bettingStructure: structure,
    baseline: { action: 'all_in', thinkTime: 0 },
    heroEquity: 0.48,
    equitySampleSize: 320,
    equityStandardError: 0.028,
    opponents: [{ userId: 'villain', range: [0.12, 0.44], foldMul: 1, actsAfterHero: true }],
    sampledOpponentIds: ['villain'],
    showdownSamples: Array.from({ length: 100 }, (_, sample) => ({
      boards: [
        {
          heroHigh: sample < 48 ? 2 : 1,
          opponentHigh: [sample < 48 ? 1 : 2],
          opponentDecisionStrength: [0.5],
          heroLow: null,
          opponentLow: [null],
        },
      ],
    })),
    context: {
      format: 'mtt',
      playersLeft: 3,
      spotsPaid: 2,
      satellite: false,
      satelliteSeats: 0,
      payoutPct: [65, 35],
      fieldStacks: [250, 1_000, 100],
      fieldStackByUser: {},
      isPko: false,
      isBounty: false,
      isMysteryBounty: false,
      mysteryBountyStage: 'none',
      bountyFactor: 0,
      bountyByUser: {},
      mysteryMeanCents: 0,
      meanBountyCents: 0,
      prizePoolCents: 10_000,
      bountyPoolCents: 0,
      reentryOpen: false,
      rebuyOpen: false,
      maxReentries: 0,
      maxRebuys: 0,
      addOnPeriodOpen: false,
      addOnCostCents: null,
      addOnChips: null,
      buyInCents: null,
      startingStackChips: null,
      rebuyCostCents: null,
      rebuyChips: null,
      rebuyPrizeContributionCents: null,
      rebuyBountyContributionCents: null,
      reloadsUsed: 0,
      addOnTaken: false,
      rebuyAffordable: false,
      addOnAffordable: false,
    },
    ...overrides,
  };
}

const LIMITED = ['pot_limit', 'fixed_limit'] as const;

describe('the candidate builder builds the short all-in the controller executes', () => {
  it.each(LIMITED)('%s: told the button wagers, it builds the whole-stack jam', (structure) => {
    const built = buildTournamentActionCandidates(
      builderInput(structure, { shortAllInWagers: true })
    );
    expect(built.map((c) => c.id)).toEqual(['fold', 'call', 'jam']);
    expect(built.find((c) => c.id === 'jam')).toEqual({
      id: 'jam',
      kind: 'jam',
      action: 'all_in',
      amount: null,
      investment: 150,
    });
  });

  it.each(LIMITED)('%s: a stack below the minimum bet shoves when checked to', (structure) => {
    const built = buildTournamentActionCandidates(
      builderInput(structure, {
        hero: seat('hero', 1, 15, 0),
        toCall: 0,
        currentBet: 0,
        pot: 60,
        legalActions: ['check', 'all_in'],
        shortAllInWagers: true,
      })
    );
    expect(built.map((c) => [c.id, c.action, c.investment])).toEqual([
      ['check', 'check', 0],
      ['jam', 'all_in', 15],
    ]);
  });

  it.each(LIMITED)('%s: not told, it builds no jam, exactly as before', (structure) => {
    // The joint owners call the builder without the claim. The same menu is a
    // capped fixed-limit street's, where the button is a call.
    expect(buildTournamentActionCandidates(builderInput(structure)).map((c) => c.id)).toEqual([
      'fold',
      'call',
    ]);
  });

  it.each(LIMITED)('%s: an all-in for less than the call is the call, already', (structure) => {
    for (const legalActions of [
      ['fold', 'all_in'],
      ['fold', 'call', 'all_in'],
    ] as ActionType[][]) {
      const built = buildTournamentActionCandidates(
        builderInput(structure, { hero: seat('hero', 1, 60, 100), toCall: 60, legalActions })
      );
      expect(built.map((c) => [c.id, c.action, c.investment])).toEqual([
        ['fold', 'fold', 0],
        ['call:all-in', 'all_in', 60],
      ]);
    }
  });

  it('no-limit and every menu with a ceiling: the claim changes no candidate', () => {
    const deep = { hero: seat('hero', 1, 900, 100), toCall: 100 };
    const menus: BuilderInput[] = [
      builderInput('no_limit'),
      builderInput('no_limit', { hero: seat('hero', 1, 15, 0), toCall: 0, currentBet: 0 }),
      builderInput('no_limit', { hero: seat('hero', 1, 60, 100), toCall: 60 }),
      ...(['no_limit', 'pot_limit', 'fixed_limit'] as const).map((structure) =>
        builderInput(structure, {
          ...deep,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 300,
          maxRaiseTo: structure === 'fixed_limit' ? 300 : structure === 'pot_limit' ? 700 : 1_000,
          baseline: { action: 'call', amount: 100, thinkTime: 0 },
        })
      ),
    ];
    for (const menu of menus) {
      const before = buildTournamentActionCandidates(menu);
      expect(buildTournamentActionCandidates({ ...menu, shortAllInWagers: true })).toEqual(before);
    }
    // The no-limit short shove itself, pinned: it was always built.
    expect(buildTournamentActionCandidates(menus[0])).toEqual([
      { id: 'fold', kind: 'fold', action: 'fold', amount: null, investment: 0 },
      { id: 'call', kind: 'call', action: 'call', amount: null, investment: 100 },
      { id: 'jam', kind: 'jam', action: 'all_in', amount: null, investment: 150 },
    ]);
  });
});

describe('the tournament utility prices a reference all-in on the short menu', () => {
  const noLimit = evaluateTournamentUtilityDetailed(utilityInput('no_limit'));

  it('no-limit prices it (the control)', () => {
    expect(noLimit.unavailableReason).toBeNull();
    expect(noLimit.result!.ledger.candidates.map((row) => row.id)).toEqual(['fold', 'call', 'jam']);
  });

  it.each(LIMITED)('%s: priced, no longer baseline_not_modeled', (structure) => {
    const evaluated = evaluateTournamentUtilityDetailed(
      utilityInput(structure, { shortAllInWagers: true })
    );
    expect(evaluated.unavailableReason).toBeNull();
    const rows = evaluated.result!.ledger.candidates;
    expect(rows.map((row) => row.id)).toEqual(['fold', 'call', 'jam']);
    const jam = rows.find((row) => row.id === 'jam')!;
    expect(jam.action).toBe('all_in');
    expect(jam.investment).toBe(150);
    // The same shove, the same price as no-limit gives it: the responder may
    // only call or fold, and what it folds is set by the 50 more it must pay
    // into a pot of 450, never by a full raise the hero cannot make.
    expect(jam).toEqual(noLimit.result!.ledger.candidates.find((row) => row.id === 'jam'));
    expect(jam.allFoldProbability).toBeGreaterThanOrEqual(0);
    expect(jam.allFoldProbability).toBeLessThan(0.2);
  });

  it.each(LIMITED)('%s: without the claim the shove is still refused by name', (structure) => {
    // A capped street or a seat that may not reopen: the button is a call and
    // is not priced as a shove.
    const evaluated = evaluateTournamentUtilityDetailed(utilityInput(structure));
    expect(evaluated.result).toBeNull();
    expect(evaluated.unavailableReason).toBe('baseline_not_modeled');
  });

  it('a claim on any other menu is an invalid input', () => {
    for (const wrong of [
      { legalActions: ['fold', 'call'] as ActionType[] },
      { legalActions: ['fold', 'call', 'raise', 'all_in'] as ActionType[] },
      { minRaiseTo: 300, maxRaiseTo: 300 },
      { toCall: 150 },
    ]) {
      const evaluated = evaluateTournamentUtilityDetailed(
        utilityInput('pot_limit', { shortAllInWagers: true, ...wrong })
      );
      expect(evaluated.unavailableReason).toBe('invalid_input');
    }
  });

  it('the claim is committed in the input hash, and only when made', () => {
    const plain = utilityInput('pot_limit');
    expect(horseTournamentUtilityInputSha256({ ...plain, shortAllInWagers: undefined })).toBe(
      horseTournamentUtilityInputSha256(plain)
    );
    expect(horseTournamentUtilityInputSha256({ ...plain, shortAllInWagers: true })).not.toBe(
      horseTournamentUtilityInputSha256(plain)
    );
  });
});

function pinDeckEntropy(seed: number) {
  const random = controllerSpotRandom(seed);
  vi.stubGlobal('crypto', {
    getRandomValues(target: Uint32Array) {
      for (let i = 0; i < target.length; i++) target[i] = Math.floor(random() * 0x100000000) >>> 0;
      return target;
    },
  });
}
afterEach(() => vi.unstubAllGlobals());

const opts: HorseDecideOpts = {
  telemetry: false,
  mind: false,
  decisionTimeMs: 0,
  phase8Postflop: 'off',
  phase10Plo4: 'off',
  phase11Omaha: 'off',
  phase12Remaining: 'off',
  phase13Joint: 'off',
};

describe('on real controller menus the claim is the executed all-in', () => {
  it.each([
    ['plo4', 'pot_limit'],
    ['plo8', 'pot_limit'],
    ['flh', 'fixed_limit'],
    ['flo8', 'fixed_limit'],
  ] as const)(
    '%s tournament: true exactly when the button commits the whole stack, and then priced',
    (variant, structure) => {
      pinDeckEntropy(0x5a170000 ^ variant.length ^ (variant.charCodeAt(2) << 8));
      let shoves = 0,
        calls = 0,
        priced = 0,
        decided = 0;
      const wrong: unknown[] = [];
      forEachJointControllerSpot(variant, 'tournament', 700, 0x5a17 + variant.length, (spot) => {
        const { hero, state: s, controller } = spot;
        const legal = s.legalActions ?? [];
        const toCall = s.toCall ?? 0;
        if (
          !legal.includes('all_in') ||
          legal.includes('bet') ||
          legal.includes('raise') ||
          s.minRaiseTo !== null ||
          s.maxRaiseTo !== null ||
          hero.stack <= toCall + 0.005
        )
          return;
        expect(s.bettingStructure).toBe(structure);
        const claim = phase7ShortAllInWagers(s, hero, structure);

        // The Horse decides this spot with the live tournament context.
        if (claim && decided < 6) {
          decided++;
          const live = s.players.filter((p) => !p.is_sitting_out);
          s.tournament = {
            ...remainingVariantSpot('flh', 'river', 4, 'tournament').state.tournament!,
            gameVariant: variant,
            currentSmallBlind: s.bigBlind / 2,
            currentBigBlind: s.bigBlind,
            playersLeft: live.length,
            spotsPaid: Math.max(1, Math.floor(live.length / 2)),
            payoutPct: live.length > 3 ? [65, 35] : [100],
            stacks: live.map((p) => p.stack + p.totalInvested),
            stackByUser: Object.fromEntries(
              live.map((p) => [p.user_id, p.stack + p.totalInvested])
            ),
          } as typeof s.tournament;
          seedFastRandom(0x5a18);
          const decision = HorseLogic.decide(hero, s, 'balanced', {}, opts);
          if (decision.tournamentUtilityRefusal === 'baseline_not_modeled')
            wrong.push({ stage: s.stage, refused: decision.action });
          const rows = decision.tournamentUtility?.candidates;
          if (rows) {
            const jam = rows.find((r) => r.id === 'jam');
            if (!jam || jam.action !== 'all_in' || Math.abs(jam.investment - hero.stack) > 1e-9)
              wrong.push({ stage: s.stage, jam, stack: hero.stack });
            else priced++;
          }
        }

        // Press the button on the real controller: what did it execute?
        // The accepted action record says so: `all_in` raising to the whole
        // stack, or the `call` the clamp turned the button into. (The stack
        // afterwards does not: an uncalled excess is returned at once.)
        const allInTo = hero.bet + hero.stack;
        const accepted = controller.performAction(hero.seat, 'all_in');
        const record = controller.getState().actionHistory.at(-1)!;
        const committedStack =
          accepted &&
          record.seat === hero.seat &&
          record.action === 'all_in' &&
          Math.abs(record.amount - allInTo) < 0.005;
        if (committedStack) shoves++;
        else calls++;
        if (!accepted || claim !== committedStack)
          wrong.push({
            stage: s.stage,
            claim,
            accepted,
            allInTo,
            executed: [record.seat, record.action, record.amount],
            toCall,
            capped: s.wagersCapped,
          });
      });
      expect(wrong.slice(0, 3)).toEqual([]);
      expect(wrong.length).toBe(0);
      expect(shoves).toBeGreaterThan(0);
      // Pot limit shows this menu only for the whole-stack shove; fixed limit
      // also shows it where the button is a call.
      if (structure === 'pot_limit') expect(calls).toBe(0);
      else expect(calls).toBeGreaterThan(0);
      expect(priced).toBeGreaterThan(0);
    },
    240_000
  );

  it.each(['flh', 'flo8'] as const)(
    '%s: uncapped, a seat that may not reopen holds the same menu and the button is a call',
    (variant) => {
      // The flop bettor faces a short all-in raise of less than half a bet:
      // 5 more to call, no raise allowed, a deep stack behind. The menu is
      // fold, call and all_in with no bounds on a street that is not capped,
      // and the controller executes the button as the call.
      const config: HandConfig = {
        tableId: `short-jam-${variant}`,
        handNumber: 1,
        gameVariant: variant,
        smallBlind: 10,
        bigBlind: 20,
        ante: 0,
        isTournament: true,
        rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
      };
      let reached = 0;
      for (let shortSeat = 1; shortSeat <= 3; shortSeat++) {
        pinDeckEntropy(0x5a190000 + shortSeat);
        const players: SeatPlayer[] = [1, 2, 3].map((n) => ({
          ...seat(`reopen-${variant}-${n}`, n, n === shortSeat ? 45 : 2_000, 0),
          is_horse: true,
        }));
        const controller = new HandController(config, players, 1);
        controller.start();
        const spotNow = () => controllerDecisionState(controller, variant, 'tournament', config);
        let spot = spotNow();
        // Preflop: everyone calls or checks.
        while (spot && spot.state.stage === 'preflop') {
          const passive = spot.state.legalActions!.includes('check') ? 'check' : 'call';
          expect(controller.performAction(spot.hero.seat, passive)).toBe(true);
          spot = spotNow();
        }
        if (!spot || spot.state.stage !== 'flop' || spot.hero.seat === shortSeat) continue;
        const bettor = spot.hero.seat;
        expect(controller.performAction(bettor, 'bet', spot.state.minRaiseTo!)).toBe(true);
        spot = spotNow();
        if (!spot || spot.hero.seat !== shortSeat) continue;
        // 25 behind against a bet of 20: all-in to 25, a raise of 5.
        expect(spot.hero.stack).toBe(25);
        expect(controller.performAction(shortSeat, 'all_in')).toBe(true);
        spot = spotNow();
        if (spot && spot.hero.seat !== bettor) {
          expect(controller.performAction(spot.hero.seat, 'fold')).toBe(true);
          spot = spotNow();
        }
        expect(spot?.hero.seat).toBe(bettor);
        const { hero, state: s } = spot!;
        expect(s.legalActions).toEqual(['fold', 'call', 'all_in']);
        expect([s.minRaiseTo, s.maxRaiseTo, s.wagersCapped, s.toCall]).toEqual([
          null,
          null,
          false,
          5,
        ]);
        expect(hero.stack).toBeGreaterThan(1_000);
        expect(phase7ShortAllInWagers(s, hero, 'fixed_limit')).toBe(false);
        expect(controller.performAction(bettor, 'all_in')).toBe(true);
        const record = controller.getState().actionHistory.at(-1)!;
        expect([record.seat, record.action, record.amount]).toEqual([bettor, 'call', 5]);
        reached++;
      }
      expect(reached).toBeGreaterThan(0);
    }
  );
});
