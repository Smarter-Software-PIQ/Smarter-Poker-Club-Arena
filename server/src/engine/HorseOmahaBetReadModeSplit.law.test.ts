/**
 * omahaBetReadIsModeSplit (default OFF; EMERG lane MODE-READ, 2026-11-20). Law:
 *  1. Option OFF (with omahaBetReadIsPerOpponent on or off): every decision is byte-identical to the option absent.
 *  2. PLO6 and a tournament are byte-identical with the option on; PLO6 is never learned in any mode.
 *  3. The read is per MODE: a bettor whose Lightning bets of one cell showed mostly air is read lighter in Lightning
 *     than at a table, where only his pooled evidence (shrunk) reaches the cell.
 *  4. The turn stab after a checked-through flop has its own cell; a raise has its own cell.
 *  5. SOURCE LAW: no unshown card reaches the read. The mode-split read takes no card argument and reads only the
 *     rows the learner built from showdown reveals; the learner's mode comes from the hand's public speed only.
 *  6. The shipped population constants (frequency slope; turn-stab rows) carry provenance
 *     population_all_cards_capped, are never keyed by player, and no player is above 20% of a row.
 *  7. The same rule reads a Horse bettor (the turn-stab line too).
 * Constructed cards only.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  OMAHA_BET_READ_FREQ_SLOPE,
  OMAHA_BET_READ_FREQ_SLOPE_PROVENANCE,
  OMAHA_BET_READ_TURN_REALIZATION,
  omahaBetReadBluffShare,
  omahaBetReadLearn,
  omahaBetReadLineOf,
  omahaBetReadModeOf,
  omahaBetReadOf,
  omahaBetReadReset,
  type OmahaBetReadAction,
} from './HorseOmahaBetRead.js';
import {
  OMAHA_TURN_STAB_LIGHTNING_TOP_PLAYER_SHARE,
  OMAHA_TURN_STAB_PROVENANCE,
  OMAHA_TURN_STAB_TOP_PLAYER_SHARE,
} from './HorseOmahaTurnStabDefence.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-0000000m0de1';
const TIMING_KEYS = new Set(['latencyMs', 'elapsedMs', 'simulationMs', 'policyMs']);
const BASE = { omahaFacingBetEv: true, omahaBetReadIsPerOpponent: true };
const ON = { ...BASE, omahaBetReadIsModeSplit: true };

/** A completed heads-up hand: the flop checks through, `bettor` makes the first wager of `street` (`frac` x pot),
 *  or raises the caller's bet (`raise`), and both show (or `bettor` mucks). */
function learnHand(
  key: string,
  variant: string,
  bettor: string,
  bettorCards: string,
  board: string,
  frac: number,
  o: {
    speed?: string;
    street?: 'turn' | 'river';
    mucked?: boolean;
    raise?: boolean;
    horse?: boolean;
  } = {}
): boolean {
  const caller = `${bettor}-caller-${key}`;
  const street = o.street ?? 'turn';
  const origin = o.horse ? 'horse_policy' : 'player';
  const pot = 12;
  const actions: OmahaBetReadAction[] = [
    { stage: 'preflop', userId: bettor, action: 'raise', amount: 6, origin },
    { stage: 'preflop', userId: caller, action: 'call', amount: 6, origin: 'player' },
    { stage: 'flop', userId: caller, action: 'check', amount: 0, origin: 'player' },
    { stage: 'flop', userId: bettor, action: 'check', amount: 0, origin },
  ];
  if (street === 'river')
    actions.push(
      { stage: 'turn', userId: caller, action: 'check', amount: 0, origin: 'player' },
      { stage: 'turn', userId: bettor, action: 'check', amount: 0, origin }
    );
  if (o.raise)
    actions.push(
      { stage: street, userId: caller, action: 'bet', amount: pot / 2, origin: 'player' },
      { stage: street, userId: bettor, action: 'raise', amount: pot * 2, origin },
      { stage: street, userId: caller, action: 'call', amount: pot * 1.5, origin: 'player' }
    );
  else
    actions.push(
      { stage: street, userId: caller, action: 'check', amount: 0, origin: 'player' },
      { stage: street, userId: bettor, action: 'bet', amount: pot * frac, origin },
      { stage: street, userId: caller, action: 'call', amount: pot * frac, origin: 'player' }
    );
  return omahaBetReadLearn({
    handKey: key,
    variant,
    mode: 'cash',
    actions,
    board: cards(board),
    shown: new Map([
      [bettor, cards(bettorCards)],
      [caller, cards(variant === 'plo4' ? '2c3d4h5s' : '2c3d4h5s6c')],
    ]),
    showdown: [
      { user_id: bettor, mucked: o.mucked === true },
      { user_id: caller, mucked: false },
    ],
    speed: o.speed,
  });
}

