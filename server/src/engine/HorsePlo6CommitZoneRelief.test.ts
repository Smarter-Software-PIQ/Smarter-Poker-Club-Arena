/**
 * PLO6 COMMITMENT-ZONE RE-RAISE PRICE RELIEF (omahaCommitZoneThreeBetPriceRelief,
 * default OFF, PLO6 tournament-folds study 2026-11-14).
 *
 * In the V25 PLO commitment zone facing a re-raise, a six-card Omaha high
 * Horse takes the relief max(0, 0.5 - odds) * 1.6 instead of
 * (0.4 - odds) * 1.2. The cases below pin the reach of the option: only
 * explicit true turns it on, it touches six-card Omaha high facing two or
 * more raises inside the commitment zone, and the only decision it can
 * change is a fold becoming the pot raise (the stack at this depth).
 *
 * The contexts are constructed, not replayed. The motivating spot has the
 * shape the study recorded (hero opened, the open was cold-called, a pot
 * 3-bet was cold-called, a call of about 32% of the stack at a price of
 * about 0.23, strength about 0.53); the strength is the percentile the
 * brain reads, not an equity.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { decidePreflopV7, type PreflopCtx, type PreflopIntent } from './HorsePreflop.js';

const SUITS = ['s', 'h', 'd', 'c'] as const;
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9'] as const;

/** Hole cards of the requested size; the brain reads `strength`, so only the count matters here. */
function hole(n: number): Card[] {
  return Array.from(
    { length: n },
    (_, i) => ({ rank: RANKS[i % RANKS.length], suit: SUITS[i % SUITS.length] }) as unknown as Card
  );
}

/**
 * 40bb tournament, big blind 100. Hero opened to 350 from late position,
 * one player called, the big blind made it 1,450 (pot) and one player
 * cold-called the 3-bet. Hero has 3,450 behind and 1,100 to call into
 * 3,650: call share 0.319, price 0.232.
 */
function spot(extra: Partial<PreflopCtx> = {}): PreflopCtx {
  return {
    strength: 0.53,
    position: 'late',
    raiserPosition: 'blinds' as never,
    raises: 2,
    limpers: 0,
    callers: 1,
    oppsLeft: 3,
    toCall: 1100,
    currentBet: 1450,
    pot: 3650,
    bigBlind: 100,
    stack: 3450,
    stackBB: 34.5,
    tightness: 1,
    bluffFreq: 0.1,
    aggression: 1,
    slowplayFreq: 0.1,
    sizingMultiplier: 1,
    isOmaha: true,
    isPotLimit: true,
    riskAdd: 0.04,
    mode: 'tournament',
    anteInPlay: true,
    anteOrbitBB: 1.0,
    tableSize: 8,
    ploPriceDefense: true,
    ploTourney: true,
    v13: true,
    holeCards: hole(6),
    rand: () => 0.5,
    ...extra,
  } as PreflopCtx;
}

function decide(ctx: PreflopCtx): PreflopIntent {
  return decidePreflopV7(ctx);
}

const ON = { omahaCommitZoneThreeBetPriceRelief: true } as const;

/** Price and depth grid inside the commitment zone (call >= 25% of the stack). */
function zoneGrid(extra: Partial<PreflopCtx> = {}): PreflopCtx[] {
  const out: PreflopCtx[] = [];
  for (let s = 0.2; s <= 0.95 + 1e-9; s += 0.025) {
    for (const [toCall, pot] of [
      [1100, 3650],
      [1100, 2200],
      [1100, 6000],
      [1600, 2600],
      [900, 9000],
      [3450, 3000],
    ] as const) {
      for (const callers of [0, 1, 2]) {
        out.push(
          spot({
            strength: +s.toFixed(3),
            toCall,
            currentBet: toCall + 350,
            pot,
            callers,
            ...extra,
          })
        );
      }
    }
  }
  return out;
}

