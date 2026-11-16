/**
 * LIGHTNING CHEAP ENTRY (options lightningCheapEntryHoldem /
 * lightningCheapEntryOmaha, default off): the pins the build owes.
 *
 *  - off (absent, false, or anything but exactly true): decisions
 *    byte-identical, no receipt; on outside the predicate (Classic table
 *    domain, tournament, two and three dealt, no big-blind ante,
 *    all-in-or-fold, PLO6): byte-identical and the opportunity is never
 *    counted;
 *  - on: the small blind folded to completes a hand above the price bar and
 *    folds one below it; behind a person's limp it completes / over-limps on
 *    the same rule; every changed answer is base FOLD -> CALL with the cheap
 *    entry reason code: never a raise, never another seat, never a raised pot;
 *  - the small blind's early look at the deal (seats before it still to act)
 *    is not folded to: unchanged;
 *  - composes with the participation options: their raise cells decide first,
 *    cheap entry only turns a remaining fold into a call;
 *  - no deficit input: the same spot decides the same after 30 folded hands.
 *
 * Fixed public states through HorseLogic.decide, seeded hands, no database.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom, holdemPreflopScore } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  LIGHTNING_CHEAP_ENTRY_EQUITY,
  lightningCheapEntry,
  lightningCheapEntryCtx,
  lightningCheapEntryRealisation,
  lightningCheapEntryRequiredEquity,
  lightningCheapEntryShare,
  lightningCheapEntryStrengthBar,
  type LightningCheapEntryCtx,
} from './HorseLightningCheapEntry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const RANKS = '23456789TJQKA'.split('') as CardRank[];
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const DECK: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
/** Deterministic hole cards: hand `i` of a variant is the same at every seat and in every arm. */
function hole(i: number, n: number): Card[] {
  let s = (0x9e3779b9 ^ (i * 2654435761)) >>> 0 || 1;
  const d = [...DECK];
  for (let k = d.length - 1; k > 0; k--) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = (s >>> 0) % (k + 1);
    [d[k], d[j]] = [d[j]!, d[k]!];
  }
  return d.slice(0, n);
}
const HOLE_COUNT: Record<string, number> = { nlh: 2, plo4: 4, plo5: 5, plo6: 6 };
const HERO = '86000000-0000-4000-8000-0000000000aa';
const id = (seat: number) => `40000000-0000-4000-8000-0000000000${(10 + seat).toString(16)}`;
const BB = 2;

interface Spot {
  variant: string;
  dealt: number;
  stackBB: number;
  /** 1 = small blind, 2 = big blind, 3.. = first to act onward, `dealt` = the button. */
  heroSeat: number;
  /** Seats before hero that limp (call one big blind); every other seat before hero folds. */
  limpers?: number[];
  /** A raise before hero (seat, to big blinds). */
  open?: { seat: number; toBB: number };
  /** The deal: nobody before hero has acted yet (the small blind's early look). */
  atTheDeal?: boolean;
  domain?: 'lightning' | 'table';
  bbAnte?: boolean;
  gameMode?: 'cash' | 'tournament';
  allInOrFold?: boolean;
  /** Name the blind seats as the Lightning host does (the fold-through rule reads them). */
  blindSeats?: boolean;
}

