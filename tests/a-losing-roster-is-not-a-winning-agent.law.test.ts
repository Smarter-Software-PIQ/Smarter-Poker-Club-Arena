/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A LOSING ROSTER IS NOT A WINNING AGENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * fn_union_integrity_sweep scored an agent roster on ONE 24 h window with no
 * memory, so a high-variance player who loses over the week raised an
 * agent_roster_winning alert on every winning day. 12 alerts sat open from
 * 2026-10-24 on three agents whose rosters had no 7-day edge (one net -92 over
 * the week, one +8,685 on 6,938 rake, one +1,261 on 142 rake), and the sweep's
 * only close path required the roster list to be empty.
 *
 * Migration 20261119063000:
 *   1. fn_union_agent_roster_sustained_edge(union, agent, days) measures the
 *      roster over N days, scoped exactly as the sweep scopes it (union tables
 *      and tournaments, horses excluded), with the sweep's own ratio.
 *   2. The sweep flags a roster only when its 24 h edge is also sustained over
 *      7 days.
 *   3. An open alert closes on a re-measurement when no roster it names has a
 *      sustained edge, it names no co-seating pair, and none of its direct
 *      transfers is a dump. Co-seating stays a review item for a person.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_losing_roster_is_not_a_winning_agent.sql'))
  .at(-1);
if (!NAME) throw new Error('the sustained roster edge migration is missing');
const MIG = migrationText(NAME);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};
const HELPER = between(
  MIG,
  'CREATE OR REPLACE FUNCTION public.fn_union_agent_roster_sustained_edge(',
  '$f$;'
);

describe('a losing roster is not a winning agent', () => {
  it('pins the sweep by preimage and postimage, and re-apply is a no-op', () => {
    expect(MIG).toContain(
      "'public.fn_union_integrity_sweep(uuid,integer)',\n  '5405e7e915005d18df43dcc8056f3eb0', '307c48cc499243732b05193ec2af9611'"
    );
    expect(MIG).toContain('already the postimage, nothing to do');
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
  });

  it('the roster edge is measured over days, horses excluded, with the sweep ratio', () => {
    expect(HELPER).toContain('make_interval(days => GREATEST(p_days, 1))');
    expect(HELPER).toContain('COALESCE(hp.is_horse, false)');
    expect(HELPER).toContain('m.agent_id = p_agent_id');
    expect(HELPER).toContain('(SELECT v FROM net) > 10 * GREATEST((SELECT v FROM rk), 1)');
  });

  it('the helper is service-only', () => {
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_union_agent_roster_sustained_edge(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_union_agent_roster_sustained_edge(uuid, uuid, integer) TO service_role;'
    );
  });

  it('the sweep flags a roster only when its edge is sustained over 7 days', () => {
    const n1 = between(MIG, '$n1$', '$n1$,');
    expect(n1).toContain('n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)');
    expect(n1).toContain(
      'AND public.fn_union_agent_roster_sustained_edge(p_union_id, n.agent_id, 7);'
    );
  });

  it('an alert closes on re-measurement only, and co-seating stays open for a person', () => {
    const n2 = between(MIG, '$n2$', '$n2$]');
    expect(n2).toContain("jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0");
    expect(n2).toContain(
      "WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, (e->>'agent_user_id')::uuid, 7)"
    );
    expect(n2).toContain('public.fn_union_transfer_counts_as_dump(ct)');
    expect(n2).toMatch(/resolution = 'verified: /);
  });

  it('declares a live proof', () => {
    expect(MIG).toMatch(/@live-proof: .*fn_union_agent_roster_sustained_edge/);
  });
});
