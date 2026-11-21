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
 * - a hand is applied exactly once (OpponentHudProfile.applyHudHand: id ring and watermark); a profile that failed to
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
  handRecordFromRow,
  hudDayOf,
  hudIdPrefix,
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
export const HUD_CACHE_MAX = 6_000;
export const HUD_RING_MS = 45 * 60 * 1000;
export const HUD_RING_MAX = 20_000;
/** a profile is a few tens of KB of JSON: it is written at most every 30 minutes (and caught up from hand_history at
 *  boot, HUD_BOOT_CATCHUP_MS), so the write volume stays small and a restart loses nothing */
export const HUD_PERSIST_MS = 30 * 60_000;
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
  | 'OpponentHudDrift';
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
}

type Entry =
  | { state: 'ready'; profile: OpponentHudProfile; dirty: boolean; since: number }
  | { state: 'loading'; requestedAt: number }
  | { state: 'failed'; retryAt: number };

const key = (family: HudFamily, user: string) => `${family}|${user}`;
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
  };
  /** failures and late profiles in the current alert window; the alert states raised */
  private window = { loadFailed: 0, late: 0, persistFailed: 0, schemaMissing: 0 };
  private readonly alerting = new Set<HudAlertName>();
  private reconciledDay: string | null = null;
  private reconciling = false;
  private alertTimer: ReturnType<typeof setInterval> | null = null;
  /** the last reconciliation: day, profiles compared, players with drift, hands repaired */
  lastReconcile: { day: string; compared: number; drifted: number; repaired: number } | null = null;
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
        if (capped) {
          noteFire('opponent_hud_catchup_capped');
          this.setAlert(
            'OpponentHudDrift',
            true,
            'opponent HUD switched on more than 48 hours after its last sync point: re-run the backfill (scripts/opponent-hud-build.ts --apply)'
          );
        }
        const r = await this.catchUpInto(fromMs, null);
        this.lastActivation = { fromMs, ...r, ms: this.deps.now() - startedAt, capped };
        noteFire('opponent_hud_activation_done');
        if (this.armedState) await this.persist();
      } catch {
        noteFire('opponent_hud_activation_failed');
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
  ): Promise<{ applied: number; loaded: number }> {
    const out = { applied: 0, loaded: 0 };
    if (!this.deps.handsPage) return out;
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
    };
    try {
      const players = new Map<HudFamily, Set<string>>([
        ['plo4', new Set()],
        ['plo5', new Set()],
      ]);
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
          await this.load(cold.slice(i, i + 50), family);
          out.loaded += Math.min(50, cold.length - i);
        }
      }
      await walk((rec) => {
        if (!this.armedState) return;
        const deltas = extractHandDeltas(rec);
        for (const d of deltas) {
          const e = this.cache.get(key(rec.family, d.user));
          if (e?.state === 'ready' && applyHudHand(e.profile, rec, deltas) === null) {
            e.dirty = true;
            out.applied += 1;
          }
        }
      });
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
      for (const u of new Set(userIds)) {
        if (typeof u !== 'string' || !UUIDISH.test(u)) continue;
        const k = key(family, u);
        const e = this.cache.get(k);
        if (e?.state === 'ready') {
          this.touch(k, e);
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
    } catch {
      noteFire('opponent_hud_warm_error');
    }
  }

  private touch(k: string, e: Entry): void {
    this.cache.delete(k);
    this.cache.set(k, e);
  }

  private async load(users: string[], family: HudFamily): Promise<void> {
    const startedAt = this.deps.now();
    for (const u of users)
      this.cache.set(key(family, u), { state: 'loading', requestedAt: startedAt });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS);
    (t as { unref?: () => void }).unref?.();
    try {
      const rows = await this.deps.read(users, family, ac.signal);
      const byUser = new Map<string, OpponentHudProfile>();
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && r.family === family && validHudProfile(r.profile) && r.profile.user === r.user_id)
          byUser.set(r.user_id, r.profile);
      }
      const now = this.deps.now();
      for (const u of users) {
        // a player without a stored row (new, or not yet backfilled) starts empty: the population prior
        const profile = byUser.get(u) ?? emptyHudProfile(u, family);
        for (const h of this.ring) if (h.family === family) applyHudHand(profile, h);
        this.setReady(family, u, profile, now);
      }
      noteFire('opponent_hud_load_ok');
    } catch (error) {
      const now = this.deps.now();
      if (error instanceof Error && error.message === HUD_SCHEMA_MISSING) {
        this.disabledUntil = now + 10 * 60_000;
        noteFire('opponent_hud_schema_missing');
        this.window.schemaMissing += 1;
      }
      for (const u of users)
        this.cache.set(key(family, u), { state: 'failed', retryAt: now + HUD_RETRY_MS });
      noteFire(ac.signal.aborted ? 'opponent_hud_load_timeout' : 'opponent_hud_load_failed');
      this.window.loadFailed += 1;
    } finally {
      clearTimeout(t);
    }
  }

  private setReady(family: HudFamily, u: string, profile: OpponentHudProfile, now: number): void {
    const k = key(family, u);
    const prev = this.cache.get(k);
    this.cache.delete(k);
    this.cache.set(k, {
      state: 'ready',
      profile,
      dirty: prev?.state === 'ready' ? prev.dirty : false,
      since: now,
    });
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
      if (!this.armedState || !input.cash) return {};
      const family = input.family === 'plo4' || input.family === 'plo5' ? input.family : null;
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
          priorsForStake(this.priors[family], input.bigBlind),
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
      while (this.ring.length && (this.ring.length > HUD_RING_MAX || this.ring[0].at < cutoff))
        this.ring.shift();
      const deltas = extractHandDeltas(rec);
      let updated = 0;
      for (const d of deltas) {
        const e = this.cache.get(key(rec.family, d.user));
        if (e?.state !== 'ready') continue;
        const why = applyHudHand(e.profile, rec, deltas);
        if (why === null) {
          e.dirty = true;
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

  /** Persist every dirty profile (bounded batches); refused rows are dropped from the cache and reloaded. */
  async persist(force = false): Promise<void> {
    if (!this.armedState && !force) return;
    if (this.persisting) return;
    this.persisting = true;
    try {
      const startedAt = this.deps.now();
      let failedBatches = 0;
      const dirty: [string, OpponentHudProfile][] = [];
      for (const [k, e] of this.cache)
        if (e.state === 'ready' && e.dirty) dirty.push([k, e.profile]);
      for (let i = 0; i < dirty.length; i += 200) {
        const batch = dirty.slice(i, i + 200);
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 5);
        (t as { unref?: () => void }).unref?.();
        try {
          const refused = await this.deps.upsert(
            batch.map(([, p]) => ({
              user_id: p.user,
              family: p.family,
              version: p.v,
              hands: p.hands,
              wm_ms: Math.round(p.wm),
              profile: p,
            })),
            ac.signal
          );
          const refusedSet = new Set(Array.isArray(refused) ? refused : []);
          for (const [k] of batch) {
            const e = this.cache.get(k);
            if (refusedSet.has(k)) {
              this.cache.delete(k);
              noteFire('opponent_hud_persist_refused');
            } else if (e?.state === 'ready') e.dirty = false;
          }
          noteFire('opponent_hud_persist_ok');
        } catch {
          noteFire('opponent_hud_persist_failed');
          this.window.persistFailed += 1;
          failedBatches += 1;
        } finally {
          clearTimeout(t);
        }
      }
      // the sync point: every hand accepted before this persistence began is in a saved profile or in the ring
      if (dirty.length && failedBatches === 0) {
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
            this.setReady(family, r.user_id, r.profile, now);
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
    // catch up the hands accepted since the last persistence (a restart loses no hand: applyHudHand counts each once)
    await this.catchUp(new Date(this.deps.now() - HUD_BOOT_CATCHUP_MS).toISOString());
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
              e.dirty = true;
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
   * NIGHTLY RECONCILIATION: compare, for every player dealt into a PLO4/PLO5 cash hand on that Chicago day, the hands
   * hand_history holds with the hands his profile applied (its day list), apply every missing hand (repair, each
   * still once), and raise OpponentHudDrift when any player had one (resolved by the next clean night). Hands with no
   * person are purged after 7 days, so the day is reconciled while all of its hands still exist. A profile whose day
   * lists started after that day is skipped (it cannot prove what it applied). Never throws.
   */
  async reconcileDay(
    day: string
  ): Promise<{ compared: number; drifted: number; repaired: number }> {
    const out = { compared: 0, drifted: 0, repaired: 0 };
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
      const walk = async (visit: (rec: HudHandRecord) => void): Promise<boolean> => {
        let afterAt = new Date(start - 1).toISOString();
        let afterId = '00000000-0000-0000-0000-000000000000';
        for (let page = 0; page < 400; page++) {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), HUD_DB_TIMEOUT_MS * 10);
          (t as { unref?: () => void }).unref?.();
          try {
            const rows = await this.deps.handsPage!(
              afterAt,
              afterId,
              1000,
              ac.signal,
              new Date(end - 1).toISOString()
            );
            if (!Array.isArray(rows) || !rows.length) return true;
            for (const r of rows) {
              const rec = handRecordFromRow(r);
              if (typeof rec !== 'string' && hudDayOf(rec.at) === day) visit(rec);
            }
            afterAt = rows[rows.length - 1].created_at;
            afterId = rows[rows.length - 1].id;
            if (rows.length < 1000) return true;
          } finally {
            clearTimeout(t);
          }
        }
        return false;
      };
      // pass 1: who was dealt into what
      const expected = new Map<string, Set<string>>();
      const ok = await walk((rec) => {
        for (const seat of rec.seats) {
          const k = key(rec.family, seat.userId);
          let set = expected.get(k);
          if (!set) expected.set(k, (set = new Set()));
          set.add(hudIdPrefix(rec.id));
        }
      });
      if (!ok) throw new Error('reconciliation page limit');
      // every player of the day warm (bounded loads), then compare
      for (const family of HUD_FAMILIES) {
        // only players not already warm: a warm profile holds hands not yet saved and is never replaced
        const users = [...expected.keys()]
          .filter((k) => k.startsWith(`${family}|`) && this.cache.get(k)?.state !== 'ready')
          .map((k) => k.slice(family.length + 1));
        for (let i = 0; i < users.length; i += 50) await this.load(users.slice(i, i + 50), family);
      }
      const missing = new Map<string, Set<string>>();
      for (const [k, want] of expected) {
        const e = this.cache.get(k);
        if (e?.state !== 'ready') continue;
        const p = e.profile;
        if (p.daysSince === undefined || p.daysSince >= start) continue;
        out.compared += 1;
        const have = new Set(p.days?.[day] ?? []);
        const lack = [...want].filter((x) => !have.has(x));
        if (lack.length) missing.set(k, new Set(lack));
      }
      out.drifted = missing.size;
      // pass 2: apply the missing hands (repair), each once
      if (missing.size)
        await walk((rec) => {
          const prefix = hudIdPrefix(rec.id);
          const deltas = extractHandDeltas(rec);
          for (const d of deltas) {
            const k = key(rec.family, d.user);
            if (!missing.get(k)?.has(prefix)) continue;
            const e = this.cache.get(k);
            if (
              e?.state === 'ready' &&
              applyHudHand(e.profile, rec, deltas, undefined, true) === null
            ) {
              e.dirty = true;
              out.repaired += 1;
            }
          }
        });
      this.lastReconcile = { day, ...out };
      noteFire(out.drifted ? 'opponent_hud_reconcile_drift' : 'opponent_hud_reconcile_clean');
      this.setAlert(
        'OpponentHudDrift',
        out.drifted > 0,
        `reconciliation of ${day}: ${out.drifted} of ${out.compared} opponent profiles missed hands (${out.repaired} applied now)`
      );
      if (out.repaired) void this.persist();
    } catch {
      noteFire('opponent_hud_reconcile_failed');
      this.setAlert('OpponentHudDrift', true, `reconciliation of ${day} could not complete`);
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
const familyOf = (variant: unknown): HudFamily | null => {
  const v = String(variant ?? '').toLowerCase();
  return v === 'plo4' || v === 'plo5' ? v : null;
};

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
    if (!shared || !family || tournament) return;
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

/** Production start (lane.ts, once): create the store, load priors, prewarm, persist on its timer. */
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
