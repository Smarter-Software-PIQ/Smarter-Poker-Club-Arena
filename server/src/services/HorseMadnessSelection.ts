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

export function orderMadnessCandidates<T extends { h: { id: string }; w: number }>(
  candidates: readonly T[],
  table: {
    game_variant?: unknown;
    bomb_pot_enabled?: unknown;
    big_blind_ante_enabled?: unknown;
    nit_game?: unknown;
    maintain_percent_min?: unknown;
  },
  performance: ReadonlyMap<string, PloPerformance>
): T[] {
  const madness =
    String(table.game_variant ?? '').toLowerCase() === 'plo5' &&
    table.bomb_pot_enabled === true &&
    table.big_blind_ante_enabled === true &&
    table.nit_game === true &&
    // 50 IS THE MADNESS PIN, NOT A THRESHOLD (2026-11-17).
    //
    // This is an identity test for the Madness ruleset, not "a high floor".
    // fn_cash_game_floor_from_template pins vpip_floor to 50 for the
    // madness_without_lightning profile, explicitly, before the GREATEST that
    // raises a Classic floor from ca_classic_vpip_floors - so 50 is the value
    // only that profile carries.
    //
    // It used to be ambiguous: Classic plo5/plo6 also sat at 50, so this read
    // true for tables that were never Madness. Dan lowered the Classic PLO
    // floor to 40 on 2026-11-17 (migration 20261118004324), which is what makes
    // the check exact rather than coincidental.
    //
    // Do not turn this into a >= comparison and do not move the number. That
    // migration and 20261024200548's @live-proof both assert the cluster still
    // reads exactly 50, and widening this would start ordering horses by
    // measured PLO performance at tables that are not Madness.
    Number(table.maintain_percent_min) === 50;
  return candidates
    .map((candidate) => ({
      candidate,
      preference: madness ? measuredPloPreference(performance.get(candidate.h.id)) : 0,
    }))
    .sort((a, b) => b.preference - a.preference || b.candidate.w - a.candidate.w)
    .map(({ candidate }) => candidate);
}
