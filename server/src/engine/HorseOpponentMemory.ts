import {
  publicMemoryDomainIsValid,
  type HorsePublicMemoryDomain,
} from './HorsePublicMemoryDomain.js';
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_LONG_FIELDS,
  hasLongParticipation,
  type ExploitCounters,
  type ExploitCountersWithLong,
  type ExploitLongCounters,
} from './HorseOpponentExploit.js';

export const MEMORY_VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo8',
  'short_deck',
  'pineapple',
] as const;
export type MemoryVariant = (typeof MEMORY_VARIANTS)[number];
export type MemoryMode = 'cash' | 'tournament';
export type MemorySize = 'hu' | 'short' | 'full';
export interface DurableOpponentProfile {
  public_memory_domain?: HorsePublicMemoryDomain;
  /** Original accepted event supplying this version. Older rows have no binding. */
  last_accepted_hand_id?: string | null;
  user_id: string;
  variant: MemoryVariant;
  mode: MemoryMode;
  size: MemorySize;
  observed_hands: number;
  initialized: boolean;
  counters: ExploitCounters;
  /**
   * 2026-11-15 the long participation window of this exact row
   * (horse_exact_profiles.long_counters: lHands, lVpip, lPfr at a 120-hand
   * half-life, written by the accepted-hand learner from the hand after the
   * column was installed). Null or absent: the row has learned no hand since
   * then (or the column is not installed, or it is a legacy-table row), and the
   * read keeps the 30-hand window alone. Kept apart from `counters` so the
   * 27-key counters JSON every reader validates keeps its exact shape.
   */
  long_counters?: ExploitLongCounters | null;
}

/** A profile's long participation window, valid or not: exactly lHands, lVpip, lPfr, finite and non-negative,
 *  VPIP and PFR never above hands. Null and absent are valid (no window yet). */
export function validLongCounters(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === EXPLOIT_LONG_FIELDS.length &&
    EXPLOIT_LONG_FIELDS.every(
      (f) => typeof v[f] === 'number' && Number.isFinite(v[f]) && (v[f] as number) >= 0
    ) &&
    (v.lVpip as number) <= (v.lHands as number) + 1e-9 &&
    (v.lPfr as number) <= (v.lHands as number) + 1e-9
  );
}

/** The counters a read takes from one durable row: its 27 counters plus, when the row has one, its long
 *  participation window (the database's long_counters column; an engine-built row may carry it inside its
 *  counters instead, and the column wins when both are present). A fresh object; the profile is not touched. */
export function durableProfileCounters(p: DurableOpponentProfile): ExploitCountersWithLong {
  const out: ExploitCountersWithLong = { ...p.counters };
  if (p.long_counters) for (const f of EXPLOIT_LONG_FIELDS) out[f] = p.long_counters[f];
  return out;
}

/** A copy of a profile's long window for a stored copy of the profile: absent stays absent, null stays null. */
export function copyLongCounters(
  p: DurableOpponentProfile
): Pick<DurableOpponentProfile, 'long_counters'> {
  return p.long_counters === undefined
    ? {}
    : { long_counters: p.long_counters === null ? null : { ...p.long_counters } };
}

/** Blend the long window of an exact row and a donor at the donor's weight, as every other field blends. A
 *  window neither row carries stays absent. */
function blendLong(
  out: ExploitCountersWithLong,
  exact: ExploitCountersWithLong | undefined,
  donor: ExploitCountersWithLong,
  weight: number
): void {
  if (!hasLongParticipation(exact) && !hasLongParticipation(donor)) return;
  for (const f of EXPLOIT_LONG_FIELDS) out[f] = (exact?.[f] ?? 0) + weight * (donor[f] ?? 0);
}

export function memoryVariant(value: unknown): MemoryVariant | null {
  return typeof value === 'string' && MEMORY_VARIANTS.includes(value as MemoryVariant)
    ? (value as MemoryVariant)
    : null;
}

export function opponentMemoryKey(
  userId: string,
  variant: MemoryVariant,
  mode: MemoryMode,
  size: MemorySize
): string {
  return `${variant}:${mode}:${size}|${userId}`;
}

/**
 * ═══ A PROFILE IS EVIDENCE BEFORE ITS BACK-FILL (2026-10-24) ═══════════════
 * `initialized` means the one-time legacy back-fill (hands played before the
 * durable memory existed) has been folded in. That back-fill runs one player
 * per read request behind one database-wide lock, and on 2026-10-24 5,965 of
 * 15,199 profiles were still waiting - 730 of them with 240+ hands of their
 * own, 24 of them human players - while every reader dropped them. So a horse
 * met those players, on the first hand at every new table, with no read.
 *
 * The counters in an uninitialized row are exact for every hand since the
 * memory began; the back-fill only adds OLDER hands, which the 30-hand (and
 * 8-hand fast-window) decay weighs least. Leaving them out is a smaller
 * sample, never a biased one, and the Bayesian credibility gate already
 * prices sample size. So a row is used as soon as it exists, and a row that
 * later completes its back-fill supersedes the version without it.
 */
