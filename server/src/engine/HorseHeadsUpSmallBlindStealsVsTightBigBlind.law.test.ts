/**
 * THE HEADS-UP SMALL BLIND STEALS AGAINST A PROVEN TIGHT BIG BLIND
 * (2026-11-15, heads-up lane round 2, D6; option
 * huSmallBlindStealsVsTightBigBlind, default OFF).
 *
 * Measured by the heads-up audit through the real HorseLogic.decide: against
 * a big blind that folds about 91% of the time, the heads-up small blind's
 * first-in decisions changed in 0 of 507 replayed decisions (raise 78.6%,
 * limp 5.4%, fold 16.0% at 100bb): the first-in block only asks whether a
 * maniac is behind.
 *
 * This option is a first-in widening and nothing else:
 *  - it acts only when the big blind is a proven tight folder on the existing
 *    decayed heads-up counters (HorseHuTightBigBlindSteal.huTightFolderRead)
 *    and his worst-case fold share, 1 - 2 x VPIP, clears the largest heads-up
 *    open's break-even on folds alone; then every hand opens;
 *  - every change is a fold or a limp that became an open; a hand that
 *    already opened keeps its size;
 *  - it acts only at 20-150bb effective, in no-limit hold'em with exactly two
 *    dealt in: cash, or a tournament whose trusted context says exactly two
 *    players are left in the event and that is not a satellite;
 *  - unknown, sparse, loose and tight-looking-but-defending opponents get
 *    today's answer;
 *  - off, or unset, every decision is the one made today.
 *
 * Every decision here is the real HorseLogic.decide with the live Hybrid
 * persona, over all 169 hand classes, with the opponent row installed the way
 * production reads it (a decision sandbox holding the pooled nlh:cash:hu row).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import { freshExploitCounters, opponentExploitRead } from './HorseOpponentExploit.js';
import {
  HU_STEAL_CASH_OPEN_CEILING_BB,
  HU_STEAL_TOURNAMENT_OPEN_CEILING_BB,
  huTightBigBlindSteal,
  huTightFolderRead,
} from './HorseHuTightBigBlindSteal.js';
import {
  HU_FOLD_SB_DEFEND_BB_PERSONA,
  HU_NIT_BIG_BLIND_PERSONA,
  HU_STEAL_CARDS,
  LEAGUE_MATCHUPS,
  humanFieldPersonaProfile,
} from '../benchmark/HorseLeague.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from '../benchmark/HumanCalibratedPopulation.js';
import type { Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;
const HERO = 'sbs-1';
const BIG = 'sbs-2';

type Row = { hands: number; vpip: number; pfr: number };
/** A heads-up nit: 40 decayed hands, VPIP 10%. */
const NIT: Row = { hands: 40, vpip: 0.1, pfr: 0.07 };
/** A sound heads-up player at the population mean. */
const SOUND: Row = { hands: 40, vpip: 0.42, pfr: 0.32 };
/** Folds his small blind, defends his big blind: VPIP 24%, still above the bar's worst case. */
const DEFENDER: Row = { hands: 40, vpip: 0.24, pfr: 0.02 };
/** A nit with too little evidence. */
const SPARSE: Row = { hands: 10, vpip: 0.1, pfr: 0.07 };

function counters(r: Row) {
  const c = freshExploitCounters();
  c.hands = r.hands;
  c.vpip = r.vpip * r.hands;
  c.pfr = r.pfr * r.hands;
  c.fHands = Math.min(r.hands, 20);
  c.fPfr = r.pfr * c.fHands;
  return c;
}

type Spot = {
  stackBB: number;
  mode?: 'cash' | 'tournament';
  tournament?: Record<string, unknown>;
  buttonFolded?: boolean;
  variant?: string;
  extra?: Record<string, unknown>;
};
const TWO_LEFT = {
  schemaVersion: 1,
  contextStatus: 'complete',
  contextIssues: [],
  playersLeft: 2,
  spotsPaid: 2,
  entrants: 2,
  inMoney: true,
  nearBubble: false,
  payoutPct: [65, 35],
  seatsPerTable: 2,
  currentSmallBlind: 1,
  currentBigBlind: BB,
  currentAnte: 0,
};

