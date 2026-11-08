import { learnablePublicAction } from '../HorseOpponentExploit.js';
import { publicMemoryDomainKey } from '../HorsePublicMemoryDomain.js';
import { createHash } from 'node:crypto';
import {
  computeDonorHandClockStaleness,
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
  version: 1;
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
  marks: Array<[at: number, count: number]>;
}
const CLOCK_MARKS = 8;
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
  private lastAt = 0;
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
          user_id: p.user_id,
          variant: p.variant,
          mode: p.mode,
          size: p.size,
          observed_hands: p.observed_hands,
          initialized: p.initialized,
          counters: { ...p.counters },
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
    for (const id of actors) this.tick(id, at);
    const rowKey = (id: string) =>
      opponentMemoryKey(id, context.variant as DurableOpponentProfile['variant'], mode, size) +
      (context.version === 2 ? '|' + publicMemoryDomainKey(context.publicMemoryDomain) : '');
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
    const returned = new Set(valid ? profiles.map((p) => p.user_id) : []);
    for (const id of actors)
      if (learningActors.has(id) && !returned.has(id)) this.rows.delete(rowKey(id));
    if (!valid) return 0;
    let learned = 0;
    for (const p of profiles) {
      if (!learningActors.has(p.user_id)) continue;
      const k = profileKey(p);
      const previous = this.rows.get(k);
      if (previous) {
        const previousVersion = opponentProfileVersion(previous.profile),
          version = opponentProfileVersion(p);
        if (previousVersion > version) continue; // an out-of-order older hand cannot erase newer notes
        if (previousVersion === version) {
          this.rows.delete(k); // this new hand has no confirmed fresh profile
          continue;
        }
      }
      this.rows.delete(k);
      this.rows.set(k, {
        profile: {
          ...(p.public_memory_domain
            ? { public_memory_domain: { ...p.public_memory_domain } }
            : {}),
          user_id: p.user_id,
          variant: p.variant,
          mode: p.mode,
          size: p.size,
          observed_hands: p.observed_hands,
          initialized: p.initialized,
          counters: { ...p.counters },
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
    for (const player of request.gameState.players) {
      if (
        !request.gameState.dealtSeatIds?.includes(player.seat) ||
        player.user_id === context.observerId
      )
        continue;
      const variant = context.variant as DurableOpponentProfile['variant'];
      const found = this.rows.get(
        opponentMemoryKey(player.user_id, variant, mode, size) + domainSuffix
      );
      // A newer receipt is unavailable to an older queued snapshot. Never
      // substitute it or relabel its availability with the decision clock.
      if (found && found.at <= request.decisionTimeMs) {
        rows.push(structuredClone(found.profile));
        noted.add(player.user_id);
        availableAtMs = Math.max(availableAtMs, found.at);
      }
      for (const [donorMode, donorSize] of opponentMemoryDonors(mode, size)) {
        const donor = this.rows.get(
          opponentMemoryKey(player.user_id, variant, donorMode, donorSize) + domainSuffix
        );
        if (!donor || donor.at > request.decisionTimeMs) continue;
        donors.push({
          profile: structuredClone(donor.profile),
          staleness: computeDonorHandClockStaleness(
            donor.clock,
            this.clockAt(player.user_id, request.decisionTimeMs, donor.clock)
          ),
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
    return {
      rows,
      donors,
      receipt: {
        version: 1,
        source: this.bootstrapped
          ? 'saved_and_accepted_public_profiles'
          : 'accepted_hand_public_profiles',
        availableAtMs,
        // Without donors the digest is exactly the exact rows' digest it was.
        digest: createHash('sha256')
          .update(JSON.stringify(donors.length ? { rows, donors } : rows))
          .digest('hex'),
        profiles: noted.size,
      },
    };
  }
  private tick(userId: string, at: number): void {
    const clock = this.clocks.get(userId) ?? { count: 0, marks: [] };
    clock.count++;
    clock.marks.push([at, clock.count]);
    if (clock.marks.length > CLOCK_MARKS) clock.marks.shift();
    this.clocks.delete(userId);
    this.clocks.set(userId, clock);
    while (this.clocks.size > this.capacity) this.clocks.delete(this.clocks.keys().next().value!);
  }
  /** The player's hand clock as it stood at `cutoffMs`. A row available at the
   * cutoff was learned at or before it, so the clock is never below its mark. */
  private clockAt(userId: string, cutoffMs: number, floor: number): number {
    const clock = this.clocks.get(userId);
    if (!clock) return floor;
    for (let i = clock.marks.length - 1; i >= 0; i--)
      if (clock.marks[i]![0] <= cutoffMs) return Math.max(floor, clock.marks[i]![1]);
    return Math.max(floor, (clock.marks[0]?.[1] ?? 1) - 1);
  }
  clear(): void {
    this.clocks.clear();
    this.rows.clear();
    this.seen.clear();
    this.lastAt = 0;
    this.bootstrapped = false;
  }
}
