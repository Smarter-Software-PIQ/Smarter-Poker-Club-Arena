import { describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { HORSE_FEATURE_FLAGS } from './HorseFeatureAuthority.js';
import {
  holdemPremiumAggressionVerdict,
  legalMenu,
  type HoldemPremiumInput,
} from './HorseHoldemPremiumAggression.js';
import type { Card, SeatPlayer } from '../types.js';

/**
 * Dan 2026-10-25, "THE ONE HORSE SHOULD BE FOLDING TO A HUGE THREE BET WITH
 * KQO". The documented scope (HorseHoldemPremiumAggression rule 1, changelog
 * 2026-10-26): no-limit hold'em, cash and tournaments, every horse; facing a
 * 3-bet or more at least 2.5x the level it raised, deeper than 20bb effective
 * against the raiser, at a price of 15% or more, an offsuit unpaired hand
 * other than AKo folds; an opener may also continue AQo, a cold caller folds
 * it. Out of scope: 20bb effective or less (push/fold), a raiser read as a
 * maniac, and the hero's own 4-bet re-raised.
 *
 * 2026-11-07: with no legal-action menu in the state (the league, the
 * preflop audit, any offline caller) the rule read an empty menu and stood
 * aside, so a heads-up opener called a 3-bet to 8bb at 80bb with KQo, AJo
 * and ATo. This pins the rule through the whole brain, with the
 * controller's menu and without it, every table size and depth it covers.
 */

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const hole = (cls: string, k: number): Card[] => [
  { rank: cls[0] as Card['rank'], suit: SUITS[k % 4] },
  { rank: cls[1] as Card['rank'], suit: SUITS[(k + 1) % 4] },
];
const DOMINATED = ['KQo', 'AJo', 'ATo', 'KJo', 'QJo', 'A5o'];
const BB = 2;
const FLAGS_OFF = Object.fromEntries(HORSE_FEATURE_FLAGS.map((k: string) => [k, false]));

interface Spot {
  dealt: number;
  depthBB: number;
  mode: 'cash' | 'tournament';
  menu: boolean;
  /** The opener faces the 3-bet, or a third seat faces it cold. */
  hero: 'opener' | 'cold';
  cls: string;
  combo: number;
  openTo?: number;
  threeBetTo?: number;
}

/**
 * Seats 1..dealt, the button on seat 1 (heads-up the button is the small
 * blind). Opener: heads-up the small blind, otherwise the first seat to act;
 * the big blind 3-bets. Cold: three-handed the button opens, the small blind
 * 3-bets and the big blind is the hero; four or more, the first seat opens,
 * the next 3-bets and the button faces it cold.
 */
function build(s: Spot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const d = s.dealt;
  const stack = s.depthBB * BB;
  const ante = s.mode === 'tournament' ? BB : 0;
  const sbSeat = d === 2 ? 1 : 2;
  const bbSeat = d === 2 ? 2 : 3;
  const actOrder: number[] = [];
  if (d === 2) actOrder.push(1, 2);
  else {
    for (let k = 4; k <= d; k++) actOrder.push(k);
    actOrder.push(1, 2, 3);
  }
  let opener: number;
  let threeBettor: number;
  let heroSeat: number;
  if (s.hero === 'opener') {
    opener = actOrder[0];
    threeBettor = bbSeat;
    heroSeat = opener;
  } else if (d === 3) {
    opener = 1;
    threeBettor = 2;
    heroSeat = 3;
  } else {
    opener = actOrder[0];
    threeBettor = actOrder[1];
    heroSeat = 1;
  }
  const players: SeatPlayer[] = [];
  for (let n = 1; n <= d; n++) {
    players.push({
      seat: n,
      user_id: `00000000-0000-4000-a000-00000000000${n}`.slice(-36),
      username: `p${n}`,
      stack,
      bet: 0,
      totalInvested: 0,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      cards: n === heroSeat ? hole(s.cls, s.combo) : [],
    } as SeatPlayer);
  }
  const at = (n: number) => players[n - 1];
  let pot = 0;
  const put = (n: number, amount: number) => {
    const p = at(n);
    p.stack -= amount;
    p.bet += amount;
    p.totalInvested += amount;
    pot += amount;
  };
  put(sbSeat, BB / 2);
  put(bbSeat, BB);
  if (ante > 0) {
    at(bbSeat).stack -= ante;
    pot += ante;
  }
  const history: HorseGameStateV2['actionHistory'] = [];
  let ts = 1_700_000_000_000;
  const openTo = s.openTo ?? 2.5 * BB;
  const threeBetTo = s.threeBetTo ?? 8 * BB;
  for (const n of actOrder) {
    if (n === opener) {
      put(n, openTo - at(n).bet);
      history!.push({
        seat: n,
        userId: at(n).user_id,
        action: 'raise',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
      } as never);
      break;
    }
    at(n).is_folded = true;
    history!.push({
      seat: n,
      userId: at(n).user_id,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as never);
  }
  const after = actOrder.slice(actOrder.indexOf(opener) + 1);
  for (const n of after) {
    if (n === threeBettor) {
      put(n, threeBetTo - at(n).bet);
      history!.push({
        seat: n,
        userId: at(n).user_id,
        action: 'raise',
        amount: threeBetTo,
        timestamp: ts++,
        stage: 'preflop',
      } as never);
      break;
    }
    if (n === heroSeat) continue;
    at(n).is_folded = true;
    history!.push({
      seat: n,
      userId: at(n).user_id,
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as never);
  }
  const hero = at(heroSeat);
  const toCall = threeBetTo - hero.bet;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet: threeBetTo,
    minRaise: threeBetTo - openTo,
    lastRaise: threeBetTo - openTo,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: 1,
    actionHistory: history,
    gameMode: s.mode,
    ante,
    format: s.mode === 'tournament' ? 'mtt' : 'cash',
    ...(s.mode === 'tournament'
      ? {
          bigBlindAnte: true,
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 180,
            spotsPaid: 30,
            entrants: 300,
            avgStackChips: stack,
            medianStackChips: stack,
            seatsPerTable: d,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: BB / 2,
            currentBigBlind: BB,
            currentAnte: ante,
            anteType: 'big_blind',
            nextSmallBlind: BB,
            nextBigBlind: 2 * BB,
            nextAnte: 2 * ante,
            nextBlindInMin: 10,
          },
        }
      : {}),
    ...(s.menu
      ? {
          stateSchemaVersion: 1,
          toCall,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          minRaiseTo: threeBetTo + (threeBetTo - openTo),
          maxRaiseTo: hero.stack + hero.bet,
        }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

function decide(s: Spot, seed: number): string {
  const { hero, gs } = build(s);
  const persona =
    s.mode === 'tournament' ? HORSE_HYBRID_PROFILES.tournament : HORSE_HYBRID_PROFILES.cash;
  seedFastRandom(seed);
  const sandbox = HorseMind.createSandbox();
  const d = HorseMind.runInSandbox(sandbox, () =>
    HorseLogic.decide(
      hero,
      gs,
      persona.style,
      { ...persona.mods },
      {
        ...FLAGS_OFF,
        decisionTimeMs: seed * 1000,
        observeMind: false,
      }
    )
  );
  return d.action;
}

const TABLES = [2, 3, 6, 9];
const DEPTHS = [25, 40, 80, 150];
const MODES = ['cash', 'tournament'] as const;

describe('a dominated offsuit hand folds to a big 3-bet (Dan 2026-10-25)', () => {
  for (const menu of [true, false]) {
    for (const dealt of TABLES) {
      it(`${dealt}-handed opener, menu ${menu ? 'given' : 'absent'}: every depth past 20bb, cash and tournament`, () => {
        const wrong: string[] = [];
        for (const depthBB of DEPTHS)
          for (const mode of MODES)
            for (const cls of DOMINATED)
              for (const seed of [3, 11]) {
                const a = decide(
                  { dealt, depthBB, mode, menu, hero: 'opener', cls, combo: seed },
                  seed
                );
                if (a !== 'fold') wrong.push(`${mode} ${depthBB}bb ${cls} seed ${seed}: ${a}`);
              }
        expect(wrong).toEqual([]);
      });
      if (dealt >= 3)
        it(`${dealt}-handed cold caller, menu ${menu ? 'given' : 'absent'}: AQo folds too`, () => {
          const wrong: string[] = [];
          for (const depthBB of DEPTHS)
            for (const mode of MODES)
              for (const cls of [...DOMINATED, 'AQo'])
                for (const seed of [5]) {
                  const a = decide(
                    { dealt, depthBB, mode, menu, hero: 'cold', cls, combo: seed },
                    seed
                  );
                  if (a !== 'fold') wrong.push(`${mode} ${depthBB}bb ${cls}: ${a}`);
                }
          expect(wrong).toEqual([]);
        });
    }
  }

  it('the heads-up opener the audit found calling (80bb, 3-bet to 8bb) folds KQo, AJo and ATo', () => {
    for (const cls of ['KQo', 'AJo', 'ATo'])
      for (let k = 0; k < 12; k++)
        expect(
          decide(
            { dealt: 2, depthBB: 80, mode: 'cash', menu: false, hero: 'opener', cls, combo: k },
            100 + k
          )
        ).toBe('fold');
  });

  // The rule's own scope, read at the verdict so the brain's choice is not
  // mistaken for the rule's.
  const verdictOf = (s: Spot, action = 'call') => {
    const { hero, gs } = build(s);
    const input: HoldemPremiumInput = {
      gameVariant: 'nlh',
      multiBoard: false,
      stage: 'preflop',
      board: [],
      hero,
      players: gs.players,
      pot: gs.pot,
      currentBet: gs.currentBet,
      bigBlind: gs.bigBlind,
      toCall: gs.toCall,
      legalActions: gs.legalActions,
      minRaiseTo: gs.minRaiseTo,
      maxRaiseTo: gs.maxRaiseTo,
      lastRaise: gs.lastRaise,
      actionHistory: gs.actionHistory as never,
      chipUnit: 0.01,
    };
    return holdemPremiumAggressionVerdict({ action }, input)?.rule ?? null;
  };
  const base: Spot = {
    dealt: 6,
    depthBB: 80,
    mode: 'cash',
    menu: false,
    hero: 'opener',
    cls: 'KQo',
    combo: 0,
  };

  it('an opener keeps AKo and AQo; a cold caller keeps AKo only', () => {
    for (const menu of [true, false]) {
      expect(verdictOf({ ...base, menu, cls: 'AKo' })).not.toBe('dominated_3bet_fold');
      expect(verdictOf({ ...base, menu, cls: 'AQo' })).toBeNull();
      expect(verdictOf({ ...base, menu, cls: 'KQo' })).toBe('dominated_3bet_fold');
      expect(verdictOf({ ...base, menu, hero: 'cold', cls: 'AQo' })).toBe('dominated_3bet_fold');
      expect(verdictOf({ ...base, menu, hero: 'cold', cls: 'AKo' })).not.toBe(
        'dominated_3bet_fold'
      );
    }
  });

  it('stands aside at 20bb effective or less and under a 2.5x re-raise', () => {
    for (const menu of [true, false]) {
      expect(verdictOf({ ...base, menu, depthBB: 20 })).toBeNull();
      expect(verdictOf({ ...base, menu, depthBB: 21 })).toBe('dominated_3bet_fold');
      // 2.5bb open, 3-bet to 6bb: 2.4x, not "huge".
      expect(verdictOf({ ...base, menu, threeBetTo: 6 * BB })).toBeNull();
      expect(verdictOf({ ...base, menu, threeBetTo: 6.25 * BB })).toBe('dominated_3bet_fold');
    }
  });

  it('an absent menu derives the table menu; a given menu is the authority', () => {
    const { hero, gs } = build(base);
    const derived = legalMenu({
      gameVariant: 'nlh',
      multiBoard: false,
      stage: 'preflop',
      board: [],
      hero,
      players: gs.players,
      pot: gs.pot,
      currentBet: gs.currentBet,
      bigBlind: gs.bigBlind,
      lastRaise: gs.lastRaise,
    });
    expect([...derived.legal].sort()).toEqual(['all_in', 'call', 'fold', 'raise']);
    expect(derived.minTo).toBe(16 + 11);
    expect(derived.maxTo).toBe(160);
    const given = legalMenu({
      gameVariant: 'nlh',
      multiBoard: false,
      stage: 'preflop',
      board: [],
      hero,
      players: gs.players,
      pot: gs.pot,
      currentBet: gs.currentBet,
      bigBlind: gs.bigBlind,
      legalActions: ['fold', 'all_in'],
      minRaiseTo: null,
      maxRaiseTo: 160,
    });
    expect([...given.legal].sort()).toEqual(['all_in', 'fold']);
    expect(given.minTo).toBeNull();
  });
});
