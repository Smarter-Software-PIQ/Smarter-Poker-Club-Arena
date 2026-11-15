/**
 * LAW: a fixed-limit hand at a TOURNAMENT table plays by the level it was
 * dealt at, in whole tournament chips, capped at four wagers at every table
 * size, never as a kill pot, and settles every chip it took in.
 * ═══════════════════════════════════════════════════════════════════════════
 * Written 2026-11-15 by the Fixed-Limit lane as the prerequisite Hand Analysis
 * set for the first scheduled FLH / FLO8 freezeouts (review of 7c991ef8:
 * ACCEPT WITH NOTES, merge blocked until these tests exist). Before this file
 * no test played a fixed-limit hand at a tournament table: every fixed-limit
 * test used cash fixtures (S-FL-TOURNAMENT-READINESS section 3).
 *
 * LAYER. The real HandController, given the HandConfig a tournament table
 * builds in ServerTableEngineDealing (isTournament true, blinds and ante from
 * the table's current level, the dead-button blind seats, the tournament rake
 * of zero, killPot from the real KillPotSchedule.decide), and the real
 * KillPotSchedule.settle fed the hand's own pots and awards as
 * ServerTableEngineBase.settleKillPot feeds it. The table engine itself (its
 * database, timers and level clock) is not started: `dealFromTable` below is
 * the one place that mirrors its HandConfig fields, and it reads the level from
 * a table row exactly as refreshBlindsFromDb leaves it (small_blind, big_blind,
 * ante), so a level change is a change of that row between hands.
 *
 * LADDER. The scheduled FLH / FLO8 events copy the PLO8 template's blind
 * profile B11 (owner sheet 2026-11-07-v1): level 1 is 25/25, level 2 is 25/50,
 * level 12 (the last late-registration level) is 500/1000, no antes at any
 * level. Starting stack 5,000.
 *
 * WHAT IS PINNED (Hand Analysis's list, N1 and N2 included):
 *   1. N1: at level 1 (25/25) the small blind equals the small bet, so the
 *      small blind has nothing to complete; preflop and flop wagers are 25,
 *      turn and river 50; every amount is a whole chip.
 *   2. A level change reaches the NEXT hand only: the hand in progress keeps
 *      the units it was dealt with.
 *   3. Heads-up is capped at four wagers like every other table size.
 *   4. FLO8: a short all-in creates a side pot, the low needs an 8-or-better
 *      qualifier, and the odd chip of a split half goes out as a whole chip.
 *   5. (asserted after every hand) Settlement conserves chips: stacks after the hand sum to stacks before
 *      it, no rake is taken, every stack is a whole number.
 *   6. Kill pots are not active in tournaments: a scooped tournament pot over
 *      the threshold triggers nothing, and a pending kill is cancelled.
 *   7. N2: a late registrant at level 12 holding 2.5 big bets (5,000) gets the
 *      legal fixed-limit menus and a short all-in that is a call for less, not
 *      a raise.
 * Each pinned behaviour is played for both flh and flo8 where it applies.
 */
import { describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import { KillPotSchedule, type KillSettings, handFixedLimitSmallBet } from './KillPot.js';
import type { Card, GameVariant, HandConfig, HandEvent, SeatPlayer } from '../types.js';
import { RANKS, SUITS } from './PokerEngine.js';

// ── B11, as installed by the owner sheet (no antes at any level) ───────────
const B11 = {
  1: { small_blind: 25, big_blind: 25, ante: 0 },
  2: { small_blind: 25, big_blind: 50, ante: 0 },
  12: { small_blind: 500, big_blind: 1000, ante: 0 },
} as const;
type Level = keyof typeof B11;

const VARIANTS: GameVariant[] = ['flh', 'flo8'];
const TOURNAMENT_RAKE = { percent: 0, cap: 0, noFlopNoDrop: true };
const KILL_ON: KillSettings = { mode: 'full', thresholdBb: 8 };

// ── cards ──────────────────────────────────────────────────────────────────
const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (t: string): Card[] =>
  t
    .trim()
    .split(/\s+/)
    .map((c) => ({ rank: c[0] as Card['rank'], suit: SUIT[c[1] as keyof typeof SUIT] }));
const key = (c: Card) => `${c.rank}${c.suit}`;
/** Hole cards in seat order, then flop, turn, river; the rest of the deck after. */
function deckOrder(holes: string[], board: string): Card[] {
  const order = [...holes.flatMap(cards), ...cards(board)];
  const seen = new Set(order.map(key));
  if (seen.size !== order.length) throw new Error('rig deals a card twice');
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const c = { rank, suit } as Card;
      if (!seen.has(key(c))) order.push(c);
    }
  return order;
}

