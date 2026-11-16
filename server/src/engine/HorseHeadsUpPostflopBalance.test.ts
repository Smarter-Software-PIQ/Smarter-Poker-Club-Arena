/**
 * HV31 FLOP-5 D1: holdemHeadsUpPostflopBalance (HorseHeadsUpPostflopBalance.ts).
 * Pins: default OFF changes nothing and draws no random number (unit and
 * through HorseLogic.decide on real HandController states); the spot test; the
 * tiers; the three parts of the rule; the worker receipt admits what it does;
 * the river is not covered (its part was removed after the solver score): with
 * the option on, a checked-to river decision is returned unchanged and draws no
 * random number.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  HU_BALANCE_BET_FREQUENCY,
  holdemHeadsUpPostflopBalance,
  huBalanceSpot,
  huBalanceTier,
} from './HorseHeadsUpPostflopBalance.js';
import type { Card, HandConfig, HorseDecision, SeatPlayer } from '../types.js';

const SUIT: Record<string, Card['suit']> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((x) => ({ rank: x[0] as Card['rank'], suit: SUIT[x[1]] }));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h32 = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0) || 1;

type Act = { who: 'IP' | 'OOP'; action: 'check' | 'call' | 'bet' | 'raise'; amount?: number };

/** A 6-max 50/100 cash hand: the button opens to 275, the big blind calls, then `script`. */
function spotState(
  script: Act[],
  board: string,
  opts: { threeBet?: boolean; tournament?: boolean } = {}
) {
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= 6; seat++)
    players.push({
      seat,
      user_id: uid(900000 + seat),
      username: `s${seat}`,
      stack: 10000,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as SeatPlayer);
  const config = {
    tableId: 'hu-balance',
    handNumber: 1,
    gameVariant: 'nlh',
    isTournament: false,
    smallBlind: 50,
    bigBlind: 100,
    ante: 0,
    bigBlindAnte: false,
    rakeConfig: { percent: 5, cap: 250, noFlopNoDrop: true },
  } as unknown as HandConfig;
  const hc = new HandController(config, players, 1);
  hc.start();
  const blind = hc.getBlindSeatsSnapshot()!;
  const ip = 1;
  const oop = blind.bigBlind;
  const act = (seat: number, action: string, amount?: number) => {
    if (!hc.performAction(seat, action as never, amount))
      throw new Error(`illegal ${seat} ${action} ${amount}`);
  };
  for (let guard = 0; guard < 12 && hc.getState().stage === 'preflop'; guard++) {
    const seat = hc.getState().currentPlayerSeat!;
    if (seat === ip) {
      const st = hc.getState();
      if (st.currentBet > 100) act(seat, 'call');
      else act(seat, 'raise', 275);
    } else if (seat === oop) {
      const st = hc.getState();
      if (opts.threeBet && st.currentBet === 275) act(seat, 'raise', 900);
      else act(seat, 'call');
    } else act(seat, 'fold');
  }
  for (const a of script) act(a.who === 'IP' ? ip : oop, a.action, a.amount);
  const st = hc.getState();
  const actor = st.players.find((p) => p.seat === st.currentPlayerSeat)!;
  const auth = hc.getAuthoritativeActionState(actor.user_id)!;
  const gs = {
    stateSchemaVersion: 1,
    ...hc.getChipRulesSnapshot(),
    blindSeats: blind,
    rakeConfig: hc.getRakeConfigSnapshot(),
    stage: st.stage,
    gameVariant: 'nlh',
    gameMode: opts.tournament ? 'tournament' : 'cash',
    format: opts.tournament ? 'tournament' : 'cash',
    pot: st.pot,
    contestablePot: hc.getContestablePotForCall(actor.user_id) ?? st.pot,
    currentBet: st.currentBet,
    minRaise: st.minRaise,
    lastRaise: st.lastRaise,
    smallBlind: 50,
    bigBlind: 100,
    ante: 0,
    bigBlindAnte: false,
    dealerSeat: 1,
    heroSeat: actor.seat,
    currentPlayerSeat: actor.seat,
    straddleActive: false,
    communityCards: cards(board),
    players: st.players.map((p) => ({ ...p, cards: [] })),
    dealtSeatIds: st.players.filter((p) => p.cards.length > 0).map((p) => p.seat),
    actionHistory: st.actionHistory,
    legalActions: auth.legalActions,
    toCall: auth.toCall,
    minRaiseTo: auth.minRaiseTo,
    maxRaiseTo: auth.maxRaiseTo,
    bettingStructure: auth.structure,
    fixedBetSize: auth.fixedBetSize,
    wagersCapped: auth.wagersCapped,
    commitmentCapRemaining: null,
    pots: hc.computeLivePots(),
    variantRules: horseVariantRulesFor('nlh'),
  } as unknown as HorseGameStateV2;
  return { gs, actor };
}

