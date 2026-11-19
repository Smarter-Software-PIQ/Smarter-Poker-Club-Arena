/**
 * LAW - THE FLEET DEGRADED RUN NEVER SHADOWS THE DIGEST (2026-11-19)
 *
 * #11308 added max_degraded_run to fn_sp_daily_metrics_compute with a derived
 * column aliased `d`; the function DECLAREs `d jsonb`, so PL/pgSQL could not
 * resolve `WHERE d` and sp-daily-metrics-snapshot failed on every run from
 * 06:15 UTC. Migration 20261119083000 names the column is_degraded, reads it
 * qualified, and executes the new body before COMMIT.
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

  it('executes the new body before COMMIT on a day with no rows', () => {
    const probe = MIG.indexOf('-- @probe-for: public.fn_sp_daily_metrics_compute');
    expect(probe).toBeGreaterThan(MIG.indexOf('SELECT pg_temp.dmc_subst('));
    expect(probe).toBeLessThan(MIG.lastIndexOf('COMMIT;'));
    expect(MIG).toContain("PERFORM public.fn_sp_daily_metrics_compute(DATE '2099-01-01');");
  });
});
