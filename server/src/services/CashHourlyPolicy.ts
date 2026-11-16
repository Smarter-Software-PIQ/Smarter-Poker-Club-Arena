/** Consumer protocol used by both admission/closure calls and health evidence.
 * Bump this contract when the engine changes how it applies these doors.
 */
// Literal RpcName exports keep the existing engine-door discovery authoritative.
export const hourlyCashCloseRpcName = 'fn_cash_hourly_table_close';
export const hourlyCashAdmissionRpcName = 'fn_cash_hourly_table_admissions';

export const cashHourlyPolicy = Object.freeze({
  contract: 'cash-hourly-tables/v1',
  admissionsRpc: hourlyCashAdmissionRpcName,
  closeRpc: hourlyCashCloseRpcName,
} as const);
