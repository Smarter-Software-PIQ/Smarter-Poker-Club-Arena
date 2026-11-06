/**
 * THE HEAD ON EVERY SEAT (Dan 2026-11-05).
 *
 * "Yea it may have went on their head but the number on the screen above
 * their head didn't update." The ledger was right every time; the felt only
 * learned a head through a separate realtime channel that dropped. The
 * tournament manager now reads the heads from tournament_players.current_bounty
 * and hands them to every table engine it owns, which publish them on the same
 * table state that carries the chips (ServerTableEngine.setSeatBounties).
 *
 * One writer of the map: this refresher. It never computes a head; it copies
 * what the ledger holds. Reads are coalesced and spaced so a busy event costs
 * at most one bounded roster read per MIN_GAP_MS, with one trailing read so
 * the last change is never left unpublished.
 */

export interface SeatHeadRow {
  user_id: string | null;
  current_bounty: number | string | null;
}

/** A bounty event whose heads belong on the felt. Unknown reads as no. */
export function isSeatBountyEvent(row: unknown): boolean {
  const t = row as Record<string, unknown> | null | undefined;
  if (!t) return false;
  return t.is_bounty === true || t.is_pko === true || t.is_mystery_bounty === true;
}

/** The ledger's heads by user. A malformed row is left out, never guessed. */
export function headsFromRows(rows: readonly SeatHeadRow[]): Map<string, number> {
  const heads = new Map<string, number>();
  for (const row of rows) {
    const userId = typeof row?.user_id === 'string' ? row.user_id : '';
    if (row?.current_bounty == null) continue;
    const head = Number(row.current_bounty);
    if (!userId || !Number.isFinite(head) || head < 0) continue;
    heads.set(userId, Math.round(head * 100) / 100);
  }
  return heads;
}

export interface SeatHeadsDeps {
  /** One bounded read of the event's roster heads; null when the read failed. */
  read: () => Promise<readonly SeatHeadRow[] | null>;
  /** Hand the ledger heads to every table engine of the event. */
  publish: (heads: ReadonlyMap<string, number>) => void;
  /** Wall clock in ms. */
  now: () => number;
  /** Run fn after delayMs. */
  later: (fn: () => void, delayMs: number) => void;
  report: (error: Error) => void;
}

export const SEAT_HEADS_MIN_GAP_MS = 1_500;

export class SeatHeadsRefresher {
  private inFlight = false;
  private pending = false;
  private trailingArmed = false;
  private lastStartedAt = -Infinity;
  private latest: ReadonlyMap<string, number> | null = null;
  private failureReported = false;

  constructor(private readonly deps: SeatHeadsDeps) {}

  /** The heads last read from the ledger, for an engine that joins later. */
  current(): ReadonlyMap<string, number> | null {
    return this.latest;
  }

  /** Ask for a fresh read. Coalesced: never more than one read in flight. */
  request(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    const wait = this.lastStartedAt + SEAT_HEADS_MIN_GAP_MS - this.deps.now();
    if (wait > 0) {
      this.pending = true;
      if (!this.trailingArmed) {
        this.trailingArmed = true;
        this.deps.later(() => {
          this.trailingArmed = false;
          if (this.pending) {
            this.pending = false;
            this.request();
          }
        }, wait);
      }
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    this.inFlight = true;
    this.pending = false;
    this.lastStartedAt = this.deps.now();
    try {
      const rows = await this.deps.read();
      if (rows) {
        this.failureReported = false;
        this.latest = headsFromRows(rows);
        this.deps.publish(this.latest);
      } else if (!this.failureReported) {
        this.failureReported = true;
        this.deps.report(
          new Error('seat bounty heads could not be read; the felt keeps its last heads')
        );
      }
    } catch (err) {
      if (!this.failureReported) {
        this.failureReported = true;
        this.deps.report(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        this.request();
      }
    }
  }
}
