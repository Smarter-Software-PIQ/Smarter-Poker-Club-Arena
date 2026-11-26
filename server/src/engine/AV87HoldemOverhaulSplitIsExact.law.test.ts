/**
 * LAW: THE V87 HOLD'EM OVERHAUL POSTFLOP SPLIT IS EXACT.
 *
 * `v87HoldemOverhaul` previously acted as a single coupled umbrella gating
 * both preflop cash/straddle/EP-limp-trap ranges AND >14 distinct postflop
 * blanket sub-rules (`v87_range_cbet`, `v87_low_spr_commit`,
 * `v87_turn_takeaway`, `v87_ip_checkback_trap`, `v87_oop_stab_trap`,
 * `v87_multiway_wet_air_check`, `v87_bubble_*`, `v87_river_block_*`,
 * `v87_double_board_dead_half_fold`, `v87_deep_cash_onepair_pot_control`,
 * `v87_combo_draw_*`, `v87_river_blocker_bluff_raise`, `v87_ip_flop_float`,
 * and postflop bully-read modifiers).
 *
 * Each postflop sub-rule now carries its own independent default-ON sub-flag
 * alongside `v87HoldemOverhaul` so:
 *   1. When unset (default production) vs `v87HoldemOverhaul: true` vs all 14
 *      sub-flags explicitly `true`, every decision, telemetry receipt, and
 *      `fastRandom()` state is 100% bit-identical.
 *   2. Turning off any single postflop sub-flag isolates ONLY that sub-rule
 *      without disabling V87 preflop ranges or any other V87 postflop rule.
 *   3. Turning `v87HoldemOverhaul: false` still disables the full V87 umbrella
 *      identically for historical frozen-digest neutrality corpora.
 *   4. PLO4, PLO5, and PLO6 decisions and PRNG streams have ZERO diff under
 *      any combination of V87 sub-flags.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const CLOCK = 1_700_000_000_000;

const V87_POSTFLOP_SUBFLAGS = [
  'v87RangeCbet',
  'v87LowSprCommit',
  'v87TurnTakeaway',
  'v87IpCheckbackTrap',
  'v87OopStabTrap',
  'v87MultiwayWetAirCheck',
  'v87BubblePostflop',
  'v87RiverBlockBalance',
  'v87DoubleBoardDeadHalfFold',
  'v87DeepCashOnePairPotControl',
  'v87ComboDrawPump',
  'v87RiverBlockerBluffRaise',
  'v87IpFlopFloat',
  'v87BullyReadAdjust',
] as const;

type V87SubFlag = (typeof V87_POSTFLOP_SUBFLAGS)[number];

const ALL_SUBFLAGS_TRUE: HorseDecideOpts = Object.fromEntries(
  V87_POSTFLOP_SUBFLAGS.map((k) => [k, true])
);
const ALL_SUBFLAGS_FALSE: HorseDecideOpts = Object.fromEntries(
  V87_POSTFLOP_SUBFLAGS.map((k) => [k, false])
);

const SUITS: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function cards(text: string): Card[] {
  const clean = text.replace(/\s+/g, '');
  const out: Card[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push({ rank: clean[i] as CardRank, suit: SUITS[clean[i + 1]] });
  }
  return out;
}

function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = '',
  folded = false
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_sitting_out: false,
    is_all_in: stack <= 0 && !folded,
  };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
  };
}

interface SpotFixture {
  hero: SeatPlayer;
  gs: HorseGameStateV2;
  seed?: number;
  setupMind?: () => void;
  baseOpts?: HorseDecideOpts;
}

function runSpot(spot: SpotFixture, extraOpts: HorseDecideOpts = {}) {
  HorseMind.reset();
  spot.setupMind?.();
  drainFires();
  seedFastRandom(spot.seed ?? 424242);
  const decision = HorseLogic.decide(
    structuredClone(spot.hero),
    structuredClone(spot.gs),
    'balanced',
    {},
    {
      telemetry: true,
      decisionTimeMs: CLOCK,
      ...spot.baseOpts,
      ...extraOpts,
    }
  );
  return {
    decision: stableDecision(decision),
    fires: Object.fromEntries(drainFires().map((r) => [r.feature, r.fires])),
    rng: saveFastRandom(),
  };
}

/** Seed HorseMind with a high-frequency flop stabber who checks turn (turnGiveUp + highFlopStab + optional riverFold). */
function seedStabberMind(villainId: string, opts: { lag?: boolean; riverFold?: boolean } = {}) {
  const bb = 2;
  const heroProbe = 'probe-hero-seed';
  const dummyPlayers = [seat(1, villainId, 200, 0, 0), seat(2, heroProbe, 200, 0, 0)];
  for (let h = 0; h < 60; h++) {
    const tsBase = 100_000 + h * 50;
    const actions: ActionRecord[] = [
      {
        seat: 1,
        userId: villainId,
        stage: 'preflop',
        action: 'raise',
        amount: 3.5 * bb,
        timestamp: tsBase + 1,
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'preflop',
        action: 'call',
        amount: 3.5 * bb,
        timestamp: tsBase + 2,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'flop',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 3,
      },
      {
        seat: 1,
        userId: villainId,
        stage: 'flop',
        action: 'bet',
        amount: 4.5 * bb,
        timestamp: tsBase + 4,
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'flop',
        action: 'call',
        amount: 4.5 * bb,
        timestamp: tsBase + 5,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'turn',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 6,
      },
      {
        seat: 1,
        userId: villainId,
        stage: 'turn',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 7,
      },
    ];
    if (opts.riverFold) {
      actions.push(
        {
          seat: 2,
          userId: heroProbe,
          stage: 'river',
          action: 'bet',
          amount: 8 * bb,
          timestamp: tsBase + 8,
          isFullRaise: true,
        },
        {
          seat: 1,
          userId: villainId,
          stage: 'river',
          action: h % 3 === 0 ? 'call' : 'fold',
          amount: h % 3 === 0 ? 8 * bb : 0,
          timestamp: tsBase + 9,
        }
      );
    } else if (opts.lag) {
      actions.push({
        seat: 1,
        userId: villainId,
        stage: 'river',
        action: 'bet',
        amount: 8 * bb,
        timestamp: tsBase + 8,
        isFullRaise: true,
      });
    }
    const scope = readScopeOf('nlh', 2);
    HorseMind.observe(actions, dummyPlayers, undefined, 2, bb);
    HorseMind.observeHandComplete(`stabber-${villainId}-${h}`, actions, bb, null, scope);
  }
}

