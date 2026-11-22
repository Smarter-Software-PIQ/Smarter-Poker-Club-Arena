/**
 * OPPONENT HUD STORE (2026-11-20, PLO-OWNER lane OPPONENT-HUD): the engine main thread's warm shared memory of every
 * opponent's lifetime public profile (engine/opponentHud/OpponentHudProfile.ts).
 *
 * Owner 3:20 PM Chicago Nov 20: "ALL HORSES SHOULD START THIS AS SOON AS A PLAYER JOINS A TABLE, FOR LIGHTNING GAMES
 * AS WELL ... AS WELL AS WHEN THEY MOVE TABLES ... THIS ALL NEEDS TO HAPPEN IN THE FIRST 15 SECONDS". So profiles are
 * loaded by EVENT, ahead of any decision: a player seated at a PLO4/PLO5 cash table (warmHud 'sit'), every dealt
 * player at each hand start (table and Lightning: a Lightning hand is a new table every hand), and at engine boot the
 * profiles updated in the last HUD_BOOT_WINDOW_MS (prewarm). A decision never waits for the database: it takes what is
 * warm (packetFor) and the decision proceeds on the population prior for an opponent that is not.
 *
 * One shared memory for every Horse: the cache is keyed by player and family, not by table or Horse, and every
 * accepted PLO4/PLO5 cash hand is applied to the profiles of everyone dealt in (onAcceptedHand), so a hand any Horse
 * played against him counts for all of them. Persons and Horses are loaded, updated and served identically (nothing
 * here reads a kind flag).
 *
 * Hardening ("SO THEY NEVER BREAK, REGRESS OR MAKE MISTAKES"):
 * - nothing here throws to a caller and nothing blocks one: every database call is bounded (HUD_DB_TIMEOUT_MS), runs
 *   behind the caller and failures are counted (opponent_hud_load_failed / _persist_failed) and retried after a
 *   cool-down;
 * - a hand is applied exactly once, in any order (OpponentHudProfile.applyHudHand: the hand id is the idempotency key,
 *   held in the id ring and the day lists); a load that succeeds after the ring of recent hands has moved past the
 *   time the player was first asked for is followed by a hand_history catch-up from that time (loadGapCatchUp), so an
 *   outage longer than the ring loses no hand; the nightly job only VERIFIES (rebuild from raw rows and compare: it
 *   never writes a count; any difference raises OpponentHudDrift); a profile that failed to
 *   load is never updated (so a partial profile can never be written over the lifetime row); the database upsert
 *   refuses any row with fewer hands or an older watermark than the stored one, and a refused profile is reloaded;
 * - hands accepted while a profile loads are kept in a bounded ring (HUD_RING_MS) and applied to it once it arrives;
 * - the cache is bounded (HUD_CACHE_MAX profiles, least recently used evicted after persisting);
 * - stored rows carry the profile version: a row of another version is ignored (rebuilt by the backfill).
 */
import {
  HUD_FAMILIES,
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  familyForVariant,
  handRecordFromRow,
  hudDayOf,
  hudHandDigest,
  hudIdPrefix,
  hudProfileBytesBound,
  isHudFamily,
  validHudProfile,
  type HudFamily,
  type HudHandRecord,
  type HudStreet,
  type OpponentHudProfile,
} from '../engine/opponentHud/OpponentHudProfile.js';
import {
  OPPONENT_HUD_OPTION,
  buildHudPacket,
  buildHudPacketOpponent,
  type HudPacketOpponent,
  type HudPriors,
  type HudPopulation,
  parseHudPopulation,
  priorsForStake,
  type OpponentHudPacket,
} from '../engine/opponentHud/OpponentHud.js';
import { noteFire } from '../engine/BrainTelemetry.js';
import { optionSwitchDecisionOpts, parseOptionSwitchConfig } from '../engine/HorseOptionSwitch.js';

export const HUD_DB_TIMEOUT_MS = 2_000;
export const HUD_RETRY_MS = 15_000;
/**
 * AUDIT-C item 4 (OPPONENT-HUD-FIX-1): a failed or timed-out load is retried on its own timer at these delays (from
 * the failure), so one slow read cannot push readiness past HUD_READY_DEADLINE_MS: even three consecutive 2-second
 * timeouts leave the fourth read inside 15 seconds (2 + 0.5 + 2 + 1.5 + 2 + 3 + 2 = 13 s). Past the schedule the
 * cool-down is HUD_RETRY_MS and the next seat, hand or decision event retries, as before.
 */
export const HUD_RETRY_SCHEDULE_MS: readonly number[] = [500, 1_500, 3_000];
export const HUD_CACHE_MAX = 6_000;
export const HUD_RING_MS = 45 * 60 * 1000;
export const HUD_RING_MAX = 20_000;
/** a load-gap catch-up starts this long before the time the player was first asked for */
export const HUD_LATE_WINDOW_SLACK_MS = 5 * 60_000;
/** a profile is a few tens of KB of JSON: it is written at most every 30 minutes (and caught up from hand_history at
 *  boot, HUD_BOOT_CATCHUP_MS), so the write volume stays small and a restart loses nothing */
export const HUD_PERSIST_MS = 30 * 60_000;
/** A clean cached profile older than this is re-read on its next seat or hand event (the bound on how long one engine
 *  process can serve a profile without the hands another process saved). */
export const HUD_REFRESH_MS = 30 * 60_000;
/** Rows per save call (each row is copied when the call is made, so a hand arriving mid-save is never half-sent). */
export const HUD_PERSIST_BATCH = 25;
/** ... and at most this many bytes of profiles per save call, by hudProfileBytesBound (a busy Horse's three day lists
 *  make his row several times the median). */
export const HUD_PERSIST_BATCH_BYTES = 1_500_000;
/** A refused save is merged onto the stored row and retried this many times inside the same persistence. */
export const HUD_PERSIST_MERGE_ROUNDS = 3;
export const HUD_BOOT_CATCHUP_MS = 45 * 60_000;
export const HUD_BOOT_WINDOW_MS = 6 * 3600 * 1000;
export const HUD_READY_DEADLINE_MS = 15_000;
/** the stored row whose watermark is the sync point (user id not a uuid; never a profile) */
export const HUD_SYNC_ROW = '#sync';
/** switching on more than this long after the last sync point catches up only this much and asks for a backfill */
export const HUD_ACTIVATION_MAX_CATCHUP_MS = 48 * 3600_000;
/**
 * Switch-on catch-up rate limit (VERIFIER 01:45Z / lead 01:50Z): the catch-up reads at most HUD_CATCHUP_PAGE_ROWS hand
 * rows per page and pauses HUD_CATCHUP_PAUSE_MS between pages; a page slower than HUD_CATCHUP_SLOW_MS doubles the pause
 * (up to HUD_CATCHUP_MAX_PAUSE_MS), a fast page halves it back. Seated players come first: while a seat/hand warm load
 * is in flight the catch-up waits (bounded) before its next read. Applying yields the event loop every
 * HUD_CATCHUP_APPLY_SLICE hands, so a decision's packet is never queued behind it.
 */
export const HUD_CATCHUP_PAGE_ROWS = 250;
export const HUD_CATCHUP_PAUSE_MS = 200;
export const HUD_CATCHUP_SLOW_MS = 1_000;
export const HUD_CATCHUP_MAX_PAUSE_MS = 10_000;
export const HUD_CATCHUP_APPLY_SLICE = 50;
export const HUD_CATCHUP_SEAT_WAIT_MS = 4_000;
export const HUD_SCHEMA_MISSING = 'opponent hud schema missing';

export type HudAlertName =
  | 'OpponentHudLoadFailing'
  | 'OpponentHudProfileLate'
  | 'OpponentHudPersistFailing'
  | 'OpponentHudDrift'
  | 'OpponentHudSyncHeld';
/** load failures (timeouts and errors) in one alert window that raise OpponentHudLoadFailing */
export const HUD_ALERT_LOAD_FAILURES = 5;
export const HUD_ALERT_WINDOW_MS = 5 * 60_000;
/** the nightly reconciliation runs for the previous Chicago day from this Chicago hour */
export const HUD_RECONCILE_HOUR = 4;
export const HUD_RECONCILE_MINUTE = 40;

export type HudEvent = 'sit' | 'move' | 'lightning' | 'boot' | 'hand' | 'decision';
const EVENTS: readonly HudEvent[] = ['sit', 'move', 'lightning', 'boot', 'hand', 'decision'];