export function opponentProfileVersion(
  p: Pick<DurableOpponentProfile, 'observed_hands' | 'initialized'>
): number {
  return p.observed_hands * 2 + (p.initialized ? 1 : 0);
}

export function validOpponentProfile(value: unknown): value is DurableOpponentProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as DurableOpponentProfile;
  return (
    (p.public_memory_domain === undefined || publicMemoryDomainIsValid(p.public_memory_domain)) &&
    (p.last_accepted_hand_id == null ||
      (publicMemoryDomainIsValid(p.public_memory_domain) &&
        typeof p.last_accepted_hand_id === 'string' &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          p.last_accepted_hand_id
        ) &&
        p.observed_hands > 0)) &&
    typeof p.user_id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.user_id) &&
    memoryVariant(p.variant) !== null &&
    ['cash', 'tournament'].includes(p.mode) &&
    ['hu', 'short', 'full'].includes(p.size) &&
    Number.isSafeInteger(p.observed_hands) &&
    p.observed_hands >= 0 &&
    typeof p.initialized === 'boolean' &&
    validLongCounters(p.long_counters) &&
    !!p.counters &&
    typeof p.counters === 'object' &&
    // The 27 counters; an engine-built row (a counter row of this process) may also carry its long window inside
    // them, all three fields or none. The database's counters JSON is always the 27 (long_counters is apart).
    (Object.keys(p.counters).length === EXPLOIT_COUNTER_FIELDS.length ||
      (Object.keys(p.counters).length ===
        EXPLOIT_COUNTER_FIELDS.length + EXPLOIT_LONG_FIELDS.length &&
        validLongCounters(
          Object.fromEntries(
            EXPLOIT_LONG_FIELDS.map((f) => [f, (p.counters as ExploitCountersWithLong)[f]])
          )
        ))) &&
    EXPLOIT_COUNTER_FIELDS.every((f) => Number.isFinite(p.counters[f]) && p.counters[f] >= 0) &&
    (
      [
        ['vpip', 'hands'],
        ['pfr', 'hands'],
        ['rfi', 'rfiOpp'],
        ['threeBet', 'threeBetOpp'],
        ['foldTo3Bet', 'foldTo3BetOpp'],
        ['betCheckedTo', 'betCheckedToOpp'],
        ['foldToBet', 'foldToBetOpp'],
        ['riverCall', 'riverCallOpp'],
        ['fPfr', 'fHands'],
        ['fRfi', 'fRfiOpp'],
        ['fThreeBet', 'fThreeBetOpp'],
        ['fBetCheckedTo', 'fBetCheckedToOpp'],
        ['fFoldToBet', 'fFoldToBetOpp'],
        ['fRiverCall', 'fRiverCallOpp'],
      ] as const
    ).every(([success, opportunity]) => p.counters[success] <= p.counters[opportunity] + 1e-9)
  );
}

/**
 * ═══ A NEW TABLE IS NOT A NEW PLAYER (2026-10-24) ═══════════════════════════
 * The durable read is filed by exact game context: variant, cash or
 * tournament, and table size (heads-up, short, full). That is right - a
 * heads-up VPIP is not a six-max VPIP - but it made the first hand against a
 * player in a NEW context a cold read even when the horse had hundreds of
 * hands on them one size over. Lightning makes that the common case: seats
 * fill one at a time, so the same pool swings between short and full.
 *
 * When the exact bucket is thin, the other multiway bucket for the same
 * variant and the same mode stands in, at reduced weight (short for full, full
 * for short). Two separations are kept on purpose: heads-up never mixes with a
 * multiway bucket in either direction (the V45 reason for scoping at all), and
 * cash never mixes with tournament play (stack depth and ICM change what a
 * frequency means; HorseOpponentMemory.test pins that isolation). A donor's
 * counters are scaled, which keeps every rate and shrinks the evidence, so the
 * Bayesian credibility gate engages a read from borrowed hands only on a
 * clearer deviation.
 */
export const OPPONENT_MEMORY_THIN_HANDS = 12;
export const OPPONENT_MEMORY_DONOR_WEIGHT = 0.6;

export function opponentMemoryDonors(
  mode: MemoryMode,
  size: MemorySize
): ReadonlyArray<readonly [MemoryMode, MemorySize]> {
  if (size === 'hu') return [];
  return [[mode, size === 'full' ? 'short' : 'full']];
}

/**
 * The counters a read should use for (player, exact context): the exact row
 * when it is not thin, otherwise the exact row plus the richest donor at
 * OPPONENT_MEMORY_DONOR_WEIGHT. Undefined when nothing is known. Pure.
 */
