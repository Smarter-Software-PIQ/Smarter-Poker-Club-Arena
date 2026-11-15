import { validOpponentProfile, type DurableOpponentProfile } from '../HorseOpponentMemory.js';
import {
  horseDecisionHandCoordinates,
  horseJournalLeaseIdentityIsValid,
} from '../HorseDecisionHandBinding.js';
import { horseObserverReadContextFromRequest } from '../HorseObserverReadContext.js';
import {
  publicMemoryDomainIsValid,
  publicMemoryDomainKey,
  type HorsePublicMemoryDomain,
} from '../HorsePublicMemoryDomain.js';
import type { LiveHorseDecisionSnapshot } from './protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SavedPresence = 'exact' | 'other_context' | 'no_saved_row';
type Row = {
  user_id: string;
  presence: SavedPresence | 'unavailable';
  priorParticipation: 'accepted_profile_present' | 'unresolved';
};
function subjectRow(user_id: string, presence: Row['presence'], accepted = false): Row {
  return {
    user_id,
    presence,
    priorParticipation: accepted ? 'accepted_profile_present' : 'unresolved',
  };
}
export interface PresenceDeal {
  tableId: string;
  handNumber: number;
  lease: string;
  variant: string;
  mode: 'cash' | 'tournament';
  domain: HorsePublicMemoryDomain;
  roster: { seat: number; id: string; human: boolean }[];
}

export interface SavedPresenceReceipt {
  version: 1;
  scope: 'horse_exact_profiles';
  /** Canonical original hand, lease, rules and player/seat identities. */
  binding: string | null;
  /** Client send and receive bound the database snapshot. Absence is scoped to the saved store. */
  requestedAtMs: number | null;
  availableAtMs: number | null;
  status: 'available' | 'unavailable';
  rows: Row[];
  /** Validated accepted exact rows only. This request-local input never enters a process cache of learned counters. */
  exactProfiles?: DurableOpponentProfile[];
}

function humanIds(deal: PresenceDeal): string[] {
  return deal.roster
    .filter((p) => p.human)
    .map((p) => p.id)
    .sort();
}

function missing(deal?: PresenceDeal | null): SavedPresenceReceipt {
  const binding = deal && dealKey(deal);
  return {
    version: 1,
    scope: 'horse_exact_profiles',
    status: 'unavailable',
    binding: binding || null,
    requestedAtMs: null,
    availableAtMs: null,
    rows: deal && binding ? humanIds(deal).map((id) => subjectRow(id, 'unavailable')) : [],
  };
}

function dealKey(deal: PresenceDeal): string | null {
  if (
    !UUID.test(deal.tableId) ||
    !horseJournalLeaseIdentityIsValid(deal.lease) ||
    !Number.isSafeInteger(deal.handNumber) ||
    deal.handNumber < 1 ||
    !publicMemoryDomainIsValid(deal.domain) ||
    !deal.variant ||
    deal.roster.length < 2 ||
    deal.roster.length > 10
  )
    return null;
  const seats = [...deal.roster].sort((a, b) => a.seat - b.seat);
  if (
    new Set(seats.map((p) => p.id)).size !== seats.length ||
    new Set(seats.map((p) => p.seat)).size !== seats.length ||
    seats.some(
      (p) =>
        !UUID.test(p.id) ||
        !Number.isInteger(p.seat) ||
        p.seat < 1 ||
        p.seat > 10 ||
        typeof p.human !== 'boolean'
    ) ||
    !seats.some((p) => p.human) ||
    !seats.some((p) => !p.human)
  )
    return null;
  return JSON.stringify([
    deal.tableId,
    deal.handNumber,
    deal.lease,
    deal.variant,
    deal.mode,
    deal.domain.speed,
    deal.domain.ante,
    seats.map((p) => [p.seat, p.id, p.human]),
  ]);
}

