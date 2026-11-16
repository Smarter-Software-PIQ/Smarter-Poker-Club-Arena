/**
 * Fixed-Limit lane W8 (2026-11-15). On an unbet fixed-limit river a Horse that
 * is first to act with a full house or better checked 31 to 58 percent of the
 * time in the lane's Horse-only census and then seldom raised; heads-up in
 * flo8 the river checked through 42 to 50 percent of the time
 * (extreme-archive/fixed-limit-01Gw7aDr/AD-STRONG-RIVER-CHECKS.md).
 *
 * Law (option fixedLimitRiverStrongHandLeads, opt-in, default off): with the
 * option on, a fixed-limit Horse that is first to act on the river with
 * nothing to call, whose reference checks, and whose full house or better is
 * beaten by at most 12 percent of the holdings of the opponents who can act
 * (card-exact, engine scorers; hold'em also refuses an under-full boat and a
 * board that plays), bets one big bet. Hi-lo with a low possible and no
 * Horse low leads only into two or more opponents who can act. An aggressive
 * read on the next opponent to act keeps the check. Checked-to and
 * facing-a-wager decisions, no-limit and pot-limit, are unchanged, and the
 * receipt fires only when the action changes. With the option off nothing
 * changes anywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { isAggressor, isPostflopManiac } from './HorseOpponentExploit.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { cards, decide } from './HuVariantSpot.test-support.js';
import {
  HU_BIG_BLIND_FIRST,
  HU_CHECKED_TO_BUTTON,
  HU_ONE_RIVER_BET,
  spot,
  sweep,
  tally,
  type Step,
} from './FixedLimitWagerRead.test-support.js';
import {
  FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN,
  fixedLimitRiverLeadStrength,
  fixedLimitRiverStrongHandLeads,
  type FixedLimitRiverLeadSpot,
} from './HorseFixedLimitRiverLead.js';
import type { ActionRecord } from '../types.js';

const ON = { mind: true, fixedLimitRiverStrongHandLeads: true } as const;
const OFF = { mind: true } as const;
const SEEDS = 20;
afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

// Three-handed (seat 1 button, 2 small blind, 3 big blind). Flop checks through,
// the big blind bets the turn and both others call: the small blind (hero) is
// first to act on the river.
const THREE_TURN_BET: readonly Step[] = [
  [1, 'call'],
  [2, 'call'],
  [3, 'check'],
  [2, 'check'],
  [3, 'check'],
  [1, 'check'],
  [2, 'check'],
  [3, 'bet'],
  [1, 'call'],
  [2, 'call'],
];
// The same three-handed table with every street checked through.
const THREE_CHECKED_THROUGH: readonly Step[] = [
  [1, 'call'],
  [2, 'call'],
  [3, 'check'],
  [2, 'check'],
  [3, 'check'],
  [1, 'check'],
  [2, 'check'],
  [3, 'check'],
  [1, 'check'],
];
// Heads-up, the button bets flop and turn, the big blind (hero) calls and is first on the river.
const HU_BUTTON_BARRELS: readonly Step[] = [
  [1, 'raise'],
  [2, 'call'],
  [2, 'check'],
  [1, 'bet'],
  [2, 'call'],
  [2, 'check'],
  [1, 'bet'],
  [2, 'call'],
];

// Decks list seat 1's cards, then seat 2's (and seat 3's), then the board.
const FLH_TOP_BOAT = { deck: 'Ah 3d Ks Kh Kd 7c 7h 2s 4d', hero: 'Ks Kh', board: 'Kd 7c 7h 2s 4d' };
const FLO8_KINGS_FULL = {
  deck: 'Ah 3d 4c 5c Kh 9s Jd Qd Kc Kd 9h Ts 2s',
  hero: 'Kh 9s Jd Qd',
  board: 'Kc Kd 9h Ts 2s',
};
const FLO8_QUADS_LOW_LIVE = { hero: '5h 3s Kc Jd', board: '4c 5c 5d 5s 6c' };

describe('fixed limit: a strong river hand that is first to act leads (option on)', () => {
  it('the strength cut: card-exact, engine scorers, both sides pinned', () => {
    // flo8 22266 on 2-T-3-6-6: any six with a ten, three or deuce, TT, 33, 66 beat it.
    const weak = fixedLimitRiverLeadStrength(
      cards('2h 2s 9h Tc'),
      cards('2c Td 3c 6s 6d'),
      true,
      1
    );
    expect(weak.category).toBe(7);
    expect(weak.beatenShare).toBeCloseTo(17 / 903, 6);
    expect(weak.beatenAny).toBeLessThan(FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN);
    expect([weak.boatsAbove, weak.boatsBelow, weak.bottomHalfBoat]).toEqual([6, 0, true]);
    expect(weak.strong).toBe(false);
    // flo8 QQQ66 on 6-7-T-Q-Q: only the last queen with a seven or a ten.
    const strong = fixedLimitRiverLeadStrength(
      cards('Qh 6d Js Jd'),
      cards('6h 7s Ts Qc Qd'),
      true,
      1
    );
    expect(strong.category).toBe(7);
    expect(strong.beatenShare).toBeCloseTo(6 / 903, 6);
    expect([strong.boatsAbove, strong.boatsBelow, strong.bottomHalfBoat]).toEqual([2, 3, false]);
    expect(strong.strong).toBe(true);
    // More opponents who can act make the same boat weaker: queens full of
    // sixes is strong heads-up and refused against six opponents who can act.
    const six = fixedLimitRiverLeadStrength(cards('Qh 6d Js Jd'), cards('6h 7s Ts Qc Qd'), true, 6);
    expect(six.beatenAny).toBeGreaterThan(strong.beatenAny);
    expect(six.beatenAny).toBeGreaterThan(FIXED_LIMIT_RIVER_LEAD_MAX_BEATEN);
    expect(six.strong).toBe(false);
    // TTTKK on K-K-9-T-2: three bigger boats and quads against two smaller.
    expect(
      fixedLimitRiverLeadStrength(cards('Th Td Jh 3c'), cards('Kc Kd 9h Ts 2s'), true, 1)
        .bottomHalfBoat
    ).toBe(true);
    // flo8 222KK on K-K-9-T-2 is weak; quads are strong.
    expect(
      fixedLimitRiverLeadStrength(cards('2h 2d Jh 3c'), cards('Kc Kd 9h Ts 2s'), true, 1).strong
    ).toBe(false);
    const quads = fixedLimitRiverLeadStrength(
      cards(FLO8_QUADS_LOW_LIVE.hero),
      cards(FLO8_QUADS_LOW_LIVE.board),
      true,
      2
    );
    expect(quads.category).toBe(8);
    expect(quads.strong).toBe(true);
    // Hold'em: the under-full boat (22266 on 6-6-2-T-3) and a board that plays are refused.
    const under = fixedLimitRiverLeadStrength(cards('2s 2h'), cards('6s 6d 2c Td 3h'), false, 1);
    expect(under.underfull).toBe(true);
    expect(under.strong).toBe(false);
    const plays = fixedLimitRiverLeadStrength(cards('2s 3h'), cards('9s 9d 9c Kd Kh'), false, 1);
    expect(plays.boardPlays).toBe(true);
    expect(plays.strong).toBe(false);
    // Below a full house nothing is computed and nothing is strong.
    expect(
      fixedLimitRiverLeadStrength(cards('As Ks'), cards('Qs Js 2d 3c 9h'), false, 1).strong
    ).toBe(false);
  });

  it('the gate: each refusal and the low rule', () => {
    const base: FixedLimitRiverLeadSpot = {
      isFixedLimit: true,
      isRiver: true,
      toCall: 0,
      firstToActOnRiver: true,
      referenceAction: 'check',
      betLegal: true,
      bombPotOrMultiBoard: false,
      opponentsWhoCanAct: 1,
      betLeavesChips: true,
      tournament: false,
      stackBigBlinds: 100,
      isHiLo: false,
      lowPossible: false,
      horseHoldsLow: false,
      strong: true,
      nextOpponentAggressive: false,
    };
    expect(fixedLimitRiverStrongHandLeads(base)).toBe('lead');
    for (const off of [
      { isFixedLimit: false },
      { isRiver: false },
      { toCall: 4 },
      { firstToActOnRiver: false },
      { referenceAction: 'bet' },
      { betLegal: false },
      { bombPotOrMultiBoard: true },
      { opponentsWhoCanAct: 0 },
      { betLeavesChips: false },
    ])
      expect(fixedLimitRiverStrongHandLeads({ ...base, ...off })).toBe('out_of_scope');
    expect(fixedLimitRiverStrongHandLeads({ ...base, tournament: true, stackBigBlinds: 19 })).toBe(
      'short_tournament_stack'
    );
    expect(fixedLimitRiverStrongHandLeads({ ...base, tournament: true, stackBigBlinds: 20 })).toBe(
      'lead'
    );
    expect(fixedLimitRiverStrongHandLeads({ ...base, strong: false })).toBe('not_strong');
    const lowLive = { ...base, isHiLo: true, lowPossible: true, horseHoldsLow: false };
    expect(fixedLimitRiverStrongHandLeads(lowLive)).toBe('low_half_heads_up');
    expect(fixedLimitRiverStrongHandLeads({ ...lowLive, opponentsWhoCanAct: 2 })).toBe('lead');
    expect(fixedLimitRiverStrongHandLeads({ ...lowLive, horseHoldsLow: true })).toBe('lead');
    expect(fixedLimitRiverStrongHandLeads({ ...base, isHiLo: true, lowPossible: false })).toBe(
      'lead'
    );
    expect(fixedLimitRiverStrongHandLeads({ ...base, nextOpponentAggressive: true })).toBe(
      'aggressive_next'
    );
  });

  it('flh heads-up: the top boat first to act leads; off it checks', () => {
    const off = tally('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, OFF, SEEDS);
    expect(off.check ?? 0).toBeGreaterThan(0);
    expect(tally('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, ON, SEEDS)).toEqual({
      bet: SEEDS,
    });
    // After the button barrelled flop and turn, the same boat leads too.
    expect(
      tally('flh', 2, FLH_TOP_BOAT.deck, HU_BUTTON_BARRELS, OFF, SEEDS).check ?? 0
    ).toBeGreaterThan(0);
    expect(tally('flh', 2, FLH_TOP_BOAT.deck, HU_BUTTON_BARRELS, ON, SEEDS)).toEqual({
      bet: SEEDS,
    });
  }, 120_000);

  it('flo8 heads-up, no low possible: kings full leads; off it checks', () => {
    const t = spot('flo8', 2, FLO8_KINGS_FULL.deck, HU_BIG_BLIND_FIRST);
    expect(decide(t, 1, OFF).hero.cards).toEqual(cards(FLO8_KINGS_FULL.hero));
    expect(
      tally('flo8', 2, FLO8_KINGS_FULL.deck, HU_BIG_BLIND_FIRST, OFF, SEEDS).check ?? 0
    ).toBeGreaterThan(0);
    expect(tally('flo8', 2, FLO8_KINGS_FULL.deck, HU_BIG_BLIND_FIRST, ON, SEEDS)).toEqual({
      bet: SEEDS,
    });
  }, 120_000);

  it('a weak boat keeps the reference: flh under-full, flo8 222KK, flo8 22266 three-way', () => {
    const cases: Array<[string, number, string, readonly Step[]]> = [
      ['flh', 2, 'Ah Qd 2s 2h 6s 6d 2c Td 3h', HU_BIG_BLIND_FIRST],
      ['flo8', 2, 'Ah 3d 4c 5c 2h 2d Jh 3c Kc Kd 9h Ts 2s', HU_BIG_BLIND_FIRST],
      ['flo8', 3, 'Ah Kd 4c 5c 2h 2s 9h Tc Qh Jh 8d Ks 2c Td 3c 6s 6d', THREE_CHECKED_THROUGH],
    ];
    for (const [variant, seats, deck, steps] of cases)
      expect(tally(variant, seats, deck, steps, ON, SEEDS)).toEqual(
        tally(variant, seats, deck, steps, OFF, SEEDS)
      );
  }, 120_000);

  it('flo8, a low live and no Horse low: heads-up keeps the reference, three-way leads', () => {
    const hu = 'Ah Kd Qc Jc 5h 3s Kc Jd 4c 5c 5d 5s 6c';
    expect(tally('flo8', 2, hu, HU_BIG_BLIND_FIRST, ON, SEEDS)).toEqual(
      tally('flo8', 2, hu, HU_BIG_BLIND_FIRST, OFF, SEEDS)
    );
    const three = 'Ah Kd Qc Jc 5h 3s Kc Jd Qh Jh 8d Ts 4c 5c 5d 5s 6c';
    expect(tally('flo8', 3, three, THREE_TURN_BET, OFF, SEEDS).check ?? 0).toBeGreaterThan(0);
    expect(tally('flo8', 3, three, THREE_TURN_BET, ON, SEEDS)).toEqual({ bet: SEEDS });
  }, 120_000);

  it('checked to and facing a wager: unchanged', () => {
    const btn = 'Ks Kh Ah 3d Kd 7c 7h 2s 4d';
    for (const steps of [HU_CHECKED_TO_BUTTON, HU_ONE_RIVER_BET])
      expect(tally('flh', 2, btn, steps, ON, SEEDS)).toEqual(
        tally('flh', 2, btn, steps, OFF, SEEDS)
      );
  }, 120_000);

  it('an aggressive read on the next opponent to act keeps the check', () => {
    // A fixed-limit maniac on seat 1: raises preflop and bets every checked street.
    const OPP = '10000000-0000-4000-8000-000000000001';
    const HERO = '10000000-0000-4000-8000-000000000002';
    const scope = readScopeOf('flh', 2);
    let ts = 3_000_000;
    for (let h = 0; h < 120; h++) {
      const out: ActionRecord[] = [];
      const push = (userId: string, action: string, amount: number, stage: string) =>
        out.push({
          seat: userId === OPP ? 1 : 2,
          userId,
          action,
          amount,
          timestamp: ts++,
          stage,
        } as ActionRecord);
      push(OPP, 'raise', 4, 'preflop');
      push(HERO, 'call', 2, 'preflop');
      for (const [stage, bet] of [
        ['flop', 2],
        ['turn', 4],
        ['river', 4],
      ] as const) {
        push(HERO, 'check', 0, stage);
        push(OPP, 'bet', bet, stage);
        push(HERO, 'call', bet, stage);
      }
      HorseMind.setDecisionScope(scope, 'flh', 'cash');
      HorseMind.observe(out, [], undefined, undefined, 2, 'fixed_limit');
      HorseMind.setDecisionScope(null);
      HorseMind.observeHandComplete(`w8-maniac:${h}:${ts}`, out, 2, null, scope);
    }
    HorseMind.setDecisionScope(scope, 'flh', 'cash');
    const maniac = HorseMind.opponentRead(OPP);
    HorseMind.setDecisionScope(null);
    expect(maniac).not.toBeNull();
    expect(isAggressor(maniac) || isPostflopManiac(maniac)).toBe(true);
    const original = HorseMind.opponentRead.bind(HorseMind);
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation((id: string) =>
      id === OPP ? maniac : original(id)
    );
    expect(tally('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, ON, SEEDS)).toEqual(
      tally('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, OFF, SEEDS)
    );
    // The read sits on the opponent, not the Horse: with the read on nobody, it leads.
    vi.restoreAllMocks();
    expect(tally('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, ON, SEEDS)).toEqual({
      bet: SEEDS,
    });
  }, 120_000);

  it('the receipt fires only when the action changes', () => {
    enableBrainTelemetry();
    const fired = (
      variant: string,
      seats: number,
      deck: string,
      steps: readonly Step[],
      opts: object
    ) =>
      withDecisionFireScope(() =>
        decide(spot(variant, seats, deck, steps), 501, { ...opts, telemetry: true })
      ).fired.has('fixed_limit_river_strong_hand_lead');
    expect(fired('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, ON)).toBe(true);
    expect(fired('flh', 2, FLH_TOP_BOAT.deck, HU_BIG_BLIND_FIRST, OFF)).toBe(false);
    expect(fired('flh', 2, 'Ah Qd 2s 2h 6s 6d 2c Td 3h', HU_BIG_BLIND_FIRST, ON)).toBe(false);
    expect(fired('flo8', 2, 'Ah Kd Qc Jc 5h 3s Kc Jd 4c 5c 5d 5s 6c', HU_BIG_BLIND_FIRST, ON)).toBe(
      false
    );
    expect(fired('flh', 2, 'Ks Kh Ah 3d Kd 7c 7h 2s 4d', HU_CHECKED_TO_BUTTON, ON)).toBe(false);
  }, 120_000);

  it('random fixed-limit deals: the only change is a first-to-act river check that becomes a bet', () => {
    for (const variant of ['flh', 'flo8']) {
      const rows = sweep(variant, 40, OFF, ON);
      expect(rows.length).toBeGreaterThan(100);
      for (const r of rows.filter((x) => x.base !== x.other)) {
        expect(r.stage).toBe('river');
        expect(r.facing).toBe(false);
        expect(JSON.parse(r.base)[0]).toBe('check');
        expect(JSON.parse(r.other)[0]).toBe('bet');
      }
      // Option explicitly off is the option absent.
      for (const r of sweep(variant, 20, OFF, { ...OFF, fixedLimitRiverStrongHandLeads: false }))
        expect(r.other).toBe(r.base);
    }
  }, 300_000);

  it('no-limit and pot-limit are identical with the option on', () => {
    for (const variant of ['nlh', 'plo4'])
      for (const r of sweep(variant, 30, OFF, ON)) expect(r.other).toBe(r.base);
  }, 300_000);
});
