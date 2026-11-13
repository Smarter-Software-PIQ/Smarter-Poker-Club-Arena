/**
 * Arbiter order through decide() on a real controller state (2026-11-13): on a tournament bubble the Phase 7 utility
 * arbiter evaluates the decision the style read shaped, and when it overrides, its action is what is committed.
 */
import { describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { calculateContestablePot } from './PokerEngine.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { VILLAIN, VILLAINS, cards } from './HorseOpponentStyle.contexts.test-support.js';

const HERO = 'aaaaaaaa-0000-4000-8000-000000000001';
const SHORT = ['eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000004'];

/** 4 left, 3 paid, one table: villain (big stack) opens UTG, hero in the big blind with KhJd. */
export function bubbleOpen(
  heroBB: number,
  villainBB: number,
  shortBB: number,
  heroCards = 'KhJd',
  openBB = 3
) {
  const bb = 100;
  const ids = [SHORT[0], SHORT[1], HERO, VILLAIN];
  const stacks = [shortBB, shortBB, heroBB, villainBB].map((x) => x * bb);
  const players = ids.map((id, i) => ({
    seat: i + 1,
    user_id: id,
    username: `p${i + 1}`,
    stack: stacks[i],
    bet: 0,
    totalInvested: 0,
    cards: [] as any[],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: id !== VILLAIN,
  }));
  const config: any = {
    tableId: 'arb',
    handNumber: 1,
    gameVariant: 'nlh',
    isTournament: true,
    smallBlind: bb / 2,
    bigBlind: bb,
    ante: 0,
    rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
  };
  // dealer seat 1: SB seat 2, BB seat 3 (hero), UTG seat 4 (villain)
  const c = new HandController(config, players as any, 1);
  const deck = [
    ...cards('2c7d'),
    ...cards('3s8h'),
    ...cards(heroCards),
    ...cards('AsQs'),
    ...cards('9c5h4dTsQh'),
    ...cards('2d3d4c5c6c7c8c9d'),
  ];
  const inst = c.getState().deck as any;
  inst.deal = (n = 1) => deck.splice(0, n);
  inst.dealOne = () => inst.deal(1)[0];
  inst.remaining = () => deck.length;
  inst.getRemainingCards = () => deck.slice();
  c.start();
  let state = c.getState();
  const actAs = (uid: string, action: string, amount?: number) => {
    const p = c.getState().players.find((x: any) => x.user_id === uid)!;
    expect(c.performAction(p.seat, action as never, amount)).toBe(true);
  };
  actAs(VILLAIN, 'raise', openBB * bb);
  actAs(SHORT[0], 'fold');
  actAs(SHORT[1], 'fold');
  state = c.getState();
  const hero = state.players.find((p: any) => p.user_id === HERO)!;
  const menu = c.getAuthoritativeActionState(HERO)!;
  const field = state.players.map((p: any) => p.stack + p.totalInvested);
  const t = {
    schemaVersion: 1,
    contextStatus: 'complete',
    contextIssues: [],
    format: 'mtt',
    tournamentType: 'mtt',
    tournamentStatus: 'running',
    gameVariant: 'nlh',
    tournamentId: 'arb',
    sourceAgeMs: 0,
    entrants: 18,
    playersLeft: 4,
    spotsPaid: 3,
    payoutPct: [50, 30, 20],
    stacks: field,
    stackByUser: Object.fromEntries(
      state.players.map((p: any) => [p.user_id, p.stack + p.totalInvested])
    ),
    avgStackChips: field.reduce((a: number, b: number) => a + b, 0) / 4,
    currentSmallBlind: bb / 2,
    currentBigBlind: bb,
    currentAnte: 0,
    anteType: 'big_blind',
    seatsPerTable: 9,
    currentLevel: 8,
    finalTable: true,
    inMoney: false,
    nearBubble: true,
    startingStackChips: 3000,
    prizePoolCents: 1800,
    prizePoolFinalized: true,
    bountyPoolCents: 0,
    bountyFactor: 0,
    rebuyOpen: false,
    rebuyAllowed: false,
    reentryOpen: false,
    registrationOpen: false,
    lateRegistrationOpen: false,
    addOnAvailable: false,
  };
  const gs: any = {
    players: state.players.map((p: any) => ({ ...p, cards: p.user_id === HERO ? p.cards : [] })),
    communityCards: state.communityCards,
    pot: state.pot,
    currentBet: state.currentBet,
    stage: state.stage,
    minRaise: state.minRaise,
    lastRaise: state.lastRaise,
    dealerSeat: state.dealerSeat,
    stateSchemaVersion: 1,
    heroSeat: hero.seat,
    currentPlayerSeat: hero.seat,
    gameMode: 'tournament',
    format: 'mtt',
    gameVariant: 'nlh',
    bigBlind: bb,
    smallBlind: bb / 2,
    ante: 0,
    boardCount: 1,
    legalActions: menu.legalActions,
    toCall: menu.toCall,
    minRaiseTo: menu.minRaiseTo,
    maxRaiseTo: menu.maxRaiseTo,
    bettingStructure: menu.structure,
    pots: c.computeLivePots(),
    contestablePot: calculateContestablePot(state.players, HERO, menu.toCall),
    variantRules: horseVariantRulesFor('nlh'),
    rakeConfig: config.rakeConfig,
    tournament: t,
    actionHistory: state.actionHistory.map((a: any, i: number) => ({ ...a, timestamp: 1000 + i })),
  };
  return { hero, gs };
}

export function decideBubble(
  heroBB: number,
  villainBB: number,
  shortBB: number,
  on: boolean,
  heroCards?: string,
  openBB?: number
) {
  HorseMind.reset();
  const v = VILLAINS.grinder!;
  HorseMind.importStats([{ user_id: VILLAIN, ...v.stats }]);
  HorseMind.importDurableOpponentProfiles([
    {
      user_id: VILLAIN,
      variant: 'nlh',
      mode: 'tournament',
      size: 'short',
      observed_hands: 80,
      initialized: true,
      public_memory_domain: { version: 1, speed: 'table', ante: 'none' },
      counters: v.counters,
    } as never,
  ]);
  const { hero, gs } = bubbleOpen(heroBB, villainBB, shortBB, heroCards, openBB);
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(0x57e1e);
  const d: any = HorseLogic.decide(hero as never, gs, 'balanced', {}, {
    telemetry: true,
    decisionTimeMs: 0,
    ...(on ? { styleTightReRaiserRespect: true } : {}),
  } as never);
  const fires = drainFires().map((r) => r.feature);
  HorseMind.setDecisionScope(null);
  return { d, fires };
}

describe('the tournament utility arbiter keeps the last word over the style read', () => {
  it('on a bubble the style read shapes the decision first, the arbiter evaluates it, and its selection is committed', () => {
    let checked = 0;
    for (const hc of ['KhJd', 'AdTc', 'QhJh', 'KdQc'])
      for (const openBB of [3, 6, 9]) {
        const { d, fires } = decideBubble(30, 120, 4, true, hc, openBB);
        const tu = d.tournamentUtility;
        expect(tu, `${hc}/${openBB}`).toBeTruthy();
        expect(d.action, `${hc}/${openBB}`).toBe(tu.selectedAction);
        expect(d.amount ?? null, `${hc}/${openBB}`).toBe(tu.selectedAmount ?? null);
        const style = fires.indexOf('style_tight_opener_respect_seen');
        if (style >= 0) {
          expect(fires.indexOf('phase7_tournament_utility'), `${hc}/${openBB}`).toBeGreaterThan(
            style
          );
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(0);
  });
});