function holeFor(cls: string, omaha: boolean): Card[] {
  const suited = cls.length === 3 && cls[2] === 's';
  const h = [
    { rank: cls[0], suit: 'spades' } as Card,
    { rank: cls[1], suit: suited ? 'spades' : 'hearts' } as Card,
  ];
  if (omaha) h.push({ rank: '7', suit: 'diamonds' } as Card, { rank: '2', suit: 'clubs' } as Card);
  return h;
}

/** Seat 1, the hero, is the button and small blind, first in; seat 2 is the big blind. */
function stateFor(spot: Spot, hole: Card[]) {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const n = hole.length;
  const seat = (s: number, bet: number, over: Partial<SeatPlayer> = {}): SeatPlayer =>
    ({
      seat: s,
      user_id: `sbs-${s}`,
      username: `Sbs${s}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: s === 1 ? hole : deck.slice(s * n, s * n + n),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const players: SeatPlayer[] = [seat(1, BB / 2), seat(2, BB)];
  const history: Record<string, unknown>[] = [];
  let dealt = [1, 2];
  let dealerSeat = 1;
  if (spot.buttonFolded) {
    players.push(seat(3, 0, { is_folded: true }));
    history.push({
      seat: 3,
      userId: 'sbs-3',
      action: 'fold',
      amount: 0,
      timestamp: 100,
      stage: 'preflop',
    });
    dealt = [1, 2, 3];
    dealerSeat = 3;
  }
  const mode = spot.mode ?? 'cash';
  const gs = {
    players,
    communityCards: [],
    pot: BB + BB / 2,
    currentBet: BB,
    minRaise: BB,
    lastRaise: BB,
    stage: 'preflop',
    gameVariant: spot.variant ?? 'nlh',
    bigBlind: BB,
    dealerSeat,
    actionHistory: history,
    gameMode: mode,
    ante: 0,
    format: mode === 'cash' ? 'cash' : 'hu_sng',
    dealtSeatIds: dealt,
    ...(mode === 'tournament' && spot.tournament ? { tournament: spot.tournament } : {}),
    ...(spot.extra ?? {}),
  } as unknown as HorseGameStateV2;
  return { hero: players[0], gs };
}

type Pick = { action: string; amount: number | undefined };
/** Every class through the real HorseLogic.decide, the big blind's row in the decision sandbox. */
function sweep(spot: Spot, opts: Record<string, unknown>, row: Row | null): Record<string, Pick> {
  const mode = spot.mode ?? 'cash';
  const hybrid = HORSE_HYBRID_PROFILES[mode === 'tournament' ? 'tournament' : 'cash'];
  const sb = HorseMind.createSandbox();
  if (row) sb.exploit.set(`nlh:${mode}:hu|${BIG}`, counters(row));
  return HorseMind.runInSandbox(sb, () => {
    const out: Record<string, Pick> = {};
    for (const h of HAND_CLASSES) {
      const { hero, gs } = stateFor(spot, holeFor(h.cls, (spot.variant ?? 'nlh') !== 'nlh'));
      seedFastRandom(17 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
      const d = HorseLogic.decide(
        hero,
        gs,
        hybrid.style,
        { ...hybrid.mods },
        { decisionTimeMs: Date.UTC(2026, 10, 15, 12, 0, 0), observeMind: false, ...opts }
      );
      out[h.cls] = {
        action: d.action,
        amount: typeof d.amount === 'number' ? d.amount : undefined,
      };
    }
    return out;
  });
}
const ON = { huSmallBlindStealsVsTightBigBlind: true };
const spot = (over: Partial<Spot> = {}): Spot => ({ stackBB: 40, ...over });
const twoLeft = (over: Partial<Spot> = {}): Spot =>
  spot({ mode: 'tournament', tournament: TWO_LEFT, ...over });

function changes(s: Spot, row: Row | null = NIT, on: Record<string, unknown> = ON) {
  const withOn = sweep(s, on, row);
  const withOff = sweep(s, {}, row);
  const classes = Object.keys(withOn).filter((k) => withOn[k].action !== withOff[k].action);
  return {
    classes,
    kinds: [...new Set(classes.map((k) => `${withOff[k].action}>${withOn[k].action}`))].sort(),
    off: withOff,
    on: withOn,
  };
}

describe('huTightFolderRead and the steal price (pure)', () => {
  it('a nit with enough evidence is a folder; sparse, sound and defending players are not stolen from', () => {
    const read = (r: Row) =>
      huTightFolderRead(
        counters(r),
        'holdem:hu',
        'nlh',
        opponentExploitRead(counters(r), 'holdem:hu', 'nlh')
      );
    expect(read(NIT)?.folder).toBe(true);
    expect(read(SPARSE)).toBeNull();
    expect(read(SOUND)?.folder).toBe(false);
    const cashRisk = HU_STEAL_CASH_OPEN_CEILING_BB - 0.5;
    expect(huTightBigBlindSteal(read(NIT), cashRisk, 1.5)).not.toBeNull();
    expect(huTightBigBlindSteal(read(DEFENDER), cashRisk, 1.5)).toBeNull();
    expect(huTightBigBlindSteal(read(SOUND), cashRisk, 1.5)).toBeNull();
  });

  it('the worst case is 1 - 2 x VPIP against the largest open, on folds alone', () => {
    expect(HU_STEAL_CASH_OPEN_CEILING_BB).toBe(3.5);
    expect(HU_STEAL_TOURNAMENT_OPEN_CEILING_BB).toBe(2.5);
    const folder = { hands: 40, folder: true, vpip: 0.15 };
    const s = huTightBigBlindSteal(folder, 3, 1.5)!;
    expect(s.pFoldLower).toBeCloseTo(0.7, 10);
    expect(s.breakEven).toBeCloseTo(3 / 4.5, 10);
    // 1 - 2 x 0.17 = 0.66 does not clear 0.667: nothing.
    expect(huTightBigBlindSteal({ ...folder, vpip: 0.17 }, 3, 1.5)).toBeNull();
    expect(huTightBigBlindSteal({ ...folder, folder: false }, 3, 1.5)).toBeNull();
  });

  it("only the heads-up hold'em scope is read", () => {
    const c = counters(NIT);
    expect(huTightFolderRead(c, 'holdem:short', 'nlh', null)).toBeNull();
    expect(huTightFolderRead(c, 'omaha:hu', 'plo4', null)).toBeNull();
    expect(HorseMind.huTightFolderReadOf(BIG)).toBeNull();
  });
});

describe('huSmallBlindStealsVsTightBigBlind: the heads-up small blind first in', () => {
  it('today a proven tight big blind changes nothing: the small blind folds and limps as against anyone', () => {
    const vsNit = sweep(spot(), {}, NIT);
    const vsNobody = sweep(spot(), {}, null);
    expect(vsNit).toEqual(vsNobody);
    const notOpened = Object.values(vsNit).filter((p) => p.action !== 'raise').length;
    expect(notOpened).toBeGreaterThanOrEqual(15);
  });

  it('on, against that big blind every hand opens, and every change is a fold or limp that became an open', () => {
    const c = changes(spot());
    expect(Object.values(c.on).every((p) => p.action === 'raise')).toBe(true);
    expect(c.classes.length).toBeGreaterThanOrEqual(15);
    for (const k of c.kinds) expect(['call>raise', 'fold>raise']).toContain(k);
  });

  it('a hand that already opened keeps its size', () => {
    const c = changes(spot());
    for (const [cls, p] of Object.entries(c.off))
      if (p.action === 'raise') expect(c.on[cls], cls).toEqual(p);
  });

  const NOT_STOLEN: readonly [string, Row | null][] = [
    ['an unknown big blind', null],
    ['a nit seen for too few hands', SPARSE],
    ['a sound big blind', SOUND],
    ['a big blind whose VPIP looks tight but who defends', DEFENDER],
  ];
  it.each(NOT_STOLEN)('changes nothing against %s', (_name, row) => {
    expect(changes(spot(), row).classes).toEqual([]);
  });

  it('acts at 20-150bb effective and not outside', () => {
    expect(changes(spot({ stackBB: 20 })).classes.length).toBeGreaterThan(0);
    expect(changes(spot({ stackBB: 150 })).classes.length).toBeGreaterThan(0);
    expect(changes(spot({ stackBB: 15 })).classes).toEqual([]);
    expect(changes(spot({ stackBB: 160 })).classes).toEqual([]);
  });

  it('with memory off there is no read and nothing changes', () => {
    expect(changes(spot(), NIT, { ...ON, mind: false }).classes).toEqual([]);
  });
});

describe('a tournament is in scope only heads-up for the title', () => {
  it('acts with exactly two players left in the event, trusted context', () => {
    expect(changes(twoLeft()).classes.length).toBeGreaterThan(0);
  });
  const cases: readonly [string, Partial<Spot>][] = [
    ['three players left in the event', { tournament: { ...TWO_LEFT, playersLeft: 3 } }],
    ['a field still in progress', { tournament: { ...TWO_LEFT, playersLeft: 40, spotsPaid: 6 } }],
    ['a satellite', { tournament: { ...TWO_LEFT, satellite: true } }],
    ['an untrusted context', { tournament: { ...TWO_LEFT, contextStatus: 'partial' } }],
    ['no context at all', { tournament: undefined }],
  ];
  it.each(cases)('does not act with %s', (_name, over) => {
    expect(changes(twoLeft(over)).classes).toEqual([]);
  });
});

describe('out of scope', () => {
  const OUT_OF_SCOPE: readonly [string, Partial<Spot>][] = [
    ['blind against blind after a dealt-in button folded', { buttonFolded: true }],
    ['four-card Omaha', { variant: 'plo4' }],
    ['short deck', { variant: 'short_deck' }],
    ['fixed limit', { variant: 'flh' }],
    [
      "pot-limit hold'em",
      { extra: { variantRules: horseVariantRulesFor('nlh'), bettingStructure: 'pot_limit' } },
    ],
    ['an all-in-or-fold table', { extra: { allInOrFold: true } }],
    ['a straddled pot', { extra: { straddleActive: true } }],
    ['a bomb pot', { extra: { bombPot: true } }],
  ];
  it.each(OUT_OF_SCOPE)('does not act in %s', (_name, over) => {
    expect(changes(spot(over)).classes).toEqual([]);
  });
});

describe('off, the option changes nothing', () => {
  it('explicit false is the same decision as unset, for every class', () => {
    for (const s of [spot(), spot({ stackBB: 100 }), twoLeft()]) {
      expect(sweep(s, { huSmallBlindStealsVsTightBigBlind: false }, NIT)).toEqual(
        sweep(s, {}, NIT)
      );
    }
  });

  it('the brain reads the option in one place, and only an explicit true passes', () => {
    const src = readFileSync(fileURLToPath(new URL('./HorseLogic.ts', import.meta.url)), 'utf8');
    const reads = src.match(/opts\.huSmallBlindStealsVsTightBigBlind\b[^\n]*/g) ?? [];
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain('opts.huSmallBlindStealsVsTightBigBlind === true');
  });
});

describe('the league card and the two tight heads-up personas', () => {
  const HU = { population: HUMAN_CALIBRATED_POPULATION_ID, variant: 'nlh', seats: 2 } as const;
  it('the nit folds about 91% of its big blinds and never limps; the defender opens 3% and defends 45%', () => {
    const nit = humanFieldPersonaProfile(HU_NIT_BIG_BLIND_PERSONA, HU);
    expect(nit.cutoffs?.['preflop/unopened']).toEqual({ fold: 0.9, raise: 0.9 });
    expect(nit.cutoffs?.['preflop/facing_raise']).toEqual({ fold: 0.91, raise: 0.99 });
    const def = humanFieldPersonaProfile(HU_FOLD_SB_DEFEND_BB_PERSONA, HU);
    expect(def.cutoffs?.['preflop/unopened']).toEqual({ fold: 0.97, raise: 0.97 });
    expect(def.cutoffs?.['preflop/facing_raise']).toEqual({ fold: 0.55, raise: 0.92 });
    for (const p of [HU_NIT_BIG_BLIND_PERSONA, HU_FOLD_SB_DEFEND_BB_PERSONA])
      expect(() => humanFieldPersonaProfile(p, { ...HU, seats: 6 })).toThrow();
  });
  it('the card deals the option against the nit, heads-up 40bb, memory on', () => {
    const card = LEAGUE_MATCHUPS.find((m) => m.name === 'human_hu_sb_steals_vs_nit_40bb');
    expect(card).toBe(HU_STEAL_CARDS[0]);
    expect(card).toMatchObject({
      seats: 2,
      stackBB: 40,
      a: { huSmallBlindStealsVsTightBigBlind: true },
      b: {},
      humanPersona: HU_NIT_BIG_BLIND_PERSONA,
    });
    expect(card?.memoryLearning).toBeUndefined();
  });
});
