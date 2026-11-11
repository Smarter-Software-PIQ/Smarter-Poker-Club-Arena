import { publicMemoryDomainKey } from '../HorsePublicMemoryDomain.js';
import { riverPublicNode } from '../HorseMultiwayRiverRead.js';
import { PooledPublicProfiles, type PooledPublicProfileReceipt } from './pooledPublicProfiles.js';
import { opponentMemoryKey } from '../HorseOpponentMemory.js';
import { observerParticipantsBind } from './observerParticipants.js';
import { ownPublicHistoryIsValid, type HorseOwnPublicHistoryPacket } from './ownPublicHistory.js';
import { completedHandActionsForMind } from './completedHandActions.js';
import { HorseMind, type HorseMindSandbox } from '../HorseMind.js';
import {
  horseCompletedHandKey,
  anchorHorseDecisionHand,
  horseHandAnchorKey,
} from '../HorseDecisionHandBinding.js';
import {
  horseObserverReadContextFromRequest,
  horseObserverReadContextKey,
  type HorseObserverReadContext,
} from '../HorseObserverReadContext.js';
import {
  createWinnerReadState,
  observeHandResults,
  winnerReadScopeOf,
  type HorseWinnerReadState,
} from '../HorseWinnerRead.js';
import type { FlopStabCounters } from '../HorseOpponentExploit.js';
import type { FastHorseDecisionRequest, ObserveCompletedHandRequest } from './protocol.js';

export interface HorseObserverReadReceipt {
  readonly version: 1 | 2 | 3;
  readonly individualVersion?: 1 | 2;
  readonly pooledPublicProfiles?: PooledPublicProfileReceipt;
  readonly disposition:
    | 'independent'
    | 'pooled_public'
    | 'unknown_context'
    | 'unknown_hand'
    | 'cutoff_unavailable'
    | 'capacity_reset'
    | 'history_unavailable';
  readonly context: HorseObserverReadContext | null;
  readonly cutoffMs: number;
  readonly learnedThroughMs: number;
  readonly history: 'volatile_only' | 'own_public_window';
  readonly historyDigest?: string;
  readonly historyAvailableAtMs?: number;
  readonly historyHands?: number;
  readonly historyCapped?: boolean;
}
type Entry = {
  readonly context: HorseObserverReadContext;
  state: HorseMindSandbox;
  observedAt: number;
  /** Last time this horse actually decided through this entry (run), ms. */
  lastRunAtMs: number;
  historyPhase?: 'pending' | 'loaded' | 'unavailable';
  historyError?: boolean;
  history?: { digest: string; availableAtMs: number; hands: number; capped: boolean };
  historyAckDigest?: string;
  completedHandIds?: Set<string>;
  pendingCompletions?: ObserveCompletedHandRequest[];
  historyTailCapped?: boolean;
};
/** Individual memory with owner-authorized public aggregate notes.
 * Pooled notes carry separate provenance and are never labelled independent. A missing
 * original participation coordinate is an empty read, never another observer. */
