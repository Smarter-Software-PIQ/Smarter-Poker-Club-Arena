/**
 * LAW: `holdemRiverLeadRangeIsPriced` (2026-11-22, Horse Switch lane, dark default OFF, read === true).
 *
 * Proves every contract for the priced replacement of `riverLeadRange` (A4 in
 * `REVIEW-HOLDEM-OFFLIST-20261121.md` §5):
 *   1. Strict fail-closed structural gate (`holdemRiverLeadRangeIsPricedApplies`): single-board
 *      2-card NLH heads-up OOP river leads first-to-act only; zero reach to PLO4/5/6, Hi-Lo,
 *      Short Deck, Fixed Limit, multi-board, bomb pot, All-In-or-Fold, multiway, IP, or
 *      `holdemRiverFullHouseValue`-owned river boats.
 *   2. Dark registration & governance: refused in `OPTION_SWITCH_REFUSED`, mirrored in
 *      `scripts/ci/test-horse-option-switch-evidence-postgres.sh`, registered in
 *      `HorseDataLedger.ts` (flag + 5 literal `holdem_river_lead_range_priced_*_seen` receipts),
 *      registered in `HorseReferenceDecisionSources.ts`, and backed by dev-only league cards
 *      (`cash6_holdem_river_lead_range_is_priced`, `hu_holdem_river_lead_range_is_priced`) in
 *      `DEVELOPMENT_LEAGUE_CARDS` (never `LEAGUE_MATCHUPS`).
 *   3. Pure determinism & zero forbidden dependencies: `HorseHoldemRiverLeadRangeIsPriced.ts`
 *      uses zero `fastRandom` / `Math.random`, zero `opponentHud/` imports, and exact
 *      probability-conserving quantile partitions over measured NLH empirical priors from
 *      `holdemEmpiricalPriors.ts`.
 *   4. EV pricing invariants:
 *      - Cleanly separates thin-value leads (passive check-back opponent who calls worse) from
 *        check-calls / check-raises (aggressive stabber with high `betWhenCheckedTo`).
 *      - Prices draw-completing strong value leads and blocker bluff leads deterministically,
 *        while checking air vs stations / blank-river junk and avoiding value-owning thin value
 *        into tight folders.
 *      - Prices villain raise risk, call-range equity conditioning, rake deduction, tournament
 *        ICM risk, and effective-stack capping.
 *   5. End-to-end `HorseLogic.decide` invariants:
 *      - Bit-identical when OFF (absent, `false`, non-boolean) across NLH and PLO4/5/8.
 *      - Zero reach to PLO4/5/8, non-lead `riverBluffBaseline`, `holdemRiverFullHouseValue`,
 *        or IP / non-river spots when ON.
 *      - Independent of `riverLeadRange` (`riverLeadRange: false` produces identical priced
 *        decisions and receipts as `riverLeadRange: true` when `holdemRiverLeadRangeIsPriced: true`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_LEAGUE_CARDS,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
} from '../benchmark/HorseLeague.js';
import { resolveLeagueCard } from '../benchmark/HorseLeagueCard.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER, ledgerReceiptFor } from './HorseDataLedger.js';
import {
  HOLDEM_RIVER_LEAD_CANDIDATE_FRACS,
  HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS,
  HOLDEM_RIVER_LEAD_STATION_BLUFF_FOLD_CAP,
  conditionHoldemRiverLeadResponse,
  conditionHoldemRiverVillainBetWhenCheckedTo,
  estimateHoldemRiverLeadFoldToBet,
  evaluateHoldemRiverOopCheck,
  holdemRiverLeadFoldPrior,
  holdemRiverLeadRangeIsPricedApplies,
  holdemRiverLeadRangePricedVerdict,
  type HoldemRiverLeadRangePricedGateInput,
  type HoldemRiverLeadRangePricedInput,
} from './HorseHoldemRiverLeadRangeIsPriced.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED, optionSwitchRefusal } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import { seedFastRandom } from './HorseEval.js';
import {
  c,
  decideLeadSpot,
  leadSpotState,
  type LeadSpot,
} from './HorseRiverLeadHiLo.test-support.js';
import { DECISION_TIME_MS, seedOpponentRiverRead } from './HorseV54RiverBluff.test-support.js';

const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

const VALID_GATE: HoldemRiverLeadRangePricedGateInput = {
  enabled: true,
  isOmaha: false,
  isPotLimit: false,
  isHiLo: false,
  isShortDeck: false,
  isFixedLimit: false,
  holeCount: 2,
  holeCardCount: 2,
  boardLength: 5,
  isRiver: true,
  facingBet: false,
  inPosition: false,
  multiBoard: false,
  bombPot: false,
  allInOrFold: false,
  satelliteActive: false,
  barrelOutlookRiverPending: false,
  holdemRiverFullHouseOwned: false,
  opponentsLive: 1,
  opponentCanRespond: true,
  pot: 68,
  heroStack: 166,
  villainStack: 166,
};

function baseVerdictInput(
  over: Partial<HoldemRiverLeadRangePricedInput> = {}
): HoldemRiverLeadRangePricedInput {
  return {
    pot: 100,
    heroStack: 200,
    villainStack: 200,
    bigBlind: 2,
    showdownEquity: 0.88,
    completedDraw: 'flush',
    scareCard: true,
    riverHelpsHero: true,
    rangesFavorOpponent: false,
    nutBlocker: false,
    unblocker: false,
    missedDraw: false,
    callDeductionFraction: 0,
    icmRisk: 0,
    station: false,
    villainAggressive: false,
    villainPassive: false,
    riverFoldRate: null,
    fastCalldownCallingMore: false,
    lightCallerFactor: 1,
    bluffMod: 1,
    ...over,
  };
}

/** K-9-6-2 with two hearts on the turn; 7h completes the flush. */
const FLUSH_RIVER = [c('K', H), c('9', H), c('6', D), c('2', C), c('7', H)];
/** Same turn, Ac river completes no flush or straight draw. */
const BLANK_RIVER = [c('K', H), c('9', H), c('6', D), c('2', C), c('A', C)];