function gsOf(s: Spot, cards: Card[]): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const ante = s.bbAnte === false ? 0 : BB;
  const bets = new Map<number, number>([
    [1, 1],
    [2, BB],
  ]);
  const folded = new Set<number>();
  const history: ActionRecord[] = [];
  let ts = 1;
  let currentBet = BB;
  let lastRaise = BB;
  const order = [...Array.from({ length: s.dealt - 2 }, (_, k) => k + 3), 1, 2];
  if (!s.atTheDeal)
    for (const seat of order) {
      if (seat === s.heroSeat) break;
      if (s.open && s.open.seat === seat) {
        const to = s.open.toBB * BB;
        lastRaise = to - currentBet;
        currentBet = to;
        bets.set(seat, to);
        history.push({
          stage: 'preflop',
          seat,
          userId: id(seat),
          action: 'raise',
          amount: to,
          isFullRaise: true,
          timestamp: ts++,
        } as unknown as ActionRecord);
      } else if (s.limpers?.includes(seat)) {
        bets.set(seat, BB);
        history.push({
          stage: 'preflop',
          seat,
          userId: id(seat),
          action: 'call',
          amount: BB,
          timestamp: ts++,
        } as unknown as ActionRecord);
      } else {
        folded.add(seat);
        history.push({
          stage: 'preflop',
          seat,
          userId: id(seat),
          action: 'fold',
          amount: 0,
          timestamp: ts++,
        } as unknown as ActionRecord);
      }
    }
  const stack = s.stackBB * BB;
  const players: SeatPlayer[] = Array.from({ length: s.dealt }, (_, k) => {
    const seat = k + 1;
    const bet = bets.get(seat) ?? 0;
    const dead = seat === 2 ? ante : 0;
    return {
      seat,
      user_id: seat === s.heroSeat ? HERO : id(seat),
      username: `P${seat}`,
      stack: stack - bet - dead,
      bet,
      totalInvested: bet + dead,
      cards: seat === s.heroSeat ? cards : [],
      is_folded: folded.has(seat),
      is_all_in: false,
      is_sitting_out: false,
      is_horse: seat === s.heroSeat,
    } as SeatPlayer;
  });
  const hero = players[s.heroSeat - 1]!;
  const pot = ante + [...bets.values()].reduce((a, b) => a + b, 0);
  const toCall = currentBet - hero.bet;
  const potLimit = s.variant !== 'nlh';
  const maxRaiseTo = potLimit
    ? Math.min(hero.stack + hero.bet, currentBet + pot + toCall)
    : hero.stack + hero.bet;
  const gs = {
    players: players.map((p) => (p.seat === s.heroSeat ? { ...p, cards: [] } : p)),
    dealtSeatIds: players.map((p) => p.seat),
    communityCards: [],
    pot,
    contestablePot: pot,
    currentBet,
    toCall,
    minRaise: lastRaise,
    minRaiseTo: currentBet + lastRaise,
    maxRaiseTo,
    lastRaise,
    legalActions: s.allInOrFold ? ['fold', 'all_in'] : ['fold', 'call', 'raise'],
    stage: 'preflop',
    gameVariant: s.variant,
    bettingStructure: potLimit ? 'pot_limit' : 'no_limit',
    smallBlind: 1,
    bigBlind: BB,
    dealerSeat: s.dealt,
    gameMode: s.gameMode ?? 'cash',
    format: s.gameMode === 'tournament' ? 'mtt' : 'cash',
    ante,
    bigBlindAnte: s.bbAnte !== false,
    allInOrFold: s.allInOrFold === true,
    straddleActive: false,
    publicMemoryDomain: {
      version: 1,
      speed: s.domain ?? 'lightning',
      ante: ante === 0 ? 'none' : 'big_blind',
    },
    actionHistory: history,
    ...(s.blindSeats ? { blindSeats: { smallBlind: 1, bigBlind: 2 } } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const MEASURED_TIMING_KEYS = new Set([
  'latencyMs',
  'analysisMs',
  'simulationMs',
  'policyMs',
  'utilityLatencyMs',
  'elapsedMs',
]);
const bytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) =>
    MEASURED_TIMING_KEYS.has(k) && typeof v === 'number' ? undefined : v
  );

interface Played {
  bytes: string;
  action: string;
  branches: string[];
  events: Array<{ branch: string; strength: number; effectiveThreeBetThreshold: number }>;
  fires: Map<string, number>;
}
function play(s: Spot, i: number, opts: HorseDecideOpts, before?: () => void): Played {
  HorseMind.reset();
  before?.();
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(7000 + i);
  const { hero, gs } = gsOf(s, hole(i, HOLE_COUNT[s.variant]!));
  const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
  const fires = new Map<string, number>();
  for (const f of drainFires()) fires.set(f.feature, f.fires);
  const events =
    (
      d as {
        preflopAuthority?: {
          events: Array<{ branch: string; strength: number; effectiveThreeBetThreshold: number }>;
        };
      }
    ).preflopAuthority?.events ?? [];
  return {
    bytes: bytes(d),
    action: d.action,
    branches: events.map((e) => e.branch),
    events,
    fires,
  };
}
const ON: HorseDecideOpts = { lightningCheapEntryHoldem: true, lightningCheapEntryOmaha: true };
const OFF: HorseDecideOpts = {};
const CODES = ['lightning_cheap_entry_sb_complete', 'lightning_cheap_entry_over_limp'];
const isCheap = (b: string) => CODES.includes(b);

afterEach(() => HorseMind.reset());

const sbFoldedTo = (variant: string, dealt = 6, stackBB = 100): Spot => ({
  variant,
  dealt,
  stackBB,
  heroSeat: 1,
});
const sbBehindLimp = (variant: string, dealt = 6, limpers = [3], stackBB = 100): Spot => ({
  variant,
  dealt,
  stackBB,
  heroSeat: 1,
  limpers,
});
const buttonBehindLimp = (variant: string, dealt = 6, limpers = [3], stackBB = 100): Spot => ({
  variant,
  dealt,
  stackBB,
  heroSeat: dealt,
  limpers,
});

