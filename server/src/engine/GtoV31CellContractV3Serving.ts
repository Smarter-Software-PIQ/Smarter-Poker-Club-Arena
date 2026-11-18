/**
 * V31 CELL CONTRACT v3 SERVING SWITCH (FLOP-5 D6, 2026-11-15). DORMANT, OFF.
 *
 * Cell contract v3 (#10710) keys a certified V31 cell by its public line
 * (line_class) as well as the 13 v2 context fields, and adds the 200 bb bucket
 * and the 'donk' role. This switch decides two things, and nothing else:
 *   - GtoPostflopV31Loader reads the v3 cell readers (fn_gto_v31_active_cells_v3,
 *     fn_gto_v31_evaluation_cells_v3), which also carry cell_contract_version and
 *     line_class; OFF, it reads the v2 readers exactly as before.
 *   - HorseV31CertifiedPolicy consults a loaded store that declares cell
 *     contract v3 with the v3 context (classifyGtoDecisionContextV3 and
 *     gtoStreetAdviceV31V3); OFF, or with any v2 store, the v2 consult runs
 *     exactly as before.
 *
 * It is the registered decision option `gtoV31CellContractV3Serving` of the
 * live option switch (HorseDataLedger flag, HorseOptionSwitch registry, the
 * database whitelist of the registry's follow-up migration, the replay state).
 * No row, or any switch failure, is the release default: not passed, OFF. The
 * environment variable that carried it before (GTO_V31_CELL_CONTRACT_V3_SERVING)
 * is gone: nothing reads it.
 *
 * ON IS HELD. The option is off-only under the owner's R7/R8 hold (the V31
 * solver store is registration-gated, HorseOptionSwitch.ts): the switch offers
 * `off` and clear, never `on`, and the database refuses an `on` row from any
 * writer. Lifting the hold for this one name is a reviewed source change to
 * OPTION_SWITCH_OFF_ONLY; serving v3 also needs a sealed, promoted and bound v3
 * dataset. Nothing switches it on today.
 *
 * TWO READINGS, ONE VALUE. A decision reads the option it was passed
 * (gtoV31CellContractV3ServingOn(opts)). The loader has no decision: it reads
 * this process's latest switched value, which the decision worker reports at
 * every switch read (noteGtoV31CellContractV3ServingSwitch); a change reloads
 * the store (onGtoV31CellContractV3ServingChange), so the store and the
 * decisions follow the same row within one load. While the two differ the
 * decision is never served a mismatched cell: a v3 consult needs a v3 store,
 * and a v2 key never matches a v3 cell.
 */
export const GTO_V31_CELL_CONTRACT_V3_SERVING_OPTION = 'gtoV31CellContractV3Serving' as const;

let testOverride: boolean | null = null;
let switched: boolean | undefined;
let listener: (() => void) | null = null;

/** The decision's reading: true only when the live switch passed the option (opts.gtoV31CellContractV3Serving) true. */
export function gtoV31CellContractV3ServingOn(passed?: boolean): boolean {
  if (testOverride !== null) return testOverride;
  return passed === true;
}

/** The loader's reading: this process's latest switched value (none = the release default, OFF). */
export function gtoV31CellContractV3ServingLoaderOn(): boolean {
  if (testOverride !== null) return testOverride;
  return switched === true;
}

/**
 * The decision worker reports the value the live switch gives the option at each read (`undefined`: no row, or the
 * switch failed). Only a change of the ON reading calls the listener.
 */
export function noteGtoV31CellContractV3ServingSwitch(value: boolean | undefined): void {
  const was = switched === true;
  switched = value;
  if ((value === true) !== was && listener) listener();
}

/** The loader's reload on a change of the switched value; null removes it. */
export function onGtoV31CellContractV3ServingChange(fn: (() => void) | null): void {
  listener = fn;
}

/** Test seam only: forces both readings. null restores the switch readings. */
export function _setGtoV31CellContractV3ServingForTest(value: boolean | null): void {
  testOverride = value;
}

/** Test seam only: forgets the reported switch value and the listener. */
export function _resetGtoV31CellContractV3ServingSwitchForTest(): void {
  switched = undefined;
  listener = null;
}
