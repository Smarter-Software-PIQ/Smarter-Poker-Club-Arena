/**
 * V77 SEAT-AWARE SHORT-STACK JAMS (2026-11-02, Burls via Dan: "JAMMING ALL
 * IN TOO MUCH, THEY AREN'T CONSIDERING THE UTG OR EARLY POSITION OPENERS"):
 * the five things the seat tighten may never change.
 *
 *  1. Tighten only, and nested: at the push/fold node a hand that jams over
 *     an EARLY open also jams over a LATE open at the same stack and price,
 *     and V77 never ADDS a jam the seat-blind bar refused.
 *  2. The widest (late reference, 40%+) opener width keeps today's bar
 *     exactly: the term is zero there, monotone in width, capped at 0.10.
 *  3. The first-in jam (raises 0) is untouched.
 *  4. The off arm is exactly today: without the width field the node is the
 *     seat-blind bar, bit for bit.
 *  5. One policy for every opponent (Dan 2026-10-27): flipping horse/human
 *     labels never changes the answer end to end.
 */
import { describe, expect, it } from 'vitest';
import { decidePreflopV7, v77JamSeatTighten } from './HorsePreflop.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { openWidth } from './HorseGtoVs3BetRanges.js';
import { holeFor } from './HorseVs3BetDefence.test-support.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

// Width anchors from the live V70 table (9-handed, dealt census indexing:
// SB 1 ... UTG 8).
const UTG_W = openWidth(8, true, 9);
const BTN_W = openWidth(2, true, 9);

function brainCtx(extra: Record<string, unknown> = {}) {
  return {
    position: 'bb' as const,
    strength: 0.5,
    raises: 1,
    raiserPosition: 'early' as const,
    limpers: 0,
    callers: 0,
    oppsLeft: 1,
    toCall: 1300,
    currentBet: 2300,
    pot: 4800,
    bigBlind: 1000,
    stack: 11000,
    stackBB: 11,
    tightness: 1,
    bluffFreq: 0.1,
    aggression: 1,
    slowplayFreq: 0.1,
    sizingMultiplier: 1,
    isOmaha: false,
    isPotLimit: false,
    riskAdd: 0.04,
    mode: 'tournament' as const,
    anteInPlay: true,
    anteOrbitBB: 1.0,
    tableSize: 9,
    v13: true,
    rand: () => 0.5,
    ...extra,
  };
}

