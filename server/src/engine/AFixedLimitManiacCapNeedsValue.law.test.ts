/**
 * LAW: A FIXED-LIMIT MANIAC CAP NEEDS VALUE (2026-11-15, Fixed-Limit lane, AJ).
 *
 * V53 4-bets a 3-bet from an aggressive raiser whenever the V38 equity
 * against his read range clears the required equity by 6 points. In fixed
 * limit that 4-bet is the preflop cap: one more small bet that the raiser
 * calls, worth (2e - 1) small bets, break-even at e = 0.5. Measured on main
 * (AH-V38-FIXED-LIMIT.md), flh 6-max against an observed maniac's 3-bet: Q9o,
 * J8o, 76s, 54s, 83o and 72o capped with 0.30-0.46 equity, and each calls
 * against an unknown 3-bettor.
 *
 * With HorseDecideOpts.fixedLimitManiacCapNeedsValue (read as === true,
 * DEFAULT OFF) a fixed-limit pressure raise that would be the cap fires only
 * when that equity is at least 0.5 + m, m = two standard errors of the
 * estimate at the sample count the decision used (HorseFixedLimitManiacCap.ts),
 * and the hand calls otherwise. Off is identical to the code without the
 * option. Heads-up fixed limit and flo8 (where the maniac price is not reached),
 * no-limit and pot-limit, and an unknown 3-bettor are unchanged. The receipt
 * fires only when the action changes.
 *
 * SCOPE (2026-11-16, the lane owner's rulings on REVIEW-MC-237f1ad9.md): the
 * rule acts only heads-up after the 3-bet (the 3-bettor the only other player
 * in, no other live player able to respond) and only at cash tables. With a
 * cold-caller in, the cap breaks even at 1/3, not 0.5 (the review: 99 and KQs
 * capped +EV there and the 0.5 bar called them), and no evidence covers
 * fixed-limit tournaments. Both spots decide exactly as with the option off.
 * The rule's decision function is pinned directly: its only answer is the
 * call for the chips owed, never a fold or a raise (a fold at this gate would
 * be hidden from the behaviour cases by the maniac call-down, which turns
 * every fold against a maniac read back into a call).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cards, deal, decide, type Fmt } from './HuVariantSpot.test-support.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { maniac } from './HorseOpponentStyle.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  FIXED_LIMIT_CAP_BREAK_EVEN,
  fixedLimitCapValueBar,
  fixedLimitCapValueMargin,
  fixedLimitManiacCapCall,
  fixedLimitPreflopRaiseIsTheCap,
  type FixedLimitManiacCapSpot,
} from './HorseFixedLimitManiacCap.js';

const RECEIPT = 'fixed_limit_maniac_cap_value_call_seen';
const RANKS = '23456789TJQKA';
const ALL = [...RANKS].flatMap((r) => ['c', 'd', 'h', 's'].map((s) => `${r}${s}`));
const FLH_HANDS = ['AhAd', 'KsQs', '9d9c', 'Ac5d', '7h6h', 'Jc8d', 'Qh9c', '5s4s', '8c3d', '7d2c'];
const WEAK = ['7h6h', 'Jc8d', 'Qh9c', '5s4s', '8c3d', '7d2c'];
/** Equity against the maniac's range well clear of the bar in every seed
 *  (AH-V38-FIXED-LIMIT.md: AA 0.845, 99 0.658). KQs (0.588 on average, 1.4
 *  standard errors above the bar) caps in most seeds; a seed whose estimate
 *  lands under the bar calls, which is the rule. */