export interface HudStoredRow {
  user_id: string;
  family: string;
  version: number;
  hands: number;
  wm_ms: number;
  /** the row revision (opponent_hud_profiles.rev): a save names the revision it was built on and is refused when the
   *  stored row has moved (another engine process or the backfill wrote it) */
  rev?: number;
  profile: unknown;
}
export interface OpponentHudStoreDeps {
  read(userIds: string[], family: HudFamily, signal: AbortSignal): Promise<HudStoredRow[]>;
  recent(
    family: HudFamily,
    sinceIso: string,
    afterUser: string | null,
    limit: number,
    signal: AbortSignal
  ): Promise<HudStoredRow[]>;
  upsert(rows: object[], signal: AbortSignal): Promise<string[]>;
  /** public-fields hand rows after (afterAt, afterId), oldest first (fn_opponent_hud_hands_page); optional */
  handsPage?(
    afterAt: string,
    afterId: string,
    limit: number,
    signal: AbortSignal,
    untilIso?: string
  ): Promise<{ id: string; created_at: string }[]>;
  /** Production Alerts (engine_alerts -> operational_alert_events; never a phone page): raise or resolve one named
   *  condition. Optional; absent, conditions are counted only. */
  alert?(name: HudAlertName, firing: boolean, summary: string): void;
  now(): number;
  warn?(message: string): void;
  /** pause used by the catch-up rate limit (tests inject a recorder); absent, a real unref'd timer */
  sleep?(ms: number): Promise<void>;
  /** run `fn` after `ms` (the load retry schedule; tests inject a recorder); absent, a real unref'd timer */
  schedule?(ms: number, fn: () => void): void;
}

type Entry =
  | {
      state: 'ready';
      profile: OpponentHudProfile;
      dirty: boolean;
      since: number;
      /** revision of the stored row this profile was built on (0: no stored row) */
      rev: number;
      /** bumped on every change, so a save that was in flight when a hand arrived does not mark it saved */
      seq: number;
      /** time of the oldest hand not yet saved (null: none) */
      dirtyFrom: number | null;
      /** when the stored row was last read or written by this process */
      readAt: number;
    }
  | { state: 'loading'; requestedAt: number }
  | { state: 'failed'; retryAt: number };

