/**
 * A CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-17).
 *
 * Dan, verbatim: "as soon as a player clicks the + button at a table, their
 * avatar should be shown, and they are given 60 seconds to buy in. even after
 * they buy in, it doesn't show the avatar until after they are dealt in."
 *
 * ROOT CAUSE. Every viewer draws the seats from this engine's published
 * roster, and the engine read that roster (`loadSeatedPlayers`) only at the
 * hand boundary. A cash buy-in commits in `atomic_table_buyin`, straight from
 * the player's browser to the database, so the engine learned of the new seat
 * only when the hand in the air finished and the next one was prepared. The
 * Player Record already read the committed seat ("At A Table"); the felt said
 * "+ SIT" for the rest of the hand (WooWoo, PLO5 1/2 Madness, 2026-11-17). The
 * tap itself was never told to anybody but the tapper's own screen.
 *
 * THE REPAIR. Two explicit events from the player's own client, each acted on
 * by the engine against authoritative data:
 *
 *   hold    the + tap. The engine publishes the player's own profile identity
 *           in that chair, labelled Buying In, for the sixty-second buy-in
 *           window the client already runs. Refused if the chair or the player
 *           is already seated here, or another player holds the chair.
 *   seated  the buy-in committed. The engine reads the table's seat rows and
 *           publishes this player's committed row (real stack) at once.
 *
 * DISPLAY ONLY. Nothing here enters a hand, a pot, the button, blind
 * eligibility or any money path. The hand roster is still adopted only at the
 * hand boundary (adoptRoster below), which then supersedes every entry here.
 * Every entry ends by itself: a hold at its sixty seconds, a committed arrival
 * when a hand-boundary roster holds it or two in a row do not.
 *
 * TOURNAMENT TABLES (Dan 2026-11-18): "WHEN A PLAYER JOINS A TABLE IN BETWEEN
 * THE BLINDS OR ANY OTHER REASON, THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY
 * ZERO." A tournament chair is never bought at the felt: the manager moves a
 * player in (balancing, a table break) or the database seats one (late
 * registration, re-entry) or refills one (a rebuy). There is no `hold` there.
 * The engine reads the committed rows when it is told one changed
 * (ServerTableEngine.showCommittedTournamentSeats) and uses `confirm`,
 * `retainCommitted` and `showCommittedStack` below. Still display only.
 */

export const SEAT_HOLD_DISPLAY_MS = 60_000;

export interface SeatArrivalIdentity {
  username: string;
  avatar_url: string;
  equipped_frame: string;
  equipped_aura: string;
}

export interface SeatArrival extends SeatArrivalIdentity {
  user_id: string;
  seat_number: number;
  /** Committed stack; null while buying in (no chips have moved). */
  stack: number | null;
  kind: 'buying_in' | 'seated';
  /** Epoch ms the buy-in window closes; null once seated. */
  expires_at_ms: number | null;
}

export type SeatHoldVerdict =
  | { ok: true; expires_at_ms: number }
  | { ok: false; reason: 'invalid_seat' | 'already_seated' | 'seat_taken' | 'seat_held' };

export interface PhysicalOccupancy {
  seats: ReadonlySet<number>;
  users: ReadonlySet<string>;
}

export class SeatArrivalDisplay {
  private readonly byUser = new Map<string, SeatArrival>();
  /** Hand-boundary rosters read since a committed arrival was confirmed without it. */
  private readonly missedAdoptions = new Map<string, number>();
  /**
   * Committed chips of a player the adopted roster already seats with none (a
   * tournament rebuy paid during a hand the player is not in). Shown in place
   * of the roster's zero until the next hand boundary reads the roster.
   */
  private readonly committedStacks = new Map<string, number>();
  /** Shown chips that already outlived one roster that still read zero. */
  private readonly stacksPastOneRoster = new Set<string>();