const FLOP_CBET: Act[] = [{ who: 'OOP', action: 'check' }];
const FLOP_XR: Act[] = [
  { who: 'OOP', action: 'check' },
  { who: 'IP', action: 'bet', amount: 200 },
  { who: 'OOP', action: 'raise', amount: 700 },
];
const TURN_CHECKED: Act[] = [
  { who: 'OOP', action: 'check' },
  { who: 'IP', action: 'check' },
  { who: 'OOP', action: 'check' },
];
const RIVER_CHECKED: Act[] = [
  ...TURN_CHECKED,
  { who: 'IP', action: 'check' },
  { who: 'OOP', action: 'check' },
];

const identity = (d: HorseDecision) => d;

describe('huBalanceTier', () => {
  it.each([
    ['AhKd', 'Ks7c2d', 'top'],
    ['QsQd', 'Js7c2d', 'top'],
    ['7h6h', 'Ks7c2d', 'mid'],
    ['9h9s', 'Ks7c2d', 'mid'],
    ['2h3h', 'Ks7c2d', 'weak'],
    ['5h5s', 'Ks7c2d', 'weak'],
    ['Kh7h', 'Ks7c2d', 'nutted'],
    ['7h7d', 'Ks7c2d', 'nutted'],
    ['AhQh', 'Kh7h2d', 'draw'],
    ['9h8d', 'Ts4c2d', 'air'],
    ['9h8d', 'Ts7c2d', 'draw'],
    ['9h8d', 'Ts7c6d', 'nutted'],
    ['9h8d', 'Ts7cKd', 'draw'],
    ['AhQd', '5s4c3d', 'air'],
    ['AhQd', 'JsTc3d', 'air'],
    ['QhJh', 'Th9h2c', 'draw'],
    ['Ah2c', 'Kh9h5h4h', 'nutted'],
    ['Kc2c', 'Kh9h5h4h', 'top'],
    ['AhKd', 'Ks7c2dQh8s', 'top'],
    ['AhQh', 'Kh7h2d3c8s', 'air'],
  ])('%s on %s is %s', (hole, board, tier) => {
    expect(huBalanceTier(cards(hole), cards(board))).toBe(tier);
  });
});

describe('huBalanceSpot', () => {
  it('names the three spots from public state; a checked-to river is not one', () => {
    const f = spotState(FLOP_CBET, 'Ks7c2d');
    expect(huBalanceSpot(f.actor, f.gs)).toBe('flop_cbet');
    const x = spotState(FLOP_XR, 'Ks7c2d');
    expect(huBalanceSpot(x.actor, x.gs)).toBe('flop_vs_check_raise');
    const t = spotState(TURN_CHECKED, 'Ks7c2d4h');
    expect(huBalanceSpot(t.actor, t.gs)).toBe('turn_checked_to');
    const r = spotState(RIVER_CHECKED, 'Ks7c2d4h9s');
    expect(huBalanceSpot(r.actor, r.gs)).toBeNull();
  });
  it('is null in a 3-bet pot, a tournament, another variant, out of position and short', () => {
    const three = spotState([{ who: 'OOP', action: 'check' }], 'Ks7c2d', { threeBet: true });
    expect(huBalanceSpot(three.actor, three.gs)).toBeNull();
    const t = spotState(FLOP_CBET, 'Ks7c2d', { tournament: true });
    expect(huBalanceSpot(t.actor, t.gs)).toBeNull();
    const f = spotState(FLOP_CBET, 'Ks7c2d');
    expect(huBalanceSpot(f.actor, { ...f.gs, gameVariant: 'plo4' } as HorseGameStateV2)).toBeNull();
    expect(huBalanceSpot(f.actor, { ...f.gs, bombPot: true } as HorseGameStateV2)).toBeNull();
    expect(
      huBalanceSpot(f.actor, { ...f.gs, bettingStructure: 'pot_limit' } as HorseGameStateV2)
    ).toBeNull();
    const oopFirst = spotState([], 'Ks7c2d');
    expect(huBalanceSpot(oopFirst.actor, oopFirst.gs)).toBeNull();
    const short = { ...f.actor, stack: 1500 } as SeatPlayer;
    expect(huBalanceSpot(short, f.gs)).toBeNull();
  });
});