const STRONG = ['AhAd', '9d9c'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const OMAHA_HANDS = ['AsAd2c3h', 'Ah2d5c7s', '9h8s7d6c', 'Td9c3h2s'];
/** The V38 equity request in HorseLogic, max(160, floor(0.8 * vi.iterations)),
 *  at full governor scale: vi.iterations is 450 for fixed-limit hold'em. */
const N_FLH = Math.max(160, Math.floor(450 * 0.8));
const BAR_FLH = fixedLimitCapValueBar(N_FLH);

function installManiac(userId: string, variant: string, mode: Fmt = 'cash'): void {
  HorseMind.reset();
  const a = maniac();
  HorseMind.importStats([{ user_id: userId, ...(a.tallies as Record<string, number>) }]);
  HorseMind.importDurableOpponentProfiles(
    (['hu', 'short', 'full'] as const).map((size) => ({
      user_id: userId,
      variant,
      mode,
      size,
      observed_hands: Math.round(a.counters.hands),
      initialized: true,
      public_memory_domain: { version: 1, speed: 'table', ante: 'none' },
      counters: a.counters,
    })) as never
  );
}

const isRaise = (a: { stage: string; action: string; origin?: string }) =>
  a.stage === 'preflop' && a.origin !== 'forced' && (a.action === 'raise' || a.action === 'all_in');

/** The spot's shape: the table format, and whether the seat after the
 *  3-bettor cold-calls the 3-bet (the multiway spot) or folds (heads-up). */
interface Shape {
  fmt: Fmt;
  coldCall: boolean;
}
const HU_CASH: Shape = { fmt: 'cash', coldCall: false };
const COLD_CALL_CASH: Shape = { fmt: 'cash', coldCall: true };
const HU_TOURNAMENT: Shape = { fmt: 'tournament', coldCall: false };

/** The Horse (first to act) opens, the next seat 3-bets, everyone else folds;
 *  with shape.coldCall the seat after the 3-bettor calls the 3-bet first. */
function face3bet(
  variant: string,
  seats: number,
  heroCards: string,
  rot: number,
  shape: Shape = HU_CASH
) {
  const holeCount = variant === 'flo8' || variant.startsWith('plo') ? 4 : 2;
  const { fmt } = shape;
  const probe = deal({ variant, fmt, stacks: Array(seats).fill(400), rnd: () => 0.5 });
  const heroSeat = probe.controller.getCurrentPlayer()!.seat;
  const order = probe.controller
    .getState()
    .players.map((p) => p.seat)
    .sort((x, y) => x - y);
  const villainSeat = order[(order.indexOf(heroSeat) + 1) % order.length]!;
  const coldSeat = shape.coldCall ? order[(order.indexOf(heroSeat) + 2) % order.length]! : -1;
  const hero = heroCards.match(/../g)!;
  const pool = ALL.filter((c) => !hero.includes(c));
  const start = (rot * 7) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  let k = 0;
  const prefix: string[] = [];
  for (let s = 1; s <= seats; s++)
    prefix.push(...(s === heroSeat ? hero : rotated.slice(k, (k += holeCount))));
  const t = deal({
    variant,
    fmt,
    stacks: Array(seats).fill(400),
    prefix: cards(prefix.join(' ')),
  });
  const c = t.controller;
  for (let guard = 0; guard < 60; guard++) {
    const st = c.getState();
    const actor = c.getCurrentPlayer();
    if (!actor || st.stage !== 'preflop') break;
    const menu = c.getAuthoritativeActionState(actor.user_id)!;
    if (
      actor.seat === heroSeat &&
      menu.toCall > 0 &&
      st.actionHistory.filter(isRaise).length === 2
    ) {
      const dealt = st.players
        .find((p) => p.seat === heroSeat)!
        .cards.map((x) => `${x.rank}${x.suit[0]}`);
      expect(dealt.join('')).toBe(heroCards);
      const live = st.players.filter((p) => !p.is_folded).map((p) => p.seat);
      expect(live.sort((x, y) => x - y)).toEqual(
        [heroSeat, villainSeat, ...(shape.coldCall ? [coldSeat] : [])].sort((x, y) => x - y)
      );
      return { t, villainSeat };
    }
    if (actor.seat === heroSeat || actor.seat === villainSeat) {
      expect(
        c.performAction(actor.seat, 'raise' as never, menu.minRaiseTo ?? undefined, 'player')
      ).toBeTruthy();
      continue;
    }
    if (actor.seat === coldSeat && st.actionHistory.filter(isRaise).length === 2) {
      expect(c.performAction(actor.seat, 'call' as never, undefined, 'player')).toBeTruthy();
      continue;
    }
    const a = menu.legalActions.includes('fold' as never) && menu.toCall > 0 ? 'fold' : 'check';
    expect(c.performAction(actor.seat, a as never, undefined, 'player')).toBeTruthy();
  }
  throw new Error(`no face-a-3-bet spot for ${variant} ${seats} ${heroCards}`);
}

interface Seen {
  action: string;
  amount?: number;
  consumer: string | null;
  equity: number | null;
  receipts: number;
}

/** One decision. HuVariantSpot's decide() resets HorseMind before deciding,
 *  which would wipe the installed read, so reset is held off for that call. */
function run(
  variant: string,
  seats: number,
  hand: string,
  seed: number,
  read: 'maniac' | 'unknown',
  option: unknown,
  shape: Shape = HU_CASH
): Seen {
  const sp = face3bet(variant, seats, hand, seed, shape);
  const villain = sp.t.controller.getState().players.find((p) => p.seat === sp.villainSeat)!;
  if (read === 'maniac') installManiac(villain.user_id, variant, shape.fmt);
  else HorseMind.reset();
  const opts: Partial<HorseDecideOpts> = {
    mind: true,
    telemetry: true,
    ...(option === undefined
      ? {}
      : {
          fixedLimitManiacCapNeedsValue: option as HorseDecideOpts['fixedLimitManiacCapNeedsValue'],
        }),
  };
  drainFires();
  const hold = vi.spyOn(HorseMind, 'reset').mockImplementation(() => undefined);
  try {
    const { d } = decide(sp.t, 9000 + seed, opts);
    const receipt = (d as { preflopReadReceipt?: { consumer: string; strength: number | null } })
      .preflopReadReceipt;
    return {
      action: d.action,
      ...(d.amount === undefined ? {} : { amount: d.amount }),
      consumer: receipt?.consumer ?? null,
      equity: receipt?.strength ?? null,
      receipts: drainFires()
        .filter((f) => f.feature === RECEIPT)
        .reduce((n, f) => n + f.fires, 0),
    };
  } finally {
    hold.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('a fixed-limit maniac cap needs value (fixedLimitManiacCapNeedsValue, default off)', () => {
  enableBrainTelemetry();

  it('the bar is 0.5 plus two standard errors of the estimate at its sample count, not a chosen number', () => {
    expect(FIXED_LIMIT_CAP_BREAK_EVEN).toBe(0.5);
    for (const n of [176, 360, 450, 1000])
      expect(fixedLimitCapValueMargin(n)).toBeCloseTo(2 * Math.sqrt(0.25 / n), 12);
    expect(N_FLH).toBe(360);
    expect(BAR_FLH).toBeCloseTo(0.5527, 4);
    expect(fixedLimitCapValueBar(176)).toBeCloseTo(0.5754, 4);
    // no sample count: no cap (fail safe to the call)
    expect(fixedLimitCapValueMargin(0)).toBe(1);
    expect(fixedLimitCapValueMargin(Number.NaN)).toBe(1);
  });

  it('on: in flh 6-max facing a maniac 3-bet after the open, the 30-46% hands call and the strong hands still cap', () => {
    let kqCaps = 0;
    for (const hand of FLH_HANDS) {
      for (const seed of SEEDS) {
        const on = run('flh', 6, hand, seed, 'maniac', true);
        expect(on.consumer, `${hand} ${seed}`).toBe('maniac_price');
        if (WEAK.includes(hand)) expect(on.action, `${hand} ${seed}`).toBe('call');
        if (STRONG.includes(hand)) expect(on.action, `${hand} ${seed}`).toBe('raise');
        if (hand === 'KsQs' && on.action === 'raise') kqCaps++;
        // every hand, A5o included: the cap fires only at or above the bar
        if (on.action === 'raise')
          expect(on.equity!, `${hand} ${seed}`).toBeGreaterThanOrEqual(BAR_FLH - 1e-3);
        else {
          expect(on.action, `${hand} ${seed}`).toBe('call');
          expect(on.equity!, `${hand} ${seed}`).toBeLessThan(BAR_FLH + 1e-3);
        }
      }
    }
    expect(kqCaps).toBeGreaterThanOrEqual(SEEDS.length - 2);
  });

  it('off: identical to the code without the option, which caps the weak hands', () => {
    let weakCaps = 0;
    let weakDecisions = 0;
    for (const hand of FLH_HANDS) {
      for (const seed of SEEDS) {
        const off = run('flh', 6, hand, seed, 'maniac', false);
        const absent = run('flh', 6, hand, seed, 'maniac', undefined);
        expect(off, `${hand} ${seed}`).toEqual(absent);
        expect(off.receipts).toBe(0);
        if (WEAK.includes(hand)) {
          weakDecisions++;
          if (off.action === 'raise') weakCaps++;
        }
      }
    }
    // the measured defect is present with the option off (AH-V38-FIXED-LIMIT.md: 112 of 120)
    expect(weakCaps).toBeGreaterThanOrEqual(Math.ceil(weakDecisions * 0.75));
  });

  it('the receipt fires exactly when the option changes the action, and only from a cap to a call', () => {
    let changed = 0;
    for (const hand of FLH_HANDS) {
      for (const seed of SEEDS) {
        for (const read of ['maniac', 'unknown'] as const) {
          const on = run('flh', 6, hand, seed, read, true);
          const off = run('flh', 6, hand, seed, read, undefined);
          const differs = on.action !== off.action;
          expect(on.receipts, `${hand} ${seed} ${read}`).toBe(differs ? 1 : 0);
          if (differs) {
            changed++;
            expect([off.action, on.action]).toEqual(['raise', 'call']);
          } else {
            expect(on, `${hand} ${seed} ${read}`).toEqual(off);
          }
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('unchanged: flh heads-up, flo8 six seats and heads-up, an unknown 3-bettor, no-limit and pot-limit', () => {
    const cases: Array<[string, number, string[], 'maniac' | 'unknown']> = [
      ['flh', 2, FLH_HANDS, 'maniac'],
      ['flh', 2, FLH_HANDS, 'unknown'],
      ['flh', 6, FLH_HANDS, 'unknown'],
      ['flo8', 6, OMAHA_HANDS, 'maniac'],
      ['flo8', 2, OMAHA_HANDS, 'maniac'],
      ['flo8', 6, OMAHA_HANDS, 'unknown'],
      ['nlh', 6, FLH_HANDS, 'maniac'],
      ['plo4', 6, OMAHA_HANDS, 'maniac'],
    ];
    for (const [variant, seats, hands, read] of cases) {
      for (const hand of hands) {
        for (const seed of SEEDS.slice(0, 4)) {
          const on = run(variant, seats, hand, seed, read, true);
          const off = run(variant, seats, hand, seed, read, undefined);
          expect(on, `${variant} ${seats} ${hand} ${seed} ${read}`).toEqual(off);
          expect(on.receipts).toBe(0);
        }
      }
    }
  });

  it('multiway: with a cold-caller in after the maniac 3-bet, on decides exactly as off, 99 and KQs included', () => {
    // flh 6-max: the Horse opens, the maniac 3-bets, the next seat cold-calls
    // (REVIEW-MC-237f1ad9.md finding 1). Two players are in at this price, so
    // the cap breaks even at 1/3 and the 0.5 bar does not apply.
    let underBarCaps = 0;
    const underBarHands = new Set<string>();
    for (const hand of FLH_HANDS) {
      for (const seed of SEEDS.slice(0, 6)) {
        const on = run('flh', 6, hand, seed, 'maniac', true, COLD_CALL_CASH);
        const off = run('flh', 6, hand, seed, 'maniac', undefined, COLD_CALL_CASH);
        expect(on, `${hand} ${seed}`).toEqual(off);
        expect(on.receipts, `${hand} ${seed}`).toBe(0);
        // the spot is live: off caps here with equity under the heads-up bar
        if (off.action === 'raise' && off.equity !== null && off.equity < BAR_FLH) {
          underBarCaps++;
          underBarHands.add(hand);
        }
      }
    }
    expect(underBarCaps).toBeGreaterThan(0);
    expect(underBarHands.has('9d9c')).toBe(true);
    expect(underBarHands.has('KsQs')).toBe(true);
  });

  it('tournament: at a fixed-limit tournament table, heads-up after the maniac 3-bet, on decides exactly as off', () => {
    let underBarCaps = 0;
    for (const seats of [6, 2]) {
      for (const hand of FLH_HANDS) {
        for (const seed of SEEDS.slice(0, 6)) {
          const on = run('flh', seats, hand, seed, 'maniac', true, HU_TOURNAMENT);
          const off = run('flh', seats, hand, seed, 'maniac', undefined, HU_TOURNAMENT);
          expect(on, `${seats} ${hand} ${seed}`).toEqual(off);
          expect(on.receipts, `${seats} ${hand} ${seed}`).toBe(0);
          if (off.action === 'raise' && off.equity !== null && off.equity < BAR_FLH) underBarCaps++;
        }
      }
    }
    // the spot is live: off caps here with equity under the heads-up bar
    expect(underBarCaps).toBeGreaterThan(0);
  });

  it("the rule's decision function: its only answer is the call for the chips owed, never a fold or a raise", () => {
    const capHistory = face3bet('flh', 6, 'AhAd', 1).t.controller.getState().actionHistory;
    const lastRaise = capHistory.map((a) => isRaise(a)).lastIndexOf(true);
    const belowCap = capHistory.slice(0, lastRaise);
    expect(fixedLimitPreflopRaiseIsTheCap(capHistory)).toBe(true);
    expect(fixedLimitPreflopRaiseIsTheCap(belowCap)).toBe(false);
    let calls = 0;
    let checked = 0;
    for (const option of [true, undefined, false, 1, 'true', {}])
      for (const fixedLimit of [true, false])
        for (const tournament of [false, true])
          for (const playersInPot of [0, 1, 2, 3])
            for (const otherLiveResponder of [false, true])
              for (const actions of [capHistory, belowCap])
                for (const equity of [Number.NaN, 0, 0.3, 0.5, BAR_FLH - 1e-9, BAR_FLH, 0.6, 1])
                  for (const sampleSize of [Number.NaN, 0, 176, 360])
                    for (const toCall of [1, 2])
                      for (const stack of [0.5, 1, 400]) {
                        const spot: FixedLimitManiacCapSpot = {
                          option,
                          fixedLimit,
                          tournament,
                          playersInPot,
                          otherLiveResponder,
                          actions,
                          equity,
                          sampleSize,
                          toCall,
                          stack,
                        };
                        const out = fixedLimitManiacCapCall(spot);
                        checked++;
                        const acts =
                          option === true &&
                          fixedLimit &&
                          !tournament &&
                          playersInPot === 1 &&
                          !otherLiveResponder &&
                          actions === capHistory &&
                          equity < fixedLimitCapValueBar(sampleSize);
                        if (!acts) {
                          expect(
                            out,
                            JSON.stringify({ ...spot, actions: actions.length })
                          ).toBeNull();
                          continue;
                        }
                        calls++;
                        // exactly a call for the chips owed: no other key, no fold, no raise
                        expect(out).toEqual({ action: 'call', amount: Math.min(toCall, stack) });
                        expect(Object.keys(out!).sort()).toEqual(['action', 'amount']);
                        if (stack > toCall) expect(out!.amount).toBe(toCall);
                      }
    expect(checked).toBe(6 * 2 * 2 * 4 * 2 * 2 * 8 * 4 * 2 * 3);
    expect(calls).toBeGreaterThan(0);
  });

  it('the option is read only as === true, the gate passes the scope facts, and its answer is returned as is', () => {
    const src = readFileSync(resolve(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(src).toMatch(
      /const capCall38 = fixedLimitManiacCapCall\(\{\s*option: opts\.fixedLimitManiacCapNeedsValue,\s*fixedLimit: vi\.isFixedLimit,\s*tournament: isTournamentMode\(gs\),\s*playersInPot: inPotPlayers38\.length,\s*otherLiveResponder: otherLiveResponder38,\s*actions: gs\.actionHistory \?\? \[\],\s*equity: eq38,\s*sampleSize: eqSamples38,\s*toCall,\s*stack: player\.stack,\s*\}\);/
    );
    expect(src).toMatch(
      /if \(capCall38 !== null\) \{[^}]*return \{ \.\.\.capCall38, thinkTime: 0 \};\s*\}/
    );
    expect(src).not.toMatch(/fixedLimitManiacCapNeedsValue !== false/);
    const mod = readFileSync(resolve(__dirname, 'HorseFixedLimitManiacCap.ts'), 'utf8');
    expect(mod).toMatch(/spot\.option !== true \|\|/);
    expect(mod).toMatch(/!fixedLimitPreflopRaiseIsTheCap\(spot\.actions\)/);
  });
});
