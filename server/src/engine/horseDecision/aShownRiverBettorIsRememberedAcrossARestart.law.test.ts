/**
 * LAW (2026-11-15): A SHOWN RIVER BETTOR IS REMEMBERED ACROSS A RESTART, on the path live decisions take.
 *
 * The defect. The style read's shown river strength (river first bets by size, shown, shown strong) lived only in
 * engine memory, rebuilt at boot from 72 hours of hand history. A player who bets the river for value a few times a
 * week came back unknown after every restart: one shown river bet in the window against thirteen in fourteen days
 * (RIVER-MEMORY-HORIZON-20261114), and the read needs 3 shown before it speaks.
 *
 * The fix. The accepted-hand database learner keeps a durable record beside the exact profile
 * (horse_exact_profiles.shown_river, migration 20261115144258, a half-life of 40 shown bets, forward only). The record
 * arrives on the pooled public row (worker boot and every accepted hand), and behind styleLongShownMemory the decision
 * carries its read (HorseMindSandbox.pooledShownRiver, read frame v16) to the style read, which takes per size bucket
 * the record's cell when it holds more shown bets than the in-process 72-hour bucket, never the sum.
 *
 * This file drives the entries the decision worker drives: HorseObserverReads.bootstrapPublicProfiles (the worker's
 * boot read after a restart), HorseObserverReads.complete (an accepted hand with its pooled row) and
 * HorseObserverReads.run (the decision). The in-process window is what the boot rebuild leaves
 * (HorseMind.importSizeBuckets). Nothing calls importDurableOpponentProfiles. Synthetic players only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind } from '../HorseMind.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { bluffCatchEquityCap } from '../HorseOpponentStyle.js';
import { counters } from '../HorseOpponentStyle.test-support.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import {
  SHOWN_RIVER_WINDOW_MS,
  addShownRiverEvidence,
  type ShownRiverIncrement,
  type ShownRiverRecord,
} from '../HorseLongShownMemory.js';
import type { DurableOpponentProfile } from '../HorseOpponentMemory.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000071';
const lease = '50000000-0000-4000-8000-000000000071';
const watcher = '20000000-0000-4000-8000-000000000071';
const reader = '20000000-0000-4000-8000-000000000072';
const bettor = '30000000-0000-4000-8000-000000000071';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const DAY = 24 * 3600 * 1000;
/** The decision's own time. */
const NOW = Date.UTC(2026, 10, 15, 14, 0, 0);
const SEEN = 'style_long_shown_memory_seen';
const OLDER = 'style_long_shown_memory_older_seen';
type Format = 'cash' | 'mtt';
const modeOf = (format: Format) => (format === 'cash' ? 'cash' : 'tournament');
const LARGE_STRONG: ShownRiverIncrement = { b: 'large', shown: 1, strong: 1 };

/** A value-only river bettor's record as the database learner writes it: n large first river bets, every one called,
 *  shown and strong, the first accepted at `since`. */
function valueRecord(n: number, since: number): ShownRiverRecord {
  let r: ShownRiverRecord | null = null;
  for (let i = 0; i < n; i++) r = addShownRiverEvidence(r, LARGE_STRONG, since + i * 3600_000);
  return r!;
}

function request(
  decisionTimeMs: number,
  on: boolean,
  format: Format = 'cash',
  id = reader
): FastHorseDecisionRequest {
  const seats = [1, 2, 3, 4, 5, 6];
  const others = [bettor, ...seats.slice(2).map((s) => `40000000-0000-4000-8000-00000000007${s}`)];
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:2000001:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    ...(on ? { opts: { styleLongShownMemory: true } } : {}),
    gameState: {
      gameVariant: 'nlh',
      format,
      gameMode: modeOf(format),
      ...(format === 'cash' ? {} : { tournament: { contextStatus: 'complete' } }),
      publicMemoryDomain: TABLE,
      dealtSeatIds: seats,
      players: seats.map((seat) => ({ user_id: seat === 1 ? id : others[seat - 2]!, seat })),
    },
  } as never;
}

/** The bettor's exact pooled row: 80 hands of an ordinary player, and (when given) his durable shown river record. */
function row(
  shown: ShownRiverRecord | null | undefined | Record<string, unknown>,
  format: Format = 'cash',
  observed = 80
): DurableOpponentProfile {
  return {
    public_memory_domain: TABLE,
    user_id: bettor,
    variant: 'nlh',
    mode: modeOf(format),
    size: 'full',
    observed_hands: observed,
    initialized: true,
    counters: counters({ hands: 80, vpip: 0.2, pfr: 0.12, betCheckedToOpp: 20, betCheckedTo: 8 }),
    ...(shown === undefined ? {} : { shown_river: shown as ShownRiverRecord | null }),
  };
}