describe('holdemHeadsUpPostflopBalance (unit)', () => {
  it('OFF: returns the same decision object and draws no random number', () => {
    const f = spotState(FLOP_CBET, 'Ks7c2d');
    const hero = { ...f.actor, cards: cards('2h3h') };
    const d: HorseDecision = { action: 'bet', amount: 90, thinkTime: 1 };
    let draws = 0;
    const r = holdemHeadsUpPostflopBalance(d, hero, f.gs, false, identity, () => (draws++, 0));
    expect(r.decision).toBe(d);
    expect(r.changed).toBeNull();
    expect(draws).toBe(0);
  });
  it('flop c-bet: one 0.75-pot size or a check, by the tier frequency', () => {
    const f = spotState(FLOP_CBET, 'Ks7c2d');
    const hero = { ...f.actor, cards: cards('2h3h') };
    const small: HorseDecision = { action: 'bet', amount: 200, thinkTime: 1 };
    const bet = holdemHeadsUpPostflopBalance(small, hero, f.gs, true, identity, () => 0);
    expect(bet.changed).toBe('flop_cbet');
    expect(bet.decision).toMatchObject({ action: 'bet', amount: Math.round(f.gs.pot * 0.75) });
    const p = HU_BALANCE_BET_FREQUENCY.flop_cbet.weak;
    const chk = holdemHeadsUpPostflopBalance(small, hero, f.gs, true, identity, () => p + 1e-9);
    expect(chk.decision.action).toBe('check');
    const kept = holdemHeadsUpPostflopBalance(
      { action: 'check', thinkTime: 1 },
      hero,
      f.gs,
      true,
      identity,
      () => 0.999
    );
    expect(kept.changed).toBeNull();
  });
  it('check-raise: a middle pair fold becomes a call; air and a raise stay', () => {
    const x = spotState(FLOP_XR, 'Ks7c2d');
    const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
    const mid = holdemHeadsUpPostflopBalance(
      fold,
      { ...x.actor, cards: cards('7h6h') },
      x.gs,
      true,
      identity
    );
    expect(mid).toMatchObject({ changed: 'check_raise_defend', decision: { action: 'call' } });
    const air = holdemHeadsUpPostflopBalance(
      fold,
      { ...x.actor, cards: cards('9h8d') },
      x.gs,
      true,
      identity
    );
    expect(air.decision).toBe(fold);
    const raise: HorseDecision = { action: 'raise', amount: 2000, thinkTime: 1 };
    expect(
      holdemHeadsUpPostflopBalance(
        raise,
        { ...x.actor, cards: cards('Kh7h') },
        x.gs,
        true,
        identity
      ).decision
    ).toBe(raise);
  });
  it('turn: one 0.70-pot size or a check; a call or all-in is never touched', () => {
    const t = spotState(TURN_CHECKED, 'Ks7c2d4h');
    const tb = holdemHeadsUpPostflopBalance(
      { action: 'check', thinkTime: 1 },
      { ...t.actor, cards: cards('AhKd') },
      t.gs,
      true,
      identity,
      () => 0
    );
    expect(tb).toMatchObject({
      changed: 'later_street',
      decision: { action: 'bet', amount: Math.round(t.gs.pot * 0.7) },
    });
    const jam: HorseDecision = { action: 'all_in', amount: 9725, thinkTime: 1 };
    expect(
      holdemHeadsUpPostflopBalance(
        jam,
        { ...t.actor, cards: cards('AhKd') },
        t.gs,
        true,
        identity,
        () => 0
      ).decision
    ).toBe(jam);
  });
  it('river ON: a checked-to river decision is returned unchanged and draws no random number', () => {
    const r = spotState(RIVER_CHECKED, 'Ks7c2d4h9s');
    const decisions: HorseDecision[] = [
      { action: 'check', thinkTime: 1 },
      { action: 'bet', amount: 200, thinkTime: 1 },
      { action: 'all_in', amount: 9725, thinkTime: 1 },
    ];
    for (const hole of ['AhKd', '7h6h', '2h3h', 'Kh7h', '9h8d'])
      for (const d of decisions) {
        let draws = 0;
        const out = holdemHeadsUpPostflopBalance(
          d,
          { ...r.actor, cards: cards(hole) },
          r.gs,
          true,
          identity,
          () => (draws++, 0)
        );
        expect(out.decision).toBe(d);
        expect(out.changed).toBeNull();
        expect(draws).toBe(0);
      }
  });
});

