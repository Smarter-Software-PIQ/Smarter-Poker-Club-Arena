/**
 * LAW (2026-11-14): THE PRE-REPAIR DISCOUNT REACHES THE DECISION, on the path live decisions actually take.
 *
 * The defect. A cash, table-speed opponent profile learned before the showdown-memory repair holds folds without the
 * calls, so its fold-to-bet (and the other showdown-dependent statistics) must stay out of a read until 60
 * post-release opportunities are in (HorseOpponentStyle.preRepairDiscount, switch styleFoldRatePreRepair). The keying
 * that decides "pre-repair" was recorded only by HorseMind.importDurableOpponentProfiles, which no production code
 * calls: a live decision reads its opponents from the pooled public profiles (HorseObserverReads.run), and those rows
 * carried counters and nothing else. So in production the discount never engaged and its receipt never fired, while
 * every test of it passed, because every test installed its profile through the import production does not use.
 *
 * This file drives the entry the decision worker drives (HorseObserverReads.complete for an accepted hand with its
 * pooled profile rows, then HorseObserverReads.run for the decision) and the boot input the worker really has
 * (HorseMind.importPostReleaseObservations, per row and domain). Nothing here calls importDurableOpponentProfiles.
 * Synthetic players only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseObserverReads } from './observerReads.js';
import { HorseMind } from '../HorseMind.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { postflopBluffMod } from '../HorseOpponentExploit.js';
import { preRepairDiscount, STYLE_THRESHOLDS } from '../HorseOpponentStyle.js';
import { counters } from '../HorseOpponentStyle.test-support.js';
import { clearStyleShadowEngaged, takeStyleShadowEngaged } from '../HorseStyleShadow.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from '../HorseDecisionReadFrame.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000001';
const lease = '50000000-0000-4000-8000-000000000001';
const observer = '20000000-0000-4000-8000-000000000001';
const reader = '20000000-0000-4000-8000-000000000002';
const otherReader = '20000000-0000-4000-8000-000000000003';
const folder = '30000000-0000-4000-8000-000000000001';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const LIGHTNING: HorsePublicMemoryDomain = { version: 1, speed: 'lightning', ante: 'none' };
const RECEIPT = 'style_pre_repair_fold_rate_discounted_seen';
type Format = 'cash' | 'mtt';
const modeOf = (format: Format) => (format === 'cash' ? 'cash' : 'tournament');
const sizeOf = (dealt: number) => (dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full');

function request(
  id: string,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  decisionTimeMs: number,
  format: Format = 'cash'
): FastHorseDecisionRequest {
  const seats = Array.from({ length: dealt }, (_, i) => i + 1);
  const others = [folder, ...seats.slice(2).map((s) => `40000000-0000-4000-8000-00000000000${s}`)];
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
      gameVariant: 'nlh',
      format,
      gameMode: modeOf(format),
      ...(format === 'cash' ? {} : { tournament: { contextStatus: 'complete' } }),
      publicMemoryDomain: domain,
      dealtSeatIds: seats,
      players: seats.map((seat) => ({ user_id: seat === 1 ? id : others[seat - 2]!, seat })),
    },
  } as never;
}

/** One accepted hand the folder acted in. With `profile`, the hand carries his pooled public row: 38 folds of 40
 * bets faced, the over-folder figure a pre-repair learner produced by counting folds without the calls. */
function hand(
  n: number,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  profile: boolean,
  format: Format = 'cash',
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
    actions: [
      { userId: folder, seat: 2, action: 'raise', amount: 8, stage: 'preflop', timestamp: n },
    ],
    bigBlind: 2,
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [horseObserverReadContextFromRequest(request(watcher, dealt, domain, 0, format))!],
    },
    durableOpponentProfiles: profile
      ? [
          {
            public_memory_domain: domain,
            user_id: folder,
            variant: 'nlh',
            mode: modeOf(format),
            size: sizeOf(dealt),
            observed_hands: 80,
            initialized: true,
            counters: counters({
              hands: 80,
              vpip: 0.2,
              pfr: 0.14,
              foldToBetOpp: 40,
              foldToBet: 38,
            }),
          },
        ]
      : [],
  } as never;
}

/** The boot input as the worker's boot supplies it: m of this row, for the domain the hands were played in. */
function bootPostRelease(m: number, size: 'short' | 'full' = 'full', domain = 'table:none'): void {
  HorseMind.importPostReleaseObservations([
    {
      user_id: folder,
      variant: 'nlh',
      mode: 'cash',
      size,
      domain,
      opportunities: { foldToBet: m, riverCall: m, foldTo3Bet: m, betCheckedTo: m },
    },
  ]);
}