describe('Lightning cheap entry: the price arithmetic', () => {
  it('needs more equity as the price, the raise risk behind or the depth gets worse', () => {
    const base = {
      family: 'holdem' as const,
      call: 1,
      pot: 5,
      addedBehind: 0,
      behind: 1,
      inPosition: false,
      depthBB: 100,
      drop: 0.13,
    };
    const n = lightningCheapEntryRequiredEquity(base);
    // call 1 into 5 laid by the ante, 30% raise risk (hold'em), realisation 0.7, 13% drop
    expect(n).toBeCloseTo(1 / (0.7 * 0.7 * 6 * 0.87), 6);
    // the Omaha big blinds raise a completion more often: more equity is needed
    expect(lightningCheapEntryRequiredEquity({ ...base, family: 'plo4' })).toBeGreaterThan(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, family: 'plo5' })).toBeGreaterThan(
      lightningCheapEntryRequiredEquity({ ...base, family: 'plo4' })
    );
    expect(lightningCheapEntryRequiredEquity({ ...base, call: 2 })).toBeGreaterThan(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, behind: 2 })).toBeGreaterThan(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, drop: 0.2 })).toBeGreaterThan(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, depthBB: 200 })).toBeGreaterThan(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, depthBB: 50 })).toBe(n);
    expect(lightningCheapEntryRequiredEquity({ ...base, pot: 9 })).toBeLessThan(n);
    expect(lightningCheapEntryRealisation(true, 200)).toBe(0.8);
    expect(lightningCheapEntryRealisation(false, 200)).toBeCloseTo(0.7 * 0.94, 9);
  });

  it('every table is 40 bins of equal share, strongest first, with equity falling as opponents are added', () => {
    for (const [family, rows] of Object.entries(LIGHTNING_CHEAP_ENTRY_EQUITY)) {
      expect(rows.length, family).toBe(40);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        expect(r[1]).toBeCloseTo((i + 1) / 40, 9);
        if (i > 0) expect(r[0]!, `${family} bin ${i}`).toBeLessThanOrEqual(rows[i - 1]![0]!);
        for (let k = 3; k < 7; k++)
          expect(r[k]!, `${family} bin ${i} k ${k - 1}`).toBeLessThan(r[k - 1]!);
      }
    }
  });

  it('the bar only narrows as the needed equity rises, and is null when even the top fails', () => {
    for (const family of ['holdem', 'plo4', 'plo5'] as const)
      for (let k = 1; k <= 5; k++) {
        let last = 1.01;
        for (let need = 0.1; need <= 0.8; need += 0.01) {
          const share = lightningCheapEntryShare(family, k, need);
          expect(share).toBeLessThanOrEqual(last + 1e-12);
          last = share;
          const bar = lightningCheapEntryStrengthBar(family, k, need);
          if (share === 0) expect(bar).toBeNull();
          else expect(bar).not.toBeNull();
        }
      }
  });
});

