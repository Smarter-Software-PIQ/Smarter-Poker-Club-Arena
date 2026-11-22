/**
 * LAW: A HOLD'EM ALL-IN CALL REFERENCE RECEIPT MATCHES ITS ACTIVE REFERENCE OWNER (2026-11-22).
 *
 * When `holdemTournamentAllInCallIsPriced` takes ownership of a preflop fold or call whose prior
 * named source route was `chart_open_jam` or `variant_price` (for example a maniac preflop shove
 * priced on `variant_price`, or a short stack facing a posted blind all-in on `chart_open_jam`),
 * `holdemAllInCallReference` clears the named route so `referenceReturnShape` does not reject the
 * priced call or fold as an invalid shape of the replaced route.
 *
 * Production bug (2026-11-22, 156 refused Horse decisions, `recoverableRequestErrors=39` on
 * `ea92b56f0177`, `invalid policy receipt: reference_owner`): `holdemAllInCallReference` overwrote
 * `phase6Ref.route = 'legacy_preflop'` unconditionally. Under the live V7 preflop reference
 * (`opts.v7Preflop ?? opts.v7 !== false` === true), `horsePhase6AttributionMismatch` rejects
 * `route === 'legacy_preflop'` as `'reference_owner'`, causing `horse_decision_refused_isolated`
 * and liveness-fallback folds of valid priced calls.
 *
 * Root-cause invariant: clearing `chart_open_jam` / `variant_price` must assign the active preflop
 * reference owner (`'intent_engine'` when `opts.v7Preflop ?? opts.v7 !== false`, `'legacy_preflop'`
 * otherwise) with `lookup = null`, yielding zero worker receipt refusals (`horsePhase6AttributionMismatch`
 * === null and `horseDecisionReceiptRefusal` === null) while preserving identical poker decisions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HorseLogic,
  holdemAllInCallVerdictOfLastDecision,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { horsePhase6AttributionMismatch } from './HorsePhase6Attribution.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  BASE_DECISION_TIME_MS,
  BASE_MODS,
  BASE_STYLE,
  buildSpot,
} from './AHoldemTournamentAllInCallIsPriced.fixtures.js';
import AOF from './AnAofClosingSeatCallsFromTheNashTable.fixture.json';
import type { HorseDecision, SeatPlayer } from '../types.js';

const SEEDS = [1, 2, 3, 4, 5];

function spyManiacReadFor(userId: string) {
  const stat = (mean: number, engaged: 'high' | null) => ({
    mean,
    n: 60,
    engaged,
    excess: engaged ? 0.15 : 0,
  });
  const read = {
    version: 1,
    envelope: 'test',
    scope: {},
    stats: {
      vpip: stat(0.65, 'high'),
      pfr: stat(0.55, 'high'),
      rfi: stat(0.55, 'high'),
      threeBet: stat(0.2, 'high'),
      foldTo3Bet: stat(0.3, null),
      betCheckedTo: stat(0.6, null),
      foldToBet: stat(0.4, null),
      riverCall: stat(0.4, null),
    },
  };
  return vi
    .spyOn(HorseMind, 'opponentRead')
    .mockImplementation(((id: string) => (id === userId ? read : null)) as never);
}

/**
 * NLH tournament preflop spot that enters `variant_price` (`maniacPrice38`) when the option is off:
 * 6-max, maniac in CO (seat 4) shoves 10bb all-in, Hero in BB (seat 2) holds `heroCards` with 10bb.
 */
function buildVariantPriceSpot(heroCards: string) {
  const { gs, player } = buildSpot({
    bb: 200,
    seats: [1, 2, 3, 4, 5, 6],
    dealer: 6,
    hero: 2,
    heroCards,
    stacks: { 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 2000 },
    streets: {
      preflop: [
        [3, 'fold', 0],
        [4, 'all_in', 0],
        [5, 'fold', 0],
        [6, 'fold', 0],
        [1, 'fold', 0],
      ],
    },
    playersLeft: 200,
    spotsPaid: 30,
  });
  for (const a of gs.actionHistory ?? []) {
    if (a.seat === 4 && a.action === 'all_in') a.isFullRaise = true;
  }
  // Remove stale fixture provenance so the rebuilt snapshot validates cleanly as v1.
  delete (gs.tournament as unknown as Record<string, unknown>).contextProvenance;
  const raiserId = gs.players.find((p) => p.seat === 4)!.user_id;
  return { gs, player, raiserId };
}

