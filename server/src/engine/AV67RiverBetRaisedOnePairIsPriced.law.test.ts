/**
 * LAW: v67RiverBetRaisedOnePairIsPriced (2026-11-22, Horse Switch lane, Wave 10.3).
 *
 * Dark, default-OFF (`=== true`), zero-migration, 100% deterministic EV-priced
 * single-board 2-card NLH river replacement for all three `v67RiverBetRaisedOnePair`
 * blanket sites (`HorseLogic.ts` Site 1 river raise stratum, Site 2 V87 river block-bet
 * raised one-pair blanket fold, and Site 3 `v67Class`/`shade67` committed & V38 river
 * overrides).
 *
 * Proves:
 *   1. Strict source purity: zero `fastRandom` / `Math.random`, zero `opponentHud/` imports.
 *   2. Dark registration: listed in `OPTION_SWITCH_REFUSED`, dev-only cards strictly in
 *      `DEVELOPMENT_LEAGUE_CARDS` and never in `LEAGUE_MATCHUPS`.
 *   3. Default-OFF bit-invariance across unset, `false`, and non-boolean truthy inputs.
 *   4. Independence from `v67RiverBetRaisedOnePair` across all 3 sites (ON vs OFF identical
 *      when `v67RiverBetRaisedOnePairIsPriced === true`, zero legacy V67 receipts).
 *   5. Zero reach to PLO4/PLO5/PLO6/PLO8, Short Deck, Fixed Limit, Pot Limit, flop/turn,
 *      multi-board, bomb pot, All-In-or-Fold, unraised bets, or two-pair+/set+ hands.
 *   6. Strictly monotonic EV pricing across raise size, opponent river-raise bluffing,
 *      card-removal blockers, board danger, multiway field count, hero class tier, and ICM.
 *   7. Full determinism across distinct `seedFastRandom` seeds and adversarial NaN /
 *      Infinity / malformed-input fail-closed safety.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import {
  V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS,
  analyzeV67RiverBoardAndBlockers,
  estimateV67RiverRaiseBluffShare,
  priceV67RiverBetRaisedOnePair,
  v67RiverBetRaisedOnePairIsPricedApplies,
  type V67RiverBetRaisedGateInput,
  type V67RiverBetRaisedPricedVerdict,
} from './HorseV67RiverBetRaisedOnePairPriced.js';
import { DEVELOPMENT_LEAGUE_CARDS, LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const fires = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

interface RaisedSpotSpec {
  variant?: string;
  hole: string;
  board: string;
  street?: 'flop' | 'turn' | 'river';
  mode?: string;
  stackChips?: number;
  heroBet?: number;
  raiseTo?: number;
  preflopPot?: number;
  communityCards2?: string;
  bombPot?: boolean;
  allInOrFold?: boolean;
  unraised?: boolean;
}

function buildSpot(f: RaisedSpotSpec) {
  const street = f.street ?? 'river';
  const stackChips = f.stackChips ?? 200;
  const preflopPot = f.preflopPot ?? 12;
  const halfPre = preflopPot / 2;
  const heroBet = f.unraised ? 0 : (f.heroBet ?? 8);
  const raiseTo = f.raiseTo ?? 24;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero-v67',
      username: 'hero',
      stack: Math.max(0, stackChips - halfPre - heroBet),
      bet: heroBet,
      totalInvested: halfPre + heroBet,
      cards: cards(f.hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    },
    {
      seat: 2,
      user_id: 'villain-v67',
      username: 'villain',
      stack: Math.max(0, stackChips - halfPre - raiseTo),
      bet: raiseTo,
      totalInvested: halfPre + raiseTo,
      cards: [],
      is_folded: false,
      is_all_in: stackChips - halfPre - raiseTo <= 0,
      is_sitting_out: false,
    },
  ];
  const history: Array<Record<string, unknown>> = [
    {
      stage: 'preflop',
      seat: 1,
      userId: 'hero-v67',
      action: 'raise',
      amount: halfPre,
      timestamp: 1,
    },
    {
      stage: 'preflop',
      seat: 2,
      userId: 'villain-v67',
      action: 'call',
      amount: halfPre - 2,
      timestamp: 2,
    },
  ];
  for (const st of ['flop', 'turn', 'river'] as const) {
    if (st === street) break;
    history.push({
      stage: st,
      seat: 2,
      userId: 'villain-v67',
      action: 'check',
      amount: 0,
      timestamp: 3,
    });
    history.push({
      stage: st,
      seat: 1,
      userId: 'hero-v67',
      action: 'check',
      amount: 0,
      timestamp: 4,
    });
  }
  if (f.unraised) {
    history.push({
      stage: street,
      seat: 2,
      userId: 'villain-v67',
      action: 'bet',
      amount: raiseTo,
      timestamp: 5,
    });
  } else {
    history.push({
      stage: street,
      seat: 2,
      userId: 'villain-v67',
      action: 'check',
      amount: 0,
      timestamp: 5,
    });
    history.push({
      stage: street,
      seat: 1,
      userId: 'hero-v67',
      action: 'bet',
      amount: heroBet,
      timestamp: 6,
    });
    history.push({
      stage: street,
      seat: 2,
      userId: 'villain-v67',
      action: 'raise',
      amount: raiseTo,
      timestamp: 7,
    });
  }
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(f.board),
      ...(f.communityCards2 ? { communityCards2: cards(f.communityCards2) } : {}),
      ...(f.bombPot ? { bombPot: true } : {}),
      ...(f.allInOrFold ? { allInOrFold: true } : {}),
      pot: preflopPot + heroBet + raiseTo,
      currentBet: raiseTo,
      minRaise: Math.max(2, raiseTo - heroBet),
      stage: street,
      gameVariant: f.variant ?? 'nlh',
      gameMode: f.mode ?? 'cash',
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

function decideWithCapture(spot: RaisedSpotSpec, opts: HorseDecideOpts, seed = 0x67001) {
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const s = buildSpot(spot);
  const raw = HorseLogic.decide(
    s.hero,
    s.gs as never,
    'balanced',
    {},
    {
      telemetry: true,
      ...opts,
    }
  );
  return {
    decision: {
      action: raw.action,
      amount: raw.amount,
      continuationGuard: (raw as { continuationGuard?: string }).continuationGuard,
    },
    thinkTime: raw.thinkTime,
    fires: fires(),
  };
}

function baseGate(overrides: Partial<V67RiverBetRaisedGateInput> = {}): V67RiverBetRaisedGateInput {
  return {
    enabled: true,
    isRiver: true,
    raisedAfterAggr: true,
    isOmaha: false,
    isPotLimit: false,
    isFixedLimit: false,
    isShortDeck: false,
    isHiLo: false,
    holeCount: 2,
    holeCardCount: 2,
    boardLength: 5,
    multiBoard: false,
    bombPot: false,
    allInOrFold: false,
    cat: 2,
    pairedBoard: false,
    toCall: 16,
    pot: 44,
    heroStack: 186,
    ...overrides,
  };
}

function assertAllVerdictFieldsFinite(v: V67RiverBetRaisedPricedVerdict) {
  expect(['call', 'fold']).toContain(v.decision);
  for (const num of [
    v.callable,
    v.potAfterCall,
    v.netPotAfterCall,
    v.potOdds,
    v.icmRiskPremium,
    v.requiredEquity,
    v.raisePotFrac,
    v.boardDanger,
    v.blockerScore,
    v.heroClassStrength,
    v.bluffShare,
    v.winVsValue,
    v.winVsBluff,
    v.posteriorEquity,
    v.evCall,
    v.evCallRiskAdjusted,
    v.evFold,
  ]) {
    expect(Number.isFinite(num)).toBe(true);
  }
  expect(v.potOdds).toBeGreaterThanOrEqual(0);
  expect(v.potOdds).toBeLessThanOrEqual(1);
  expect(v.bluffShare).toBeGreaterThanOrEqual(0);
  expect(v.bluffShare).toBeLessThanOrEqual(1);
  expect(v.posteriorEquity).toBeGreaterThanOrEqual(0);
  expect(v.posteriorEquity).toBeLessThanOrEqual(1);
  expect(v.evFold).toBe(0);
}

const DRY_BOARD = 'Qh7d2s4c9h';

describe('LAW: v67RiverBetRaisedOnePairIsPriced (dark default-OFF EV-priced NLH river replacement)', () => {
  beforeEach(() => {
    seedFastRandom(0x67000);
    HorseMind.reset();
    enableBrainTelemetry();
    drainFires();
  });

  describe('1. Source purity, dark refusal, and dev-only league cards', () => {
    it('contains zero fastRandom/Math.random calls and zero opponentHud/ imports', () => {
      const src = readFileSync(
        resolve(__dirname, 'HorseV67RiverBetRaisedOnePairPriced.ts'),
        'utf8'
      );
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(codeOnly).not.toMatch(/\bfastRandom\b/);
      expect(codeOnly).not.toMatch(/\bMath\.random\b/);
      expect(codeOnly).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
      expect(codeOnly).toMatch(/from\s+['"]\.\/holdemEmpiricalPriors\.js['"]/);
    });

    it('is dark in OPTION_SWITCH_REFUSED and has dev-only cards exclusively in DEVELOPMENT_LEAGUE_CARDS', () => {
      expect(OPTION_SWITCH_REFUSED.v67RiverBetRaisedOnePairIsPriced).toMatch(
        /pending registration/i
      );
      const expectedCards = [
        'cash6_v67_river_bet_raised_one_pair_is_priced',
        'cash9_v67_river_bet_raised_one_pair_is_priced',
        'hu_v67_river_bet_raised_one_pair_is_priced',
      ];
      const devNames = new Set(DEVELOPMENT_LEAGUE_CARDS.map((c) => c.name));
      const nightlyNames = new Set(LEAGUE_MATCHUPS.map((c) => c.name));
      for (const name of expectedCards) {
        expect(devNames.has(name), `${name} must be in DEVELOPMENT_LEAGUE_CARDS`).toBe(true);
        expect(nightlyNames.has(name), `${name} must NEVER be in LEAGUE_MATCHUPS`).toBe(false);
        const card = DEVELOPMENT_LEAGUE_CARDS.find((c) => c.name === name)!;
        expect(card.variant).toBe('nlh');
        expect(card.a).toEqual({
          v67RiverBetRaisedOnePair: true,
          v67RiverBetRaisedOnePairIsPriced: true,
        });
        expect(card.b).toEqual({ v67RiverBetRaisedOnePair: true });
      }
    });
  });

  describe('2. Default-OFF bit-invariance and independence from v67RiverBetRaisedOnePair', () => {
    it('is 100% bit-identical when unset, false, or non-boolean across all NLH & PLO spots', () => {
      const spots: Array<[string, RaisedSpotSpec]> = [
        ['nlh-river-tptk', { hole: 'AsQd', board: DRY_BOARD }],
        ['nlh-river-committed', { hole: 'KsQd', board: DRY_BOARD, stackChips: 60 }],
        [
          'nlh-river-block-bet',
          { hole: 'AsQd', board: DRY_BOARD, preflopPot: 40, heroBet: 8, raiseTo: 30 },
        ],
        ['nlh-river-mtt', { hole: 'AsQd', board: DRY_BOARD, mode: 'tournament' }],
        ['nlh-turn', { hole: 'AsQd', board: 'Qh7d2s4c', street: 'turn' }],
        ['nlh-flop', { hole: 'AsQd', board: 'Qh7d2s', street: 'flop' }],
        ['plo4-river', { variant: 'plo4', hole: 'AsQdJc3h', board: DRY_BOARD }],
        ['plo5-river', { variant: 'plo5', hole: 'AsQdJc3h5s', board: DRY_BOARD }],
      ];
      for (const [label, spot] of spots) {
        // Warm process caches once before strict equality comparisons.
        decideWithCapture(spot, {}, 0x67101);
        const baseline = decideWithCapture(spot, {}, 0x67101);
        for (const offArm of [
          { v67RiverBetRaisedOnePairIsPriced: false },
          { v67RiverBetRaisedOnePairIsPriced: undefined },
          { v67RiverBetRaisedOnePairIsPriced: 1 as unknown as boolean },
          { v67RiverBetRaisedOnePairIsPriced: 'true' as unknown as boolean },
          { v67RiverBetRaisedOnePairIsPriced: {} as unknown as boolean },
        ]) {
          const actual = decideWithCapture(spot, offArm, 0x67101);
          expect(actual.decision, label).toEqual(baseline.decision);
          expect(actual.thinkTime, label).toEqual(baseline.thinkTime);
          expect(actual.fires, label).toEqual(baseline.fires);
          for (const r of Object.values(V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS)) {
            expect(actual.fires[r], `${label} must not emit ${r}`).toBeUndefined();
          }
        }
      }
    });

    it('replaces all 3 V67 sites cleanly and is 100% independent of v67RiverBetRaisedOnePair', () => {
      const spots: Array<[string, RaisedSpotSpec, boolean]> = [
        ['regular-deep', { hole: 'AsQd', board: DRY_BOARD }, false],
        ['regular-committed', { hole: 'KsQd', board: DRY_BOARD, stackChips: 60 }, false],
        [
          'block-bet-raised',
          { hole: 'AsQd', board: DRY_BOARD, preflopPot: 40, heroBet: 8, raiseTo: 30 },
          true,
        ],
        [
          'near-allin-cheap',
          { hole: 'KsQd', board: DRY_BOARD, stackChips: 112, heroBet: 100, raiseTo: 106 },
          false,
        ],
      ];

      for (const [label, spot, isBlock] of spots) {
        const withV67On = decideWithCapture(
          spot,
          { v67RiverBetRaisedOnePair: true, v67RiverBetRaisedOnePairIsPriced: true },
          0x67202
        );
        const withV67Off = decideWithCapture(
          spot,
          { v67RiverBetRaisedOnePair: false, v67RiverBetRaisedOnePairIsPriced: true },
          0x67202
        );
        // 100% independent of v67RiverBetRaisedOnePair.
        expect(withV67On.decision, label).toEqual(withV67Off.decision);
        expect(withV67On.fires, label).toEqual(withV67Off.fires);

        // Zero legacy V67 receipts at any of the 3 sites.
        expect(withV67On.fires.v67_river_raise_stratum, label).toBeUndefined();
        expect(withV67On.fires.v67_river_bet_raised_one_pair, label).toBeUndefined();
        expect(withV67On.fires.v87_river_block_raised_one_pair_fold, label).toBeUndefined();

        // Emits exact priced receipt and never raises/jams over the raise.
        expect(['call', 'fold', 'all_in']).toContain(withV67On.decision.action);
        const expectedReceipts = isBlock
          ? [
              V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS.blockBetCallTaken,
              V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS.blockBetFoldTaken,
            ]
          : [
              V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS.callTaken,
              V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken,
            ];
        const totalPriced = expectedReceipts.reduce((sum, r) => sum + (withV67On.fires[r] ?? 0), 0);
        expect(totalPriced, `${label} must emit exactly one priced receipt`).toBe(1);
      }
    });

    it('replaces Site 2 blanket block-bet fold: calls a tiny raise with TPTK and folds a big raise with weak pair', () => {
      // Hero bets small block bet (8 into 40 = 20% pot).
      // Cheap min-raise to 14 (toCall 6 into 62 => potOdds 8.8%) -> priced CALL!
      const cheapRaise: RaisedSpotSpec = {
        hole: 'AsQd',
        board: DRY_BOARD,
        preflopPot: 40,
        heroBet: 8,
        raiseTo: 14,
      };
      const cheapRes = decideWithCapture(
        cheapRaise,
        { v67RiverBetRaisedOnePairIsPriced: true },
        0x67303
      );
      expect(cheapRes.decision.action).toBe('call');
      expect(cheapRes.fires.v67_river_bet_raised_one_pair_priced_block_bet_call_taken).toBe(1);
      expect(cheapRes.fires.v87_river_block_raised_one_pair_fold).toBeUndefined();

      // Big raise to 40 (toCall 32 into 88 => potOdds 26.7%) with second pair -> priced FOLD!
      const bigRaise: RaisedSpotSpec = {
        hole: 'Ts9d',
        board: DRY_BOARD,
        preflopPot: 40,
        heroBet: 8,
        raiseTo: 40,
      };
      const bigRes = decideWithCapture(
        bigRaise,
        { v67RiverBetRaisedOnePairIsPriced: true },
        0x67303
      );
      expect(bigRes.decision.action).toBe('fold');
      expect(bigRes.fires.v67_river_bet_raised_one_pair_priced_block_bet_fold_taken).toBe(1);
      expect(bigRes.fires.v87_river_block_raised_one_pair_fold).toBeUndefined();
    });

    it('calls near-all-in tiny price deterministically', () => {
      const tinyPrice: RaisedSpotSpec = {
        hole: 'KsQd',
        board: DRY_BOARD,
        stackChips: 112,
        heroBet: 100,
        raiseTo: 106,
      };
      const res = decideWithCapture(tinyPrice, { v67RiverBetRaisedOnePairIsPriced: true }, 0x67304);
      // Legalized call for entire remaining stack of 6 -> all_in (never folds).
      expect(res.decision.action).not.toBe('fold');
      expect(res.fires.v67_river_bet_raised_one_pair_priced_call_taken).toBe(1);
    });
  });

  describe('3. Strict single-board 2-card NLH river scope (zero non-NLH / non-river / multi-board reach)', () => {
    it('gate rejects every out-of-scope variant, street, board count, and hand class', () => {
      expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate())).toBe(true);
      expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate({ cat: 3, pairedBoard: true }))).toBe(
        true
      );

      const rejections: Array<[string, Partial<V67RiverBetRaisedGateInput>]> = [
        ['enabled=false', { enabled: false }],
        ['enabled=undefined', { enabled: undefined }],
        ['enabled="true"', { enabled: 'true' }],
        ['not river', { isRiver: false }],
        ['not raised after our bet', { raisedAfterAggr: false }],
        ['Omaha', { isOmaha: true }],
        ['Pot Limit', { isPotLimit: true }],
        ['Fixed Limit', { isFixedLimit: true }],
        ['Short Deck', { isShortDeck: true }],
        ['Hi-Lo', { isHiLo: true }],
        ['4-card holeCount', { holeCount: 4 }],
        ['3-card holeCardCount', { holeCardCount: 3 }],
        ['turn board length 4', { boardLength: 4 }],
        ['multi-board', { multiBoard: true }],
        ['bomb pot', { bombPot: true }],
        ['all-in-or-fold', { allInOrFold: true }],
        ['true two pair on unpaired board', { cat: 3, pairedBoard: false }],
        ['trips/set', { cat: 4 }],
        ['straight', { cat: 5 }],
        ['flush', { cat: 6 }],
        ['cat <= 0', { cat: 0 }],
        ['toCall <= 0', { toCall: 0 }],
        ['pot <= 0', { pot: 0 }],
        ['negative stack', { heroStack: -1 }],
      ];
      for (const [label, override] of rejections) {
        expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate(override)), label).toBe(false);
      }
    });

    it('produces 0 bytes of behavior change on PLO4/5/6, flop/turn, multi-board, bomb-pot, unraised river, and two-pair+/set', () => {
      const outOfScope: Array<[string, RaisedSpotSpec]> = [
        ['plo4-river', { variant: 'plo4', hole: 'AsQdJc3h', board: DRY_BOARD }],
        ['plo5-river', { variant: 'plo5', hole: 'AsQdJc3h5s', board: DRY_BOARD }],
        ['plo6-river', { variant: 'plo6', hole: 'AsQdJc3h5s8d', board: DRY_BOARD }],
        ['plo8-river', { variant: 'plo8', hole: 'AsQdJc3h', board: DRY_BOARD }],
        ['flh-river', { variant: 'flh', hole: 'AsQd', board: DRY_BOARD }],
        ['short_deck-river', { variant: 'short_deck', hole: 'AsQd', board: 'Qh8d6s9cJh' }],
        ['nlh-flop', { hole: 'AsQd', board: 'Qh7d2s', street: 'flop' }],
        ['nlh-turn', { hole: 'AsQd', board: 'Qh7d2s4c', street: 'turn' }],
        ['nlh-multi-board', { hole: 'AsQd', board: DRY_BOARD, communityCards2: 'Kh8c3d5s2c' }],
        ['nlh-bomb-pot', { hole: 'AsQd', board: DRY_BOARD, bombPot: true }],
        ['nlh-aof', { hole: 'AsQd', board: DRY_BOARD, allInOrFold: true }],
        ['nlh-unraised-river', { hole: 'AsQd', board: DRY_BOARD, unraised: true }],
        ['nlh-true-two-pair', { hole: 'Qs9c', board: DRY_BOARD }],
        ['nlh-set', { hole: '7s7c', board: DRY_BOARD }],
      ];
      for (const [label, spot] of outOfScope) {
        decideWithCapture(spot, {}, 0x67404);
        const off = decideWithCapture(spot, {}, 0x67404);
        const on = decideWithCapture(spot, { v67RiverBetRaisedOnePairIsPriced: true }, 0x67404);
        expect(on.decision, label).toEqual(off.decision);
        expect(on.fires, label).toEqual(off.fires);
        for (const r of Object.values(V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS)) {
          expect(on.fires[r], `${label} must not emit ${r}`).toBeUndefined();
        }
      }
    });
  });

  describe('4. Monotonic EV pricing across raise size, opponent bluff-raising, blockers, board danger, and ICM', () => {
    it('strictly decreases EV margin and EV(call) as raise size increases', () => {
      const potBeforeRaise = 28;
      const hole = cards('AsQd');
      const board = cards(DRY_BOARD);
      const raiseSizes = [4, 8, 16, 28, 48];
      const verdicts = raiseSizes.map((toCall) =>
        priceV67RiverBetRaisedOnePair({
          pot: potBeforeRaise + toCall,
          toCall,
          heroStack: 200,
          hole,
          board,
          cat: 2,
        })
      );

      for (const v of verdicts) assertAllVerdictFieldsFinite(v);
      // Cheap min-raise calls; large raises fold.
      expect(verdicts[0].decision).toBe('call');
      expect(verdicts[verdicts.length - 1].decision).toBe('fold');

      for (let i = 1; i < verdicts.length; i++) {
        expect(verdicts[i].potOdds).toBeGreaterThan(verdicts[i - 1].potOdds);
        expect(verdicts[i].bluffShare).toBeLessThanOrEqual(verdicts[i - 1].bluffShare);
        expect(verdicts[i].posteriorEquity).toBeLessThanOrEqual(verdicts[i - 1].posteriorEquity);
        expect(verdicts[i].evCall).toBeLessThan(verdicts[i - 1].evCall);
        expect(verdicts[i].evCallRiskAdjusted / verdicts[i].netPotAfterCall).toBeLessThan(
          verdicts[i - 1].evCallRiskAdjusted / verdicts[i - 1].netPotAfterCall
        );
      }
    });

    it('strictly increases bluffShare, posteriorEquity, and EV(call) as opponent river-raise bluffing rises', () => {
      const hole = cards('AsQd');
      const board = cards(DRY_BOARD);

      // 1) Explicit measured riverRaiseBluffRate sweep
      const rates = [0.02, 0.12, 0.28, 0.55];
      const byRate = rates.map((riverRaiseBluffRate) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 16,
          heroStack: 186,
          hole,
          board,
          cat: 2,
          villain: { riverRaiseBluffRate, riverRaiseBluffSample: 24 },
        })
      );
      expect(byRate[0].decision).toBe('fold');
      expect(byRate[byRate.length - 1].decision).toBe('call');
      for (let i = 1; i < byRate.length; i++) {
        expect(byRate[i].bluffShare).toBeGreaterThan(byRate[i - 1].bluffShare);
        expect(byRate[i].posteriorEquity).toBeGreaterThan(byRate[i - 1].posteriorEquity);
        expect(byRate[i].evCall).toBeGreaterThan(byRate[i - 1].evCall);
      }

      // 2) Continuous exploitCallDownMod sweep (no binary cliff at 1.0)
      const mods = [0.85, 1.0, 1.25, 1.55];
      const byMod = mods.map((exploitCallDownMod) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 16,
          heroStack: 186,
          hole,
          board,
          cat: 2,
          villain: { exploitCallDownMod },
        })
      );
      for (let i = 1; i < byMod.length; i++) {
        expect(byMod[i].bluffShare).toBeGreaterThan(byMod[i - 1].bluffShare);
        expect(byMod[i].evCall).toBeGreaterThan(byMod[i - 1].evCall);
      }

      // 3) Structural OpponentHud river-raise frequency sweep (zero opponentHud/ import)
      const hudHits = [1, 3, 8, 16];
      const byHud = hudHits.map((hits) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 16,
          heroStack: 186,
          hole,
          board,
          cat: 2,
          villain: { hudOpp: { eff: { 'r.raise': [40, hits] } } },
        })
      );
      for (let i = 1; i < byHud.length; i++) {
        expect(byHud[i].bluffShare).toBeGreaterThan(byHud[i - 1].bluffShare);
        expect(byHud[i].evCall).toBeGreaterThan(byHud[i - 1].evCall);
      }
    });

    it('strictly rewards card-removal blockers (nut flush blocker & top straight blocker)', () => {
      // 4-flush river: AhQd blocks the nut heart flush; AcQd holds zero heart blockers.
      const fourFlushBoard = cards('Qh7h2h4h9s');
      const noFlushBlocker = priceV67RiverBetRaisedOnePair({
        pot: 40,
        toCall: 12,
        heroStack: 180,
        hole: cards('AcQd'),
        board: fourFlushBoard,
        cat: 2,
      });
      const secondFlushBlocker = priceV67RiverBetRaisedOnePair({
        pot: 40,
        toCall: 12,
        heroStack: 180,
        hole: cards('KhQd'),
        board: fourFlushBoard,
        cat: 2,
      });
      const nutFlushBlocker = priceV67RiverBetRaisedOnePair({
        pot: 40,
        toCall: 12,
        heroStack: 180,
        hole: cards('AhQd'),
        board: fourFlushBoard,
        cat: 2,
      });
      expect(nutFlushBlocker.blockerScore).toBeGreaterThan(secondFlushBlocker.blockerScore);
      expect(secondFlushBlocker.blockerScore).toBeGreaterThan(noFlushBlocker.blockerScore);
      expect(nutFlushBlocker.bluffShare).toBeGreaterThan(secondFlushBlocker.bluffShare);
      expect(secondFlushBlocker.bluffShare).toBeGreaterThan(noFlushBlocker.bluffShare);
      expect(nutFlushBlocker.evCall).toBeGreaterThan(noFlushBlocker.evCall);

      // Straight-possible river: holding J blocks J9/JK top straights on QhTs8c7s2d.
      const straightBoard = cards('QhTs8c7s2d');
      const noStraightBlocker = priceV67RiverBetRaisedOnePair({
        pot: 40,
        toCall: 10,
        heroStack: 180,
        hole: cards('3d8d'),
        board: straightBoard,
        cat: 2,
      });
      const withStraightBlocker = priceV67RiverBetRaisedOnePair({
        pot: 40,
        toCall: 10,
        heroStack: 180,
        hole: cards('Jd8d'),
        board: straightBoard,
        cat: 2,
      });
      expect(withStraightBlocker.blockerScore).toBeGreaterThan(noStraightBlocker.blockerScore);
      expect(withStraightBlocker.bluffShare).toBeGreaterThan(noStraightBlocker.bluffShare);
      expect(withStraightBlocker.evCall).toBeGreaterThan(noStraightBlocker.evCall);
    });

    it('strictly penalizes increasing board danger (dry -> paired / 3-flush -> 4-flush / 4-straight)', () => {
      // Hold hero pair strength & top-rank blocker constant (AcQd on Q-high boards with no flush blocker).
      const hole = cards('AcQd');
      const boards = [
        cards('Qh7d2s4c9h'), // dry rainbow: danger = 0
        cards('Qh7d7s4c2h'), // single-paired: danger = 0.22
        cards('Qh7h2h4c9s'), // 3-flush: danger = 0.28
        cards('Qh7h2h4h9s'), // 4-flush: danger = 0.55
        cards('Qh7h7s4h2h'), // 4-flush + paired: danger = 0.77
      ];
      const verdicts = boards.map((board) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 12,
          heroStack: 180,
          hole,
          board,
          cat: board.filter((c) => c.rank === '7').length >= 2 ? 3 : 2,
        })
      );
      for (let i = 1; i < verdicts.length; i++) {
        expect(verdicts[i].boardDanger).toBeGreaterThan(verdicts[i - 1].boardDanger);
        expect(verdicts[i].bluffShare).toBeLessThan(verdicts[i - 1].bluffShare);
        expect(verdicts[i].winVsValue).toBeLessThan(verdicts[i - 1].winVsValue);
        expect(verdicts[i].posteriorEquity).toBeLessThan(verdicts[i - 1].posteriorEquity);
        expect(verdicts[i].evCall).toBeLessThan(verdicts[i - 1].evCall);
      }
    });

    it('strictly respects tournament ICM risk, multiway field count, and hero pair tier ordering', () => {
      const hole = cards('AsQd');
      const board = cards(DRY_BOARD);

      // ICM risk monotonicity
      const icmLevels = [0, 0.04, 0.1, 0.18];
      const byIcm = icmLevels.map((icmRisk) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 6,
          heroStack: 186,
          hole,
          board,
          cat: 2,
          icmRisk,
        })
      );
      expect(byIcm[0].decision).toBe('call');
      expect(byIcm[byIcm.length - 1].decision).toBe('fold');
      for (let i = 1; i < byIcm.length; i++) {
        expect(byIcm[i].requiredEquity).toBeGreaterThan(byIcm[i - 1].requiredEquity);
        expect(byIcm[i].evCallRiskAdjusted).toBeLessThan(byIcm[i - 1].evCallRiskAdjusted);
      }

      // Multiway discount monotonicity
      const byOppCount = [1, 2, 3].map((oppCount) =>
        priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: 10,
          heroStack: 186,
          hole,
          board,
          cat: 2,
          oppCount,
        })
      );
      for (let i = 1; i < byOppCount.length; i++) {
        expect(byOppCount[i].bluffShare).toBeLessThan(byOppCount[i - 1].bluffShare);
        expect(byOppCount[i].evCall).toBeLessThan(byOppCount[i - 1].evCall);
      }

      // Hero hand tier ordering on dry Q7249
      const tiers = [
        analyzeV67RiverBoardAndBlockers(cards('AsKd'), board, 1), // high_card
        analyzeV67RiverBoardAndBlockers(cards('5s5d'), board, 2), // underpair
        analyzeV67RiverBoardAndBlockers(cards('Ts9d'), board, 2), // middle_pair
        analyzeV67RiverBoardAndBlockers(cards('KsQd'), board, 2), // top_pair
        analyzeV67RiverBoardAndBlockers(cards('AsAd'), board, 2), // overpair
      ];
      expect(tiers.map((t) => t.heroHandTier)).toEqual([
        'high_card',
        'underpair',
        'middle_pair',
        'top_pair',
        'overpair',
      ]);
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].heroClassStrength).toBeGreaterThan(tiers[i - 1].heroClassStrength);
      }
    });
  });

  describe('5. Determinism and adversarial NaN / Infinity safety', () => {
    it('is 100% deterministic across distinct fastRandom seeds (pure function and HorseLogic.decide)', () => {
      const spot: RaisedSpotSpec = { hole: 'AsQd', board: DRY_BOARD };
      const first = decideWithCapture(spot, { v67RiverBetRaisedOnePairIsPriced: true }, 111111);
      for (const seed of [222222, 333333, 444444, 987654321]) {
        const next = decideWithCapture(spot, { v67RiverBetRaisedOnePairIsPriced: true }, seed);
        expect(next.decision).toEqual(first.decision);
        expect(next.fires).toEqual(first.fires);
      }

      const v1 = priceV67RiverBetRaisedOnePair({
        pot: 44,
        toCall: 16,
        heroStack: 186,
        hole: cards('AsQd'),
        board: cards(DRY_BOARD),
        cat: 2,
      });
      const v2 = priceV67RiverBetRaisedOnePair({
        pot: 44,
        toCall: 16,
        heroStack: 186,
        hole: cards('AsQd'),
        board: cards(DRY_BOARD),
        cat: 2,
      });
      expect(v2).toEqual(v1);
    });

    it('fails closed with 100% finite outputs on NaN, Infinity, -Infinity, and malformed inputs', () => {
      const badNums = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -50, 0];
      for (const bad of badNums) {
        expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate({ pot: bad }))).toBe(false);
        expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate({ toCall: bad }))).toBe(false);
        if (bad !== 0) {
          expect(v67RiverBetRaisedOnePairIsPricedApplies(baseGate({ heroStack: bad }))).toBe(false);
        }
        const vPot = priceV67RiverBetRaisedOnePair({
          pot: bad,
          toCall: 16,
          heroStack: 100,
          hole: cards('AsQd'),
          board: cards(DRY_BOARD),
          cat: 2,
        });
        assertAllVerdictFieldsFinite(vPot);
        expect(vPot.decision).toBe('fold');

        const vCall = priceV67RiverBetRaisedOnePair({
          pot: 44,
          toCall: bad,
          heroStack: 100,
          hole: cards('AsQd'),
          board: cards(DRY_BOARD),
          cat: 2,
        });
        assertAllVerdictFieldsFinite(vCall);
        expect(vCall.decision).toBe('fold');
      }

      // Adversarial optional fields must never throw or propagate NaN/Infinity.
      const adv = priceV67RiverBetRaisedOnePair({
        pot: 44,
        toCall: 12,
        heroStack: 186,
        hole: [],
        board: [],
        cat: Number.NaN,
        oppCount: Number.POSITIVE_INFINITY,
        callDeductionFraction: Number.NaN,
        sideGamePotOverlay: Number.NEGATIVE_INFINITY,
        icmRisk: Number.POSITIVE_INFINITY,
        wasBlockBet: true,
        blockBetFrac: Number.NaN,
        villain: {
          exploitCallDownMod: Number.NaN,
          riverRaiseBluffRate: Number.POSITIVE_INFINITY,
          riverRaiseBluffSample: Number.NaN,
          styleAggressionScore: Number.POSITIVE_INFINITY,
          styleBettingRangeScore: Number.NEGATIVE_INFINITY,
          styleConfidence: Number.NaN,
          styleSizeShown: { shown: Number.NaN, strong: Number.POSITIVE_INFINITY },
          hudOpp: { eff: { 'r.raise': [Number.NaN, Number.POSITIVE_INFINITY] } },
        },
      });
      assertAllVerdictFieldsFinite(adv);

      const bluffAdv = estimateV67RiverRaiseBluffShare({
        raisePotFrac: Number.NaN,
        boardDanger: Number.POSITIVE_INFINITY,
        blockerScore: Number.NEGATIVE_INFINITY,
        oppCount: Number.NaN,
        wasBlockBet: true,
        blockBetFrac: Number.POSITIVE_INFINITY,
      });
      expect(Number.isFinite(bluffAdv.bluffShare)).toBe(true);
      expect(Number.isFinite(bluffAdv.preBlockerBluffShare)).toBe(true);
      expect(Number.isFinite(bluffAdv.empiricalBaseBluffShare)).toBe(true);
    });
  });
});
