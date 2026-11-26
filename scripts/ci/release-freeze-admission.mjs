/**
 * A HAND INSTALL RESPECTS THE RELEASE SCHEMA FREEZE AND EVERY CYCLE HOLD (2026-11-24, 2026-11-26).
 *
 * #11196 made the merge dispatcher hold every ordinary migration merged inside
 * the release schema freeze (RELEASE_SCHEMA_FREEZE_CHICAGO, 23:45-04:15
 * America/Chicago) and send it at 04:15, so the copy the nightly Backup
 * certifies still equals production at the 03:30 selection. The applier itself
 * never read the freeze, so a hand dispatch (workflow_dispatch, or a
 * repository_dispatch typed by hand) still installed inside it: 2026-11-21
 * 06:38Z (20261121033455) and 2026-11-22 07:15Z (20261122025900). Each made
 * every Backup copy "lack installed migration" and that morning's routine
 * cutover kept serving (daily-engine-selection-2026-11-21 / -22).
 *
 * The freeze is now an applier rule, so no route around the dispatcher can
 * install inside it by accident:
 *   - outside the freeze: admitted, unchanged;
 *   - a dry run reads only: admitted;
 *   - the daily-maintenance / owner window route (--maintenance-window) is the
 *     release's own database break: admitted, its database predicate decides;
 *   - an outage that cannot wait: admitted ONLY with an explicit written
 *     justification (--release-freeze-override "<why>", workflow_dispatch
 *     input release_freeze_override), which is printed in the run so the
 *     stale certificate it causes has a named cause;
 *   - anything else: REFUSED with nothing sent; the dispatcher's own 04:15
 *     send installs it.
 *
 * THE SAME RULE HOLDS BEFORE EVERY THREE-HOURLY CYCLE (2026-11-26). The
 * dispatcher defers an ordinary file through [cycle - 150m, cycle + 10m) of
 * each non-04:00 cycle (O21, THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES) so the copy
 * a candidate certifies on still equals production at its cutoff. The applier
 * read only the nightly freeze, so a hand dispatch at, say, 11:40 Chicago
 * installed 50 minutes before the 13:00 cycle's cutoff, the soak in flight
 * yielded (O16) and the cycle kept serving. A hand install is now held to the
 * dispatcher's own windows, [cycle + 10m, cycle + 30m) and 04:15-04:30, with
 * the same dry-run, maintenance-window and written-outage exceptions. The
 * cadence is read from this revision's maintenanceSchedulePolicy.json; when it
 * cannot be read the hold applies (an unreadable policy is not "daily").
 */
import { readFileSync } from 'node:fs';
import {
  inReleaseSchemaFreeze,
  RELEASE_SCHEMA_FREEZE_CHICAGO,
  THREE_HOURLY_POST_SEAL_CLEAR_MINUTE,
  THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES,
  threeHourlyDeferralWindow,
} from './merged-migration-dispatch.mjs';

const POLICY_URL = new URL(
  '../../server/src/maintenance/maintenanceSchedulePolicy.json',
  import.meta.url
);

/**
 * The cutover cadence this revision declares: 'three-hourly', 'daily', or
 * 'unknown' when the policy cannot be read or names neither.
 */
export function declaredCutoverCadence(read = () => readFileSync(POLICY_URL, 'utf8')) {
  try {
    const frequency = JSON.parse(read())?.frequency;
    return frequency === 'three-hourly' || frequency === 'daily' ? frequency : 'unknown';
  } catch {
    return 'unknown';
  }
}

export const RELEASE_FREEZE_OVERRIDE_MIN_LENGTH = 20;

const hhmm = ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export function releaseFreezeAdmission({
  nowMs,
  dryRun = false,
  maintenanceWindow = false,
  override = null,
  cadence = declaredCutoverCadence(),
}) {
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite epoch millisecond');
  const nightly = inReleaseSchemaFreeze(nowMs);
  // 'unknown' holds like three-hourly: only an explicit 'daily' lifts the cycle hold.
  const cycle = !nightly && cadence !== 'daily' ? threeHourlyDeferralWindow(nowMs) : null;
  if (!nightly && !cycle) return { admit: true, basis: 'outside_freeze' };
  if (dryRun) return { admit: true, basis: 'dry_run' };
  if (maintenanceWindow) return { admit: true, basis: 'maintenance_window_route' };
  const why = typeof override === 'string' ? override.trim() : '';
  if (why.length >= RELEASE_FREEZE_OVERRIDE_MIN_LENGTH) {
    return { admit: true, basis: 'outage_override', override: why };
  }
  if (cycle) {
    return {
      admit: false,
      basis: why ? 'override_too_short' : 'inside_cycle_hold',
      cycle: cycle.cycleLabel,
      clearAt: cycle.clearAt,
      reason:
        `it is inside the ${cycle.cycleLabel} America/Chicago engine cutover hold (from ` +
        `${THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES} minutes before the cycle to ` +
        `${THREE_HOURLY_POST_SEAL_CLEAR_MINUTE} minutes after it` +
        (cadence === 'unknown'
          ? '; the cutover cadence could not be read, so the hold applies'
          : '') +
        `); an install now makes the copy that cycle's candidate certified on lack it and the cycle ` +
        `keeps serving. The merge dispatcher sends held files at ${cycle.clearLabel} (${cycle.clearAt}). ` +
        `Only an outage that cannot wait installs now, with ` +
        `--release-freeze-override "<at least ${RELEASE_FREEZE_OVERRIDE_MIN_LENGTH} characters naming the outage>"` +
        (why ? ` (the given justification is too short)` : '') +
        '. Nothing was sent.',
    };
  }
  const window = `${hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.from)}-${hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.until)} America/Chicago`;
  return {
    admit: false,
    basis: why ? 'override_too_short' : 'inside_freeze',
    reason:
      `it is inside the nightly release schema freeze (${window}); an install now makes every Backup copy ` +
      `lack it and the next routine cutover keeps serving. The merge dispatcher sends held files at ` +
      `${hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.until)}. Only an outage that cannot wait installs now, with ` +
      `--release-freeze-override "<at least ${RELEASE_FREEZE_OVERRIDE_MIN_LENGTH} characters naming the outage>"` +
      (why ? ` (the given justification is too short)` : '') +
      '. Nothing was sent.',
  };
}