/** Seed HorseMind with a sustained LAG bully (does NOT give up on turn). */
function seedSustainedLagMind(villainId: string) {
  const bb = 2;
  const heroProbe = 'probe-hero-lag';
  const dummyPlayers = [seat(1, villainId, 200, 0, 0), seat(2, heroProbe, 200, 0, 0)];
  for (let h = 0; h < 60; h++) {
    const tsBase = 500_000 + h * 50;
    const actions: ActionRecord[] = [
      {
        seat: 1,
        userId: villainId,
        stage: 'preflop',
        action: 'raise',
        amount: 3.5 * bb,
        timestamp: tsBase + 1,
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'preflop',
        action: 'call',
        amount: 3.5 * bb,
        timestamp: tsBase + 2,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'flop',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 3,
      },
      {
        seat: 1,
        userId: villainId,
        stage: 'flop',
        action: 'bet',
        amount: 4.5 * bb,
        timestamp: tsBase + 4,
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'flop',
        action: 'call',
        amount: 4.5 * bb,
        timestamp: tsBase + 5,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'turn',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 6,
      },
      {
        seat: 1,
        userId: villainId,
        stage: 'turn',
        action: 'bet',
        amount: 11 * bb,
        timestamp: tsBase + 7,
        isFullRaise: true,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'turn',
        action: 'call',
        amount: 11 * bb,
        timestamp: tsBase + 8,
      },
      {
        seat: 2,
        userId: heroProbe,
        stage: 'river',
        action: 'check',
        amount: 0,
        timestamp: tsBase + 9,
      },
      {
        seat: 1,
        userId: villainId,
        stage: 'river',
        action: 'bet',
        amount: 20 * bb,
        timestamp: tsBase + 10,
        isFullRaise: true,
      },
    ];
    const scope = readScopeOf('nlh', 2);
    HorseMind.observe(actions, dummyPlayers, undefined, 2, bb);
    HorseMind.observeHandComplete(`lag-${villainId}-${h}`, actions, bb, null, scope);
  }
}

