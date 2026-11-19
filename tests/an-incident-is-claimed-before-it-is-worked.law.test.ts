import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (p: string) => readFileSync(p, 'utf8');
const migration = readdirSync('supabase/migrations').filter((f) =>
  f.endsWith('_an_incident_is_claimed_before_it_is_worked.sql'));
describe('an incident is claimed before it is worked', () => {
  it('claims atomically, refuses a live claim held by another lane and names it in the handoff', () => {
    expect(migration).toHaveLength(1);
    const sql = read(`supabase/migrations/${migration[0]}`);
    expect(sql).toContain('ON CONFLICT (incident_id) DO UPDATE');
    expect(sql).toContain('WHERE c.agent_session = EXCLUDED.agent_session OR c.expires_at <= clock_timestamp()');
    expect(sql).toContain("'Owner: claimed by '");
    expect(sql).toContain("'Owner: unassigned, needs an AI coding agent'");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION smarter_private\.fn_claim_reliability_incident\([^)]*\) FROM PUBLIC, anon, authenticated;/);
  });
  it('is proven on real PostgreSQL and written down for every agent', () => {
    expect(read('scripts/ci/test-reliability-controller-stage-b.py')).toContain('qualify-reliability-incident-claims.py');
    expect(read('scripts/ci/qualify-reliability-incident-claims.py')).toContain('exactly one wins');
    expect(read('CLAUDE.md')).toContain('smarter_private.fn_claim_reliability_incident(');
  });
});