export class HorseObserverReads {
  private readonly publicProfiles: PooledPublicProfiles;
  private floorBootstrap: {
    availableAtMs: number;
    winnerReads: HorseWinnerReadState;
    flopStab: Map<string, FlopStabCounters>;
  } | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly sharedWinnerBanks = new Map<
    string,
    { state: HorseWinnerReadState; observedAt: number }
  >();
  private readonly completed = new Set<string>();
  private readonly hands = new Map<
    string,
    { signature: string; entries: Set<Entry>; conflict: boolean }
  >();
  private readonly requests = new WeakMap<
    FastHorseDecisionRequest,
    {
      state: HorseMindSandbox;
      boundary: { observedAt: number };
      receipt: HorseObserverReadReceipt;
      historyAckDigest: string | null;
    }
  >();
  /**
   * OBSERVER MEMORY IS BOUNDED BY USE, NOT BY ARRIVAL (2026-11-05).
   *
   * Production, engine 71087373 at 4.7 hours: the eight decision workers held
   * 583 to 937 MB of old space each (5.4 GB together), rising about 90 MB per
   * worker per hour with no plateau, while a 6-minute allocation sampling
   * profile showed the live-hand code retaining almost nothing. The growth
   * was this map. Every shard learns every completed hand on the floor into
   * every existing entry named by the hand's observer participants, and until
   * now:
   *
   *   1. the per-entry capacity caps were checked only in run(), so an entry
   *      whose horse stopped deciding on this shard (moved tables, changed
   *      dealt count, sat out, or was routed to another shard) kept learning
   *      through complete() with no cap at all - up to the live-mind caps of
   *      60k seen actions, 20k hand flags and 20k pairs, 10 MB and more each;
   *   2. eviction was first-in first-out by creation, never by use, so those
   *      departed entries were the ones that stayed longest;
   *   3. 2048 such entries per worker is exactly the 600 to 900 MB measured.
   *
   * Now an entry that has not decided a hand for `idleMs` (default 20 minutes,
   * longer than any tournament break or seat move) stops learning and is
   * evicted; complete() enforces the same capacity reset run() does; and the
   * map is least-recently-run, so pressure evicts the horse that stopped
   * deciding first. A horse that returns simply starts a fresh entry, which is
   * what it did after every eviction before.
   */
  static readonly DEFAULT_IDLE_MS = 20 * 60 * 1000;
  private completionsSinceSweep = 0;
  constructor(
    private readonly maxEntries = 2048,
    private readonly maxHands = 4096,
    private readonly now: () => number = Date.now,
    private readonly idleMs = HorseObserverReads.DEFAULT_IDLE_MS
  ) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(maxHands) ||
      maxHands < 1 ||
      !Number.isSafeInteger(idleMs) ||
      idleMs < 1
    )
      throw Error('Invalid observer memory bounds');
    this.publicProfiles = new PooledPublicProfiles(now);
  }
  /** Entries resident on this shard; diagnostics only. */
  size(): number {
    return this.entries.size;
  }
  private idle(entry: Entry, at: number): boolean {
    return at - entry.lastRunAtMs > this.idleMs;
  }
  /** Unlink evicted entries from every hand record in ONE pass over hands.
   *
   * SINGLE-PASS EVICTION (2026-11-06). Eviction used to walk every hand
   * record once PER evicted entry, so a sweep after boot or a break could run
   * up to maxEntries x maxHands (2048 x 4096) Set deletes inside a decision
   * worker on the hot path. Callers collect what they evict and unlink it here
   * once: O(hands + evicted). */
  private unlinkFromHands(evicted: ReadonlySet<Entry>): void {
    if (!evicted.size) return;
    for (const hand of this.hands.values()) {
      if (hand.entries.size <= evicted.size) {
        for (const entry of hand.entries) if (evicted.has(entry)) hand.entries.delete(entry);
      } else for (const entry of evicted) hand.entries.delete(entry);
    }
  }
  private static winnerBankKey(context: HorseObserverReadContext): string {
    return JSON.stringify([
      context.version,
      context.observerId,
      context.variant,
      context.format,
      ...(context.version === 2 ? [publicMemoryDomainKey(context.publicMemoryDomain)] : []),
    ]);
  }
  private winnerBankFor(context: HorseObserverReadContext): {
    state: HorseWinnerReadState;
    observedAt: number;
  } {
    const key = HorseObserverReads.winnerBankKey(context);
    let bank = this.sharedWinnerBanks.get(key);
    if (!bank) {
      bank = { state: createWinnerReadState(), observedAt: 0 };
      this.sharedWinnerBanks.set(key, bank);
    }
    return bank;
  }
  private pruneOrphanWinnerBanks(): void {
    if (this.sharedWinnerBanks.size === 0) return;
    const active = new Set<string>();
    for (const entry of this.entries.values()) {
      active.add(HorseObserverReads.winnerBankKey(entry.context));
    }
    for (const key of this.sharedWinnerBanks.keys()) {
      if (!active.has(key)) this.sharedWinnerBanks.delete(key);
    }
  }
  /** Drop every entry that has not decided within idleMs. O(entries + hands),
   * run at most once per 64 completions so the floor's hand rate never makes
   * it quadratic. Returns the number evicted. */
  sweepIdle(at: number = this.now()): number {
    const evicted = new Set<Entry>();
    for (const [key, entry] of this.entries) {
      if (!this.idle(entry, at)) continue;
      this.entries.delete(key);
      evicted.add(entry);
    }
    this.unlinkFromHands(evicted);
    if (evicted.size > 0) this.pruneOrphanWinnerBanks();
    return evicted.size;
  }
  private static overCapacity(entry: Entry | { state: HorseMindSandbox }): boolean {
    const historyEntry = 'context' in entry ? (entry as Entry) : null;
    return (
      entry.state.stats.size > 512 ||
      entry.state.seenActions.size > 8192 ||
      entry.state.handFlags.size > 8192 ||
      entry.state.pairs.size > 2048 ||
      entry.state.scoped.size > 1024 ||
      (entry.state.exploit?.size ?? 0) > 1024 ||
      (entry.state.flopStab?.size ?? 0) > 1024 ||
      entry.state.plans.size > 2048 ||
      entry.state.raisePlans.size > 2048 ||
      entry.state.outlooks.size > 2048 ||
      (entry.state.winnerReads?.rows.size ?? 0) > 512 ||
      (entry.state.winnerReads?.seen.size ?? 0) > 8192 ||
      (historyEntry?.completedHandIds?.size ?? 0) > 4096
    );
  }
  private static capacityReset(
    entry: Entry | { state: HorseMindSandbox; observedAt: number },
    winnerBank?: { state: HorseWinnerReadState; observedAt: number }
  ): void {
    const sharedWinner = entry.state.winnerReads;
    if (sharedWinner) {
      sharedWinner.rows.clear();
      sharedWinner.seen.clear();
    }
    if (winnerBank) winnerBank.observedAt = 0;
    entry.state = HorseMind.createSandbox();
    if (sharedWinner && 'context' in entry && entry.context) {
      entry.state.winnerReads = sharedWinner;
    }
    entry.observedAt = 0;
    if ('context' in entry) {
      const historyEntry = entry as Entry;
      historyEntry.history = undefined;
      historyEntry.historyPhase = undefined;
      historyEntry.historyAckDigest = undefined;
      historyEntry.historyError = false;
      historyEntry.historyTailCapped = false;
      historyEntry.completedHandIds = new Set();
      historyEntry.pendingCompletions = [];
    }
  }
  bootstrapPublicProfiles(snapshot: {
    availableAtMs: number;
    profiles: import('../HorseOpponentMemory.js').DurableOpponentProfile[];
  }): boolean {
    return this.publicProfiles.bootstrap(snapshot);
  }
  bootstrapFloorExploitReads(snapshot: {
    availableAtMs?: number;
    winnerReads?: HorseWinnerReadState;
    flopStab?: Map<string, FlopStabCounters>;
  }): boolean {
    if (
      !snapshot ||
      typeof snapshot.availableAtMs !== 'number' ||
      !Number.isFinite(snapshot.availableAtMs) ||
      snapshot.availableAtMs < 0
    ) {
      return false;
    }
    const wr = createWinnerReadState();
    if (snapshot.winnerReads?.rows) {
      for (const [k, row] of snapshot.winnerReads.rows) {
        if (row && Number.isFinite(row.w) && row.w > 0) wr.rows.set(k, { ...row });
      }
    }
    const fs = new Map<string, FlopStabCounters>();
    if (snapshot.flopStab) {
      for (const [k, row] of snapshot.flopStab) {
        if (row && Number.isFinite(row.flopCheckedToOpps) && row.flopCheckedToOpps > 0)
          fs.set(k, { ...row });
      }
    }
    this.floorBootstrap = {
      availableAtMs: snapshot.availableAtMs,
      winnerReads: wr,
      flopStab: fs,
    };
    return true;
  }
  private scope(context: HorseObserverReadContext): import('../HorseMind.js').ReadScope {
    const size = context.dealtCount <= 2 ? 'hu' : context.dealtCount <= 5 ? 'short' : 'full';
    return `${context.variant.startsWith('plo') || context.variant === 'flo8' ? 'omaha' : context.variant === 'short_deck' ? 'sixplus' : 'holdem'}:${size}`;
  }
  private learnPublic(
    entry: Entry,
    state: HorseMindSandbox,
    hand: ObserveCompletedHandRequest
  ): void {
    HorseMind.runInSandbox(state, () => {
      const scope = this.scope(entry.context);
      const mode = entry.context.format === 'cash' ? 'cash' : 'tournament';
      HorseMind.setDecisionScope(scope, entry.context.variant, mode);
      const actions = completedHandActionsForMind(hand.actions, scope);
      const parts = hand.handKey.split(':');
      if (actions)
        HorseMind.observe(
          actions.actions,
          [],
          {
            version: 1,
            tableId: parts[0]!,
            handNumber: Number(parts[1]),
          },
          entry.context.dealtCount,
          hand.bigBlind
        );
      HorseMind.observeHandComplete(
        hand.handKey,
        hand.actions,
        hand.bigBlind,
        hand.showdown,
        scope,
        false,
        hand.riverCallContext,
        hand.retainedRiverCalls
      );
      observeHandResults(
        hand.handKey,
        hand.results,
        hand.bigBlind,
        winnerReadScopeOf(entry.context.variant, mode),
        hand.committedHandId ? [hand.committedHandId.toLowerCase()] : undefined
      );
    });
  }
  /** Keep only public learning fields. No accepted roster, donor packet,
   * private cards or policy/financial authority is copied. Only the first four
   * explicitly projected public river structural snapshots may accompany actions. */
  private publicCopy(hand: ObserveCompletedHandRequest): ObserveCompletedHandRequest {
    let riverCount = 0;
    return {
      type: 'OBSERVE_COMPLETED_HAND',
      requestId: hand.requestId,
      generation: hand.generation,
      fence: hand.fence,
      handKey: hand.handKey,
      committedHandId: hand.committedHandId,
      bigBlind: hand.bigBlind,
      riverCallContext: hand.riverCallContext ? { ...hand.riverCallContext } : undefined,
      retainedRiverCalls: hand.retainedRiverCalls?.map((s) => ({ ...s })),
      scope: hand.scope,
      actions: hand.actions?.map((a) => {
        const publicNode =
          a.stage === 'river' && riverCount++ < 4 ? riverPublicNode(a.publicNode, true) : null;
        return {
          seat: a.seat,
          userId: a.userId,
          action: a.action,
          amount: a.amount,
          stage: a.stage,
          timestamp: a.timestamp,
          ...(a.origin === 'forced' ||
          (a.action === 'fold' &&
            (a.origin === 'player' ||
              a.origin === 'pre_action' ||
              a.origin === 'horse_policy' ||
              a.origin === 'unknown' ||
              a.origin === 'horse_fallback'))
            ? { origin: a.origin }
            : {}),
          ...(a.isFullRaise === undefined ? {} : { isFullRaise: a.isFullRaise }),
          ...(publicNode ? { publicNode } : {}),
        };
      }),
      results: hand.results?.map((r) => ({ user_id: r.user_id, net: r.net })),
      showdown:
        hand.showdown?.map((r) => ({
          user_id: r.user_id,
          mucked: r.mucked,
          ...(r.hand_name === undefined ? {} : { hand_name: r.hand_name }),
        })) ?? null,
    };
  }
  private mergeObservations(target: HorseMindSandbox, staged: HorseMindSandbox): void {
    const sharedWinner = target.winnerReads;
    Object.assign(target, {
      stats: staged.stats,
      seenActions: staged.seenActions,
      handFlags: staged.handFlags,
      dirty: staged.dirty,
      pairs: staged.pairs,
      dirtyPairs: staged.dirtyPairs,
      scoped: staged.scoped,
      dirtyScoped: staged.dirtyScoped,
      exploit: staged.exploit,
      flopStab: staged.flopStab,
    });
    if (sharedWinner && staged.winnerReads && sharedWinner !== staged.winnerReads) {
      sharedWinner.rows.clear();
      for (const [k, v] of staged.winnerReads.rows) sharedWinner.rows.set(k, v);
      sharedWinner.seen.clear();
      for (const s of staged.winnerReads.seen) sharedWinner.seen.add(s);
    } else {
      target.winnerReads = staged.winnerReads;
    }
  }
  private flushPending(entry: Entry): void {
    try {
      const staged = structuredClone(entry.state);
      for (const hand of entry.pendingCompletions ?? []) this.learnPublic(entry, staged, hand);
      this.mergeObservations(entry.state, staged);
    } catch {
      entry.historyError = true;
    }
  }
  private hydrate(entry: Entry, packet: HorseOwnPublicHistoryPacket): void {
    entry.historyAckDigest = packet.digest; // acknowledgement is not a loaded-history claim
    if (
      entry.historyPhase === 'loaded' ||
      !ownPublicHistoryIsValid(packet, entry.context, packet.availableAtMs)
    )
      return;
    // Pending turns retain plans in the real entry, but observe into temporary
    // views. Historical observations therefore precede live tails, and no
    // already-counted recent hand is reclassified as older data arriving last.
    // Rebuild observations in chronological order after a failed initial load.
    // Plans remain on the original state; only public observation fields merge.
    const staged = HorseMind.createSandbox();
    if (entry.state.winnerReads) {
      staged.winnerReads = structuredClone(entry.state.winnerReads);
    }
    const ids = new Set<string>();
    const observations: Array<{ at: number; hand: ObserveCompletedHandRequest }> = [];
    const pending = new Map(
      (entry.pendingCompletions ?? []).map((hand) => [hand.committedHandId!.toLowerCase(), hand])
    );
    for (const h of packet.hands) {
      ids.add(h.handId);
      const live = pending.get(h.handId);
      // Preserve the original bound live showdown evidence at its historical
      // position; optional history categories can contain less information.
      if (live?.handKey === `${h.tableId}:${h.handNumber}`) {
        observations.push({ at: h.playedAtMs, hand: live });
        continue;
      }
      observations.push({
        at: h.playedAtMs,
        hand: {
          type: 'OBSERVE_COMPLETED_HAND',
          requestId: 0,
          generation: h.handNumber,
          // Historical learning has no current lease or plan authority.
          fence: '',
          handKey: `${h.tableId}:${h.handNumber}`,
          committedHandId: h.handId,
          bigBlind: h.bigBlind,
          actions: h.actions,
          results: h.results ?? undefined,
          showdown: null,
          ...(h.riverCalls === undefined
            ? {}
            : {
                riverCallContext: { variant: h.variant, boardCount: 1 },
                retainedRiverCalls: h.riverCalls,
              }),
        },
      });
    }
    for (const hand of entry.pendingCompletions ?? []) {
      if (!ids.has(hand.committedHandId!))
        observations.push({
          at: Math.max(0, ...(hand.actions ?? []).map((a) => a.timestamp ?? 0)),
          hand,
        });
      ids.add(hand.committedHandId!);
    }
    observations.sort(
      (a, b) => a.at - b.at || a.hand.committedHandId!.localeCompare(b.hand.committedHandId!)
    );
    for (const { hand } of observations) this.learnPublic(entry, staged, hand);
    if (
      staged.stats.size > 512 ||
      staged.seenActions.size > 8192 ||
      staged.handFlags.size > 8192 ||
      staged.pairs.size > 2048 ||
      staged.scoped.size > 1024 ||
      staged.exploit.size > 1024 ||
      (staged.flopStab?.size ?? 0) > 1024 ||
      (staged.winnerReads?.rows.size ?? 0) > 512 ||
      (staged.winnerReads?.seen.size ?? 0) > 8192
    ) {
      if (entry.historyPhase === 'pending') this.flushPending(entry);
      entry.historyPhase = 'unavailable';
      return;
    }
    // Preserve the object and plan maps held by earlier issued requests.
    this.mergeObservations(entry.state, staged);
    entry.completedHandIds = ids;
    entry.pendingCompletions = [];
    entry.historyPhase = 'loaded';
    entry.historyError = false;
    entry.history = {
      digest: packet.digest,
      availableAtMs: packet.availableAtMs,
      hands: packet.hands.length,
      capped: packet.capped || entry.historyTailCapped === true,
    };
    entry.observedAt = Math.max(entry.observedAt, packet.availableAtMs);
    const wb = this.sharedWinnerBanks.get(HorseObserverReads.winnerBankKey(entry.context));
    if (wb) wb.observedAt = Math.max(wb.observedAt, packet.availableAtMs);
  }
  private entry(context: HorseObserverReadContext): Entry {
    const key = horseObserverReadContextKey(context)!;
    const at = this.now();
    let entry = this.entries.get(key);
    if (entry && this.idle(entry, at)) {
      // The horse is back after a long absence: its bank learned the floor
      // without it for longer than idleMs and starts fresh, as an evicted
      // entry always has.
      this.entries.delete(key);
      this.unlinkFromHands(new Set([entry]));
      this.pruneOrphanWinnerBanks();
      entry = undefined;
    }
    if (!entry) {
      const state = HorseMind.createSandbox();
      state.winnerReads = this.winnerBankFor(context).state;
      entry = {
        context: Object.freeze({ ...context }),
        state,
        observedAt: 0,
        lastRunAtMs: at,
      };
      if (this.entries.size >= this.maxEntries) {
        if (this.sweepIdle(at) === 0) {
          // Pressure eviction of the least recently run entry unlinks it from
          // the hand records too, so no evicted bank stays reachable.
          const [lruKey, lru] = this.entries.entries().next().value!;
          this.entries.delete(lruKey);
          this.unlinkFromHands(new Set([lru]));
          this.pruneOrphanWinnerBanks();
        }
      }
      this.entries.set(key, entry);
    } else {
      // Least-recently-RUN order: a decision moves its entry to the tail.
      entry.lastRunAtMs = at;
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }
  run<T>(request: FastHorseDecisionRequest, fn: () => T): T {
    const context = horseObserverReadContextFromRequest(request);
    const anchor = anchorHorseDecisionHand(request);
    let entry =
      context && anchor.status === 'anchored'
        ? this.entry(context)
        : { context: null, state: HorseMind.createSandbox(), observedAt: 0 };
    if ('observedAt' in entry && entry.observedAt > request.decisionTimeMs)
      entry = { context: null, state: HorseMind.createSandbox(), observedAt: 0 };
    let disposition: HorseObserverReadReceipt['disposition'] = !context
      ? 'unknown_context'
      : anchor.status !== 'anchored'
        ? 'unknown_hand'
        : entry.context
          ? 'independent'
          : 'cutoff_unavailable';
    const historyEntry = entry.context ? (entry as Entry) : null;
    const winnerBank = entry.context
      ? this.sharedWinnerBanks.get(HorseObserverReads.winnerBankKey(entry.context))
      : undefined;
    // Reset an entire over-capacity individual view; never retain counters
    // while losing the dedupe keys that made those counters meaningful.
    if (HorseObserverReads.overCapacity(entry)) {
      HorseObserverReads.capacityReset(entry, winnerBank);
      disposition = 'capacity_reset';
    }
    if (historyEntry) {
      if (historyEntry.historyPhase === undefined) {
        const empty =
          historyEntry.state.stats.size === 0 && historyEntry.state.handFlags.size === 0;
        historyEntry.historyPhase =
          request.ownPublicHistoryState && request.ownPublicHistoryState !== 'unavailable' && empty
            ? 'pending'
            : 'unavailable';
      }
      if (
        request.ownPublicHistoryState === 'unavailable' &&
        historyEntry.historyPhase === 'pending'
      ) {
        this.flushPending(historyEntry);
        historyEntry.historyPhase = 'unavailable';
      }
      if (
        request.ownPublicHistory &&
        ownPublicHistoryIsValid(
          request.ownPublicHistory,
          historyEntry.context,
          request.decisionTimeMs
        )
      ) {
        try {
          this.hydrate(historyEntry, request.ownPublicHistory);
        } catch {
          if (historyEntry.historyPhase === 'pending') this.flushPending(historyEntry);
          historyEntry.historyError = true;
          historyEntry.historyPhase = 'unavailable';
        }
      }
      if (historyEntry.historyError) disposition = 'history_unavailable';
    }
    const history = historyEntry?.history;
    const pooled = entry.context ? this.publicProfiles.read(request) : null;
    const winnerAfterCutoff = !!winnerBank && winnerBank.observedAt > request.decisionTimeMs;
    const floorBootEligible =
      pooled !== null &&
      this.floorBootstrap !== null &&
      this.floorBootstrap.availableAtMs <= request.decisionTimeMs &&
      (this.floorBootstrap.winnerReads.rows.size > 0 || this.floorBootstrap.flopStab.size > 0);
    // Public counters use a detached map. Individual observations, dedupe
    // and private plans retain this horse's original ownership.
    const executionState =
      pooled || winnerAfterCutoff
        ? {
            ...entry.state,
            ...(pooled
              ? {
                  exploit: new Map(entry.state.exploit),
                  ...(pooled.donors.length ? { donorStaleness: new Map<string, number>() } : {}),
                  ...(floorBootEligible ? { flopStab: new Map(entry.state.flopStab ?? []) } : {}),
                }
              : {}),
            ...(winnerAfterCutoff || floorBootEligible
              ? {
                  winnerReads: (() => {
                    const wr = createWinnerReadState();
                    if (!winnerAfterCutoff && entry.state.winnerReads?.rows) {
                      for (const [k, v] of entry.state.winnerReads.rows) wr.rows.set(k, { ...v });
                    }
                    return wr;
                  })(),
                }
              : {}),
          }
        : entry.state;
    if (pooled) {
      for (const row of pooled.rows)
        executionState.exploit!.set(
          opponentMemoryKey(row.user_id, row.variant, row.mode, row.size),
          { ...row.counters }
        );
      // The sibling table size of the same public-memory domain, for a thin
      // or missing exact row to borrow at its hand-clock staleness.
      for (const { profile: row, staleness } of pooled.donors) {
        const key = opponentMemoryKey(row.user_id, row.variant, row.mode, row.size);
        executionState.exploit!.set(key, { ...row.counters });
        executionState.donorStaleness!.set(key, staleness);
      }
      if (floorBootEligible && entry.context && this.floorBootstrap) {
        const authorizedIds = new Set<string>();
        for (const r of pooled.rows) authorizedIds.add(r.user_id);
        for (const d of pooled.donors) authorizedIds.add(d.profile.user_id);
        const scope = this.scope(entry.context);
        const mode = entry.context.format === 'cash' ? 'cash' : 'tournament';
        const wScope = winnerReadScopeOf(entry.context.variant, mode);
        for (const uid of authorizedIds) {
          const fKey = `${scope}|${uid}`;
          const bootFlop = this.floorBootstrap.flopStab.get(fKey);
          if (bootFlop) {
            const curFlop = executionState.flopStab?.get(fKey);
            if (
              !curFlop ||
              (curFlop.flopCheckedToOpps < 8 &&
                bootFlop.flopCheckedToOpps > curFlop.flopCheckedToOpps)
            ) {
              executionState.flopStab!.set(fKey, { ...bootFlop });
            }
          }
          const bootWinner =
            (wScope ? this.floorBootstrap.winnerReads.rows.get(`${wScope}|${uid}`) : undefined) ??
            (mode === 'cash' ? this.floorBootstrap.winnerReads.rows.get(uid) : undefined);
          if (bootWinner && executionState.winnerReads) {
            const wKey = wScope ? `${wScope}|${uid}` : uid;
            const curWinner = executionState.winnerReads.rows.get(wKey);
            if (!curWinner || (curWinner.w < 50 && bootWinner.w > curWinner.w)) {
              executionState.winnerReads.rows.set(wKey, { ...bootWinner });
              if (mode === 'cash') {
                const bareCur = executionState.winnerReads.rows.get(uid);
                if (!bareCur || (bareCur.w < 50 && bootWinner.w > bareCur.w)) {
                  executionState.winnerReads.rows.set(uid, { ...bootWinner });
                }
              }
            }
          }
        }
      }
    }
    this.requests.set(request, {
      state: executionState,
      boundary: entry,
      receipt: Object.freeze({
        version: pooled ? 3 : history ? 2 : 1,
        ...(pooled
          ? {
              individualVersion: history ? (2 as const) : (1 as const),
              pooledPublicProfiles: pooled.receipt,
            }
          : {}),
        disposition: pooled && disposition === 'independent' ? 'pooled_public' : disposition,
        context: entry.context,
        cutoffMs: request.decisionTimeMs,
        learnedThroughMs: entry.observedAt,
        history: history ? 'own_public_window' : 'volatile_only',
        ...(history
          ? {
              historyDigest: history.digest,
              historyAvailableAtMs: history.availableAtMs,
              historyHands: history.hands,
              historyCapped: history.capped,
            }
          : {}),
      }),
      historyAckDigest: historyEntry?.historyAckDigest ?? null,
    });
    if (entry.context && anchor.status === 'anchored') {
      const key = horseHandAnchorKey(anchor);
      if (!this.hands.has(key)) {
        if (this.hands.size >= this.maxHands) this.hands.delete(this.hands.keys().next().value!);
        this.hands.set(key, {
          signature: JSON.stringify([
            context!.variant,
            context!.format,
            context!.dealtCount,
            ...(context!.version === 2 ? [publicMemoryDomainKey(context!.publicMemoryDomain)] : []),
          ]),
          entries: new Set(),
          conflict: false,
        });
      }
      const hand = this.hands.get(key)!;
      if (
        hand.signature !==
        JSON.stringify([
          context!.variant,
          context!.format,
          context!.dealtCount,
          ...(context!.version === 2 ? [publicMemoryDomainKey(context!.publicMemoryDomain)] : []),
        ])
      )
        hand.conflict = true;
      if (hand.entries.size >= 10 && !hand.entries.has(entry as Entry)) hand.conflict = true;
      else hand.entries.add(entry as Entry);
    }
    try {
      if (historyEntry?.historyPhase === 'pending') {
        const temporary = structuredClone(executionState);
        for (const hand of historyEntry.pendingCompletions ?? [])
          this.learnPublic(historyEntry, temporary, hand);
        return HorseMind.runInSandbox(temporary, fn);
      }
      return HorseMind.runInSandbox(executionState, fn);
    } finally {
      entry.observedAt = Math.max(entry.observedAt, request.decisionTimeMs);
    }
  }
  receipt(request: FastHorseDecisionRequest): HorseObserverReadReceipt | null {
    return this.requests.get(request)?.receipt ?? null;
  }
  historyAcknowledgement(request: FastHorseDecisionRequest): string | null {
    return this.requests.get(request)?.historyAckDigest ?? null;
  }
  runIssued<T>(request: FastHorseDecisionRequest | null, fn: () => T): T {
    const entry = request ? this.requests.get(request) : undefined;
    if (!entry) throw Error('Original independent observer view unavailable');
    try {
      return HorseMind.runInSandbox(entry.state, fn);
    } finally {
      entry.boundary.observedAt = Math.max(entry.boundary.observedAt, this.now());
    }
  }
  runContext<T>(context: HorseObserverReadContext, fn: () => T): T {
    if (!horseObserverReadContextKey(context)) throw Error('Invalid independent observer context');
    const entry = this.entry(context);
    try {
      return HorseMind.runInSandbox(entry.state, fn);
    } finally {
      entry.observedAt = Math.max(entry.observedAt, this.now());
    }
  }
  complete(
    request: ObserveCompletedHandRequest,
    observe: (request: ObserveCompletedHandRequest) => void
  ): number {
    const key = horseCompletedHandKey(request);
    if (
      !key ||
      typeof request.committedHandId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        request.committedHandId
      )
    )
      return 0;
    if (this.completed.has(key)) return 0;
    const entries = this.hands.get(key);
    if (entries?.conflict) return 0;
    const pooledLearned = this.publicProfiles.observe(request);
    const targets = new Set<Entry>();
    if (request.observerParticipants !== undefined) {
      if (
        !observerParticipantsBind(request.observerParticipants, request) ||
        request.observerParticipants.status !== 'bound'
      )
        return 0;
      for (const context of request.observerParticipants.contexts) {
        const entry = this.entries.get(horseObserverReadContextKey(context)!);
        if (entry) targets.add(entry); // no creation of floor-wide observer banks
      }
    } else if (entries) for (const entry of entries.entries) targets.add(entry);
    if (!targets.size) return pooledLearned;
    this.hands.delete(key);
    if (this.completed.size >= this.maxHands)
      this.completed.delete(this.completed.values().next().value!);
    this.completed.add(key);
    const at = this.now();
    if (++this.completionsSinceSweep >= 64) {
      this.completionsSinceSweep = 0;
      this.sweepIdle(at);
    }
    let learned = 0;
    const idleEvicted = new Set<Entry>();
    for (const entry of targets) {
      if (this.idle(entry, at)) {
        // A bank whose horse has not decided here for idleMs does not keep
        // learning the floor; it leaves, and is unlinked from every hand
        // record (one pass, after the loop) so no hand can reach it again.
        const idleKey = horseObserverReadContextKey(entry.context)!;
        if (this.entries.get(idleKey) === entry) this.entries.delete(idleKey);
        idleEvicted.add(entry);
        continue;
      }
      const id = request.committedHandId.toLowerCase();
      if (entry.completedHandIds?.has(id)) continue;
      (entry.completedHandIds ??= new Set()).add(id);
      if (entry.historyPhase !== 'loaded') {
        const tail = this.publicCopy(request);
        (entry.pendingCompletions ??= []).push(tail);
        const wasPending = entry.historyPhase === 'pending';
        if (
          entry.pendingCompletions.length > 64 ||
          Buffer.byteLength(JSON.stringify(entry.pendingCompletions)) > 256 * 1024
        ) {
          if (entry.historyPhase === 'pending') this.flushPending(entry);
          entry.historyPhase = 'unavailable';
          while (
            entry.pendingCompletions.length > 64 ||
            Buffer.byteLength(JSON.stringify(entry.pendingCompletions)) > 256 * 1024
          )
            entry.pendingCompletions.shift();
          entry.historyTailCapped = true;
        }
        if (wasPending) {
          entry.observedAt = Math.max(entry.observedAt, this.now());
          learned++;
          continue;
        }
      }
      HorseMind.runInSandbox(entry.state, () => {
        const mode = entry.context.format === 'cash' ? 'cash' : 'tournament';
        const size =
          entry.context.dealtCount <= 2 ? 'hu' : entry.context.dealtCount <= 5 ? 'short' : 'full';
        HorseMind.setDecisionScope(
          `${entry.context.variant.startsWith('plo') || entry.context.variant === 'flo8' ? 'omaha' : entry.context.variant === 'short_deck' ? 'sixplus' : 'holdem'}:${size}`,
          entry.context.variant,
          mode
        );
        observeHandResults(
          request.handKey,
          request.results,
          request.bigBlind,
          winnerReadScopeOf(entry.context.variant, mode),
          [id]
        );
        entry.observedAt = Math.max(entry.observedAt, this.now());
        const wb = this.sharedWinnerBanks.get(HorseObserverReads.winnerBankKey(entry.context));
        if (wb) wb.observedAt = Math.max(wb.observedAt, entry.observedAt);
        const independent = { ...request, scope: HorseMind.currentScope() };
        delete independent.durableOpponentProfiles;
        observe(independent);
        learned++;
      });
      // The same cap run() applies, applied where the growth actually
      // happens. Before this, only a decision could trigger the reset, so an
      // entry that only ever completed grew without bound.
      if (HorseObserverReads.overCapacity(entry)) {
        const wb = this.sharedWinnerBanks.get(HorseObserverReads.winnerBankKey(entry.context));
        HorseObserverReads.capacityReset(entry, wb);
      }
    }
    this.unlinkFromHands(idleEvicted);
    if (idleEvicted.size > 0) this.pruneOrphanWinnerBanks();
    return learned + pooledLearned;
  }
  clear(): void {
    this.publicProfiles.clear();
    this.floorBootstrap = null;
    this.entries.clear();
    this.sharedWinnerBanks.clear();
    this.hands.clear();
    this.completed.clear();
  }
}
