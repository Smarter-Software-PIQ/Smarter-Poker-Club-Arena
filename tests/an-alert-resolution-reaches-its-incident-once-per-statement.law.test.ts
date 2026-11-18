import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Incident 075013fd (2026-11-18): the alert->incident roll-up was bound FOR
// EACH ROW, so a statement resolving N alerts re-read a cause group of M
// members N times (7,693 members x 4,957 alerts, ~880 s), and the settled
// alert closer - one transaction - rolled back everything at its timeout.
// Native proof: scripts/ci/test-an-alert-resolution-reaches-its-incident-once-per-statement.py

const MIGRATIONS = resolve(__dirname, '../supabase/migrations');
const NAME = '20261118072500_an_alert_resolution_reaches_its_incident_once_per_statement.sql';
const sql = readFileSync(resolve(MIGRATIONS, NAME), 'utf8');

const fnBody = (text: string) => {
  const start = text.lastIndexOf(
    'CREATE OR REPLACE FUNCTION public.fn_ca_alert_resolution_reaches_the_incident()'
  );
  return text.slice(start, text.indexOf('$function$;', start));
};

describe('an alert resolution reaches its incident once per statement (20261118072500)', () => {
  it('pins the production preimages it replaces and installs in one bounded transaction', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '1s';");
    expect(sql).toContain("IS DISTINCT FROM '41c8d8f028e06087ffff5bd89aea8ed2'");
    expect(sql).toContain("IS DISTINCT FROM 'c6f51cfd9e42c1eeb8312c5a794dedab'");
    expect(sql).toContain("md5(v_job.command) IS DISTINCT FROM '4bf6c1efccdfb1506ba52a2c81e69e70'");
    expect(sql).toMatch(/^-- @live-proof: /m);
  });

  it('binds the roll-up FOR EACH STATEMENT with transition tables, never FOR EACH ROW', () => {
    expect(sql).toContain(
      'CREATE TRIGGER zz_ca_alert_resolution_reaches_the_incident\n' +
        '  AFTER UPDATE ON public.financial_alerts\n' +
        '  REFERENCING OLD TABLE AS ca_alert_resolution_old NEW TABLE AS ca_alert_resolution_new\n' +
        '  FOR EACH STATEMENT'
    );
    const body = fnBody(sql);
    expect(body).toContain("IF TG_LEVEL <> 'STATEMENT'");
    expect(body).not.toMatch(/\bNEW\.(id|source|message|resolved|resolution)\b/);
  });

  it('reads the resolved set once and never joins the transition tables to member events', () => {
    const body = fnBody(sql);
    // Exactly one read of the transition tables: into the keyed jsonb set.
    expect(body.match(/FROM ca_alert_resolution_new n JOIN ca_alert_resolution_old o/g)).toHaveLength(1);
    expect(body).toContain('jsonb_object_agg(r.id::text, jsonb_build_object(');
    expect(body).toContain("'financial_alerts:' || (v_set -> lower(e.detail->>'alert_id') ->> 's') = i.source");
    // An open versioned member short-circuits the full proof.
    expect(body).toContain('AND a.source = v_src AND a.resolved IS NOT TRUE);');
  });

  it('keeps the closure law: verified_remeasured only when the last member resolves', () => {
    const body = fnBody(sql);
    expect(body).toContain(
      'IF v_members>0 AND v_members=v_group.occurrences AND v_bad=0 AND v_current THEN'
    );
    expect(body).toContain("closure_basis='verified_remeasured'");
    expect(body).toContain(
      'IF v_members>0 AND v_members=v_storm.occurrences AND v_bad=0 AND v_current THEN'
    );
    expect(body).toContain('WHEN query_canceled THEN RAISE;');
    expect(body).toContain("'fn_ca_alert_resolution_reaches_the_incident'");
  });

  it('pages the closer with a COMMIT per page and makes CALL the top-level cron command', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE PROCEDURE public.sp_ca_resolve_settled_financial_alerts_in_pages('
    );
    const proc = sql.slice(
      sql.indexOf('CREATE OR REPLACE PROCEDURE public.sp_ca_resolve_settled_financial_alerts_in_pages'),
      sql.indexOf('$procedure$;')
    );
    expect(proc).not.toContain('SECURITY DEFINER');
    expect(proc).toContain('v_result := public.fn_resolve_settled_financial_alerts(true, p_page);');
    expect(proc).toMatch(/fn_resolve_settled_financial_alerts\(true, p_page\);[\s\S]*?COMMIT;/);
    expect(proc).toContain("interval '90 seconds'");
    expect(sql).toContain(
      "candidate constant text := 'CALL public.sp_ca_resolve_settled_financial_alerts_in_pages(500, 40);';"
    );
    expect(sql).toContain('PERFORM cron.alter_job(job_id := 354, command := candidate);');
  });

  it('no later migration rebinds the roll-up FOR EACH ROW', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f > NAME)
      .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'));
    for (const text of later) {
      expect(text).not.toMatch(
        /CREATE TRIGGER zz_ca_alert_resolution_reaches_the_incident[\s\S]{0,200}FOR EACH ROW/
      );
    }
  });
});