/** Find a hero userId suffix that passes a deterministic v87SpotUnit hash threshold. */
function findFiringSpot(
  build: (heroId: string) => SpotFixture,
  expectedReceipt: string,
  maxTries = 60
): SpotFixture {
  for (let i = 0; i < maxTries; i++) {
    const heroId = `87000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const spot = build(heroId);
    const res = runSpot(spot);
    if ((res.fires[expectedReceipt] ?? 0) > 0) return spot;
  }
  throw new Error(`Could not find firing spot for ${expectedReceipt} within ${maxTries} tries`);
}

function makeRangeCbetSpot(): SpotFixture {
  return findFiringSpot((heroId) => {
    const players = [seat(2, heroId, 194, 0, 6, '9s8d'), seat(1, 'villain-rcb', 194, 0, 6)];
    const history: ActionRecord[] = [
      { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6, timestamp: 1 },
      {
        stage: 'preflop',
        seat: 1,
        userId: 'villain-rcb',
        action: 'call',
        amount: 6,
        timestamp: 2,
      },
      {
        stage: 'flop',
        seat: 1,
        userId: 'villain-rcb',
        action: 'check',
        amount: 0,
        timestamp: 3,
      },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Kd7c2s'),
        pot: 12,
        currentBet: 0,
        minRaise: 2,
        bigBlind: 2,
        dealerSeat: 2,
        stage: 'flop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        actionHistory: history,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 2,
        maxRaiseTo: 194,
      },
      baseOpts: { mind: false, flopTurnBluffBaseline: false },
    };
  }, 'v87_range_cbet');
}

function makeLowSprCommitSpot(): SpotFixture {
  const players = [seat(2, 'hero-lowspr', 60, 0, 40, 'AhKd'), seat(1, 'villain-lowspr', 60, 0, 40)];
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 2, userId: 'hero-lowspr', action: 'raise', amount: 40, timestamp: 1 },
    {
      stage: 'preflop',
      seat: 1,
      userId: 'villain-lowspr',
      action: 'call',
      amount: 40,
      timestamp: 2,
    },
    {
      stage: 'flop',
      seat: 1,
      userId: 'villain-lowspr',
      action: 'check',
      amount: 0,
      timestamp: 3,
    },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('As9c4d'),
      pot: 80,
      currentBet: 0,
      minRaise: 2,
      bigBlind: 2,
      dealerSeat: 2,
      stage: 'flop',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['check', 'bet', 'all_in'],
      minRaiseTo: 2,
      maxRaiseTo: 60,
    },
    baseOpts: { mind: false },
  };
}

function makeTurnTakeawaySpot(): SpotFixture {
  const villainId = 'villain-takeaway';
  return findFiringSpot((heroId) => {
    const players = [seat(2, heroId, 180, 0, 20, 'QhJc'), seat(1, villainId, 180, 0, 20)];
    const history: ActionRecord[] = [
      { stage: 'preflop', seat: 1, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 6, timestamp: 2 },
      { stage: 'flop', seat: 1, userId: villainId, action: 'bet', amount: 14, timestamp: 3 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'call', amount: 14, timestamp: 4 },
      { stage: 'turn', seat: 1, userId: villainId, action: 'check', amount: 0, timestamp: 5 },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('9s5d2c4h'),
        pot: 40,
        currentBet: 0,
        minRaise: 2,
        bigBlind: 2,
        dealerSeat: 2,
        stage: 'turn',
        gameVariant: 'nlh',
        gameMode: 'cash',
        actionHistory: history,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 2,
        maxRaiseTo: 180,
      },
      setupMind: () => seedStabberMind(villainId),
    };
  }, 'v87_turn_takeaway');
}

function makeIpCheckbackTrapSpot(): SpotFixture {
  return findFiringSpot((heroId) => {
    const players = [seat(2, heroId, 194, 0, 6, '7h7d'), seat(1, 'villain-ipcb', 194, 0, 6)];
    const history: ActionRecord[] = [
      { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6, timestamp: 1 },
      {
        stage: 'preflop',
        seat: 1,
        userId: 'villain-ipcb',
        action: 'call',
        amount: 6,
        timestamp: 2,
      },
      {
        stage: 'flop',
        seat: 1,
        userId: 'villain-ipcb',
        action: 'check',
        amount: 0,
        timestamp: 3,
      },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Ks7c2d'),
        pot: 12,
        currentBet: 0,
        minRaise: 2,
        bigBlind: 2,
        dealerSeat: 2,
        stage: 'flop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        actionHistory: history,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 2,
        maxRaiseTo: 194,
      },
      baseOpts: { mind: false },
    };
  }, 'v87_ip_checkback_trap');
}

function makeOopStabTrapSpot(): SpotFixture {
  const villainId = 'villain-oopstab';
  return findFiringSpot((heroId) => {
    const players = [seat(1, heroId, 194, 0, 6, '7h7d'), seat(2, villainId, 194, 0, 6)];
    const history: ActionRecord[] = [
      { stage: 'preflop', seat: 2, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 1, userId: heroId, action: 'call', amount: 6, timestamp: 2 },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Ks7c2d'),
        pot: 12,
        currentBet: 0,
        minRaise: 2,
        bigBlind: 2,
        dealerSeat: 2,
        stage: 'flop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        actionHistory: history,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 2,
        maxRaiseTo: 194,
      },
      setupMind: () => seedStabberMind(villainId),
    };
  }, 'v87_oop_stab_trap');
}

function makeMultiwayWetAirCheckSpot(): SpotFixture {
  const players = [
    seat(3, 'hero-mwwet', 194, 0, 6, 'Kd3c'),
    seat(1, 'villain-mw1', 194, 0, 6),
    seat(2, 'villain-mw2', 194, 0, 6),
  ];
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 3, userId: 'hero-mwwet', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'villain-mw1', action: 'call', amount: 6, timestamp: 2 },
    { stage: 'preflop', seat: 2, userId: 'villain-mw2', action: 'call', amount: 6, timestamp: 3 },
    { stage: 'flop', seat: 1, userId: 'villain-mw1', action: 'check', amount: 0, timestamp: 4 },
    { stage: 'flop', seat: 2, userId: 'villain-mw2', action: 'check', amount: 0, timestamp: 5 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('JhTh9h'),
      pot: 18,
      currentBet: 0,
      minRaise: 2,
      bigBlind: 2,
      dealerSeat: 3,
      stage: 'flop',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['check', 'bet', 'all_in'],
      minRaiseTo: 2,
      maxRaiseTo: 194,
    },
    baseOpts: {},
  };
}

function makeBubbleCoveredPotControlSpot(): SpotFixture {
  const players = [
    seat(2, 'hero-bubcov', 3000, 0, 400, 'Js3d'),
    seat(1, 'villain-bubcov', 8000, 0, 400),
  ];
  const history: ActionRecord[] = [
    {
      stage: 'preflop',
      seat: 2,
      userId: 'hero-bubcov',
      action: 'raise',
      amount: 250,
      timestamp: 1,
    },
    {
      stage: 'preflop',
      seat: 1,
      userId: 'villain-bubcov',
      action: 'call',
      amount: 250,
      timestamp: 2,
    },
    {
      stage: 'flop',
      seat: 1,
      userId: 'villain-bubcov',
      action: 'check',
      amount: 0,
      timestamp: 3,
    },
    { stage: 'flop', seat: 2, userId: 'hero-bubcov', action: 'check', amount: 0, timestamp: 4 },
    {
      stage: 'turn',
      seat: 1,
      userId: 'villain-bubcov',
      action: 'check',
      amount: 0,
      timestamp: 5,
    },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('JcTh9h8h'),
      pot: 800,
      currentBet: 0,
      minRaise: 100,
      bigBlind: 100,
      dealerSeat: 2,
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'tournament',
      tournament: { nearBubble: true, inMoney: false },
      actionHistory: history,
      legalActions: ['check', 'bet', 'all_in'],
      minRaiseTo: 100,
      maxRaiseTo: 3000,
    },
    baseOpts: {},
  };
}

function makeRiverBlockLagCheckSpot(): SpotFixture {
  const villainId = 'villain-rblag';
  const players = [seat(1, 'hero-rblag', 180, 0, 20, '2c3d'), seat(2, villainId, 180, 0, 20)];
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 1, userId: 'hero-rblag', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: villainId, action: 'call', amount: 6, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero-rblag', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: villainId, action: 'check', amount: 0, timestamp: 4 },
    { stage: 'turn', seat: 1, userId: 'hero-rblag', action: 'check', amount: 0, timestamp: 5 },
    { stage: 'turn', seat: 2, userId: villainId, action: 'check', amount: 0, timestamp: 6 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('KsQh8c4s2d'),
      pot: 20,
      currentBet: 0,
      minRaise: 2,
      bigBlind: 2,
      dealerSeat: 2,
      stage: 'river',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['check', 'bet', 'all_in'],
      minRaiseTo: 2,
      maxRaiseTo: 180,
    },
    setupMind: () => seedSustainedLagMind(villainId),
  };
}

function makeDoubleBoardDeadHalfSpot(): SpotFixture {
  const players = [seat(1, 'hero-db', 200, 0, 20, 'Kh4d'), seat(2, 'villain-db', 160, 40, 60)];
  const history: ActionRecord[] = [
    { stage: 'turn', seat: 1, userId: 'hero-db', action: 'check', amount: 0, timestamp: 1 },
    { stage: 'turn', seat: 2, userId: 'villain-db', action: 'bet', amount: 40, timestamp: 2 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('KsQdJsTs'),
      communityCards2: cards('AcAhQdJs'),
      pot: 80, // pot before bet = 40 -> potFrac = 40/40 = 1.0 >= 0.6
      currentBet: 40,
      minRaise: 40,
      bigBlind: 2,
      dealerSeat: 2,
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bombPot: true,
      actionHistory: history,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 80,
      maxRaiseTo: 200,
    },
    baseOpts: { mind: false },
  };
}

function makeDeepCashOnePairSpot(): SpotFixture {
  const players = [seat(1, 'hero-deep', 360, 0, 40, 'AhKd'), seat(2, 'villain-deep', 300, 60, 100)];
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 1, userId: 'hero-deep', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: 'villain-deep', action: 'call', amount: 6, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero-deep', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: 'villain-deep', action: 'bet', amount: 12, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero-deep', action: 'call', amount: 12, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero-deep', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: 'villain-deep', action: 'bet', amount: 22, timestamp: 7 },
    { stage: 'turn', seat: 1, userId: 'hero-deep', action: 'call', amount: 22, timestamp: 8 },
    { stage: 'river', seat: 1, userId: 'hero-deep', action: 'check', amount: 0, timestamp: 9 },
    { stage: 'river', seat: 2, userId: 'villain-deep', action: 'bet', amount: 60, timestamp: 10 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('As9c7s5d2h'),
      pot: 140, // pot before bet = 80 -> potFrac = 60/80 = 0.75 >= 0.65, effBB87 = 200 >= 150
      currentBet: 60,
      minRaise: 60,
      bigBlind: 2,
      dealerSeat: 2,
      stage: 'river',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 120,
      maxRaiseTo: 360,
    },
    baseOpts: { mind: false },
  };
}

function makeComboDrawPumpSpot(): SpotFixture {
  return findFiringSpot((heroId) => {
    const players = [
      seat(1, heroId, 180, 0, 20, 'QhJh'),
      seat(2, 'villain-cdp1', 160, 20, 40),
      seat(3, 'villain-cdp2', 180, 0, 20),
    ];
    const history: ActionRecord[] = [
      {
        stage: 'preflop',
        seat: 2,
        userId: 'villain-cdp1',
        action: 'raise',
        amount: 20,
        timestamp: 1,
      },
      {
        stage: 'preflop',
        seat: 3,
        userId: 'villain-cdp2',
        action: 'call',
        amount: 20,
        timestamp: 2,
      },
      { stage: 'preflop', seat: 1, userId: heroId, action: 'call', amount: 20, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: heroId, action: 'check', amount: 0, timestamp: 4 },
      { stage: 'flop', seat: 2, userId: 'villain-cdp1', action: 'bet', amount: 20, timestamp: 5 },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Th9h2c'),
        pot: 80, // spr = 180/80 = 2.25 <= 7, potFrac = 20/60 = 0.33, oppCount = 2 -> ftRaiseOwned false
        currentBet: 20,
        minRaise: 20,
        bigBlind: 2,
        dealerSeat: 3,
        stage: 'flop',
        gameVariant: 'nlh',
        gameMode: 'cash',
        actionHistory: history,
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        minRaiseTo: 40,
        maxRaiseTo: 180,
      },
      baseOpts: { mind: false, flopTurnBluffBaseline: false },
    };
  }, 'v87_combo_draw_jam');
}

function makeRiverBlockerBluffRaiseSpot(): SpotFixture {
  const villainId = 'villain-rbbr';
  return findFiringSpot(
    (heroId) => {
      const players = [seat(2, heroId, 400, 0, 20, 'As3d'), seat(1, villainId, 385, 15, 35)];
      const history: ActionRecord[] = [
        { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6, timestamp: 1 },
        { stage: 'preflop', seat: 1, userId: villainId, action: 'call', amount: 6, timestamp: 2 },
        { stage: 'flop', seat: 1, userId: villainId, action: 'check', amount: 0, timestamp: 3 },
        { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 4 },
        { stage: 'turn', seat: 1, userId: villainId, action: 'check', amount: 0, timestamp: 5 },
        { stage: 'turn', seat: 2, userId: heroId, action: 'check', amount: 0, timestamp: 6 },
        { stage: 'river', seat: 1, userId: villainId, action: 'bet', amount: 15, timestamp: 7 },
      ];
      return {
        hero: players[0],
        gs: {
          players,
          communityCards: cards('KsQs9s5c2d'),
          pot: 45, // pot before bet = 30 -> potFrac = 15/30 = 0.50 <= 0.80, stack=400 so 75% pot raise is non-committing
          currentBet: 15,
          minRaise: 15,
          bigBlind: 2,
          dealerSeat: 2,
          stage: 'river',
          gameVariant: 'nlh',
          gameMode: 'cash',
          actionHistory: history,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: 30,
          maxRaiseTo: 400,
        },
        setupMind: () => seedStabberMind(villainId, { riverFold: true }),
      };
    },
    'v87_river_blocker_bluff_raise',
    120
  );
}

function makeIpFlopFloatSpot(): SpotFixture {
  const villainId = 'villain-ipfloat';
  const players = [seat(2, 'hero-ipfloat', 194, 0, 6, 'Jc8d'), seat(1, villainId, 189, 5, 11)];
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 1, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: 'hero-ipfloat', action: 'call', amount: 6, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: villainId, action: 'bet', amount: 5, timestamp: 3 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('9s7c2h'),
      pot: 17, // pot before bet = 12 -> potFrac = 5/12 = 0.417 <= 0.55; J8 has 4-out gutshot (T)
      currentBet: 5,
      minRaise: 5,
      bigBlind: 2,
      dealerSeat: 2,
      stage: 'flop',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 10,
      maxRaiseTo: 194,
    },
    setupMind: () => seedStabberMind(villainId),
    baseOpts: { flopTurnBluffBaseline: false, v53Pressure: false },
  };
}

function makePreflopCashOpenSpot(): SpotFixture {
  const players = Array.from({ length: 9 }, (_, i) =>
    seat(
      i + 1,
      i === 0 ? 'hero-pf' : `opp-pf-${i + 1}`,
      200,
      i === 7 ? 1 : i === 8 ? 2 : 0,
      0,
      i === 0 ? '7s6s' : ''
    )
  );
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: [],
      pot: 3,
      currentBet: 2,
      minRaise: 2,
      bigBlind: 2,
      dealerSeat: 7,
      stage: 'preflop',
      gameVariant: 'nlh',
      gameMode: 'cash',
      actionHistory: [],
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 4,
      maxRaiseTo: 200,
    },
    baseOpts: { mind: false },
  };
}

function makePloSpot(
  variant: 'plo4' | 'plo5' | 'plo6',
  stage: 'flop' | 'turn' | 'river'
): SpotFixture {
  const holeByVariant: Record<typeof variant, string> = {
    plo4: 'AhKhQsJd',
    plo5: 'AhKhQsJd9h',
    plo6: 'AhKhQsJd9h8c',
  };
  const boardByStage: Record<typeof stage, string> = {
    flop: 'Kd7c2s',
    turn: 'Kd7c2s4h',
    river: 'Kd7c2s4h9d',
  };
  const players = [
    seat(2, `hero-${variant}-${stage}`, 200, 0, 20, holeByVariant[variant]),
    seat(1, `villain-${variant}-${stage}`, 180, 20, 40),
  ];
  const history: ActionRecord[] = [
    {
      stage: 'preflop',
      seat: 2,
      userId: players[0].user_id,
      action: 'raise',
      amount: 6,
      timestamp: 1,
    },
    {
      stage: 'preflop',
      seat: 1,
      userId: players[1].user_id,
      action: 'call',
      amount: 6,
      timestamp: 2,
    },
    { stage, seat: 1, userId: players[1].user_id, action: 'bet', amount: 20, timestamp: 3 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(boardByStage[stage]),
      pot: 60,
      currentBet: 20,
      minRaise: 20,
      bigBlind: 2,
      dealerSeat: 2,
      stage,
      gameVariant: variant,
      gameMode: 'cash',
      actionHistory: history,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 40,
      maxRaiseTo: 200,
    },
    baseOpts: { mind: false },
  };
}

describe('LAW: v87HoldemOverhaul postflop split is exact', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });

  it('produces 100% bit-identical decisions, telemetry, and PRNG when unset vs v87HoldemOverhaul: true vs all 14 sub-flags true', () => {
    const spots: Array<[string, SpotFixture]> = [
      ['preflop_cash_open', makePreflopCashOpenSpot()],
      ['range_cbet', makeRangeCbetSpot()],
      ['low_spr_commit', makeLowSprCommitSpot()],
      ['turn_takeaway', makeTurnTakeawaySpot()],
      ['ip_checkback_trap', makeIpCheckbackTrapSpot()],
      ['oop_stab_trap', makeOopStabTrapSpot()],
      ['multiway_wet_air_check', makeMultiwayWetAirCheckSpot()],
      ['bubble_covered_pot_control', makeBubbleCoveredPotControlSpot()],
      ['river_block_lag_check', makeRiverBlockLagCheckSpot()],
      ['double_board_dead_half', makeDoubleBoardDeadHalfSpot()],
      ['deep_cash_onepair', makeDeepCashOnePairSpot()],
      ['combo_draw_pump', makeComboDrawPumpSpot()],
      ['river_blocker_bluff_raise', makeRiverBlockerBluffRaiseSpot()],
      ['ip_flop_float', makeIpFlopFloatSpot()],
    ];

    for (const [label, spot] of spots) {
      const unset = runSpot(spot, {});
      const explicitMaster = runSpot(spot, { v87HoldemOverhaul: true });
      const explicitAll = runSpot(spot, { v87HoldemOverhaul: true, ...ALL_SUBFLAGS_TRUE });
      expect(explicitMaster, `${label}: v87HoldemOverhaul: true matches unset`).toEqual(unset);
      expect(explicitAll, `${label}: all 14 sub-flags true matches unset`).toEqual(unset);
    }
  });

  const isolatedReceiptCases: Array<{
    flag: V87SubFlag;
    receipt: string;
    buildSpot: () => SpotFixture;
  }> = [
    { flag: 'v87RangeCbet', receipt: 'v87_range_cbet', buildSpot: makeRangeCbetSpot },
    { flag: 'v87LowSprCommit', receipt: 'v87_low_spr_commit', buildSpot: makeLowSprCommitSpot },
    { flag: 'v87TurnTakeaway', receipt: 'v87_turn_takeaway', buildSpot: makeTurnTakeawaySpot },
    {
      flag: 'v87IpCheckbackTrap',
      receipt: 'v87_ip_checkback_trap',
      buildSpot: makeIpCheckbackTrapSpot,
    },
    { flag: 'v87OopStabTrap', receipt: 'v87_oop_stab_trap', buildSpot: makeOopStabTrapSpot },
    {
      flag: 'v87MultiwayWetAirCheck',
      receipt: 'v87_multiway_wet_air_check',
      buildSpot: makeMultiwayWetAirCheckSpot,
    },
    {
      flag: 'v87BubblePostflop',
      receipt: 'v87_bubble_covered_pot_control',
      buildSpot: makeBubbleCoveredPotControlSpot,
    },
    {
      flag: 'v87RiverBlockBalance',
      receipt: 'v87_river_block_lag_check',
      buildSpot: makeRiverBlockLagCheckSpot,
    },
    {
      flag: 'v87DoubleBoardDeadHalfFold',
      receipt: 'v87_double_board_dead_half_fold',
      buildSpot: makeDoubleBoardDeadHalfSpot,
    },
    {
      flag: 'v87DeepCashOnePairPotControl',
      receipt: 'v87_deep_cash_onepair_pot_control',
      buildSpot: makeDeepCashOnePairSpot,
    },
    {
      flag: 'v87ComboDrawPump',
      receipt: 'v87_combo_draw_jam',
      buildSpot: makeComboDrawPumpSpot,
    },
    {
      flag: 'v87RiverBlockerBluffRaise',
      receipt: 'v87_river_blocker_bluff_raise',
      buildSpot: makeRiverBlockerBluffRaiseSpot,
    },
    { flag: 'v87IpFlopFloat', receipt: 'v87_ip_flop_float', buildSpot: makeIpFlopFloatSpot },
  ];

  it.each(isolatedReceiptCases)(
    'isolates $flag cleanly: false stops $receipt without disabling preflop V87 or other postflop sub-flags',
    ({ flag, receipt, buildSpot }) => {
      const spot = buildSpot();
      const baseline = runSpot(spot);
      expect(baseline.fires[receipt] ?? 0, `${flag} ON fires ${receipt}`).toBeGreaterThan(0);

      // Turning ONLY this flag OFF stops its receipt.
      const onlyThisOff = runSpot(spot, { [flag]: false });
      expect(onlyThisOff.fires[receipt] ?? 0, `${flag} OFF suppresses ${receipt}`).toBe(0);

      // Turning ALL OTHER 13 sub-flags OFF leaves THIS sub-rule firing identically.
      const othersOff: HorseDecideOpts = { ...ALL_SUBFLAGS_FALSE, [flag]: true };
      const onlyThisOn = runSpot(spot, othersOff);
      expect(onlyThisOn.fires[receipt] ?? 0, `${flag} stays ON when other 13 are OFF`).toBe(
        baseline.fires[receipt]
      );
      expect(onlyThisOn.decision, `${flag} decision unchanged when other 13 are OFF`).toEqual(
        baseline.decision
      );

      // Turning this postflop flag OFF never changes V87 preflop ranges.
      const pfSpot = makePreflopCashOpenSpot();
      expect(runSpot(pfSpot, { [flag]: false })).toEqual(runSpot(pfSpot));

      // Turning v87HoldemOverhaul: false still suppresses the sub-rule (historical corpora compatibility).
      const masterOff = runSpot(spot, { v87HoldemOverhaul: false });
      expect(masterOff.fires[receipt] ?? 0, `v87HoldemOverhaul: false suppresses ${receipt}`).toBe(
        0
      );
    }
  );

  it('isolates v87BullyReadAdjust cleanly in HorseLogic.ts without disabling preflop V87 or other postflop sub-flags', () => {
    // Verify turning v87BullyReadAdjust: false does not alter preflop V87 or low-SPR commit.
    const pfSpot = makePreflopCashOpenSpot();
    expect(runSpot(pfSpot, { v87BullyReadAdjust: false })).toEqual(runSpot(pfSpot));

    const lowSprSpot = makeLowSprCommitSpot();
    const lowSprOn = runSpot(lowSprSpot);
    const lowSprWithBullyOff = runSpot(lowSprSpot, { v87BullyReadAdjust: false });
    expect(lowSprWithBullyOff).toEqual(lowSprOn);
    expect(lowSprWithBullyOff.fires.v87_low_spr_commit).toBeGreaterThan(0);

    // Verify all 3 bully-read sites in HorseLogic.ts explicitly check opts.v87BullyReadAdjust !== false.
    const logic = readFileSync(join(REPO, 'server/src/engine/HorseLogic.ts'), 'utf8');
    const matches = [...logic.matchAll(/opts\.v87BullyReadAdjust\s*!==\s*false/g)];
    expect(matches.length).toBe(3);
  });

  it('causes ZERO PLO4, PLO5, or PLO6 diff under any V87 sub-flag combination', () => {
    const variants = ['plo4', 'plo5', 'plo6'] as const;
    const stages = ['flop', 'turn', 'river'] as const;

    for (const variant of variants) {
      for (const stage of stages) {
        const spot = makePloSpot(variant, stage);
        const baseline = runSpot(spot, {});
        expect(
          runSpot(spot, { v87HoldemOverhaul: false }),
          `${variant}/${stage} v87HoldemOverhaul: false`
        ).toEqual(baseline);
        expect(
          runSpot(spot, ALL_SUBFLAGS_FALSE),
          `${variant}/${stage} all 14 V87 sub-flags false`
        ).toEqual(baseline);
        expect(
          runSpot(spot, ALL_SUBFLAGS_TRUE),
          `${variant}/${stage} all 14 V87 sub-flags true`
        ).toEqual(baseline);
      }
    }
  });

  it('registers every decoupled V87 postflop sub-flag in HorseLogic, HorseDataLedger, and OPTION_SWITCH_REFUSED', () => {
    const logic = readFileSync(join(REPO, 'server/src/engine/HorseLogic.ts'), 'utf8');
    const ledgerFlagKeys = new Set(
      HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag').map((e) => e.key)
    );
    const refusedKeys = new Set(Object.keys(OPTION_SWITCH_REFUSED));

    for (const flag of V87_POSTFLOP_SUBFLAGS) {
      expect(logic, `${flag} checked in HorseLogic.ts`).toMatch(
        new RegExp(`opts\\.${flag}\\s*!==\\s*false`)
      );
      expect(ledgerFlagKeys.has(flag), `${flag} in HORSE_DATA_LEDGER`).toBe(true);
      expect(refusedKeys.has(flag), `${flag} in OPTION_SWITCH_REFUSED`).toBe(true);
    }
  });
});
