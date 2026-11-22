/**
 * omahaBetReadIsPerOpponent (default OFF; EMERG lane CR2, 2026-11-20). Law:
 *  1. Option OFF: every decision is byte-identical to the default, whatever the read holds.
 *  2. PLO6 (and a tournament) decisions are byte-identical with the option on; PLO6 is never learned.
 *  3. An opponent whose shown first river bets of one size were mostly not value is called more in THAT cell
 *     and in no other (his other river size; the flop and a first turn bet are never read: lead's scope 12:22 AM).
 *  4. Below the minimum shown sample the price is the population prior exactly.
 *  5. No hidden card ever enters the read: only holdings the showdown lists as revealed (not mucked) are read,
 *     and the senders fill the learner from the revealed holdings only (source law).
 *  6. The same rule reads a Horse bettor.
 * Constructed cards only. The measured leak: LIVEGRADE CR-2 (PLO5 heads-up Nov 17-19; e.g. hands 60227067,
 * 60117459 by id only).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  OMAHA_BET_READ_MIN_SHOWN,
  omahaBetReadBluffShare,
  omahaBetReadLearn,
  omahaBetReadOf,
  omahaBetReadRatio,
  omahaBetReadReset,
  type OmahaBetReadAction,
} from './HorseOmahaBetRead.js';
import { omahaEvBluffShare, OMAHA_EV_UNKNOWN_READ } from './HorseOmahaFacingBetEv.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-00000000cr21';
const TIMING_KEYS = new Set(['latencyMs', 'elapsedMs', 'simulationMs', 'policyMs']);
const ON = { omahaFacingBetEv: true, omahaBetReadIsPerOpponent: true };
const BASE = { omahaFacingBetEv: true };

/** A completed hand: `bettor` makes the first turn bet of `frac` x pot and both show (or `bettor` mucks). */
function learnHand(
  key: string,
  variant: string,
  bettor: string,
  bettorCards: string,
  board: string,
  frac: number,
  opts: {
    mucked?: boolean;
    horse?: boolean;
    street?: 'turn' | 'river';
    mode?: 'cash' | 'tournament';
  } = {}
): boolean {
  const caller = `${bettor}-caller-${key}`;
  const street = opts.street ?? 'turn';
  const origin = opts.horse ? 'horse_policy' : 'player';
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
  actions.push(
    { stage: street, userId: caller, action: 'check', amount: 0, origin: 'player' },
    { stage: street, userId: bettor, action: 'bet', amount: pot * frac, origin },
    { stage: street, userId: caller, action: 'call', amount: pot * frac, origin: 'player' }
  );
  return omahaBetReadLearn({
    handKey: key,
    variant,
    mode: opts.mode ?? 'cash',
    actions,
    board: cards(board),
    shown: new Map([
      [bettor, cards(bettorCards)],
      [caller, cards(variant === 'plo4' ? '2c3d4h5s' : '2c3d4h5s6c')],
    ]),
    showdown: [
      { user_id: bettor, mucked: opts.mucked === true },
      { user_id: caller, mucked: false },
    ],
  });
}

const BOARD5 = 'KhQs8d7c3h';
const AIR5 = 'Js9c6h5d2s'; // nothing on Kh Qs 8d 7c 3h
const SET5 = 'KdKcAs4d2h'; // top set
const MID = 40 / 60;
/** The population: 30 persons whose mid-size river bets showed value; then the villain: `air` such bets shown as air. */
function seed(variant: string, air: number, opts: { horse?: boolean } = {}): void {
  for (let i = 0; i < 30; i++)
    learnHand(`pop-${variant}-${i}`, variant, `p${i}`, SET5, BOARD5, MID, { street: 'river' });
  for (let i = 0; i < air; i++)
    learnHand(`v-${variant}-${i}`, variant, VILLAIN, AIR5, BOARD5, MID, {
      ...opts,
      street: 'river',
    });
}

/** Heads-up: villain raised preflop, bet the flop (hero called), the turn checks through, hero checks the river and
 *  villain bets `bet` into 60. */
function turn(
  variant: string,
  hole: string,
  board: string,
  bet: number,
  mode = 'cash',
  horse = false
) {
  const potStart = 60;
  const pre = 15;
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
      is_horse: horse,
    },
  ] as SeatPlayer[];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: pre },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: pre - 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: pre },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: pre },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: potStart + bet,
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
      actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
    },
  };
}

function decideMany(s: ReturnType<typeof turn>, opts: Record<string, unknown>, seeds = 4) {
  const out: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 21);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: true,
      ...opts,
    } as never);
    drainFires();
    out.push(JSON.stringify(d, (k, v) => (TIMING_KEYS.has(k) ? 0 : v)));
  }
  return out;
}
const actionOf = (json: string): string => (JSON.parse(json) as { action: string }).action;

// A bluff catcher on Kh Qs 8d 7c 3h: one pair of queens, facing a two-thirds-pot river bet.
const CATCH5 = 'QhJd4c5s2d';
const TURN = BOARD5;