function snapshotDeal(snapshot: LiveHorseDecisionSnapshot): PresenceDeal | null {
  const hand = horseDecisionHandCoordinates(snapshot);
  const context = horseObserverReadContextFromRequest(snapshot);
  const gs = snapshot.gameState;
  if (
    !hand ||
    context?.version !== 2 ||
    !context.publicMemoryDomain ||
    !Array.isArray(snapshot.savedProfileHumanIds) ||
    !Array.isArray(gs.dealtSeatIds)
  )
    return null;
  return {
    tableId: hand.tableId,
    handNumber: hand.handNumber,
    lease: hand.leaseGeneration,
    variant: context.variant,
    mode: context.format === 'cash' ? 'cash' : 'tournament',
    domain: context.publicMemoryDomain,
    roster: gs.dealtSeatIds.map((seat) => {
      const id = gs.players.find((p) => p.seat === seat)!.user_id;
      return { seat, id, human: snapshot.savedProfileHumanIds!.includes(id) };
    }),
  };
}

/** The exact reducer counts one hand per accepted update. The preflop
 * opportunities below occur at most once per hand. Postflop opportunities can
 * repeat, and the long-window gated counts can outlast the decayed hand count. */
function possibleExactCounters(row: DurableOpponentProfile): boolean {
  const c = row.counters;
  const tolerance = 1e-9;
  return (
    c.hands > 0 &&
    c.fHands > 0 &&
    c.hands <= row.observed_hands + tolerance &&
    c.fHands <= c.hands + tolerance &&
    c.pfr <= c.vpip + tolerance &&
    Math.max(c.rfiOpp, c.threeBetOpp, c.foldTo3BetOpp) <= row.observed_hands + tolerance &&
    Math.max(c.fRfiOpp, c.fThreeBetOpp) <= c.fHands + tolerance
  );
}

/** A saved row may exist without usable public evidence or event lineage.
 * Rows predating event lineage may supply counters while participation stays unresolved. */
function usableProfile(
  raw: unknown,
  id: string,
  deal: PresenceDeal
): DurableOpponentProfile | null {
  if (
    !validOpponentProfile(raw) ||
    raw.user_id !== id ||
    raw.variant !== deal.variant ||
    raw.mode !== deal.mode ||
    raw.size !== (deal.roster.length <= 2 ? 'hu' : deal.roster.length <= 5 ? 'short' : 'full') ||
    publicMemoryDomainKey(raw.public_memory_domain) !== publicMemoryDomainKey(deal.domain) ||
    raw.last_accepted_hand_id === undefined ||
    raw.observed_hands < 1 ||
    !possibleExactCounters(raw)
  )
    return null;
  return {
    user_id: id,
    variant: raw.variant,
    mode: raw.mode,
    size: raw.size,
    public_memory_domain: { ...deal.domain },
    observed_hands: raw.observed_hands,
    initialized: raw.initialized,
    counters: { ...raw.counters },
    last_accepted_hand_id: raw.last_accepted_hand_id,
  };
}

export type SavedPresenceLoader = (deal: PresenceDeal, ids: string[]) => Promise<unknown>;

export class SavedProfilePresenceCache {
  // Hand-local reuse across the fleet without growing with the player population.
  private readonly entries = new Map<string, { receipt: SavedPresenceReceipt }>();
  private inFlight = 0;
  constructor(
    private readonly load: SavedPresenceLoader,
    private readonly now = () => Date.now()
  ) {}

