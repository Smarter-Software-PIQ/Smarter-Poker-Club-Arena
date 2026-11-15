/**
 * LAW (2026-11-15): AN ORDINARY TIGHT REGULAR IS READ AS TIGHT, on the paths live decisions take.
 *
 * The defect. The style read's VPIP and PFR evidence decayed with a 30-hand half-life, so a player's decayed hand
 * count saturated at 1 / (1 - 2^(-1/30)) = 43.8. With the 90% one-sided credibility, 6 prior hands at the Horse mean
 * and the 0.02 margin, the tight side of participation was callable only at VPIP <= 0.119 full ring (0.231 short-handed,
 * 0.302 heads-up), and the tight-opener response also needed PFR <= 0.060 (0.158, 0.213): a 14% / 7% full-ring regular
 * was never read as tight however long he played. The fix keeps a 120-hand long participation window (hands, VPIP,
 * PFR; saturating at 173.6) in the in-process learner store and in the accepted-hand database learner
 * (horse_exact_profiles.long_counters), and the classifier reads VPIP, PFR and the call share from it when it holds more
 * evidence than the 30-hand window and both windows lean low or even. Credibility, margins, prior hands, the 15-hand
 * unknown gate and the fast-window release are unchanged. Declared target (before any measurement, from arithmetic):
 * tight callable at VPIP <= 0.156 full ring, 0.279 short-handed, 0.354 heads-up; PFR <= 0.088 / 0.200 / 0.260.
 *
 * This file drives the in-process observe path (HorseMind.observeHandComplete, as settlement and the observer bank's
 * callback call it) and the pooled public path (HorseObserverReads.complete with the accepted hand's durable rows, then
 * HorseObserverReads.run for the decision), and the read frame the second look and exact replay decode. Players are
 * synthetic; every rate is a deterministic low-discrepancy sequence, so the hand counts below are exact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind } from '../HorseMind.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import {
  EXPLOIT_COUNTER_FIELDS,
  exploitHandIncrements,
  freshExploitCounters,
  observeExploitRow,
  type ExploitCounters,
  type ExploitHandAction,
} from '../HorseOpponentExploit.js';
import {
  classifyOpponentStyle,
  tightOpenerRespect,
  type OpponentStyleRead,
} from '../HorseOpponentStyle.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { ReadScope } from '../HorseMind.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000011';
const lease = '50000000-0000-4000-8000-000000000011';
const observer = '20000000-0000-4000-8000-000000000011';
const reader = '20000000-0000-4000-8000-000000000012';
const regular = '30000000-0000-4000-8000-000000000011';
/** seat 3 of every request below */
const horse = '40000000-0000-4000-8000-000000000013';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const LIGHTNING: HorsePublicMemoryDomain = { version: 1, speed: 'lightning', ante: 'none' };
type Format = 'cash' | 'mtt';
type Variant = 'nlh' | 'flh';
const modeOf = (format: Format) => (format === 'cash' ? 'cash' : 'tournament');
const sizeOf = (dealt: number) => (dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full');
const scopeOf = (dealt: number) => `holdem:${sizeOf(dealt)}` as ReadScope;
/** The database learner's long window: each field aged 2^(-1/120) per counted hand plus that hand's increment
 * (fn_horse_long_participation_add, supabase/migrations/20261115015341_...). Written out here, not imported. */
const LONG_DECAY = Math.pow(0.5, 1 / 120);
const PHI = (Math.sqrt(5) - 1) / 2;

/** The regular's preflop action on hand n at the given rates: raise, call (limp) or fold, spread evenly. */
function choice(n: number, vpip: number, pfr: number): 'raise' | 'call' | 'fold' {
  const u = ((n + 1) * PHI) % 1;
  return u < pfr ? 'raise' : u < vpip ? 'call' : 'fold';
}
function regularHand(n: number, vpip: number, pfr: number): ExploitHandAction[] {
  const a = choice(n, vpip, pfr);
  return [
    {
      userId: regular,
      stage: 'preflop',
      action: a,
      origin: 'player',
      amount: a === 'raise' ? 6 : a === 'call' ? 2 : 0,
      isFullRaise: a === 'raise' ? true : undefined,
    },
    { userId: horse, stage: 'preflop', action: 'fold', origin: 'horse_policy', amount: 0 },
  ];
}

function request(
  id: string,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  decisionTimeMs: number,
  format: Format = 'cash',
  variant: Variant = 'nlh'
): FastHorseDecisionRequest {
  const seats = Array.from({ length: dealt }, (_, i) => i + 1);
  const others = [regular, ...seats.slice(2).map((s) => `40000000-0000-4000-8000-00000000001${s}`)];
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:2000001:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    gameState: {
      gameVariant: variant,
      format,
      gameMode: modeOf(format),
      ...(format === 'cash' ? {} : { tournament: { contextStatus: 'complete' } }),
      publicMemoryDomain: domain,
      dealtSeatIds: seats,
      players: seats.map((seat) => ({ user_id: seat === 1 ? id : others[seat - 2]!, seat })),
    },
  } as never;
}