describe('Lightning cheap entry: the decision function', () => {
  const ce = (family: 'holdem' | 'plo4' | 'plo5', over: Partial<LightningCheapEntryCtx> = {}) =>
    ({
      family,
      behind: 1,
      observedManiac: false,
      telemetry: false,
      ...over,
    }) as LightningCheapEntryCtx;
  const sb = {
    isOmaha: false,
    position: 'sb',
    isButton: false,
    limpers: 0,
    raises: 0,
    straddled: false,
    oppsLeft: 1,
    toCall: 1,
    bigBlind: 2,
    pot: 5,
    drop: 0.133,
    depthBB: 200,
    strength: 0.5,
    tightness: 1,
  };
  // At 200bb with a 13.3% drop the hold'em small blind's bar binds: the weakest sixth folds.
  const bar = lightningCheapEntryStrengthBar(
    'holdem',
    1,
    lightningCheapEntryRequiredEquity({
      family: 'holdem',
      call: 1,
      pot: 5,
      addedBehind: 0,
      behind: 1,
      inPosition: false,
      depthBB: 200,
      drop: 0.133,
    })
  )!;

  it('the small blind folded to completes above the bar and folds below it', () => {
    expect(bar).toBeGreaterThan(0.04);
    expect(lightningCheapEntry(ce('holdem'), { ...sb, strength: bar + 0.001 })).toBe(true);
    expect(lightningCheapEntry(ce('holdem'), { ...sb, strength: bar - 0.001 })).toBe(false);
    // a tighter persona moves the bar up with its tightness
    expect(
      lightningCheapEntry(ce('holdem'), { ...sb, strength: bar + 0.001, tightness: 1.2 })
    ).toBe(false);
  });

  it('is asked only in the two cheap spots, for the small blind and the button', () => {
    const ok = (over: Partial<typeof sb>, c = ce('holdem')) =>
      lightningCheapEntry(c, { ...sb, strength: 0.9, ...over });
    expect(ok({})).toBe(true);
    expect(ok({ raises: 1 })).toBe(false); // a raised pot is the base policy's
    expect(ok({ straddled: true })).toBe(false);
    expect(ok({ toCall: 0 })).toBe(false);
    expect(ok({ toCall: 3 })).toBe(false); // more than one big blind
    expect(ok({ oppsLeft: 2 })).toBe(false); // not folded to: a seat before still to act
    expect(ok({ position: 'bb' })).toBe(false);
    for (const position of ['early', 'middle', 'late'])
      expect(ok({ position, limpers: 0, oppsLeft: 1 })).toBe(false); // no first-in limp elsewhere
    expect(ok({ position: 'late', isButton: false, limpers: 1, toCall: 2 })).toBe(false); // cut-off
    expect(
      ok(
        { position: 'late', isButton: true, limpers: 1, toCall: 2, pot: 7, oppsLeft: 3 },
        ce('holdem', { behind: 3 })
      )
    ).toBe(false); // a button with a seat still behind it is not the button of an unopened pot
    expect(ok({ isOmaha: true })).toBe(false); // the hold'em option answers hold'em only
    expect(ok({}, ce('plo4'))).toBe(false);
    expect(lightningCheapEntry(undefined, { ...sb, strength: 0.9 })).toBe(false);
    // three limpers and no drop: a price the button clears with a strong hand,
    // and one no other seat is ever asked at
    const multi = {
      limpers: 3,
      toCall: 2,
      pot: 11,
      oppsLeft: 5,
      drop: 0,
      depthBB: 100,
      strength: 0.99,
    };
    expect(ok({ ...multi, position: 'late', isButton: true }, ce('holdem', { behind: 2 }))).toBe(
      true
    );
    for (const position of ['early', 'middle'])
      expect(ok({ ...multi, position }, ce('holdem', { behind: 3 }))).toBe(false);
    expect(ok({ ...multi, position: 'late', isButton: false }, ce('holdem', { behind: 3 }))).toBe(
      false
    );
    expect(ok({}, ce('holdem', { observedManiac: true }))).toBe(false); // the read stays on top
  });

  it('behind a limp, the small blind and the button are priced with every player who can see the flop', () => {
    const sbLimp = { ...sb, limpers: 1, pot: 7, oppsLeft: 2, depthBB: 100 };
    const needSb = lightningCheapEntryRequiredEquity({
      family: 'holdem',
      call: 1,
      pot: 7,
      addedBehind: 0,
      behind: 1,
      inPosition: false,
      depthBB: 100,
      drop: 0.133,
    });
    const barSb = lightningCheapEntryStrengthBar('holdem', 2, needSb)!;
    expect(lightningCheapEntry(ce('holdem'), { ...sbLimp, strength: barSb })).toBe(true);
    expect(lightningCheapEntry(ce('holdem'), { ...sbLimp, strength: barSb - 0.001 })).toBe(false);
    const needBtn = lightningCheapEntryRequiredEquity({
      family: 'holdem',
      call: 2,
      pot: 7,
      addedBehind: 1,
      behind: 2,
      inPosition: true,
      depthBB: 100,
      drop: 0.133,
    });
    expect(needBtn).toBeGreaterThan(needSb);
    const barBtn = lightningCheapEntryStrengthBar('holdem', 3, needBtn);
    const btn = {
      ...sb,
      position: 'late',
      isButton: true,
      limpers: 1,
      toCall: 2,
      pot: 7,
      oppsLeft: 3,
      depthBB: 100,
    };
    if (barBtn !== null) {
      expect(lightningCheapEntry(ce('holdem', { behind: 2 }), { ...btn, strength: barBtn })).toBe(
        true
      );
      expect(
        lightningCheapEntry(ce('holdem', { behind: 2 }), { ...btn, strength: barBtn - 0.001 })
      ).toBe(false);
    } else
      expect(lightningCheapEntry(ce('holdem', { behind: 2 }), { ...btn, strength: 0.99 })).toBe(
        false
      );
  });
});

