/** Preference only: callers supply candidates that passed every normal seat door.
 * No horse is removed, funded, moved or admitted by this ordering. */
export interface PloPerformance {
  hands: number;
  bb100: number;
}

/** Existing PLO qualification uses 5,000 hands. Shrink a small sample toward
 * neutral by that sample weight, rather than treating a short heater as proven
 * skill. This is an advisory estimate, not a confidence interval or solver grade. */
export function measuredPloPreference(record: PloPerformance | undefined): number {
  if (
    !record ||
    !Number.isFinite(record.hands) ||
    record.hands <= 0 ||
    !Number.isFinite(record.bb100)
  )
    return 0;
  return record.bb100 * (record.hands / (record.hands + 5_000));
}

/**
 * The cluster's ruleset profile for a table row. A caller may hand it over
 * flattened, or leave the embedded relation as PostgREST returned it - an
 * array, or an object when the planner collapses it. A shape this does not
 * recognise reads as "no profile" rather than throwing, because an unreadable
 * cluster must mean "not Madness", never a crash in the seating loop.
 */
function rulesProfileOf(table: { rules_profile?: unknown; cluster?: unknown }): string | null {
  if (typeof table.rules_profile === 'string') return table.rules_profile;
  const row = Array.isArray(table.cluster) ? table.cluster[0] : table.cluster;
  if (!row || typeof row !== 'object') return null;
  const value = (row as { rules_profile?: unknown }).rules_profile;
  return typeof value === 'string' ? value : null;
}

export function orderMadnessCandidates<T extends { h: { id: string }; w: number }>(
  candidates: readonly T[],
  table: {
    game_variant?: unknown;
    bomb_pot_enabled?: unknown;
    big_blind_ante_enabled?: unknown;
    nit_game?: unknown;
    maintain_percent_min?: unknown;
    /** cash_games.ruleset_snapshot->>'rules_profile', flattened by a caller. */
    rules_profile?: unknown;
    /** or the embedded cluster row, as PostgREST returns it. */
    cluster?: unknown;
  },
  performance: ReadonlyMap<string, PloPerformance>
): T[] {
  // MADNESS IS A RULESET, NOT A FLOOR VALUE (2026-11-17).
  //
  // This used to end in `Number(table.maintain_percent_min) === 50`, because 50
  // was the floor fn_cash_game_floor_from_template pinned for the
  // madness_without_lightning profile and nothing else carried it. Dan brought
  // every PLO table to 40 on 2026-11-17 (20261118004324 for Classic,
  // 20261118025205 for Madness), so that number identifies nothing now.
  //
  // Dropping the floor clause and keeping the rest would have been worse than
  // useless: Lightning and Action plo5 tables also run a bomb pot, the
  // big-blind ante and the nit game, so the check would have started calling
  // them Madness and ordering their horses by measured PLO performance.
  //
  // So the test is the ruleset itself, the one the trigger keys on. It is
  // unique: Classic plo5 runs no bomb pot, and Lightning/Action run with
  // lightning_enabled. A floor can move again without touching this.
  // The plo5 scope is kept deliberately: this ordering was built for the PLO5
  // Madness field and measured against it. A future plo6 cluster carrying the
  // same profile does not silently inherit it.
  const madness =
    String(table.game_variant ?? '').toLowerCase() === 'plo5' &&
    rulesProfileOf(table) === 'madness_without_lightning';
  return candidates
    .map((candidate) => ({
      candidate,
      preference: madness ? measuredPloPreference(performance.get(candidate.h.id)) : 0,
    }))
    .sort((a, b) => b.preference - a.preference || b.candidate.w - a.candidate.w)
    .map(({ candidate }) => candidate);
}
