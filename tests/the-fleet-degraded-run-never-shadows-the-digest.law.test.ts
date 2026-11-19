/**
 * LAW - THE FLEET DEGRADED RUN NEVER SHADOWS THE DIGEST (2026-11-19)
 *
 * #11308 added max_degraded_run to fn_sp_daily_metrics_compute with a derived
 * column aliased `d`; the function DECLAREs `d jsonb`, so PL/pgSQL could not
 * resolve `WHERE d` and sp-daily-metrics-snapshot failed on every run from
 * 06:15 UTC. Migration 20261119083000 names the column is_degraded, reads it
 * qualified, and proves the new body by its md5 read-back before COMMIT.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_the_fleet_degraded_run_never_shadows_the_digest.sql'))
  .at(-1);
if (!NAME) throw new Error('the degraded-run alias migration is missing');
const MIG = migrationText(NAME);

describe('the fleet degraded run never shadows the digest', () => {
  it('pins the compute function by preimage and postimage', () => {
    expect(MIG).toContain(
      "'public.fn_sp_daily_metrics_compute(date)',\n  'd28b32a8562f5b24035f7fc0d1323326', 'defe7f21cf46a34c59ff1d374b455e25'"
    );
    expect(MIG).toContain('already the postimage, nothing to do');
  });

  it('the derived column is named apart from every declared variable and read qualified', () => {
    expect(MIG).toContain('$n1$COALESCE(degraded, false) AS is_degraded, count(*) FILTER$n1$');
    expect(MIG).toContain('$n2$FROM hb) r WHERE r.is_degraded GROUP BY grp$n2$');
  });

  it('proves the body by its postimage read-back and installs within the applier budget', () => {
    // 2026-11-19: the pre-commit probe ran the whole digest and production
    // refused the file at 10:20 UTC (25P04, 12 s budget). The md5 read-back
    // inside dmc_subst proves the replaced body instead.
    expect(MIG).toContain('the replaced function does not read back as the postimage');
    expect(MIG).toMatch(/^-- @probe-exempt: public\.fn_sp_daily_metrics_compute .{20,}$/m);
    expect(MIG).not.toContain('PERFORM public.fn_sp_daily_metrics_compute(');
  });
});