describe('Lightning cheap entry: off and outside the predicate', () => {
  const spots: Spot[] = [
    sbFoldedTo('nlh'),
    sbFoldedTo('plo4', 5),
    sbFoldedTo('plo5', 4),
    sbBehindLimp('nlh'),
    sbBehindLimp('plo4', 6, [3, 5]),
    buttonBehindLimp('nlh'),
    buttonBehindLimp('plo5', 5, [3]),
  ];

  it('anything but exactly true is off: byte-identical, no receipt', () => {
    for (const s of spots)
      for (let i = 0; i < 25; i++) {
        const off = play(s, i, OFF);
        for (const v of [false, undefined, 1, 'true'] as unknown[]) {
          const p = play(s, i, {
            lightningCheapEntryHoldem: v,
            lightningCheapEntryOmaha: v,
          } as HorseDecideOpts);
          expect(p.bytes, `${JSON.stringify(s)} hand ${i} ${String(v)}`).toBe(off.bytes);
          expect([...p.fires.keys()].some((k) => k.startsWith('lightning_cheap_entry'))).toBe(
            false
          );
        }
      }
  }, 240_000);

  it('on outside the predicate: byte-identical decisions and no opportunity is counted', () => {
    const outside: Array<[Spot, string]> = [
      [{ ...sbFoldedTo('nlh'), domain: 'table' }, 'not_lightning'],
      [{ ...sbBehindLimp('plo4'), domain: 'table' }, 'not_lightning'],
      [{ ...sbFoldedTo('nlh'), gameMode: 'tournament' }, 'format'],
      [{ ...sbBehindLimp('plo5'), gameMode: 'tournament' }, 'format'],
      [{ ...sbFoldedTo('nlh'), allInOrFold: true }, 'format'],
      [sbFoldedTo('nlh', 3), 'dealt_count'],
      [sbFoldedTo('plo4', 3), 'dealt_count'],
      [{ ...sbFoldedTo('plo5'), bbAnte: false }, 'not_bb_ante'],
      [{ ...sbBehindLimp('nlh'), bbAnte: false }, 'not_bb_ante'],
      [sbFoldedTo('plo6'), 'variant'],
    ];
    for (const [s, reason] of outside)
      for (let i = 0; i < 30; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        expect(on.bytes, `${JSON.stringify(s)} hand ${i}`).toBe(off.bytes);
        expect(on.fires.has('lightning_cheap_entry_eligible_seen')).toBe(false);
        expect(on.fires.has('lightning_cheap_entry_changed_seen')).toBe(false);
        expect(
          on.fires.get(`lightning_cheap_entry_refused_${reason}_seen`),
          JSON.stringify(s)
        ).toBe(1);
      }
  }, 240_000);
});

const HANDS = 120;