describe('omahaBetReadIsPerOpponent (default OFF)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    omahaBetReadReset();
  });

  it('the read: a mostly-air bettor in one cell has a share above the prior there and the prior elsewhere', () => {
    seed('plo5', 10);
    const mid = omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false)!;
    expect(mid.source).toBe('person');
    expect(omahaBetReadRatio(0.15, mid)).toBeGreaterThan(1.5);
    // his big river bets and his later-barrel river bets have no evidence: the prior exactly
    expect(omahaBetReadBluffShare(0.19, omahaBetReadOf(VILLAIN, 'plo5', 'river', 1, false))).toBe(
      0.19
    );
    expect(
      omahaBetReadBluffShare(0.15, omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false, true))
    ).toBe(0.15);
    // a raise, the flop and a first turn bet are never read
    expect(omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, true)).toBeNull();
    expect(omahaBetReadOf(VILLAIN, 'plo5', 'flop', MID, false)).toBeNull();
    expect(omahaBetReadOf(VILLAIN, 'plo5', 'turn', MID, false)).toBeNull();
  });

  it('below the minimum shown sample the price is the population prior exactly', () => {
    seed('plo5', OMAHA_BET_READ_MIN_SHOWN - 1);
    const r = omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false)!;
    expect(r.source).toBe('population');
    for (const q0 of [0.13, 0.15, 0.19]) {
      expect(omahaBetReadBluffShare(q0, r)).toBe(q0);
      expect(omahaEvBluffShare(q0, { ...OMAHA_EV_UNKNOWN_READ, betRead: r }, 'river')).toBe(q0);
    }
  });

  it('no hidden card enters: a mucked or unlisted holding is never read as shown', () => {
    for (let i = 0; i < 30; i++)
      learnHand(`pm-${i}`, 'plo5', `p${i}`, SET5, BOARD5, MID, { street: 'river' });
    for (let i = 0; i < 10; i++)
      learnHand(`m-${i}`, 'plo5', VILLAIN, AIR5, BOARD5, MID, { mucked: true, street: 'river' });
    const r = omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false)!;
    expect(r.bets).toBeGreaterThan(9);
    expect(r.shown).toBe(0);
    expect(r.source).toBe('population');
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    // the learner reads cards only from `shown`, gated by the showdown list's not-mucked entry
    const mod = src('./HorseOmahaBetRead.ts');
    expect(mod).toMatch(/if \(!sd \|\| sd\.mucked === true\) return null;/);
    expect(mod).not.toMatch(/holeCardsAll|knownDeadCards|\.cards\b/);
    // the senders fill it from the revealed holdings only
    expect(src('../services/supabase/handHistory.ts')).toMatch(/betReadShown: holeCardsPayload/);
    expect(src('../lightning/LightningHandHost.ts')).toMatch(
      /if \(!this\.isMucked\(sd\.userId\) && sd\.holeCards\?\.length\) shown\[sd\.userId\] = sd\.holeCards;/
    );
    // the boot rebuild reads hand_history.hole_cards (revealed holdings only)
    expect(src('../services/HorseExploitHydrator.ts')).toMatch(/hydrateOmahaBetRead\(/);
  });

  it('PLO6, a tournament and a bomb pot are never learned', () => {
    expect(learnHand('six', 'plo6', VILLAIN, 'Js9c6h5d2s3c', BOARD5, 1)).toBe(false);
    expect(learnHand('t', 'plo5', VILLAIN, AIR5, BOARD5, 1, { mode: 'tournament' })).toBe(false);
    expect(omahaBetReadOf(VILLAIN, 'plo6', 'river', MID, false)).toBeNull();
  });

  it('option OFF: the decision is the default whatever the read holds', () => {
    seed('plo5', 12);
    const s = turn('plo5', CATCH5, TURN, 40);
    expect(decideMany(s, { ...BASE, omahaBetReadIsPerOpponent: false })).toEqual(
      decideMany(s, BASE)
    );
  });

  it('the air bettor is called more in that cell, and in no other', () => {
    seed('plo5', 12);
    const s = turn('plo5', CATCH5, TURN, 40);
    const off = decideMany(s, BASE).map(actionOf);
    const on = decideMany(s, ON).map(actionOf);
    expect(off.every((a) => a === 'fold')).toBe(true);
    expect(on.some((a) => a === 'call')).toBe(true);
    // his pot-size river bet: no evidence in that cell, the decision is unchanged
    const big = turn('plo5', CATCH5, TURN, 60);
    expect(decideMany(big, ON)).toEqual(decideMany(big, BASE));
  });

  it('the same rule reads a Horse bettor', () => {
    seed('plo5', 12, { horse: true });
    expect(omahaBetReadOf(VILLAIN, 'plo5', 'river', MID, false)!.source).toBe('person');
    const s = turn('plo5', CATCH5, TURN, 40, 'cash', true);
    const on = decideMany(s, ON).map(actionOf);
    expect(on.some((a) => a === 'call')).toBe(true);
  });

  it('PLO6 and a tournament are byte-identical with the option on', () => {
    seed('plo5', 12);
    const six = turn('plo6', 'QhJd4c5s2d9h', TURN, 40);
    expect(decideMany(six, ON)).toEqual(decideMany(six, BASE));
    const t = turn('plo5', CATCH5, TURN, 40, 'tournament');
    expect(decideMany(t, ON)).toEqual(decideMany(t, BASE));
  });
});
