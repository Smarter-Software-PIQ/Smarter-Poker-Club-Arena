import { verifiedSavedPresence } from './savedProfilePresence.js';
import { isDeepStrictEqual } from 'node:util';
import { learnablePublicAction } from '../HorseOpponentExploit.js';
import { publicMemoryDomainKey } from '../HorsePublicMemoryDomain.js';
import { createHash } from 'node:crypto';
import {
  computeDonorHandClockStaleness,
  copyLongCounters,
  copyShownRiver,
  copyFlopShownRecord,
  copyReraiseResponseRecord,
  copyOpenerResponseRecord,
  copyStreetCounters,
  copyStreetPriceRecord,
  durableProfileCounters,
  opponentMemoryDonors,
  opponentMemoryKey,
  opponentProfileVersion,
  validOpponentProfile,
  type DurableOpponentProfile,
} from '../HorseOpponentMemory.js';
import { horseCompletedHandKey } from '../HorseDecisionHandBinding.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import { observerParticipantsBind } from './observerParticipants.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

export interface PooledPublicProfileReceipt {
  /** 1: the digest covers the exact rows alone (a read with no donor).
   *  2: the read carried sibling table-size donors and the digest covers
   *  `{ rows, donors }`. The version names the digest preimage. */
  version: 1 | 2 | 3;
  /** Version 3 binds each named exact or donor row to its own accepted event.
   * Legacy rows can contribute figures without supplying an event binding. */
  lineage?: Array<{
    userId: string;
    size: DurableOpponentProfile['size'];
    observedHands: number;
    handId: string;
  }>;
  /** Selection at the original decision. Older retained receipts lack this field.
   * A process cache hit includes rows previously warmed at worker bootstrap. */
  rowSources?: {
    version: 1;
    rows: Array<{
      userId: string;
      size: DurableOpponentProfile['size'];
      observedHands: number;
      source: 'saved_at_deal' | 'in_process';
    }>;
  };
  source: 'accepted_hand_public_profiles' | 'saved_and_accepted_public_profiles';
  availableAtMs: number;
  digest: string;
  /** Opponents with public notes in this read (an exact row, a donor or both). */
  profiles: number;
}
/** A sibling table-size row of the same game, mode and speed/ante domain that
 * a thin or missing exact row may borrow, with its staleness on the player's
 * own hand clock (hands the player played since this row was last refreshed). */
export interface PooledPublicDonor {
  profile: DurableOpponentProfile;
  staleness: number;
}
/** The player's own hand clock as the cache saw it: the count of accepted
 * hands they acted in, with the latest few (availability, count) marks so an
 * older queued snapshot reads the clock as it stood at its own cutoff. */
interface HandClock {
  count: number;
  marks: Array<[at: number, count: number, learnableRowKey: string | null]>;
}
const CLOCK_MARKS = 8;
/** Consecutive failed completed-hand refreshes a shared exact row survives, counted on the player's own
 * hand clock (hands they acted in since the row was last refreshed). Exported for tests. */
export const MAX_FAILED_PROFILE_REFRESHES = 3;
/** Owner-authorized herd notes. Public aggregate counters only; no card,
 * decision-plan, wager or caller-authored FAST packet enters this cache.
 * The existing accepted-hand broadcaster supplies every worker. No IO,
 * timer or private observer state is needed on the turn.
 *
 * A KNOWN MANIAC IS A MANIAC AT EVERY TABLE SIZE (2026-10-25) and A NEW TABLE
 * IS NOT A NEW PLAYER (2026-10-24): read() also returns the sibling table-size
 * row (opponentMemoryDonors) of the same game, mode and original speed/ante
 * domain, never another domain's, so a thin exact row borrows it in
 * HorseMind.blendDurableRead. Its staleness is the player's own hand clock
 * since that row was last refreshed (Item 12), counted here from accepted
 * hands, never a difference of two buckets' own hand counts. */
