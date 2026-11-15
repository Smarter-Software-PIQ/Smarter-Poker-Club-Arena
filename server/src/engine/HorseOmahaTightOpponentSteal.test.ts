/**
 * OMAHA TIGHT STEAL (omahaTightOpponentSteal, default OFF; owner ruling
 * 2026-11-14 17:42 Chicago: the Omaha tight requirement stays and a
 * defensible response must be built and evaluated).
 *
 * The STEAL half of omahaTightOpponent alone, in the variants of
 * OMAHA_TIGHT_STEAL_VARIANTS (six-card Omaha only today). The
 * respect half is excluded: measured alone on six-card it is undecided with a
 * negative cash point estimate (PLO6 audit archive,
 * phase1-play/tight-plo6-league). Fixed four-handed spots and seeds, built
 * like HorseOmahaTightOpponent.law.test.ts:
 *  - absent, false and a non-boolean truthy value decide byte-identically;
 *  - on, six-card, the button first in with both blinds PROVEN tight folders
 *    opens a hand it folds otherwise, with plo_tight_blinds_steal;
 *  - on, the respect spot (a proven tight raiser faced) decides exactly as off,
 *    although omahaTightOpponent itself flats that hand: no respect;
 *  - on, one unknown blind left to act stops the steal;
 *  - on, five-card Omaha is unchanged (the steal there is omahaTightOpponent's).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import {
  HorseLogic,
  OMAHA_TIGHT_STEAL_VARIANTS,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < spec.length; i += 2)
    out.push({ rank: spec[i] as CardRank, suit: SUIT[spec[i + 1]] });
  return out;
};
const HERO = '86000000-0000-4000-8000-000000000007';
/** button in the respect spot, big blind in the steal spot */
const RAISER = '40000000-0000-4000-8000-0000000000a1';
/** small blind in both spots */
const SB = '40000000-0000-4000-8000-0000000000b2';
/** the under-the-gun seat, folded in both spots */
const UTG = '40000000-0000-4000-8000-0000000000c3';
const TABLE = 4;
const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005];

const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
    ...over,
  }) as SeatPlayer;

type Kind =
  | 'unknown'
  | 'sparse'
  | 'tight'
  | 'loose_passive'
  | 'maniac'
  | 'average'
  | 'tight_then_raising';

/** One preflop action per hand: raise on `raiseEvery`, call on `callEvery`, else fold. */
function playHands(
  userId: string,
  variant: string,
  hands: number,
  tag: string,
  act: (h: number) => 'raise' | 'call' | 'fold'
): void {
  const scope = readScopeOf(variant, TABLE);
  for (let h = 0; h < hands; h++) {
    const a = act(h);
    const acts = [
      {
        stage: 'preflop',
        seat: 3,
        userId,
        action: a,
        amount: a === 'raise' ? 7 : a === 'call' ? 2 : 0,
        ...(a === 'raise' ? { isFullRaise: true } : {}),
        origin: 'player',
        timestamp: h * 10 + 1,
      },
    ] as unknown as ActionRecord[];
    HorseMind.observeHandComplete(`${tag}:${variant}:${h}`, acts, 2, null, scope);
  }
}
const tightAct = (h: number) => (h % 25 === 0 ? 'raise' : 'fold');
function remember(userId: string, kind: Kind, variant: string): void {
  if (kind === 'sparse') playHands(userId, variant, 8, `${userId}:s`, tightAct);
  if (kind === 'tight') playHands(userId, variant, 200, `${userId}:t`, tightAct);
  // limps four hands in five, never raises
  if (kind === 'loose_passive')
    playHands(userId, variant, 200, `${userId}:lp`, (h) => (h % 5 === 0 ? 'fold' : 'call'));
  if (kind === 'maniac')
    playHands(userId, variant, 200, `${userId}:m`, (h) => (h % 5 < 3 ? 'raise' : 'call'));
  // raises one hand in four, plays one in three: a Horse-like player
  if (kind === 'average')
    playHands(userId, variant, 200, `${userId}:a`, (h) =>
      h % 4 === 0 ? 'raise' : h % 12 === 1 ? 'call' : 'fold'
    );
  if (kind === 'tight_then_raising') {
    playHands(userId, variant, 200, `${userId}:t`, tightAct);
    playHands(userId, variant, 12, `${userId}:r`, (h) => (h % 2 === 0 ? 'raise' : 'fold'));
  }
}

interface Spot {
  variant: string;
  kind: 'respect' | 'steal';
  hole: string;
}
/** The big blind faces a pot-sized button open; UTG and the small blind folded. */
function respectGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(2, HERO, s.hole, { bet: 2, totalInvested: 2, stack: 198, is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199, is_folded: true }),
      hero,
      seat(3, UTG, '', { is_folded: true }),
      seat(4, RAISER, '', { bet: 7, totalInvested: 7, stack: 193 }),
    ],
    communityCards: [],
    pot: 10,
    currentBet: 7,
    toCall: 5,
    minRaise: 5,
    minRaiseTo: 12,
    maxRaiseTo: 24,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
      {
        stage: 'preflop',
        seat: 4,
        userId: RAISER,
        action: 'raise',
        amount: 7,
        isFullRaise: true,
        timestamp: 4,
      },
      { stage: 'preflop', seat: 1, userId: SB, action: 'fold', amount: 0, timestamp: 5 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}
