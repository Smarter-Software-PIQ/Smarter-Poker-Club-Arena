/**
 * LAW - A ROSTER EDGE READS ONLY ITS OWN RAKE (2026-11-19)
 *
 * 20261119063000's fn_union_agent_roster_sustained_edge expanded every rake
 * record of the 7-day window (541,753 rows) before joining the roster: 24 s
 * per agent, and the union-integrity-sweep cron hit its 120 s timeout at 10:33
 * and 11:33 UTC. Migration 20261119120000 drives the rake leg from the roster
 * through the player_contributions GIN index, keeps the same proportional share
 * and scope test, and proves the open-alert workload fits before COMMIT.
 */
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_roster_edge_reads_only_its_own_rake.sql'))
  .at(-1);
if (!NAME) throw new Error('the roster rake repair migration is missing');
const MIG = migrationText(NAME);

describe('a roster edge reads only its own rake', () => {
  it('the rake leg starts from the roster through the contributions index', () => {
    expect(MIG).toContain('FROM roster r\n      CROSS JOIN LATERAL (');
    expect(MIG).toContain('WHERE x.player_contributions ? (r.player_id::text)');
    expect(MIG).toContain('rr.player_contributions ->> (r.player_id::text)');
  });

  it('never expands the whole window before joining the roster', () => {
    expect(MIG).not.toContain('JOIN roster r ON r.player_id = (e.key)::uuid');
  });

  it('is evaluated after the sweep cheap conditions and stays service-only', () => {
    expect(MIG).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER\nCOST 10000/);
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_union_agent_roster_sustained_edge(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('proves the open-alert workload fits the sweep budget before COMMIT', () => {
    const proof = MIG.indexOf('-- @probe-for: public.fn_union_agent_roster_sustained_edge');
    expect(proof).toBeGreaterThan(MIG.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(proof).toBeLessThan(MIG.lastIndexOf('COMMIT;'));
    expect(MIG).toContain("interval '60 seconds'");
  });
});
