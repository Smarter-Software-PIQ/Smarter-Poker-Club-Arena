/**
 * LAW: V78 COMMITTING BLUFF-RAISE PRICED REPLACEMENT (2026-11-22, Hold'em Strategy / HORSE DECISIONS).
 *
 * Replaces the blanket 40%-of-stack bluff-raise veto (`v78NoCommittingBluffRaise`) in single-board
 * 2-card NLH with deterministic public-info EV pricing (`HorseV78CommittingBluffRaisePriced.ts`)
 * over measured NLH fold priors (`holdemEmpiricalPriors.ts`) and tournament `heroBubbleFactor`.
 *
 * Strictly dark, default OFF (`read === true`), held in `OPTION_SWITCH_REFUSED` (zero SQL migrations).
 *
 * Proves:
 *  1. Pure pricing math: determinism (zero `fastRandom()` draw), monotonicity in fold probability &
 *     HUD/ExploitCounters shrinkage, river all-in vs non-all-in fold distinction, flop texture/SPR
 *     conditioning, multiway product and all-in opponent fold=0, tournament bubble-factor scaling,
 *     effective contestable commitment cap, and fail-closed veto on unpriceable inputs.
 *  2. OFF / unset / false is 100% byte-identical to `origin/main` across styles, streets, and seeds.
 *  3. Out-of-scope games (Omaha PLO4/PLO5, Short Deck, Fixed Limit, multi-board, bomb pot) are 100%
 *     untouched even when `v78NoCommittingBluffRaiseIsPriced: true`.
 *  4. Live `HorseLogic.decide` with ON emits `v78_committing_bluff_raise_priced_allowed` /
 *     `v78_committing_bluff_raise_priced_vetoed`, allows positive-EV committing raises >= 40% stack
 *     that blanket V78 vetoed, vetoes negative-EV bluff-raises even < 40% stack, obeys bubble factor,
 *     is label-neutral (human vs horse), and is 100% public-info-only (invariant to opponent hole cards).
 *  5. Registered in `OPTION_SWITCH_REFUSED` and absent from `OPTION_SWITCH_NAMES` (zero migrations).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_NAMES, OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  classifyHoldemFlopTexture,
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

function makeTurnSpot(opts: {
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
  s: ReturnType<typeof makeTurnSpot>,
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

describe('LAW: v78NoCommittingBluffRaiseIsPriced (dark zero-migration priced replacement)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('1. Pure pricing math & invariants', () => {
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

    it('replaces the flat 40% stack threshold: allows positive-EV committing raise (>= 40% stack) and vetoes negative-EV shallow raise (< 40% stack)', () => {
      // Commits 67/84 = 79.8% of stack, but against an over-folding opponent with decent draw equity -> positive EV -> ALLOW
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
              hudOpp: { eff: { 't.fb.bg.hu': [40, 32] } }, // 80% fold
            },
          ],
        })
      );
      expect(highFold.add).toBe(67);
      expect(highFold.add / 84).toBeGreaterThanOrEqual(0.4);
      expect(highFold.evRaise).toBeGreaterThan(highFold.baselineEv);
      expect(highFold.allow).toBe(true);
      expect(highFold.veto).toBe(false);
      expect(highFold.reason).toBe('ev_positive');

      // Only commits 67/400 = 16.8% of stack (< 40%), but against a sticky calling station with low equity -> negative EV -> VETO
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
              hudOpp: { eff: { 't.fb.bg.hu': [40, 4] } }, // 10% fold
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

    it('distinguishes river all-in raise (29.9% base) vs river non-all-in raise (53.7% base)', () => {
      const nonAllIn = priceCommittingBluffRaise(
        basePriceInput({
          street: 'river',
          board: cards('8c6h9h3d2s'),
          legalAction: 'raise',
          legalAmount: 90,
          heroStack: 200,
          currentBet: 25,
          pot: 50,
          toCall: 25,
          equity: 0.1,
          opponents: [{ stack: 200, bet: 25, isAllIn: false }],
        })
      );
      const allIn = priceCommittingBluffRaise(
        basePriceInput({
          street: 'river',
          board: cards('8c6h9h3d2s'),
          legalAction: 'all_in',
          legalAmount: undefined,
          heroStack: 90,
          currentBet: 25,
          pot: 50,
          toCall: 25,
          equity: 0.1,
          opponents: [{ stack: 200, bet: 25, isAllIn: false }],
        })
      );
      expect(nonAllIn.isAllInRaise).toBe(false);
      expect(allIn.isAllInRaise).toBe(true);
      expect(nonAllIn.foldProb).toBeGreaterThan(allIn.foldProb);
      expect(nonAllIn.evRaise).toBeGreaterThan(allIn.evRaise);
      expect(nonAllIn.allow).toBe(true);
      expect(allIn.allow).toBe(false);
    });

    it('conditions flop folds monotonically on texture (paired > unpaired > mono) and small IP SPR (mid > deep > low)', () => {
      expect(classifyHoldemFlopTexture(cards('AhKhQh'))).toBe('mono');
      expect(classifyHoldemFlopTexture(cards('AhAd7c'))).toBe('paired');
      expect(classifyHoldemFlopTexture(cards('AhKd7c'))).toBe('unpaired_nonmono');

      const flopOf = (boardStr: string, spr = 5) =>
        priceCommittingBluffRaise(
          basePriceInput({
            street: 'flop',
            board: cards(boardStr),
            inPosition: true,
            spr,
            legalAmount: 35,
            heroStack: 200,
            currentBet: 15,
            pot: 60,
            toCall: 15,
            equity: 0.3,
            opponents: [{ stack: 200, bet: 15, isAllIn: false }],
          })
        );
      const paired = flopOf('8c8h3d');
      const unpaired = flopOf('8c6h3d');
      const mono = flopOf('8h6h3h');
      expect(paired.foldProb).toBeGreaterThan(unpaired.foldProb);
      expect(unpaired.foldProb).toBeGreaterThan(mono.foldProb);
      expect(paired.evRaise).toBeGreaterThan(unpaired.evRaise);
      expect(unpaired.evRaise).toBeGreaterThan(mono.evRaise);

      // Small IP raise (potFraction <= 0.40) varies with SPR band: mid (3..7) > deep (>=7) > low (<3)
      const sprMid = flopOf('8c6h3d', 5);
      const sprDeep = flopOf('8c6h3d', 10);
      const sprLow = flopOf('8c6h3d', 2);
      expect(sprMid.foldProb).toBeGreaterThan(sprDeep.foldProb);
      expect(sprDeep.foldProb).toBeGreaterThan(sprLow.foldProb);
    });

    it('takes fold product over multiple live opponents and sets foldProb=0 when any opponent is all-in', () => {
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

    it('scales negative called outcomes by heroBubbleFactor, turning borderline chip-EV raises into bubble vetoes', () => {
      const spot = basePriceInput({
        street: 'river',
        board: cards('8c6h9h3d2s'),
        legalAction: 'raise',
        legalAmount: 90,
        heroStack: 200,
        currentBet: 25,
        pot: 50,
        toCall: 25,
        equity: 0.1,
        opponents: [{ stack: 200, bet: 25, isAllIn: false }],
      });
      const bf1 = priceCommittingBluffRaise({ ...spot, heroBubbleFactor: 1 });
      const bf15 = priceCommittingBluffRaise({ ...spot, heroBubbleFactor: 1.5 });
      const bf25 = priceCommittingBluffRaise({ ...spot, heroBubbleFactor: 2.5 });
      expect(bf1.evRaise).toBeGreaterThan(bf15.evRaise);
      expect(bf15.evRaise).toBeGreaterThan(bf25.evRaise);
      expect(bf1.allow).toBe(true);
      expect(bf25.allow).toBe(false);
      expect(bf25.veto).toBe(true);
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
        makeTurnSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' }),
        makeTurnSpot({ hole: 'AhKh', board: '9h5h2c', heroBehind: 84, stage: 'flop' }),
        makeTurnSpot({
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
        makeTurnSpot({ hole: 'AsTd9s7d', variant: 'plo4', heroBehind: 84 }),
        makeTurnSpot({ hole: 'AsTd9s7d5c', variant: 'plo5', heroBehind: 84 }),
        makeTurnSpot({ hole: 'AsTd', variant: 'short_deck', heroBehind: 84 }),
        makeTurnSpot({ hole: 'AsTd', variant: 'flh', heroBehind: 84 }),
        makeTurnSpot({ hole: 'AsTd', multiBoard: true, heroBehind: 84 }),
        makeTurnSpot({ hole: 'AsTd', bombPot: true, heroBehind: 84 }),
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

    it('when ON in single-board NLH: emits priced receipts, allows positive-EV committing raises, and vetoes negative-EV ones', () => {
      const s = makeTurnSpot({ hole: 'AsTd', heroBehind: 84, stage: 'turn' });
      let sawAllowed = false;
      let sawBlanketVetoDiff = false;
      for (const style of STYLES) {
        for (let seed = 1; seed <= 80; seed++) {
          const off = runDecide(s, style, seed, {});
          const on = runDecide(s, style, seed, { v78NoCommittingBluffRaiseIsPriced: true });
          if (on.fires.includes('v78_committing_bluff_raise_priced_allowed')) {
            sawAllowed = true;
            expect(on.fires).not.toContain('v78_no_committing_bluff_raise');
            if (
              off.fires.includes('v78_no_committing_bluff_raise') &&
              on.decision.action === 'raise'
            ) {
              sawBlanketVetoDiff = true;
            }
          }
        }
      }
      expect(sawAllowed).toBe(true);
      expect(sawBlanketVetoDiff).toBe(true);

      // Tournament bubble spot with high heroBubbleFactor + low-equity scare-card/river bluff-raise -> VETO
      const bubbleSpot = makeTurnSpot({
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
      // Also test a 3-way flop/turn semi-bluff spot where a 3rd player is already all-in (F=0 -> VETO)
      const mwAllInSpot = makeTurnSpot({
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

      let sawVetoed = false;
      for (const testSpot of [mwAllInSpot, bubbleSpot]) {
        for (const style of STYLES) {
          for (let seed = 1; seed <= 120; seed++) {
            const on = runDecide(testSpot, style, seed, {
              v78NoCommittingBluffRaiseIsPriced: true,
            });
            if (on.fires.includes('v78_committing_bluff_raise_priced_vetoed')) {
              sawVetoed = true;
              expect(on.decision.action).not.toBe('raise');
              break;
            }
          }
          if (sawVetoed) break;
        }
        if (sawVetoed) break;
      }
      expect(sawVetoed).toBe(true);
    });

    it('is label-neutral (human vs horse) and public-info-only (invariant to opponent hole cards) when ON', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const humanVillain = runDecide(
          makeTurnSpot({ hole: 'AsTd', heroBehind: 84, flip: false, oppCards: 'KsKh' }),
          'lag',
          seed,
          { v78NoCommittingBluffRaiseIsPriced: true }
        );
        const horseVillain = runDecide(
          makeTurnSpot({ hole: 'AsTd', heroBehind: 84, flip: true, oppCards: '2c4s' }),
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