describe('Lightning cheap entry through HorseLogic.decide', () => {
  it('the small blind folded to: base fold -> complete, never a raise, carrying its reason code', () => {
    for (const s of [
      sbFoldedTo('nlh'),
      sbFoldedTo('nlh', 4, 50),
      sbFoldedTo('plo4'),
      sbFoldedTo('plo5', 5, 200),
    ]) {
      let changed = 0;
      let raisesOff = 0;
      let raisesOn = 0;
      for (let i = 0; i < HANDS; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        expect(on.fires.get('lightning_cheap_entry_eligible_seen')).toBe(1);
        expect(off.fires.has('lightning_cheap_entry_eligible_seen')).toBe(false);
        if (off.action === 'raise' || off.action === 'all_in') raisesOff++;
        if (on.action === 'raise' || on.action === 'all_in') raisesOn++;
        if (on.action !== off.action) {
          changed++;
          expect(off.action, `${s.variant} hand ${i}`).toBe('fold');
          expect(on.action).toBe('call');
          expect(on.branches).toContain('lightning_cheap_entry_sb_complete');
          expect(on.fires.get('lightning_cheap_entry_changed_seen')).toBe(1);
          expect(on.fires.get('lightning_cheap_entry_asked_seen')).toBe(1);
        } else {
          expect(on.branches.some(isCheap)).toBe(false);
          expect(on.fires.has('lightning_cheap_entry_changed_seen')).toBe(false);
          // where both arms agree the decisions are the same bytes
          expect(on.bytes).toBe(off.bytes);
        }
      }
      expect(raisesOn, `${s.variant}: the option never adds a raise`).toBe(raisesOff);
      expect(changed, `${s.variant} ${s.dealt} dealt never engaged`).toBeGreaterThan(0);
    }
  }, 240_000);

  it("behind a person's limp: the small blind completes and the button over-limps only by the rule; nothing else moves", () => {
    let sbChanged = 0;
    for (const s of [
      sbBehindLimp('nlh'),
      sbBehindLimp('nlh', 6, [4, 6]),
      sbBehindLimp('plo4'),
      sbBehindLimp('plo5', 5, [5]),
      buttonBehindLimp('nlh'),
      buttonBehindLimp('nlh', 6, [3, 4]),
      buttonBehindLimp('plo4'),
      buttonBehindLimp('plo5', 4, [3]),
    ]) {
      let raisesOff = 0;
      let raisesOn = 0;
      for (let i = 0; i < HANDS; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        if (off.action === 'raise' || off.action === 'all_in') raisesOff++;
        if (on.action === 'raise' || on.action === 'all_in') raisesOn++;
        if (on.action !== off.action) {
          expect(off.action, `${JSON.stringify(s)} hand ${i}`).toBe('fold');
          expect(on.action).toBe('call');
          expect(on.branches).toContain('lightning_cheap_entry_over_limp');
          expect(on.fires.get('lightning_cheap_entry_changed_seen')).toBe(1);
          if (s.heroSeat === 1) sbChanged++;
        } else {
          expect(on.branches.some(isCheap)).toBe(false);
          expect(on.fires.has('lightning_cheap_entry_changed_seen')).toBe(false);
          expect(on.bytes, `${JSON.stringify(s)} hand ${i}`).toBe(off.bytes);
        }
      }
      expect(raisesOn, `${JSON.stringify(s)}: the option never adds a raise`).toBe(raisesOff);
    }
    expect(sbChanged).toBeGreaterThan(0);
  }, 480_000);

  it('the hold-em small blind behind a limp: every hand that stays folded sits under every hand the option completes (jitter aside)', () => {
    const s = sbBehindLimp('nlh', 6, [3]);
    const completed: number[] = [];
    const stayed: number[] = [];
    for (let i = 0; i < 400; i++) {
      const off = play(s, i, OFF);
      if (off.action !== 'fold') continue;
      const on = play(s, i, ON);
      const c = hole(i, 2);
      const score = holdemPreflopScore(c[0]!, c[1]!, false);
      (on.action === 'call' ? completed : stayed).push(score);
    }
    expect(completed.length).toBeGreaterThan(0);
    expect(stayed.length).toBeGreaterThan(0);
    // the decision strength carries a jitter of +/- 0.03
    expect(Math.max(...stayed)).toBeLessThan(Math.min(...completed) + 0.06 + 1e-9);
  }, 240_000);

  it("other seats, raised pots and the small blind's early look at the deal are unchanged", () => {
    const same: Spot[] = [
      // first in from every other seat: no first-in limp anywhere else
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 3 },
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 5 },
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 6 },
      { variant: 'plo4', dealt: 6, stackBB: 100, heroSeat: 4 },
      { variant: 'plo5', dealt: 5, stackBB: 100, heroSeat: 5 },
      // behind a limp but not the small blind or the button
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 5, limpers: [3] },
      { variant: 'plo4', dealt: 6, stackBB: 100, heroSeat: 4, limpers: [3] },
      // a raised pot (the small blind facing an open)
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 1, open: { seat: 6, toBB: 2.5 } },
      { variant: 'plo4', dealt: 6, stackBB: 100, heroSeat: 1, open: { seat: 5, toBB: 4 } },
      // the big blind
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 2, limpers: [3] },
      // the small blind's early look at the deal: seats before it still to act
      { variant: 'nlh', dealt: 6, stackBB: 100, heroSeat: 1, atTheDeal: true },
      { variant: 'plo4', dealt: 6, stackBB: 100, heroSeat: 1, atTheDeal: true },
      { variant: 'plo5', dealt: 4, stackBB: 100, heroSeat: 1, atTheDeal: true },
    ];
    for (const s of same)
      for (let i = 0; i < 40; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        expect(on.bytes, `${JSON.stringify(s)} hand ${i}`).toBe(off.bytes);
        expect(on.fires.get('lightning_cheap_entry_eligible_seen')).toBe(1);
        expect(on.fires.has('lightning_cheap_entry_changed_seen')).toBe(false);
      }
  }, 240_000);

  it('with the early-fold fold-through on too (L-019): a small blind that folds in the unopened early look but clears the complete bar is not folded early, completes on its turn, and never raises', () => {
    const FT: HorseDecideOpts = { lightningEarlyFoldNeedsFoldThrough: true };
    const BOTH: HorseDecideOpts = { ...ON, ...FT };
    for (const variant of ['plo4', 'plo5', 'nlh']) {
      const early: Spot = {
        variant,
        dealt: 6,
        stackBB: 100,
        heroSeat: 1,
        atTheDeal: true,
        blindSeats: true,
      };
      const turn: Spot = { ...sbFoldedTo(variant), blindSeats: true };
      let kept = 0;
      let byCheapEntry = 0;
      let raisesFt = 0;
      let raisesBoth = 0;
      for (let i = 0; i < 60; i++) {
        const ftOnly = play(early, i, FT);
        const both = play(early, i, BOTH);
        const onTurn = play(turn, i, BOTH);
        const isRaise = (a: string) => a === 'raise' || a === 'all_in';
        if (isRaise(ftOnly.action)) raisesFt++;
        if (isRaise(both.action)) raisesBoth++;
        if (both.action !== ftOnly.action) {
          // the only move cheap entry adds to the early look: an early fold that is not taken
          expect(ftOnly.action, `${variant} hand ${i}`).toBe('fold');
          expect(both.action, `${variant} hand ${i}`).toBe('call');
          expect(ftOnly.fires.get('lightning_fold_through_kept')).toBe(1);
        }
        // the hand under test: the unopened early look folds, the folded-to small blind completes
        // "Clears the bar" is by more than the decision jitter (+/- 0.03 on the strength): the
        // frame is asked after the first ask, so its jitter is not the turn's, and a hand within
        // the jitter of the bar can still be folded early (hold'em hand 7 here is one).
        const completes = onTurn.events.some(
          (e) =>
            e.branch === 'lightning_cheap_entry_sb_complete' &&
            e.strength >= e.effectiveThreeBetThreshold + 0.06
        );
        if (play(early, i, ON).action !== 'fold' || !completes) continue;
        kept++;
        expect(both.action, `${variant} hand ${i}: folded early`).not.toBe('fold');
        expect(both.fires.get('lightning_fold_through_released')).toBe(1);
        expect(both.fires.has('lightning_fold_through_kept')).toBe(false);
        // Where the fold-through alone keeps the early fold, the completion is what releases it:
        // the frame is the normal decide path, so its answer carries the cheap entry's code. The
        // frame ask is a side ask with telemetry suspended (independent review of L-019, note 2):
        // its own receipt is not counted there; the real turn counts it (asserted below).
        // (On a few hands the base policy already continues on the frame by its own jitter.)
        if (ftOnly.action === 'fold') {
          byCheapEntry++;
          expect(both.action, `${variant} hand ${i}`).toBe('call');
          expect(both.branches).toContain('lightning_cheap_entry_sb_complete');
          expect(both.fires.has('lightning_cheap_entry_changed_seen')).toBe(false);
        }
        expect(onTurn.action, `${variant} hand ${i}: on its turn`).toBe('call');
        expect(onTurn.fires.get('lightning_cheap_entry_changed_seen')).toBe(1);
      }
      expect(raisesBoth, `${variant}: cheap entry adds no raise to the early look`).toBe(raisesFt);
      expect(kept, `${variant}: no hand reached the case`).toBeGreaterThan(0);
      expect(byCheapEntry, `${variant}: the cheap entry never released a fold`).toBeGreaterThan(0);
    }
  }, 240_000);

  it('composes with the participation options: their raise cells decide first, cheap entry only turns a fold into a call', () => {
    const PART: HorseDecideOpts = {
      lightningParticipationHoldem: true,
      lightningParticipationOmaha: true,
    };
    const BOTH: HorseDecideOpts = { ...PART, ...ON };
    let changed = 0;
    for (const s of [
      sbFoldedTo('plo4'),
      sbFoldedTo('plo5', 5),
      sbFoldedTo('nlh'),
      sbBehindLimp('plo4'),
    ])
      for (let i = 0; i < HANDS; i++) {
        const part = play(s, i, PART);
        const both = play(s, i, BOTH);
        if (both.action !== part.action) {
          changed++;
          expect(part.action, `${s.variant} hand ${i}`).toBe('fold');
          expect(both.action).toBe('call');
          expect(both.branches.some(isCheap)).toBe(true);
        } else expect(both.bytes).toBe(part.bytes);
        // a participation first-in raise is never taken away
        if (part.branches.includes('lightning_participation_first_in'))
          expect(both.action).toBe(part.action);
      }
    expect(changed).toBeGreaterThan(0);
  }, 480_000);

  it('no deficit: the same spot decides the same after 30 folded hands', () => {
    const foldThirty = (variant: string, dealt: number) => () => {
      const scope = readScopeOf(variant, dealt);
      for (let h = 0; h < 30; h++)
        HorseMind.observeHandComplete(
          `deficit:${variant}:${h}`,
          [
            {
              stage: 'preflop',
              seat: 3,
              userId: HERO,
              action: 'fold',
              amount: 0,
              origin: 'player',
              timestamp: h * 10 + 1,
            },
          ] as unknown as ActionRecord[],
          BB,
          null,
          scope
        );
    };
    for (const s of [
      sbFoldedTo('nlh'),
      sbFoldedTo('plo4'),
      sbBehindLimp('plo5'),
      buttonBehindLimp('nlh'),
    ])
      for (let i = 0; i < 50; i++) {
        const fresh = play(s, i, ON);
        const after = play(s, i, ON, foldThirty(s.variant, s.dealt));
        expect(after.bytes, `${s.variant} seat ${s.heroSeat} hand ${i}`).toBe(fresh.bytes);
      }
  }, 240_000);

  it('the context reads only public table facts: nothing about the hero seat but its id', () => {
    const table = {
      publicMemoryDomain: { speed: 'lightning' },
      gameMode: 'cash',
      stage: 'preflop',
      allInOrFold: false,
      gameVariant: 'nlh',
      bigBlindAnte: true,
      players: [],
    };
    const c = lightningCheapEntryCtx({ holdem: true, omaha: false }, table, {
      heroUserId: HERO,
      dealt: 6,
      behind: 1,
      mind: true,
      telemetry: false,
    });
    expect(c).toEqual({ family: 'holdem', behind: 1, observedManiac: false, telemetry: false });
    expect(
      lightningCheapEntryCtx({ holdem: false, omaha: true }, table, {
        heroUserId: HERO,
        dealt: 6,
        behind: 1,
        mind: true,
        telemetry: false,
      })
    ).toBeUndefined();
  });
});

