/**
 * omahaEliteContinuesVsMeasuredWideThreeBettor (2026-11-15, default OFF):
 * a PLO4/PLO5 cash Horse that opened, faces one re-raise from a MEASURED
 * wide re-raiser and will be IN POSITION against him (owner 2026-11-15
 * 11:49: out of position the fold stands) does not fold an elite-class hand to the maniac-price
 * arithmetic; the fold becomes a call.
 *
 *  - the read: the production PLO5 winner's counters are a wide re-raiser; a
 *    presumed or unknown player, a player with too few re-raise
 *    opportunities, a measured tight re-raiser, a wide OPENER who seldom
 *    re-raises and a re-raiser gone quiet are not;
 *  - the decision: unset and false are byte-identical; on, every fold against
 *    the measured wide re-raiser becomes a call (never a raise), every other
 *    decision and the random stream are unchanged, with the receipt; against
 *    a measured wide opener who is not a wide re-raiser, a presumed or
 *    unknown player, with a non-elite hand, in PLO6, Hi-Lo and tournaments it
 *    decides exactly as off; the changed decision passes the worker receipt
 *    validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import {
  freshExploitCounters,
  opponentExploitRead,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import {
  OMAHA_WIDE_RERAISE_MIN_OPPS,
  OMAHA_WIDE_RERAISE_MIN_RATE,
  omahaReadConditional,
} from './HorseOmahaReadConditional.js';
import { omahaEliteClassRead } from './HorseHandClasses.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Rates {
  hands: number;
  vpip: number;
  pfr: number;
  rfi: [number, number];
  threeBet: [number, number];
  fastThreeBet?: [number, number];
}
function row(r: Rates): ExploitCounters {
  const c = freshExploitCounters();
  c.hands = r.hands;
  c.vpip = r.vpip * r.hands;
  c.pfr = r.pfr * r.hands;
  c.rfiOpp = r.rfi[0];
  c.rfi = r.rfi[0] * r.rfi[1];
  c.threeBetOpp = r.threeBet[0];
  c.threeBet = r.threeBet[0] * r.threeBet[1];
  if (r.fastThreeBet) {
    c.fThreeBetOpp = r.fastThreeBet[0];
    c.fThreeBet = r.fastThreeBet[0] * r.fastThreeBet[1];
  }
  return c;
}
/** Lane owner 2026-11-15: the production PLO5 winner (decayed counters, full table). */
const WINNER: Rates = { hands: 40, vpip: 0.88, pfr: 0.55, rfi: [20, 0.82], threeBet: [15, 0.33] };
/** Measured maniac-wide OPENER who seldom re-raises. */
const WIDE_OPENER: Rates = {
  hands: 40,
  vpip: 0.88,
  pfr: 0.55,
  rfi: [20, 0.82],
  threeBet: [15, 0.07],
};
/** Measured tight: raises and re-raises little. */
const TIGHT: Rates = { hands: 60, vpip: 0.2, pfr: 0.08, rfi: [30, 0.1], threeBet: [25, 0] };
const read = (r: Rates, variant = 'plo5') => {
  const c = row(r);
  return omahaReadConditional(
    c,
    'omaha:full',
    variant,
    opponentExploitRead(c, 'omaha:full', variant)
  );
};

describe('the wide re-raiser read', () => {
  it('the production winner is a measured wide re-raiser, and not a tight one', () => {
    for (const v of ['plo4', 'plo5']) {
      const r = read(WINNER, v)!;
      expect([r.measured, r.wideReRaiser, r.tightReRaiser]).toEqual([true, true, false]);
      expect(r.threeBet.mean).toBeGreaterThanOrEqual(OMAHA_WIDE_RERAISE_MIN_RATE);
    }
  });
  it('no row, too few hands, or too few re-raise opportunities: not wide', () => {
    expect(omahaReadConditional(undefined, 'omaha:full', 'plo5', null)).toBeNull();
    expect(read({ ...WINNER, hands: 10 })!.wideReRaiser).toBe(false);
    expect(
      read({ ...WINNER, threeBet: [OMAHA_WIDE_RERAISE_MIN_OPPS - 1, 0.33] })!.wideReRaiser
    ).toBe(false);
  });
  it('a presumed (Horse-like) player is never wide, whatever his few re-raises', () => {
    const r = read({ hands: 40, vpip: 0.3, pfr: 0.17, rfi: [15, 0.3], threeBet: [15, 0.33] })!;
    expect(r.measured).toBe(false);
    expect(r.wideReRaiser).toBe(false);
  });
  it('a measured tight re-raiser and a wide opener who seldom re-raises are not wide', () => {
    expect(read(TIGHT)!.wideReRaiser).toBe(false);
    const o = read(WIDE_OPENER)!;
    expect([o.measured, o.wideReRaiser]).toEqual([true, false]);
  });
  it('a recent window without re-raises withdraws the read', () => {
    expect(read({ ...WINNER, fastThreeBet: [12, 0] })!.wideReRaiser).toBe(false);
    expect(read({ ...WINNER, fastThreeBet: [12, 0.33] })!.wideReRaiser).toBe(true);
  });
});