type Arm = 'on' | 'off' | 'shadow';
interface Read {
  bluffMod: number;
  valueThinMod: number;
  callDownMod: number;
  rawBluff: number | null;
  receipt: number;
  shadow: number;
  style: {
    preRepair: string;
    discounted: readonly string[];
    complete: boolean | null;
    cap: number;
  };
  styleConfidenceCap: number;
}

/** What the brain reads of the folder inside the decision's own sandbox, with the switch on, off or in shadow. */
function readInDecision(arm: Arm, format: Format = 'cash', dealt = 6): Read {
  drainFires();
  clearStyleShadowEngaged();
  HorseMind.setDecisionScope(`holdem:${sizeOf(dealt)}` as never, 'nlh', modeOf(format));
  // HorseLogic carries the same switch with the scope for the style read (setDecisionReadOptions).
  HorseMind.setDecisionReadOptions(arm === 'on' ? ({ styleFoldRatePreRepair: true } as never) : {});
  const e = HorseMind.exploit(
    folder,
    true,
    arm === 'on'
      ? { styleFoldRatePreRepair: true }
      : arm === 'shadow'
        ? { styleFoldRatePreRepairShadow: true }
        : {}
  );
  const rawBluff = postflopBluffMod(HorseMind.opponentRead(folder));
  const style = HorseMind.styleRead(folder);
  const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const shadow = takeStyleShadowEngaged().filter((s) => s.option === 'styleFoldRatePreRepair');
  HorseMind.setDecisionScope(null);
  return {
    bluffMod: e.bluffMod,
    valueThinMod: e.valueThinMod,
    callDownMod: e.callDownMod,
    rawBluff,
    receipt: fires[RECEIPT] ?? 0,
    shadow: shadow.length,
    style: {
      preRepair: style.receipt.provenance.preRepair,
      discounted: [...style.receipt.provenance.discounted],
      complete: style.receipt.provenance.complete,
      cap: style.receipt.provenance.cap,
    },
    styleConfidenceCap: style.confidenceCap,
  };
}

/** A bank that has accepted one hand carrying the folder's pooled row of the given context. */
function bankWith(
  domain: HorsePublicMemoryDomain,
  format: Format = 'cash',
  dealt = 6
): HorseObserverReads {
  const bank = new HorseObserverReads(20, 20, () => 100);
  bank.complete(hand(1, dealt, domain, true, format), () => {});
  return bank;
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  drainFires();
  clearStyleShadowEngaged();
  HorseMind.reset();
});