const key = (family: HudFamily, user: string) => `${family}|${user}`;
type ReadyEntry = Extract<Entry, { state: 'ready' }>;
const storedRev = (r: { rev?: unknown }): number => {
  const n = Number(r.rev);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
/** a hand changed this profile: unsaved from now, and from the hand's time for the read-back after a refused save */
function markChanged(e: ReadyEntry, at: number): void {
  e.dirty = true;
  e.seq += 1;
  if (e.dirtyFrom === null || at < e.dirtyFrom) e.dirtyFrom = at;
}
const UUIDISH = /^[0-9a-f-]{8,64}$/i;

function bucket(ms: number): string {
  return ms <= 100
    ? 'le100'
    : ms <= 1000
      ? 'le1000'
      : ms <= 5000
        ? 'le5000'
        : ms <= 15000
          ? 'le15000'
          : 'gt15000';
}

export class OpponentHudStore {
  private readonly cache = new Map<string, Entry>();
  /** first time each player was asked for (event time), cleared when ready: the 15-second clock */
  private readonly asked = new Map<string, { at: number; event: HudEvent }>();
  private readonly ring: HudHandRecord[] = [];
  private readonly priors: Record<HudFamily, HudPopulation> = {
    plo4: { family: {}, stakes: {} },
    plo5: { family: {}, stakes: {} },
    nlh: { family: {}, stakes: {} },
  };
  /** failures and late profiles in the current alert window; the alert states raised */
  private window = { loadFailed: 0, late: 0, persistFailed: 0, schemaMissing: 0 };
  private readonly alerting = new Set<HudAlertName>();
  private reconciledDay: string | null = null;
  private reconciling = false;
  private alertTimer: ReturnType<typeof setInterval> | null = null;
  /** the last nightly verification: day, profiles compared, players that differ, hands hand_history holds that a
   *  profile did not count (missed), hands a profile counted that hand_history does not hold (extra), players whose
   *  day sum differs from the rebuild with the same hands (miscounted). Nothing is ever repaired here. */
  lastReconcile: {
    day: string;
    compared: number;
    drifted: number;
    missed: number;
    extra: number;
    miscounted: number;
  } | null = null;
  /** the time of the newest hand the ring has dropped: a profile first asked for before it may have missed hands */
  private ringDroppedAt = -1;
  /** failed load attempts per player since his last ready profile (the retry schedule's position) */
  private readonly loadAttempts = new Map<string, number>();
  /**
   * AUDIT-C items 9/10 (OPPONENT-HUD-FIX-1): why the sync point may not move. 'activating': the switch-on catch-up
   * has not finished; 'catchup': it finished incomplete (a page or a player's load failed; it is re-run on the next
   * alert tick); 'capped': the stored sync point was missing or older than HUD_ACTIVATION_MAX_CATCHUP_MS, so hands
   * between it and the catch-up horizon are counted nowhere. While held, profiles are still saved (each hand once)
   * but '#sync' is never written, so no later activation can start after an uncounted gap; 'capped' raises
   * OpponentHudSyncHeld until the backfill (scripts/opponent-hud-build.ts --apply) has written a fresh sync point.
   */
  private syncHold: 'activating' | 'catchup' | 'capped' | null = null;
  private syncHeldFloor = 0;
  private persistRun: Promise<void> | null = null;
  private gapCatchUp: Promise<void> | null = null;
  private gapFrom: number | null = null;
  /** load-gap catch-ups run (operator report) */
  gapCatchUps = 0;
  private armedState = false;
  /** the migration is not installed: nothing is read or written until this time (re-probed every 10 minutes) */
  private disabledUntil = 0;
  private persisting = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** per-opponent packet entries by (user, family, hands, watermark, street, minute): the main thread builds an
   *  opponent's entry once per minute and street, not once per decision */
  private readonly packetCache = new Map<string, HudPacketOpponent>();
  /** event -> ready latencies (ms) of the last loads, for the operator report */
  readonly readyLatencies: number[] = [];

  constructor(private readonly deps: OpponentHudStoreDeps) {}

  /**
   * Main-side option state (lane.ts feeds the switch reading the workers get). OFF, THE STORE DOES NOTHING AT ALL
   * (VERIFIER 2026-11-20): no database statement, no warm, no after-hand update, no persistence, no reconciliation, no
   * alert, and no packet, so decisions, their keys and the database load are exactly a build without the HUD
   * (OpponentHudStore.test.ts, "option off" law). Switching ON starts the work: the population priors are read, the
   * hands since the last saved sync point (the backfill's end, or the last persistence) are caught up into the stored
   * profiles of everyone who played them, and from then on every seat event warms and every hand updates. Until a
   * player's profile is ready his decisions use the population prior (receipts packet_opponent_missing / _late).
   * Switching OFF saves what changed once and drops the cache.
   */
  setArmed(on: boolean): void {
    const next = on === true;
    if (next === this.armedState) return;
    this.armedState = next;
    if (next) {
      noteFire('opponent_hud_activated');
      void this.activate();
    } else {
      noteFire('opponent_hud_deactivated');
      void this.deactivate();
    }
  }
  private activating: Promise<void> | null = null;
  private activationPending = false;
  private priorsReadFailed = false;
  /** the last activation catch-up: from, hands applied, players loaded, milliseconds */
  lastActivation: {
    fromMs: number;
    applied: number;
    loaded: number;
    ms: number;
    capped: boolean;
  } | null = null;
  private async activate(): Promise<void> {
    if (this.activating) return this.activating;
    this.activating = (async () => {
      const startedAt = this.deps.now();
      try {
        const syncMs = await this.loadPriors();
        if (this.priorsReadFailed) {
          // the database could not be read: retried on the next alert tick (counted as a load failure)
          this.activationPending = true;
          this.window.loadFailed += 1;
          noteFire('opponent_hud_activation_failed');
          return;
        }
        this.activationPending = false;
        const floor = startedAt - HUD_ACTIVATION_MAX_CATCHUP_MS;
        const capped = syncMs === null || !(syncMs > floor);
        const fromMs = Math.max(floor, (syncMs ?? floor) - HUD_RING_MS);
        if (this.syncHold !== 'capped' || !capped) this.syncHold = 'activating';
        if (capped) {
          noteFire('opponent_hud_catchup_capped');
          noteFire('opponent_hud_sync_held');
          this.syncHold = 'capped';
          this.syncHeldFloor = floor;
          this.setAlert(
            'OpponentHudSyncHeld',
            true,
            'opponent HUD switched on with no sync point or one older than 48 hours: the hands before the catch-up are counted nowhere, so the sync point is held until the backfill runs (scripts/opponent-hud-build.ts --apply)'
          );
        }
        // boot / cutover: every profile updated in the last HUD_BOOT_WINDOW_MS is warm before the catch-up reads a
        // page (AUDIT-C item 5: the 'boot' trigger, measured as opponent_hud_ready_boot_ms_*)
        await this.prewarmProfiles(startedAt);
        const r = await this.catchUpInto(fromMs, null);
        const { complete, ...counts } = r;
        this.lastActivation = { fromMs, ...counts, ms: this.deps.now() - startedAt, capped };
        if (!complete) {
          // re-run on the next alert tick (idempotent: each hand is applied once); the sync point stays where it is
          noteFire('opponent_hud_catchup_incomplete');
          this.window.loadFailed += 1;
          this.activationPending = true;
          if (this.syncHold !== 'capped') this.syncHold = 'catchup';
        } else if (!capped) {
          this.syncHold = null;
          this.setAlert('OpponentHudSyncHeld', false, 'opponent HUD sync point is current');
        }
        noteFire('opponent_hud_activation_done');
        if (this.armedState) await this.persist();
      } catch {
        noteFire('opponent_hud_activation_failed');
        this.activationPending = true;
        if (this.syncHold !== 'capped') this.syncHold = 'catchup';
      } finally {
        this.activating = null;
      }
    })();
    return this.activating;
  }
  private async deactivate(): Promise<void> {
    try {
      await this.persist(true);
    } finally {
      if (!this.armedState) {
        this.cache.clear();
        this.asked.clear();
        this.ring.length = 0;
        this.packetCache.clear();
        this.loadAttempts.clear();
        this.syncHold = null;
        for (const name of [...this.alerting])
          this.setAlert(name, false, 'opponent HUD switched off');
      }
    }
  }

  /**
   * Catch the stored profiles of every player in the PLO4/PLO5 cash hands from `fromMs` (to `toMs`, or now) up with
   * those hands: pass 1 names the players, their profiles are loaded (bounded batches), pass 2 applies each hand once
   * (a hand already in a profile is refused by its id or as older than its watermark). Never throws.
   */
  private async catchUpInto(
    fromMs: number,
    toMs: number | null
  ): Promise<{ applied: number; loaded: number; complete: boolean }> {
    const out = { applied: 0, loaded: 0, complete: false };
    if (!this.deps.handsPage) return { ...out, complete: true };
    let walked = true;
    const st = this.catchupStats;
    const sleep = (ms: number): Promise<void> =>
      this.deps.sleep
        ? this.deps.sleep(ms)
        : new Promise((r) => {
            const t = setTimeout(r, ms);
            (t as { unref?: () => void }).unref?.();
          });
    let pause = HUD_CATCHUP_PAUSE_MS;
    // seated players first: a seat / hand warm load in flight goes ahead of the next catch-up read (bounded wait)
    const yieldToSeats = async (): Promise<void> => {
      const until = this.deps.now() + HUD_CATCHUP_SEAT_WAIT_MS;
      let waited = false;
      while (this.seatLoads > 0 && this.armedState && this.deps.now() < until) {
        waited = true;
        await sleep(50);
      }
      if (waited) st.yieldedToSeats += 1;
    };
    const walk = async (visit: (rec: HudHandRecord) => void): Promise<void> => {
      let afterAt = new Date(fromMs).toISOString();
      let afterId = '00000000-0000-0000-0000-000000000000';
      const untilIso = toMs === null ? undefined : new Date(toMs).toISOString();
      for (let page = 0; page < 2000; page++) {
        if (!this.armedState) return;
        if (page > 0) {
          await sleep(pause);
          st.pausedMs += pause;
        }
        await yieldToSeats();
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 10);
        (t as { unref?: () => void }).unref?.();
        try {
          const t0 = this.deps.now();
          const rows = await this.deps.handsPage!(
            afterAt,
            afterId,
            HUD_CATCHUP_PAGE_ROWS,
            ac.signal,
            untilIso
          );
          const took = this.deps.now() - t0;
          st.pages += 1;
          st.dbMs += took;
          if (took > HUD_CATCHUP_SLOW_MS) {
            pause = Math.min(HUD_CATCHUP_MAX_PAUSE_MS, pause * 2);
            st.backoffs += 1;
            noteFire('opponent_hud_catchup_backoff');
          } else pause = Math.max(HUD_CATCHUP_PAUSE_MS, Math.floor(pause / 2));
          st.maxPauseMs = Math.max(st.maxPauseMs, pause);
          if (!Array.isArray(rows) || !rows.length) return;
          st.rows += rows.length;
          let n = 0;
          for (const r of rows) {
            const rec = handRecordFromRow(r);
            if (typeof rec !== 'string') visit(rec);
            if (++n % HUD_CATCHUP_APPLY_SLICE === 0) await sleep(0);
          }
          afterAt = rows[rows.length - 1].created_at;
          afterId = rows[rows.length - 1].id;
          if (rows.length < HUD_CATCHUP_PAGE_ROWS) return;
        } finally {
          clearTimeout(t);
        }
      }
      walked = false; // the page bound ran out before the last hand
    };
    try {
      const players = new Map<HudFamily, Set<string>>(
        HUD_FAMILIES.map((f) => [f, new Set<string>()])
      );
      await walk((rec) => {
        for (const seat of rec.seats) players.get(rec.family)!.add(seat.userId);
      });
      for (const [family, users] of players) {
        const cold = [...users].filter((u) => this.cache.get(key(family, u))?.state !== 'ready');
        for (let i = 0; i < cold.length; i += 50) {
          if (!this.armedState) return out;
          if (i > 0) {
            await sleep(pause);
            st.pausedMs += pause;
          }
          await yieldToSeats();
          await this.load(cold.slice(i, i + 50), family, fromMs);
          out.loaded += Math.min(50, cold.length - i);
        }
      }
      // a player whose load failed has none of these hands: the catch-up is incomplete (re-run, never skipped)
      let allLoaded = true;
      for (const [family, users] of players)
        for (const u of users)
          if (this.cache.get(key(family, u))?.state !== 'ready') allLoaded = false;
      await walk((rec) => {
        if (!this.armedState) return;
        const deltas = extractHandDeltas(rec);
        for (const d of deltas) {
          const e = this.cache.get(key(rec.family, d.user));
          if (e?.state === 'ready' && applyHudHand(e.profile, rec, deltas) === null) {
            markChanged(e, rec.at);
            out.applied += 1;
          }
        }
      });
      out.complete = walked && allLoaded && this.armedState;
    } catch {
      noteFire('opponent_hud_catchup_failed');
    }
    return out;
  }
  /** seat / hand warm loads in flight (the catch-up yields to them) */
  private seatLoads = 0;
  /** the switch-on catch-up's rate-limit counters (pages, rows, database ms, pauses, backoffs, yields to seats) */
  readonly catchupStats = {
    pages: 0,
    rows: 0,
    dbMs: 0,
    pausedMs: 0,
    maxPauseMs: 0,
    backoffs: 0,
    yieldedToSeats: 0,
  };
  armed(): boolean {
    return this.armedState;
  }

  /** Warm the named players' profiles for a family (event-driven, fire and forget, never throws). */
  warm(userIds: readonly string[], family: HudFamily, event: HudEvent): void {
    try {
      if (!this.armedState) return;
      if (!HUD_FAMILIES.includes(family)) return;
      if (this.deps.now() < this.disabledUntil) return;
      noteFire(`opponent_hud_event_${EVENTS.includes(event) ? event : 'hand'}`);
      const now = this.deps.now();
      const want: string[] = [];
      const stale: string[] = [];
      for (const u of new Set(userIds)) {
        if (typeof u !== 'string' || !UUIDISH.test(u)) continue;
        const k = key(family, u);
        const e = this.cache.get(k);
        if (e?.state === 'ready') {
          this.touch(k, e);
          // the bound on a cross-process stale read: a clean profile is re-read once it is HUD_REFRESH_MS old (a
          // changed one is checked against the stored row by its next save); it stays ready meanwhile
          if (!e.dirty && now - e.readAt > HUD_REFRESH_MS && !this.refreshing.has(k)) stale.push(u);
          continue;
        }
        if (!this.asked.has(k)) this.asked.set(k, { at: now, event });
        if (e?.state === 'loading' && now - e.requestedAt < HUD_DB_TIMEOUT_MS * 2) continue;
        if (e?.state === 'failed' && now < e.retryAt) continue;
        want.push(u);
      }
      for (let i = 0; i < want.length; i += 50) {
        this.seatLoads += 1;
        void this.load(want.slice(i, i + 50), family).finally(() => {
          this.seatLoads -= 1;
        });
      }
      for (let i = 0; i < stale.length; i += 50)
        void this.reloadMerge(family, stale.slice(i, i + 50)).catch(() => undefined);
    } catch {
      noteFire('opponent_hud_warm_error');
    }
  }

  private touch(k: string, e: Entry): void {
    this.cache.delete(k);
    this.cache.set(k, e);
  }

  /** `coveredFrom`: the caller is a hand_history catch-up from that time, which will apply these players' hands */
  private async load(users: string[], family: HudFamily, coveredFrom?: number): Promise<void> {
    const startedAt = this.deps.now();
    for (const u of users)
      this.cache.set(key(family, u), { state: 'loading', requestedAt: startedAt });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS);
    (t as { unref?: () => void }).unref?.();
    try {
      const rows = await this.deps.read(users, family, ac.signal);
      const byUser = new Map<string, { profile: OpponentHudProfile; rev: number }>();
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && r.family === family && validHudProfile(r.profile) && r.profile.user === r.user_id)
          byUser.set(r.user_id, { profile: r.profile, rev: storedRev(r) });
      }
      const now = this.deps.now();
      let gapFrom: number | null = null;
      for (const u of users) {
        // another load of the same player finished first and hands may already be counted into it: it stays
        if (this.cache.get(key(family, u))?.state === 'ready') continue;
        // a player without a stored row (new, or not yet backfilled) starts empty: the population prior
        const got = byUser.get(u);
        const profile = got?.profile ?? emptyHudProfile(u, family);
        let ringFrom: number | null = null;
        for (const h of this.ring)
          if (h.family === family && applyHudHand(profile, h) === null)
            ringFrom = ringFrom === null ? h.at : Math.min(ringFrom, h.at);
        // asked for before the oldest hand the ring still holds: the hands he played meanwhile are read back from
        // hand_history (each still once)
        const askedAt = this.asked.get(key(family, u))?.at;
        if (askedAt !== undefined && askedAt <= this.ringDroppedAt)
          gapFrom = Math.min(gapFrom ?? askedAt, askedAt);
        const e = this.setReady(family, u, profile, now, got?.rev ?? 0);
        // a hand of the ring that the stored row did not hold is unsaved: it is written by the next persistence
        if (ringFrom !== null) markChanged(e, ringFrom);
      }
      noteFire('opponent_hud_load_ok');
      if (gapFrom !== null && !(coveredFrom !== undefined && coveredFrom <= gapFrom))
        this.loadGapCatchUp(gapFrom);
    } catch (error) {
      const now = this.deps.now();
      if (error instanceof Error && error.message === HUD_SCHEMA_MISSING) {
        this.disabledUntil = now + 10 * 60_000;
        noteFire('opponent_hud_schema_missing');
        this.window.schemaMissing += 1;
      }
      const schemaMissing = now < this.disabledUntil;
      const retry = new Map<number, string[]>();
      for (const u of users) {
        const k = key(family, u);
        const attempt = this.loadAttempts.get(k) ?? 0;
        this.loadAttempts.set(k, attempt + 1);
        const delay =
          !schemaMissing && attempt < HUD_RETRY_SCHEDULE_MS.length
            ? HUD_RETRY_SCHEDULE_MS[attempt]
            : HUD_RETRY_MS;
        this.cache.set(k, { state: 'failed', retryAt: now + delay });
        if (delay !== HUD_RETRY_MS) retry.set(delay, [...(retry.get(delay) ?? []), u]);
      }
      while (this.loadAttempts.size > HUD_CACHE_MAX)
        this.loadAttempts.delete(this.loadAttempts.keys().next().value!);
      for (const [delay, list] of retry) this.later(delay, () => this.retryFailed(family, list));
      noteFire(ac.signal.aborted ? 'opponent_hud_load_timeout' : 'opponent_hud_load_failed');
      this.window.loadFailed += 1;
    } finally {
      clearTimeout(t);
    }
  }

  /** One catch-up at a time from the earliest gap asked for; a gap noted while one runs starts the next. Never throws. */
  private later(ms: number, fn: () => void): void {
    const run = () => {
      try {
        fn();
      } catch {
        noteFire('opponent_hud_retry_error');
      }
    };
    if (this.deps.schedule) this.deps.schedule(ms, run);
    else (setTimeout(run, ms) as { unref?: () => void }).unref?.();
  }
  /** the retry schedule's timer: reload the players still failed whose retry time has come (never throws) */
  private retryFailed(family: HudFamily, users: readonly string[]): void {
    if (!this.armedState || this.deps.now() < this.disabledUntil) return;
    const now = this.deps.now();
    const due = users.filter((u) => {
      const e = this.cache.get(key(family, u));
      return e?.state === 'failed' && now >= e.retryAt;
    });
    if (!due.length) return;
    noteFire('opponent_hud_load_retry');
    for (let i = 0; i < due.length; i += 50) {
      this.seatLoads += 1;
      void this.load(due.slice(i, i + 50), family).finally(() => {
        this.seatLoads -= 1;
      });
    }
  }

  private loadGapCatchUp(fromMs: number): void {
    this.gapFrom = Math.min(this.gapFrom ?? fromMs, fromMs);
    if (this.gapCatchUp || !this.armedState) return;
    const from = this.gapFrom - HUD_LATE_WINDOW_SLACK_MS;
    this.gapFrom = null;
    noteFire('opponent_hud_gap_catchup');
    this.gapCatchUps += 1;
    this.gapCatchUp = this.catchUpInto(from, null)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.gapCatchUp = null;
        if (this.gapFrom !== null) this.loadGapCatchUp(this.gapFrom);
      });
  }

  private setReady(
    family: HudFamily,
    u: string,
    profile: OpponentHudProfile,
    now: number,
    rev = 0
  ): ReadyEntry {
    const k = key(family, u);
    const prev = this.cache.get(k);
    this.cache.delete(k);
    const entry: ReadyEntry = {
      state: 'ready',
      profile,
      dirty: prev?.state === 'ready' ? prev.dirty : false,
      since: now,
      rev,
      seq: prev?.state === 'ready' ? prev.seq + 1 : 0,
      dirtyFrom: prev?.state === 'ready' ? prev.dirtyFrom : null,
      readAt: now,
    };
    this.cache.set(k, entry);
    this.loadAttempts.delete(k);
    const asked = this.asked.get(k);
    if (asked) {
      const ms = Math.max(0, now - asked.at);
      noteFire(`opponent_hud_ready_ms_${bucket(ms)}`);
      noteFire(`opponent_hud_ready_${asked.event}_ms_${bucket(ms)}`);
      this.readyLatencies.push(ms);
      if (this.readyLatencies.length > 5000) this.readyLatencies.splice(0, 1000);
      this.asked.delete(k);
    }
    this.evict();
    return entry;
  }

  private evict(): void {
    if (this.cache.size <= HUD_CACHE_MAX) return;
    for (const [k, e] of this.cache) {
      if (this.cache.size <= HUD_CACHE_MAX) break;
      if (e.state === 'ready' && e.dirty) continue; // persisted first, evicted on a later pass
      this.cache.delete(k);
      noteFire('opponent_hud_cache_evicted');
    }
  }

  /** Is this player's profile warm (test and metric use). */
  ready(userId: string, family: HudFamily): boolean {
    return this.cache.get(key(family, userId))?.state === 'ready';
  }
  profile(userId: string, family: HudFamily): OpponentHudProfile | null {
    const e = this.cache.get(key(family, userId));
    return e?.state === 'ready' ? e.profile : null;
  }
  /** The population of a family: a stored '*' row (current shape or a flat priors map). Malformed: unchanged. */
  setPriors(family: HudFamily, priors: unknown): void {
    const pop = parseHudPopulation(priors);
    if (pop) this.priors[family] = pop;
  }

  /**
   * The snapshot field for one decision: `{ opponentHud }` with every live opponent's warm profile, or `{}` when the
   * option is not armed or the game is not PLO4/PLO5 cash (then the snapshot and its key are exactly as before).
   * Counts, per opponent, whether his profile was ready and whether he has waited past the 15-second deadline.
   */
  packetFor(input: {
    family: string | null | undefined;
    cash: boolean;
    heroId: string;
    opponentIds: readonly string[];
    street: HudStreet;
    atMs: number;
    /** the hand's big blind: the stake band of the population prior */
    bigBlind?: number | null;
  }): { opponentHud?: OpponentHudPacket } {
    try {
      if (!this.armedState) return {};
      const family = isHudFamily(input.family) ? input.family : null;
      if (!family) return {};
      const ids = [...new Set(input.opponentIds)].filter((u) => u !== input.heroId).sort();
      const profiles: OpponentHudProfile[] = [];
      const now = this.deps.now();
      const missing: string[] = [];
      for (const u of ids) {
        const p = this.profile(u, family);
        if (p) {
          profiles.push(p);
          noteFire('opponent_hud_packet_opponent_ready');
        } else {
          missing.push(u);
          const asked = this.asked.get(key(family, u));
          noteFire(
            asked && now - asked.at > HUD_READY_DEADLINE_MS
              ? 'opponent_hud_packet_opponent_late'
              : 'opponent_hud_packet_opponent_missing'
          );
          if (asked && now - asked.at > HUD_READY_DEADLINE_MS) this.window.late += 1;
        }
      }
      if (missing.length) this.warm(missing, family, 'decision');
      noteFire('opponent_hud_packet_attached');
      return {
        opponentHud: buildHudPacket(
          family,
          profiles,
          // a tournament big blind is chips, not a stake: the family prior
          priorsForStake(this.priors[family], input.cash ? input.bigBlind : null),
          input.atMs,
          input.street,
          (p, minute, street) => {
            const k = `${p.family}|${p.user}|${p.hands}|${p.wm}|${street}|${minute}`;
            let e = this.packetCache.get(k);
            if (!e) {
              e = buildHudPacketOpponent(p, minute, street);
              this.packetCache.set(k, e);
              while (this.packetCache.size > 4000)
                this.packetCache.delete(this.packetCache.keys().next().value!);
            }
            return e;
          }
        ),
      };
    } catch {
      noteFire('opponent_hud_packet_error');
      return {};
    }
  }

  /**
   * Apply an accepted hand (the hand_history row as written) to every warm profile of a player dealt in, and keep it
   * in the ring for profiles still loading. Never throws. Returns how many profiles it updated.
   */
  onAcceptedHand(row: unknown): number {
    if (!this.armedState) return 0;
    try {
      const rec = handRecordFromRow(row);
      if (typeof rec === 'string') return 0;
      this.ring.push(rec);
      const cutoff = rec.at - HUD_RING_MS;
      while (this.ring.length && (this.ring.length > HUD_RING_MAX || this.ring[0].at < cutoff)) {
        const dropped = this.ring.shift()!;
        if (dropped.at > this.ringDroppedAt) this.ringDroppedAt = dropped.at;
      }
      const deltas = extractHandDeltas(rec);
      let updated = 0;
      for (const d of deltas) {
        const e = this.cache.get(key(rec.family, d.user));
        if (e?.state !== 'ready') continue;
        const why = applyHudHand(e.profile, rec, deltas);
        if (why === null) {
          markChanged(e, rec.at);
          updated += 1;
        } else if (why === 'stale') noteFire('opponent_hud_apply_stale');
      }
      noteFire('opponent_hud_hand_applied');
      // everyone dealt in is warmed for his next hand (a new player is loaded now, not at his first decision)
      this.warm(
        rec.seats.map((s) => s.userId),
        rec.family,
        'hand'
      );
      return updated;
    } catch {
      noteFire('opponent_hud_apply_error');
      return 0;
    }
  }

  /** profiles being re-read from the stored row (a save leaves them to the next persistence) */
  private readonly refreshing = new Set<string>();

  /**
   * MERGE ONTO THE STORED ROW (more than one engine process; the backfill under a live engine). Re-read the named
   * warm profiles; where the stored row is not the revision this process built on, the stored profile replaces the
   * one in memory and every hand this process holds that the stored row does not (the ring; older unsaved hands are
   * read back from hand_history) is applied to it, each once: the stored profile's own hand id lists refuse a hand
   * it already counts. The profile stays ready throughout. Never throws.
   */
  private async reloadMerge(family: HudFamily, users: string[]): Promise<void> {
    const mine = users.filter((u) => !this.refreshing.has(key(family, u)));
    if (!mine.length) return;
    for (const u of mine) this.refreshing.add(key(family, u));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS);
    (t as { unref?: () => void }).unref?.();
    try {
      const rows = await this.deps.read(mine, family, ac.signal);
      const byUser = new Map<string, { profile: OpponentHudProfile; rev: number }>();
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && r.family === family && validHudProfile(r.profile) && r.profile.user === r.user_id)
          byUser.set(r.user_id, { profile: r.profile, rev: storedRev(r) });
      }
      const now = this.deps.now();
      let gapFrom: number | null = null;
      let replaced = 0;
      for (const u of mine) {
        const e = this.cache.get(key(family, u));
        if (e?.state !== 'ready') continue;
        const got = byUser.get(u);
        e.readAt = now;
        if (!got) {
          // no stored row (removed by a rollback, or never written): this profile is the record; the next save
          // inserts it
          e.rev = 0;
          continue;
        }
        if (got.rev === e.rev) continue; // nobody else wrote it
        let ringFrom: number | null = null;
        for (const h of this.ring)
          if (h.family === family && applyHudHand(got.profile, h) === null)
            ringFrom = ringFrom === null ? h.at : Math.min(ringFrom, h.at);
        if (e.dirtyFrom !== null && e.dirtyFrom <= this.ringDroppedAt)
          gapFrom = gapFrom === null ? e.dirtyFrom : Math.min(gapFrom, e.dirtyFrom);
        e.profile = got.profile;
        e.rev = got.rev;
        e.seq += 1;
        e.dirty = ringFrom !== null;
        e.dirtyFrom = ringFrom;
        replaced += 1;
      }
      if (replaced) {
        this.packetCache.clear();
        noteFire('opponent_hud_merged');
      }
      if (gapFrom !== null) this.loadGapCatchUp(gapFrom);
    } catch {
      noteFire('opponent_hud_refresh_failed');
    } finally {
      clearTimeout(t);
      for (const u of mine) this.refreshing.delete(key(family, u));
    }
  }

  /**
   * Persist every changed profile. Each row names the revision of the stored row it was built on
   * (opponent_hud_profiles.rev); the database writes it only when the stored row is still that revision, in one
   * statement under the row's lock, so two engine processes (a cutover overlap, a standby, the backfill) can never
   * write over each other's hands. A refused row is merged onto the stored row (reloadMerge) and saved again inside
   * this persistence. A hand that arrives while a save is in flight keeps its profile unsaved. The sync point moves
   * only when every changed profile is saved.
   */
  /** Save every changed profile (one run at a time: a call while a save runs joins it). */
  persist(force = false): Promise<void> {
    if (this.persistRun) return this.persistRun;
    const run = this.persistOnce(force).finally(() => {
      if (this.persistRun === run) this.persistRun = null;
    });
    this.persistRun = run;
    return run;
  }
  /**
   * AUDIT-C item 3 (OPPONENT-HUD-FIX-1): the engine's graceful stop (index.ts performShutdown, after every dealer has
   * drained, so after the last hand this process settles) saves every changed profile: a save already running is
   * awaited first, then one more save covers the hands it did not carry. Bounded by the caller's deadline; never
   * throws. Off: nothing (no statement).
   */
  async flushForExit(): Promise<void> {
    this.stop();
    if (!this.armedState) return;
    try {
      if (this.activating) await this.activating;
      if (this.persistRun) await this.persistRun;
      await this.persist(true);
      noteFire('opponent_hud_exit_saved');
    } catch {
      noteFire('opponent_hud_exit_save_failed');
    }
  }
  private async persistOnce(force: boolean): Promise<void> {
    if (!this.armedState && !force) return;
    if (this.persisting) return;
    this.persisting = true;
    try {
      const startedAt = this.deps.now();
      let unsaved = false;
      type Item = { k: string; e: ReadyEntry };
      const write = async (items: Item[]): Promise<Item[]> => {
        const refusedItems: Item[] = [];
        for (let i = 0; i < items.length; ) {
          const batch: Item[] = [];
          for (let bytes = 0; i < items.length && batch.length < HUD_PERSIST_BATCH; i++) {
            bytes += hudProfileBytesBound(items[i].e.profile);
            if (batch.length && bytes > HUD_PERSIST_BATCH_BYTES) break;
            batch.push(items[i]);
          }
          // the row is copied now: what is sent is exactly the profile at this revision and this change count
          const sent = batch.map(({ e }) => ({ seq: e.seq, rev: e.rev }));
          const body = batch.map(({ e }) => ({
            user_id: e.profile.user,
            family: e.profile.family,
            version: e.profile.v,
            hands: e.profile.hands,
            wm_ms: Math.round(e.profile.wm),
            base_rev: e.rev,
            profile: structuredClone(e.profile),
          }));
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 5);
          (t as { unref?: () => void }).unref?.();
          try {
            const refused = await this.deps.upsert(body, ac.signal);
            const refusedSet = new Set(Array.isArray(refused) ? refused : []);
            const now = this.deps.now();
            batch.forEach((item, j) => {
              if (refusedSet.has(item.k)) {
                refusedItems.push(item);
                return;
              }
              // the entry may have been dropped (switch off, eviction) or merged meanwhile: only the one sent
              if (this.cache.get(item.k) !== item.e || item.e.rev !== sent[j].rev) return;
              item.e.rev = sent[j].rev + 1;
              item.e.readAt = now;
              if (item.e.seq === sent[j].seq) {
                item.e.dirty = false;
                item.e.dirtyFrom = null;
              }
            });
            noteFire('opponent_hud_persist_ok');
          } catch {
            // not known to be written: the profiles stay unsaved; if the row was written after all, the next save
            // is refused by its revision and merged (the stored row then already holds these hands)
            noteFire('opponent_hud_persist_failed');
            this.window.persistFailed += 1;
            unsaved = true;
          } finally {
            clearTimeout(t);
          }
        }
        return refusedItems;
      };
      const collect = (keys?: Iterable<string>): Item[] => {
        const out: Item[] = [];
        const visit = (k: string, e: Entry | undefined) => {
          if (e?.state !== 'ready' || !e.dirty) return;
          if (this.refreshing.has(k)) unsaved = true;
          else out.push({ k, e });
        };
        if (keys) for (const k of keys) visit(k, this.cache.get(k));
        else for (const [k, e] of this.cache) visit(k, e);
        return out;
      };
      const dirty = collect();
      let refused = await write(dirty);
      for (let round = 0; refused.length && round < HUD_PERSIST_MERGE_ROUNDS; round++) {
        noteFire('opponent_hud_persist_refused');
        const byFamily = new Map<HudFamily, string[]>();
        for (const { e } of refused) {
          const list = byFamily.get(e.profile.family) ?? [];
          list.push(e.profile.user);
          byFamily.set(e.profile.family, list);
        }
        for (const [family, users] of byFamily)
          for (let i = 0; i < users.length; i += 50)
            await this.reloadMerge(family, users.slice(i, i + 50));
        // a merged profile with nothing of its own left is already whole in the stored row
        refused = await write(collect(refused.map((x) => x.k)));
      }
      if (refused.length) {
        unsaved = true;
        noteFire('opponent_hud_persist_unmerged');
      }
      // hands older than the ring are still being read back for a merged profile
      if (this.gapCatchUp !== null || this.gapFrom !== null) unsaved = true;
      // the sync point: every hand accepted before this persistence began is in a saved profile or in the ring
      if (this.syncHold !== null) noteFire('opponent_hud_sync_held_persist');
      if (dirty.length && !unsaved && this.syncHold === null) {
        try {
          await this.deps.upsert(
            [
              {
                user_id: HUD_SYNC_ROW,
                family: 'plo5',
                version: 1,
                hands: 0,
                wm_ms: startedAt,
                profile: {},
              },
            ],
            AbortSignal.timeout(HUD_DB_TIMEOUT_MS * 5)
          );
        } catch {
          noteFire('opponent_hud_persist_failed');
        }
      }
      this.evict();
    } finally {
      this.persisting = false;
    }
  }

  /** Engine boot: warm every profile updated in the last HUD_BOOT_WINDOW_MS, both families, in pages. */
  async prewarm(): Promise<number> {
    if (!this.armedState) return 0;
    const n = await this.prewarmProfiles(this.deps.now());
    // catch up the hands accepted since the last persistence (a restart loses no hand: applyHudHand counts each once)
    await this.catchUp(new Date(this.deps.now() - HUD_BOOT_CATCHUP_MS).toISOString());
    return n;
  }
  /** The 'boot' trigger (activation at engine boot or cutover): every stored profile updated in the last
   *  HUD_BOOT_WINDOW_MS is made ready; each one's readiness from `startedAt` is counted as opponent_hud_ready_boot_*. */
  private async prewarmProfiles(startedAt: number): Promise<number> {
    if (!this.armedState) return 0;
    let n = 0;
    const since = new Date(this.deps.now() - HUD_BOOT_WINDOW_MS).toISOString();
    for (const family of HUD_FAMILIES) {
      let after: string | null = null;
      for (let page = 0; page < 40; page++) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 5);
        (t as { unref?: () => void }).unref?.();
        try {
          const rows = await this.deps.recent(family, since, after, 500, ac.signal);
          if (!Array.isArray(rows) || !rows.length) break;
          const now = this.deps.now();
          for (const r of rows) {
            after = r.user_id;
            if (r.user_id === '*') {
              if (r.profile && typeof r.profile === 'object') this.setPriors(family, r.profile);
              continue;
            }
            if (r.family !== family || !validHudProfile(r.profile) || r.profile.user !== r.user_id)
              continue;
            if (this.cache.get(key(family, r.user_id))?.state === 'ready') continue;
            const k = key(family, r.user_id);
            if (!this.asked.has(k)) this.asked.set(k, { at: startedAt, event: 'boot' });
            this.setReady(family, r.user_id, r.profile, now, storedRev(r));
            n += 1;
          }
          if (rows.length < 500) break;
        } catch {
          noteFire('opponent_hud_prewarm_failed');
          break;
        } finally {
          clearTimeout(t);
        }
      }
    }
    noteFire('opponent_hud_event_boot');
    return n;
  }

  /** Apply every PLO4/PLO5 cash hand since `sinceIso` to the warm profiles (bounded pages; never throws). */
  async catchUp(sinceIso: string): Promise<number> {
    if (!this.deps.handsPage) return 0;
    let afterAt = sinceIso;
    let afterId = '00000000-0000-0000-0000-000000000000';
    let applied = 0;
    for (let page = 0; page < 40; page++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 10);
      (t as { unref?: () => void }).unref?.();
      try {
        const rows = await this.deps.handsPage(afterAt, afterId, 1000, ac.signal);
        if (!Array.isArray(rows) || !rows.length) break;
        for (const r of rows) {
          const rec = handRecordFromRow(r);
          if (typeof rec === 'string') continue;
          // kept for the profiles loaded later (a player not prewarmed is caught up when he is warmed)
          this.ring.push(rec);
          if (this.ring.length > HUD_RING_MAX) this.ring.shift();
          const deltas = extractHandDeltas(rec);
          for (const d of deltas) {
            const e = this.cache.get(key(rec.family, d.user));
            if (e?.state === 'ready' && applyHudHand(e.profile, rec, deltas) === null) {
              markChanged(e, rec.at);
              applied += 1;
            }
          }
        }
        afterAt = rows[rows.length - 1].created_at;
        afterId = rows[rows.length - 1].id;
        if (rows.length < 1000) break;
      } catch {
        noteFire('opponent_hud_catchup_failed');
        break;
      } finally {
        clearTimeout(t);
      }
    }
    return applied;
  }

  /** Population priors of both families (the '*' rows); returns the newest sync point (the backfill's last hand, or
   *  the last complete persistence), or null when none is stored. */
  async loadPriors(): Promise<number | null> {
    let sync: number | null = null;
    this.priorsReadFailed = false;
    for (const family of HUD_FAMILIES) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS);
      (t as { unref?: () => void }).unref?.();
      try {
        const rows = await this.deps.read(['*', HUD_SYNC_ROW], family, ac.signal);
        for (const x of rows)
          if ((x.user_id === '*' || x.user_id === HUD_SYNC_ROW) && Number(x.wm_ms) > (sync ?? -1))
            sync = Number(x.wm_ms);
        const r = rows.find((x) => x.user_id === '*');
        if (r && r.profile && typeof r.profile === 'object') this.setPriors(family, r.profile);
      } catch {
        noteFire('opponent_hud_priors_failed');
        this.priorsReadFailed = true;
      } finally {
        clearTimeout(t);
      }
    }
    return sync;
  }

  /** Timers only: every one of them does nothing while the option is off (the switch arms the store). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.persist(), HUD_PERSIST_MS);
    (this.timer as { unref?: () => void }).unref?.();
    this.alertTimer = setInterval(() => {
      this.tickAlerts();
      void this.maybeReconcile();
    }, HUD_ALERT_WINDOW_MS);
    (this.alertTimer as { unref?: () => void }).unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.alertTimer) clearInterval(this.alertTimer);
    this.timer = null;
    this.alertTimer = null;
  }

  private setAlert(name: HudAlertName, firing: boolean, summary: string): void {
    if (firing === this.alerting.has(name)) return;
    if (firing) this.alerting.add(name);
    else this.alerting.delete(name);
    noteFire(firing ? 'opponent_hud_alert_raised' : 'opponent_hud_alert_resolved');
    try {
      this.deps.alert?.(name, firing, summary);
    } catch {
      /* an alarm never breaks the thing it watches */
    }
  }

  /** Close the alert window: raise each condition seen in it, resolve each that stayed clean (never throws). */
  tickAlerts(): void {
    if (!this.armedState) return;
    if (this.activationPending && !this.activating) void this.activate();
    else if (this.syncHold === 'capped' && !this.activating) void this.releaseHoldIfBackfilled();
    try {
      const w = this.window;
      this.window = { loadFailed: 0, late: 0, persistFailed: 0, schemaMissing: 0 };
      this.setAlert(
        'OpponentHudLoadFailing',
        w.loadFailed >= HUD_ALERT_LOAD_FAILURES || w.schemaMissing > 0,
        `opponent profiles failed to load ${w.loadFailed} times in 5 minutes` +
          (w.schemaMissing ? ' (the opponent_hud_profiles migration is not installed)' : '')
      );
      this.setAlert(
        'OpponentHudProfileLate',
        w.late > 0,
        `${w.late} decisions faced an opponent whose profile was not ready 15 seconds after he joined`
      );
      this.setAlert(
        'OpponentHudPersistFailing',
        w.persistFailed > 0,
        `opponent profiles could not be saved ${w.persistFailed} times in 5 minutes`
      );
    } catch {
      noteFire('opponent_hud_alert_error');
    }
  }

  /** While the sync point is held for an uncounted gap: two small reads; once the backfill has written a sync point
   *  newer than the held floor, the activation runs again from it (and releases the hold when it completes). */
  private async releaseHoldIfBackfilled(): Promise<void> {
    try {
      const sync = await this.loadPriors();
      if (!this.priorsReadFailed && sync !== null && sync > this.syncHeldFloor && this.armedState)
        await this.activate();
    } catch {
      noteFire('opponent_hud_sync_hold_check_failed');
    }
  }

  /** Once a day, from HUD_RECONCILE_HOUR:HUD_RECONCILE_MINUTE Chicago, reconcile the previous Chicago day. */
  async maybeReconcile(): Promise<void> {
    if (!this.armedState) return;
    const now = this.deps.now();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const hour = Number(parts.find((x) => x.type === 'hour')?.value);
    const minute = Number(parts.find((x) => x.type === 'minute')?.value);
    if (hour * 60 + minute < HUD_RECONCILE_HOUR * 60 + HUD_RECONCILE_MINUTE) return;
    const yesterday = hudDayOf(now - 24 * 3600_000);
    if (this.reconciledDay === yesterday || this.reconciling) return;
    this.reconciledDay = yesterday;
    await this.reconcileDay(yesterday);
  }

  /**
   * NIGHTLY VERIFICATION (rebuild and compare; it never writes a count). For every player dealt into a PLO4/PLO5 cash
   * hand on that Chicago day, the day is rebuilt from the raw hand_history rows (which hands he was dealt, and the
   * sum of what each adds to a profile, hudHandDigest) and compared with what his profile recorded when it counted
   * them (its day list and day sum): a hand hand_history holds that the profile did not count (missed), a hand the
   * profile counted that hand_history does not hold (extra), or the same hands with a different sum (miscounted)
   * raises OpponentHudDrift, resolved by the next clean night. NOTHING IS REPAIRED HERE (owner's standard: no job
   * stands in place of a fix): the counter is exactly-once at its root (applyHudHand, loadGapCatchUp); a difference is
   * a defect to be found, and the profiles are rebuilt by the operator backfill once it is. Hands with no person are
   * purged after 7 days, so the day is verified while all of its hands still exist. A profile whose day lists started
   * after that day began is skipped (it cannot prove what it counted). Never throws.
   */
  async reconcileDay(day: string): Promise<{
    compared: number;
    drifted: number;
    missed: number;
    extra: number;
    miscounted: number;
  }> {
    const out = { compared: 0, drifted: 0, missed: 0, extra: 0, miscounted: 0 };
    if (!this.deps.handsPage || this.reconciling) return out;
    this.reconciling = true;
    try {
      // the day's UTC bounds (a Chicago day starts at 05:00Z or 06:00Z)
      const guess = Date.parse(`${day}T12:00:00Z`);
      let start = guess - 24 * 3600_000;
      while (hudDayOf(start) !== day) start += 15 * 60_000;
      while (hudDayOf(start - 60_000) === day) start -= 60_000;
      let end = start + 22 * 3600_000;
      while (hudDayOf(end) === day) end += 60_000;
      // the rebuild: per player, the hands he was dealt and the sum of their digests, from the raw rows
      const expected = new Map<string, { ids: Set<string>; sum: number }>();
      let afterAt = new Date(start - 1).toISOString();
      let afterId = '00000000-0000-0000-0000-000000000000';
      let complete = false;
      for (let page = 0; page < 400 && !complete; page++) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 10);
        (t as { unref?: () => void }).unref?.();
        try {
          const rows = await this.deps.handsPage(
            afterAt,
            afterId,
            1000,
            ac.signal,
            new Date(end - 1).toISOString()
          );
          if (!Array.isArray(rows) || !rows.length) {
            complete = true;
            break;
          }
          for (const r of rows) {
            const rec = handRecordFromRow(r);
            if (typeof rec === 'string' || hudDayOf(rec.at) !== day) continue;
            const deltas = extractHandDeltas(rec);
            for (const d of deltas) {
              const k = key(rec.family, d.user);
              let e = expected.get(k);
              if (!e) expected.set(k, (e = { ids: new Set(), sum: 0 }));
              const prefix = hudIdPrefix(rec.id);
              if (e.ids.has(prefix)) continue;
              e.ids.add(prefix);
              e.sum = (e.sum + (hudHandDigest(d.user, rec, deltas) ?? 0)) >>> 0;
            }
          }
          afterAt = rows[rows.length - 1].created_at;
          afterId = rows[rows.length - 1].id;
          if (rows.length < 1000) complete = true;
        } finally {
          clearTimeout(t);
        }
        await new Promise<void>((r) => setImmediate(r));
      }
      if (!complete) throw new Error('verification page limit');
      // every player of the day warm (bounded loads), then compare
      for (const family of HUD_FAMILIES) {
        // only players not already warm: a warm profile holds hands not yet saved and is never replaced
        const users = [...expected.keys()]
          .filter((k) => k.startsWith(`${family}|`) && this.cache.get(k)?.state !== 'ready')
          .map((k) => k.slice(family.length + 1));
        for (let i = 0; i < users.length; i += 50) await this.load(users.slice(i, i + 50), family);
      }
      for (const [k, want] of expected) {
        const e = this.cache.get(k);
        if (e?.state !== 'ready') continue;
        const p = e.profile;
        if (p.daysSince === undefined || p.daysSince >= start) continue;
        out.compared += 1;
        const have = new Set(p.days?.[day] ?? []);
        let missed = 0;
        let extra = 0;
        for (const x of want.ids) if (!have.has(x)) missed += 1;
        for (const x of have) if (!want.ids.has(x)) extra += 1;
        const sumKnown = p.dsumSince !== undefined && p.dsumSince < start;
        const miscounted =
          missed === 0 && extra === 0 && sumKnown && (p.dsum?.[day] ?? 0) !== want.sum ? 1 : 0;
        out.missed += missed;
        out.extra += extra;
        out.miscounted += miscounted;
        if (missed || extra || miscounted) out.drifted += 1;
      }
      this.lastReconcile = { day, ...out };
      noteFire(out.drifted ? 'opponent_hud_reconcile_drift' : 'opponent_hud_reconcile_clean');
      this.setAlert(
        'OpponentHudDrift',
        out.drifted > 0,
        `verification of ${day} against hand_history: ${out.drifted} of ${out.compared} opponent profiles differ ` +
          `(${out.missed} hands not counted, ${out.extra} counted but not in hand_history, ${out.miscounted} profiles ` +
          `with a different day sum); nothing was rewritten: find the cause, then rebuild with scripts/opponent-hud-build.ts`
      );
    } catch {
      noteFire('opponent_hud_reconcile_failed');
      this.setAlert('OpponentHudDrift', true, `verification of ${day} could not complete`);
    } finally {
      this.reconciling = false;
    }
    return out;
  }

  /** Operator / metrics snapshot. */
  stats(): { ready: number; loading: number; failed: number; dirty: number; ring: number } {
    let ready = 0,
      loading = 0,
      failed = 0,
      dirty = 0;
    for (const e of this.cache.values()) {
      if (e.state === 'ready') {
        ready += 1;
        if (e.dirty) dirty += 1;
      } else if (e.state === 'loading') loading += 1;
      else failed += 1;
    }
    return { ready, loading, failed, dirty, ring: this.ring.length };
  }
}