// ─── the decision ───────────────────────────────────────────────────────────

const HERO = '86000001-0000-4000-8000-000000000001';
const VILLAIN = '40000000-0000-4000-8000-0000000000c3';
const other = (n: number) => `4000000${n}-0000-4000-8000-0000000000f${n}`;

/**
 * Six-handed pot limit, 100bb (blinds 1/2, dealer seat 6).
 * In position (default): hero on the button (seat 6) opens to 7, the big
 * blind (seat 2) re-raises pot to 22; hero faces 15 more into 30.
 * Out of position: hero in the cutoff (seat 5) opens to 7, the button
 * (seat 6) re-raises pot to 24, the blinds fold; hero faces 17 more into 34.
 */
function threeBetGs(
  variant: string,
  hole: string,
  over: Partial<HorseGameStateV2> = {},
  outOfPosition = false
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroSeat = outOfPosition ? 5 : 6;
  const villainSeat = outOfPosition ? 6 : 2;
  const to = outOfPosition ? 24 : 22;
  const uid = (n: number) => (n === heroSeat ? HERO : n === villainSeat ? VILLAIN : other(n));
  const bet: Record<number, number> = { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0 };
  bet[heroSeat] = 7;
  bet[villainSeat] = to;
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: 200 - bet[n],
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === heroSeat ? cards(hole) : [],
        is_folded: n !== heroSeat && n !== villainSeat,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === heroSeat,
      }) as SeatPlayer
  );
  const act = (seat: number, action: string, amount: number, timestamp: number) => ({
    stage: 'preflop',
    seat,
    userId: uid(seat),
    action,
    amount,
    ...(action === 'raise' ? { isFullRaise: true } : {}),
    timestamp,
  });
  const pot = Object.values(bet).reduce((a, b) => a + b, 0);
  const toCall = to - 7;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet: to,
    toCall,
    minRaise: to - 7,
    minRaiseTo: to + (to - 7),
    maxRaiseTo: to + pot + toCall,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 6,
    gameMode: 'cash',
    actionHistory: outOfPosition
      ? [
          act(1, 'sb', 1, 1),
          act(2, 'bb', 2, 2),
          act(3, 'fold', 0, 3),
          act(4, 'fold', 0, 4),
          act(5, 'raise', 7, 5),
          act(6, 'raise', 24, 6),
          act(1, 'fold', 0, 7),
          act(2, 'fold', 0, 8),
        ]
      : [
          act(1, 'sb', 1, 1),
          act(2, 'bb', 2, 2),
          act(3, 'fold', 0, 3),
          act(4, 'fold', 0, 4),
          act(5, 'fold', 0, 5),
          act(6, 'raise', 7, 6),
          act(1, 'fold', 0, 7),
          act(2, 'raise', 22, 8),
        ],
    ...over,
  } as unknown as HorseGameStateV2;
  return { hero: players[heroSeat - 1], gs };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 5100 + i);
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
function playMany(
  build: () => { hero: SeatPlayer; gs: HorseGameStateV2 },
  opts: HorseDecideOpts,
  rates: Rates | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    const { hero, gs } = build();
    if (rates)
      (
        HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }
      ).exploitCounters.set(`${readScopeOf(String(gs.gameVariant), 6)}|${VILLAIN}`, row(rates));
    drainFires();
    seedFastRandom(s);
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
    out.next.push(fastRandom());
    out.bytes.push(bytesOf(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const ON: HorseDecideOpts = { omahaEliteContinuesVsMeasuredWideThreeBettor: true };
const FIRE = 'omaha_elite_continues_vs_measured_wide_three_bettor';
const WITHHELD = `${FIRE}_withheld`;
const count = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const folds = (o: Outcome) => o.actions.filter((a) => a === 'fold').length;

/** Elite-class hands the census found folding, in position, to the measured winner's 3-bet. */
const ELITE = [
  { variant: 'plo5', hole: '8d7h6h5c7c', cls: 'rundown_ds' },
  { variant: 'plo5', hole: '3dAhQs2hJs', cls: 'ax_nut_suited' },
  { variant: 'plo5', hole: 'TdJcKd7dQc', cls: 'broadway_conn_ds' },
  { variant: 'plo4', hole: '8h5h6d7d', cls: 'rundown_ds' },
];

describe.each(ELITE)('$variant $hole ($cls) opened, facing one re-raise', (p) => {
  const build = () => threeBetGs(p.variant, p.hole);

  it('is the elite class, and today folds some of the time to the measured winner', () => {
    const el = omahaEliteClassRead(cards(p.hole), false);
    expect([el.cls, el.canFourBetShallow]).toEqual([p.cls, true]);
    expect(folds(playMany(build, {}, WINNER))).toBeGreaterThan(0);
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = playMany(build, {}, WINNER);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const o = playMany(build, { omahaEliteContinuesVsMeasuredWideThreeBettor: v }, WINNER);
      expect(o.bytes).toEqual(unset.bytes);
      expect(o.next).toEqual(unset.next);
      expect(count(o, FIRE) + count(o, WITHHELD)).toBe(0);
    }
  });

  it('on, against the measured wide re-raiser: every fold becomes a call, nothing else moves', () => {
    const off = playMany(build, {}, WINNER);
    const on = playMany(build, ON, WINNER);
    let changed = 0;
    on.actions.forEach((a, i) => {
      if (off.actions[i] === 'fold') {
        expect(a).toBe('call');
        expect(JSON.parse(on.bytes[i]).amount).toBe(15);
        expect(on.fires[i]).toContain(FIRE);
        changed++;
      } else {
        expect(on.bytes[i]).toEqual(off.bytes[i]);
        expect(on.fires[i]).not.toContain(FIRE);
      }
    });
    expect(changed).toBe(folds(off));
    expect(folds(on)).toBe(0);
    expect(count(on, FIRE)).toBe(changed);
    expect(on.next).toEqual(off.next);
    // never creates a raise
    const raises = (o: Outcome) => o.actions.filter((a) => a === 'raise' || a === 'all_in').length;
    expect(raises(on)).toBe(raises(off));
  });

  it('on, the changed decision passes the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      const { hero, gs } = build();
      (
        HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }
      ).exploitCounters.set(`${readScopeOf(p.variant, 6)}|${VILLAIN}`, row(WINNER));
      seedFastRandom(s);
      const d = structuredClone(HorseLogic.decide(hero, gs, 'balanced', {}, ON));
      expect(d.action).not.toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), p.variant, { player: hero, gameState: gs })
      ).toBeNull();
    }
  });

  it('on, against a measured wide OPENER who is not a wide re-raiser: as off, withheld', () => {
    const off = playMany(build, {}, WIDE_OPENER);
    const on = playMany(build, ON, WIDE_OPENER);
    expect(folds(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
    expect(on.next).toEqual(off.next);
    expect(count(on, FIRE)).toBe(0);
    expect(count(on, WITHHELD)).toBe(folds(off));
  });

  it('on, against a measured tight re-raiser, an unknown (presumed) player, or the mind off: as off', () => {
    for (const [rates, extra] of [
      [TIGHT, {}],
      [null, {}],
      [WINNER, { mind: false }],
    ] as const) {
      const off = playMany(build, { ...extra }, rates);
      const on = playMany(build, { ...ON, ...extra }, rates);
      expect(on.bytes).toEqual(off.bytes);
      expect(on.next).toEqual(off.next);
      expect(count(on, FIRE)).toBe(0);
    }
  });

  it('on, with the read saying presumed (not measured): as off', () => {
    const off = playMany(build, {}, WINNER);
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(
      () => ({ measured: false, wideReRaiser: false, tightReRaiser: false }) as never
    );
    const on = playMany(build, ON, WINNER);
    expect(on.bytes).toEqual(off.bytes);
    expect(count(on, FIRE)).toBe(0);
  });

  it('on, OUT of position against the re-raiser (cutoff open, button 3-bet): as off, the fold stands', () => {
    const oop = () => threeBetGs(p.variant, p.hole, {}, true);
    const off = playMany(oop, {}, WINNER);
    const on = playMany(oop, ON, WINNER);
    expect(folds(off)).toBeGreaterThan(0);
    expect(on.bytes).toEqual(off.bytes);
    expect(on.next).toEqual(off.next);
    expect(count(on, FIRE) + count(on, WITHHELD)).toBe(0);
  });

  it('on, in a tournament: as off', () => {
    const t = () => threeBetGs(p.variant, p.hole, { gameMode: 'tournament' } as never);
    const off = playMany(t, {}, WINNER);
    const on = playMany(t, ON, WINNER);
    expect(on.bytes).toEqual(off.bytes);
    expect(count(on, FIRE)).toBe(0);
  });
});

