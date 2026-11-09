/**
 * LAW (HB-CAP-125/126, 2026-11-08): A KNOWN MANIAC IS A MANIAC AT EVERY TABLE
 * SIZE, on the path live decisions actually take. Since #8075 every FAST
 * decision reads opponents through the observer sandbox and the pooled public
 * profiles, which carried only the exact table-size row: on release 391f7bc0
 * 1,104,922 pooled reads left opponent_memory_donor_* and
 * opponent_exploit_corroborated at 0. The pooled read now also carries the
 * sibling table-size row of the same game, mode and original speed/ante
 * domain (never another domain's), weighed by the hands the player has played
 * since that row was last refreshed (Item 12), and each borrow leaves its
 * receipt. The exact evidence a donor is blended with is the pooled exact row
 * alone: the horse's own family-and-size row proves no variant, mode or
 * domain and is never blended with a donor. A donor that cannot be dated is
 * not borrowed and is receipted as unknown, never as fresh.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { HorseObserverReads } from './observerReads.js';
import { PooledPublicProfiles } from './pooledPublicProfiles.js';
import { HorseMind } from '../HorseMind.js';
import { horseObserverReadsUsedPublicPool } from '../HorseObserverReadEvidence.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import { freshExploitCounters } from '../HorseOpponentExploit.js';
import { OPPONENT_MEMORY_THIN_HANDS, opponentMemoryKey } from '../HorseOpponentMemory.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import type { HorsePublicMemoryDomain } from '../HorsePublicMemoryDomain.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

const table = '10000000-0000-4000-8000-000000000001';
const lease = '50000000-0000-4000-8000-000000000001';
const observer = '20000000-0000-4000-8000-000000000001';
const reader = '20000000-0000-4000-8000-000000000002';
const maniac = '30000000-0000-4000-8000-000000000001';
const TABLE: HorsePublicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
const LIGHTNING: HorsePublicMemoryDomain = { version: 1, speed: 'lightning', ante: 'none' };

function request(
  id: string,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  decisionTimeMs: number,
  hand = 2000001
): FastHorseDecisionRequest {
  const seats = Array.from({ length: dealt }, (_, i) => i + 1);
  const others = [maniac, ...seats.slice(2).map((s) => `40000000-0000-4000-8000-00000000000${s}`)];
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:${hand}:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    gameState: {
      gameVariant: 'nlh',
      format: 'cash',
      gameMode: 'cash',
      publicMemoryDomain: domain,
      dealtSeatIds: seats,
      players: seats.map((seat) => ({ user_id: seat === 1 ? id : others[seat - 2]!, seat })),
    },
  } as never;
}

/** One accepted hand the maniac raised in, dealt `dealt` handed in `domain`. */
function hand(
  n: number,
  dealt: number,
  domain: HorsePublicMemoryDomain,
  profile: boolean,
  observedHands = 60,
  watcher = observer
): ObserveCompletedHandRequest {
  const number = 1000000 + n;
  const size = dealt <= 2 ? 'hu' : dealt <= 5 ? 'short' : 'full';
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${table}:${number}:${lease}:observe`,
    handKey: `${table}:${number}`,
    committedHandId: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    publicMemoryDomain: domain,
    actions: [
      { userId: maniac, seat: 2, action: 'raise', amount: 8, stage: 'preflop', timestamp: n },
    ],
    bigBlind: 2,
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [horseObserverReadContextFromRequest(request(watcher, dealt, domain, 0))!],
    },
    durableOpponentProfiles: profile
      ? [
          {
            public_memory_domain: domain,
            user_id: maniac,
            variant: 'nlh',
            mode: 'cash',
            size,
            observed_hands: observedHands,
            initialized: true,
            counters: {
              ...freshExploitCounters(),
              hands: 30,
              vpip: 29,
              pfr: 29,
              rfiOpp: 30,
              rfi: 29,
            },
          },
        ]
      : [],
  } as never;
}

function shortHandedRead(bank: HorseObserverReads, domain: HorsePublicMemoryDomain, at: number) {
  drainFires();
  const next = request(reader, 3, domain, at);
  const pfr = bank.run(next, () => {
    HorseMind.setDecisionScope('holdem:short', 'nlh', 'cash');
    return HorseMind.opponentRead(maniac)?.stats.pfr;
  });
  return { pfr, fires: new Map(drainFires().map((r) => [r.feature, r.fires])) };
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  drainFires();
  HorseMind.reset();
});

describe('a thin opponent row borrows its sibling table size on the pooled public path', () => {
  it('a full-ring maniac is read as a maniac short-handed, fresh, then stale on his own clock', () => {
    let now = 100;
    const bank = new HorseObserverReads(20, 20, () => now);
    bank.complete(hand(1, 6, TABLE, true), () => {});
    const fresh = shortHandedRead(bank, TABLE, 1000);
    expect(fresh.pfr).toBeDefined();
    expect(fresh.fires.get('opponent_memory_donor_fresh')).toBe(1);
    // Twenty more accepted short-handed hands that refresh nothing.
    for (let n = 2; n <= 21; n++) {
      now = 100 + n;
      bank.complete(hand(n, 3, TABLE, false), () => {});
    }
    const stale = shortHandedRead(bank, TABLE, 1000);
    expect(stale.fires.get('opponent_memory_donor_stale')).toBe(1);
    expect(stale.fires.get('opponent_memory_donor_fresh')).toBeUndefined();
    // A refreshed (newer) full-ring row is fresh again.
    now = 200;
    bank.complete(hand(22, 6, TABLE, true, 61), () => {});
    expect(shortHandedRead(bank, TABLE, 1000).fires.get('opponent_memory_donor_fresh')).toBe(1);
  });

  it('a donor never crosses the speed/ante domain', () => {
    const bank = new HorseObserverReads(20, 20, () => 100);
    bank.complete(hand(1, 6, LIGHTNING, true), () => {});
    const read = shortHandedRead(bank, TABLE, 1000);
    expect(read.pfr).toBeUndefined();
    for (const k of ['fresh', 'stale', 'expired'])
      expect(read.fires.get(`opponent_memory_donor_${k}`)).toBeUndefined();
  });

  it('staleness is the hands the player played since the donor row was refreshed, at the cutoff', () => {
    let now = 100;
    const pool = new PooledPublicProfiles(() => now);
    pool.observe(hand(1, 6, TABLE, true));
    for (let n = 2; n <= 6; n++) {
      now = 100 + n * 10;
      pool.observe(hand(n, 3, TABLE, false));
    }
    expect(pool.read(request(reader, 3, TABLE, 1000))?.donors[0]?.staleness).toBe(5);
    // An older queued snapshot reads the clock as it stood at its own cutoff.
    expect(pool.read(request(reader, 3, TABLE, 135))?.donors[0]?.staleness).toBe(2);
    // Heads-up has no sibling size; a full-ring read borrows short-handed.
    expect(pool.read(request(reader, 2, TABLE, 1000))).toBeNull();
  });

  it("the exact evidence blended with a donor is domain-exact: the horse's own family row is never it", () => {
    // The horse's own row is keyed by card family and table size alone, so
    // nothing proves its variant, mode or speed/ante domain. With no pooled
    // exact row it answers alone, exactly as it did before donors reached
    // this path, and no donor is consulted or receipted.
    const read = (withDonor: boolean) => {
      HorseMind.reset();
      const bank = new HorseObserverReads(20, 20, () => 100);
      if (withDonor) bank.complete(hand(1, 6, TABLE, true), () => {});
      bank.run(request(reader, 3, TABLE, 50), () => undefined);
      // Eight hands this horse watched itself: an individual row, still thin.
      for (let n = 2; n <= 9; n++)
        bank.complete(hand(n, 3, TABLE, false, 60, reader), (r) =>
          HorseMind.observeHandComplete(r.handKey, r.actions, r.bigBlind, null, r.scope)
        );
      const own = bank.run(request(reader, 3, TABLE, 1000), () =>
        HorseMind.getExploitCounters(maniac, 'holdem:short')
      );
      drainFires();
      const opponent = bank.run(request(reader, 3, TABLE, 1000), () => {
        HorseMind.setDecisionScope('holdem:short', 'nlh', 'cash');
        return HorseMind.opponentRead(maniac);
      });
      const fires = new Map(drainFires().map((r) => [r.feature, r.fires]));
      return { own, opponent, fires };
    };
    const alone = read(false);
    const withDonor = read(true);
    expect(alone.own?.hands).toBeGreaterThan(0);
    expect(alone.own!.hands).toBeLessThan(OPPONENT_MEMORY_THIN_HANDS);
    expect(withDonor.own).toEqual(alone.own);
    expect(withDonor.opponent).toEqual(alone.opponent);
    for (const k of ['fresh', 'stale', 'expired', 'staleness_unknown'])
      expect(withDonor.fires.get(`opponent_memory_donor_${k}`)).toBeUndefined();
  });

  it('a pooled donor whose staleness could not be told is never read as fresh', () => {
    const donorKey = opponentMemoryKey(maniac, 'nlh', 'cash', 'full');
    const read = (staleness: Map<string, number>) => {
      const sandbox = HorseMind.createSandbox();
      sandbox.exploit = new Map([
        [
          donorKey,
          { ...freshExploitCounters(), hands: 30, vpip: 29, pfr: 29, rfiOpp: 30, rfi: 29 },
        ],
      ]);
      sandbox.donorStaleness = staleness;
      drainFires();
      const pfr = HorseMind.runInSandbox(sandbox, () => {
        HorseMind.setDecisionScope('holdem:short', 'nlh', 'cash');
        return HorseMind.opponentRead(maniac)?.stats.pfr;
      });
      return { pfr, fires: new Map(drainFires().map((r) => [r.feature, r.fires])) };
    };
    const dated = read(new Map([[donorKey, 0]]));
    expect(dated.pfr).toBeDefined();
    expect(dated.fires.get('opponent_memory_donor_fresh')).toBe(1);
    // Another opponent's donor was dated; this one was not.
    const undated = read(new Map([[opponentMemoryKey(reader, 'nlh', 'cash', 'full'), 0]]));
    expect(undated.pfr).toBeUndefined();
    expect(undated.fires.get('opponent_memory_donor_staleness_unknown')).toBe(1);
    for (const k of ['fresh', 'stale', 'expired'])
      expect(undated.fires.get(`opponent_memory_donor_${k}`)).toBeUndefined();
  });

  it('the receipt version names the digest preimage: 1 for exact rows alone, 2 with donors', () => {
    const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    let now = 100;
    const pool = new PooledPublicProfiles(() => now);
    pool.observe(hand(1, 6, TABLE, true));
    now = 110;
    pool.observe(hand(2, 3, TABLE, true));
    const both = pool.read(request(reader, 3, TABLE, 1000))!;
    expect(both.rows).toHaveLength(1);
    expect(both.donors).toHaveLength(1);
    expect(both.receipt.version).toBe(2);
    expect(both.receipt.digest).toBe(sha({ rows: both.rows, donors: both.donors }));
    // Heads-up has no sibling size: no donor, version 1 and the exact rows' digest.
    const hu = new PooledPublicProfiles(() => 100);
    hu.observe(hand(3, 2, TABLE, true));
    const alone = hu.read(request(reader, 2, TABLE, 1000))!;
    expect(alone.donors).toHaveLength(0);
    expect(alone.receipt.version).toBe(1);
    expect(alone.receipt.digest).toBe(sha(alone.rows));
    // The retained decision receipt validates for both preimages, never a third.
    const bank = new HorseObserverReads(20, 20, () => 100);
    bank.complete(hand(5, 6, TABLE, true), () => {});
    const next = request(reader, 3, TABLE, 1000);
    bank.run(next, () => undefined);
    const receipt = bank.receipt(next)!;
    expect(receipt.pooledPublicProfiles?.version).toBe(2);
    expect(horseObserverReadsUsedPublicPool(receipt, next)).toBe(true);
    expect(
      horseObserverReadsUsedPublicPool(
        { ...receipt, pooledPublicProfiles: { ...receipt.pooledPublicProfiles!, version: 3 } },
        next
      )
    ).toBe(false);
  });
});