export function blendOpponentMemory(
  exact: ExploitCounters | undefined,
  donors: ReadonlyArray<ExploitCounters | undefined>
): ExploitCounters | undefined {
  if (exact && exact.hands >= OPPONENT_MEMORY_THIN_HANDS) return exact;
  let best: ExploitCounters | undefined;
  for (const row of donors) if (row && row.hands > (best?.hands ?? 0)) best = row;
  if (!best) return exact;
  const out = {} as ExploitCounters;
  for (const f of EXPLOIT_COUNTER_FIELDS)
    out[f] = (exact?.[f] ?? 0) + OPPONENT_MEMORY_DONOR_WEIGHT * (best[f] ?? 0);
  blendLong(out, exact, best, OPPONENT_MEMORY_DONOR_WEIGHT);
  return out;
}

export const OPPONENT_MEMORY_DONOR_HALF_LIFE_HANDS = 120;

/**
 * Computes the non-negative hand-clock staleness (`handsSinceDonorUpdate`) of a
 * donor profile (`donorObservedHands` at `currentDonorHandClock`).
 *
 * Importantly, donor staleness must NEVER be computed as
 * `exact.observed_hands - donor.observed_hands`: a player who played 80 hands
 * at 6-max (`donor.observed_hands = 80`) and then sat down at 9-max (`exact.observed_hands = 2`)
 * would produce `-78` under that naive difference. Instead, the hand clock
 * compares the monotonic hand counter at which the donor bucket was last
 * observed against the current monotonic hand counter for that player/context,
 * clamping negative or non-finite deltas to `0`.
 */
export function computeDonorHandClockStaleness(
  donorLastObservedHandClock: number,
  currentHandClock: number
): number {
  if (
    !Number.isFinite(donorLastObservedHandClock) ||
    !Number.isFinite(currentHandClock) ||
    donorLastObservedHandClock < 0 ||
    currentHandClock <= donorLastObservedHandClock
  ) {
    return 0;
  }
  return currentHandClock - donorLastObservedHandClock;
}

/**
 * Staleness-weighted donor blend (`v2` — Item 12): decays the cross-table-size
 * donor weight exponentially as `handsSinceDonorUpdate` grows (half-life =
 * `OPPONENT_MEMORY_DONOR_HALF_LIFE_HANDS`) and linearly tapers the donor weight
 * to 0 as `exact.hands` approaches `OPPONENT_MEMORY_THIN_HANDS`, avoiding a
 * discontinuous step jump at 12 exact hands.
 */
export function blendOpponentMemoryWithExpiry(
  exact: ExploitCounters | undefined,
  donors: ReadonlyArray<ExploitCounters | undefined>,
  handsSinceDonorUpdate = 0
): ExploitCounters | undefined {
  if (exact && exact.hands >= OPPONENT_MEMORY_THIN_HANDS) return exact;
  let best: ExploitCounters | undefined;
  for (const row of donors) if (row && row.hands > (best?.hands ?? 0)) best = row;
  if (!best) return exact;
  const exactHands = Math.max(0, exact?.hands ?? 0);
  const thinTaper = Math.max(
    0,
    (OPPONENT_MEMORY_THIN_HANDS - exactHands) / OPPONENT_MEMORY_THIN_HANDS
  );
  const safeHandsSinceDonor =
    Number.isFinite(handsSinceDonorUpdate) && handsSinceDonorUpdate > 0 ? handsSinceDonorUpdate : 0;
  const stalenessFactor =
    safeHandsSinceDonor > 0
      ? Math.pow(0.5, safeHandsSinceDonor / OPPONENT_MEMORY_DONOR_HALF_LIFE_HANDS)
      : 1;
  const effectiveWeight = OPPONENT_MEMORY_DONOR_WEIGHT * thinTaper * stalenessFactor;
  if (effectiveWeight <= 1e-6) return exact;
  const out = {} as ExploitCounters;
  for (const f of EXPLOIT_COUNTER_FIELDS)
    out[f] = (exact?.[f] ?? 0) + effectiveWeight * (best[f] ?? 0);
  blendLong(out, exact, best, effectiveWeight);
  return out;
}

/** Separate bounded donor batch: never another game, mode or heads-up read. */
export function validOpponentDonorProfiles(
  rows: unknown,
  ids: readonly string[],
  variant: string,
  mode: MemoryMode,
  size: MemorySize
): rows is DurableOpponentProfile[] {
  const donorSize = opponentMemoryDonors(mode, size)[0]?.[1];
  return (
    Array.isArray(rows) &&
    rows.length <= 10 &&
    new Set(rows.map((p) => p?.user_id)).size === rows.length &&
    rows.every(
      (p) =>
        validOpponentProfile(p) &&
        ids.includes(p.user_id) &&
        p.variant === variant &&
        p.mode === mode &&
        p.size === donorSize
    )
  );
}
