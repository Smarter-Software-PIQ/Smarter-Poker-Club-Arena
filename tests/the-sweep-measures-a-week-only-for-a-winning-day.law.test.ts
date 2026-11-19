/**
 * LAW - THE SWEEP MEASURES A WEEK ONLY FOR A WINNING DAY (2026-11-19)
 *
 * 20261119063000 put the 7-day roster measure in the same WHERE as
 * `n.player_net > 0`; the planner pushed both onto the scan of `net`, so the
 * measure ran for every agent with a positive day and the union sweep cron
 * timed out (300 s) at 10:33 and 11:33 UTC instead of finishing in ~47 s.
 * Migration 20261119121500 fences the 24 h test (OFFSET 0) and filters its
 * output with the 7-day measure, and proves the whole sweep fits before COMMIT.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_the_sweep_measures_a_week_only_for_a_winning_day.sql'))
  .at(-1);
if (!NAME) throw new Error('the sweep fence migration is missing');
const MIG = migrationText(NAME);
const NEW = MIG.slice(MIG.indexOf('$n1$'), MIG.lastIndexOf('$n1$'));

describe('the sweep measures a week only for a winning day', () => {
  it('pins the sweep by preimage and postimage', () => {
    expect(MIG).toContain(
      "'public.fn_union_integrity_sweep(uuid,integer)',\n  '307c48cc499243732b05193ec2af9611', 'f764df872c6812b8186bf2329e670f76'"
    );
    expect(MIG).toContain('already the postimage, nothing to do');
  });

  it('the 24 h test is fenced and the 7-day measure filters only its output', () => {
    const fence = NEW.indexOf('OFFSET 0) f');
    const measure = NEW.indexOf(
      'WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, f.agent_id, 7);'
    );
    expect(fence).toBeGreaterThan(
      NEW.indexOf('AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)')
    );
    expect(measure).toBeGreaterThan(fence);
    expect(NEW).not.toContain(
      'AND public.fn_union_agent_roster_sustained_edge(p_union_id, n.agent_id'
    );
  });

  it('proves the whole sweep fits its cron budget before COMMIT', () => {
    const probe = MIG.indexOf('-- @probe-for: public.fn_union_integrity_sweep');
    expect(probe).toBeGreaterThan(MIG.indexOf('SELECT pg_temp.uis_subst('));
    expect(probe).toBeLessThan(MIG.lastIndexOf('COMMIT;'));
    expect(MIG).toContain("interval '90 seconds'");
  });
});