export { OPPONENT_HUD_OPTION };

let shared: OpponentHudStore | null = null;
type HudAlertSink = (name: HudAlertName, firing: boolean, summary: string) => void;
let alertSink: HudAlertSink | null = null;
/** index.ts wires the Production Alerts route (engine_alerts, page false) here, in the main process. */
export function setOpponentHudAlertSink(sink: HudAlertSink | null): void {
  alertSink = sink;
}
const familyOf = (variant: unknown): HudFamily | null => familyForVariant(variant);

/**
 * Seat events (a roster adopted at a table: sit-down, must-move arrival, table move; a Lightning hand formed; a hand
 * started): warm every seated player's profile for every Horse at the table. PLO4/PLO5 cash only; never throws; a
 * no-op before the store is started (tests, scripts) or for any other game.
 */
export function warmOpponentHudSeats(
  userIds: readonly string[],
  variant: unknown,
  tournament: boolean,
  event: HudEvent
): void {
  try {
    const family = familyOf(variant);
    // tournaments are counted and warmed like cash (lead ruling 2026-11-21 18:38Z); `tournament` is kept for callers
    void tournament;
    if (!shared || !family) return;
    shared.warm(userIds, family, event);
  } catch {
    /* never into a seat path */
  }
}

/** The decision snapshot field (ServerTableEngineTurns, LightningHorse): `{ opponentHud }` while armed for a PLO4/PLO5
 *  cash decision, `{}` otherwise (then the snapshot is byte-identical). Never throws. */