const NLH_LEAD_MADE_FLUSH: LeadSpot = {
  name: 'nlh_lead_made_flush',
  variant: 'nlh',
  hole: [c('Q', H), c('T', H)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

const NLH_LEAD_THIN_TOP_PAIR: LeadSpot = {
  name: 'nlh_lead_thin_top_pair',
  variant: 'nlh',
  hole: [c('K', S), c('J', D)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

const NLH_LEAD_BLOCKER_AIR: LeadSpot = {
  name: 'nlh_lead_blocker_air',
  variant: 'nlh',
  hole: [c('A', H), c('4', C)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

const NLH_LEAD_BLANK_JUNK: LeadSpot = {
  name: 'nlh_lead_blank_junk',
  variant: 'nlh',
  hole: [c('8', C), c('4', S)],
  board: BLANK_RIVER,
  behind: 166,
  line: 'lead',
};

const NLH_IP_BARREL_CONTROL: LeadSpot = {
  name: 'nlh_ip_barrel_control',
  variant: 'nlh',
  hole: [c('A', H), c('4', C)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'barrel',
};

const PLO4_LEAD_FLUSH: LeadSpot = {
  name: 'plo4_lead_made_flush',
  variant: 'plo4',
  hole: [c('A', H), c('Q', H), c('8', S), c('4', D)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

const PLO5_LEAD_BLOCKER: LeadSpot = {
  name: 'plo5_lead_blocker',
  variant: 'plo5',
  hole: [c('A', H), c('Q', C), c('8', S), c('4', D), c('3', S)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

const PLO8_LEAD_BLOCKER: LeadSpot = {
  name: 'plo8_lead_blocker',
  variant: 'plo8',
  hole: [c('A', H), c('4', D), c('J', S), c('Q', D)],
  board: FLUSH_RIVER,
  behind: 166,
  line: 'lead',
};

function seedPassiveStationOpp(): void {
  HorseMind.reset();
  HorseMind.importStats([
    {
      user_id: 'opp3',
      hands: 400,
      vpip: 140,
      pfr: 30,
      threeBet: 4,
      aggr: 35,
      passive: 260,
      folds: 18,
      facedAggr: 120,
      riverBetOpps: 40,
      riverBetFolds: 7,
    },
  ]);
}

function seedAggressiveLagOpp(): void {
  HorseMind.reset();
  HorseMind.importStats([
    {
      user_id: 'opp3',
      hands: 400,
      vpip: 190,
      pfr: 145,
      threeBet: 45,
      aggr: 320,
      passive: 40,
      folds: 35,
      facedAggr: 100,
      riverBetOpps: 40,
      riverBetFolds: 14,
    },
  ]);
}

describe('LAW: holdemRiverLeadRangeIsPriced governance, dark registration, and source purity', () => {
  it('stays dark in OPTION_SWITCH_REFUSED, HorseDataLedger, HorseReferenceDecisionSources, and DEVELOPMENT_LEAGUE_CARDS', () => {
    expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'holdemRiverLeadRangeIsPriced')).toBe(true);
    expect(optionSwitchRefusal('holdemRiverLeadRangeIsPriced')).toMatch(/pending registration/i);

    const flagEntry = HORSE_DATA_LEDGER.find(
      (e) => e.kind === 'flag' && e.key === 'holdemRiverLeadRangeIsPriced'
    );
    expect(flagEntry).toBeDefined();
    expect(flagEntry!.note).toMatch(/default OFF/i);

    for (const receiptKey of Object.values(HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS)) {
      expect(
        ledgerReceiptFor(receiptKey),
        `receipt ${receiptKey} must be registered`
      ).toBeDefined();
    }

    expect(
      HORSE_REFERENCE_DECISION_SOURCE_REASONS['src/engine/HorseHoldemRiverLeadRangeIsPriced.ts']
    ).toBeDefined();

    const devNames = new Set(DEVELOPMENT_LEAGUE_CARDS.map((m) => m.name));
    const nightlyNames = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    for (const cardName of [
      'cash6_holdem_river_lead_range_is_priced',
      'hu_holdem_river_lead_range_is_priced',
    ]) {
      expect(devNames.has(cardName), `${cardName} must be in DEVELOPMENT_LEAGUE_CARDS`).toBe(true);
      expect(nightlyNames.has(cardName), `${cardName} must NEVER be in LEAGUE_MATCHUPS`).toBe(
        false
      );
      const card = resolveLeagueCard(
        cardName,
        [...LEAGUE_MATCHUPS, ...DEVELOPMENT_LEAGUE_CARDS],
        UNMEASURABLE_MATCHUPS
      );
      expect(card.variant).toBe('nlh');
      expect((card.a as Record<string, unknown>).holdemRiverLeadRangeIsPriced).toBe(true);
      expect((card.a as Record<string, unknown>).riverLeadRange).toBe(true);
      expect((card.b as Record<string, unknown>).holdemRiverLeadRangeIsPriced).toBeUndefined();
      expect((card.b as Record<string, unknown>).riverLeadRange).toBe(true);
    }
  });

  it('contains zero fastRandom, zero Math.random, and zero opponentHud/ imports', () => {
    const rawSrc = readFileSync(
      resolve(process.cwd(), 'src/engine/HorseHoldemRiverLeadRangeIsPriced.ts'),
      'utf8'
    );
    const codeOnly = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/\bfastRandom\s*\(/);
    expect(codeOnly).not.toMatch(/\bMath\.random\s*\(/);
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*opponentHud/);
    expect(codeOnly).toMatch(/from\s+['"]\.\/holdemEmpiricalPriors\.js['"]/);
  });

  it('mirrors holdemRiverLeadRangeIsPriced in the CI postgres option-switch proof refused list', () => {
    const script = readFileSync(
      resolve(process.cwd(), '../scripts/ci/test-horse-option-switch-evidence-postgres.sh'),
      'utf8'
    );
    const refusedLine = script.match(/^refused='([^']+)'/m)?.[1] ?? '';
    expect(refusedLine.split(/\s+/)).toContain('holdemRiverLeadRangeIsPriced');
  });
});

describe('LAW: holdemRiverLeadRangeIsPricedApplies fails closed outside single-board 2-card NLH OOP rivers', () => {
  it('accepts valid single-board 2-card NLH OOP heads-up river spots', () => {
    expect(holdemRiverLeadRangeIsPricedApplies(VALID_GATE)).toBe(true);
  });

  it.each<[string, Partial<HoldemRiverLeadRangePricedGateInput>]>([
    ['enabled false', { enabled: false }],
    ['enabled undefined', { enabled: undefined }],
    ['enabled non-boolean string', { enabled: 'true' }],
    ['Omaha', { isOmaha: true }],
    ['Pot Limit', { isPotLimit: true }],
    ['Hi-Lo', { isHiLo: true }],
    ['Short Deck', { isShortDeck: true }],
    ['Fixed Limit', { isFixedLimit: true }],
    ['holeCount 4', { holeCount: 4 }],
    ['holeCardCount 4', { holeCardCount: 4 }],
    ['boardLength 4 (turn)', { boardLength: 4 }],
    ['not river', { isRiver: false }],
    ['facing a bet', { facingBet: true }],
    ['in position', { inPosition: true }],
    ['multi-board', { multiBoard: true }],
    ['bomb pot', { bombPot: true }],
    ['All-In-or-Fold', { allInOrFold: true }],
    ['satellite locked', { satelliteActive: true }],
    ['barrel outlook pending', { barrelOutlookRiverPending: true }],
    ['holdemRiverFullHouseValue owned', { holdemRiverFullHouseOwned: true }],
    ['multiway (2 opponents)', { opponentsLive: 2 }],
    ['opponent cannot respond', { opponentCanRespond: false }],
    ['zero pot', { pot: 0 }],
    ['zero heroStack', { heroStack: 0 }],
    ['zero villainStack', { villainStack: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(holdemRiverLeadRangeIsPricedApplies({ ...VALID_GATE, ...override })).toBe(false);
  });
});

describe('LAW: holdemRiverLeadRangePricedVerdict pure EV pricing & conservation invariants', () => {
  it('conserves exact unconditional showdown equity across BOTH check and lead quantile partitions', () => {
    for (const eq of [0.05, 0.22, 0.48, 0.65, 0.82, 0.96]) {
      const input = baseVerdictInput({ showdownEquity: eq });
      const ck = evaluateHoldemRiverOopCheck(input);
      const b = ck.villainBetWhenCheckedTo;
      const checkTotal = (1 - b) * ck.eqVsCheckBack + b * ck.eqVsVillainBet;
      expect(checkTotal).toBeCloseTo(eq, 8);

      const v = holdemRiverLeadRangePricedVerdict(input);
      for (const cand of v.candidates) {
        expect(cand.foldProb + cand.callProb + cand.raiseProb).toBeCloseTo(1, 8);
        const rBluff = cand.raiseProb * 0.18;
        const eqFold =
          cand.foldProb > 1e-9
            ? Math.max(0, Math.min(cand.foldProb, eq - rBluff)) / cand.foldProb
            : 0;
        const leadTotal =
          cand.foldProb * eqFold +
          cand.callProb * cand.eqWhenCalled +
          cand.raiseProb * cand.eqVsVillainRaise;
        expect(leadTotal).toBeCloseTo(eq, 8);
      }
    }
  });

  it('monotonically increases empirical river first-bet fold prior with bet size and shrinks smoothly with HUD / ExploitCounters', () => {
    const p33 = holdemRiverLeadFoldPrior(0.33);
    const p55 = holdemRiverLeadFoldPrior(0.55);
    const p75 = holdemRiverLeadFoldPrior(0.75);
    const p100 = holdemRiverLeadFoldPrior(1.0);
    expect(p33).toBeLessThan(p55);
    expect(p55).toBeLessThan(p75);
    expect(p75).toBeLessThan(p100);

    const poolOnly = estimateHoldemRiverLeadFoldToBet(0.55, null, null);
    expect(poolOnly.source).toBe('pool_prior');
    expect(poolOnly.mean).toBeCloseTo(p55, 8);

    const stickyHud = estimateHoldemRiverLeadFoldToBet(0.55, {
      eff: { 'r.fb.sm.hu': [30, 5] },
    });
    expect(stickyHud.source).toBe('hud_context');
    expect(stickyHud.mean).toBeLessThan(poolOnly.mean - 0.15);

    const folderCounters = estimateHoldemRiverLeadFoldToBet(0.55, null, {
      riverCall: 3,
      riverCallOpp: 25,
    });
    expect(folderCounters.source).toBe('exploit_counters');
    expect(folderCounters.mean).toBeGreaterThan(poolOnly.mean + 0.15);
  });

  it('cleanly separates thin-value leads (passive check-back villain who calls worse) from check-calls/check-raises (aggressive stabber)', () => {
    // Passive opponent checks back too often and calls small/medium thin value worse -> thin-value block lead!
    const thinVsPassive = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.66,
        completedDraw: null,
        scareCard: false,
        riverHelpsHero: false,
        station: true,
        villainPassive: true,
        exploitCounters: {
          riverCall: 17,
          riverCallOpp: 26,
          betCheckedTo: 3,
          betCheckedToOpp: 24,
        },
      })
    );
    expect(thinVsPassive.decision).toBe('lead');
    expect(thinVsPassive.kind).toBe('thin_value');
    expect(thinVsPassive.betPotFrac).toBeLessThanOrEqual(0.55 + 1e-6);

    // Same medium showdown hand vs a tight-ish caller (folds worse, calls mostly better -> eqWhenCalled < 0.50) -> check!
    const thinVsTightCaller = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.58,
        completedDraw: null,
        scareCard: false,
        riverHelpsHero: false,
        exploitCounters: {
          riverCall: 11,
          riverCallOpp: 25,
          betCheckedTo: 9,
          betCheckedToOpp: 25,
        },
      })
    );
    expect(thinVsTightCaller.decision).toBe('check');

    // Bluff-catcher (eq = 0.50) vs aggressive stabber -> check-call beats leading!
    const bluffCatcherVsLag = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.5,
        completedDraw: null,
        scareCard: false,
        riverHelpsHero: false,
        villainAggressive: true,
        exploitCounters: {
          riverCall: 14,
          riverCallOpp: 25,
          betCheckedTo: 18,
          betCheckedToOpp: 25,
        },
      })
    );
    expect(bluffCatcherVsLag.decision).toBe('check');
    expect(bluffCatcherVsLag.checkEval.bestCheckResponse).toBe('check_call');

    // Monster (eq = 0.96) on blank river vs aggressive stabber -> check-raise beats leading!
    const monsterVsLag = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.96,
        completedDraw: null,
        scareCard: false,
        riverHelpsHero: false,
        villainAggressive: true,
        exploitCounters: {
          riverCall: 10,
          riverCallOpp: 25,
          betCheckedTo: 19,
          betCheckedToOpp: 25,
        },
      })
    );
    expect(monsterVsLag.decision).toBe('check');
    expect(monsterVsLag.checkEval.bestCheckResponse).toBe('check_raise');
  });

  it('leads strong value on draw-completing rivers and nut-blocker bluffs, while checking air vs calling stations and blank-river junk', () => {
    const flushValue = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({ showdownEquity: 0.89, completedDraw: 'flush' })
    );
    expect(flushValue.decision).toBe('lead');
    expect(flushValue.kind).toBe('value');
    expect(HOLDEM_RIVER_LEAD_CANDIDATE_FRACS).toContain(flushValue.betPotFrac);

    const blockerBluff = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.06,
        completedDraw: 'flush',
        scareCard: true,
        riverHelpsHero: true,
        nutBlocker: true,
        missedDraw: true,
        selection: 'blockerAndDraw',
      })
    );
    expect(blockerBluff.decision).toBe('lead');
    expect(blockerBluff.kind).toBe('bluff');

    const stationBluff = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.06,
        completedDraw: 'flush',
        scareCard: true,
        riverHelpsHero: true,
        nutBlocker: true,
        missedDraw: true,
        selection: 'blockerAndDraw',
        station: true,
      })
    );
    expect(stationBluff.decision).toBe('check');
    for (const cand of stationBluff.candidates) {
      expect(cand.foldProb).toBeLessThanOrEqual(HOLDEM_RIVER_LEAD_STATION_BLUFF_FOLD_CAP + 1e-9);
    }

    const blankJunk = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        showdownEquity: 0.08,
        completedDraw: null,
        scareCard: false,
        riverHelpsHero: false,
        nutBlocker: false,
        missedDraw: false,
        selection: 'junk',
      })
    );
    expect(blankJunk.decision).toBe('check');
  });

  it('prices villain raise risk, stack-capping, rake deduction, and tournament ICM shove restraint', () => {
    const calmResp = conditionHoldemRiverLeadResponse(
      0.33,
      false,
      baseVerdictInput({ showdownEquity: 0.72, completedDraw: null, villainPassive: true })
    );
    const aggroResp = conditionHoldemRiverLeadResponse(
      0.33,
      false,
      baseVerdictInput({ showdownEquity: 0.72, completedDraw: null, villainAggressive: true })
    );
    expect(aggroResp.raiseProb).toBeGreaterThan(calmResp.raiseProb);

    const allInResp = conditionHoldemRiverLeadResponse(
      0.5,
      true,
      baseVerdictInput({ showdownEquity: 0.85 })
    );
    expect(allInResp.raiseProb).toBe(0);

    // Short stack caps all candidate sizes at effective stack (deduplicated).
    const shortStack = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({ pot: 100, heroStack: 40, villainStack: 40, showdownEquity: 0.9 })
    );
    expect(shortStack.candidates.length).toBe(2); // 0.33x (33) and 0.40x all-in (40)
    expect(shortStack.candidates.every((cand) => cand.betAmount <= 40 + 1e-6)).toBe(true);

    // Higher rake deduction strictly lowers candidate EV.
    const noRake = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({ callDeductionFraction: 0 })
    );
    const withRake = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({ callDeductionFraction: 0.06 })
    );
    expect(withRake.evBestLead!).toBeLessThan(noRake.evBestLead!);

    // Severe tournament ICM withholds all-in bluff lead shoves.
    const icmShortBluff = holdemRiverLeadRangePricedVerdict(
      baseVerdictInput({
        pot: 100,
        heroStack: 30,
        villainStack: 30,
        showdownEquity: 0.04,
        completedDraw: 'flush',
        nutBlocker: true,
        missedDraw: true,
        selection: 'blockerAndDraw',
        icmRisk: 0.08,
      })
    );
    expect(icmShortBluff.decision).toBe('check');

    // conditionHoldemRiverVillainBetWhenCheckedTo lowers on completing rivers vs blank rivers.
    const ckDraw = conditionHoldemRiverVillainBetWhenCheckedTo(
      baseVerdictInput({ completedDraw: 'flush' })
    );
    const ckBlank = conditionHoldemRiverVillainBetWhenCheckedTo(
      baseVerdictInput({ completedDraw: null })
    );
    expect(ckDraw.betWhenCheckedTo).toBeLessThan(ckBlank.betWhenCheckedTo);
  });
});

