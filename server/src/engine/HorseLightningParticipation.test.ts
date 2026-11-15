/**
 * LIGHTNING PARTICIPATION (options lightningParticipationHoldem /
 * lightningParticipationOmaha, default off): the pins the build owes.
 *
 *  - the predicate and its refusals; the cells (first-in non-decreasing to
 *    the button, big-blind defence non-increasing as the price worsens,
 *    narrower at 50bb);
 *  - off, or on outside the predicate (Classic table domain, tournament,
 *    three dealt, no big-blind ante, PLO6): decisions byte-identical and
 *    lightning_participation_eligible never fires;
 *  - no deficit: the same spot decides the same after 30 folded hands;
 *  - no fold conversion: an entry the base folded is a first-in RAISE or a
 *    big-blind CALL carrying its range-cell reason code, never a limp, and
 *    vpip_floor_call_down never fires;
 *  - facing a 3-bet and a 4-bet at 100 and 200bb the decisions equal off;
 *  - first-in frequency is non-decreasing from the earliest seat to the
 *    button, per variant and dealt count.
 *
 * Fixed public states through HorseLogic.decide, seeded hands, no database.
 * The paired harness (lightning/LightningPairedEval.test.ts) pins the same
 * off-arm identity on the real Lightning host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  LIGHTNING_OMAHA_BB_DEFEND_SHARE,
  lightningHoldemBbPricePoints,
  lightningOmahaBbDefendShare,
  lightningOmahaFirstInShare,
  lightningParticipationCtx,
  lightningParticipationEligibility,
  type LightningParticipationTable,
} from './HorseLightningParticipation.js';
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
  /** A single raise in front of hero: who made it and to how many big blinds. */
  open?: { seat: number; toBB: number };
  /** Raises after the open, in order (each by seat, to big blinds). */
  reRaises?: Array<{ seat: number; toBB: number }>;
  domain?: 'lightning' | 'table';
  bbAnte?: boolean;
  gameMode?: 'cash' | 'tournament';
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
  const order = [...Array.from({ length: s.dealt - 2 }, (_, k) => k + 3), 1, 2];
  const raisers = [...(s.open ? [s.open] : []), ...(s.reRaises ?? [])];
  let currentBet = BB;
  let lastRaise = BB;
  let idx = 0;
  // Walk the ring: every seat before the next raiser (or before hero, once the raises are out) folds.
  for (let lap = 0; lap < 4 && (idx < raisers.length || lap === 0); lap++) {
    for (const seat of order) {
      if (folded.has(seat)) continue;
      const next = raisers[idx];
      if (next && next.seat === seat) {
        const to = next.toBB * BB;
        lastRaise = to - currentBet;
        currentBet = to;
        bets.set(seat, to);
        history.push({
          stage: 'preflop',
          seat,
          userId: seat === s.heroSeat ? HERO : id(seat),
          action: 'raise',
          amount: to,
          isFullRaise: true,
          timestamp: ts++,
        } as unknown as ActionRecord);
        idx++;
        continue;
      }
      if (seat === s.heroSeat) {
        if (idx >= raisers.length) break;
        continue; // hero's earlier actions are among the raisers; otherwise hero has not acted yet
      }
      if (raisers.slice(idx).some((r) => r.seat === seat)) continue;
      if (idx >= raisers.length && order.indexOf(seat) > order.indexOf(s.heroSeat) && lap === 0)
        continue; // still to act behind hero
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
    if (idx >= raisers.length) break;
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
    legalActions: ['fold', 'call', 'raise'],
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
    allInOrFold: false,
    straddleActive: false,
    publicMemoryDomain: {
      version: 1,
      speed: s.domain ?? 'lightning',
      ante: ante === 0 ? 'none' : 'big_blind',
    },
    actionHistory: history,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const bytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Played {
  bytes: string;
  action: string;
  branches: string[];
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
  const events = (d as { preflopAuthority?: { events: Array<{ branch: string }> } })
    .preflopAuthority?.events;
  return {
    bytes: bytes(d),
    action: d.action,
    branches: (events ?? []).map((e) => e.branch),
    fires,
  };
}
const ON: HorseDecideOpts = {
  lightningParticipationHoldem: true,
  lightningParticipationOmaha: true,
};
const OFF: HorseDecideOpts = {};
const entered = (a: string) => a !== 'fold' && a !== 'check';

afterEach(() => HorseMind.reset());

describe('Lightning participation: the predicate', () => {
  const table = (over: Partial<LightningParticipationTable> = {}): LightningParticipationTable => ({
    publicMemoryDomain: { speed: 'lightning' },
    gameMode: 'cash',
    stage: 'preflop',
    allInOrFold: false,
    gameVariant: 'plo4',
    bigBlindAnte: true,
    ...over,
  });
  const both = { holdem: true, omaha: true };
  it('is off unless the option that owns the variant is exactly on', () => {
    expect(
      lightningParticipationEligibility({ holdem: false, omaha: false }, table(), 6).state
    ).toBe('off');
    expect(
      lightningParticipationEligibility({ holdem: true, omaha: false }, table(), 6).state
    ).toBe('off');
    expect(
      lightningParticipationEligibility(
        { holdem: false, omaha: true },
        table({ gameVariant: 'nlh' }),
        6
      ).state
    ).toBe('off');
    expect(
      lightningParticipationCtx({ holdem: false, omaha: false }, table(), {
        heroUserId: HERO,
        dealt: 6,
        behind: 2,
        mind: false,
        telemetry: true,
      })
    ).toBeUndefined();
  });
  it('engages for Lightning cash NLH, PLO4 and PLO5, four to six dealt, big-blind ante', () => {
    for (const [variant, family] of [
      ['nlh', 'holdem'],
      ['plo4', 'plo4'],
      ['plo5', 'plo5'],
    ] as const)
      for (const dealt of [4, 5, 6])
        expect(
          lightningParticipationEligibility(both, table({ gameVariant: variant }), dealt)
        ).toEqual({
          state: 'eligible',
          family,
        });
  });
  it('refuses everything else, with the reason', () => {
    const reason = (t: LightningParticipationTable, dealt = 6) => {
      const e = lightningParticipationEligibility(both, t, dealt);
      return e.state === 'refused' ? e.reason : e.state;
    };
    expect(reason(table({ publicMemoryDomain: { speed: 'table' } }))).toBe('not_lightning');
    expect(reason(table({ publicMemoryDomain: null }))).toBe('not_lightning');
    expect(reason(table({ publicMemoryDomain: undefined }))).toBe('not_lightning');
    expect(reason(table({ gameMode: 'tournament' }))).toBe('format');
    expect(reason(table({ stage: 'flop' }))).toBe('format');
    expect(reason(table({ allInOrFold: true }))).toBe('format');
    expect(reason(table({ gameVariant: 'plo6' }))).toBe('variant');
    expect(reason(table({ gameVariant: 'plo8' }))).toBe('variant');
    expect(reason(table(), 2)).toBe('dealt_count');
    expect(reason(table(), 3)).toBe('dealt_count');
    expect(reason(table(), 7)).toBe('dealt_count');
    expect(reason(table({ bigBlindAnte: false }))).toBe('not_bb_ante');
  });
});

describe('Lightning participation: the cells', () => {
  it('Omaha first-in is non-decreasing from the earliest seat to the button, at every dealt count and depth', () => {
    for (const family of ['plo4', 'plo5'] as const)
      for (const dealt of [4, 5, 6])
        for (const depth of [50, 75, 100, 200]) {
          const shares = Array.from({ length: dealt - 2 }, (_, k) =>
            lightningOmahaFirstInShare(family, dealt - 1 - k, dealt, depth)
          );
          for (let k = 1; k < shares.length; k++)
            expect(
              shares[k]!,
              `${family} ${dealt} dealt ${depth}bb seat ${k}`
            ).toBeGreaterThanOrEqual(shares[k - 1]!);
          // the same seat is not narrower short-handed, and not wider at 50bb than at 100bb
          if (dealt < 6)
            expect(lightningOmahaFirstInShare(family, 2, dealt, depth)!).toBeGreaterThanOrEqual(
              lightningOmahaFirstInShare(family, 2, 6, depth)!
            );
          expect(lightningOmahaFirstInShare(family, 2, dealt, 50)!).toBeLessThan(
            lightningOmahaFirstInShare(family, 2, dealt, 100)!
          );
        }
    expect(lightningOmahaFirstInShare('holdem', 2, 6, 100)).toBeNull();
    expect(lightningOmahaFirstInShare('plo4', 0, 6, 100)).toBeNull();
    expect(lightningOmahaFirstInShare('plo4', null, 6, 100)).toBeNull();
  });
  it('big-blind defence never widens as the price worsens, and is narrower at 50bb', () => {
    for (const vs of Object.keys(LIGHTNING_OMAHA_BB_DEFEND_SHARE))
      for (const callers of [0, 1, 2]) {
        let last = Infinity;
        for (let price = 0.1; price <= 0.5; price += 0.01) {
          const share = lightningOmahaBbDefendShare(vs, price, callers, 100);
          expect(share).toBeLessThanOrEqual(last + 1e-9);
          const shallow = lightningOmahaBbDefendShare(vs, price, callers, 50);
          expect(shallow).toBeLessThanOrEqual(share);
          if (share > 24) expect(shallow).toBeLessThan(share);
          last = share;
        }
      }
    let last = Infinity;
    for (let price = 0.1; price <= 0.5; price += 0.01) {
      const pts = lightningHoldemBbPricePoints(price, 100);
      expect(pts).toBeLessThanOrEqual(last + 1e-9);
      expect(pts).toBeGreaterThanOrEqual(0);
      expect(lightningHoldemBbPricePoints(price, 50)).toBe(0);
      last = pts;
    }
    expect(lightningHoldemBbPricePoints(0.23, 100)).toBeGreaterThan(0);
    expect(lightningHoldemBbPricePoints(0.31, 100)).toBe(0);
  });
});

const HANDS = 120;
const firstIn = (variant: string, dealt: number, heroSeat: number, stackBB = 100): Spot => ({
  variant,
  dealt,
  stackBB,
  heroSeat,
});
const bbVsOpen = (variant: string, dealt: number, openSeat: number, stackBB = 100): Spot => ({
  variant,
  dealt,
  stackBB,
  heroSeat: 2,
  open: { seat: openSeat, toBB: variant === 'nlh' ? 2.5 : 4 },
});

describe('Lightning participation through HorseLogic.decide', () => {
  it('on inside the predicate: counts every opportunity, and every changed answer is a ranged entry (no limp, no floor call-down)', () => {
    const spots: Spot[] = [
      firstIn('plo4', 6, 6),
      firstIn('plo5', 6, 5),
      firstIn('plo4', 5, 1),
      bbVsOpen('plo4', 6, 6),
      bbVsOpen('plo5', 6, 3),
      bbVsOpen('nlh', 6, 6),
      bbVsOpen('nlh', 5, 3),
    ];
    let changedTotal = 0;
    for (const s of spots) {
      let changed = 0;
      for (let i = 0; i < HANDS; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        expect(off.fires.has('lightning_participation_eligible')).toBe(false);
        expect(on.fires.get('lightning_participation_eligible')).toBe(1);
        expect(on.fires.has('vpip_floor_call_down')).toBe(false);
        const code =
          s.heroSeat === 2
            ? 'lightning_participation_bb_defend'
            : 'lightning_participation_first_in';
        if (on.action !== off.action) {
          changed++;
          // base fold -> a big-blind call, or base fold (or the base small-blind
          // completion) -> a first-in raise, through the cell's reason code
          if (s.heroSeat === 2 || off.action !== 'call')
            expect(off.action, `${s.variant} seat ${s.heroSeat} hand ${i}`).toBe('fold');
          expect(on.action).toBe(s.heroSeat === 2 ? 'call' : 'raise');
          expect(on.branches).toContain(code);
          expect(on.fires.get('lightning_participation_changed')).toBe(1);
        } else {
          expect(on.branches).not.toContain(code);
          expect(on.fires.has('lightning_participation_changed')).toBe(false);
        }
        // never a NEW first-in limp
        if (s.heroSeat !== 2 && on.action === 'call') expect(off.action).toBe('call');
      }
      expect(
        changed,
        `${s.variant} ${s.dealt} dealt seat ${s.heroSeat} never engaged`
      ).toBeGreaterThan(0);
      changedTotal += changed;
    }
    expect(changedTotal).toBeGreaterThan(0);
  }, 240_000);

  it('on outside the predicate: byte-identical decisions and no opportunity is counted', () => {
    const outside: Spot[] = [
      { ...firstIn('plo4', 6, 6), domain: 'table' },
      { ...bbVsOpen('plo4', 6, 6), domain: 'table' },
      { ...bbVsOpen('nlh', 6, 6), domain: 'table' },
      { ...firstIn('plo4', 6, 6), gameMode: 'tournament' },
      { ...bbVsOpen('nlh', 6, 6), gameMode: 'tournament' },
      firstIn('plo4', 3, 3),
      bbVsOpen('plo5', 3, 3),
      { ...firstIn('plo5', 6, 6), bbAnte: false },
      { ...bbVsOpen('nlh', 6, 6), bbAnte: false },
      firstIn('plo6', 6, 6),
      bbVsOpen('plo6', 6, 6),
    ];
    for (const s of outside)
      for (let i = 0; i < 40; i++) {
        const off = play(s, i, OFF);
        const on = play(s, i, ON);
        expect(on.bytes, `${JSON.stringify(s)} hand ${i}`).toBe(off.bytes);
        expect(on.fires.has('lightning_participation_eligible')).toBe(false);
        expect(on.fires.has('lightning_participation_changed')).toBe(false);
      }
    // heads-up is refused by the dealt count as well
    expect(
      lightningParticipationEligibility(
        { holdem: true, omaha: true },
        {
          publicMemoryDomain: { speed: 'lightning' },
          gameMode: 'cash',
          stage: 'preflop',
          gameVariant: 'nlh',
          bigBlindAnte: true,
        },
        2
      )
    ).toEqual({ state: 'refused', reason: 'dealt_count' });
  }, 240_000);

  it('anything but exactly true is off', () => {
    const s = firstIn('plo4', 6, 6);
    for (let i = 0; i < 30; i++) {
      const off = play(s, i, OFF).bytes;
      for (const v of [false, undefined, 1, 'true'] as unknown[])
        expect(
          play(s, i, {
            lightningParticipationOmaha: v,
            lightningParticipationHoldem: v,
          } as HorseDecideOpts).bytes
        ).toBe(off);
    }
  }, 120_000);

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
      firstIn('plo4', 6, 6),
      firstIn('plo5', 6, 1),
      bbVsOpen('plo4', 6, 6),
      bbVsOpen('nlh', 6, 6),
    ])
      for (let i = 0; i < 60; i++) {
        const fresh = play(s, i, ON);
        const after = play(s, i, ON, foldThirty(s.variant, s.dealt));
        expect(after.bytes, `${s.variant} seat ${s.heroSeat} hand ${i}`).toBe(fresh.bytes);
      }
  }, 240_000);

  it('facing a 3-bet and a 4-bet at 100 and 200bb the decisions equal off', () => {
    for (const variant of ['nlh', 'plo4', 'plo5'])
      for (const stackBB of [100, 200]) {
        const open = variant === 'nlh' ? 2.5 : 4;
        const threeBet = variant === 'nlh' ? 10 : 13;
        const fourBet = variant === 'nlh' ? 24 : 40;
        const spots: Spot[] = [
          // hero opened the button, the big blind 3-bet
          {
            variant,
            dealt: 6,
            stackBB,
            heroSeat: 6,
            open: { seat: 6, toBB: open },
            reRaises: [{ seat: 2, toBB: threeBet }],
          },
          // hero 3-bet from the big blind, the button 4-bet
          {
            variant,
            dealt: 6,
            stackBB,
            heroSeat: 2,
            open: { seat: 6, toBB: open },
            reRaises: [
              { seat: 2, toBB: threeBet },
              { seat: 6, toBB: fourBet },
            ],
          },
        ];
        for (const s of spots)
          for (let i = 0; i < 50; i++) {
            const off = play(s, i, OFF);
            const on = play(s, i, ON);
            expect(on.bytes, `${variant} ${stackBB}bb hero ${s.heroSeat} hand ${i}`).toBe(
              off.bytes
            );
            expect(on.fires.has('lightning_participation_changed')).toBe(false);
          }
      }
  }, 240_000);

  it('first-in frequency is non-decreasing from the earliest seat to the button, per variant and dealt count', () => {
    for (const variant of ['nlh', 'plo4', 'plo5'])
      for (const dealt of [4, 5, 6]) {
        const freq: number[] = [];
        for (let seat = 3; seat <= dealt; seat++) {
          let n = 0;
          for (let i = 0; i < HANDS; i++)
            if (entered(play(firstIn(variant, dealt, seat), i, ON).action)) n++;
          freq.push(n);
        }
        for (let k = 1; k < freq.length; k++)
          expect(
            freq[k]!,
            `${variant} ${dealt} dealt: ${freq.join(' <= ')}`
          ).toBeGreaterThanOrEqual(freq[k - 1]!);
        if (variant !== 'nlh') {
          // the option widened the button, and the button is wider than the first seat
          let offButton = 0;
          for (let i = 0; i < HANDS; i++)
            if (entered(play(firstIn(variant, dealt, dealt), i, OFF).action)) offButton++;
          expect(freq[freq.length - 1]!).toBeGreaterThan(offButton);
          expect(freq[freq.length - 1]!).toBeGreaterThan(freq[0]!);
        }
      }
  }, 480_000);
});