export function opponentHudSnapshotField(
  gs: {
    gameVariant?: unknown;
    gameMode?: unknown;
    tournament?: unknown;
    stage?: unknown;
    players?: readonly { user_id?: string; is_folded?: boolean }[];
    bigBlind?: unknown;
  },
  heroId: string,
  atMs: number
): { opponentHud?: OpponentHudPacket } {
  try {
    if (!shared || !shared.armed()) return {};
    const stage = String(gs.stage ?? 'preflop');
    const street: HudStreet =
      stage === 'flop' || stage === 'turn' || stage === 'river' ? stage : 'preflop';
    return shared.packetFor({
      family: familyOf(gs.gameVariant),
      cash: gs.gameMode !== 'tournament' && !gs.tournament,
      heroId,
      opponentIds: (gs.players ?? [])
        .filter((p) => p && p.is_folded !== true && typeof p.user_id === 'string')
        .map((p) => p.user_id as string),
      street,
      atMs,
      bigBlind: typeof gs.bigBlind === 'number' ? gs.bigBlind : null,
    });
  } catch {
    return {};
  }
}

/** Arm or disarm from the switch reading the workers get (lane.ts): armed exactly while the option reads on. */
export function armOpponentHudFromSwitch(message: { status?: unknown; config?: unknown }): void {
  try {
    if (!shared) return;
    // an unreadable reading keeps the last state (the workers turn every option off on their own; flapping the
    // store would drop and re-load every profile)
    if (message.status !== 'ok') return;
    const parsed = parseOptionSwitchConfig(message.config);
    shared.setArmed(
      parsed.ok && optionSwitchDecisionOpts(parsed.states).omahaOpponentLifetimeHud === true
    );
  } catch {
    shared?.setArmed(false);
  }
}