describe('holdemHeadsUpPostflopBalance through HorseLogic.decide', () => {
  const HOLES = [
    'AhKd',
    'QsQd',
    '7h6h',
    '2h3h',
    'Kh7h',
    'AhQh',
    '9h8d',
    'JcTc',
    '5h5s',
    'AcJd',
    'Td9d',
    '4s4c',
  ];
  const SPOTS: Array<[string, Act[], string]> = [
    ['flop_cbet', FLOP_CBET, 'Ks7c2d'],
    ['flop_vs_check_raise', FLOP_XR, 'Ks7c2d'],
    ['turn_checked_to', TURN_CHECKED, 'Ks7c2d4h'],
    ['river_checked_to', RIVER_CHECKED, 'Ks7c2d4h9s'],
  ];
  // The spots the rule owns; the checked-to river (last in SPOTS) is not one.
  const OWNED = SPOTS.filter((spot) => spot[0] !== 'river_checked_to');
  function run(opts: HorseDecideOpts, spot: (typeof SPOTS)[number], hole: string, s: number) {
    const { gs, actor } = spotState(spot[1], spot[2]);
    const hero = { ...actor, cards: cards(hole) };
    seedFastRandom(h32(`${spot[0]}|${hole}|${s}`));
    const decision = HorseMind.runInSandbox(HorseMind.createSandbox(), () =>
      HorseLogic.decide(hero, gs, 'balanced', {}, { ...opts, decisionTimeMs: 1_762_855_200_000 })
    );
    return { decision, next: fastRandom(), gs, hero };
  }
  it('default path unchanged: absent and false give the same action, amount and random stream', () => {
    for (const spot of SPOTS)
      for (const hole of HOLES)
        for (let s = 0; s < 2; s++) {
          const a = run({}, spot, hole, s);
          const b = run({ holdemHeadsUpPostflopBalance: false }, spot, hole, s);
          expect([b.decision.action, b.decision.amount ?? null, b.next]).toEqual([
            a.decision.action,
            a.decision.amount ?? null,
            a.next,
          ]);
        }
  }, 120_000);
  it('ON: changes decisions in every spot it owns, and the worker receipt admits each one', () => {
    const changed: Record<string, number> = {};
    for (const spot of OWNED)
      for (const hole of HOLES)
        for (let s = 0; s < 3; s++) {
          const off = run({}, spot, hole, s);
          const on = run({ holdemHeadsUpPostflopBalance: true }, spot, hole, s);
          if (
            on.decision.action !== off.decision.action ||
            (on.decision.amount ?? null) !== (off.decision.amount ?? null)
          )
            changed[spot[0]] = (changed[spot[0]] ?? 0) + 1;
          expect(
            horseDecisionReceiptRefusal(on.decision, 'nlh', { player: on.hero, gameState: on.gs })
          ).toBeNull();
        }
    for (const spot of OWNED) expect(changed[spot[0]] ?? 0, spot[0]).toBeGreaterThan(0);
  }, 180_000);
  it('ON at a checked-to river: the same action, amount and random stream as the default path', () => {
    const river = SPOTS.find((spot) => spot[0] === 'river_checked_to')!;
    for (const hole of HOLES)
      for (let s = 0; s < 2; s++) {
        const off = run({}, river, hole, s);
        const on = run({ holdemHeadsUpPostflopBalance: true }, river, hole, s);
        expect([on.decision.action, on.decision.amount ?? null, on.next]).toEqual([
          off.decision.action,
          off.decision.amount ?? null,
          off.next,
        ]);
      }
  }, 120_000);
});