const BOARD5 = 'KhQs8d7c3h';
const AIR5 = 'Js9c6h5d2s';
const SET5 = 'KdKcAs4d2h';
const MID = 40 / 60;
function seed(
  speed: string,
  air: number,
  o: { horse?: boolean; street?: 'turn' | 'river' } = {}
): void {
  for (let i = 0; i < 30; i++)
    learnHand(`pop-${speed}-${i}`, 'plo5', `p${i}`, SET5, BOARD5, MID, {
      speed,
      street: o.street ?? 'river',
    });
  for (let i = 0; i < air; i++)
    learnHand(`v-${speed}-${i}`, 'plo5', VILLAIN, AIR5, BOARD5, MID, {
      speed,
      street: o.street ?? 'river',
      horse: o.horse,
    });
}

/** Heads-up river: villain bets `bet` into 60 after the turn checks through. */
function riverSpot(
  variant: string,
  hole: string,
  bet: number,
  speed: string | null,
  mode = 'cash'
) {
  const players = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: 370,
      bet: 0,
      totalInvested: 30,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    },
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 370 - bet,
      bet,
      totalInvested: 30 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: false,
    },
  ] as SeatPlayer[];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 15 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 13 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 15 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 15 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(BOARD5),
      pot: 60 + bet,
      currentBet: bet,
      toCall: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: 370,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: mode,
      bigBlind: 2,
      dealerSeat: 2,
      ...(speed ? { publicMemoryDomain: { speed } } : {}),
      actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
    },
  };
}
function decideMany(s: ReturnType<typeof riverSpot>, opts: Record<string, unknown>, seeds = 4) {
  const out: string[] = [];
  for (let k = 1; k <= seeds; k++) {
    seedFastRandom(k * 7919 + 33);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: true,
      ...opts,
    } as never);
    drainFires();
    out.push(JSON.stringify(d, (key, v) => (TIMING_KEYS.has(key) ? 0 : v)));
  }
  return out;
}
const CATCH5 = 'QhJd4c5s2d';