describe('omahaCommitZoneThreeBetPriceRelief', () => {
  it('the motivating PLO6 spot sits in the commitment zone at the recorded shape', () => {
    const c = spot();
    expect(Math.min(c.toCall, c.stack) / c.stack).toBeGreaterThanOrEqual(0.25);
    expect(+(c.toCall / c.stack).toFixed(2)).toBeCloseTo(0.32, 2);
    expect(+(c.toCall / (c.pot + c.toCall)).toFixed(2)).toBeCloseTo(0.23, 2);
  });

  it('the motivating spot folds off and raises the pot (the stack) on', () => {
    expect(decide(spot()).a).toBe('fold');
    const on = decide(spot(ON));
    expect(on.a).toBe('raiseTo');
    // The pot-limit raise-to at this depth exceeds what hero holds, so the
    // engine's clamp makes it the all-in.
    expect((on as { to: number }).to).toBeGreaterThanOrEqual(
      spot().stack + spot().currentBet - spot().toCall
    );
  });

  it('absent and explicit false give identical intents', () => {
    for (const c of zoneGrid()) {
      const absent = decide(c);
      expect(decide({ ...c, omahaCommitZoneThreeBetPriceRelief: false })).toEqual(absent);
      expect(decide({ ...c, omahaCommitZoneThreeBetPriceRelief: undefined })).toEqual(absent);
    }
  });

  it('PLO4 and PLO5 are unchanged with the option on', () => {
    for (const n of [4, 5]) {
      for (const c of zoneGrid({ holeCards: hole(n) })) {
        expect(decide({ ...c, ...ON })).toEqual(decide(c));
      }
    }
  });

  it('hi-lo is unchanged with the option on', () => {
    for (const c of zoneGrid({ omahaHiLo: true })) {
      expect(decide({ ...c, ...ON })).toEqual(decide(c));
    }
  });

  it('facing a single raise is unchanged with the option on', () => {
    for (const c of zoneGrid({ raises: 1 })) {
      expect(decide({ ...c, ...ON })).toEqual(decide(c));
    }
  });

  it('six-card spots outside the commitment zone are unchanged (deep tournament stack, and cash at 100bb)', () => {
    let reached = 0;
    for (let s = 0.2; s <= 0.95 + 1e-9; s += 0.025) {
      for (const callers of [0, 1, 2]) {
        // Tournament, 160bb behind: the call is 7% of the stack and one pot
        // re-raise (3 x currentBet + pot - currentBet) is 41% of it, so the
        // zone gate (re-raise >= 45% or call >= 25%) is not met.
        const deep = spot({ strength: +s.toFixed(3), callers, stack: 16000, stackBB: 160 });
        const potRaiseCost = 3 * deep.currentBet + deep.pot - deep.currentBet;
        expect(deep.toCall / deep.stack).toBeLessThan(0.25);
        expect(potRaiseCost / deep.stack).toBeLessThan(0.45);
        expect(decide({ ...deep, ...ON })).toEqual(decide(deep));
        // Cash at 100bb: the commitment zone is a tournament branch only, so
        // a pot 3-bet call of 11% of the stack never reaches it.
        const cash = spot({
          strength: +s.toFixed(3),
          callers,
          stack: 9650,
          stackBB: 96.5,
          mode: 'cash',
          ploTourney: false,
          anteInPlay: false,
          anteOrbitBB: undefined,
        });
        expect(cash.toCall / cash.stack).toBeLessThan(0.25);
        expect(decide({ ...cash, ...ON })).toEqual(decide(cash));
        reached += 2;
      }
    }
    expect(reached).toBeGreaterThan(0);
  });

  it('in the core the only change is fold -> pot raise (priced-in guard off)', () => {
    let changed = 0;
    for (const c0 of zoneGrid()) {
      const c = { ...c0, v13: false };
      const off = decide(c);
      const on = decide({ ...c, ...ON });
      if (JSON.stringify(off) === JSON.stringify(on)) continue;
      changed += 1;
      expect(off.a).toBe('fold');
      expect(on).toEqual(decide({ ...c, strength: 1 }));
      expect(on.a).toBe('raiseTo');
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('end to end every change becomes the pot raise; off is a fold, or the priced-in guard call at a price of 0.15 or better', () => {
    // decidePreflopV7 rescues a core fold into a call when the price is 0.15
    // or better (the V13 priced-in guard). With the option on the core raises
    // instead, so the guard never sees a fold: at those prices a call becomes
    // the pot raise. That shape was inside the measured prototype arm too.
    let folds = 0;
    for (const c of zoneGrid()) {
      const off = decide(c);
      const on = decide({ ...c, ...ON });
      if (JSON.stringify(off) === JSON.stringify(on)) continue;
      expect(on).toEqual(decide({ ...c, strength: 1 }));
      expect(on.a).toBe('raiseTo');
      if (off.a === 'fold') {
        folds += 1;
        continue;
      }
      expect(off.a).toBe('call');
      expect(c.toCall / (c.pot + c.toCall)).toBeLessThanOrEqual(0.15);
    }
    expect(folds).toBeGreaterThan(0);
  });
});