  /** Starts one indexed probe per original roster, without awaiting it in gameplay. */
  prime(deal: PresenceDeal): void {
    const key = dealKey(deal);
    if (!key || this.entries.has(key)) return;
    const entry = { receipt: missing() };
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, entry);
    if (this.inFlight >= 4) return;
    const ids = humanIds(deal);
    const requestedAtMs = this.now();
    this.inFlight++;
    void Promise.resolve()
      .then(() => this.load(deal, ids))
      .then((result) => {
        if (!Array.isArray(result) || result.length !== ids.length) return;
        const rows: Row[] = [];
        const exactProfiles: DurableOpponentProfile[] = [];
        for (let i = 0; i < ids.length; i++) {
          const row = result[i];
          if (
            row?.user_id !== ids[i] ||
            !['exact', 'other_context', 'no_saved_row'].includes(row.presence)
          )
            return;
          const profile =
            row.presence === 'exact' ? usableProfile(row.exact_profile, ids[i]!, deal) : null;
          if (profile) exactProfiles.push(profile);
          rows.push(subjectRow(ids[i]!, row.presence, !!profile?.last_accepted_hand_id));
        }
        entry.receipt = {
          version: 1,
          scope: 'horse_exact_profiles',
          binding: key,
          status: 'available',
          requestedAtMs,
          availableAtMs: this.now(),
          rows,
          ...(exactProfiles.length ? { exactProfiles } : {}),
        };
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight--;
      });
  }

  forSnapshot(snapshot: LiveHorseDecisionSnapshot): SavedPresenceReceipt | undefined {
    if (Array.isArray(snapshot.savedProfileHumanIds) && !snapshot.savedProfileHumanIds.length)
      return undefined;
    const deal = snapshotDeal(snapshot);
    const key = deal && dealKey(deal);
    const receipt = key && this.entries.get(key)?.receipt;
    return receipt &&
      receipt.availableAtMs !== null &&
      receipt.availableAtMs < snapshot.decisionTimeMs
      ? structuredClone(receipt)
      : missing(deal);
  }
}

/** Rebind a host result at the original private worker decision and journal boundary. */
export function verifiedSavedPresence(
  snapshot: LiveHorseDecisionSnapshot,
  receipt: SavedPresenceReceipt | undefined
): SavedPresenceReceipt | undefined {
  if (!receipt) return undefined;
  const deal = snapshotDeal(snapshot);
  if (
    receipt.version !== 1 ||
    receipt.scope !== 'horse_exact_profiles' ||
    receipt.status !== 'available' ||
    !Array.isArray(receipt.rows) ||
    !Number.isSafeInteger(receipt.requestedAtMs) ||
    !Number.isSafeInteger(receipt.availableAtMs) ||
    receipt.requestedAtMs === null ||
    receipt.availableAtMs === null ||
    receipt.requestedAtMs < 0 ||
    receipt.requestedAtMs > receipt.availableAtMs ||
    receipt.availableAtMs >= snapshot.decisionTimeMs
  )
    return missing(deal);
  if (!deal || !receipt.binding || dealKey(deal) !== receipt.binding) return missing(deal);
  const subjects = humanIds(deal);
  if (
    receipt.rows.length !== subjects.length ||
    !subjects.every(
      (id, i) =>
        receipt.rows[i]?.user_id === id &&
        ['exact', 'other_context', 'no_saved_row'].includes(receipt.rows[i]!.presence)
    )
  )
    return missing(deal);
  const profiles: DurableOpponentProfile[] = [];
  if (Array.isArray(receipt.exactProfiles) && receipt.exactProfiles.length <= subjects.length) {
    for (const row of receipt.rows) {
      if (row.presence !== 'exact') continue;
      const candidates = receipt.exactProfiles.filter((p) => p?.user_id === row.user_id);
      if (candidates.length !== 1) continue;
      const profile = usableProfile(candidates[0], row.user_id, deal);
      if (profile) profiles.push(profile);
    }
  }
  // Reconstruct the permitted fields; no untrusted extra data reaches a journal.
  return {
    version: 1,
    scope: receipt.scope,
    status: 'available',
    binding: receipt.binding,
    requestedAtMs: receipt.requestedAtMs,
    availableAtMs: receipt.availableAtMs,
    rows: receipt.rows.map(({ user_id, presence }) =>
      subjectRow(
        user_id,
        presence,
        profiles.some((p) => p.user_id === user_id && !!p.last_accepted_hand_id)
      )
    ),
    ...(profiles.length ? { exactProfiles: profiles } : {}),
  };
}