describe('omahaBetReadIsModeSplit (default OFF)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    omahaBetReadReset();
  });

  it('option OFF: byte-identical, with the per-opponent read on and off', () => {
    seed('lightning', 12);
    for (const speed of ['lightning', 'table', null]) {
      const s = riverSpot('plo5', CATCH5, 40, speed);
      expect(decideMany(s, { ...BASE, omahaBetReadIsModeSplit: false })).toEqual(
        decideMany(s, BASE)
      );
      const noRead = { omahaFacingBetEv: true };
      expect(decideMany(s, { ...noRead, omahaBetReadIsModeSplit: true })).toEqual(
        decideMany(s, noRead)
      );
    }
  });

  it('PLO6 and a tournament are byte-identical with the option on; PLO6 is never learned', () => {
    seed('lightning', 12);
    expect(
      learnHand('six', 'plo6', VILLAIN, 'Js9c6h5d2s3c', BOARD5, 1, { speed: 'lightning' })
    ).toBe(false);
    expect(omahaBetReadModeOf(VILLAIN, 'plo6', 'river', MID, false, 'x', 'lightning')).toBeNull();
    const six = riverSpot('plo6', 'QhJd4c5s2d9h', 40, 'lightning');
    expect(decideMany(six, ON)).toEqual(decideMany(six, { omahaFacingBetEv: true }));
    expect(decideMany(six, ON)).toEqual(decideMany(six, BASE));
    const t = riverSpot('plo5', CATCH5, 40, 'lightning', 'tournament');
    expect(decideMany(t, ON)).toEqual(decideMany(t, BASE));
  });

  it('the read is per mode: the Lightning air bettor is read lighter in Lightning than at a table', () => {
    seed('lightning', 12);
    // table persons' population so the table cell has a population too
    for (let i = 0; i < 30; i++)
      learnHand(`tp-${i}`, 'plo5', `t${i}`, SET5, BOARD5, MID, { speed: 'table', street: 'river' });
    const lt = omahaBetReadModeOf(VILLAIN, 'plo5', 'river', MID, false, 'x', 'lightning')!;
    const tb = omahaBetReadModeOf(VILLAIN, 'plo5', 'river', MID, false, 'x', 'table')!;
    expect(lt.modeSplit).toBe(true);
    expect(lt.source).toBe('person');
    const q0 = 0.15;
    const qL = omahaBetReadBluffShare(q0, lt);
    const qT = omahaBetReadBluffShare(q0, tb);
    expect(qL).toBeGreaterThan(q0);
    expect(qL).toBeGreaterThanOrEqual(qT);
    // his Lightning cell carries his own air; at the table only the shrinkage from his pooled cell reaches it
    expect(lt.shown - lt.value).toBeGreaterThan(tb.shown - tb.value);
    expect(tb.shown).toBeLessThanOrEqual(4 + 1e-9);
    // a hand without a known mode goes to the pooled rows only; the mode read needs a mode
    expect(omahaBetReadModeOf(VILLAIN, 'plo5', 'river', MID, false, 'x', null)).toBeNull();
    // the pooled read (CR2) is unchanged by the mode rows
    expect(omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false)!.shown).toBeGreaterThan(0);
  });

  it('the turn stab after a checked-through flop and the raise have their own cells', () => {
    seed('lightning', 12, { street: 'turn' });
    const stab = omahaBetReadModeOf(VILLAIN, 'plo5', 'turn', MID, false, 'x', 'lightning')!;
    expect(stab.line).toBe('x');
    expect(stab.shown).toBeGreaterThan(4);
    const barrel = omahaBetReadModeOf(VILLAIN, 'plo5', 'turn', MID, false, 'b', 'lightning')!;
    expect(barrel.shown).toBe(0);
    for (let i = 0; i < 6; i++)
      learnHand(`r-${i}`, 'plo5', VILLAIN, AIR5, BOARD5, MID, {
        speed: 'lightning',
        street: 'river',
        raise: true,
      });
    const rz = omahaBetReadModeOf(VILLAIN, 'plo5', 'river', MID, true, 'x', 'lightning')!;
    expect(rz.line).toBe('r');
    expect(rz.bets).toBeGreaterThan(5);
    expect(rz.beta).toBe(0);
  });

  it('the line of the bettor comes from the public action log', () => {
    const h = [
      { stage: 'flop', seat: 1, action: 'check', amount: 0 },
      { stage: 'flop', seat: 2, action: 'bet', amount: 5 },
    ];
    expect(omahaBetReadLineOf(h, 'turn', 2)).toBe('b');
    expect(omahaBetReadLineOf(h, 'turn', 1)).toBe('c');
    expect(
      omahaBetReadLineOf([{ stage: 'flop', seat: 1, action: 'check', amount: 0 }], 'turn', 2)
    ).toBe('x');
  });

  it('SOURCE LAW: no unshown card reaches the read', () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const mod = src('./HorseOmahaBetRead.ts');
    // the only card input of the module is the learner's `shown` map, gated by the showdown's not-mucked entry
    expect(mod).toMatch(/if \(!sd \|\| sd\.mucked === true\) return null;/);
    expect(mod).not.toMatch(/holeCardsAll|knownDeadCards|\.cards\b|hand_facts|ca_hand_facts/);
    // the mode read's signature carries no card
    const sig = mod.slice(
      mod.indexOf('export function omahaBetReadModeOf('),
      mod.indexOf('): OmahaBetRead | null {', mod.indexOf('export function omahaBetReadModeOf('))
    );
    expect(sig).not.toMatch(/Card|cards|hole/);
    // the senders: the mode is the hand's public speed; the cards are the revealed holdings only
    expect(src('./horseDecision/workerRuntime.ts')).toMatch(
      /speed: styleSpeedOf\(request\) \?\? null/
    );
    expect(src('../services/HorseExploitHydrator.ts')).toMatch(/row\.public_memory_domain\.speed/);
    expect(src('../services/HorseExploitHydrator.ts')).not.toMatch(/ca_hand_facts/);
    // the decision wiring passes ids, the street, the size, the line and the speed: never a card
    const logic = src('./HorseLogic.ts');
    const call = logic.slice(
      logic.indexOf('? omahaBetReadModeOf('),
      logic.indexOf(': omahaBetReadOf(', logic.indexOf('? omahaBetReadModeOf('))
    );
    expect(call).not.toMatch(/cards|knownDeadCards/);
  });

  it('shipped population constants: provenance, no player key, no player above 20% of a row', () => {
    expect(OMAHA_BET_READ_FREQ_SLOPE_PROVENANCE).toBe('population_all_cards_capped');
    expect(Object.keys(OMAHA_BET_READ_FREQ_SLOPE).sort()).toEqual(['river', 'turn']);
    for (const st of ['turn', 'river'] as const)
      expect(Object.keys(OMAHA_BET_READ_FREQ_SLOPE[st]).sort()).toEqual(['b', 'c', 'r', 'x']);
    expect(OMAHA_TURN_STAB_PROVENANCE).toBe('population_all_cards_capped');
    for (const s of [
      ...OMAHA_TURN_STAB_TOP_PLAYER_SHARE,
      ...OMAHA_TURN_STAB_LIGHTNING_TOP_PLAYER_SHARE,
    ])
      expect(s).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(OMAHA_BET_READ_TURN_REALIZATION).toEqual({ inPosition: 0.84, outOfPosition: 0.6 });
  });

  it('the same rule reads a Horse bettor', () => {
    seed('lightning', 12, { horse: true });
    expect(omahaBetReadModeOf(VILLAIN, 'plo5', 'river', MID, false, 'x', 'lightning')!.source).toBe(
      'person'
    );
  });

  it('with the option on in Lightning the mode-split read prices the decision (receipt)', () => {
    seed('lightning', 12);
    const s = riverSpot('plo5', CATCH5, 40, 'lightning');
    seedFastRandom(7);
    HorseMind.reset();
    drainFires();
    HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: true,
      ...ON,
    } as never);
    const fires = drainFires() as unknown as Record<string, number> | Map<string, number>;
    const has =
      fires instanceof Map
        ? fires.has('omaha_bet_read_mode_split_priced')
        : JSON.stringify(fires).includes('omaha_bet_read_mode_split_priced');
    expect(has).toBe(true);
  });
});