interface Pooled {
  counters: ExploitCounters;
  long: { lHands: number; lVpip: number; lPfr: number };
  hands: number;
}
/** The regular's exact profile row after these hands, as the accepted-hand database learner writes it: the 27
 * counters (fn_horse_exploit_add, the opportunity-scoped rule the engine shares) and the long window. */
function pooledAfter(hands: ExploitHandAction[][]): Pooled {
  const rows = new Map<string, ExploitCounters>();
  const long = { lHands: 0, lVpip: 0, lPfr: 0 };
  let counted = 0;
  for (const actions of hands) {
    const inc = exploitHandIncrements(actions).get(regular);
    if (!inc) continue;
    counted++;
    observeExploitRow(rows, regular, inc, 1_000_000, true);
    long.lHands = long.lHands * LONG_DECAY + inc.hands;
    long.lVpip = long.lVpip * LONG_DECAY + inc.vpip;
    long.lPfr = long.lPfr * LONG_DECAY + inc.pfr;
  }
  const row = rows.get(regular) ?? freshExploitCounters();
  const counters = Object.fromEntries(
    EXPLOIT_COUNTER_FIELDS.map((f) => [f, row[f]])
  ) as unknown as ExploitCounters;
  return { counters, long, hands: counted };
}

/** One accepted hand the regular acted in, carrying his pooled exact row as the database returned it. */
function acceptedHand(
  n: number,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  actions: ExploitHandAction[],
  pooled: Pooled | null,
  format: Format = 'cash',
  variant: Variant = 'nlh',
  watcher = observer
): ObserveCompletedHandRequest {
  const number = 1000000 + n;
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${table}:${number}:${lease}:observe`,
    handKey: `${table}:${number}`,
    committedHandId: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    publicMemoryDomain: domain,
    actions: actions.map((a, i) => ({
      ...a,
      seat: a.userId === regular ? 2 : 3,
      timestamp: n * 10 + i,
    })),
    bigBlind: 2,
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [
        horseObserverReadContextFromRequest(request(watcher, dealt, domain, 0, format, variant))!,
      ],
    },
    durableOpponentProfiles: pooled
      ? [
          {
            public_memory_domain: domain,
            user_id: regular,
            variant,
            mode: modeOf(format),
            size: sizeOf(dealt),
            observed_hands: pooled.hands,
            initialized: true,
            counters: pooled.counters,
            long_counters: pooled.long,
          },
        ]
      : [],
  } as never;
}

/** A bank that has accepted the last of these hands with the regular's pooled row (nothing learned in-process). */
function pooledBank(
  hands: ExploitHandAction[][],
  dealt: number,
  domain: HorsePublicMemoryDomain,
  format: Format = 'cash',
  variant: Variant = 'nlh'
): HorseObserverReads {
  const bank = new HorseObserverReads(20, 20, () => 100);
  bank.complete(
    acceptedHand(
      hands.length,
      dealt,
      domain,
      hands[hands.length - 1]!,
      pooledAfter(hands),
      format,
      variant
    ),
    () => {}
  );
  return bank;
}

interface Read {
  evidence: string;
  participation: string;
  pfrSide: string | null;
  vpipHorse: number;
  label: string;
  standDown: boolean;
  releaseSource: string | null;
  tightOpener: ReturnType<typeof tightOpenerRespect>;
  longWindow: string[];
}
function summary(s: OpponentStyleRead): Read {
  return {
    evidence: s.evidence.state,
    participation: s.participation.side,
    pfrSide: s.signals.pfr.side,
    vpipHorse: s.signals.vpip.horse,
    label: s.label,
    standDown: s.release.standDown,
    releaseSource: s.release.source,
    tightOpener: tightOpenerRespect(s),
    longWindow: [...((s.receipt as { longWindow?: readonly string[] }).longWindow ?? [])],
  };
}
/** The style read of the regular inside the decision in flight (HorseMind.styleRead, as every consumer takes it). */
function readNow(dealt: number, format: Format, variant: Variant = 'nlh'): Read {
  HorseMind.setDecisionScope(scopeOf(dealt), variant, modeOf(format));
  const s = summary(HorseMind.styleRead(regular));
  HorseMind.setDecisionScope(null);
  return s;
}
/** The same read with the long window taken off the counters: what the 30-hand window alone supports. */
function shortOnly(dealt: number, format: Format, variant: Variant = 'nlh'): Read {
  const row = HorseMind.getExploitCounters(regular, scopeOf(dealt));
  const counters = row
    ? (Object.fromEntries(
        EXPLOIT_COUNTER_FIELDS.map((f) => [f, row[f]])
      ) as unknown as ExploitCounters)
    : undefined;
  return summary(
    classifyOpponentStyle({
      scope: scopeOf(dealt),
      variant,
      domain: modeOf(format),
      counters,
      provenance: { source: 'live', complete: true } as never,
    })
  );
}
/** Play hands in-process, as settlement observes them. */
function observe(
  from: number,
  count: number,
  dealt: number,
  hand: (n: number) => ExploitHandAction[]
) {
  for (let n = from; n < from + count; n++)
    HorseMind.observeHandComplete(`${table}:${n}`, hand(n) as never, 2, null, scopeOf(dealt));
}
/** Hand by hand, whether the in-process read calls the regular tight after each of `max` hands (index n = after n + 1). */
function tightTrajectory(dealt: number, vpip: number, pfr: number, max: number): boolean[] {
  const out: boolean[] = [];
  for (let n = 0; n < max; n++) {
    observe(n, 1, dealt, (k) => regularHand(k, vpip, pfr));
    out.push(readNow(dealt, 'cash').participation === 'tight');
  }
  return out;
}
/** The hand count from which the read stays tight to the end, or null. */
const stableFrom = (t: boolean[]) => (t[t.length - 1] ? t.lastIndexOf(false) + 2 : null);
const shareTight = (t: boolean[], from: number, to: number) =>
  t.slice(from, to).filter(Boolean).length / (to - from);

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  drainFires();
  HorseMind.reset();
});

const tight14 = (n: number) => regularHand(n, 0.14, 0.07);

describe('a. a 14% / 7% full-ring tournament regular is read as tight after 200 hands', () => {
  it('in-process (the real observe path): participation tight, PFR low, the tight-opener response engaged', () => {
    observe(0, 200, 9, tight14);
    const read = readNow(9, 'mtt');
    expect(read.evidence).toBe('supported_individual_read');
    expect(read.participation).toBe('tight');
    expect(read.pfrSide).toBe('low');
    expect(read.tightOpener).not.toBeNull();
    expect(read.longWindow).toEqual(expect.arrayContaining(['vpip', 'pfr']));
    // the 30-hand window alone cannot call him (the defect this repairs)
    const short = shortOnly(9, 'mtt');
    expect(short.participation).toBe('neutral');
    expect(short.tightOpener).toBeNull();
    // the receipt counts the read
    drainFires();
    readNow(9, 'mtt');
    const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fires.style_long_participation_seen ?? 0).toBeGreaterThan(0);
  });

  it('through the observer bank, learning its own hands (the worker path with no pooled row yet)', () => {
    const own = new HorseObserverReads(20, 20, () => 100);
    own.run(request(reader, 9, TABLE, 50, 'mtt'), () => undefined);
    for (let n = 0; n < 200; n++)
      own.complete(acceptedHand(n, 9, TABLE, tight14(n), null, 'mtt', 'nlh', reader), (r) =>
        HorseMind.observeHandComplete(r.handKey, r.actions, r.bigBlind, null, r.scope)
      );
    const read = own.run(request(reader, 9, TABLE, 1000, 'mtt'), () => readNow(9, 'mtt'));
    expect(read.participation).toBe('tight');
    expect(read.tightOpener).not.toBeNull();
  });

  it('on the pooled public path (observerReads): the accepted row carries the long window and the decision reads it', () => {
    const hands = Array.from({ length: 200 }, (_, n) => tight14(n));
    const bank = pooledBank(hands, 9, TABLE, 'mtt');
    const read = bank.run(request(reader, 9, TABLE, 1000, 'mtt'), () => readNow(9, 'mtt'));
    expect(read.participation).toBe('tight');
    expect(read.pfrSide).toBe('low');
    expect(read.tightOpener).not.toBeNull();
    expect(read.longWindow).toEqual(expect.arrayContaining(['vpip', 'pfr']));
  });

  it('the in-process learner keeps the long window by the database rule, field for field', () => {
    observe(0, 200, 9, tight14);
    const live = HorseMind.getExploitCounters(regular, 'holdem:full') as unknown as Record<
      string,
      number
    >;
    const db = pooledAfter(Array.from({ length: 200 }, (_, n) => tight14(n)));
    for (const f of EXPLOIT_COUNTER_FIELDS) expect(live[f], f).toBeCloseTo(db.counters[f], 9);
    expect(live.lHands).toBeCloseTo(db.long.lHands, 9);
    expect(live.lVpip).toBeCloseTo(db.long.lVpip, 9);
    expect(live.lPfr).toBeCloseTo(db.long.lPfr, 9);
  });
});

describe('b. controls', () => {
  it('a 21% / 14% regular (the Horse mean) stays neutral after 400 hands', () => {
    observe(0, 400, 9, (n) => regularHand(n, 0.21, 0.14));
    const read = readNow(9, 'cash');
    expect(read.participation).toBe('neutral');
    expect(read.tightOpener).toBeNull();
  });

  it('a switch to 40% / 30%: the tight response stops within a few hands and the fast window releases him', () => {
    observe(0, 200, 9, tight14);
    expect(readNow(9, 'mtt').tightOpener).not.toBeNull();
    let stopped: number | null = null;
    let standDown: number | null = null;
    for (let k = 0; k < 40; k++) {
      observe(200 + k, 1, 9, (n) => regularHand(n, 0.4, 0.3));
      const read = readNow(9, 'mtt');
      if (stopped === null && read.tightOpener === null) stopped = k + 1;
      if (standDown === null && read.standDown) {
        standDown = k + 1;
        expect(read.releaseSource).toMatch(/^fast_/);
      }
      // once stopped, never back while he plays loose
      if (stopped !== null) expect(read.tightOpener, String(k + 1)).toBeNull();
    }
    expect(stopped).not.toBeNull();
    expect(stopped!).toBeLessThanOrEqual(6);
    expect(standDown).not.toBeNull();
    expect(standDown!).toBeLessThanOrEqual(20);
  });

  it('a switch to 40% calling (PFR unchanged) ends the tight read through the 30-hand window', () => {
    observe(0, 200, 9, tight14);
    let ended: number | null = null;
    for (let k = 0; k < 60 && ended === null; k++) {
      observe(200 + k, 1, 9, (n) => regularHand(n, 0.4, 0.07));
      if (readNow(9, 'mtt').participation !== 'tight') ended = k + 1;
    }
    expect(ended).not.toBeNull();
    expect(ended!).toBeLessThanOrEqual(10);
  });

  it('fewer than 15 decayed hands stays unknown, long window or not', () => {
    observe(0, 14, 9, tight14);
    const read = readNow(9, 'mtt');
    expect(read.evidence).toBe('no_reliable_individual_evidence');
    expect(read.participation).toBe('neutral');
    expect(read.longWindow).toEqual([]);
    expect(read.tightOpener).toBeNull();
  });

  it('full ring cash: 14% holds tight from about 120 to 140 hands; 15% (at the 0.156 ceiling) mostly; 16% almost never', () => {
    // arithmetic at the exact rate: 14% is credible from 118 hands, 15% from 238; 16% never (ceiling 0.156)
    const t14 = tightTrajectory(9, 0.14, 0.07, 400);
    expect(t14.indexOf(true) + 1).toBeGreaterThanOrEqual(100);
    expect(stableFrom(t14)).not.toBeNull();
    expect(stableFrom(t14)!).toBeLessThanOrEqual(145);
    HorseMind.reset();
    const t15 = tightTrajectory(9, 0.15, 0.075, 600);
    expect(t15.indexOf(true) + 1).toBeGreaterThanOrEqual(100);
    expect(shareTight(t15, 240, 600)).toBeGreaterThanOrEqual(0.75);
    HorseMind.reset();
    const t16 = tightTrajectory(9, 0.16, 0.08, 800);
    expect(shareTight(t16, 240, 800)).toBeLessThanOrEqual(0.05);
  });

  it('short-handed: 26% / 15% is called (ceiling 0.279; the 30-hand window stops at 0.231); 30% never is', () => {
    const t = tightTrajectory(4, 0.26, 0.15, 400);
    expect(stableFrom(t)!).toBeLessThanOrEqual(200);
    const read = readNow(4, 'cash');
    expect(read.participation).toBe('tight');
    expect(read.tightOpener).not.toBeNull();
    expect(shortOnly(4, 'cash').participation).toBe('neutral');
    HorseMind.reset();
    observe(0, 1000, 4, (n) => regularHand(n, 0.3, 0.2));
    expect(readNow(4, 'cash').participation).toBe('neutral');
  });

  it('heads-up: 33% / 25% is called (ceiling 0.354; the 30-hand window stops at 0.302); 38% never is', () => {
    const t = tightTrajectory(2, 0.33, 0.25, 400);
    expect(stableFrom(t)!).toBeLessThanOrEqual(200);
    const read = readNow(2, 'cash');
    expect(read.participation).toBe('tight');
    expect(read.tightOpener).not.toBeNull();
    expect(shortOnly(2, 'cash').participation).toBe('neutral');
    HorseMind.reset();
    observe(0, 1000, 2, (n) => regularHand(n, 0.38, 0.3));
    expect(readNow(2, 'cash').participation).toBe('neutral');
  });

  it('a Lightning row is keyed by its public memory domain: read at Lightning, not at a table-speed game', () => {
    const hands = Array.from({ length: 200 }, (_, n) => tight14(n));
    const bank = pooledBank(hands, 9, LIGHTNING, 'cash');
    const atLightning = bank.run(request(reader, 9, LIGHTNING, 1000), () => readNow(9, 'cash'));
    expect(atLightning.participation).toBe('tight');
    expect(atLightning.tightOpener).not.toBeNull();
    const atTable = bank.run(request(reader, 9, TABLE, 1000), () => readNow(9, 'cash'));
    expect(atTable.evidence).toBe('no_reliable_individual_evidence');
    expect(atTable.tightOpener).toBeNull();
  });

  it("a fixed-limit hold'em row is read against the fixed-limit Horse mean, in its own variant", () => {
    const hands = Array.from({ length: 300 }, (_, n) => regularHand(n, 0.17, 0.08));
    const bank = pooledBank(hands, 9, TABLE, 'cash', 'flh');
    const flh = bank.run(request(reader, 9, TABLE, 1000, 'cash', 'flh'), () =>
      readNow(9, 'cash', 'flh')
    );
    // flh full ring: Horse VPIP 0.2516; tight callable at 0.150 (30 hands) and 0.192 (120 hands)
    expect(flh.vpipHorse).toBeCloseTo(0.2516, 4);
    expect(flh.participation).toBe('tight');
    expect(flh.longWindow).toEqual(expect.arrayContaining(['vpip']));
    // the no-limit game at the same table never sees the fixed-limit row
    const nlh = bank.run(request(reader, 9, TABLE, 1000, 'cash', 'nlh'), () => readNow(9, 'cash'));
    expect(nlh.evidence).toBe('no_reliable_individual_evidence');
  });
});

describe('c. forced and absent play is not read as tight', () => {
  const blindsAndTimeouts = (n: number, playEvery: number): ExploitHandAction[] =>
    n % playEvery === 0
      ? regularHand(n, 0.5, 0.25)
      : [
          { userId: regular, stage: 'preflop', action: 'big_blind', origin: 'forced', amount: 2 },
          { userId: horse, stage: 'preflop', action: 'raise', origin: 'horse_policy', amount: 6 },
          // the turn clock folds him: a forced action, never a learned fold
          { userId: regular, stage: 'preflop', action: 'fold', origin: 'forced', amount: 0 },
        ];

  it('a player who posts blinds and times out nine hands in ten: no tight read, before or after the long window', () => {
    observe(0, 300, 9, (n) => blindsAndTimeouts(n, 10));
    const read = readNow(9, 'cash');
    expect(read.participation).not.toBe('tight');
    expect(read.tightOpener).toBeNull();
    HorseMind.reset();
    observe(0, 300, 9, (n) => blindsAndTimeouts(n, 1_000_000));
    // he never acted: nothing is learned at all
    expect(readNow(9, 'cash').evidence).toBe('no_reliable_individual_evidence');
  });

  it('a 24% player who leaves mid-hand every tenth hand (a counted pre-action fold) is not read as tight', () => {
    observe(0, 400, 9, (n) =>
      n % 10 === 0
        ? [{ userId: regular, stage: 'preflop', action: 'fold', origin: 'pre_action', amount: 0 }]
        : regularHand(n, 0.24, 0.12)
    );
    const read = readNow(9, 'cash');
    expect(read.participation).toBe('neutral');
    expect(read.tightOpener).toBeNull();
  });

  it('a Lightning player whose only counted actions are timed-out checks reads the same side with or without the long window', () => {
    // Lightning stamps a timed-out check origin 'unknown' (an existing defect the long window does not fix): counted
    observe(0, 300, 9, () => [
      { userId: horse, stage: 'preflop', action: 'call', origin: 'horse_policy', amount: 2 },
      { userId: regular, stage: 'preflop', action: 'check', origin: 'unknown', amount: 0 },
    ]);
    expect(readNow(9, 'cash').participation).toBe(shortOnly(9, 'cash').participation);
  });
});

describe('d. the first look, the second look and an exact replay read the same tight opponent', () => {
  for (const path of ['pooled', 'in-process'] as const)
    it(`${path}: the read frame carries the long window (v15) and decodes to the same read and response`, () => {
      const next = request(reader, 9, TABLE, 1000, 'mtt');
      const players = next.gameState.players;
      const context = { variant: 'nlh', mode: 'tournament' as const, size: 'full' as const };
      let bank: HorseObserverReads;
      if (path === 'pooled')
        bank = pooledBank(
          Array.from({ length: 200 }, (_, n) => tight14(n)),
          9,
          TABLE,
          'mtt'
        );
      else {
        bank = new HorseObserverReads(20, 20, () => 100);
        bank.run(request(reader, 9, TABLE, 50, 'mtt'), () => undefined);
        for (let n = 0; n < 200; n++)
          bank.complete(acceptedHand(n, 9, TABLE, tight14(n), null, 'mtt', 'nlh', reader), (r) =>
            HorseMind.observeHandComplete(r.handKey, r.actions, r.bigBlind, null, r.scope)
          );
      }
      const first = bank.run(next, () => ({
        read: readNow(9, 'mtt'),
        frame: encodeHorseDecisionReads(
          HorseMind.snapshotDecisionReads(players, null, context),
          players,
          null
        ),
      }));
      expect(first.read.participation).toBe('tight');
      expect(first.read.tightOpener).not.toBeNull();
      expect(first.frame.version).toBe('horse-decision-reads-v15');
      // the fast look again, from the same bank, is the same
      expect(bank.run(next, () => readNow(9, 'mtt'))).toEqual(first.read);
      // another process (the deep worker, an offline replay) holds none of this one's rows
      HorseMind.reset();
      const again = () =>
        HorseMind.runInSandbox(decodeHorseDecisionReads(first.frame, players, null), () =>
          readNow(9, 'mtt')
        );
      expect(again()).toEqual(first.read);
      expect(again()).toEqual(first.read);
      // the frame survives its own round trip byte for byte
      const reencoded = HorseMind.runInSandbox(
        decodeHorseDecisionReads(first.frame, players, null),
        () =>
          encodeHorseDecisionReads(
            HorseMind.snapshotDecisionReads(players, null, context),
            players,
            null
          )
      );
      expect(reencoded).toEqual(first.frame);
    });
});