/**
 * NLH tournament preflop spot that enters `chart_open_jam` when the option is off and is priced as
 * an all-in call when the option is on:
 * 6-max, BB (seat 2) posted its last 2bb (1bb dead ante + 1bb blind -> all-in with bet === currentBet,
 * no `all_in` in actionHistory, raises === 0). Hero on BTN (seat 6, 14bb) folds `heroCards` on
 * `chart_open_jam` when off, then `holdemAllInCallReference` prices the call/fold.
 */
function buildChartOpenJamSpot(heroCards: string) {
  const { gs, player } = buildSpot({
    bb: 200,
    seats: [1, 2, 3, 4, 5, 6],
    dealer: 6,
    hero: 6,
    heroCards,
    stacks: { 1: 2800, 2: 400, 3: 2800, 4: 2800, 5: 2800, 6: 2800 },
    streets: {
      preflop: [
        [3, 'fold', 0],
        [4, 'fold', 0],
        [5, 'fold', 0],
      ],
    },
    playersLeft: 200,
    spotsPaid: 30,
  });
  delete (gs.tournament as unknown as Record<string, unknown>).contextProvenance;
  return { gs, player };
}

function runDecision(
  gs: HorseGameStateV2,
  player: SeatPlayer,
  opts: HorseDecideOpts,
  seed: number
): HorseDecision {
  seedFastRandom(seed);
  return HorseLogic.decide(
    structuredClone(player),
    structuredClone(gs),
    BASE_STYLE as never,
    BASE_MODS as never,
    {
      decisionTimeMs: BASE_DECISION_TIME_MS,
      telemetry: true,
      ...opts,
    } as never
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('holdemAllInCallReference receipt ownership (regression for reference_owner refusals)', () => {
  it('variant_price (maniac all-in shove): valid intent_engine receipt under V7 default & explicit v7Preflop:true, valid legacy_preflop under v7:false, zero refusals', () => {
    for (const [heroCards, expectedVerdict] of [
      ['AsKd', 'call'],
      ['7c2d', 'fold'],
    ] as const) {
      const { gs, player, raiserId } = buildVariantPriceSpot(heroCards);
      spyManiacReadFor(raiserId);

      // Guard: confirm the spot genuinely traverses `variant_price` before the option is enabled.
      const off = runDecision(gs, player, { holdemTournamentAllInCallIsPriced: false }, 1);
      expect(off.tournamentPreflopAttribution?.route, heroCards).toBe('variant_price');

      for (const mode of [
        { name: 'v7 default', decideOpts: {}, requestOpts: {}, expectedRoute: 'intent_engine' },
        {
          name: 'explicit v7Preflop:true',
          decideOpts: { v7Preflop: true },
          requestOpts: { v7Preflop: true },
          expectedRoute: 'intent_engine',
        },
        {
          name: 'legacy v7:false',
          decideOpts: { v7: false },
          requestOpts: { v7: false },
          expectedRoute: 'legacy_preflop',
        },
      ] as const) {
        for (const seed of SEEDS) {
          const on = runDecision(
            gs,
            player,
            { ...mode.decideOpts, holdemTournamentAllInCallIsPriced: true },
            seed
          );
          const verdict = holdemAllInCallVerdictOfLastDecision();
          expect(verdict?.street, `${heroCards} ${mode.name} seed=${seed}`).toBe('preflop');
          expect(verdict?.price.verdict, `${heroCards} ${mode.name} seed=${seed}`).toBe(
            expectedVerdict
          );

          // Exact poker decision preserved (call/all_in for call verdict, fold for fold verdict).
          if (expectedVerdict === 'call') {
            expect(['call', 'all_in'], `${heroCards} ${mode.name} seed=${seed}`).toContain(
              on.action
            );
          } else {
            expect(on.action, `${heroCards} ${mode.name} seed=${seed}`).toBe('fold');
          }

          // Zero worker receipt refusals — simulating both direct request opts AND switch-delivered
          // opts (where `requestOpts` does not carry `holdemTournamentAllInCallIsPriced`).
          expect(
            horsePhase6AttributionMismatch(on, {
              player,
              gameState: gs,
              opts: mode.requestOpts,
            }),
            `${heroCards} ${mode.name} seed=${seed}`
          ).toBeNull();
          expect(
            horseDecisionReceiptRefusal(on, 'nlh', { player, gameState: gs } as never),
            `${heroCards} ${mode.name} seed=${seed}`
          ).toBeNull();

          // Receipt route matches the active reference owner and lookup is cleared.
          const attr = on.tournamentPreflopAttribution;
          expect(attr, `${heroCards} ${mode.name} seed=${seed}`).toBeDefined();
          expect(attr!.route, `${heroCards} ${mode.name} seed=${seed}`).toBe(mode.expectedRoute);
          expect(attr!.lookup, `${heroCards} ${mode.name} seed=${seed}`).toBeNull();
          expect(attr!.forwardedToIntentEngine, `${heroCards} ${mode.name} seed=${seed}`).toBe(
            false
          );
        }
      }
    }
  });

  it('chart_open_jam (short stack facing posted BB all-in): valid intent_engine receipt under V7 default & explicit v7Preflop:true, valid legacy_preflop under v7:false, zero refusals', () => {
    for (const [heroCards, expectedVerdict] of [
      ['Qs7d', 'call'],
      ['7c2d', 'fold'],
    ] as const) {
      const { gs, player } = buildChartOpenJamSpot(heroCards);
      expect(gs.players.find((p) => p.seat === 2)?.is_all_in).toBe(true);

      // Guard: confirm the spot genuinely traverses `chart_open_jam` and returns fold when off.
      const off = runDecision(gs, player, { holdemTournamentAllInCallIsPriced: false }, 1);
      expect(off.tournamentPreflopAttribution?.route, heroCards).toBe('chart_open_jam');
      expect(off.action, heroCards).toBe('fold');

      for (const mode of [
        { name: 'v7 default', decideOpts: {}, requestOpts: {}, expectedRoute: 'intent_engine' },
        {
          name: 'explicit v7Preflop:true',
          decideOpts: { v7Preflop: true },
          requestOpts: { v7Preflop: true },
          expectedRoute: 'intent_engine',
        },
        {
          name: 'legacy v7:false',
          decideOpts: { v7: false },
          requestOpts: { v7: false },
          expectedRoute: 'legacy_preflop',
        },
      ] as const) {
        for (const seed of SEEDS) {
          const on = runDecision(
            gs,
            player,
            { ...mode.decideOpts, holdemTournamentAllInCallIsPriced: true },
            seed
          );
          const verdict = holdemAllInCallVerdictOfLastDecision();
          expect(verdict?.street, `${heroCards} ${mode.name} seed=${seed}`).toBe('preflop');
          expect(verdict?.price.verdict, `${heroCards} ${mode.name} seed=${seed}`).toBe(
            expectedVerdict
          );
          if (expectedVerdict === 'call') {
            expect(['call', 'all_in'], `${heroCards} ${mode.name} seed=${seed}`).toContain(
              on.action
            );
          } else {
            expect(on.action, `${heroCards} ${mode.name} seed=${seed}`).toBe('fold');
          }

          expect(
            horsePhase6AttributionMismatch(on, {
              player,
              gameState: gs,
              opts: mode.requestOpts,
            }),
            `${heroCards} ${mode.name} seed=${seed}`
          ).toBeNull();
          expect(
            horseDecisionReceiptRefusal(on, 'nlh', { player, gameState: gs } as never),
            `${heroCards} ${mode.name} seed=${seed}`
          ).toBeNull();

          const attr = on.tournamentPreflopAttribution;
          expect(attr, `${heroCards} ${mode.name} seed=${seed}`).toBeDefined();
          expect(attr!.route, `${heroCards} ${mode.name} seed=${seed}`).toBe(mode.expectedRoute);
          expect(attr!.lookup, `${heroCards} ${mode.name} seed=${seed}`).toBeNull();
          expect(attr!.forwardedToIntentEngine, `${heroCards} ${mode.name} seed=${seed}`).toBe(
            false
          );
        }
      }
    }
  });

  it('live v2-provenance All-In-Or-Fold production requests pass both receipt validators with zero refusals under holdemTournamentAllInCallIsPriced:true', () => {
    for (const [name, body] of Object.entries(AOF.cases)) {
      const gs = body.gameState as unknown as HorseGameStateV2;
      const player = body.player as unknown as SeatPlayer;
      seedFastRandom(1);
      const decision = HorseLogic.decide(
        structuredClone(player),
        structuredClone(gs),
        body.style as never,
        body.mods as never,
        {
          decisionTimeMs: body.decisionTimeMs,
          telemetry: true,
          holdemTournamentAllInCallIsPriced: true,
        } as never
      );
      expect(holdemAllInCallVerdictOfLastDecision()?.street, name).toBe('preflop');
      expect(decision.tournamentPreflopAttribution?.version, name).toBe(
        'horse-phase6-attribution-v2'
      );
      expect(decision.tournamentPreflopAttribution?.route, name).toBe('intent_engine');
      expect(
        horsePhase6AttributionMismatch(decision, { player, gameState: gs, opts: {} }),
        name
      ).toBeNull();
      expect(
        horseDecisionReceiptRefusal(decision, 'nlh', { player, gameState: gs } as never),
        name
      ).toBeNull();
    }
  });
});