/** The accepted hand (handHistory.ts, after the authoritative commit): applied to every warm profile of a player
 *  dealt in, once. Never throws; a no-op before the store is started. */
export function opponentHudOnAcceptedHand(row: unknown): void {
  try {
    shared?.onAcceptedHand(row);
  } catch {
    /* never into settlement */
  }
}

/**
 * The engine's graceful stop (index.ts performShutdown, after gameServer.stop() has drained every dealer): save every
 * changed profile before the process exits, so the hands this process settled after its successor's activation
 * catch-up are stored (AUDIT-C item 3). Bounded by `deadlineMs`; never throws; a no-op when the store never started
 * or the option is off.
 */
export async function persistOpponentHudBeforeExit(deadlineMs = 8_000): Promise<void> {
  try {
    const store = shared;
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      store.flushForExit(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          noteFire('opponent_hud_exit_save_deadline');
          resolve();
        }, deadlineMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
  } catch {
    /* never into the shutdown path */
  }
}

/** Production start (lane.ts, once): create the store and its timers; switching the option on loads the priors,
 *  prewarms (the 'boot' trigger) and catches up. */
export function startOpponentHudStore(): void {
  try {
    opponentHudStore().start();
  } catch {
    /* the engine runs without the HUD */
  }
}

/** The process's one store (lazy; the database deps come from the Supabase client). */
export function opponentHudStore(): OpponentHudStore {
  if (!shared) shared = new OpponentHudStore(supabaseHudDeps());
  return shared;
}
/** Test hook. */
export function setOpponentHudStoreForTest(store: OpponentHudStore | null): void {
  shared = store;
}