describe('the pre-repair discount reaches the decision on the pooled public path', () => {
  it('1. a cash table-speed pooled row under 60 post-release opportunities: the over-folder increase is withheld and the receipt fires', () => {
    for (const m of [null, 30, 59]) {
      HorseMind.reset();
      if (m !== null) bootPostRelease(m);
      const bank = bankWith(TABLE);
      const on = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
      // the stored figure is there and would raise the bluff multiplier
      expect(on.rawBluff, String(m)).toBeGreaterThanOrEqual(1.2);
      // and the decision does not stand on it
      expect(on.bluffMod, String(m)).toBe(1);
      expect(on.valueThinMod, String(m)).toBe(1);
      expect(on.receipt, String(m)).toBeGreaterThan(0);
      // the style read itself classifies the row as affected and keeps the four statistics out
      expect(on.style.preRepair, String(m)).toBe('affected');
      expect(on.style.discounted, String(m)).toEqual([
        'foldToBet',
        'riverCall',
        'foldTo3Bet',
        'betCheckedTo',
      ]);
    }
  });

  it('2. option off: the same inputs give the read they gave before, with no receipt; shadow observes and applies nothing', () => {
    bootPostRelease(30);
    const bank = bankWith(TABLE);
    const off = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('off'));
    expect(off.rawBluff).toBeGreaterThanOrEqual(1.2);
    expect(off.bluffMod).toBe(off.rawBluff);
    expect(off.valueThinMod).toBeLessThan(1);
    expect(off.receipt).toBe(0);
    expect(off.shadow).toBe(0);
    // the style read is exactly what it was: no keying supplied to it
    expect(off.style).toEqual({
      preRepair: 'not_affected',
      discounted: [],
      complete: true,
      cap: 1,
    });
    const shadow = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('shadow'));
    expect({ ...shadow, shadow: 0 }).toEqual(off);
    expect(shadow.shadow).toBeGreaterThan(0);
  });

  it('3. not affected: a lightning cash row, a tournament row and a row this Horse learned itself are not discounted', () => {
    // lightning speed, cash
    const lightning = bankWith(LIGHTNING);
    const lOn = lightning.run(request(reader, 6, LIGHTNING, 1000), () => readInDecision('on'));
    const lOff = lightning.run(request(reader, 6, LIGHTNING, 1000), () => readInDecision('off'));
    expect(lOn.rawBluff).toBeGreaterThanOrEqual(1.2);
    expect(lOn).toEqual(lOff);
    expect(lOn.receipt).toBe(0);
    expect(lOn.style.preRepair).toBe('not_affected');
    // tournament, table speed
    const mtt = bankWith(TABLE, 'mtt');
    const tOn = mtt.run(request(reader, 6, TABLE, 1000, 'mtt'), () => readInDecision('on', 'mtt'));
    const tOff = mtt.run(request(reader, 6, TABLE, 1000, 'mtt'), () =>
      readInDecision('off', 'mtt')
    );
    expect(tOn.rawBluff).toBeGreaterThanOrEqual(1.2);
    expect(tOn).toEqual(tOff);
    expect(tOn.receipt).toBe(0);
    expect(tOn.style.preRepair).toBe('not_affected');
    // a row this Horse learned itself at a cash table-speed table (no pooled row): the repaired learner built it
    const own = new HorseObserverReads(20, 20, () => 100);
    own.run(request(reader, 6, TABLE, 50), () => undefined);
    for (let n = 2; n <= 9; n++)
      own.complete(hand(n, 6, TABLE, false, 'cash', reader), (r) =>
        HorseMind.observeHandComplete(r.handKey, r.actions, r.bigBlind, null, r.scope)
      );
    const learned = own.run(request(reader, 6, TABLE, 1000), () =>
      HorseMind.getExploitCounters(folder, 'holdem:full')
    );
    expect(learned?.hands).toBeGreaterThan(0);
    const oOn = own.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
    const oOff = own.run(request(reader, 6, TABLE, 1000), () => readInDecision('off'));
    expect(oOn).toEqual(oOff);
    expect(oOn.receipt).toBe(0);
    expect(oOn.style.preRepair).toBe('not_affected');
  });

  it('4. at 60 post-release opportunities the exclusion lifts, at the documented weight 1 - 0.5^(m/30)', () => {
    for (const m of [60, 120]) {
      HorseMind.reset();
      bootPostRelease(m);
      const bank = bankWith(TABLE);
      const on = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
      const off = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('off'));
      expect(on.bluffMod, String(m)).toBe(off.bluffMod);
      expect(on.valueThinMod, String(m)).toBe(off.valueThinMod);
      expect(on.receipt, String(m)).toBe(0);
      expect(on.style.preRepair, String(m)).toBe('affected');
      expect(on.style.discounted, String(m)).toEqual([]);
      // the provenance the decision's own state supplies, and the discount it gives
      const discount = bank.run(request(reader, 6, TABLE, 1000), () =>
        preRepairDiscount(
          (
            HorseMind as unknown as {
              styleProvenanceOf: (...a: unknown[]) => Parameters<typeof preRepairDiscount>[0];
            }
          ).styleProvenanceOf(folder, 'nlh', 'cash', 'full', true),
          'foldToBet'
        )
      );
      const bound = Math.pow(0.5, m / STYLE_THRESHOLDS.preRepairWeightHalfLife);
      expect(discount, String(m)).toEqual({
        applies: true,
        bound,
        weight: 1 - bound,
        excluded: false,
      });
    }
    // a count supplied for another domain never lifts the discount of a table-speed row
    HorseMind.reset();
    bootPostRelease(500, 'full', 'lightning:none');
    const bank = bankWith(TABLE);
    const on = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
    expect(on.bluffMod).toBe(1);
    expect(on.receipt).toBeGreaterThan(0);
  });

  it('5. completeness and the profile cap it selects are what they were, option on or off', () => {
    bootPostRelease(30);
    const bank = bankWith(TABLE);
    const on = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
    const off = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('off'));
    // Inside the decision's sandbox durable memory reads as off, so completeness is `true` and the cap is 1.
    expect([off.style.complete, off.style.cap]).toEqual([true, 1]);
    expect([on.style.complete, on.style.cap]).toEqual([true, 1]);
    expect(STYLE_THRESHOLDS.unqualifiedProfileCap).toBe(0.7);
    expect(STYLE_THRESHOLDS.incompleteProfileCap).toBe(0.4);
  });

  it('a pre-repair donor row is weighed like the exact row: a full-ring read that borrows the short-handed row is discounted', () => {
    const bank = bankWith(TABLE, 'cash', 3);
    const on = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('on'));
    const off = bank.run(request(reader, 6, TABLE, 1000), () => readInDecision('off'));
    expect(off.rawBluff).toBeGreaterThanOrEqual(1.2);
    expect(off.bluffMod).toBe(off.rawBluff);
    expect(off.receipt).toBe(0);
    expect(on.bluffMod).toBe(1);
    expect(on.receipt).toBeGreaterThan(0);
    expect(on.style.preRepair).toBe('affected');
  });

  it('6. the second look and an exact replay read what the first look read: the read frame carries the provenance', () => {
    bootPostRelease(30);
    const bank = bankWith(TABLE);
    const next = request(reader, 6, TABLE, 1000);
    const players = next.gameState.players;
    const context = { variant: 'nlh', mode: 'cash' as const, size: 'full' as const };
    const first = bank.run(next, () => ({
      read: readInDecision('on'),
      off: readInDecision('off'),
      // the frame the worker journals and the second look decodes (workerRuntime captureOriginalReadFrame)
      frame: encodeHorseDecisionReads(
        HorseMind.snapshotDecisionReads(players, null, context),
        players,
        null
      ),
    }));
    expect(first.read.receipt).toBeGreaterThan(0);
    expect(first.frame.version).toBe('horse-decision-reads-v14');
    // Another process (the deep worker, an offline replay) holds none of this one's boot input or pooled rows.
    HorseMind.reset();
    const again = () =>
      HorseMind.runInSandbox(decodeHorseDecisionReads(first.frame, players, null), () => ({
        read: readInDecision('on'),
        off: readInDecision('off'),
      }));
    const second = again();
    expect(second.read).toEqual(first.read);
    expect(second.off).toEqual(first.off);
    expect(again()).toEqual(second);
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
    // Everything else in the frame decodes to what it decodes to without the provenance (the state a decision had
    // before 2026-11-14), so a look with the option off reads the same view either way.
    const without = bank.run(next, () => {
      const view = HorseMind.snapshotDecisionReads(players, null, context);
      delete view.pooledProvenance;
      return encodeHorseDecisionReads(view, players, null);
    });
    expect(without.version).not.toBe('horse-decision-reads-v14');
    const carried = decodeHorseDecisionReads(first.frame, players, null);
    expect(carried.pooledProvenance?.size).toBe(1);
    delete carried.pooledProvenance;
    expect(carried).toEqual(decodeHorseDecisionReads(without, players, null));
    // A decision with no pre-repair keyed row keeps the frame version it had: nothing is added to it.
    const lightning = bankWith(LIGHTNING);
    const lNext = request(reader, 6, LIGHTNING, 1000);
    const lFrame = lightning.run(lNext, () =>
      encodeHorseDecisionReads(
        HorseMind.snapshotDecisionReads(lNext.gameState.players, null, context),
        lNext.gameState.players,
        null
      )
    );
    expect(lFrame.version).not.toBe('horse-decision-reads-v14');
    expect(lFrame.json).not.toContain('pooledProvenance');
  });

  it("7. two interleaved decisions with different pooled rows never see each other's provenance", () => {
    bootPostRelease(30);
    const bank = new HorseObserverReads(20, 20, () => 100);
    // the same player holds a table-speed row and a lightning row; two Horses decide against him at once
    bank.complete(hand(1, 6, TABLE, true), () => {});
    bank.complete(hand(2, 6, LIGHTNING, true), () => {});
    const atTable = request(reader, 6, TABLE, 1000);
    const atLightning = request(otherReader, 6, LIGHTNING, 1000);
    const processWide = () =>
      (HorseMind as unknown as { pooledProvenance: unknown }).pooledProvenance ?? null;
    // both reads are assembled before either decides (the fast look of one, then the other)
    const a1 = bank.run(atTable, () => readInDecision('on'));
    expect(processWide()).toBeNull();
    const b1 = bank.run(atLightning, () => readInDecision('on'));
    expect(processWide()).toBeNull();
    // then each is resumed against the state issued to it, in the other order
    const b2 = bank.runIssued(atLightning, () => readInDecision('on'));
    const a2 = bank.runIssued(atTable, () => readInDecision('on'));
    const b3 = bank.run(atLightning, () => readInDecision('on'));
    const a3 = bank.run(atTable, () => readInDecision('on'));
    for (const a of [a1, a2, a3]) {
      expect(a.bluffMod).toBe(1);
      expect(a.receipt).toBeGreaterThan(0);
      expect(a.style.preRepair).toBe('affected');
    }
    for (const b of [b1, b2, b3]) {
      expect(b.bluffMod).toBe(b.rawBluff);
      expect(b.bluffMod).toBeGreaterThanOrEqual(1.2);
      expect(b.receipt).toBe(0);
      expect(b.style.preRepair).toBe('not_affected');
    }
    expect(processWide()).toBeNull();
  });
});