/** The button is first in after UTG folds; both blinds are left to act. */
function stealGs(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(4, HERO, s.hole, { is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 199 }),
      seat(2, RAISER, '', { bet: 2, totalInvested: 2, stack: 198 }),
      seat(3, UTG, '', { is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 3,
    currentBet: 2,
    toCall: 2,
    minRaise: 2,
    minRaiseTo: 4,
    maxRaiseTo: 7,
    legalActions: ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: s.variant === 'nlh' ? 'no_limit' : 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: UTG, action: 'fold', amount: 0, timestamp: 3 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The whole decision, with only wall-clock timings (latencyMs, elapsedMs) removed. */
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Outcome {
  decisions: string[];
  actions: string[];
  fires: Set<string>;
}
function play(
  s: Spot,
  kinds: Partial<Record<'raiser' | 'sb' | 'utg', Kind>>,
  opts: HorseDecideOpts
): Outcome {
  const decisions: string[] = [];
  const actions: string[] = [];
  const fires = new Set<string>();
  enableBrainTelemetry();
  for (const seed of SEEDS) {
    HorseMind.reset();
    remember(RAISER, kinds.raiser ?? 'unknown', s.variant);
    remember(SB, kinds.sb ?? 'unknown', s.variant);
    remember(UTG, kinds.utg ?? 'unknown', s.variant);
    drainFires();
    seedFastRandom(seed);
    const { hero, gs } = s.kind === 'respect' ? respectGs(s) : stealGs(s);
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
    decisions.push(decisionBytes(d));
    actions.push(d.action);
    for (const f of drainFires()) if (/^plo_tight_/.test(f.feature)) fires.add(f.feature);
  }
  return { decisions, actions, fires };
}
const ON: HorseDecideOpts = { omahaTightOpponentSteal: true };
const OFF: HorseDecideOpts = {};
const STEAL_HANDS = ['Qh7s8d5h3c2d', 'QdJc8h6s4c3d'];
/** omahaTightOpponent flats this hand against a proven tight raiser; this option must not. */
const RESPECT_HAND = 'KdQdJsTs9c8h';
const TIGHT_BLINDS = { raiser: 'tight', sb: 'tight' } as const;

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaTightOpponentSteal', () => {
  it('scope: the variant list is six-card Omaha only; widening it needs its own evaluation', () => {
    expect([...OMAHA_TIGHT_STEAL_VARIANTS]).toEqual(['plo6']);
  });

  it('off: absent, false or a non-boolean truthy value decide byte-identically, nothing fires', () => {
    for (const hole of [...STEAL_HANDS, RESPECT_HAND]) {
      for (const kind of ['steal', 'respect'] as const) {
        const s: Spot = { variant: 'plo6', kind, hole };
        const table = kind === 'steal' ? TIGHT_BLINDS : ({ raiser: 'tight' } as const);
        const absent = play(s, table, OFF);
        for (const opts of [
          { omahaTightOpponentSteal: false },
          { omahaTightOpponentSteal: 1 as unknown as boolean },
        ]) {
          const o = play(s, table, opts);
          expect(o.decisions, `${kind} ${hole}`).toEqual(absent.decisions);
          expect([...o.fires]).toEqual([]);
        }
        expect([...absent.fires]).toEqual([]);
      }
    }
  });

  it('on: six-card first in against two proven tight blinds opens what it folds off', () => {
    for (const hole of STEAL_HANDS) {
      const s: Spot = { variant: 'plo6', kind: 'steal', hole };
      const off = play(s, TIGHT_BLINDS, OFF);
      const on = play(s, TIGHT_BLINDS, ON);
      expect(new Set(off.actions), hole).toEqual(new Set(['fold']));
      expect(new Set(on.actions), hole).toEqual(new Set(['raise']));
      expect([...on.fires], hole).toEqual(['plo_tight_blinds_steal']);
    }
  });

  it('on: no respect half, the proven tight raiser spot decides exactly as off', () => {
    const s: Spot = { variant: 'plo6', kind: 'respect', hole: RESPECT_HAND };
    const table = { raiser: 'tight' } as const;
    const off = play(s, table, OFF);
    const on = play(s, table, ON);
    const full = play(s, table, { omahaTightOpponent: true });
    // non-vacuity: the full option does respect at this node
    expect(new Set(off.actions)).toEqual(new Set(['raise']));
    expect(new Set(full.actions)).toEqual(new Set(['call']));
    expect(on.decisions).toEqual(off.decisions);
    expect([...on.fires]).toEqual([]);
  });

  it('on: one unknown blind left to act stops the steal', () => {
    for (const table of [
      { raiser: 'tight', sb: 'unknown' },
      { raiser: 'unknown', sb: 'tight' },
    ] as const) {
      const s: Spot = { variant: 'plo6', kind: 'steal', hole: STEAL_HANDS[0] };
      const off = play(s, table, OFF);
      const on = play(s, table, ON);
      expect(on.decisions).toEqual(off.decisions);
      expect([...on.fires]).toEqual([]);
    }
  });

  it('on: five-card Omaha is unchanged', () => {
    const s: Spot = { variant: 'plo5', kind: 'steal', hole: 'Jh4c2cKcTh' };
    const off = play(s, TIGHT_BLINDS, OFF);
    const on = play(s, TIGHT_BLINDS, ON);
    // non-vacuity: omahaTightOpponent steals this five-card hand
    expect(new Set(play(s, TIGHT_BLINDS, { omahaTightOpponent: true }).actions)).toEqual(
      new Set(['raise'])
    );
    expect(on.decisions).toEqual(off.decisions);
    expect([...on.fires]).toEqual([]);
  });
});