/** PostgREST (PGRST202) and Postgres (42883) both say "no such function" when the migration is not installed. */
const missing = (error: { code?: string; message?: string }): boolean =>
  error.code === 'PGRST202' ||
  error.code === '42883' ||
  /could not find the function|function .* does not exist/i.test(error.message ?? '');

function supabaseHudDeps(): OpponentHudStoreDeps {
  // imported lazily so engine tests that never touch the store need no database client
  const client = async () => (await import('./supabase.js')).supabase;
  return {
    async read(userIds, family, signal) {
      const { data, error } = await (await client())
        .rpc('fn_opponent_hud_profiles_read', { p_user_ids: userIds, p_family: family })
        .abortSignal(signal);
      if (error) throw new Error(missing(error) ? HUD_SCHEMA_MISSING : 'opponent hud read failed');
      return (data ?? []) as HudStoredRow[];
    },
    async recent(family, sinceIso, afterUser, limit, signal) {
      const { data, error } = await (
        await client()
      )
        .rpc('fn_opponent_hud_profiles_recent', {
          p_family: family,
          p_since: sinceIso,
          p_after_user: afterUser,
          p_limit: limit,
        })
        .abortSignal(signal);
      if (error) throw new Error('opponent hud recent failed');
      return (data ?? []) as HudStoredRow[];
    },
    async handsPage(afterAt, afterId, limit, signal, untilIso) {
      const { data, error } = await (
        await client()
      )
        .rpc('fn_opponent_hud_hands_page', {
          p_after_at: afterAt,
          p_after_id: afterId,
          p_until: untilIso ?? new Date().toISOString(),
          p_limit: limit,
        })
        .abortSignal(signal);
      if (error) throw new Error('opponent hud hands page failed');
      return (data ?? []) as { id: string; created_at: string }[];
    },
    alert(name, firing, summary) {
      // Production Alerts through the sink the main process injects (index.ts): this module, on the decision closure
      // through the engine wiring, never imports an alert module (HorseDecisionClosure.test.ts).
      alertSink?.(name, firing, summary);
    },
    async upsert(rows, signal) {
      const { data, error } = await (await client())
        .rpc('fn_opponent_hud_profiles_upsert', { p_rows: rows })
        .abortSignal(signal);
      if (error) throw new Error('opponent hud upsert failed');
      return (data ?? []) as string[];
    },
    now: () => Date.now(),
  };
}
