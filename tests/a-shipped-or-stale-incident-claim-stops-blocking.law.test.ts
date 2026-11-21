/**
 * A SHIPPED OR STALE INCIDENT CLAIM STOPS BLOCKING (2026-11-20).
 *
 * Incident 1e532243 (fn_ca_hand_gap_watch) stayed "claimed ... do not start a
 * second fix" for hours after its claimed fix, PR #11520, merged at
 * 2026-11-20 16:51 UTC and the incident recurred at 17:51, because the owner
 * kept renewing with the same branch and PR. The claim primitive now:
 *   - caps every claim and renewal at 8 hours after its last progress (taken,
 *     or a changed branch or PR), and refuses an unchanged renewal past it;
 *   - stops blocking once the claim's PR has merged and the incident fired
 *     again ('recurrence' or 'refire') after that merge, the merge time read
 *     from GitHub only when a rival is refused, before any lock, with unknown
 *     kept as unknown;
 *   - records every takeover as a 'claim_superseded' incident event.
 * Proven on PostgreSQL by scripts/ci/qualify-reliability-incident-claims.py.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const files = readdirSync('supabase/migrations').filter((f) =>
  f.endsWith('_a_shipped_or_stale_incident_claim_stops_blocking.sql'));
const sql = () => read(`supabase/migrations/${files[0]}`);

describe('a shipped or stale incident claim stops blocking', () => {
  it('bounds a claim by progress, not by how often it is renewed', () => {
    expect(files).toHaveLength(1);
    const s = sql();
    expect(s).toContain("c_lifetime constant interval := interval '8 hours'");
    expect(s).toContain('expires_at = least(v_now + p_ttl, k.progress_at + c_lifetime)');
    expect(s).toContain("_renewal_needs_a_new_branch_or_pull_request'");
    expect(s).toContain("WHEN p_at >= k.progress_at + c_lifetime THEN 'lifetime_spent'");
    expect(s).toContain('progress_at  = v_now');
  });

  it('stops blocking when the claimed PR merged and the incident fired again after it', () => {
    const s = sql();
    expect(s).toContain("e.kind IN ('recurrence', 'refire')");
    expect(s).toContain('AND e.at > k.pr_merged_at');
    expect(s).toContain("THEN 'shipped_and_recurred'");
    // GitHub is asked before any row lock, only for a rival refused by a PR claim.
    const ask = s.indexOf('v_merged := smarter_private.reliability_claim_pr_merged_at(v_seen.pull_request)');
    const lock = s.indexOf('WHERE incident_id = p_incident_id FOR UPDATE');
    expect(ask).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(ask);
    expect(s).toContain("'not_merged_or_unknown'");
  });

  it('never deletes a superseded claim silently and keeps the browser roles out', () => {
    const s = sql();
    expect(s).toContain("'claim_superseded'");
    expect(s).toContain("'previous', to_jsonb(k)");
    expect(s).toMatch(/REVOKE ALL ON FUNCTION smarter_private\.fn_claim_reliability_incident\([^)]*\) FROM PUBLIC, anon, authenticated;/);
    expect(s).toMatch(/REVOKE ALL ON FUNCTION smarter_private\.reliability_claim_pr_merged_at\(text\) FROM PUBLIC, anon, authenticated;/);
  });

  it('says so in the handoff, is proven on PostgreSQL and is written down for every agent', () => {
    const s = sql();
    expect(s).toContain("'Owner: unassigned, needs an AI coding agent. The claimed fix shipped and the incident recurred: '");
    expect(s).toContain('passed its 8-hour lifetime without a new branch or PR');
    expect(s).toContain('    || smarter_private.reliability_claim_owner_line(i.id)');
    const q = read('scripts/ci/qualify-reliability-incident-claims.py');
    expect(q).toContain("install(ROOT, psql, 'a_shipped_or_stale_incident_claim_stops_blocking')");
    expect(q).toContain('superseded_shipped_and_recurred');
    expect(q).toContain('superseded_lifetime_spent');
    expect(read('.github/workflows/reliability-controller-stage-b.yml')).toContain(
      'supabase/migrations/*_a_shipped_or_stale_incident_claim_stops_blocking.sql');
    const doc = read('CLAUDE.md');
    expect(doc).toContain('8 hours after its last progress');
    expect(doc).toContain('the claimed fix shipped and the incident recurred');
  });
});
