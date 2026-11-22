/**
 * LAW (HORSE DECISIONS lane 2026-11-19; option omahaBluffIsPricedAgainstTheTarget, default OFF):
 * in PLO4/PLO5 cash, at a table and in Lightning, a Horse's heads-up wager facing no bet stands only
 * when EV(bet) = f.P - (1 - f).(b - r.e_called.(P + 2b)) beats EV(check) = r.e_all.P with f the
 * opponent's MEASURED fold at that price; a flop raise facing a bet stands only when priced above the
 * call; and a made hand facing a flop bet raises when a legal raise size is priced above the call.
 *
 * Fixtures are the audit's own flagged hands (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/
 * A-plo5-lightning/decisions.csv, rows by hand number; class 2 bluff_or_thin_bet_into_continue_range,
 * class 4 missed_raise_value), rebuilt with the Horse's exact cards, the board, pot, price, stacks and
 * position (HorseOmahaBluffPricedAgainstTheTarget.test-support.ts). RED with the option off (the
 * audited action stands); GREEN with it on (the priced action). WooWoo carries his audited record.
 *
 * Not every audited flag turns: with his measured record WooWoo folds about 0.73 to a river pot bet
 * (0.86, 36 of 42, measured on these 48 hours), so the audit's river pot bluffs with no showdown value
 * are priced above the check and stay; the law pins only the hands the price turns, and the
 * build note lists every row (bluffprice-01TLQer7J/BUILD.md).
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  omahaBluffBetVerdict,
  omahaBluffIsPricedAgainstTheTargetRule,
  omahaBluffPricedAdmitsCheck,
  omahaBluffPricedAdmitsRaiseToCall,
} from './HorseOmahaBluffPricedAgainstTheTarget.js';
import {
  auditRecordOf,
  auditSpot,
  type AuditRow,
} from './HorseOmahaBluffPricedAgainstTheTarget.test-support.js';

const ON = { omahaBluffIsPricedAgainstTheTarget: true } as HorseDecideOpts;
const OFF = {} as HorseDecideOpts;

/** Class 2: a bet into his calling range (the price turns it into the check) or a raise (into the call). */
const CLASS_2: AuditRow[] = [
  // defb7834 CLEAR: river, two pair on a double-paired board, 85 into 207.5
  {
    hand: '59971022',
    street: 'river',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '6s5d9hTs7h',
    board: 'Ks7sAhKh7d',
    pot: 207.5,
    toCall: 0.0,
    stack: 537.98,
    eff: 537.98,
    action: 'bet:170.0',
  },
  // 6a50749d LIKELY: river, kings full under the board's jacks full, all in for 127 into 151
  {
    hand: '60168678',
    street: 'river',
    ip: false,
    opps: 1,
    woowoo: false,
    cards: '5cKc8hKs6s',
    board: 'QdAhJdJcJh',
    pot: 151.0,
    toCall: 0.0,
    stack: 201.25,
    eff: 127.0,
    action: 'bet:254.0',
  },
  // 87d1719f CLEAR: river, top set below a made straight, a pot bet
  {
    hand: '59970978',
    street: 'river',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '9sKsKcJs6c',
    board: 'KdTcJh5h3s',
    pot: 106.5,
    toCall: 0.0,
    stack: 369.8,
    eff: 369.8,
    action: 'bet:213.0',
  },
  // 8aeddacb CLEAR: river, top pair, a half-pot bet
  {
    hand: '59972602',
    street: 'river',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '9hThKdJdAc',
    board: 'Kh2c5c7s5s',
    pot: 187.5,
    toCall: 0.0,
    stack: 332.75,
    eff: 332.75,
    action: 'bet:188.0',
  },
  // 92ba6e27 CLEAR: flop, aces with no spade on a monotone board, 75.5 into 90
  {
    hand: '59990589',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: false,
    cards: '3s5dAd9cAc',
    board: 'Ts7s6s',
    pot: 90.0,
    toCall: 0.0,
    stack: 144.85,
    eff: 144.85,
    action: 'bet:151.0',
  },
  // 9415f892 CLEAR: flop, no pair, 63.5 into 85.5
  {
    hand: '60062664',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '7hJc8cQd9h',
    board: 'Kc3c3h',
    pot: 85.5,
    toCall: 0.0,
    stack: 88.0,
    eff: 88.0,
    action: 'bet:127.0',
  },
  // 97dc5777 CLEAR: flop, aces with no club on a monotone board, 28 into 34.5
  {
    hand: '60007086',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '5dAc2hAd4h',
    board: '9c7cKc',
    pot: 34.5,
    toCall: 0.0,
    stack: 242.75,
    eff: 242.75,
    action: 'bet:56.0',
  },
  // 14ce2e81 CLEAR: turn, aces raised all in over 52.5 (the call is priced above every raise)
  {
    hand: '60005614',
    street: 'turn',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: 'As9h2s4sAc',
    board: '2h7cKd5h',
    pot: 210.5,
    toCall: 52.5,
    stack: 157.3,
    eff: 157.3,
    action: 'raise:314.6',
  },
  // ec169c45 LIKELY: turn, eights and a flush draw raised to 197.5 over 76.5
  {
    hand: '60012446',
    street: 'turn',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: 'Ts8h8sQcAc',
    board: '3s4c3c7s',
    pot: 178.5,
    toCall: 76.5,
    stack: 362.73,
    eff: 121.3,
    action: 'raise:395.0',
  },
];

