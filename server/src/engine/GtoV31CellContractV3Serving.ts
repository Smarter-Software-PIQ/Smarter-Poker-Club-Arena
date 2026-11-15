/**
 * V31 CELL CONTRACT v3 SERVING SWITCH (FLOP-5 D6, 2026-11-15). DORMANT, DEFAULT OFF.
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
 * It is ON only when the engine process environment sets
 * GTO_V31_CELL_CONTRACT_V3_SERVING=on (exactly that value). It is deliberately
 * not a HorseDataLedger decision option: V31 rows are refused by the fleet
 * option switch, and turning v3 on needs a sealed v3 dataset, a serving binding
 * and a release, each with its own owner authority. Nothing sets it today.
 */
export const GTO_V31_CELL_CONTRACT_V3_SERVING_ENV = 'GTO_V31_CELL_CONTRACT_V3_SERVING';

let testOverride: boolean | null = null;

export function gtoV31CellContractV3ServingOn(): boolean {
  if (testOverride !== null) return testOverride;
  return process.env[GTO_V31_CELL_CONTRACT_V3_SERVING_ENV] === 'on';
}

/** Test seam only. null restores the environment reading. */
export function _setGtoV31CellContractV3ServingForTest(value: boolean | null): void {
  testOverride = value;
}