  /** The + tap. One hold per player per table; a new tap moves it. */
  hold(
    userId: string,
    seatNumber: number,
    identity: SeatArrivalIdentity,
    occupied: PhysicalOccupancy,
    maxSeats: number,
    nowMs: number
  ): SeatHoldVerdict {
    this.purgeExpired(nowMs);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > maxSeats) {
      return { ok: false, reason: 'invalid_seat' };
    }
    const own = this.byUser.get(userId);
    if (occupied.users.has(userId) || own?.kind === 'seated') {
      return { ok: false, reason: 'already_seated' };
    }
    if (occupied.seats.has(seatNumber)) return { ok: false, reason: 'seat_taken' };
    for (const other of this.byUser.values()) {
      if (other.user_id !== userId && other.seat_number === seatNumber) {
        return { ok: false, reason: other.kind === 'seated' ? 'seat_taken' : 'seat_held' };
      }
    }
    const expires = nowMs + SEAT_HOLD_DISPLAY_MS;
    this.byUser.set(userId, {
      ...identity,
      user_id: userId,
      seat_number: seatNumber,
      stack: null,
      kind: 'buying_in',
      expires_at_ms: expires,
    });
    return { ok: true, expires_at_ms: expires };
  }

  /** The buy-in sheet closed without a purchase. Only a hold is released. */
  release(userId: string): boolean {
    const own = this.byUser.get(userId);
    if (!own || own.kind !== 'buying_in') return false;
    this.byUser.delete(userId);
    return true;
  }

  /** The committed seat row, read from the database by the engine. */
  confirm(
    row: SeatArrivalIdentity & { user_id: string; seat_number: number; stack: number }
  ): void {
    // Another player's hold on the chair the database gave this player is void.
    for (const other of [...this.byUser.values()]) {
      if (other.user_id !== row.user_id && other.seat_number === row.seat_number) {
        this.byUser.delete(other.user_id);
      }
    }
    this.missedAdoptions.delete(row.user_id);
    this.byUser.set(row.user_id, {
      user_id: row.user_id,
      seat_number: row.seat_number,
      username: row.username,
      avatar_url: row.avatar_url,
      equipped_frame: row.equipped_frame,
      equipped_aura: row.equipped_aura,
      stack: row.stack,
      kind: 'seated',
      expires_at_ms: null,
    });
  }

  /** True when this exact committed row is already what viewers are shown. */
  holdsCommitted(row: { user_id: string; seat_number: number; stack: number }): boolean {
    const own = this.byUser.get(row.user_id);
    return own?.kind === 'seated' && own.seat_number === row.seat_number && own.stack === row.stack;
  }

  /**
   * A later read of the committed rows. A committed arrival the database no
   * longer holds in that chair is gone now, not two hands from now, and so
   * are the shown chips of a player who left. True when anything was dropped.
   */
  retainCommitted(rows: ReadonlyArray<{ user_id: string; seat_number: number }>): boolean {
    const held = new Set(rows.map((r) => `${r.user_id}:${r.seat_number}`));
    const users = new Set(rows.map((r) => r.user_id));
    let changed = false;
    for (const [userId, arrival] of [...this.byUser]) {
      if (arrival.kind !== 'seated' || held.has(`${userId}:${arrival.seat_number}`)) continue;
      this.byUser.delete(userId);
      this.missedAdoptions.delete(userId);
      changed = true;
    }
    for (const userId of [...this.committedStacks.keys()]) {
      if (users.has(userId)) continue;
      this.committedStacks.delete(userId);
      this.stacksPastOneRoster.delete(userId);
      changed = true;
    }
    return changed;
  }

  /** The committed chips of a rostered player shown with none. True when it changed. */
  showCommittedStack(userId: string, stack: number): boolean {
    if (!(stack > 0) || this.committedStacks.get(userId) === stack) return false;
    this.committedStacks.set(userId, stack);
    this.stacksPastOneRoster.delete(userId);
    return true;
  }

  committedStack(userId: string): number | null {
    return this.committedStacks.get(userId) ?? null;
  }

  /** Does a committed arrival own this chair, or seat this player elsewhere? */
  seatedArrivalClaims(userId: string, seatNumber: number): boolean {
    for (const a of this.byUser.values()) {
      if (a.kind !== 'seated') continue;
      if (a.user_id === userId || a.seat_number === seatNumber) return true;
    }
    return false;
  }

  /**
   * The hand boundary read the authoritative roster. Every committed arrival
   * is now either in it or gone; a hold survives only while its chair and its
   * player are still unseated.
   */
  adoptRoster(
    roster: ReadonlyArray<{ user_id: string; seat_number: number; stack?: number }>
  ): void {
    const users = new Set(roster.map((p) => p.user_id));
    const seats = new Set(roster.map((p) => p.seat_number));
    // The roster's own stacks are the committed ones again. A roster read that
    // started before the chips committed still reads zero, once.
    const broke = new Set(roster.filter((p) => !((p.stack ?? 1) > 0)).map((p) => p.user_id));
    for (const userId of [...this.committedStacks.keys()]) {
      if (broke.has(userId) && !this.stacksPastOneRoster.has(userId)) {
        this.stacksPastOneRoster.add(userId);
        continue;
      }
      this.committedStacks.delete(userId);
      this.stacksPastOneRoster.delete(userId);
    }
    for (const [userId, arrival] of [...this.byUser]) {
      if (users.has(userId) || seats.has(arrival.seat_number)) {
        this.byUser.delete(userId);
        continue;
      }
      if (arrival.kind !== 'seated') continue;
      // A roster read that started before this buy-in committed cannot hold
      // it, so one adoption without it proves nothing. Two prove a departure.
      const missed = (this.missedAdoptions.get(userId) ?? 0) + 1;
      if (missed >= 2) this.byUser.delete(userId);
      else this.missedAdoptions.set(userId, missed);
    }
    for (const userId of [...this.missedAdoptions.keys()]) {
      if (this.byUser.get(userId)?.kind !== 'seated') this.missedAdoptions.delete(userId);
    }
  }

  /** The player left this table. */
  forget(userId: string): boolean {
    this.missedAdoptions.delete(userId);
    this.committedStacks.delete(userId);
    this.stacksPastOneRoster.delete(userId);
    return this.byUser.delete(userId);
  }

  /** What every viewer is shown now, in seat order. */
  live(nowMs: number): SeatArrival[] {
    this.purgeExpired(nowMs);
    return [...this.byUser.values()].sort((a, b) => a.seat_number - b.seat_number);
  }

  /** The earliest open buy-in window's close, or null when none is open. */
  nextExpiry(nowMs: number): number | null {
    this.purgeExpired(nowMs);
    let next: number | null = null;
    for (const a of this.byUser.values()) {
      if (a.expires_at_ms !== null && (next === null || a.expires_at_ms < next)) {
        next = a.expires_at_ms;
      }
    }
    return next;
  }

  private purgeExpired(nowMs: number): void {
    for (const [userId, a] of [...this.byUser]) {
      if (a.expires_at_ms !== null && a.expires_at_ms <= nowMs) this.byUser.delete(userId);
    }
  }
}
