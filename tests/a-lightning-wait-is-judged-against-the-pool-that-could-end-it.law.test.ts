/**
 * LAW - A LIGHTNING WAIT IS JUDGED AGAINST THE POOL THAT COULD END IT (2026-11-19)
 *
 * lightning_alerts paged LIGHTNING_LATENCY_REGRESSION for idle_to_match and
 * fast_fold_to_next_hand on every Lightning cluster whose pool was thin
 * (563279fc held 4-8 players for 72 h: median p95 15-20 s, ~100% of windows
 * over the 5,000 ms ceiling). A wait for a new table is set by how many
 * players can end it; 16-24 held players gave a median p95 of 3.9 s.
 * Migration 20261119174500 judges the four wait legs only when every window
 * under judgement held the minimum pool (3 x handedness, or the cluster's own
 * alert_latency_wait_min_pool), keeps the server legs as they were, and still
 * pages a full pool that waits past the ceiling.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_lightning_wait_is_judged_against_the_pool_that_could_end_it.sql'))
  .at(-1);
if (!NAME) throw new Error('the pool-aware Lightning latency migration is missing');
const MIG = migrationText(NAME);
const NEW = MIG.slice(MIG.indexOf('$n2$'), MIG.lastIndexOf('$n2$'));
const PROBE = MIG.slice(MIG.indexOf('-- @probe-for: public.fn_lightning_latency_regression'));

describe('a Lightning wait is judged against the pool that could end it', () => {
  it('pins fn_lightning_latency_regression by preimage and postimage', () => {
    expect(MIG).toContain(
      "'public.fn_lightning_latency_regression(uuid,text,jsonb,timestamp with time zone)',\n  'ccf233af7e943e8cae65d2c244a83dc6', '0985049d6eeba764739b127e27b5ed70'"
    );
    expect(MIG).toContain('already the postimage, nothing to do');
    expect(MIG).toContain('owner, security, settings or grants moved');
  });

  it('the wait legs are exactly the four that end when a table forms', () => {
    expect(MIG).toMatch(
      /p_leg IN \('idle_to_match', 'fast_fold_to_next_hand',\s+'normal_fold_to_next_hand', 'fold_watch_to_next_hand'\)/
    );
    for (const server of ['fold_ack', 'ack_to_idle', 'match_to_hand', 'hand_to_first_render']) {
      expect(PROBE).toContain(`OR public.fn_lightning_latency_leg_is_wait('${server}')`);
    }
  });

  it('the minimum pool is three rings of the handedness unless the cluster names its own', () => {
    expect(MIG).toContain(
      "coalesce((p_cfg ->> 'alert_latency_wait_min_pool')::integer,\n                           3 * GREATEST(coalesce((p_cfg ->> 'handedness')::integer, 6), 2)), 0)"
    );
  });

  it('a pool is the players whose slot was open through the whole window', () => {
    expect(MIG).toContain('AND s.opened_at <= p_from');
    expect(MIG).toContain('AND (s.closed_at IS NULL OR s.closed_at >= p_to)');
    expect(MIG).toContain('count(DISTINCT s.player_id)');
  });

  it('a wait leg under the minimum pool is no regression; the pool is measured only once the latency holds', () => {
    const gate = NEW.indexOf(
      'IF v_out IS NOT NULL AND public.fn_lightning_latency_leg_is_wait(p_leg) THEN'
    );
    const thin = NEW.indexOf(
      "WHERE (y.e ->> 'pool')::integer < public.fn_lightning_latency_wait_min_pool(p_cfg)) THEN\n      RETURN NULL;"
    );
    expect(gate).toBeGreaterThan(NEW.indexOf('FROM w;'));
    expect(thin).toBeGreaterThan(gate);
    expect(NEW.indexOf('v_out := v_pool;')).toBeGreaterThan(thin);
    expect(NEW.trimEnd().endsWith('RETURN v_out;')).toBe(true);
  });

  it('the probe proves the thin pool, the full pool and the server leg before COMMIT', () => {
    expect(PROBE).toContain("RAISE EXCEPTION 'a wait leg of a thin pool was judged a regression'");
    expect(PROBE).toContain(
      "RAISE EXCEPTION 'a server leg over its ceiling was not judged a regression'"
    );
    expect(PROBE).toContain(
      'a wait leg over its ceiling in a full pool was not judged a regression'
    );
    expect(PROBE).toContain('"alert_latency_wait_min_pool": 0');
    expect(PROBE).toContain("interval '3 seconds'");
    expect(MIG.indexOf('-- @probe-for:')).toBeGreaterThan(MIG.indexOf('SELECT pg_temp.lwp_subst('));
    expect(MIG.indexOf('-- @probe-for:')).toBeLessThan(MIG.lastIndexOf('COMMIT;'));
  });

  it('the helpers are closed to browser roles', () => {
    for (const sig of [
      'fn_lightning_latency_leg_is_wait(text)',
      'fn_lightning_latency_wait_min_pool(jsonb)',
      'fn_lightning_pool_held(uuid, timestamptz, timestamptz)',
    ]) {
      expect(MIG).toContain(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`
      );
    }
  });
});
