import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = readdirSync('supabase/migrations').filter((f) =>
  f.endsWith('_release_incident_handoff_names_sanctioned_triage_workflow.sql')
);

describe('release incident handoff names the sanctioned triage workflow', () => {
  it('enriches class=release claim lines without exposing privileges to browser roles', () => {
    expect(files).toHaveLength(1);
    const sql = readFileSync(`supabase/migrations/${files[0]}`, 'utf8');
    expect(sql).toContain('-- @live-proof:');
    expect(sql).toContain('-- @probe-for: smarter_private.reliability_claim_owner_line');
    expect(sql).toContain("IF v_class = 'release' THEN");
    expect(sql).toContain(
      'gh workflow run triage-engine-release-incident.yml --ref main -f operation=inspect -f incident_id='
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_claim_owner_line(uuid) FROM PUBLIC, anon, authenticated;'
    );
    const qualifier = readFileSync('scripts/ci/qualify-reliability-incident-claims.py', 'utf8');
    expect(qualifier).toContain(
      "install(ROOT, psql, 'release_incident_handoff_names_sanctioned_triage_workflow')"
    );
    expect(qualifier).toContain('def release_handoff_enrichment(');
    const wf = readFileSync('.github/workflows/reliability-controller-stage-b.yml', 'utf8');
    expect(wf).toContain(
      'supabase/migrations/*_release_incident_handoff_names_sanctioned_triage_workflow.sql'
    );
  });
});