/** Class 4: a made hand that called a flop bet (the price turns it into a raise). */
const CLASS_4: AuditRow[] = [
  // c97c0a7f LIKELY: trip sixes
  {
    hand: '60144236',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '5d5cAc6d7c',
    board: '6c2s6h',
    pot: 50.0,
    toCall: 21.5,
    stack: 186.5,
    eff: 186.5,
    action: 'call',
  },
  // 81bd6228 LIKELY: trip queens, top kicker, out of position
  {
    hand: '59973358',
    street: 'flop',
    ip: false,
    opps: 1,
    woowoo: true,
    cards: 'AhAcQc5hJc',
    board: '4cQdQh',
    pot: 60.5,
    toCall: 26.0,
    stack: 544.7,
    eff: 544.7,
    action: 'call',
  },
  // 3a223ea3 LIKELY: aces full of deuces
  {
    hand: '59989435',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '8sQh5h2dAd',
    board: '2c2hAh',
    pot: 45.0,
    toCall: 15.0,
    stack: 227.3,
    eff: 227.3,
    action: 'call',
  },
  // 284b2fb6 LIKELY: trip aces
  {
    hand: '60018347',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '6c4cTsAhQh',
    board: '7sAsAc',
    pot: 73.5,
    toCall: 31.5,
    stack: 194.25,
    eff: 194.25,
    action: 'call',
  },
  // 7ad316bd LIKELY: top two pair
  {
    hand: '59989137',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: 'Jh6h7cAc3h',
    board: 'Jd6c3s',
    pot: 57.0,
    toCall: 28.5,
    stack: 905.72,
    eff: 168.95,
    action: 'call',
  },
  // 21f51720 LIKELY: a pair with the nut flush draw
  {
    hand: '60120165',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: 'Ts4dAs8d5c',
    board: '2s4cJs',
    pot: 60.0,
    toCall: 30.0,
    stack: 184.75,
    eff: 184.75,
    action: 'call',
  },
  // e0cd1c65 LIKELY: the nut straight
  {
    hand: '60169065',
    street: 'flop',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '8cAd4dAhJd',
    board: 'Td9s7s',
    pot: 84.0,
    toCall: 42.0,
    stack: 192.25,
    eff: 192.25,
    action: 'call',
  },
];

describe('LAW: a bluff or thin bet is priced against the target (omahaBluffIsPricedAgainstTheTarget)', () => {
  it('class 2: off, the audited bet or raise stands (red); on, it is the check or the call (green)', () => {
    expect(CLASS_2.length).toBeGreaterThanOrEqual(5);
    for (const row of CLASS_2) {
      const { player, gs, decision } = auditSpot(row);
      const off = omahaBluffIsPricedAgainstTheTargetRule(decision, player, gs, OFF, auditRecordOf);
      expect(off, row.hand).toBe(decision);
      const on = omahaBluffIsPricedAgainstTheTargetRule(decision, player, gs, ON, auditRecordOf);
      if (row.toCall === 0) {
        expect(on.action, row.hand).toBe('check');
        expect(on.amount, row.hand).toBeUndefined();
        const v = omahaBluffBetVerdict(decision, player, gs, auditRecordOf);
        expect(v.kind, row.hand).toBe('priced');
        if (v.kind === 'priced') expect(v.evCheck, row.hand).toBeGreaterThanOrEqual(v.evBet);
        expect(omahaBluffPricedAdmitsCheck(player, gs), row.hand).toBe(true);
      } else {
        expect(on.action, row.hand).toBe('call');
        expect(on.amount, row.hand).toBe(row.toCall);
        expect(omahaBluffPricedAdmitsRaiseToCall(player, gs, on.amount), row.hand).toBe(true);
      }
    }
  });

  it('class 4: off, the audited flop call stands (red); on, it is a raise to a legal size (green)', () => {
    expect(CLASS_4.length).toBeGreaterThanOrEqual(5);
    for (const row of CLASS_4) {
      const { player, gs, decision } = auditSpot(row);
      const off = omahaBluffIsPricedAgainstTheTargetRule(decision, player, gs, OFF, auditRecordOf);
      expect(off, row.hand).toBe(decision);
      const on = omahaBluffIsPricedAgainstTheTargetRule(decision, player, gs, ON, auditRecordOf);
      expect(['raise', 'all_in'], row.hand).toContain(on.action);
      if (on.action === 'raise') {
        expect(on.amount!, row.hand).toBeGreaterThanOrEqual((gs.minRaiseTo as number) - 1e-9);
        expect(on.amount!, row.hand).toBeLessThanOrEqual((gs.maxRaiseTo as number) + 1e-9);
      }
    }
  });

  it('the same hands in a table pool (not Lightning) are priced alike', () => {
    for (const row of [...CLASS_2, ...CLASS_4]) {
      const { player, gs, decision } = auditSpot(row);
      const table = { ...gs, publicMemoryDomain: { speed: 'table' } } as unknown as typeof gs;
      const lightning = omahaBluffIsPricedAgainstTheTargetRule(
        decision,
        player,
        gs,
        ON,
        auditRecordOf
      );
      const atTable = omahaBluffIsPricedAgainstTheTargetRule(
        decision,
        player,
        table,
        ON,
        auditRecordOf
      );
      expect(atTable, row.hand).toEqual(lightning);
    }
  });
});
