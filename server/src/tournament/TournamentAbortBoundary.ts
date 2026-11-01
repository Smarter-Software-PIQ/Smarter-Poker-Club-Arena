export interface AbortBoundaryTable {
  table_id: string;
  lifecycle: string;
  required: boolean;
  durable_hand_number?: number;
  cancellable_permit_id?: string | null;
  cancellable_hand_hash?: string | null;
}

export interface AbortBoundaryRequest {
  operation_id: string;
  closureMode?: 'equal_share';
  tournament_id: string;
  current_generation: string;
  tables: AbortBoundaryTable[];
}

export interface AbortBoundaryEngine {
  parkForTournamentAbort(maxWaitMs: number): Promise<boolean>;
  prepareTournamentAbortBoundary(): Promise<void>;
  captureParkedTournamentAbortIdentity(
    tableId: string,
    tournamentId: string,
    generation: string
  ): {
    lifecycle: string;
    hand_number: number;
    engine_id: string;
    allocation_epoch: string | null;
  } | null;
  retireTournamentAbortBoundary(): Promise<void>;
  captureStoppedTournamentAbortIdentity: AbortBoundaryEngine['captureParkedTournamentAbortIdentity'];
}

/** One explicit request owns these originals even after HTTP disconnection.
 * Repeating the operation joins in-flight work; a pending result retains the
 * original roster and may be observed again, never exchanged for new engines.
 */
export class TournamentAbortBoundary {
  private active: Promise<unknown> | null = null;
  private completed: unknown = null;
  private retirementStarted = false;
  constructor(
    readonly request: AbortBoundaryRequest,
    private readonly originals: readonly (readonly [string, AbortBoundaryEngine])[],
    private readonly deps: {
      current(): boolean;
      joinManagerTails(): Promise<void>;
      joinRetiredManagerTails(): Promise<void>;
      managerReadyToFence(): boolean;
      fenceManager(): void;
      managerDrained(): boolean;
      captureAbsentTable?(table: AbortBoundaryTable): {
        lifecycle: string;
        hand_number: number;
        engine_id: null;
        allocation_epoch: null;
      } | null;
      prepareAcknowledgement?(
        tableId: string,
        handNumber: number,
        evidence: Record<string, unknown>
      ): Promise<void>;
      acknowledge(
        tableId: string,
        handNumber: number,
        evidence: Record<string, unknown>
      ): Promise<unknown>;
    }
  ) {}

  run(reprove = false): Promise<unknown> {
    if (reprove) this.completed = null;
    if (this.completed) return Promise.resolve(this.completed);
    if (this.active) return this.active;
    const work = this.execute();
    this.active = work;
    void work
      .finally(() => {
        if (this.active === work) this.active = null;
      })
      .catch(() => {});
    return work;
  }