function profileKey(p: DurableOpponentProfile): string {
  return (
    opponentMemoryKey(p.user_id, p.variant, p.mode, p.size) +
    (p.public_memory_domain ? '|' + publicMemoryDomainKey(p.public_memory_domain) : '')
  );
}
export class PooledPublicProfiles {
  private readonly rows = new Map<
    string,
    { profile: DurableOpponentProfile; at: number; clock: number }
  >();
  private readonly clocks = new Map<string, HandClock>();
  private readonly seen = new Set<string>();
  private readonly rejectedVersions = new Map<string, number>();
  private spilledVersionBounds?: Float64Array;
  private lastAt = 0;
  private evictedClockThroughMs = -1;
  private bootstrapped = false;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 32768
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 32768)
      throw Error('Invalid public profile capacity');
  }
  bootstrap(snapshot: { availableAtMs: number; profiles: DurableOpponentProfile[] }): boolean {
    if (
      this.bootstrapped ||
      this.rows.size ||
      this.seen.size ||
      !Number.isSafeInteger(snapshot?.availableAtMs) ||
      snapshot.availableAtMs < 0 ||
      !Array.isArray(snapshot.profiles) ||
      snapshot.profiles.length > this.capacity
    )
      return false;
    const staged = new Map<
      string,
      { profile: DurableOpponentProfile; at: number; clock: number }
    >();
    for (const p of snapshot.profiles) {
      if (!validOpponentProfile(p)) return false;
      const key = profileKey(p);
      if (staged.has(key)) return false;
      staged.set(key, {
        profile: {
          ...(p.public_memory_domain
            ? { public_memory_domain: { ...p.public_memory_domain } }
            : {}),
          ...(p.last_accepted_hand_id ? { last_accepted_hand_id: p.last_accepted_hand_id } : {}),
          user_id: p.user_id,
          variant: p.variant,
          mode: p.mode,
          size: p.size,
          observed_hands: p.observed_hands,
          initialized: p.initialized,
          counters: { ...p.counters },
          // The long participation window travels with its row (absent stays absent).
          ...copyLongCounters(p),
          // So does its durable shown river record (2026-11-15; a malformed one is dropped).
          ...copyShownRiver(p),
          // And its postflop read by street and flop texture (2026-11-17; a malformed one is dropped).
          ...copyStreetCounters(p),
          // And how he answers a raise of his own re-raise (2026-11-18; a malformed one is dropped).
          ...copyReraiseResponseRecord(p),
          // And what his flop bets showed and what calling them returned (2026-11-19; a malformed one is dropped).
          ...copyFlopShownRecord(p),
          // And the price behind his fold-to-raise cells (2026-11-19; a malformed one is dropped).
          ...copyStreetPriceRecord(p),
          // And how he answers a 3-bet of his own open (2026-11-24; a malformed one is dropped).
          ...copyOpenerResponseRecord(p),
        },
        at: snapshot.availableAtMs,
        // Saved notes are fresh at boot; staleness counts the hands the
        // player plays after it without this row being refreshed.
        clock: 0,
      });
    }
    for (const [key, row] of staged) this.rows.set(key, row);
    this.lastAt = snapshot.availableAtMs;
    this.bootstrapped = true;
    return true;
  }
  observe(hand: ObserveCompletedHandRequest): number {
    const key = horseCompletedHandKey(hand);
    const participants = hand.observerParticipants;
    const at = this.now();
    const profiles = hand.durableOpponentProfiles;
    if (
      !key ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        hand.committedHandId ?? ''
      ) ||
      !Number.isSafeInteger(at) ||
      at < this.lastAt ||
      this.seen.has(key) ||
      !observerParticipantsBind(participants, hand) ||
      participants.status !== 'bound' ||
      !Array.isArray(hand.actions) ||
      hand.actions.length > 4096 ||
      hand.actions.some((a) => !a || typeof a !== 'object' || Array.isArray(a))
    )
      return 0;
    const context = participants.contexts[0]!;
    const mode = context.format === 'cash' ? 'cash' : 'tournament';
    const size = context.dealtCount <= 2 ? 'hu' : context.dealtCount <= 5 ? 'short' : 'full';
    const actors = new Set(
      hand.actions.map((a) => a.userId).filter((id): id is string => typeof id === 'string')
    );
    const learningActors = new Set(hand.actions.filter(learnablePublicAction).map((a) => a.userId));
    this.lastAt = at;
    this.seen.add(key);
    while (this.seen.size > this.capacity) this.seen.delete(this.seen.values().next().value!);
    const rowKey = (id: string) =>
      opponentMemoryKey(id, context.variant as DurableOpponentProfile['variant'], mode, size) +
      (context.version === 2 ? '|' + publicMemoryDomainKey(context.publicMemoryDomain) : '');
    for (const id of actors) this.tick(id, at, learningActors.has(id) ? rowKey(id) : null);
    const valid =
      Array.isArray(profiles) &&
      profiles.length <= 10 &&
      new Set(profiles.map((p) => p?.user_id)).size === profiles.length &&
      profiles.every(
        (p) =>
          validOpponentProfile(p) &&
          (context.version === 2
            ? publicMemoryDomainKey(p.public_memory_domain) ===
              publicMemoryDomainKey(context.publicMemoryDomain)
            : p.public_memory_domain === undefined) &&
          p.variant === context.variant &&
          p.mode === mode &&
          p.size === size &&
          actors.has(p.user_id)
      );
    // A newer accepted action is known even when its profile read failed.
    // Never let stale aggregate counters suppress fresher individual learning.
    // A FAILED REFRESH IS NOT A NEWER PROFILE (2026-11-15): when the read itself
    // failed (durableOpponentProfilesRead 'failed'; busy or timed out behind an
    // upstream queue, MEMORY-READ-ROOT-CAUSE.md), the saved database row is
    // still complete and returns at the player's next successful read. The
    // shared row is kept while the player has missed at most
    // MAX_FAILED_PROFILE_REFRESHES refreshes on their own hand clock, so one
    // stall does not drop every Horse to its thin individual read of that
    // player; past that bound it is dropped as before. A successful read that
    // returns no row for the actor still drops it.
    const returned = new Set(valid ? profiles.map((p) => p.user_id) : []);
    const readFailed = hand.durableOpponentProfilesRead === 'failed';
    for (const id of actors) {
      if (!learningActors.has(id) || returned.has(id)) continue;
      const key = rowKey(id);
      const kept = this.rows.get(key);
      if (
        readFailed &&
        kept &&
        (this.clocks.get(id)?.count ?? 0) - kept.clock <= MAX_FAILED_PROFILE_REFRESHES
      )
        continue;
      this.invalidate(key);
    }
    if (!valid) return 0;
    let learned = 0;
    for (const p of profiles) {
      if (!learningActors.has(p.user_id)) continue;
      const k = profileKey(p);
      const previous = this.rows.get(k);
      const version = opponentProfileVersion(p);
      if (!previous && version <= this.rejectedThrough(k)) continue;
      if (previous) {
        const previousVersion = opponentProfileVersion(previous.profile);
        if (previousVersion > version) continue; // an out-of-order older hand cannot erase newer notes
        if (previousVersion === version) {
          // A prior RPC may already have read this completed hand's row.
          // Its original availability stays valid for earlier queued snapshots.
          if (
            p.last_accepted_hand_id === hand.committedHandId &&
            previous.profile.last_accepted_hand_id === hand.committedHandId &&
            isDeepStrictEqual(durableProfileCounters(previous.profile), durableProfileCounters(p))
          )
            continue;
          this.invalidate(k); // this new hand has no confirmed fresh profile
          continue;
        }
      }
      this.rows.delete(k);
      this.rows.set(k, {
        profile: {
          ...(p.public_memory_domain
            ? { public_memory_domain: { ...p.public_memory_domain } }
            : {}),
          ...(p.last_accepted_hand_id ? { last_accepted_hand_id: p.last_accepted_hand_id } : {}),
          user_id: p.user_id,
          variant: p.variant,
          mode: p.mode,
          size: p.size,
          observed_hands: p.observed_hands,
          initialized: p.initialized,
          counters: { ...p.counters },
          ...copyLongCounters(p),
          ...copyShownRiver(p),
          ...copyStreetCounters(p),
          // And how he answers a raise of his own re-raise (2026-11-18; a malformed one is dropped).
          ...copyReraiseResponseRecord(p),
          // And what his flop bets showed and what calling them returned (2026-11-19; a malformed one is dropped).
          ...copyFlopShownRecord(p),
          // And the price behind his fold-to-raise cells (2026-11-19; a malformed one is dropped).
          ...copyStreetPriceRecord(p),
          // And how he answers a 3-bet of his own open (2026-11-24; a malformed one is dropped).
          ...copyOpenerResponseRecord(p),
        },
        at,
        clock: this.clocks.get(p.user_id)?.count ?? 0,
      });
      learned++;
    }
    while (this.rows.size > this.capacity) this.rows.delete(this.rows.keys().next().value!);
    return learned;
  }
  read(request: FastHorseDecisionRequest): {
    rows: DurableOpponentProfile[];
    donors: PooledPublicDonor[];
    receipt: PooledPublicProfileReceipt;
  } | null {
    const context = horseObserverReadContextFromRequest(request);
    if (!context || !Number.isSafeInteger(request.decisionTimeMs) || request.decisionTimeMs < 0)
      return null;
    const mode = context.format === 'cash' ? 'cash' : 'tournament';
    const size = context.dealtCount <= 2 ? 'hu' : context.dealtCount <= 5 ? 'short' : 'full';
    const rows: DurableOpponentProfile[] = [];
    const donors: PooledPublicDonor[] = [];
    const noted = new Set<string>();
    const domainSuffix =
      context.version === 2 ? '|' + publicMemoryDomainKey(context.publicMemoryDomain) : '';
    let availableAtMs = 0;
    const selectedSaved = new Set<DurableOpponentProfile>();
    const saved = verifiedSavedPresence(request, request.savedProfilePresence);
    const savedAt = saved?.availableAtMs;
    const requestAt = saved?.requestedAtMs;

    for (const player of request.gameState.players) {
      if (
        !request.gameState.dealtSeatIds?.includes(player.seat) ||
        player.user_id === context.observerId
      )
        continue;
      const variant = context.variant as DurableOpponentProfile['variant'];
      const baseKey = opponentMemoryKey(player.user_id, variant, mode, size);
      const exactKey = baseKey + domainSuffix;
      const found = this.rows.get(exactKey);
      // A newer receipt is unavailable to an older queued snapshot. Never
      // substitute it or relabel its availability with the decision clock.
      const eligible = found && found.at <= request.decisionTimeMs ? found : null;
      const candidate = saved?.exactProfiles?.find((p) => p.user_id === player.user_id);
      // Keep this fallback inside the current read. A completion/retry racing the
      // DB snapshot may have invalidated its counters before the decision cutoff.
      const clock = candidate && this.clocks.get(player.user_id);
      const intervening =
        candidate &&
        requestAt != null &&
        (this.evictedClockThroughMs >= requestAt ||
          (clock &&
            ((clock.marks[0]![1] > 1 && clock.marks[0]![0] >= requestAt) ||
              clock.marks.some(
                ([at, , updatedKey]) =>
                  at >= requestAt &&
                  at <= request.decisionTimeMs &&
                  (updatedKey === exactKey || updatedKey === baseKey)
              ))));
      const preferSaved =
        candidate &&
        savedAt != null &&
        !intervening &&
        opponentProfileVersion(candidate) >
          (eligible ? opponentProfileVersion(eligible.profile) : this.rejectedThrough(exactKey));
      if (preferSaved) {
        rows.push(candidate);
        noted.add(player.user_id);
        availableAtMs = Math.max(availableAtMs, savedAt);
        selectedSaved.add(candidate);
      } else if (eligible) {
        rows.push(structuredClone(eligible.profile));
        noted.add(player.user_id);
        availableAtMs = Math.max(availableAtMs, eligible.at);
      }
      for (const [donorMode, donorSize] of opponentMemoryDonors(mode, size)) {
        const donor = this.rows.get(
          opponentMemoryKey(player.user_id, variant, donorMode, donorSize) + domainSuffix
        );
        if (!donor || donor.at > request.decisionTimeMs) continue;
        const clock = this.clockAt(player.user_id, request.decisionTimeMs, donor.clock);
        if (clock === null) continue;
        donors.push({
          profile: structuredClone(donor.profile),
          staleness: computeDonorHandClockStaleness(donor.clock, clock),
        });
        noted.add(player.user_id);
        availableAtMs = Math.max(availableAtMs, donor.at);
      }
    }
    if (!noted.size) return null;
    rows.sort((a, b) => a.user_id.localeCompare(b.user_id));
    donors.sort(
      (a, b) =>
        a.profile.user_id.localeCompare(b.profile.user_id) ||
        a.profile.size.localeCompare(b.profile.size)
    );
    const selectedRows = [...rows, ...donors.map((donor) => donor.profile)];
    const lineage = selectedRows.flatMap((profile) =>
      profile.last_accepted_hand_id
        ? [
            {
              userId: profile.user_id,
              size: profile.size,
              observedHands: profile.observed_hands,
              handId: profile.last_accepted_hand_id,
            },
          ]
        : []
    );
    return {
      rows,
      donors,
      receipt: {
        version: lineage.length ? 3 : donors.length ? 2 : 1,
        ...(lineage.length ? { lineage } : {}),
        rowSources: {
          version: 1,
          rows: selectedRows.map((p) => ({
            userId: p.user_id,
            size: p.size,
            observedHands: p.observed_hands,
            source: selectedSaved.has(p) ? 'saved_at_deal' : 'in_process',
          })),
        },
        source:
          this.bootstrapped || selectedSaved.size > 0
            ? 'saved_and_accepted_public_profiles'
            : 'accepted_hand_public_profiles',
        availableAtMs,
        // Without donors the digest is exactly the exact rows' digest it was
        // (version 1); with donors it covers both (version 2).
        digest: createHash('sha256')
          .update(JSON.stringify(lineage.length || donors.length ? { rows, donors } : rows))
          .digest('hex'),
        profiles: noted.size,
      },
    };
  }
  private rejectedThrough(key: string): number {
    const known = this.rejectedVersions.get(key);
    if (known !== undefined) return known;
    return this.spilledVersionBounds?.[this.spillBucket(key)] ?? -1;
  }
  private spillBucket(key: string): number {
    return createHash('sha256').update(key).digest().readUInt32LE(0) % this.capacity;
  }
  private invalidate(key: string): void {
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.delete(key);
    this.rejectedVersions.delete(key);
    this.rejectedVersions.set(key, opponentProfileVersion(row.profile));
    if (this.rejectedVersions.size <= this.capacity) return;
    // Keep a conservative bound even after the exact rejected key is evicted.
    // Hash collisions can suppress a cold read, but never attribute a version
    // to a player. A retained exact key or resident row keeps its own precedence.
    const [evicted, version] = this.rejectedVersions.entries().next().value!;
    this.rejectedVersions.delete(evicted);
    const bounds = (this.spilledVersionBounds ??= new Float64Array(this.capacity).fill(-1));
    const bucket = this.spillBucket(evicted);
    bounds[bucket] = Math.max(bounds[bucket]!, version);
  }
  private tick(userId: string, at: number, learnableRowKey: string | null): void {
    const clock = this.clocks.get(userId) ?? { count: 0, marks: [] };
    clock.count++;
    clock.marks.push([at, clock.count, learnableRowKey]);
    if (clock.marks.length > CLOCK_MARKS) clock.marks.shift();
    this.clocks.delete(userId);
    this.clocks.set(userId, clock);
    if (this.clocks.size > this.capacity) {
      const [id, evicted] = this.clocks.entries().next().value!;
      this.evictedClockThroughMs = Math.max(this.evictedClockThroughMs, evicted.marks.at(-1)![0]);
      this.clocks.delete(id);
    }
  }
  /** The player's hand clock as it stood at `cutoffMs`. A row available at the
   * cutoff was learned at or before it, so the clock is never below its mark. */
  private clockAt(userId: string, cutoffMs: number, floor: number): number | null {
    const clock = this.clocks.get(userId);
    if (!clock) return floor;
    for (let i = clock.marks.length - 1; i >= 0; i--)
      if (clock.marks[i]![0] <= cutoffMs) return Math.max(floor, clock.marks[i]![1]);
    // An evicted interval may include observations after this decision. Only
    // the donor floor is provable when no intervening marks are missing.
    return (clock.marks[0]?.[1] ?? 1) - 1 <= floor ? floor : null;
  }
  clear(): void {
    this.clocks.clear();
    this.rows.clear();
    this.seen.clear();
    this.rejectedVersions.clear();
    this.spilledVersionBounds = undefined;
    this.lastAt = 0;
    this.evictedClockThroughMs = -1;
    this.bootstrapped = false;
  }
}