describe('V77 the seat-aware jam keeps the owner rules', () => {
  it('the term is zero at the late reference, monotone in width, capped at 0.10', () => {
    expect(v77JamSeatTighten(40)).toBe(0);
    expect(v77JamSeatTighten(45)).toBe(0);
    let prev = v77JamSeatTighten(40);
    for (const w of [35, 30, 25, 20, 16, 12, 8]) {
      const t = v77JamSeatTighten(w);
      expect(t).toBeGreaterThanOrEqual(prev);
      expect(t).toBeLessThanOrEqual(0.1);
      prev = t;
    }
    // The anchors the production table supplies keep the ordering.
    expect(v77JamSeatTighten(UTG_W)).toBeGreaterThan(v77JamSeatTighten(BTN_W));
  });

  it('tighten only, and nested: a jam over an early open is a jam over a late one; no new jams', () => {
    for (const strength of [0.5, 0.62, 0.7, 0.74, 0.78, 0.82, 0.9]) {
      for (const stackBB of [8, 11, 14]) {
        const early = decidePreflopV7(
          brainCtx({ strength, stackBB, stack: stackBB * 1000, openerOpenWidthPct: UTG_W }) as never
        );
        const late = decidePreflopV7(
          brainCtx({
            strength,
            stackBB,
            stack: stackBB * 1000,
            raiserPosition: 'late',
            openerOpenWidthPct: BTN_W,
          }) as never
        );
        const off = decidePreflopV7(
          brainCtx({ strength, stackBB, stack: stackBB * 1000 }) as never
        );
        if (early.a === 'jam') expect(late.a, `s=${strength} ${stackBB}bb`).toBe('jam');
        // V77 never adds a jam the seat-blind bar refused.
        if (early.a === 'jam') expect(off.a, `s=${strength} ${stackBB}bb off`).toBe('jam');
      }
    }
  });

  it('the first-in jam is untouched: the width field never reaches an unopened pot', () => {
    for (const strength of [0.6, 0.75, 0.9]) {
      const a = decidePreflopV7(
        brainCtx({ raises: 0, toCall: 1000, currentBet: 1000, pot: 2500, strength }) as never
      );
      const b = decidePreflopV7(
        brainCtx({
          raises: 0,
          toCall: 1000,
          currentBet: 1000,
          pot: 2500,
          strength,
          openerOpenWidthPct: UTG_W,
        }) as never
      );
      // raises === 1 is inside the V77 gate, so even a stray width changes nothing.
      expect(b.a).toBe(a.a);
    }
  });

  it('the off arm is exactly today: no width field means the seat-blind bar, every strength', () => {
    for (let s = 0.4; s <= 0.95; s += 0.05) {
      const off = decidePreflopV7(brainCtx({ strength: s }) as never);
      const zeroWidth = decidePreflopV7(brainCtx({ strength: s, openerOpenWidthPct: 40 }) as never);
      expect(zeroWidth.a, `s=${s.toFixed(2)}`).toBe(off.a);
    }
  });

  it('one policy: flipping the horse/human labels never changes the answer end to end', () => {
    const BB = 2;
    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
    const RANKS = 'AKQJT98765432'.split('');
    function state(openerSeat: number, hole: Card[], flip: boolean) {
      const n = 9;
      const used = new Set(hole.map((h) => h.rank + h.suit));
      const deck: Card[] = [];
      for (const r of RANKS)
        for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
      const heroSeat = 2; // the big blind, 11bb
      const openTo = 2.3 * BB;
      const players: SeatPlayer[] = [];
      for (let seat = 1; seat <= n; seat++) {
        const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
        const bet = seat === openerSeat ? openTo : blind;
        const ante = seat === 2 ? 2 : 0;
        const stackTotal = seat === heroSeat ? 11 * BB : 60 * BB;
        players.push({
          seat,
          user_id: `j-${seat}`,
          username: `J${seat}`,
          stack: stackTotal - bet - ante,
          bet,
          totalInvested: bet + ante,
          cards: seat === heroSeat ? hole : [deck[seat * 2], deck[seat * 2 + 1]],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
          is_horse: flip ? seat === heroSeat : true,
        } as SeatPlayer);
      }
      const history: ActionRecord[] = [];
      let ts = 100;
      const order = [...Array(n - 2).keys()].map((k) => 3 + k).concat([1]);
      for (const seat of order) {
        if (seat === openerSeat) {
          history.push({
            seat,
            userId: players[seat - 1].user_id,
            action: 'raise',
            amount: openTo,
            timestamp: ts++,
            stage: 'preflop',
            isFullRaise: true,
          } as ActionRecord);
        } else {
          players[seat - 1].is_folded = true;
          history.push({
            seat,
            userId: players[seat - 1].user_id,
            action: 'fold',
            amount: 0,
            timestamp: ts++,
            stage: 'preflop',
          } as ActionRecord);
        }
      }
      const bets = players.reduce((s, p) => s + p.bet, 0);
      const gs = {
        players,
        communityCards: [],
        pot: bets + 2,
        currentBet: openTo,
        minRaise: openTo - BB,
        lastRaise: openTo - BB,
        stage: 'preflop',
        gameVariant: 'nlh',
        bigBlind: BB,
        dealerSeat: n,
        actionHistory: history,
        gameMode: 'tournament',
        ante: 2,
        bigBlindAnte: true,
        format: 'mtt',
        dealtSeatIds: players.map((p) => p.seat),
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        toCall: openTo - players[heroSeat - 1].bet,
        minRaiseTo: 2 * openTo - BB,
        maxRaiseTo: players[heroSeat - 1].stack + players[heroSeat - 1].bet,
        tournament: {
          schemaVersion: 1,
          contextStatus: 'complete',
          contextIssues: [],
          playersLeft: 180,
          spotsPaid: 30,
          entrants: 300,
          avgStackChips: 40 * BB,
          medianStackChips: 40 * BB,
          seatsPerTable: n,
          playersAtTable: n,
          nearBubble: false,
          inMoney: false,
          payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
          currentSmallBlind: 1,
          currentBigBlind: 2,
          currentAnte: 2,
          anteType: 'big_blind',
          nextSmallBlind: 2,
          nextBigBlind: 4,
          nextAnte: 4,
          nextBlindInMin: 10,
        },
      } as unknown as HorseGameStateV2;
      return { hero: players[heroSeat - 1], gs };
    }
    for (const openerSeat of [8, 5]) {
      for (const h of HAND_CLASSES.filter((_, i) => i % 7 === 0)) {
        const run = (flip: boolean) => {
          const { hero, gs } = state(openerSeat, holeFor(h.cls, 1), flip);
          seedFastRandom(4242);
          return HorseLogic.decide(
            hero,
            gs,
            'balanced',
            {} as never,
            {
              mind: false,
              telemetry: false,
            } as never
          ) as { action: string };
        };
        expect(run(true).action, `${h.cls} opener ${openerSeat}`).toBe(run(false).action);
      }
    }
  });
});
