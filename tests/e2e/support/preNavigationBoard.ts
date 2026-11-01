import { classifyBoardEnding, type TournamentBoardFacts } from './tournamentBoardEnding';

/** Only durable normal endings may release a pre-navigation candidate. */
export function endedBeforeNextHand(
  start: TournamentBoardFacts | undefined,
  end: TournamentBoardFacts | undefined
): boolean {
  if (
    !start ||
    !end ||
    start.tableId !== end.tableId ||
    !start.tournamentId ||
    start.tournamentId !== end.tournamentId ||
    classifyBoardEnding(start) !== 'running'
  )
    return false;
  if (classifyBoardEnding(end) === 'natural-completion') return true;
  const selected = start.seatedUserIds ?? [];
  const accounted = new Set([...(end.relocatedUserIds ?? []), ...(end.eliminatedUserIds ?? [])]);
  return (
    end.tournamentStatus === 'RUNNING' &&
    end.tableStatus === 'closed' &&
    end.seatStacks.length === 0 &&
    end.seatedUserIds?.length === 0 &&
    selected.length >= 2 &&
    new Set(selected).size === selected.length &&
    (end.relocatedUserIds?.length ?? 0) > 0 &&
    selected.every((id) => accounted.has(id))
  );
}

export type ProgressBaseline = { tableId: string; handCount: number };
export type PreNavigationSelection<T extends ProgressBaseline> = {
  baselines: T[];
  facts: Map<string, TournamentBoardFacts>;
  excluded: Set<string>;
  failed: Set<string>;
  /** Ineligible admission subjects; never classified as natural endings. */
  retired?: Set<string>;
  deadline: number;
};

/** A parked admission candidate is never a witnessed continuity pass. */
export function retirePausedPreNavigationSubjects<T extends ProgressBaseline>(
  state: PreNavigationSelection<T>,
  samples: readonly (ProgressBaseline & {
    running?: boolean;
    paused: boolean;
    msSinceProgress: number;
    loopPhase?: string;
  })[],
  maxSilenceMs: number,
  observedAt: number
) {
  const retired = [];
  for (const baseline of state.baselines) {
    const sample = samples.find((row) => row.tableId === baseline.tableId);
    if (
      !sample ||
      !sample.running ||
      sample.paused !== true ||
      sample.handCount < baseline.handCount ||
      state.failed.has(baseline.tableId) ||
      state.excluded.has(baseline.tableId) ||
      state.retired?.has(baseline.tableId) ||
      !Number.isFinite(sample.msSinceProgress) ||
      sample.msSinceProgress < 0 ||
      sample.msSinceProgress > maxSilenceMs
    )
      continue;
    (state.retired ??= new Set()).add(baseline.tableId);
    retired.push({
      tableId: baseline.tableId,
      reason: 'paused_before_navigation',
      baselineHandCount: baseline.handCount,
      currentHandCount: sample.handCount,
      msSinceProgress: sample.msSinceProgress,
      loopPhase: sample.loopPhase,
      observedAt,
    });
  }
  return retired;
}

/** The production poll's actual subject retirement and readmission step. */
export async function refreshPreNavigationSelection<T extends ProgressBaseline>(
  state: PreNavigationSelection<T>,
  reader:
    | {
        boardFacts(ids: string[], deadline?: number): Promise<Map<string, TournamentBoardFacts>>;
        accountClosedBoard(
          start: TournamentBoardFacts,
          end: TournamentBoardFacts,
          deadline?: number
        ): Promise<TournamentBoardFacts>;
      }
    | undefined,
  discover: (deadline: number) => Promise<T[]>
): Promise<boolean> {
  if (reader && state.baselines.length) {
    const latest = await reader.boardFacts(
      state.baselines.map((table) => table.tableId),
      state.deadline
    );
    for (const baseline of state.baselines) {
      if (state.retired?.has(baseline.tableId)) continue;
      const start = state.facts.get(baseline.tableId);
      let end = latest.get(baseline.tableId);
      if (start && end?.tableStatus === 'closed' && end.tournamentStatus === 'RUNNING')
        end = await reader.accountClosedBoard(start, end, state.deadline);
      if (!state.failed.has(baseline.tableId) && endedBeforeNextHand(start, end))
        state.excluded.add(baseline.tableId);
    }
  }
  state.baselines = state.baselines.filter(
    (table) => !state.excluded.has(table.tableId) && !state.retired?.has(table.tableId)
  );
  if (state.baselines.length) return false;
  state.baselines = (await discover(state.deadline)).filter(
    (table) => !state.excluded.has(table.tableId) && !state.retired?.has(table.tableId)
  );
  state.facts = reader
    ? await reader.boardFacts(
        state.baselines.map((table) => table.tableId),
        state.deadline
      )
    : new Map();
  return true; // Readmission is never next-hand proof.
}

export function nextHandAdvanced(
  baseline: ProgressBaseline,
  current: ProgressBaseline | null
): boolean {
  return (
    current !== null &&
    current.tableId === baseline.tableId &&
    current.handCount > baseline.handCount
  );
}