// ── the tournament table ───────────────────────────────────────────────────
interface TableRow {
  tournament_id: string;
  game_variant: GameVariant;
  small_blind: number;
  big_blind: number;
  ante: number;
  big_blind_ante_enabled: boolean;
}
const tableAt = (variant: GameVariant, level: Level): TableRow => ({
  tournament_id: 'fl-tournament-test',
  game_variant: variant,
  ...B11[level],
  big_blind_ante_enabled: false,
});
/** What refreshBlindsFromDb does on a level change: rewrite the row's blinds. */
const levelUp = (row: TableRow, level: Level) => Object.assign(row, B11[level]);

interface Seat {
  stack: number;
  hole?: string;
}
let handCounter = 0;

/**
 * Deals one hand the way ServerTableEngineDealing does for a tournament table:
 * the HandConfig is built from the table row at the deal, the kill decision is
 * the real schedule's, and the blind seats are told to the controller.
 */
function dealFromTable(
  row: TableRow,
  seats: Seat[],
  opts: { dealer: number; sb: number; bb: number; board?: string; kill?: KillPotSchedule }
) {
  const players: SeatPlayer[] = seats.map((s, i) => ({
    seat: i + 1,
    user_id: `u${i + 1}`,
    username: `P${i + 1}`,
    stack: s.stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const schedule = opts.kill ?? new KillPotSchedule();
  const killDecision = schedule.decide({
    settings: KILL_ON,
    variant: row.game_variant,
    isTournament: true,
    isBombHand: false,
    asset: 'chips',
    baseBigBlind: Number(row.big_blind),
    roster: players.map((p) => ({ userId: p.user_id, seat: p.seat })),
    sbSeat: opts.sb,
    bbSeat: opts.bb,
  });
  const config: HandConfig = {
    asset: 'chips',
    tableId: 'fl-tournament-table',
    handNumber: ++handCounter,
    isTournament: true,
    gameVariant: row.game_variant,
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    ante: row.tournament_id ? row.ante : undefined,
    bigBlindAnte: row.big_blind_ante_enabled ?? false,
    allInOrFold: false,
    killPot: killDecision.kind === 'kill' ? killDecision.hand : undefined,
    blindSeats: { smallBlind: opts.sb, bigBlind: opts.bb },
    rakeConfig: TOURNAMENT_RAKE,
  } as HandConfig;
  const hc = new HandController(config, players, opts.dealer);
  schedule.commitDeal(killDecision);
  const internal = hc as unknown as { state: { deck: { cards: Card[] } } & Record<string, any> };
  if (opts.board) {
    internal.state.deck.cards = deckOrder(
      seats.map((s) => s.hole ?? ''),
      opts.board
    );
  }
  const events: HandEvent[] = [];
  hc.onEvent((e) => events.push(e));
  const before = seats.reduce((s, p) => s + p.stack, 0);
  hc.start();
  if (opts.board) {
    hc.getState().players.forEach((p, i) => {
      if (p.cards.map(key).join() !== cards(seats[i].hole!).map(key).join())
        throw new Error('rigged hole cards were not dealt as specified');
    });
  }
  const st = () => internal.state;
  const cur = () => st().currentPlayerSeat as number;
  const seat = (n: number) => st().players.find((p: SeatPlayer) => p.seat === n) as SeatPlayer;
  const menu = () => {
    const m = hc.getAuthoritativeActionState(seat(cur()).user_id)!;
    return {
      seat: cur(),
      stage: st().stage as string,
      legal: m.legalActions as string[],
      toCall: m.toCall,
      min: m.minRaiseTo,
      max: m.maxRaiseTo,
      fixed: m.fixedBetSize,
      capped: m.wagersCapped,
    };
  };
  const act = (a: string, amt?: number) => hc.performAction(cur(), a as never, amt);
  const last = () => {
    const h = st().actionHistory;
    const r = h[h.length - 1];
    return { seat: r.seat, action: r.action, amount: r.amount, stage: r.stage };
  };
  const done = () => events.some((e) => e.type === 'HAND_COMPLETE');
  /** Finish the hand (run out an all-in board if needed) and read the settlement. */
  const settle = () => {
    if (!done()) hc.continueRunout();
    const complete = events.find((e) => e.type === 'HAND_COMPLETE') as
      | Extract<HandEvent, { type: 'HAND_COMPLETE' }>
      | undefined;
    expect(complete, 'the hand completed').toBeDefined();
    const winners = events.find((e) => e.type === 'WINNERS') as
      | Extract<HandEvent, { type: 'WINNERS' }>
      | undefined;
    const stacks = Object.fromEntries(
      hc.getState().players.map((p) => [p.user_id, p.stack] as [string, number])
    );
    return { complete: complete!, winners, stacks };
  };
  return { hc, config, events, st, cur, seat, menu, act, last, settle, before, schedule };
}
type Hand = ReturnType<typeof dealFromTable>;

const callAround = (t: Hand, stage: string) => {
  let guard = 0;
  while (t.st().stage === stage && t.cur() > 0 && guard++ < 20) {
    const m = t.menu();
    expect(t.act(m.toCall > 0 ? 'call' : 'check')).toBe(true);
  }
};

/** Pinned behaviour 5, asserted after every hand this file plays. */
function expectConserved(t: Hand, settled: ReturnType<Hand['settle']>) {
  const after = Object.values(settled.stacks).reduce((s, v) => s + v, 0);
  expect(after).toBe(t.before);
  expect(settled.complete.rake).toBe(0);
  expect(settled.complete.bbjFee).toBe(0);
  for (const v of Object.values(settled.stacks)) expect(Number.isInteger(v)).toBe(true);
  for (const w of settled.winners?.perPotAwards ?? [])
    expect(Number.isInteger(w.amount)).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. N1: level 1 of B11 is 25/25 and plays as a 25/50 fixed-limit game', () => {
  for (const v of VARIANTS) {
    it(`${v}: the small blind has nothing to complete; 25 preflop and flop, 50 turn and river; whole chips`, () => {
      const t = dealFromTable(tableAt(v, 1), [{ stack: 5000 }, { stack: 5000 }, { stack: 5000 }], {
        dealer: 1,
        sb: 2,
        bb: 3,
      });
      expect(t.hc.getChipRulesSnapshot().chipUnit).toBe(1);
      // Both blinds are 25 and there is no ante.
      expect(t.seat(2).bet).toBe(25);
      expect(t.seat(3).bet).toBe(25);
      expect(t.seat(1).bet).toBe(0);
      expect(t.st().players.reduce((s: number, p: SeatPlayer) => s + p.totalInvested, 0)).toBe(50);

      // Button first: call 25 or raise to 50 (one small bet of 25).
      const btn = t.menu();
      expect(btn.seat).toBe(1);
      expect([btn.toCall, btn.fixed, btn.min, btn.max]).toEqual([25, 25, 50, 50]);
      expect(t.act('raise', 75)).toBe(false);
      expect(t.act('call')).toBe(true);

      // Small blind: already in for the full small bet, nothing to complete.
      const sb = t.menu();
      expect(sb.seat).toBe(2);
      expect(sb.toCall).toBe(0);
      expect(sb.legal).toContain('check');
      expect(sb.legal).not.toContain('call');
      expect([sb.fixed, sb.min, sb.max]).toEqual([25, 50, 50]);
      expect(t.act('check')).toBe(true);
      const bb = t.menu();
      expect(bb.toCall).toBe(0);
      expect([bb.fixed, bb.min, bb.max]).toEqual([25, 50, 50]);
      expect(t.act('check')).toBe(true);

      for (const [stage, size] of [
        ['flop', 25],
        ['turn', 50],
        ['river', 50],
      ] as const) {
        expect(t.st().stage).toBe(stage);
        const m = t.menu();
        expect([m.fixed, m.min, m.max]).toEqual([size, size, size]);
        expect(t.act('bet', size + 1)).toBe(false);
        expect(t.act('bet', size)).toBe(true);
        const r = t.menu();
        expect([r.toCall, r.min, r.max]).toEqual([size, 2 * size, 2 * size]);
        callAround(t, stage);
      }
      expectConserved(t, t.settle());
    });

    it(`${v}: preflop at level 1 caps at four wagers (the big blind is the first): 25, 50, 75, 100`, () => {
      const t = dealFromTable(tableAt(v, 1), [{ stack: 5000 }, { stack: 5000 }, { stack: 5000 }], {
        dealer: 1,
        sb: 2,
        bb: 3,
      });
      expect(t.act('raise', 50)).toBe(true);
      expect(t.act('raise', 75)).toBe(true);
      expect(t.act('raise', 100)).toBe(true);
      const m = t.menu();
      expect(m.capped).toBe(true);
      expect(m.legal).not.toContain('raise');
      expect(m.toCall).toBe(50); // the button is in for 50 and faces 100
      expect(t.act('raise', 125)).toBe(false);
      callAround(t, 'preflop');
      expect(t.st().stage).toBe('flop');
      expect(t.st().players.every((p: SeatPlayer) => p.totalInvested === 100)).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. a level change reaches the next hand only', () => {
  for (const v of VARIANTS) {
    it(`${v}: level 1 -> 2 during a hand: that hand keeps 25/50 units, the next is dealt at 50/100`, () => {
      const row = tableAt(v, 1);
      const seats = [{ stack: 5000 }, { stack: 5000 }, { stack: 5000 }];
      const h1 = dealFromTable(row, seats, { dealer: 1, sb: 2, bb: 3 });
      callAround(h1, 'preflop');
      expect(h1.st().stage).toBe('flop');
      // The level clock ticks while the flop is being played.
      levelUp(row, 2);
      expect(row.big_blind).toBe(50);
      const flop = h1.menu();
      expect([flop.fixed, flop.min, flop.max]).toEqual([25, 25, 25]);
      expect(h1.act('bet', 25)).toBe(true);
      callAround(h1, 'flop');
      const turn = h1.menu();
      expect([turn.fixed, turn.min, turn.max]).toEqual([50, 50, 50]);
      expect(h1.act('bet', 100)).toBe(false);
      expect(h1.act('bet', 50)).toBe(true);
      callAround(h1, 'turn');
      callAround(h1, 'river');
      const s1 = h1.settle();
      expectConserved(h1, s1);

      // Next hand: dealt from the row as it now stands (level 2, 25/50).
      const h2 = dealFromTable(
        row,
        [1, 2, 3].map((n) => ({ stack: s1.stacks[`u${n}`] })),
        { dealer: 2, sb: 3, bb: 1 }
      );
      expect(h2.config.smallBlind).toBe(25);
      expect(h2.config.bigBlind).toBe(50);
      expect(h2.seat(3).bet).toBe(25);
      expect(h2.seat(1).bet).toBe(50);
      const pre = h2.menu();
      expect([pre.toCall, pre.fixed, pre.min, pre.max]).toEqual([50, 50, 100, 100]);
      // The small blind (25) now has 25 to complete: a call, not a free check.
      expect(h2.act('call')).toBe(true);
      const sb = h2.menu();
      expect(sb.seat).toBe(3);
      expect(sb.toCall).toBe(25);
      expect(sb.legal).not.toContain('check');
      callAround(h2, 'preflop');
      const flop2 = h2.menu();
      expect([flop2.fixed, flop2.min, flop2.max]).toEqual([50, 50, 50]);
      callAround(h2, 'flop');
      const turn2 = h2.menu();
      expect([turn2.fixed, turn2.min, turn2.max]).toEqual([100, 100, 100]);
      callAround(h2, 'turn');
      callAround(h2, 'river');
      expectConserved(h2, h2.settle());
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. heads-up is capped at four wagers (no heads-up exception)', () => {
  for (const v of VARIANTS) {
    it(`${v}: preflop 25-50-75-100 and turn 50-100-150-200, then no raise`, () => {
      const t = dealFromTable(tableAt(v, 1), [{ stack: 5000 }, { stack: 5000 }], {
        dealer: 1,
        sb: 1,
        bb: 2,
      });
      const first = t.menu();
      expect(first.seat).toBe(1);
      expect(first.toCall).toBe(0); // the button's small blind is the full small bet
      expect(t.act('raise', 50)).toBe(true);
      expect(t.act('raise', 75)).toBe(true);
      expect(t.act('raise', 100)).toBe(true);
      const pre = t.menu();
      expect(pre.capped).toBe(true);
      expect(pre.legal).not.toContain('raise');
      expect(t.act('raise', 125)).toBe(false);
      expect(t.act('call')).toBe(true);
      callAround(t, 'flop');
      expect(t.st().stage).toBe('turn');
      for (const [a, to] of [
        ['bet', 50],
        ['raise', 100],
        ['raise', 150],
        ['raise', 200],
      ] as const)
        expect(t.act(a, to)).toBe(true);
      const turn = t.menu();
      expect(turn.capped).toBe(true);
      expect(turn.legal).not.toContain('raise');
      expect(t.act('raise', 250)).toBe(false);
      // An all-in press on a capped street is a call, never a shove.
      const before = t.seat(t.cur()).stack;
      const s = t.cur();
      expect(t.act('all_in')).toBe(true);
      expect(t.last().action).toBe('call');
      expect(before - t.seat(s).stack).toBe(50);
      callAround(t, 'river');
      expectConserved(t, t.settle());
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. FLO8 split pot with a short all-in: side pot, low qualifier, odd chip', () => {
  it('flo8 level 1: a 15-chip all-in, main pot 45 split high 23 / low 22, side pot 170 split 85 / 85', () => {
    // Board 2c 4d 7h Kc Qs: three low cards, so a low is possible.
    //   seat 1 (button, 15 chips): As 3h Jd Jc -> low 7-4-3-2-A (the best low)
    //   seat 2: Kh Ks 9d 9c                 -> high: three kings; no low
    //   seat 3: 6s 8s Ts Td                 -> low 8-7-6-4-2 (qualifies, loses to seat 1)
    const t = dealFromTable(
      tableAt('flo8', 1),
      [
        { stack: 15, hole: 'As 3h Jd Jc' },
        { stack: 5000, hole: 'Kh Ks 9d 9c' },
        { stack: 5000, hole: '6s 8s Ts Td' },
      ],
      { dealer: 1, sb: 2, bb: 3, board: '2c 4d 7h Kc Qs' }
    );
    const short = t.menu();
    expect(short.seat).toBe(1);
    expect(short.legal).toContain('all_in');
    expect(short.legal).not.toContain('raise');
    expect(t.act('all_in')).toBe(true);
    // Recorded as an all-in for 15, less than the 25 to call: not a raise.
    expect(t.last().action).toBe('all_in');
    expect(t.seat(1).totalInvested).toBe(15);
    expect(t.seat(1).is_all_in).toBe(true);
    // Neither blind has anything to complete at 25/25; an all-in for less is not a raise.
    const sb = t.menu();
    expect(sb.seat).toBe(2);
    expect(sb.toCall).toBe(0);
    expect(t.act('check')).toBe(true);
    expect(t.act('check')).toBe(true);
    expect(t.st().stage).toBe('flop');
    expect(t.act('bet', 25)).toBe(true);
    expect(t.act('call')).toBe(true);
    expect(t.st().stage).toBe('turn');
    expect(t.act('bet', 50)).toBe(true);
    expect(t.act('call')).toBe(true);
    expect(t.st().stage).toBe('river');
    const pots = t.hc
      .computeLivePots()
      .map((p) => ({ amount: p.amount, elig: [...p.eligiblePlayers].sort() }));
    expect(pots).toEqual([
      { amount: 45, elig: ['u1', 'u2', 'u3'] },
      { amount: 170, elig: ['u2', 'u3'] },
    ]);
    expect(t.act('check')).toBe(true);
    expect(t.act('check')).toBe(true);
    const s = t.settle();
    expectConserved(t, s);
    // Main pot 45: high half 23 (the odd chip goes to high), low half 22.
    // Side pot 170: seat 1 is not eligible; high 85 to seat 2, low 85 to seat 3.
    expect(s.stacks).toEqual({ u1: 22, u2: 5000 - 100 + 23 + 85, u3: 5000 - 100 + 85 });
    const awards = (s.winners?.perPotAwards ?? [])
      .map((a) => [a.potIndex, a.low ? 'LO' : 'HI', a.userId, a.amount])
      .sort();
    expect(awards).toEqual(
      [
        [0, 'HI', 'u2', 23],
        [0, 'LO', 'u1', 22],
        [1, 'HI', 'u2', 85],
        [1, 'LO', 'u3', 85],
      ].sort()
    );
  });

  it('flo8: with no qualifying low the high hand takes the whole pot (no low half invented)', () => {
    // Board 9c Td Jh Kc 2s: only one card 8 or lower, so no low can qualify.
    const t = dealFromTable(
      tableAt('flo8', 1),
      [
        { stack: 15, hole: 'As 3h 4d 5c' },
        { stack: 5000, hole: 'Kh Ks 9d 8c' },
        { stack: 5000, hole: '6s 7s Ts 3d' },
      ],
      { dealer: 1, sb: 2, bb: 3, board: '9c Td Jh Kc 2s' }
    );
    expect(t.act('all_in')).toBe(true);
    callAround(t, 'preflop');
    callAround(t, 'flop');
    callAround(t, 'turn');
    callAround(t, 'river');
    const s = t.settle();
    expectConserved(t, s);
    expect((s.winners?.perPotAwards ?? []).some((a) => a.low)).toBe(false);
    // Three kings scoops both pots: the main pot of 45 and the side pot of 20.
    expect(s.stacks.u1).toBe(0);
    expect(s.stacks.u2).toBe(5000 - 25 + 45 + 20);
    expect(s.stacks.u3).toBe(5000 - 25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. kill pots are not active in tournaments', () => {
  for (const v of VARIANTS) {
    it(`${v}: a scooped tournament pot above the threshold triggers no kill; a pending kill is cancelled`, () => {
      const schedule = new KillPotSchedule();
      const t = dealFromTable(tableAt(v, 1), [{ stack: 5000 }, { stack: 5000 }], {
        dealer: 1,
        sb: 1,
        bb: 2,
        kill: schedule,
      });
      expect(t.config.killPot).toBeUndefined();
      // Cap preflop (200 contested = 8 big blinds), then the big blind folds the flop.
      expect(t.act('raise', 50)).toBe(true);
      expect(t.act('raise', 75)).toBe(true);
      expect(t.act('raise', 100)).toBe(true);
      expect(t.act('call')).toBe(true);
      expect(t.st().stage).toBe('flop');
      const flopFirst = t.cur();
      expect(t.act('bet', 25)).toBe(true);
      expect(t.act('fold')).toBe(true);
      const s = t.settle();
      expectConserved(t, s);
      const awards = (s.winners?.perPotAwards ?? []).map((a) => ({
        userId: a.userId,
        potIndex: a.potIndex,
        low: a.low,
        board: null,
      }));
      const byPot = new Map<number, number>();
      for (const a of s.winners?.perPotAwards ?? [])
        byPot.set(a.potIndex, (byPot.get(a.potIndex) ?? 0) + a.amount);
      const pots = [...byPot].map(([index, amount]) => ({ index, amount }));
      const contestedTotal = pots.reduce((sum, p) => sum + p.amount, 0);
      expect(contestedTotal).toBe(200);
      const seatOf = (u: string) => (u === 'u1' ? 1 : u === 'u2' ? 2 : null);
      const input = {
        handNumber: t.config.handNumber,
        settings: KILL_ON,
        variant: v,
        isBombHand: false,
        asset: 'chips' as const,
        baseBigBlind: 25,
        killHand: null,
        pots,
        awards,
        contestedTotal,
        seatOf,
        cancellation: null,
      };
      // Control: the same settlement at a cash table WOULD trigger a kill,
      // so the tournament result below is the tournament rule, not a miss.
      const cash = new KillPotSchedule().settle({ ...input, isTournament: false });
      expect(cash.trigger.outcome).toBe('triggered');
      expect(cash.trigger.pending?.killerUserId).toBe(`u${flopFirst}`);

      const tour = schedule.settle({ ...input, isTournament: true });
      expect(tour.trigger.outcome).toBe('tournament');
      expect(tour.trigger.pending).toBeNull();
      expect(schedule.getPending()).toBeNull();

      // A pending kill carried into a tournament deal (for instance restored
      // from a row) is cancelled at the deal, and the hand plays base units.
      schedule.restore(cash.trigger.pending);
      const next = dealFromTable(tableAt(v, 1), [{ stack: 5000 }, { stack: 5000 }], {
        dealer: 2,
        sb: 2,
        bb: 1,
        kill: schedule,
      });
      expect(next.config.killPot).toBeUndefined();
      expect(schedule.getPending()).toBeNull();
      expect(handFixedLimitSmallBet(next.config)).toBe(25);
      const m = next.menu();
      expect([m.fixed, m.min, m.max]).toEqual([25, 50, 50]);
      const decision = new KillPotSchedule();
      decision.restore(cash.trigger.pending);
      const d = decision.decide({
        settings: KILL_ON,
        variant: v,
        isTournament: true,
        isBombHand: false,
        asset: 'chips',
        baseBigBlind: 25,
        roster: [
          { userId: 'u1', seat: 1 },
          { userId: 'u2', seat: 2 },
        ],
        sbSeat: 2,
        bbSeat: 1,
      });
      expect(d.kind).toBe('cancel');
      expect(d.kind === 'cancel' && d.cancellation.reason).toBe('tournament');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. N2: a late registrant at level 12 with 2.5 big bets (5,000 at 500/1000)', () => {
  for (const v of VARIANTS) {
    it(`${v}: legal menus at 1000/2000 and a turn all-in for less that is a call, not a raise`, () => {
      const t = dealFromTable(
        tableAt(v, 12),
        [{ stack: 5000 }, { stack: 20000 }, { stack: 20000 }],
        { dealer: 1, sb: 2, bb: 3 }
      );
      expect(t.seat(2).bet).toBe(500);
      expect(t.seat(3).bet).toBe(1000);
      // Late registrant on the button: call 1000 or raise to 2000; nothing else.
      const pre = t.menu();
      expect(pre.seat).toBe(1);
      expect([pre.toCall, pre.fixed, pre.min, pre.max]).toEqual([1000, 1000, 2000, 2000]);
      expect(pre.legal).toEqual(expect.arrayContaining(['fold', 'call', 'raise']));
      expect(t.act('raise', 2500)).toBe(false);
      expect(t.act('raise', 2000)).toBe(true);
      const sb = t.menu();
      expect(sb.toCall).toBe(1500);
      expect(t.act('call')).toBe(true);
      expect(t.act('call')).toBe(true);
      expect(t.seat(1).stack).toBe(3000);

      // Flop (small bet 1000): bet, raise; the short stack calls the raise.
      expect(t.st().stage).toBe('flop');
      expect(t.act('bet', 1000)).toBe(true);
      expect(t.act('raise', 2000)).toBe(true);
      const facing = t.menu();
      expect(facing.seat).toBe(1);
      expect([facing.toCall, facing.min, facing.max]).toEqual([2000, 3000, 3000]);
      expect(t.act('call')).toBe(true);
      expect(t.act('call')).toBe(true);
      expect(t.seat(1).stack).toBe(1000);

      // Turn (big bet 2000): the short stack has half a big bet behind.
      expect(t.st().stage).toBe('turn');
      expect(t.act('check')).toBe(true);
      expect(t.act('bet', 2000)).toBe(true);
      const short = t.menu();
      expect(short.seat).toBe(1);
      expect(short.toCall).toBeGreaterThanOrEqual(1000);
      expect(short.legal).toContain('all_in');
      expect(short.legal).not.toContain('raise');
      expect(t.act('raise', 4000)).toBe(false);
      expect(t.act('all_in')).toBe(true);
      expect(t.last().action).toBe('all_in');
      expect(t.seat(1).stack).toBe(0);
      expect(t.seat(1).totalInvested).toBe(5000);
      // The all-in for less is not a raise: the player behind still faces the
      // full 2000 bet and may raise exactly one big bet, to 4000.
      const behind = t.menu();
      expect(behind.seat).toBe(2);
      expect([behind.toCall, behind.min, behind.max]).toEqual([2000, 4000, 4000]);
      expect(t.act('call')).toBe(true);

      expect(t.st().stage).toBe('river');
      const pots = t.hc
        .computeLivePots()
        .map((p) => ({ amount: p.amount, elig: [...p.eligiblePlayers].sort() }));
      expect(pots).toEqual([
        { amount: 15000, elig: ['u1', 'u2', 'u3'] },
        { amount: 2000, elig: ['u2', 'u3'] },
      ]);
      // River between the two covered players only.
      const river = t.menu();
      expect([river.fixed, river.min, river.max]).toEqual([2000, 2000, 2000]);
      expect(t.act('bet', 2000)).toBe(true);
      expect(t.act('call')).toBe(true);
      const s = t.settle();
      expectConserved(t, s);
      // The short stack can win at most the main pot.
      expect(s.stacks.u1).toBeLessThanOrEqual(15000);
      for (const a of s.winners?.perPotAwards ?? [])
        if (a.userId === 'u1') expect(a.potIndex).toBe(0);
    });
  }
});
