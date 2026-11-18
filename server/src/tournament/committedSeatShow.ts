/**
 * A TOURNAMENT CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-18).
 *
 * Dan, verbatim: "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY
 * OTHER REASON, THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."
 *
 * ROOT CAUSE. A table engine reads its roster only at the hand boundary. A
 * tournament seat is never committed by that engine: the manager moves a
 * player in through fn_ca_move_tournament_seat (balancing, a table break), or
 * the database seats one (late registration, re-entry) or refills one (a
 * rebuy) and leaves a manager wake. The manager told the destination engine
 * only to stop sleeping (`wakeWaitingForPlayers`), which does nothing at a
 * table with a hand in the air or parked on a break. Until that table's next
 * hand boundary the chair was drawn empty, or as the busted player who used
 * to hold it, or as its own occupant with the zero read before the rebuy.
 * The cash repair of 2026-11-17 (SeatArrivalDisplay) refuses tournament
 * tables because its signal comes from the buyer's browser.
 *
 * THE REPAIR. The manager is the party that knows, so the manager tells the
 * engine, and the engine reads the committed rows itself:
 *
 *   moved    a move this manager's RPC certified. The destination table shows
 *            its committed rows now.
 *   request  the database committed a seat or a stack somewhere in this field
 *            (a `late_registration`, `rebuy` or `reentry` wake). One light
 *            read of the field's live seats; only a table whose rows differ
 *            from what it shows reads its roster.
 *
 * DISPLAY ONLY. Nothing here writes a row, and nothing an engine shows from
 * it enters a hand, a pot, the button, a blind, an elimination, a bounty or
 * any money path. Each table still adopts its hand roster only at its hand
 * boundary, which supersedes everything shown from here.
 */

export interface CommittedSeatRow {
  table_id: string;
  user_id: string;
  occupancy_id: string | null;
  seat_number: number;
  stack: number;
}

export interface SeatShowingEngine {
  tournamentSeatsNeedShowing(rows: ReadonlyArray<CommittedSeatRow>): boolean;
  showCommittedTournamentSeats(): Promise<void>;
}

export interface CommittedSeatShowDeps {
  /** The table engines this manager owns right now. */
  tables(): Array<[string, SeatShowingEngine]>;
  /** Live seats of those tables; null when the read was not complete. */
  readSeats(tableIds: string[]): Promise<CommittedSeatRow[] | null>;
  /** False once the manager has stopped or lost its field. */
  active(): boolean;
  report(error: unknown, context: string): void;
}

export class CommittedSeatShow {
  private inFlight: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: CommittedSeatShowDeps) {}

  /** A certified move landed at this table. */
  moved(tableId: string): void {
    if (!this.deps.active()) return;
    const engine = this.deps.tables().find(([id]) => id === tableId)?.[1];
    if (!engine) return;
    engine
      .showCommittedTournamentSeats()
      .catch((error) => this.deps.report(error, 'Tournament.committed_seat_show_move_failed'));
  }

  /**
   * The database committed a seat or a stack in this field. One pass in
   * flight; a request that arrives during it is answered by one more pass.
   */
  request(): Promise<void> {
    if (!this.deps.active()) return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const run = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again && this.deps.active());
    })()
      .catch((error) => this.deps.report(error, 'Tournament.committed_seat_show_failed'))
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
        this.again = false;
      });
    this.inFlight = run;
    return run;
  }

  private async pass(): Promise<void> {
    const tables = this.deps.tables();
    if (tables.length === 0) return;
    const rows = await this.deps.readSeats(tables.map(([id]) => id));
    // An incomplete read is unknown, never "nobody sits there".
    if (rows === null || !this.deps.active()) return;
    const byTable = new Map<string, CommittedSeatRow[]>();
    for (const row of rows) {
      const list = byTable.get(row.table_id);
      if (list) list.push(row);
      else byTable.set(row.table_id, [row]);
    }
    const owned = new Map(this.deps.tables());
    await Promise.all(
      tables.map(async ([tableId, engine]) => {
        if (owned.get(tableId) !== engine) return;
        if (!engine.tournamentSeatsNeedShowing(byTable.get(tableId) ?? [])) return;
        await engine.showCommittedTournamentSeats();
      })
    );
  }
}

/** The manager wake reasons that mean a seat row or its stack was committed. */
export function wakeCommitsASeat(reason: unknown): boolean {
  return reason === 'late_registration' || reason === 'rebuy' || reason === 'reentry';
}