describe('outside the rule', () => {
  const OUTSIDE = [
    { name: 'a non-elite PLO5 hand', variant: 'plo5', hole: 'Kc9d6h3s2c' },
    { name: 'a non-elite PLO4 hand', variant: 'plo4', hole: 'Qc9d6h2s' },
    {
      name: 'a single-suited rundown (not an elite continue class)',
      variant: 'plo5',
      hole: '8c7cTh9s2d',
    },
    {
      name: 'an elite class the read does not mark as a shallow 4-bet hand',
      variant: 'plo5',
      hole: '9c7c6d5d2h',
    },
    { name: 'PLO6', variant: 'plo6', hole: '8c7cTh9s6h2d' },
    { name: 'PLO8 (Hi-Lo)', variant: 'plo8', hole: '8cTd9c7d' },
  ];
  it('the unmarked elite hand is in a continue class without the shallow 4-bet mark', () => {
    const el = omahaEliteClassRead(cards('9c7c6d5d2h'), false);
    expect([el.cls, el.canFourBetShallow]).toEqual(['rundown_ds', false]);
  });
  it.each(OUTSIDE)('$name: on decides exactly as off', (p) => {
    const build = () => threeBetGs(p.variant, p.hole);
    const off = playMany(build, {}, WINNER);
    const on = playMany(build, ON, WINNER);
    expect(on.bytes).toEqual(off.bytes);
    expect(on.next).toEqual(off.next);
    expect(count(on, FIRE)).toBe(0);
  });
});
