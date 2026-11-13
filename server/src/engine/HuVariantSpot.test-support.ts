/**
 * Heads-up spots for the variants audit laws (HU-FL-001, HU-HILO-001), built
 * by the real HandController and decided by the real HorseLogic.decide with
 * the live Hybrid persona. Opponent cards never reach the policy.
 */
import type { Card, SeatPlayer } from '../types.js';
import { HandController } from './HandController.js';
import { Deck, calculateContestablePot } from './PokerEngine.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';

export const BB = 2;
export type Fmt = 'cash' | 'tournament';
const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
export const cards = (text: string): Card[] =>
  text
    .trim()
    .split(/\s+/)
    .map((c) => ({ rank: c[0] as Card['rank'], suit: SUIT[c[1] as keyof typeof SUIT] }));
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export interface Table {
  controller: HandController;
  variant: string;
  fmt: Fmt;
}
const uid = (seat: number) => `10000000-0000-4000-8000-00000000000${seat}`;
export function deal(o: {
  variant: string;
  fmt: Fmt;
  stacks: number[];
  prefix?: Card[];
  rnd?: () => number;
}): Table {
  const original = Deck.prototype.shuffle;
  Deck.prototype.shuffle = function () {
    const deck = (this as unknown as { cards: Card[] }).cards;
    if (o.prefix) {
      const rest = deck.filter(
        (c) => !o.prefix!.some((p) => p.rank === c.rank && p.suit === c.suit)
      );
      deck.splice(0, deck.length, ...o.prefix, ...rest);
    } else if (o.rnd) {
      deck.sort((a, b) => (a.rank + a.suit < b.rank + b.suit ? -1 : 1));
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(o.rnd() * (i + 1));
        const t = deck[i];
        deck[i] = deck[j];
        deck[j] = t;
      }
    }
  };
  const players = o.stacks.map((stack, i) => ({
    seat: i + 1,
    user_id: uid(i + 1),
    username: `P${i + 1}`,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  })) as SeatPlayer[];
  const controller = new HandController(
    {
      tableId: '20000000-0000-4000-8000-000000000001',
      handNumber: 1000001,
      gameVariant: o.variant,
      smallBlind: 1,
      bigBlind: BB,
      ante: 0,
      isTournament: o.fmt === 'tournament',
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as never,
    players,
    1
  );
  try {
    controller.start();
  } finally {
    Deck.prototype.shuffle = original;
  }
  return { controller, variant: o.variant, fmt: o.fmt };
}
export function menuOf(t: Table) {
  const actor = t.controller.getCurrentPlayer()!;
  return t.controller.getAuthoritativeActionState(actor.user_id)!;
}
export function decide(t: Table, seed: number) {
  const { controller, variant, fmt } = t;
  const state = controller.getState();
  const actor = controller.getCurrentPlayer()!;
  const menu = controller.getAuthoritativeActionState(actor.user_id)!;
  const hero = {
    ...actor,
    cards: actor.cards.map((c) => ({ ...c })),
    knownDeadCards: [],
  } as SeatPlayer;
  const gs = {
    stateSchemaVersion: 1,
    dealtSeatIds: state.players.filter((p) => p.cards.length > 0).map((p) => p.seat),
    blindSeats: controller.getBlindSeatsSnapshot(),
    ...controller.getChipRulesSnapshot(),
    heroSeat: actor.seat,
    currentPlayerSeat: actor.seat,
    legalActions: [...menu.legalActions],
    toCall: menu.toCall,
    minRaiseTo: menu.minRaiseTo,
    maxRaiseTo: menu.maxRaiseTo,
    bettingStructure: menu.structure,
    fixedBetSize: menu.fixedBetSize,
    fixedLimitSmallBet: controller.getFixedLimitSmallBet(),
    wagersCapped: menu.wagersCapped,
    pots: controller.computeLivePots(),
    contestablePot: calculateContestablePot(state.players, actor.user_id, menu.toCall),
    rakeConfig: controller.getRakeConfigSnapshot(),
    variantRules: horseVariantRulesFor(variant),
    players: state.players.map((p) => ({ ...p, knownDeadCards: undefined, cards: [] })),
    communityCards: [...state.communityCards],
    communityCards2: [],
    communityCards3: [],
    bombPot: false,
    boardCount: 1,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastRaise: state.lastRaise,
    stage: state.stage,
    gameVariant: variant,
    smallBlind: 1,
    bigBlind: BB,
    dealerSeat: state.dealerSeat,
    actionHistory: state.actionHistory.map((a, i) => ({ ...a, timestamp: i + 1 })),
    gameMode: fmt,
    format: fmt === 'cash' ? 'cash' : 'sng',
    ante: 0,
    straddleActive: false,
    ...(fmt === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            currentSmallBlind: 1,
            currentBigBlind: BB,
            currentAnte: 0,
            anteType: 'none',
            prizePoolCents: 10000,
            bountyPoolCents: 0,
            isPko: false,
            isBounty: false,
            isMysteryBounty: false,
            mysteryBountyStage: 'none',
            reentryOpen: false,
            rebuyOpen: false,
            addOnPeriodOpen: false,
            maxReentries: 0,
            maxRebuys: 0,
            reloadsUsed: 0,
            addOnTaken: false,
            rebuyAffordable: false,
            addOnAffordable: false,
            playersLeft: state.players.length,
            spotsPaid: 1,
            payoutPct: [100],
            stacks: state.players.map((p) => p.stack + p.totalInvested),
            stackByUser: Object.fromEntries(
              state.players.map((p) => [p.user_id, p.stack + p.totalInvested])
            ),
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  const prof = HORSE_HYBRID_PROFILES[fmt];
  HorseMind.reset();
  seedFastRandom(seed);
  const d = HorseLogic.decide(
    hero,
    gs,
    prof.style,
    { ...prof.mods },
    { mind: false, decisionTimeMs: Date.UTC(2026, 10, 13, 18, 0, 0) }
  );
  return { d, hero, gs, menu };
}
