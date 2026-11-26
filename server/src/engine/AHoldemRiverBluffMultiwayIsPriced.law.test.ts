/**
 * LAW: `holdemRiverBluffMultiwayIsPriced` (A5, `REVIEW-HOLDEM-OFFLIST-20261121.md` §5) is a
 * dark default-OFF (`=== true`), strictly NLH-only multiway river (`opponents >= 2`), deterministic
 * EV-priced replacement for `riverBluffMultiway` with zero `fastRandom`/`Math.random`, zero
 * `opponentHud/` imports, exact multiway compounding `pFoldAll = prod_i pFold_i`, strict
 * calling-station veto, zero HU/PLO4/5/6 reach, and bit-identical OFF behavior.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import {
  HOLDEM_RIVER_BLUFF_MULTIWAY_CANDIDATE_FRACS,
  HOLDEM_RIVER_BLUFF_MULTIWAY_CREDIBILITY_LIFT,
  HOLDEM_RIVER_BLUFF_MULTIWAY_ICM_NO_SHOVE_RISK,
  HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS,
  HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_FOLD_CAP,
  HOLDEM_RIVER_BLUFF_MULTIWAY_SURPLUS_RETENTION,
  computeHoldemMultiwayEqWhenCalled,
  conditionHoldemMultiwayOpponentFoldProb,
  estimateHoldemMultiwayOpponentRiverFold,
  holdemRiverBluffMultiwayIsPricedApplies,
  holdemRiverBluffMultiwayPricedVerdict,
  holdemRiverMultiwaySmoothFoldPrior,
  isHoldemMultiwayOpponentStation,
  type HoldemMultiwayOpponentProfile,
  type HoldemRiverBluffMultiwayPricedGateInput,
  type HoldemRiverBluffMultiwayPricedInput,
} from './HorseHoldemRiverBluffMultiwayIsPriced.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET } from './holdemEmpiricalPriors.js';
import {
  DECISION_TIME_MS,
  NLH_AIR_BLOCKER,
  PLO4_NUT_BLOCKER_AIR,
  c,
  seedOpponentRiverRead,
  spotState,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';
import { DEVELOPMENT_LEAGUE_CARDS, LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import type { ActionRecord } from '../types.js';

const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

const MODULE_PATH = resolve(process.cwd(), 'src/engine/HorseHoldemRiverBluffMultiwayIsPriced.ts');
const POSTGRES_PROOF_PATH = resolve(
  process.cwd(),
  '../scripts/ci/test-horse-option-switch-evidence-postgres.sh'
);

const TEST_SEEDS = [104_729, 15_590_592, 31_076_455, 46_562_318, 62_048_181, 77_534_044];

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

function baseGate(
  over: Partial<HoldemRiverBluffMultiwayPricedGateInput> = {}
): HoldemRiverBluffMultiwayPricedGateInput {
  return {
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
    multiBoard: false,
    bombPot: false,
    allInOrFold: false,
    satelliteActive: false,
    barrelOutlookRiverPending: false,
    opponentsLive: 2,
    allOpponentsCanRespond: true,
    pot: 100,
    heroStack: 200,
    effectiveVillainStack: 200,
    ...over,
  };
}

function baseInput(
  over: Partial<HoldemRiverBluffMultiwayPricedInput> = {}
): HoldemRiverBluffMultiwayPricedInput {
  return {
    pot: 100,
    heroStack: 200,
    effectiveVillainStack: 200,
    bigBlind: 2,
    showdownEquity: 0.05,
    line: 'checkedThrough',
    selection: 'blocker',
    nutBlocker: true,
    unblocker: false,
    inPosition: true,
    scareCard: true,
    riverHelpsHero: true,
    rangesFavorOpponent: false,
    opponents: [{}, {}],
    callDeductionFraction: 0,
    icmRisk: 0,
    bluffMod: 1,
    ...over,
  };
}

const way = (spot: V54Spot, n: 2 | 3 | 4 | 5): V54Spot => ({
  ...spot,
  name: `${spot.name}_${n}way`,
  extraOpponents: n - 2,
});

const NLH_NUT_FLUSH_BLOCKER: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_nut_flush_blocker',
  board: [c('9', H), c('8', S), c('5', H), c('K', C), c('2', H)],
  hole: [c('A', H), c('3', D)],
};

const NLH_JUNK: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_junk',
  hole: [c('Q', C), c('3', D)],
};

const NLH_MIDDLE_PAIR: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_middle_pair',
  hole: [c('9', C), c('6', D)],
};

const PLO4_BLOCKER: V54Spot = { ...PLO4_NUT_BLOCKER_AIR, name: 'plo4_nut_flush_blocker' };
const PLO5_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo5_nut_flush_blocker',
  variant: 'plo5',
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H)],
};
const PLO6_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo6_nut_flush_blocker',
  variant: 'plo6',
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H), c('8', C)],
};

function runDecideSeries(
  spot: V54Spot,
  opts: HorseDecideOpts = {},
  prepare: () => void = () => HorseMind.reset(),
  mutateHistory?: (history: ActionRecord[]) => ActionRecord[]
) {
  prepare();
  drainFires();
  const actions: string[] = [];
  const decisions: Array<{ action: string; amount?: number }> = [];
  for (const seed of TEST_SEEDS) {
    const { hero, gs } = spotState(spot);
    if (mutateHistory) gs.actionHistory = mutateHistory([...(gs.actionHistory ?? [])]);
    seedFastRandom(seed);
    const d = HorseLogic.decide(
      hero,
      gs,
      'balanced',
      {},
      { observeMind: false, decisionTimeMs: DECISION_TIME_MS, telemetry: true, ...opts }
    );
    actions.push(`${d.action}:${d.amount ?? 0}`);
    decisions.push({ action: d.action, amount: d.amount });
  }
  const fires = Object.fromEntries(
    drainFires()
      .filter((r) => !r.feature.startsWith('upgrade04_omaha_reservoir_'))
      .map((r) => [r.feature, r.fires])
  );
  return { actions, decisions, fires };
}

describe('LAW: static architecture, dark refusal, ledger & dev league card boundaries', () => {
  it('module uses zero fastRandom / Math.random and zero opponentHud/ imports', () => {
    const src = readFileSync(MODULE_PATH, 'utf8');
    // Strip block and line comments before asserting zero executable randomness or opponentHud imports.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/\bfastRandom\b/);
    expect(codeOnly).not.toMatch(/\bMath\.random\b/);
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*opponentHud/i);
  });

  it('holdemRiverBluffMultiwayIsPriced is dark in OPTION_SWITCH_REFUSED and mirrored in postgres proof', () => {
    expect(OPTION_SWITCH_REFUSED.holdemRiverBluffMultiwayIsPriced).toMatch(/pending registration/i);
    const pgScript = readFileSync(POSTGRES_PROOF_PATH, 'utf8');
    const refusedLine = pgScript.split('\n').find((line) => line.startsWith("refused='"));
    expect(refusedLine).toBeDefined();
    expect(refusedLine).toContain('holdemRiverBluffMultiwayIsPriced');
  });

  it('flag and all 5 literal receipts are registered in HORSE_DATA_LEDGER', () => {
    const flagEntry = HORSE_DATA_LEDGER.find(
      (e) => e.kind === 'flag' && e.key === 'holdemRiverBluffMultiwayIsPriced'
    );
    expect(flagEntry).toBeDefined();
    expect(flagEntry?.note).toMatch(/default OFF/i);

    for (const receiptKey of Object.values(HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS)) {
      const entry = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === receiptKey);
      expect(entry, `missing ledger receipt ${receiptKey}`).toBeDefined();
    }
  });

  it('dev league cards live in DEVELOPMENT_LEAGUE_CARDS and never in LEAGUE_MATCHUPS', () => {
    const cardNames = [
      'cash6_holdem_river_bluff_multiway_is_priced',
      'cash9_holdem_river_bluff_multiway_is_priced',
      'hu_holdem_river_bluff_multiway_is_priced',
    ];
    const devMap = new Map(DEVELOPMENT_LEAGUE_CARDS.map((m) => [m.name, m]));
    const prodNames = new Set(LEAGUE_MATCHUPS.map((m) => m.name));

    for (const name of cardNames) {
      expect(prodNames.has(name), `${name} must never be in LEAGUE_MATCHUPS`).toBe(false);
      const card = devMap.get(name);
      expect(card, `${name} must be in DEVELOPMENT_LEAGUE_CARDS`).toBeDefined();
      expect(card?.variant).toBe('nlh');
      expect(card?.a).toEqual({
        riverBluffMultiway: true,
        holdemRiverBluffMultiwayIsPriced: true,
      });
      expect(card?.b).toEqual({ riverBluffMultiway: true });
    }
    expect(devMap.get('cash6_holdem_river_bluff_multiway_is_priced')?.seats).toBe(6);
    expect(devMap.get('cash9_holdem_river_bluff_multiway_is_priced')?.seats).toBe(9);
    expect(devMap.get('hu_holdem_river_bluff_multiway_is_priced')?.seats).toBe(2);
  });
});

describe('LAW: strict fail-closed NLH multiway river structural gate', () => {
  it('accepts single-board 2-card NLH multiway river with 2, 3, 4, or 5 live opponents', () => {
    for (const n of [2, 3, 4, 5]) {
      expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ opponentsLive: n }))).toBe(true);
    }
  });

  it('fails closed on OFF, non-boolean enabled, HU, non-river, facingBet, and every non-NLH variant', () => {
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ enabled: undefined }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ enabled: false }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ enabled: 1 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ enabled: 'true' }))).toBe(false);
    // Strict multiway: NEVER HU (opponentsLive === 1 or 0)
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ opponentsLive: 1 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ opponentsLive: 0 }))).toBe(false);
    expect(
      holdemRiverBluffMultiwayIsPricedApplies(baseGate({ allOpponentsCanRespond: false }))
    ).toBe(false);
    // Non-NLH variants & excluded modes
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isOmaha: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isPotLimit: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isHiLo: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isShortDeck: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isFixedLimit: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ holeCount: 4 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ holeCardCount: 4 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ multiBoard: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ bombPot: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ allInOrFold: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ satelliteActive: true }))).toBe(
      false
    );
    expect(
      holdemRiverBluffMultiwayIsPricedApplies(baseGate({ barrelOutlookRiverPending: true }))
    ).toBe(false);
    // Non-river / facing-bet / invalid geometry
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ isRiver: false }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ boardLength: 4 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ facingBet: true }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ pot: 0 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ heroStack: 0 }))).toBe(false);
    expect(holdemRiverBluffMultiwayIsPricedApplies(baseGate({ effectiveVillainStack: 0 }))).toBe(
      false
    );
  });
});

describe('LAW: empirical fold curves, EB shrinkage, exact multiway compounding & station veto', () => {
  it('smooth river fold prior matches empirical anchors and is strictly monotone in bet size', () => {
    expect(holdemRiverMultiwaySmoothFoldPrior(0.25)).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate,
      6
    );
    expect(holdemRiverMultiwaySmoothFoldPrior(0.5)).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate,
      6
    );
    expect(holdemRiverMultiwaySmoothFoldPrior(0.83)).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate,
      6
    );
    expect(holdemRiverMultiwaySmoothFoldPrior(1.25)).toBeCloseTo(
      HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate,
      6
    );

    const fracs = [0.2, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5];
    for (let i = 1; i < fracs.length; i++) {
      expect(holdemRiverMultiwaySmoothFoldPrior(fracs[i])).toBeGreaterThan(
        holdemRiverMultiwaySmoothFoldPrior(fracs[i - 1])
      );
    }
  });

  it('per-opponent EB shrinkage prefers hud_context > hud_street > exploit_counters > pool_prior', () => {
    const priorOnly = estimateHoldemMultiwayOpponentRiverFold(0.75, {});
    expect(priorOnly.source).toBe('pool_prior');
    expect(priorOnly.mean).toBeCloseTo(holdemRiverMultiwaySmoothFoldPrior(0.75), 6);

    const exploitOnly = estimateHoldemMultiwayOpponentRiverFold(0.75, {
      exploitCounters: { riverCall: 18, riverCallOpp: 20 }, // 10% fold (very sticky)
    });
    expect(exploitOnly.source).toBe('exploit_counters');
    expect(exploitOnly.mean).toBeLessThan(priorOnly.mean - 0.25);

    const streetHud = estimateHoldemMultiwayOpponentRiverFold(0.75, {
      hudOpp: { eff: { 'r.fBet': [24, 21] } }, // 87.5% fold
      exploitCounters: { riverCall: 18, riverCallOpp: 20 },
    });
    expect(streetHud.source).toBe('hud_street');
    expect(streetHud.mean).toBeGreaterThan(priorOnly.mean);

    const ctxHud = estimateHoldemMultiwayOpponentRiverFold(0.75, {
      hudOpp: { eff: { 'r.fb.bg.mw': [24, 6], 'r.fBet': [24, 21] } }, // 25% fold in multiway big bet
      exploitCounters: { riverCall: 2, riverCallOpp: 20 },
    });
    expect(ctxHud.source).toBe('hud_context');
    expect(ctxHud.mean).toBeLessThan(priorOnly.mean - 0.15);
  });

  it('exact multiway compounding pFoldAll = prod_i pFold_i drives bluffing sharply down as opponents grow 2 -> 3 -> 4+', () => {
    const v2 = holdemRiverBluffMultiwayPricedVerdict(baseInput({ opponents: [{}, {}] }));
    const v3 = holdemRiverBluffMultiwayPricedVerdict(baseInput({ opponents: [{}, {}, {}] }));
    const v4 = holdemRiverBluffMultiwayPricedVerdict(baseInput({ opponents: [{}, {}, {}, {}] }));

    expect(v2.decision).toBe('bet');
    expect(v4.decision).toBe('check');

    expect(v2.candidates.length).toBe(HOLDEM_RIVER_BLUFF_MULTIWAY_CANDIDATE_FRACS.length);
    for (let i = 0; i < v2.candidates.length; i++) {
      const c2 = v2.candidates[i];
      const c3 = v3.candidates[i];
      const c4 = v4.candidates[i];

      const prod2 = c2.perOpponent.reduce((p, o) => p * o.foldProb, 1);
      const prod3 = c3.perOpponent.reduce((p, o) => p * o.foldProb, 1);
      const prod4 = c4.perOpponent.reduce((p, o) => p * o.foldProb, 1);

      expect(c2.pFoldAll).toBeCloseTo(prod2, 10);
      expect(c3.pFoldAll).toBeCloseTo(prod3, 10);
      expect(c4.pFoldAll).toBeCloseTo(prod4, 10);

      // Strictly monotone decay in pFoldAll and EV as opponents increase: 2 -> 3 -> 4
      expect(c3.pFoldAll).toBeLessThan(c2.pFoldAll);
      expect(c4.pFoldAll).toBeLessThan(c3.pFoldAll);
      expect(c3.ev).toBeLessThan(c2.ev);
      expect(c4.ev).toBeLessThan(c3.ev);
    }

    // Even on non-scare checked-through, 3-way bets while 4-way checks cleanly
    const nonScare3Way = holdemRiverBluffMultiwayPricedVerdict(
      baseInput({ scareCard: false, riverHelpsHero: false, opponents: [{}, {}] })
    );
    const nonScare4Way = holdemRiverBluffMultiwayPricedVerdict(
      baseInput({ scareCard: false, riverHelpsHero: false, opponents: [{}, {}, {}] })
    );
    expect(nonScare3Way.decision).toBe('bet');
    expect(nonScare4Way.decision).toBe('check');
  });

  it('strict calling-station veto forces deterministic check if ANY opponent is a river station', () => {
    const nit: HoldemMultiwayOpponentProfile = { riverFoldRate: 0.9 };
    const stationFlag: HoldemMultiwayOpponentProfile = { station: true };
    const stationRfr: HoldemMultiwayOpponentProfile = { riverFoldRate: 0.28 };
    const stationFc: HoldemMultiwayOpponentProfile = { fastCalldownCallingDown: true };

    expect(isHoldemMultiwayOpponentStation(nit)).toBe(false);
    expect(isHoldemMultiwayOpponentStation(stationFlag)).toBe(true);
    expect(isHoldemMultiwayOpponentStation(stationRfr)).toBe(true);
    expect(isHoldemMultiwayOpponentStation(stationFc)).toBe(true);

    // Two nits: clearly +EV bet
    const vsTwoNits = holdemRiverBluffMultiwayPricedVerdict(baseInput({ opponents: [nit, nit] }));
    expect(vsTwoNits.decision).toBe('bet');
    expect(vsTwoNits.stationVetoed).toBe(false);

    // One nit + one station in ANY seat position: strict deterministic check + collapsed pFoldAll
    for (const field of [
      [stationFlag, nit],
      [nit, stationFlag],
      [nit, stationRfr],
      [nit, stationFc],
      [nit, nit, stationFlag],
    ]) {
      const v = holdemRiverBluffMultiwayPricedVerdict(baseInput({ opponents: field }));
      expect(v.stationVetoed).toBe(true);
      expect(v.decision).toBe('check');
      for (const cand of v.candidates) {
        const stationEval = cand.perOpponent.find((o) => o.isStation);
        expect(stationEval).toBeDefined();
        expect(stationEval!.foldProb).toBeLessThanOrEqual(
          HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_FOLD_CAP + 1e-9
        );
        expect(cand.pFoldAll).toBeLessThanOrEqual(
          HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_FOLD_CAP + 1e-9
        );
        expect(cand.netEdge).toBeLessThan(0);
      }
    }
  });

  it('selection-bias surplus retention preserves sticky reads in full and discounts positive surplus', () => {
    const baseSpot = baseInput({
      line: 'opponentGaveUp',
      selection: 'blocker',
      nutBlocker: true,
      scareCard: false,
      riverHelpsHero: false,
    });
    const stickyOpp: HoldemMultiwayOpponentProfile = { riverFoldRate: 0.4 };
    const evalSticky = conditionHoldemMultiwayOpponentFoldProb(0.75, stickyOpp, baseSpot);
    const evalPool = conditionHoldemMultiwayOpponentFoldProb(0.75, {}, baseSpot);
    expect(evalSticky.foldProb).toBeLessThan(evalPool.foldProb - 0.12);
    expect(HOLDEM_RIVER_BLUFF_MULTIWAY_SURPLUS_RETENTION).toBeGreaterThan(0);
    expect(HOLDEM_RIVER_BLUFF_MULTIWAY_SURPLUS_RETENTION).toBeLessThan(1);
    expect(HOLDEM_RIVER_BLUFF_MULTIWAY_CREDIBILITY_LIFT).toBeGreaterThan(0);
  });

  it('multiway called-range equity stays bounded in [0, showdownEquity] and falls with fold mass & callers', () => {
    expect(computeHoldemMultiwayEqWhenCalled(0.05, 0.55, 1.1)).toBe(0);
    const eq1Caller = computeHoldemMultiwayEqWhenCalled(0.15, 0.08, 1.0);
    const eq2Callers = computeHoldemMultiwayEqWhenCalled(0.15, 0.08, 1.8);
    expect(eq1Caller).toBeGreaterThan(0);
    expect(eq1Caller).toBeLessThan(0.15);
    expect(eq2Callers).toBeLessThan(eq1Caller);
  });

  it('withholds all-in bluff shoves under severe tournament ICM risk and deduplicates stack-capped sizes', () => {
    // Shallow stack (0.70x pot): all candidates >= 0.75x collapse to one all-in candidate
    const cashShallow = holdemRiverBluffMultiwayPricedVerdict(
      baseInput({ pot: 100, heroStack: 70, effectiveVillainStack: 70, icmRisk: 0 })
    );
    expect(cashShallow.candidates.length).toBe(2); // 0.50x (50) and stack-capped all-in (70)
    expect(cashShallow.candidates[1].isAllIn).toBe(true);

    // Severe ICM pressure withholds all-in shove and raises risk margin cleanly
    const icmSevere = holdemRiverBluffMultiwayPricedVerdict(
      baseInput({
        pot: 100,
        heroStack: 60,
        effectiveVillainStack: 60,
        icmRisk: HOLDEM_RIVER_BLUFF_MULTIWAY_ICM_NO_SHOVE_RISK,
      })
    );
    expect(icmSevere.isAllIn).toBe(false);
    expect(icmSevere.decision).toBe('check');
  });

  it('checks deterministically when no blocker or no story is present, and is 100% pure deterministic', () => {
    const noBlocker = holdemRiverBluffMultiwayPricedVerdict(
      baseInput({ nutBlocker: false, selection: 'none' })
    );
    expect(noBlocker.decision).toBe('check');

    const noStory = holdemRiverBluffMultiwayPricedVerdict(baseInput({ line: 'none' }));
    expect(noStory.decision).toBe('check');
    expect(noStory.candidates).toHaveLength(0);

    const a = holdemRiverBluffMultiwayPricedVerdict(baseInput());
    const b = holdemRiverBluffMultiwayPricedVerdict(baseInput());
    expect(a).toEqual(b);
  });
});

describe('LAW: end-to-end HorseLogic.decide proofs (OFF parity, zero PLO/HU reach, deterministic multiway)', () => {
  it('OFF (absent vs false) is bit-identical across NLH 3-way, 4-way, HU, and PLO4/PLO5 multiway', () => {
    const spots: V54Spot[] = [
      way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 3),
      way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 4),
      way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 2),
      way({ ...PLO4_BLOCKER, line: 'passive' }, 3),
      way({ ...PLO5_BLOCKER, line: 'passive' }, 3),
    ];
    for (const spot of spots) {
      const absent = runDecideSeries(spot, {});
      const explicitFalse = runDecideSeries(spot, { holdemRiverBluffMultiwayIsPriced: false });
      expect(explicitFalse.actions, spot.name).toEqual(absent.actions);
      expect(explicitFalse.fires, spot.name).toEqual(absent.fires);
      for (const key of Object.values(HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS)) {
        expect(absent.fires[key] ?? 0, `${spot.name} absent ${key}`).toBe(0);
        expect(explicitFalse.fires[key] ?? 0, `${spot.name} false ${key}`).toBe(0);
      }
    }
  });

  it('zero reach to HU NLH and PLO4/PLO5/PLO6 multiway rivers when ON', () => {
    const outOfScope: V54Spot[] = [
      way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 2),
      way({ ...PLO4_BLOCKER, line: 'passive' }, 3),
      way({ ...PLO4_BLOCKER, line: 'passive' }, 4),
      way({ ...PLO5_BLOCKER, line: 'passive' }, 3),
      way({ ...PLO6_BLOCKER, line: 'passive' }, 3),
    ];
    for (const spot of outOfScope) {
      const off = runDecideSeries(spot, {});
      const on = runDecideSeries(spot, { holdemRiverBluffMultiwayIsPriced: true });
      expect(on.actions, spot.name).toEqual(off.actions);
      for (const key of Object.values(HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS)) {
        expect(on.fires[key] ?? 0, `${spot.name} leaked ${key}`).toBe(0);
      }
    }
  });

  it('3-way NLH nut-flush blocker on scare card bets deterministically and independently of riverBluffMultiway', () => {
    const spot3Way = way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 3);
    const onWithBase = runDecideSeries(spot3Way, {
      riverBluffMultiway: true,
      holdemRiverBluffMultiwayIsPriced: true,
    });
    const onWithoutBase = runDecideSeries(spot3Way, {
      riverBluffMultiway: false,
      holdemRiverBluffMultiwayIsPriced: true,
    });

    // Identical across every seed (deterministic) and independent of riverBluffMultiway
    expect(onWithBase.actions).toEqual(onWithoutBase.actions);
    expect(new Set(onWithBase.actions).size).toBe(1);
    expect(onWithBase.decisions.every((d) => d.action === 'bet' || d.action === 'all_in')).toBe(
      true
    );
    expect(onWithBase.fires.holdem_river_bluff_multiway_priced_bet_seen).toBe(TEST_SEEDS.length);
    expect(onWithBase.fires.river_bluff_multiway_evaluated ?? 0).toBe(0);
  });

  it('5-way NLH river (4 live opponents) checks deterministically via pFoldAll compounding', () => {
    const spot5Way = way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 5);
    const res = runDecideSeries(spot5Way, { holdemRiverBluffMultiwayIsPriced: true });
    expect(res.decisions.every((d) => d.action === 'check')).toBe(true);
    expect(res.fires.holdem_river_bluff_multiway_priced_check_seen).toBe(TEST_SEEDS.length);
    expect(res.fires.holdem_river_bluff_multiway_priced_bet_seen ?? 0).toBe(0);
  });

  it('one confirmed calling station in a 3-way NLH pot forces 100% deterministic check + station receipt', () => {
    const spot3Way = way({ ...NLH_NUT_FLUSH_BLOCKER, line: 'passive' }, 3);
    const res = runDecideSeries(
      spot3Way,
      { holdemRiverBluffMultiwayIsPriced: true },
      () => seedOpponentRiverRead(3, 30) // opp3 folds 3/30 = 10% on river -> station!
    );
    expect(res.decisions.every((d) => d.action === 'check')).toBe(true);
    expect(res.fires.holdem_river_bluff_multiway_priced_check_seen).toBe(TEST_SEEDS.length);
    expect(res.fires.holdem_river_bluff_multiway_priced_station_check_seen).toBe(TEST_SEEDS.length);
    expect(res.fires.holdem_river_bluff_multiway_priced_bet_seen ?? 0).toBe(0);
  });

  it('middle pair (showdown value) and air without blocker never fire the priced multiway bluff module', () => {
    for (const base of [NLH_MIDDLE_PAIR, NLH_JUNK]) {
      const spot = way({ ...base, line: 'passive' }, 3);
      const off = runDecideSeries(spot, { riverBluffMultiway: false });
      const on = runDecideSeries(spot, {
        riverBluffMultiway: false,
        holdemRiverBluffMultiwayIsPriced: true,
      });
      expect(on.actions, spot.name).toEqual(off.actions);
      for (const key of Object.values(HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS)) {
        expect(on.fires[key] ?? 0, `${spot.name} ${key}`).toBe(0);
      }
    }
  });
});
