import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_PROFILE_REFRESHES, PooledPublicProfiles } from './pooledPublicProfiles.js';
import { HorseObserverReads } from './observerReads.js';
import { horseObserverReadsUsedPublicPool } from '../HorseObserverReadEvidence.js';
import { freshExploitCounters } from '../HorseOpponentExploit.js';
import { HorseMind } from '../HorseMind.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

/* A FAILED REFRESH IS NOT A NEWER PROFILE (2026-11-15). On 2026-11-14 the
   completed-hand exact read failed in a Free Buy rebuy stall (busy/timeout,
   observation-06d45e7d-20261114/MEMORY-READ-ROOT-CAUSE.md). The worker then
   dropped the shared exact row of every actor of that hand, although the saved
   database row was complete and came back at the next successful read. These
   cases fail on the code before the fix: the row is dropped at the first
   failed refresh. */
const table = '10000000-0000-4000-8000-000000000001';
const horse = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const opponent = '30000000-0000-4000-8000-000000000001';
const committed = '40000000-0000-4000-8000-000000000001';
const lease = '50000000-0000-4000-8000-000000000001';
function request(id = horse): FastHorseDecisionRequest {
  return {
    type: 'DECIDE_FAST',
    requestId: 1,
    generation: 7,
    fence: `${table}:1000001:1:${lease}:7`,
    decisionKey: '',
    decisionTimeMs: 1000,
    handJournalContext: captureHorseHandJournalContext([]),
    player: { user_id: id, seat: 1 },
    gameState: {
      gameVariant: 'nlh',
      format: 'cash',
      gameMode: 'cash',
      dealtSeatIds: [1, 2],
      players: [
        { user_id: id, seat: 1 },
        { user_id: opponent, seat: 2 },
      ],
    },
  } as never;
}
const savedRow = (pfr: number) => ({
  user_id: opponent,
  variant: 'nlh' as const,
  mode: 'cash' as const,
  size: 'hu' as const,
  observed_hands: 60,
  initialized: true,
  counters: { ...freshExploitCounters(), hands: 30, vpip: 29, pfr, rfiOpp: 30, rfi: 29 },
});
/** One accepted hand in which the opponent raised (a learnable public action). */
function hand(n: number, read: 'ok' | 'failed' | 'empty', pfr = 29): ObserveCompletedHandRequest {
  const number = 1000000 + n;
  return {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 2,
    generation: number,
    fence: `${table}:${number}:${lease}:observe`,
    handKey: `${table}:${number}`,
    committedHandId: committed,
    actions: [
      { userId: opponent, seat: 2, action: 'raise', amount: 8, stage: 'preflop', timestamp: 1 },
    ],
    bigBlind: 2,
    results: [{ user_id: opponent, net: 20 }],
    observerParticipants: {
      version: 1,
      handKey: `${table}:${number}:${lease}`,
      status: 'bound',
      contexts: [horseObserverReadContextFromRequest(request())!],
    },
    durableOpponentProfiles: read === 'ok' ? [savedRow(pfr)] : [],
    ...(read === 'failed' ? { durableOpponentProfilesRead: 'failed' as const } : {}),
  } as ObserveCompletedHandRequest;
}
afterEach(() => HorseMind.reset());
describe('a failed completed-hand profile read', () => {
  it('keeps the shared exact row through one failed refresh', () => {
    const pool = new PooledPublicProfiles(() => 100);
    expect(pool.observe(hand(1, 'ok'))).toBe(1);
    expect(pool.read(request(other))?.rows[0]?.counters.pfr).toBe(29);
    expect(pool.observe(hand(2, 'failed'))).toBe(0);
    // Before the fix the row was dropped here and read() returned null.
    expect(pool.read(request(other))?.rows[0]?.counters.pfr).toBe(29);
  });
  it(`drops it once the player has missed more than ${MAX_FAILED_PROFILE_REFRESHES} refreshes`, () => {
    const pool = new PooledPublicProfiles(() => 100);
    expect(pool.observe(hand(1, 'ok'))).toBe(1);
    for (let n = 2; n < 2 + MAX_FAILED_PROFILE_REFRESHES; n++) {
      pool.observe(hand(n, 'failed'));
      expect(pool.read(request(other))?.rows).toHaveLength(1);
    }
    pool.observe(hand(2 + MAX_FAILED_PROFILE_REFRESHES, 'failed'));
    expect(pool.read(request(other))).toBeNull();
  });
  it('takes the next successful read as the newer profile', () => {
    const pool = new PooledPublicProfiles(() => 100);
    expect(pool.observe(hand(1, 'ok'))).toBe(1);
    pool.observe(hand(2, 'failed'));
    const next = hand(3, 'ok', 30);
    next.durableOpponentProfiles![0]!.observed_hands = 62;
    expect(pool.observe(next)).toBe(1);
    expect(pool.read(request(other))?.rows[0]?.counters.pfr).toBe(30);
  });
  it('still drops the row when a successful read returns no saved row for the actor', () => {
    const pool = new PooledPublicProfiles(() => 100);
    expect(pool.observe(hand(1, 'ok'))).toBe(1);
    expect(pool.observe(hand(2, 'empty'))).toBe(0);
    expect(pool.read(request(other))).toBeNull();
  });
  it('reaches another horse through the real observer sandbox read after a failed refresh', () => {
    const bank = new HorseObserverReads(20, 20, () => 100);
    bank.complete(hand(1, 'ok'), () => {});
    bank.complete(hand(2, 'failed'), () => {});
    const next = request(other);
    bank.run(next, () => {
      HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
      expect(HorseMind.opponentRead(opponent)?.stats.pfr).toBeDefined();
    });
    expect(horseObserverReadsUsedPublicPool(bank.receipt(next), next)).toBe(true);
  });
});