function stripTimings<T extends { action: string; amount?: number; thinkTime?: number }>(d: T) {
  return { action: d.action, amount: d.amount, thinkTime: d.thinkTime };
}

describe('LAW: HorseLogic.decide end-to-end isolation, determinism, and independence', () => {
  const SEEDS = [104_729, 209_459, 314_159, 418_889, 523_619];

  it('is 100% bit-identical when OFF (absent, false, or non-boolean) on NLH and PLO4/5/8', () => {
    const spots: LeadSpot[] = [
      NLH_LEAD_MADE_FLUSH,
      NLH_LEAD_THIN_TOP_PAIR,
      NLH_LEAD_BLOCKER_AIR,
      NLH_LEAD_BLANK_JUNK,
      PLO4_LEAD_FLUSH,
      PLO5_LEAD_BLOCKER,
      PLO8_LEAD_BLOCKER,
    ];
    for (const spot of spots) {
      for (const seed of SEEDS.slice(0, 3)) {
        const base = stripTimings(decideLeadSpot(spot, seed, { telemetry: true }));
        const explicitFalse = stripTimings(
          decideLeadSpot(spot, seed, {
            telemetry: true,
            holdemRiverLeadRangeIsPriced: false,
          })
        );
        const nonBool = stripTimings(
          decideLeadSpot(spot, seed, {
            telemetry: true,
            holdemRiverLeadRangeIsPriced: 'true' as unknown as boolean,
          })
        );
        expect(explicitFalse, `${spot.name} false seed=${seed}`).toEqual(base);
        expect(nonBool, `${spot.name} non-bool seed=${seed}`).toEqual(base);
      }
    }
    const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    for (const key of Object.values(HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS)) {
      expect(fires[key] ?? 0, `OFF must never fire ${key}`).toBe(0);
    }
  });

  it('has ZERO reach to PLO4, PLO5, PLO8, IP barrel spots, or holdemRiverFullHouseValue boats when ON', () => {
    for (const spot of [
      PLO4_LEAD_FLUSH,
      PLO5_LEAD_BLOCKER,
      PLO8_LEAD_BLOCKER,
      NLH_IP_BARREL_CONTROL,
    ]) {
      drainFires();
      for (const seed of SEEDS.slice(0, 3)) {
        const off = stripTimings(decideLeadSpot(spot, seed, { telemetry: true }));
        const on = stripTimings(
          decideLeadSpot(spot, seed, {
            telemetry: true,
            holdemRiverLeadRangeIsPriced: true,
          })
        );
        expect(on, `${spot.name} must be identical with option ON`).toEqual(off);
      }
      const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
      for (const key of Object.values(HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS)) {
        expect(fires[key] ?? 0, `${spot.name} must never fire ${key}`).toBe(0);
      }
    }

    // Qualifying river full house with holdemRiverFullHouseValue ON stays owned by boat lead rule.
    const boatSpot: LeadSpot = {
      name: 'nlh_qualifying_river_boat',
      variant: 'nlh',
      hole: [c('K', S), c('K', C)],
      board: [c('K', H), c('9', H), c('6', D), c('6', C), c('7', H)],
      behind: 166,
      line: 'lead',
    };
    drainFires();
    const boatOff = stripTimings(
      decideLeadSpot(boatSpot, SEEDS[0], {
        telemetry: true,
        holdemRiverFullHouseValue: true,
        holdemRiverFullHouseValueIsPriced: true,
      })
    );
    const boatOn = stripTimings(
      decideLeadSpot(boatSpot, SEEDS[0], {
        telemetry: true,
        holdemRiverFullHouseValue: true,
        holdemRiverFullHouseValueIsPriced: true,
        holdemRiverLeadRangeIsPriced: true,
      })
    );
    expect(boatOn).toEqual(boatOff);
    const boatFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    for (const key of Object.values(HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS)) {
      expect(boatFires[key] ?? 0, `boat spot must never fire ${key}`).toBe(0);
    }
  });

  it('decides NLH OOP value, thin-value, bluff, and check spots deterministically with literal receipts and independence from riverLeadRange', () => {
    // 1. Completing-river made flush -> always bets across seeds (deterministic pricing; no coin flip),
    //    repeatable per seed, and independent of riverLeadRange.
    drainFires();
    const flushResults = SEEDS.map((seed) =>
      decideLeadSpot(NLH_LEAD_MADE_FLUSH, seed, {
        telemetry: true,
        holdemRiverLeadRangeIsPriced: true,
      })
    );
    expect(flushResults.every((r) => r.action === 'bet' || r.action === 'all_in')).toBe(true);
    // Repeat exact seed -> identical action & amount.
    const flushRepeat = decideLeadSpot(NLH_LEAD_MADE_FLUSH, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(stripTimings(flushRepeat)).toEqual(stripTimings(flushResults[0]));
    const flushFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(flushFires.holdem_river_lead_range_priced_value_lead_seen ?? 0).toBe(SEEDS.length + 1);

    // Independent of riverLeadRange: false!
    const flushWithParentOff = decideLeadSpot(NLH_LEAD_MADE_FLUSH, SEEDS[0], {
      telemetry: true,
      riverLeadRange: false,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(stripTimings(flushWithParentOff)).toEqual(stripTimings(flushResults[0]));

    // 2. Completing-river nut-flush blocker air -> deterministic bluff lead, independent of riverLeadRange.
    drainFires();
    const bluffResults = SEEDS.map((seed) =>
      decideLeadSpot(NLH_LEAD_BLOCKER_AIR, seed, {
        telemetry: true,
        holdemRiverLeadRangeIsPriced: true,
      })
    );
    expect(bluffResults.every((r) => r.action === 'bet' || r.action === 'all_in')).toBe(true);
    const bluffRepeat = decideLeadSpot(NLH_LEAD_BLOCKER_AIR, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(stripTimings(bluffRepeat)).toEqual(stripTimings(bluffResults[0]));
    const bluffFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(bluffFires.holdem_river_lead_range_priced_bluff_lead_seen ?? 0).toBe(SEEDS.length + 1);

    const bluffWithParentOff = decideLeadSpot(NLH_LEAD_BLOCKER_AIR, SEEDS[0], {
      telemetry: true,
      riverLeadRange: false,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(stripTimings(bluffWithParentOff)).toEqual(stripTimings(bluffResults[0]));

    // 3. Same blocker air into a calling station -> deterministic check!
    seedOpponentRiverRead(3, 30);
    drainFires();
    const stationDecision = decideLeadSpot(NLH_LEAD_BLOCKER_AIR, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(stationDecision.action).toBe('check');
    const stationFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(stationFires.holdem_river_lead_range_priced_check_seen ?? 0).toBe(1);

    // 4. Blank-river junk -> deterministic check!
    HorseMind.reset();
    drainFires();
    const blankJunkDecision = decideLeadSpot(NLH_LEAD_BLANK_JUNK, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    expect(blankJunkDecision.action).toBe('check');
    const blankFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(blankFires.holdem_river_lead_range_priced_check_seen ?? 0).toBe(1);

    // 5. Thin value top pair (K-J): passive calling station vs aggressive LAG stabber.
    seedPassiveStationOpp();
    drainFires();
    const thinPassive = decideLeadSpot(NLH_LEAD_THIN_TOP_PAIR, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    const thinPassiveFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(
      (thinPassiveFires.holdem_river_lead_range_priced_thin_value_lead_seen ?? 0) +
        (thinPassiveFires.holdem_river_lead_range_priced_value_lead_seen ?? 0) +
        (thinPassiveFires.holdem_river_lead_range_priced_check_seen ?? 0)
    ).toBe(1);

    seedAggressiveLagOpp();
    drainFires();
    const thinAggro = decideLeadSpot(NLH_LEAD_THIN_TOP_PAIR, SEEDS[0], {
      telemetry: true,
      holdemRiverLeadRangeIsPriced: true,
    });
    const thinAggroFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(thinAggro.action).toBe('check');
    expect(thinAggroFires.holdem_river_lead_range_priced_check_seen ?? 0).toBe(1);
    if (thinPassive.action === 'bet' || thinPassive.action === 'all_in') {
      expect(thinPassive.amount ?? 0).toBeGreaterThan(0);
    }

    // 6. Multi-board NLH spot stays untouched when ON.
    HorseMind.reset();
    drainFires();
    const { hero, gs } = leadSpotState(NLH_LEAD_MADE_FLUSH);
    const mbGs = {
      ...gs,
      communityCards2: BLANK_RIVER,
      boardCount: 2,
    };
    const decideMb = (opts: HorseDecideOpts) => {
      seedFastRandom(SEEDS[0]);
      return stripTimings(
        HorseLogic.decide(
          hero,
          mbGs,
          'balanced',
          {},
          {
            observeMind: false,
            decisionTimeMs: DECISION_TIME_MS,
            telemetry: true,
            ...opts,
          }
        )
      );
    };
    expect(decideMb({ holdemRiverLeadRangeIsPriced: true })).toEqual(decideMb({}));
    const mbFires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    for (const key of Object.values(HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS)) {
      expect(mbFires[key] ?? 0).toBe(0);
    }
  });
});