describe('Lightning cheap entry: the source reads no own-participation input', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = strip(
    readFileSync(fileURLToPath(new URL('./HorseLightningCheapEntry.ts', import.meta.url)), 'utf8')
  );

  it('imports the telemetry counter and the shared Lightning predicate, and nothing else', () => {
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./BrainTelemetry.js', './HorseLightningParticipation.js']);
    // the predicate is reused, never forked: no domain test of its own
    expect(code).toContain('lightningParticipationEligibility(');
    expect(code).not.toMatch(/publicMemoryDomain|bigBlindAnte|allInOrFold|gameMode/);
  });

  it('names no own VPIP, fold count, hand count, floor or deficit', () => {
    expect(code).not.toMatch(
      /vpip|pfr|floor\w*call|deficit|handsSince|handsPlayed|handsSeen|handsDealt|foldStreak|foldCount|consecutiveFold|selfImage|selfRead|ownStat|heroStat|sessionStat|opponentRead\(/i
    );
    // the only thing it does with the hero's id is skip the hero when reading opponents
    expect(code.match(/heroUserId/g)!.length).toBe(2);
    expect(code).toContain('lightningObservedManiac(table, seat.heroUserId)');
    // it can only ever answer call (true) or stand aside (false): no raise, no size
    expect(code).not.toMatch(/'raise'|'all_in'|'bet'|raiseTo|amount/);
  });

  it('the preflop engine consults it once, on the fold of the unopened branch, and answers call', () => {
    const pre = strip(
      readFileSync(fileURLToPath(new URL('./HorsePreflop.ts', import.meta.url)), 'utf8')
    );
    expect(pre.match(/lightningCheapEntry\(/g)!.length).toBe(1);
    expect(pre).toMatch(
      /lightningCheapEntry\(ctx\.lightningCheapEntry,[\s\S]{0,900}?tightness:\s*ctx\.unflooredTightness\s*\?\?\s*ctx\.tightness,[\s\S]{0,300}?\)\s*\)\s*return \{ a: 'call' \};\s*return \{ a: 'fold' \};/
    );
  });

  it('the cheap-entry bar uses unfloored persona tightness even if a snapshot carries vpipFloor + ownVpip (bdbcc60c N3)', () => {
    const s = sbFoldedTo('nlh');
    for (let i = 0; i < 60; i++) {
      HorseMind.reset();
      seedFastRandom(7000 + i);
      const base = gsOf(s, hole(i, 2));
      const dUnfloored = HorseLogic.decide(base.hero, base.gs, 'balanced', {}, ON);
      if (dUnfloored.action !== 'fold') continue;
      // Inject a synthetic VPIP floor + severe deficit on the same Lightning snapshot:
      // base opens remain narrow enough to fold this hand only if unflooredTightness
      // keeps the cheap-entry bar from scaling down by vpipFloorMul.
      HorseMind.reset();
      seedFastRandom(7000 + i);
      const flooredGs = {
        ...base.gs,
        vpipFloor: 40,
        vpipWindowHands: 10,
        ownVpip: { hands: 20, vpip: 5 },
      } as HorseGameStateV2;
      // Verify the cheap-entry effective bar recorded on a clearing hand is identical
      // with and without vpipFloor/ownVpip.
      expect(flooredGs.ownVpip?.vpip).toBe(5);
      break;
    }
    let checkedClearingBar = 0;
    for (let i = 0; i < 80; i++) {
      const clean = play(s, i, ON);
      const cheapEv = clean.events.find((e) => e.branch === 'lightning_cheap_entry_sb_complete');
      if (!cheapEv) continue;
      HorseMind.reset();
      seedFastRandom(7000 + i);
      const { hero, gs } = gsOf(s, hole(i, 2));
      const dFloored = HorseLogic.decide(
        hero,
        { ...gs, vpipFloor: 40, vpipWindowHands: 10, ownVpip: { hands: 20, vpip: 5 } },
        'balanced',
        {},
        ON
      ) as {
        preflopAuthority?: {
          events: Array<{ branch: string; effectiveThreeBetThreshold: number }>;
        };
      };
      const flooredEv = dFloored.preflopAuthority?.events.find(
        (e) => e.branch === 'lightning_cheap_entry_sb_complete'
      );
      if (flooredEv) {
        expect(flooredEv.effectiveThreeBetThreshold).toBe(cheapEv.effectiveThreeBetThreshold);
        checkedClearingBar++;
      }
    }
    expect(checkedClearingBar).toBeGreaterThan(0);
  });

  it('LIGHTNING_CHEAP_ENTRY_EQUITY matches scripts/generate-lightning-cheap-entry-equity.ts (bdbcc60c N6)', () => {
    const scriptPath = fileURLToPath(
      new URL('../../scripts/generate-lightning-cheap-entry-equity.ts', import.meta.url)
    );
    const out = execFileSync(process.execPath, ['--import', 'tsx', scriptPath, '--check'], {
      encoding: 'utf8',
    });
    expect(out).toContain('OK: LIGHTNING_CHEAP_ENTRY_EQUITY matches generator');
  }, 120_000);
});
