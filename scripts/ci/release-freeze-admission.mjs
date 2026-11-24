/**
 * A HAND INSTALL RESPECTS THE NIGHTLY RELEASE SCHEMA FREEZE (2026-11-24).
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
 */
import { inReleaseSchemaFreeze, RELEASE_SCHEMA_FREEZE_CHICAGO } from './merged-migration-dispatch.mjs';

export const RELEASE_FREEZE_OVERRIDE_MIN_LENGTH = 20;

const hhmm = ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export function releaseFreezeAdmission({ nowMs, dryRun = false, maintenanceWindow = false, override = null }) {
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite epoch millisecond');
  if (!inReleaseSchemaFreeze(nowMs)) return { admit: true, basis: 'outside_freeze' };
  if (dryRun) return { admit: true, basis: 'dry_run' };
  if (maintenanceWindow) return { admit: true, basis: 'maintenance_window_route' };
  const why = typeof override === 'string' ? override.trim() : '';
  if (why.length >= RELEASE_FREEZE_OVERRIDE_MIN_LENGTH) {
    return { admit: true, basis: 'outage_override', override: why };
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