  private async execute(): Promise<unknown> {
    const pending = (reason: string) => ({
      state: 'pending',
      reason,
      operation_id: this.request.operation_id,
      tournament_id: this.request.tournament_id,
    });
    if (!this.deps.current()) return pending('original_owner_changed');
    const required = this.request.tables.filter((table) => table.required);
    const absent = required.filter(
      (table) => !this.originals.some(([id]) => id === table.table_id)
    );
    if (
      required.length === 0 ||
      required.length !== this.originals.length + absent.length ||
      this.originals.some(([id]) => !required.some((table) => table.table_id === id)) ||
      (absent.length > 0 && !this.deps.captureAbsentTable)
    )
      return pending('original_table_coverage_incomplete');
    const archivalCancellation = this.request.closureMode === 'equal_share';
    if (!this.retirementStarted) {
      // Arm every original synchronously before waiting on any individual hand.
      const parked = archivalCancellation
        ? []
        : await Promise.all(
            this.originals.map(([, engine]) => engine.parkForTournamentAbort(30_000))
          );
      if (parked.some((value) => !value)) return pending('accepted_hand_not_parked');
      await this.deps.joinManagerTails();
      if (!this.deps.current()) return pending('original_owner_changed');
      if (!this.deps.managerReadyToFence()) return pending('accepted_manager_tail_pending');
      // Accepted callbacks finish before revocation; callbacks admitted during
      // the final join are fenced synchronously and then physically joined.
      this.deps.fenceManager();
      await this.deps.joinManagerTails();
      if (!archivalCancellation)
        await Promise.all(
          this.originals.map(([, engine]) => engine.prepareTournamentAbortBoundary())
        );
      if (!this.deps.current() || !this.deps.managerDrained())
        return pending('manager_tail_not_drained');
      if (
        !archivalCancellation &&
        this.originals.some(
          ([id, engine]) =>
            engine.captureParkedTournamentAbortIdentity(
              id,
              this.request.tournament_id,
              this.request.current_generation
            ) === null
        )
      )
        return pending('physical_writer_not_drained');
      this.retirementStarted = true;
    }
    // Retire and persist these original child objects before the immutable
    // financial header exists. Their manager lease remains heartbeating.
    // Partial/unknown stops retain this phase and these exact original promises.
    await Promise.all(this.originals.map(([, engine]) => engine.retireTournamentAbortBoundary()));
    await this.deps.joinRetiredManagerTails();
    if (!this.deps.current() || !this.deps.managerDrained())
      return pending('manager_tail_not_drained');
    const capture = (table: AbortBoundaryTable) => {
      const original = this.originals.find(([id]) => id === table.table_id);
      return original
        ? original[1].captureStoppedTournamentAbortIdentity(
            table.table_id,
            this.request.tournament_id,
            this.request.current_generation
          )
        : (this.deps.captureAbsentTable?.(table) ?? null);
    };
    const identities = required.map((table) => [table.table_id, capture(table)] as const);
    if (
      identities.some(
        ([id, identity]) =>
          !identity ||
          !Number.isSafeInteger(identity.hand_number) ||
          identity.hand_number < 0 ||
          required.find((table) => table.table_id === id)?.lifecycle !== identity.lifecycle
      )
    )
      return pending('physical_writer_not_drained');
    const receipts: unknown[] = [];
    for (const phase of ['prepare', 'acknowledge'] as const) {
      for (const [id, identity] of identities) {
        // Re-prove after each network await; no old captured proof authorizes
        // another table after ownership or a physical writer changed.
        const table = required.find((table) => table.table_id === id)!;
        const fresh = capture(table);
        if (
          !fresh ||
          !identity ||
          fresh.engine_id !== identity.engine_id ||
          fresh.lifecycle !== identity.lifecycle ||
          fresh.hand_number !== identity.hand_number ||
          !this.deps.current() ||
          !this.deps.managerDrained()
        )
          return pending('boundary_changed');
        const evidence: Record<string, unknown> = {
          ...fresh,
          kind:
            fresh.engine_id === null
              ? 'tournament_abort_absent_boundary_v2'
              : archivalCancellation
                ? 'tournament_abort_cancelled_boundary_v2'
                : 'tournament_abort_boundary_v1',
          certificate_version: fresh.engine_id === null || archivalCancellation ? '2' : '1',
          ...(this.request.closureMode ? { closure_mode: this.request.closureMode } : {}),
          physical_stopped: true,
          parked_before_retirement: fresh.engine_id !== null && !archivalCancellation,
          ...(fresh.engine_id === null ? { physical_engine_absent: true } : {}),
          drained: true,
          manager_tail_joined: true,
          pending_writers: 0,
          bank_state_write_pending: false,
          source_table_ids: required.map((table) => table.table_id).sort(),
        };
        if (phase === 'prepare')
          await this.deps.prepareAcknowledgement?.(id, fresh.hand_number, evidence);
        else receipts.push(await this.deps.acknowledge(id, fresh.hand_number, evidence));
      }
    }
    this.completed = {
      state: 'acknowledged',
      operation_id: this.request.operation_id,
      tournament_id: this.request.tournament_id,
      receipts,
    };
    return this.completed;
  }
}