/** An accepted hand the bettor acted in, carrying his refreshed pooled row. */
function hand(
  n: number,
  profile: DurableOpponentProfile,
  format: Format = 'cash'
): ObserveCompletedHandRequest {
  const number = 1000000 + n;
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${table}:${number}:${lease}:observe`,
    handKey: `${table}:${number}`,
    committedHandId: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    publicMemoryDomain: TABLE,
    actions: [
      {
        userId: bettor,
        seat: 2,
        action: 'raise',
        origin: 'player',
        amount: 8,
        stage: 'preflop',
        timestamp: n,
      },
    ],
    bigBlind: 2,
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [horseObserverReadContextFromRequest(request(0, false, format, watcher))!],
    },
    durableOpponentProfiles: [profile],
  } as never;
}

/** A restarted worker's bank: its boot read of the pooled rows, available at `at`. */
function bootedBank(
  profiles: DurableOpponentProfile[],
  at = NOW - DAY,
  clock = () => at
): HorseObserverReads {
  const bank = new HorseObserverReads(20, 20, clock);
  expect(bank.bootstrapPublicProfiles({ availableAtMs: at, profiles })).toBe(true);
  return bank;
}

/** What the restarted boot rebuild left in process memory: the one shown river bet of the last 72 hours. */
function bootWindow(
  buckets: Record<string, { bets: number; shown: number; strong: number }>,
  format: Format = 'cash'
): void {
  HorseMind.importSizeBuckets([
    { user_id: bettor, variant: 'nlh', mode: modeOf(format), size: 'full', buckets },
  ]);
}

interface Read {
  large: { bets: number; shown: number; strong: number; side: string | null };
  medium: { bets: number; shown: number; strong: number };
  shown: number;
  shownSide: string | null;
  cap: number | null;
  seen: number;
  older: number;
  style: string;
  frame: { version: string; sha256: string };
}

/** The style read the brain takes of the bettor inside the decision's own sandbox, with the option on or off. */
function readInDecision(on: boolean, format: Format = 'cash'): Read {
  drainFires();
  HorseMind.setDecisionScope('holdem:full' as never, 'nlh', modeOf(format));
  HorseMind.setDecisionReadOptions(on ? ({ styleLongShownMemory: true } as never) : {});
  const style = HorseMind.styleRead(bettor);
  const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const players = [{ user_id: reader }, { user_id: bettor }];
  const frame = encodeHorseDecisionReads(
    HorseMind.snapshotDecisionReads(players as never, null, {
      variant: 'nlh',
      mode: modeOf(format),
      size: 'full',
    }),
    players as never,
    null
  );
  HorseMind.setDecisionScope(null);
  const l = style.signals.shownBySize.large;
  const m = style.signals.shownBySize.medium;
  return {
    large: { bets: l.bets, shown: l.shown, strong: l.strong, side: l.side },
    medium: { bets: m.bets, shown: m.shown, strong: m.strong },
    shown: style.signals.shownStrength.shown,
    shownSide: style.signals.shownStrength.side,
    cap: bluffCatchEquityCap(style, { potFraction: 0.75 }),
    seen: fires[SEEN] ?? 0,
    older: fires[OLDER] ?? 0,
    style: JSON.stringify(style),
    frame: { version: frame.version, sha256: frame.sha256 },
  };
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  drainFires();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a shown river bettor is remembered across a restart', () => {
  it('1. thirteen shown value bets older than 72 hours, one inside: remembered with the option on, not with it off', () => {
    bootWindow({ large: { bets: 1, shown: 1, strong: 1 } });
    const bank = bootedBank([row(valueRecord(13, NOW - 14 * DAY))]);
    const on = bank.run(request(NOW, true), () => readInDecision(true));
    const off = bank.run(request(NOW, false), () => readInDecision(false));
    // off: the restarted 72-hour window alone, one shown bet, below the 3 the read needs: no cap, no receipt
    expect(off.large).toMatchObject({ bets: 1, shown: 1, strong: 1, side: null });
    expect(off.cap).toBeNull();
    expect(off.seen + off.older).toBe(0);
    // on: the record's thirteen (decayed) shown strong bets: value, and the bluff-catch cap engages
    expect(on.large.shown).toBeGreaterThan(11);
    expect(on.large.strong).toBe(on.large.shown);
    expect(on.large.side).toBe('value');
    expect(on.shownSide).toBe('value');
    expect(on.cap).not.toBeNull();
    expect(on.cap!).toBeLessThan(1);
    expect(on.seen).toBe(1);
    expect(on.older).toBe(1);
    expect(on.frame.version).toBe('horse-decision-reads-v16');
    expect(off.frame.version).not.toBe('horse-decision-reads-v16');
  });

  it('2. option off: the read, the frame and the boot state are byte-identical to a row with no record on file', () => {
    bootWindow({ large: { bets: 3, shown: 2, strong: 1 } });
    const withRecord = bootedBank([row(valueRecord(13, NOW - 14 * DAY))]);
    const a = withRecord.run(request(NOW, false), () => readInDecision(false));
    HorseMind.reset();
    bootWindow({ large: { bets: 3, shown: 2, strong: 1 } });
    const without = bootedBank([row(undefined)]);
    const b = without.run(request(NOW, false), () => readInDecision(false));
    expect(a).toEqual(b);
    // the option in the request but not in the read (or the reverse) changes nothing either: both are needed
    HorseMind.reset();
    bootWindow({ large: { bets: 3, shown: 2, strong: 1 } });
    const carriedOnly = withRecord.run(request(NOW, true), () => readInDecision(false));
    expect({ ...carriedOnly, frame: b.frame }).toEqual(b);
    const readOnly = withRecord.run(request(NOW, false), () => readInDecision(true));
    expect(readOnly).toEqual(b);
  });

  it('3. evidence inside 72 hours only: the read may take it (a superset the window lost) but the older receipt stays silent', () => {
    // the window lost the hands (a restart before they were 72 hours old is the same as no window at all here)
    const bank = bootedBank([row(valueRecord(4, NOW - 2 * DAY))]);
    const on = bank.run(request(NOW, true), () => readInDecision(true));
    expect(on.large.shown).toBeGreaterThan(3.5);
    expect(on.seen).toBe(1);
    expect(on.older).toBe(0);
  });

  it('4. dedupe: the window and the record are never added; per bucket the one with more shown bets', () => {
    // record: 4 shown large then 4 shown medium; window: 5 shown large (more), 1 shown medium (fewer)
    let r: ShownRiverRecord | null = null;
    for (let i = 0; i < 4; i++) r = addShownRiverEvidence(r, LARGE_STRONG, NOW - 10 * DAY + i);
    for (let i = 0; i < 4; i++)
      r = addShownRiverEvidence(r, { b: 'medium', shown: 1, strong: 1 }, NOW - 9 * DAY + i);
    bootWindow({
      large: { bets: 6, shown: 5, strong: 5 },
      medium: { bets: 1, shown: 1, strong: 0 },
    });
    const bank = bootedBank([row(r)]);
    const on = bank.run(request(NOW, true), () => readInDecision(true));
    expect(on.large).toMatchObject({ bets: 6, shown: 5, strong: 5 });
    expect(on.medium).toEqual(r!.buckets.medium);
    expect(on.medium.shown).toBeLessThan(4);
    // the in-format shown total is the sum over buckets of the chosen cells, not window + record
    expect(on.shown).toBeCloseTo(5 + r!.buckets.medium!.shown, 12);
    expect(on.seen).toBe(1);
    // a window that holds more in every bucket: exactly the off read, and no receipt
    HorseMind.reset();
    bootWindow({
      large: { bets: 9, shown: 9, strong: 9 },
      medium: { bets: 9, shown: 9, strong: 0 },
    });
    const strong = bootedBank([row(r)]);
    const on2 = strong.run(request(NOW, true), () => readInDecision(true));
    const off2 = strong.run(request(NOW, false), () => readInDecision(false));
    expect({ ...on2, frame: off2.frame }).toEqual(off2);
    expect(on2.seen).toBe(0);
  });

  it('5. availability: a decision reads only the record accepted before its own time', () => {
    let clock = NOW - DAY;
    const bank = bootedBank([row(valueRecord(2, NOW - 20 * DAY))], NOW - DAY, () => clock);
    const T = NOW - DAY / 2;
    // before the refresh, a decision at T - 1 reads the boot record
    const first = bank.run(request(T - 1, true), () => readInDecision(true));
    expect(first.large.shown).toBeCloseTo(valueRecord(2, 0).buckets.large!.shown, 12);
    // an accepted hand at T refreshes his row with six more shown bets
    clock = T;
    bank.complete(hand(1, row(valueRecord(8, NOW - 20 * DAY), 'cash', 81)), () => {});
    const after = bank.run(request(T, true), () => readInDecision(true));
    expect(after.large.shown).toBeCloseTo(valueRecord(8, 0).buckets.large!.shown, 12);
    // a decision fenced at T - 1 never reads the record accepted at T (nor is it relabelled with the decision clock)
    const queued = bank.run(request(T - 1, true), () => readInDecision(true));
    expect(queued.large.shown).toBe(0);
    expect(queued.seen).toBe(0);
    // a decision fenced before the boot read was available reads no record at all: the off read
    const early = bank.run(request(NOW - DAY - 1, true), () => readInDecision(true));
    const earlyOff = bank.run(request(NOW - DAY - 1, false), () => readInDecision(false));
    expect({ ...early, frame: earlyOff.frame }).toEqual(earlyOff);
    expect(early.seen).toBe(0);
  });

  it('6. cash and tournament stay apart', () => {
    const bank = bootedBank([row(valueRecord(13, NOW - 14 * DAY), 'mtt'), row(null, 'cash')]);
    const cashOn = bank.run(request(NOW, true), () => readInDecision(true));
    const cashOff = bank.run(request(NOW, false), () => readInDecision(false));
    expect({ ...cashOn, frame: cashOff.frame }).toEqual(cashOff);
    expect(cashOn.seen).toBe(0);
    const mttOn = bank.run(request(NOW, true, 'mtt'), () => readInDecision(true, 'mtt'));
    expect(mttOn.large.shown).toBeGreaterThan(11);
    expect(mttOn.seen).toBe(1);
    // and a tournament window never reaches a cash record or the reverse
    HorseMind.reset();
    bootWindow({ large: { bets: 30, shown: 30, strong: 0 } }, 'mtt');
    const bank2 = bootedBank([row(valueRecord(13, NOW - 14 * DAY), 'cash')]);
    const cash2 = bank2.run(request(NOW, true), () => readInDecision(true));
    expect(cash2.large.shown).toBeGreaterThan(11);
    expect(cash2.large.strong).toBe(cash2.large.shown);
  });

  it('7. the second look and an exact replay read what the first look read (read frame v16)', () => {
    bootWindow({ large: { bets: 1, shown: 1, strong: 1 } });
    const bank = bootedBank([row(valueRecord(13, NOW - 14 * DAY))]);
    const players = [{ user_id: reader }, { user_id: bettor }];
    const first = bank.run(request(NOW, true), () => {
      const read = readInDecision(true);
      HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
      const view = HorseMind.snapshotDecisionReads(players as never, null, {
        variant: 'nlh',
        mode: 'cash',
        size: 'full',
      });
      HorseMind.setDecisionScope(null);
      return { read, frame: encodeHorseDecisionReads(view, players as never, null) };
    });
    expect(first.frame.version).toBe('horse-decision-reads-v16');
    expect(first.frame.json).toContain('"shownRiver"');
    // a process that holds none of this one's rows or buckets
    HorseMind.reset();
    const decoded = decodeHorseDecisionReads(first.frame, players as never, null);
    const again = HorseMind.runInSandbox(decoded, () => readInDecision(true));
    // the replaying process has no 72-hour window: the record alone, which is what the first look took
    expect(again.large).toEqual(first.read.large);
    expect(again.cap).toBe(first.read.cap);
    expect(again.frame).toEqual(first.read.frame);
  });

  it('8. a malformed record is dropped, not trusted, and the row still reads', () => {
    bootWindow({ large: { bets: 1, shown: 1, strong: 1 } });
    const junk = { since: NOW - 14 * DAY, buckets: { large: { bets: 1, shown: 30, strong: 30 } } };
    const bank = bootedBank([row(junk)]);
    const on = bank.run(request(NOW, true), () => readInDecision(true));
    const off = bank.run(request(NOW, false), () => readInDecision(false));
    expect({ ...on, frame: off.frame }).toEqual(off);
    expect(on.seen).toBe(0);
    expect(off.style).toContain('"label"');
  });

  it('9. the record window the receipt names is the boot rebuild horizon', () => {
    expect(SHOWN_RIVER_WINDOW_MS).toBe(72 * 3600 * 1000);
  });
});
