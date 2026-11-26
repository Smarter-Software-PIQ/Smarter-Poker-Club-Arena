/**
 * LAW: V78 COMMITTING BLUFF-RAISE PRICED REPLACEMENT (v2, 2026-11-22, Hold'em Strategy / HORSE DECISIONS).
 *
 * Replaces the blanket 40%-of-stack bluff-raise veto (`v78NoCommittingBluffRaise`) in single-board
 * 2-card NLH with deterministic public-info EV pricing (`HorseV78CommittingBluffRaisePriced.ts`)
 * wired directly onto `#11759`'s Wave 5.4 NLH raise pricing stack in `holdemEmpiricalPriors.ts`:
 *   - `estimateHoldemFoldToRaisePrior` (measured NLH flop/turn/river fold-to-raise priors)
 *   - `conditionEquityAgainstRaiseCallRange` (Bayes raise-continuing equity conditioning)
 *   - `priceHoldemRaiseEv` (fold / call / 3-bet reraise response EV over contestable pot)
 *   - `heroBubbleFactor` tournament risk utility.
 *
 * Strictly dark, default OFF (`read === true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations).
 *
 * Proves:
 *  1. Pure pricing math: determinism (zero `fastRandom()` draw), exact alignment with `#11759`'s
 *     `estimateHoldemFoldToRaisePrior`, `conditionEquityAgainstRaiseCallRange`, and `priceHoldemRaiseEv`;
 *     street ordering (`flop < turn < river` base fold-to-raise, `flop > turn > river` conditioned
 *     retained equity); SPR, commitment, all-in, and multiway monotonicity; opponentSample & HUD
 *     (`f/t/r.fRaise` > attenuated `f/t/r.fBet`) shrinkage; villain 3-bet reraise response on
 *     non-all-in raises; `heroBubbleFactor` monotonicity; effective contestable stack cap; and
 *     fail-closed veto on unpriceable inputs.
 *  2. OFF / unset / false is 100% byte-identical to `origin/main` across styles, streets, and seeds.
 *  3. Out-of-scope games (Omaha PLO4/PLO5, Short Deck, Fixed Limit, multi-board, bomb pot) are 100%
 *     untouched even when `v78NoCommittingBluffRaiseIsPriced: true`.
 *  4. Live `HorseLogic.decide` with ON emits `v78_committing_bluff_raise_priced_allowed` /
 *     `v78_committing_bluff_raise_priced_vetoed`, vetoes negative-EV committing turn bluff-raises
 *     that v1 over-allowed, allows genuinely positive-EV committing raises >= 40% stack that blanket
 *     V78 vetoed, obeys bubble factor, is label-neutral (human vs horse), and is 100% public-info-only
 *     (invariant to opponent hole cards).
 *  4b. Scope is the blanket rule's own spot only: ON + a legal jam or a raise adding < 40% of stack is
 *     not vetoed and records no priced receipt; ON + a committing non-jam raise records the priced
 *     receipt and returns `priceCommittingBluffRaise`'s verdict, also with `v78NoCommittingBluffRaise: false`.
 *  5. Registered in `OPTION_SWITCH_REFUSED` and absent from `OPTION_SWITCH_NAMES` (zero migrations).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_NAMES, OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { fastRandom, seedFastRandom, variantInfo } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE,
  conditionEquityAgainstRaiseCallRange,
  estimateHoldemFoldToRaisePrior,
  priceHoldemRaiseEv,
} from './holdemEmpiricalPriors.js';
import {
  priceCommittingBluffRaise,
  type CommittingBluffRaisePriceInput,
} from './HorseV78CommittingBluffRaisePriced.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const VILLAIN = '10000000-0000-4000-8000-000000007801';
const VILLAIN_2 = '10000000-0000-4000-8000-000000007802';
const STYLES = ['balanced', 'tag', 'lag', 'tricky', 'grinder'] as const;

function basePriceInput(
  overrides: Partial<CommittingBluffRaisePriceInput> = {}
): CommittingBluffRaisePriceInput {
  return {
    street: 'turn',
    legalAction: 'raise',
    legalAmount: 67,
    heroBet: 0,
    heroStack: 84,
    currentBet: 15,
    pot: 34,
    toCall: 15,
    equity: 0.3,
    inPosition: false,
    spr: 2.5,
    board: cards('8c6h9h3d'),
    opponents: [{ stack: 400, bet: 15, isAllIn: false }],
    heroBubbleFactor: 1,
    ...overrides,
  };
}

function makeSpot(opts: {
  hole?: string;
  board?: string;
  heroBehind?: number;
  oppBehind?: number;
  oppBet?: number;
  potBeforeBet?: number;
  variant?: string;
  bombPot?: boolean;
  multiBoard?: boolean;
  oppCards?: string;
  flip?: boolean;
  stage?: 'flop' | 'turn' | 'river';
  tournament?: {
    stacks: number[];
    payoutPct: number[];
    playersLeft: number;
    spotsPaid: number;
    nearBubble?: boolean;
  };
}) {
  const hole = opts.hole ?? 'AsTd';
  const board = opts.board ?? '8c6h9h3d';
  const heroBehind = opts.heroBehind ?? 84;
  const oppBehind = opts.oppBehind ?? 400;
  const oppBet = opts.oppBet ?? 15;
  const potBeforeBet = opts.potBeforeBet ?? 19;
  const stage = opts.stage ?? 'turn';
  const variant = opts.variant ?? 'nlh';

  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroBehind,
      bet: 0,
      totalInvested: 9.5,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: oppBehind,
      bet: oppBet,
      totalInvested: 9.5 + oppBet,
      cards: opts.oppCards ? cards(opts.oppCards) : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: opts.flip ?? false,
    } as SeatPlayer,
  ];

  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 3.5, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 3, timestamp: 2 },
    ...(stage === 'flop'
      ? [
          { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
          { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: oppBet, timestamp: 4 },
        ]
      : stage === 'turn'
        ? [
            { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
            { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
            { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
            { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
            {
              stage: 'turn',
              seat: 2,
              userId: VILLAIN,
              action: 'bet',
              amount: oppBet,
              timestamp: 7,
            },
          ]
        : [
            { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
            { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
            { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
            { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
            { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0, timestamp: 7 },
            { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
            {
              stage: 'river',
              seat: 2,
              userId: VILLAIN,
              action: 'bet',
              amount: oppBet,
              timestamp: 9,
            },
          ]),
  ];

  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      ...(opts.multiBoard ? { communityCards2: cards('2c3c4c5d') } : {}),
      pot: potBeforeBet + oppBet,
      currentBet: oppBet,
      minRaise: oppBet,
      stage,
      gameVariant: variant,
      gameMode: opts.tournament ? 'tournament' : 'cash',
      bigBlind: 1,
      dealerSeat: 2,
      actionHistory: history,
      ...(opts.bombPot ? { bombPot: true } : {}),
      ...(opts.tournament
        ? {
            tournamentContext: {
              trusted: true,
              stacks: opts.tournament.stacks,
              payoutPct: opts.tournament.payoutPct,
              playersLeft: opts.tournament.playersLeft,
              spotsPaid: opts.tournament.spotsPaid,
              nearBubble: opts.tournament.nearBubble ?? true,
              heroSeat: 1,
              heroUserId: 'hero',
            },
          }
        : {}),
    },
  };
}

type D = { action: string; amount?: number; thinkTime?: number };
function wagerOf(d: D) {
  return { action: d.action, amount: d.amount ?? null, thinkTime: d.thinkTime ?? null };
}
function runDecide(
  s: ReturnType<typeof makeSpot>,
  style: string,
  seed: number,
  opts: Record<string, unknown> = {},
  keepMind = false
): { decision: D; wager: ReturnType<typeof wagerOf>; fires: string[] } {
  seedFastRandom(seed * 7919 + 13);
  if (!keepMind) HorseMind.reset();
  drainFires();
  const decision = HorseLogic.decide(s.hero, s.gs as never, style as never, {}, {
    telemetry: true,
    mind: keepMind,
    ...opts,
  } as never) as D;
  const fires = drainFires().map((r) => r.feature);
  return { decision, wager: wagerOf(decision), fires };
}

describe('LAW: v78NoCommittingBluffRaiseIsPriced v2 (#11759 priors + Bayes raise-continuing equity)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('1. Pure pricing math & #11759 integration invariants', () => {
    it('is 100% deterministic and consumes zero fastRandom() draws', () => {
      const input = basePriceInput();
      seedFastRandom(123456);
      const before = fastRandom();
      seedFastRandom(123456);
      const r1 = priceCommittingBluffRaise(input);
      const after = fastRandom();
      const r2 = priceCommittingBluffRaise(input);
      expect(after).toBe(before);
      expect(r2).toEqual(r1);
      expect(r1.allow).toBe(!r1.veto);
    });

    it('matches #11759 estimateHoldemFoldToRaisePrior, conditionEquityAgainstRaiseCallRange, and priceHoldemRaiseEv exactly', () => {
      const input = basePriceInput({
        street: 'turn',
        legalAction: 'raise',
        legalAmount: 67,
        heroBet: 0,
        heroStack: 84,
        currentBet: 15,
        pot: 34,
        toCall: 15,
        equity: 0.3,
        spr: 2.5,
        opponents: [{ stack: 400, bet: 15, isAllIn: false }],
        heroBubbleFactor: 1,
      });
      const res = priceCommittingBluffRaise(input);

      const expectedPrior = estimateHoldemFoldToRaisePrior({
        street: 'turn',
        raiseToBetRatio: 67 / 15,
        raiseToPotRatio: 67 / 34,
        opponentsInPot: 1,
        spr: 2.5,
        commitmentFactor: 15 / 415,
        isAllInRaise: false,
      });
      const expectedEq = conditionEquityAgainstRaiseCallRange(0.3, expectedPrior.mean, {
        street: 'turn',
      });
      const expectedEv = priceHoldemRaiseEv({
        pot: 34,
        toCall: 15,
        heroAdded: 67,
        rawEquity: 0.3,
        villainCall: 52,
        foldToRaiseProb: expectedPrior.mean,
        equityConditioning: { street: 'turn' },
        reraiseResponse: {
          reraiseProb: HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.turn.baseReraiseRate,
          reraiseToCall: 84 - 67,
        },
      });

      expect(res.foldPriorSource).toBe('pool_prior');
      expect(res.foldProb).toBeCloseTo(expectedPrior.mean, 12);
      expect(res.eqWhenCalled).toBeCloseTo(expectedEq, 12);
      expect(res.eqWhenCalled).toBeLessThan(0.3);
      expect(res.reraiseProb).toBeCloseTo(
        HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE.turn.baseReraiseRate,
        12
      );
      expect(res.evRaise).toBeCloseTo(expectedEv.evRaise, 12);
      expect(res.baselineEv).toBeCloseTo(Math.max(0, expectedEv.evCall), 12);
      // Key v2 fix: committing 67/84 on the turn with 30% raw equity into average pool is -EV -> VETO
      expect(res.evRaise).toBeLessThan(res.baselineEv);
      expect(res.allow).toBe(false);
      expect(res.veto).toBe(true);
      expect(res.reason).toBe('ev_non_positive');
    });

    it('obeys street fold-to-raise ordering (flop < turn < river) and Bayes conditioned equity ordering (flop > turn > river)', () => {
      const sameGeom = (street: 'flop' | 'turn' | 'river') =>
        priceCommittingBluffRaise(
          basePriceInput({
            street,
            board:
              street === 'flop'
                ? cards('8c6h9h')
                : street === 'turn'
                  ? cards('8c6h9h3d')
                  : cards('8c6h9h3d2s'),
            legalAction: 'raise',
            legalAmount: 45,
            heroStack: 360,
            currentBet: 15,
            pot: 60,
            toCall: 15,
            equity: 0.35,
            spr: 6.0,
            opponents: [{ stack: 360, bet: 15, isAllIn: false }],
          })
        );
      const flop = sameGeom('flop');
      const turn = sameGeom('turn');
      const river = sameGeom('river');
      expect(flop.foldProb).toBeLessThan(turn.foldProb);
      expect(turn.foldProb).toBeLessThan(river.foldProb);
      // Higher street has BOTH higher fold rate and sharper truncation kappa -> strictly lower eqWhenCalled
      expect(flop.eqWhenCalled).toBeGreaterThan(turn.eqWhenCalled);
      expect(turn.eqWhenCalled).toBeGreaterThan(river.eqWhenCalled);
      expect(flop.eqWhenCalled).toBeLessThan(0.35);
    });

    it('replaces the flat 40% stack threshold: allows genuinely +EV committing raise (>= 40% stack) vs over-folder and vetoes -EV shallow raise (< 40% stack)', () => {
      // Commits 67/84 = 79.8% of stack, against a measured over-folder (32/40 fold-to-raise) -> positive EV -> ALLOW
      const highFold = priceCommittingBluffRaise(
        basePriceInput({
          legalAmount: 67,
          heroStack: 84,
          equity: 0.36,
          opponents: [
            {
              stack: 400,
              bet: 15,
              isAllIn: false,
              hudOpp: { eff: { 't.fRaise': [40, 32] } },
            },
          ],
        })
      );
      expect(highFold.foldPriorSource).toBe('hud_context');
      expect(highFold.add).toBe(67);
      expect(highFold.add / 84).toBeGreaterThanOrEqual(0.4);
      expect(highFold.eqWhenCalled).toBeLessThan(0.36);
      expect(highFold.evRaise).toBeGreaterThan(highFold.baselineEv);
      expect(highFold.allow).toBe(true);
      expect(highFold.veto).toBe(false);
      expect(highFold.reason).toBe('ev_positive');

      // Direct public opponentSample shrinkage works identically and takes precedence over HUD
      const sampleAllow = priceCommittingBluffRaise(
        basePriceInput({
          legalAmount: 67,
          heroStack: 84,
          equity: 0.36,
          opponents: [
            {
              stack: 400,
              bet: 15,
              isAllIn: false,
              opponentSample: { folds: 32, opportunities: 40 },
              hudOpp: { eff: { 't.fRaise': [40, 4] } },
            },
          ],
        })
      );
      expect(sampleAllow.foldPriorSource).toBe('opponent_sample');
      expect(sampleAllow.foldProb).toBeCloseTo(highFold.foldProb, 12);
      expect(sampleAllow.allow).toBe(true);

      // HUD first-bet fallback (`t.fBet`) is attenuated (doubled k) relative to exact `t.fRaise`
      const hudRaiseSticky = priceCommittingBluffRaise(
        basePriceInput({
          opponents: [
            { stack: 400, bet: 15, isAllIn: false, hudOpp: { eff: { 't.fRaise': [28, 3] } } },
          ],
        })
      );
      const hudBetSticky = priceCommittingBluffRaise(
        basePriceInput({
          opponents: [
            { stack: 400, bet: 15, isAllIn: false, hudOpp: { eff: { 't.fBet': [28, 3] } } },
          ],
        })
      );
      expect(hudRaiseSticky.foldPriorSource).toBe('hud_context');
      expect(hudBetSticky.foldPriorSource).toBe('hud_street');
      expect(hudBetSticky.foldProb).toBeGreaterThan(hudRaiseSticky.foldProb);

      // Only commits 67/400 = 16.8% of stack (< 40%), against sticky opponent -> negative EV -> VETO
      const lowFold = priceCommittingBluffRaise(
        basePriceInput({
          legalAmount: 67,
          heroStack: 400,
          equity: 0.12,
          opponents: [
            {
              stack: 400,
              bet: 15,
              isAllIn: false,
              hudOpp: { eff: { 't.fRaise': [40, 4] } },
            },
          ],
        })
      );
      expect(lowFold.add / 400).toBeLessThan(0.4);
      expect(lowFold.evRaise).toBeLessThanOrEqual(lowFold.baselineEv);
      expect(lowFold.allow).toBe(false);
      expect(lowFold.veto).toBe(true);
      expect(lowFold.reason).toBe('ev_non_positive');
    });

    it('distinguishes river non-all-in raise vs all-in raise (all-in drops foldProb and zeroes reraiseProb)', () => {
      // Risk 65 to win 75 (potBeforeBet = 50 + oppBet = 25): break-even FE ~46.4%
      const nonAllIn = priceCommittingBluffRaise(
        basePriceInput({
          street: 'river',
          board: cards('8c6h9h3d2s'),
          legalAction: 'raise',
          legalAmount: 65,
          heroStack: 160,
          currentBet: 25,
          pot: 75,
          toCall: 25,
          equity: 0.1,
          spr: 4.5,
          opponents: [{ stack: 200, bet: 25, isAllIn: false }],
        })
      );
      const allIn = priceCommittingBluffRaise(
        basePriceInput({
          street: 'river',
          board: cards('8c6h9h3d2s'),
          legalAction: 'all_in',
          legalAmount: undefined,
          heroStack: 65,
          currentBet: 25,
          pot: 75,
          toCall: 25,
          equity: 0.1,
          spr: 4.5,
          opponents: [{ stack: 200, bet: 25, isAllIn: false }],
        })
      );
      expect(nonAllIn.isAllInRaise).toBe(false);
      expect(allIn.isAllInRaise).toBe(true);
      expect(nonAllIn.reraiseProb).toBeGreaterThan(0);
      expect(allIn.reraiseProb).toBe(0);
      expect(nonAllIn.foldProb).toBeGreaterThan(allIn.foldProb);
      expect(nonAllIn.evRaise).toBeGreaterThan(allIn.evRaise);
      expect(nonAllIn.allow).toBe(true);
      expect(allIn.allow).toBe(false);
    });

    it('is strictly monotonic in SPR (deeper -> more folds) and villain commitment (more committed -> fewer folds)', () => {
      const atSpr = (spr: number) =>
        priceCommittingBluffRaise(
          basePriceInput({
            street: 'flop',
            board: cards('8c6h3d'),
            legalAmount: 45,
            heroStack: 200,
            currentBet: 15,
            pot: 60,
            toCall: 15,
            equity: 0.3,
            spr,
            opponents: [{ stack: 200, bet: 15, isAllIn: false }],
          })
        );
      const sprDeep = atSpr(10);
      const sprMid = atSpr(5);
      const sprLow = atSpr(1.5);
      expect(sprDeep.foldProb).toBeGreaterThan(sprMid.foldProb);
      expect(sprMid.foldProb).toBeGreaterThan(sprLow.foldProb);

      // Villain with small remaining stack behind bet is pot-committed -> folds strictly less
      const uncommitted = priceCommittingBluffRaise(
        basePriceInput({
          street: 'turn',
          legalAmount: 45,
          heroStack: 200,
          currentBet: 15,
          pot: 60,
          toCall: 15,
          equity: 0.25,
          spr: 4,
          opponents: [{ stack: 300, bet: 15, isAllIn: false }],
        })
      );
      const committed = priceCommittingBluffRaise(
        basePriceInput({
          street: 'turn',
          legalAmount: 45,
          heroStack: 200,
          currentBet: 15,
          pot: 60,
          toCall: 15,
          equity: 0.25,
          spr: 4,
          opponents: [{ stack: 35, bet: 15, isAllIn: false }],
        })
      );
      expect(uncommitted.foldProb).toBeGreaterThan(committed.foldProb);
    });

    it('reduces foldProb multiway and sets foldProb=0 when any opponent is all-in', () => {
      const hu = priceCommittingBluffRaise(
        basePriceInput({
          opponents: [{ stack: 400, bet: 15, isAllIn: false }],
        })
      );
      const mw = priceCommittingBluffRaise(
        basePriceInput({
          opponents: [
            { stack: 400, bet: 15, isAllIn: false },
            { stack: 400, bet: 0, isAllIn: false },
          ],
        })
      );
      expect(mw.foldProb).toBeLessThan(hu.foldProb);
      expect(mw.evRaise).toBeLessThan(hu.evRaise);

      // One opponent already all-in + one live -> foldProb === 0 -> bluff-raise vetoed
      const oneAllIn = priceCommittingBluffRaise(
        basePriceInput({
          equity: 0.25,
          opponents: [
            { stack: 0, bet: 15, isAllIn: true },
            { stack: 400, bet: 15, isAllIn: false },
          ],
        })
      );
      expect(oneAllIn.foldProb).toBe(0);
      expect(oneAllIn.eqWhenCalled).toBeCloseTo(0.25, 12);
      expect(oneAllIn.allow).toBe(false);
      expect(oneAllIn.veto).toBe(true);

      // Every opponent all-in -> no_foldable_opponent fail closed
      const allAllIn = priceCommittingBluffRaise(
        basePriceInput({
          opponents: [{ stack: 0, bet: 15, isAllIn: true }],
        })
      );
      expect(allAllIn.allow).toBe(false);
      expect(allAllIn.veto).toBe(true);
      expect(allAllIn.reason).toBe('no_foldable_opponent');
    });

    it('computes true expected utility E[u(X)] under heroBubbleFactor (no Jensen u(E[X]) bug), vetoing marginally +chipEV committing raises at bf = 2.0', () => {
      // Case A: Borderline +chipEV river raise -> monotonically penalized by bf and vetoed at bf = 2.0
      const riverSpot = basePriceInput({
        street: 'river',
        board: cards('8c6h9h3d2s'),
        legalAction: 'raise',
        legalAmount: 65,
        heroStack: 160,
        currentBet: 25,
        pot: 75,
        toCall: 25,
        equity: 0.1,
        spr: 4.5,
        opponents: [{ stack: 200, bet: 25, isAllIn: false }],
      });
      const bf1 = priceCommittingBluffRaise({ ...riverSpot, heroBubbleFactor: 1 });
      const bf15 = priceCommittingBluffRaise({ ...riverSpot, heroBubbleFactor: 1.5 });
      const bf20 = priceCommittingBluffRaise({ ...riverSpot, heroBubbleFactor: 2.0 });
      expect(bf1.evRaise).toBeGreaterThan(bf15.evRaise);
      expect(bf15.evRaise).toBeGreaterThan(bf20.evRaise);
      expect(bf1.allow).toBe(true);
      expect(bf1.evRaise).toBeGreaterThan(0);
      expect(bf20.evRaise).toBeLessThan(0);
      expect(bf20.allow).toBe(false);
      expect(bf20.veto).toBe(true);

      // Case B: Direct Jensen's inequality proof — committing all-in semi-bluff where BOTH
      // chip-EV(call) > 0 AND chip-EV(called) > 0, so buggy u(E[X]) would be completely blind to bf,
      // while true E[u(X)] = e * (pot + callAdd) - (1 - e) * bf * add drops < 0 and VETOES at bf = 2.0!
      const jensenSpot = basePriceInput({
        street: 'flop',
        board: cards('8c6h9h'),
        legalAction: 'all_in',
        legalAmount: undefined,
        heroBet: 0,
        heroStack: 100,
        currentBet: 15,
        pot: 50,
        toCall: 15,
        equity: 0.56,
        spr: 2.0,
        opponents: [
          {
            stack: 200,
            bet: 15,
            isAllIn: false,
            opponentSample: { folds: 2, opportunities: 40 },
          },
        ],
      });
      const chip = priceCommittingBluffRaise({ ...jensenSpot, heroBubbleFactor: 1.0 });
      const bubble = priceCommittingBluffRaise({ ...jensenSpot, heroBubbleFactor: 2.0 });

      // Verify both call chip-EV and called chip-EV are strictly positive (so u(E[X]) would have ignored bf)
      const calledChipEv =
        chip.eqWhenCalled * (50 + chip.callAdd) - (1 - chip.eqWhenCalled) * chip.add;
      expect(calledChipEv).toBeGreaterThan(0);
      expect(chip.baselineEv).toBeGreaterThan(0);
      expect(chip.evRaise).toBeGreaterThan(chip.baselineEv);
      expect(chip.allow).toBe(true);

      // Verify exact true E[u(X)] formulas at bf = 2.0:
      const expectedBubbleBaseline = Math.max(0, 0.56 * 50 - (1 - 0.56) * 2.0 * 15);
      const expectedBubbleCalledUtil =
        bubble.eqWhenCalled * (50 + bubble.callAdd) - (1 - bubble.eqWhenCalled) * 2.0 * bubble.add;
      const expectedBubbleEv =
        bubble.foldProb * 50 + (1 - bubble.foldProb) * expectedBubbleCalledUtil;
      expect(bubble.baselineEv).toBeCloseTo(expectedBubbleBaseline, 12);
      expect(bubble.evRaise).toBeCloseTo(expectedBubbleEv, 12);
      expect(bubble.evRaise).toBeLessThan(0);
      expect(bubble.allow).toBe(false);
      expect(bubble.veto).toBe(true);
    });

    it('caps effective hero commitment at what the deepest live opponent can match', () => {
      const capped = priceCommittingBluffRaise(
        basePriceInput({
          legalAction: 'all_in',
          heroStack: 500,
          heroBet: 0,
          currentBet: 15,
          pot: 34,
          toCall: 15,
          equity: 0.35,
          opponents: [{ stack: 50, bet: 15, isAllIn: false }],
        })
      );
      // Max villain total on street = 15 + 50 = 65 -> hero can only risk 65, not 500
      expect(capped.add).toBe(65);
      expect(capped.callAdd).toBe(50);
      expect(capped.reraiseProb).toBe(0);
    });

    it('fails closed to veto on unpriceable inputs or non-raise legalized actions', () => {
      const badInputs: Array<Partial<CommittingBluffRaisePriceInput>> = [
        { pot: 0 },
        { pot: Number.NaN },
        { heroStack: 0 },
        { equity: -0.1 },
        { equity: 1.1 },
        { equity: Number.NaN },
        { opponents: [] },
        { legalAction: 'call', legalAmount: 15 },
        { legalAction: 'fold', legalAmount: undefined },
        { legalAction: 'raise', legalAmount: 15 }, // not > currentBet
        { legalAction: 'all_in', heroStack: 10, currentBet: 15 }, // all-in call, not raise
        { opponents: [{ stack: Number.NaN, bet: 15, isAllIn: false }] },
      ];
      for (const bad of badInputs) {
        const res = priceCommittingBluffRaise(basePriceInput(bad));
        expect(res.allow).toBe(false);
        expect(res.veto).toBe(true);
        expect(Number.isFinite(res.evRaise)).toBe(true);
        expect(Number.isFinite(res.baselineEv)).toBe(true);
      }
    });
  });

  describe('2. HorseLogic.decide integration, OFF identity, and scope isolation', () => {
    it('OFF / unset / false is 100% byte-identical across styles, streets, and seeds with zero priced receipts', () => {
      const spots = [
        makeSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' }),
        makeSpot({ hole: 'AhKh', board: '9h5h2c', heroBehind: 84, stage: 'flop' }),
        makeSpot({
          hole: 'Ah5d',
          board: 'KhQh7c3d2h',
          heroBehind: 84,
          oppBet: 15,
          stage: 'river',
        }),
      ];
      for (const s of spots) {
        for (const style of STYLES) {
          for (let seed = 1; seed <= 25; seed++) {
            const unset = runDecide(s, style, seed, {});
            const explicitFalse = runDecide(s, style, seed, {
              v78NoCommittingBluffRaiseIsPriced: false,
            });
            expect(explicitFalse.wager).toEqual(unset.wager);
            expect(explicitFalse.fires).toEqual(unset.fires);
            expect(unset.fires).not.toContain('v78_committing_bluff_raise_priced_allowed');
            expect(unset.fires).not.toContain('v78_committing_bluff_raise_priced_vetoed');
          }
        }
      }
    });

    it('Omaha (PLO4/PLO5), Short Deck, Fixed Limit, multi-board, and bomb pot are 100% untouched even when ON', () => {
      const outOfScope = [
        makeSpot({ hole: 'AsTd9s7d', variant: 'plo4', heroBehind: 84 }),
        makeSpot({ hole: 'AsTd9s7d5c', variant: 'plo5', heroBehind: 84 }),
        makeSpot({ hole: 'AsTd', variant: 'short_deck', heroBehind: 84 }),
        makeSpot({ hole: 'AsTd', variant: 'flh', heroBehind: 84 }),
        makeSpot({ hole: 'AsTd', multiBoard: true, heroBehind: 84 }),
        makeSpot({ hole: 'AsTd', bombPot: true, heroBehind: 84 }),
      ];
      for (const s of outOfScope) {
        for (const style of ['balanced', 'lag'] as const) {
          for (let seed = 1; seed <= 25; seed++) {
            const off = runDecide(s, style, seed, {});
            const on = runDecide(s, style, seed, { v78NoCommittingBluffRaiseIsPriced: true });
            expect(on.wager).toEqual(off.wager);
            expect(on.fires).toEqual(off.fires);
            expect(on.fires).not.toContain('v78_committing_bluff_raise_priced_allowed');
            expect(on.fires).not.toContain('v78_committing_bluff_raise_priced_vetoed');
          }
        }
      }
    });

    it('when ON in single-board NLH: vetoes negative-EV committing turn bluff-raises and emits priced receipts', () => {
      // Negative-EV committing turn bluff-raise (67/84 stack, low conditioned equity) -> VETOED by v2!
      const negTurnSpot = makeSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' });
      let sawVetoed = false;
      for (const style of STYLES) {
        for (let seed = 1; seed <= 80; seed++) {
          const on = runDecide(negTurnSpot, style, seed, {
            v78NoCommittingBluffRaiseIsPriced: true,
          });
          if (on.fires.includes('v78_committing_bluff_raise_priced_vetoed')) {
            sawVetoed = true;
            expect(on.fires).not.toContain('v78_no_committing_bluff_raise');
            expect(on.decision.action).not.toBe('raise');
          }
        }
      }
      expect(sawVetoed).toBe(true);

      // Tournament bubble spot with high heroBubbleFactor -> also VETOED
      const bubbleSpot = makeSpot({
        hole: 'AsTd',
        board: '8c6h9h3d',
        heroBehind: 84,
        oppBehind: 400,
        oppBet: 15,
        potBeforeBet: 19,
        stage: 'turn',
        tournament: {
          stacks: [84, 400, 400, 30],
          payoutPct: [0.5, 0.3, 0.2],
          playersLeft: 4,
          spotsPaid: 3,
          nearBubble: true,
        },
      });
      let sawBubbleVetoed = false;
      for (const style of STYLES) {
        for (let seed = 1; seed <= 120; seed++) {
          const on = runDecide(bubbleSpot, style, seed, {
            v78NoCommittingBluffRaiseIsPriced: true,
          });
          if (on.fires.includes('v78_committing_bluff_raise_priced_vetoed')) {
            sawBubbleVetoed = true;
            expect(on.decision.action).not.toBe('raise');
            break;
          }
        }
        if (sawBubbleVetoed) break;
      }
      expect(sawBubbleVetoed).toBe(true);

      // Multiway spot with an all-in opponent -> F = 0 -> VETOED
      const mwAllInSpot = makeSpot({
        hole: 'AhKh',
        board: '9h5h2c3d',
        heroBehind: 84,
        oppBehind: 400,
        oppBet: 15,
        potBeforeBet: 19,
        stage: 'turn',
      });
      (mwAllInSpot.gs.players as SeatPlayer[]).push({
        seat: 3,
        user_id: VILLAIN_2,
        username: 'v2',
        stack: 0,
        bet: 15,
        totalInvested: 24.5,
        cards: [],
        is_folded: false,
        is_all_in: true,
        is_sitting_out: false,
        is_horse: false,
      } as SeatPlayer);
      let sawMwAllInVetoed = false;
      for (const style of STYLES) {
        for (let seed = 1; seed <= 120; seed++) {
          const on = runDecide(mwAllInSpot, style, seed, {
            v78NoCommittingBluffRaiseIsPriced: true,
          });
          if (on.fires.includes('v78_committing_bluff_raise_priced_vetoed')) {
            sawMwAllInVetoed = true;
            expect(on.decision.action).not.toBe('raise');
            break;
          }
        }
        if (sawMwAllInVetoed) break;
      }
      expect(sawMwAllInVetoed).toBe(true);

      // Like for like: a < 40%-stack turn bluff-raise (`heroBehind: 400`) is outside the blanket
      // rule's spot, so ON leaves it exactly as OFF does, with no priced receipt.
      const shallowSpot = makeSpot({
        hole: 'AsTd',
        board: '8c6h9h3d',
        heroBehind: 400,
        oppBehind: 600,
        oppBet: 15,
        potBeforeBet: 19,
        stage: 'turn',
      });
      for (const style of STYLES) {
        for (let seed = 1; seed <= 40; seed++) {
          const off = runDecide(shallowSpot, style, seed, {});
          const on = runDecide(shallowSpot, style, seed, {
            v78NoCommittingBluffRaiseIsPriced: true,
          });
          expect(on.wager).toEqual(off.wager);
          expect(on.fires).toEqual(off.fires);
          expect(on.fires).not.toContain('v78_committing_bluff_raise_priced_allowed');
          expect(on.fires).not.toContain('v78_committing_bluff_raise_priced_vetoed');
        }
      }
    });

    describe("scope = the blanket rule's own spot (non-all-in raise adding >= 40% of stack)", () => {
      type Gate = (
        raiseTo: number,
        player: SeatPlayer,
        gs: unknown,
        vi: unknown,
        opts: Record<string, unknown>,
        ctx?: unknown
      ) => boolean;
      const L = HorseLogic as unknown as {
        v78CommitsWithoutJam: Gate;
        legalize: (
          d: { action: string; amount?: number; thinkTime: number },
          player: SeatPlayer,
          gs: unknown,
          vi: unknown
        ) => { action: string; amount?: number };
      };
      const vi = variantInfo('nlh');
      function ctxFor(s: ReturnType<typeof makeSpot>, equity: number) {
        const villain = (s.gs.players as SeatPlayer[]).filter((p) => p.user_id !== 'hero');
        return {
          street: 'turn' as const,
          pot: s.gs.pot,
          toCall: s.gs.currentBet,
          equity,
          inPosition: false,
          spr: s.hero.stack / s.gs.pot,
          board: s.gs.communityCards,
          opponents: villain,
          multiBoard: false,
          useMind: false,
          tele: true,
        };
      }
      function gate(
        s: ReturnType<typeof makeSpot>,
        raiseTo: number,
        equity: number,
        opts: Record<string, unknown>
      ): { veto: boolean; fires: string[] } {
        drainFires();
        const veto = L.v78CommitsWithoutJam.call(
          HorseLogic,
          raiseTo,
          s.hero,
          s.gs,
          vi,
          opts,
          ctxFor(s, equity)
        );
        return { veto, fires: drainFires().map((r) => r.feature) };
      }
      const PRICED_FIRES = [
        'v78_committing_bluff_raise_priced_allowed',
        'v78_committing_bluff_raise_priced_vetoed',
      ];

      it('ON + a legal jam: not vetoed, no priced receipt (the blanket rule never touched a jam)', () => {
        const s = makeSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' });
        expect(
          L.legalize({ action: 'raise', amount: 84, thinkTime: 0 }, s.hero, s.gs, vi).action
        ).toBe('all_in');
        for (const equity of [0.05, 0.3, 0.6]) {
          for (const extra of [{}, { v78NoCommittingBluffRaise: false }]) {
            const off = gate(s, 84, equity, { ...extra });
            const on = gate(s, 84, equity, { ...extra, v78NoCommittingBluffRaiseIsPriced: true });
            expect(off.veto).toBe(false);
            expect(on.veto).toBe(false);
            for (const f of PRICED_FIRES) expect(on.fires).not.toContain(f);
          }
        }
      });

      it('ON + a raise adding < 40% of stack: not vetoed, no priced receipt', () => {
        const s = makeSpot({ hole: 'AsTd', heroBehind: 400, oppBehind: 600, stage: 'turn' });
        const legal = L.legalize({ action: 'raise', amount: 67, thinkTime: 0 }, s.hero, s.gs, vi);
        expect(legal.action).toBe('raise');
        expect((legal.amount as number) - s.hero.bet).toBeLessThan(0.4 * s.hero.stack);
        for (const equity of [0.05, 0.12, 0.3]) {
          for (const extra of [{}, { v78NoCommittingBluffRaise: false }]) {
            const off = gate(s, 67, equity, { ...extra });
            const on = gate(s, 67, equity, { ...extra, v78NoCommittingBluffRaiseIsPriced: true });
            expect(off.veto).toBe(false);
            expect(on.veto).toBe(false);
            for (const f of PRICED_FIRES) expect(on.fires).not.toContain(f);
          }
        }
      });

      it("ON + a committing non-jam raise: the priced receipt fires and the verdict is priceCommittingBluffRaise's, also when v78NoCommittingBluffRaise is false", () => {
        const verdicts = new Set<boolean>();
        for (const [heroBehind, potBeforeBet, oppBet, frac] of [
          [84, 19, 15, 0.8],
          [60, 80, 10, 0.5],
          [84, 150, 15, 0.5],
        ] as const) {
          const s = makeSpot({ hole: 'AsTd', heroBehind, potBeforeBet, oppBet, stage: 'turn' });
          const raiseTo = Math.round(heroBehind * frac);
          const legal = L.legalize(
            { action: 'raise', amount: raiseTo, thinkTime: 0 },
            s.hero,
            s.gs,
            vi
          );
          expect(legal.action).toBe('raise');
          expect((legal.amount as number) - s.hero.bet).toBeGreaterThanOrEqual(0.4 * s.hero.stack);
          for (const equity of [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
            const ctx = ctxFor(s, equity);
            const expected = priceCommittingBluffRaise({
              street: 'turn',
              legalAction: legal.action,
              legalAmount: legal.amount,
              heroBet: 0,
              heroStack: heroBehind,
              currentBet: oppBet,
              pot: ctx.pot,
              toCall: ctx.toCall,
              equity,
              inPosition: false,
              spr: ctx.spr,
              board: ctx.board,
              opponents: ctx.opponents.map((o) => ({
                stack: o.stack,
                bet: o.bet,
                isAllIn: o.is_all_in === true,
              })),
              heroBubbleFactor: 1,
            });
            verdicts.add(expected.veto);
            const off = gate(s, raiseTo, equity, {});
            expect(off.veto).toBe(true);
            for (const f of PRICED_FIRES) expect(off.fires).not.toContain(f);
            for (const extra of [{}, { v78NoCommittingBluffRaise: false }]) {
              const on = gate(s, raiseTo, equity, {
                ...extra,
                v78NoCommittingBluffRaiseIsPriced: true,
              });
              expect(on.veto).toBe(expected.veto);
              expect(on.fires).toContain(
                expected.veto
                  ? 'v78_committing_bluff_raise_priced_vetoed'
                  : 'v78_committing_bluff_raise_priced_allowed'
              );
            }
          }
        }
        // the sweep reaches both verdicts, so the equality above is not vacuous
        expect(verdicts.has(true)).toBe(true);
        expect(verdicts.has(false)).toBe(true);
      });

      it('OFF: the blanket rule is unchanged (jam false, < 40% false, committing raise true; false when v78NoCommittingBluffRaise is false)', () => {
        const deep = makeSpot({ hole: 'AsTd', heroBehind: 400, oppBehind: 600, stage: 'turn' });
        const short = makeSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' });
        for (const opts of [{}, { v78NoCommittingBluffRaiseIsPriced: false }]) {
          expect(gate(short, 84, 0.3, opts).veto).toBe(false);
          expect(gate(deep, 67, 0.3, opts).veto).toBe(false);
          expect(gate(short, 67, 0.3, opts).veto).toBe(true);
          expect(gate(short, 67, 0.3, { ...opts, v78NoCommittingBluffRaise: false }).veto).toBe(
            false
          );
        }
      });
    });

    it('is label-neutral (human vs horse) and public-info-only (invariant to opponent hole cards) when ON', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const humanVillain = runDecide(
          makeSpot({ hole: 'AsTd', heroBehind: 84, flip: false, oppCards: 'KsKh' }),
          'lag',
          seed,
          { v78NoCommittingBluffRaiseIsPriced: true }
        );
        const horseVillain = runDecide(
          makeSpot({ hole: 'AsTd', heroBehind: 84, flip: true, oppCards: '2c4s' }),
          'lag',
          seed,
          { v78NoCommittingBluffRaiseIsPriced: true }
        );
        expect(horseVillain.wager).toEqual(humanVillain.wager);
        expect(horseVillain.fires).toEqual(humanVillain.fires);
      }
    });
  });

  describe('3. Zero-migration OPTION_SWITCH_REFUSED governance', () => {
    it('holds v78NoCommittingBluffRaiseIsPriced in OPTION_SWITCH_REFUSED and outside OPTION_SWITCH_NAMES', () => {
      expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'v78NoCommittingBluffRaiseIsPriced')).toBe(true);
      expect(OPTION_SWITCH_NAMES).not.toContain('v78NoCommittingBluffRaiseIsPriced');
    });
  });
});
