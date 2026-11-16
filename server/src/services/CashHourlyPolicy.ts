/** Consumer protocol used by both admission/closure calls and health evidence.
 * Bump this contract when the engine changes how it applies these doors.
 */
export const cashHourlyPolicy = Object.freeze({
  contract: 'cash-hourly-tables/v1',
  admissionsRpc: 'fn_cash_hourly_table_admissions',
  closeRpc: 'fn_cash_hourly_table_close',
} as const);
