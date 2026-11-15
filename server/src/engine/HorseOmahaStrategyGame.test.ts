/**
 * The one game-scope gate and the one constant accessor of the 2026-11-15
 * Omaha strategy options (HorseOmahaStrategyGame.ts, the PLO6 lane's
 * accepted interface): PLO4/PLO5 unchanged; PLO6 only with
 * omahaStrategyInPlo6 === true; PLO6 constants only from its calibration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OMAHA_STRATEGY_CONSTANT_DEFAULTS,
  OMAHA_STRATEGY_GAME_SCOPE_ADMISSION,
  OMAHA_STRATEGY_GAME_SCOPE_OFF,
  OMAHA_STRATEGY_PLO45,
  omahaStrategyConstant,
  omahaStrategyGameInScope,
  omahaStrategyGameScopeNow,
  omahaStrategyGameScopeOf,
  registerOmahaPlo6StrategyCalibration,
  withOmahaStrategyGameScope,
  type OmahaStrategyConstantKey,
} from './HorseOmahaStrategyGame.js';
import {
  OMAHA_FACING_BET_EV_MARGIN,
  OMAHA_FACING_BET_EV_VARIANTS,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR,
  OMAHA_RIVER_MEDIUM_BET_VARIANTS,
} from './HorseOmahaRiverMediumBetCalls.js';
import {
  PAIRED_FOLD_RESPECTED_INVESTED_SHARE,
  PAIRED_FOLD_RESPECTED_MAX_PRICE,
  PAIRED_FOLD_RESPECTED_VARIANTS,
} from './HorsePloPairedBoardFold.js';
import {
  OMAHA_OOP_CHECK_VARIANTS,
  OMAHA_OOP_TURN_MIN_NUT_OUTS,
  OMAHA_OOP_TURN_SHOWDOWN_CREDIT,
  OMAHA_OOP_TURN_TOKEN_PRICE,
} from './HorseOmahaOopChecks.js';
import { OMAHA_CARD_IMPACT_MARGIN, OMAHA_CARD_IMPACT_VARIANTS } from './HorseOmahaCardImpact.js';
import {
  OMAHA_STREET_PLAN_MARGIN_POT_SHARE,
  OMAHA_STREET_PLAN_VARIANTS,
} from './HorseOmahaStreetPlan.js';
import { OMAHA_BIG_DRAW_MARGIN, OMAHA_BIG_DRAW_VARIANTS } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE,
  OMAHA_RAISE_NEEDS_NUTS_VARIANTS,
} from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import { OMAHA_STRONG_HAND_VALUE_VARIANTS } from './HorseOmahaStrongHandValue.js';
import { OMAHA_TURN_REDRAW_NUT_FULL_HOUSE_ONLY } from './HorseOmahaMadeHandDefense.js';
import { RERAISED_POT_VARIANTS } from './HorseOmahaReraisedPot.js';
import {
  OMAHA_TOURNAMENT_EXTENSION_VARIANTS,
  OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB,
} from './HorseOmahaTournamentScope.js';
import {
  HorseLogic,
  OMAHA_BIG_BET_POT_SHARE,
  OMAHA_ELITE_CONTINUE_MAX_POT_ODDS,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';

afterEach(() => {
  registerOmahaPlo6StrategyCalibration({});
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const SETS: ReadonlySet<string>[] = [
  OMAHA_FACING_BET_EV_VARIANTS,
  OMAHA_RIVER_MEDIUM_BET_VARIANTS,
  PAIRED_FOLD_RESPECTED_VARIANTS,
  OMAHA_OOP_CHECK_VARIANTS,
  OMAHA_CARD_IMPACT_VARIANTS,
  OMAHA_STREET_PLAN_VARIANTS,
  OMAHA_BIG_DRAW_VARIANTS,
  OMAHA_RAISE_NEEDS_NUTS_VARIANTS,
  OMAHA_STRONG_HAND_VALUE_VARIANTS,
  RERAISED_POT_VARIANTS,
  OMAHA_TOURNAMENT_EXTENSION_VARIANTS,
  OMAHA_STRATEGY_PLO45,
];

describe('omahaStrategyGameInScope', () => {
  it("PLO4/PLO5 in, PLO6 out, hi-lo and Hold'em out, with the PLO6 option unset (as before)", () => {
    expect(omahaStrategyGameScopeNow()).toBe(OMAHA_STRATEGY_GAME_SCOPE_OFF);
    for (const set of SETS) {
      expect(omahaStrategyGameInScope(set, { gameVariant: 'plo4' })).toBe(set.has('plo4'));
      expect(omahaStrategyGameInScope(set, { gameVariant: 'plo5' })).toBe(set.has('plo5'));
      for (const v of ['plo6', 'plo8', 'plo5_hilo', 'nlh', '', undefined])
        expect(omahaStrategyGameInScope(set, { gameVariant: v })).toBe(false);
      expect(omahaStrategyGameInScope(set, { gameVariant: 'plo6' }, {})).toBe(false);
      expect(
        omahaStrategyGameInScope(set, { gameVariant: 'plo6' }, { omahaStrategyInPlo6: 1 })
      ).toBe(false);
    }
  });

  it('PLO6 joins every PLO4/PLO5 set only with omahaStrategyInPlo6 === true (options or the decision scope)', () => {
    for (const set of SETS) {
      expect(
        omahaStrategyGameInScope(set, { gameVariant: 'plo6' }, { omahaStrategyInPlo6: true })
      ).toBe(true);
      withOmahaStrategyGameScope(omahaStrategyGameScopeOf({ omahaStrategyInPlo6: true }), () => {
        expect(omahaStrategyGameInScope(set, { gameVariant: 'plo6' })).toBe(true);
        expect(omahaStrategyGameInScope(set, { gameVariant: 'plo8' })).toBe(false);
        expect(omahaStrategyGameInScope(set, { gameVariant: 'nlh' })).toBe(false);
      });
      // the receipt validator keeps the PLO6 lane's own refusals: PLO6 not admitted
      withOmahaStrategyGameScope(OMAHA_STRATEGY_GAME_SCOPE_ADMISSION, () =>
        expect(omahaStrategyGameInScope(set, { gameVariant: 'plo6' })).toBe(false)
      );
    }
    // a set that is not a PLO4/PLO5 set is never widened
    withOmahaStrategyGameScope({ plo6: true }, () =>
      expect(omahaStrategyGameInScope(new Set(['nlh']), { gameVariant: 'plo6' })).toBe(false)
    );
    expect(omahaStrategyGameScopeNow()).toBe(OMAHA_STRATEGY_GAME_SCOPE_OFF);
  });

  it('HorseLogic.decide sets the decision scope from its options and restores it', () => {
    const f = JSON.parse(JSON.stringify(ACES)) as ComplaintFixture;
    const st = stateAt(f, f.actions.find((a) => a.ord === 18)!);
    const LIVE = replayProfiles('cash').find((p) => p.live)!;
    const seen: boolean[] = [];
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => {
      seen.push(omahaStrategyGameScopeNow().plo6);
      return null;
    }) as never);
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      omahaStrategyInPlo6: true,
      omahaOopTurnCheckAfterFlopCall: true,
      omahaOverpairNoOopBarrelVsValueLeader: true,
      omahaCardImpact: true,
    } as never);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(omahaStrategyGameScopeNow()).toBe(OMAHA_STRATEGY_GAME_SCOPE_OFF);
  });
});

describe('omahaStrategyConstant', () => {
  const MODULE: Record<OmahaStrategyConstantKey, number> = {
    facingBetEvMargin: OMAHA_FACING_BET_EV_MARGIN,
    riverMediumBetRangeFactor: OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR,
    pairedFoldRespectedMaxPrice: PAIRED_FOLD_RESPECTED_MAX_PRICE,
    pairedFoldRespectedInvestedShare: PAIRED_FOLD_RESPECTED_INVESTED_SHARE,
    oopTurnMinNutOuts: OMAHA_OOP_TURN_MIN_NUT_OUTS,
    oopTurnShowdownCredit: OMAHA_OOP_TURN_SHOWDOWN_CREDIT,
    oopTurnTokenPrice: OMAHA_OOP_TURN_TOKEN_PRICE,
    cardImpactMargin: OMAHA_CARD_IMPACT_MARGIN,
    streetPlanMarginPotShare: OMAHA_STREET_PLAN_MARGIN_POT_SHARE,
    bigDrawMargin: OMAHA_BIG_DRAW_MARGIN,
    raiseNeedsNutsFoldPrice: OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE,
    eliteContinueMaxPotOdds: OMAHA_ELITE_CONTINUE_MAX_POT_ODDS,
    bigBetPotShare: OMAHA_BIG_BET_POT_SHARE,
    tournamentPushFoldMaxBB: OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB,
    turnRedrawNutFullHouseOnly: OMAHA_TURN_REDRAW_NUT_FULL_HOUSE_ONLY,
  };

  it("the defaults are the modules' own constants, for every game", () => {
    expect(Object.keys(MODULE).sort()).toEqual(
      Object.keys(OMAHA_STRATEGY_CONSTANT_DEFAULTS).sort()
    );
    for (const [k, v] of Object.entries(MODULE)) {
      expect(OMAHA_STRATEGY_CONSTANT_DEFAULTS[k as OmahaStrategyConstantKey]).toBe(v);
      for (const g of ['plo4', 'plo5', 'plo6', 'nlh'])
        expect(omahaStrategyConstant(k as OmahaStrategyConstantKey, { gameVariant: g })).toBe(v);
    }
  });

  it('a PLO6 calibration moves PLO6 only, and only the keys it sets', () => {
    registerOmahaPlo6StrategyCalibration({
      oopTurnMinNutOuts: 6,
      facingBetEvMargin: Number.NaN,
      notAKey: 9,
    } as never);
    expect(omahaStrategyConstant('oopTurnMinNutOuts', { gameVariant: 'plo6' })).toBe(6);
    expect(omahaStrategyConstant('oopTurnMinNutOuts', { gameVariant: 'plo5' })).toBe(4);
    expect(omahaStrategyConstant('oopTurnMinNutOuts', { gameVariant: 'plo4' })).toBe(4);
    expect(omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' })).toBe(0.02);
    expect(omahaStrategyConstant('cardImpactMargin', { gameVariant: 'plo6' })).toBe(0.04);
  });
});
