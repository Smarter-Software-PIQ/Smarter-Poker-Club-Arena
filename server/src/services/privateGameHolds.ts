/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SEAT HELD FOR AN INVITED FRIEND (2026-11-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The player, texted to Dan: "The crazy river is always on the table, even
 * when you invite someone. It doesn't open a new table." Invite To Game on a
 * Spin or a Heads Up now opens (or reserves) a game whose seats are held for
 * the friends the inviter sends the link to (fn_invite_to_private_game,
 * migration 20261123013126). The database refuses a held seat to anyone but
 * its invited holder (the entry guard, 20261123013136). The engine's part is
 * the other half of the same rule:
 *
 *   1. it seats no horse into a game while its hold is live - a horse waits
 *      for the hold to end exactly as a person without the invite does, so
 *      the fleet does not burn its calls against the guard;
 *   2. a PRIVATE held game (one made for the invite, or reserved in place by
 *      an inviter sitting alone) is not one of the board's instances: it does
 *      not cover the board's price point, so the public board is reopened
 *      beside it, and it is not one of the eleven Spins and two Heads Ups the
 *      ladder seeds with a horse (seatFirstLadder.ts). Its start is
 *      human-triggered by construction - its inviter is seated.
 *
 * WHAT "LIVE" MEANS is decided by the database (fn_private_game_live_holds):
 * not cancelled, still taking entries, inviter still in it, fewer invited
 * friends seated than seats held, and inside ten minutes of OPEN play time -
 * every frozen second of a cutover is given back. The engine never recomputes
 * that; it reads it, at most once every few seconds, for every board at once.
 *
 * NOT KNOWING IS NEVER PERMISSION (CLAUDE.md 10.86). An unreadable answer is
 * `null`, never "no holds". Callers then hold their fill briefly and ask
 * again, which costs a horse-only board seconds on an hour-long ladder. The
 * one answer that IS "no holds" is a database that has no such door yet
 * (PGRST202): without the function no hold can exist.
 */

export interface PrivateGameHold {
  tournamentId: string;
  live: boolean;
  exclusive: boolean;
  seatsHeld: number;
  inviteesSeated: number;
  heldOpen: number;
  /** The live end of the hold, freeze-credited by the database. NaN when unreadable. */
  expiresAtMs: number;
  outcome: string;
}

/**
 * The longest a hold may keep a seat from now, whatever a row says: ten
 * minutes of play plus one cutover's fifteen-minute thaw ceiling. A malformed
 * far-future end can never strand a seat for longer.
 */
export const PRIVATE_GAME_HOLD_MAX_MS = 25 * 60_000;

/** How long one read of the holds is reused. */
export const PRIVATE_GAME_HOLD_READ_TTL_MS = 4_000;

/** How long a caller waits before asking again when the holds could not be read. */
export const PRIVATE_GAME_HOLD_UNKNOWN_RETRY_MS = 15_000;

function num(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse fn_private_game_live_holds' answer. null when it is not an array. */
export function parsePrivateGameHolds(raw: unknown): Map<string, PrivateGameHold> | null {
  if (!Array.isArray(raw)) return null;
  const out = new Map<string, PrivateGameHold>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r.tournament_id ?? '');
    if (!id) continue;
    out.set(id, {
      tournamentId: id,
      live: r.live === true,
      exclusive: r.exclusive === true,
      seatsHeld: num(r.seats_held),
      inviteesSeated: num(r.invitees_seated),
      heldOpen: num(r.held_open),
      expiresAtMs: Date.parse(String(r.hold_expires_at ?? '')),
      outcome: String(r.outcome ?? ''),
    });
  }
  return out;
}

/** Is this hold keeping its seat(s) right now? */
export function privateHoldIsLive(hold: PrivateGameHold | undefined, nowMs: number): boolean {
  return (
    !!hold && hold.live && Number.isFinite(hold.expiresAtMs) && hold.expiresAtMs > nowMs
  );
}

/**
 * Until when a game's open seats are kept for its invited friends, bounded by
 * PRIVATE_GAME_HOLD_MAX_MS. -Infinity when nothing is held.
 */
export function privateHoldUntilMs(hold: PrivateGameHold | undefined, nowMs: number): number {
  if (!privateHoldIsLive(hold, nowMs)) return -Infinity;
  return Math.min(hold!.expiresAtMs, nowMs + PRIVATE_GAME_HOLD_MAX_MS);
}

/**
 * The ids of PRIVATE held games: not instances of their board while held.
 * A seat held in place in a shared game (exclusive false) is still the
 * board's instance - strangers can still sit at its other seats.
 */
export function privatelyHeldIds(
  holds: ReadonlyMap<string, PrivateGameHold>,
  nowMs: number
): Set<string> {
  const ids = new Set<string>();
  for (const hold of holds.values()) {
    if (hold.exclusive && privateHoldIsLive(hold, nowMs)) ids.add(hold.tournamentId);
  }
  return ids;
}

/** A PostgREST answer meaning "no such function": the door is not installed yet. */
export function isMissingFunction(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || /Could not find the function/i.test(String(error.message ?? ''));
}

type HoldRead = () => PromiseLike<{
  data: unknown;
  error: { code?: string | null; message?: string | null } | null;
}>;

/**
 * One read of every live hold, shared by every caller for a few seconds. A
 * failed read answers null and is asked again on the next call.
 */
export class PrivateGameHoldReader {
  private cached: { at: number; holds: Map<string, PrivateGameHold> } | null = null;
  private inFlight: Promise<Map<string, PrivateGameHold> | null> | null = null;

  constructor(
    private readonly read: HoldRead,
    private readonly ttlMs: number = PRIVATE_GAME_HOLD_READ_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  async snapshot(): Promise<Map<string, PrivateGameHold> | null> {
    const at = this.now();
    if (this.cached && at - this.cached.at < this.ttlMs) return this.cached.holds;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const { data, error } = await this.read();
        if (error) {
          if (isMissingFunction(error)) {
            this.cached = { at: this.now(), holds: new Map() };
            return this.cached.holds;
          }
          return null;
        }
        const holds = parsePrivateGameHolds(data);
        if (!holds) return null;
        this.cached = { at: this.now(), holds };
        return holds;
      } catch {
        return null;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /**
   * Until when this game's seats are held: a finite instant, -Infinity when
   * nothing is held, or null when the holds could not be read.
   */
  async holdUntilMs(tournamentId: string): Promise<number | null> {
    const holds = await this.snapshot();
    if (!holds) return null;
    return privateHoldUntilMs(holds.get(tournamentId), this.now());
  }

  /** The private held games' ids, or null when unreadable. */
  async privateIds(): Promise<Set<string> | null> {
    const holds = await this.snapshot();
    if (!holds) return null;
    return privatelyHeldIds(holds, this.now());
  }
}
