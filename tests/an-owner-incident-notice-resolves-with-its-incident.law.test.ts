import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * AN OWNER-NOTICE COPY RESOLVES WITH ITS INCIDENT (2026-11-17,
 * 20261117224454). fn_try_record_owner_notification records every owner
 * notification as a firing operational_alert_events row. The only thing that
 * resolves a financial_incident copy is fn_ca_incident_resolution_reaches_the_alerts,
 * in the transaction that resolves the drift incident. Before this, 836 copies
 * stayed firing after their incidents resolved, and Reliability Controller
 * incident f775f812 could never clear. This law fails the build if the newest
 * definition of that trigger function stops resolving the copies.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');
const FN = 'fn_ca_incident_resolution_reaches_the_alerts';

function newestDefiningMigration(): { file: string; sql: string } {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let found: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    if (
      sql.includes(FN) &&
      (/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql) || sql.includes('pg_get_functiondef'))
    ) {
      found = { file, sql };
    }
  }
  if (!found) throw new Error(`no migration defines ${FN}`);
  return found;
}

describe('an owner incident notice resolves with its incident', () => {
  it('the newest definition resolves owner-notice copies of the incident', () => {
    const { file, sql } = newestDefiningMigration();
    expect(file >= '20261117224454', `${file} is the newest definition of ${FN}`).toBe(true);
    expect(sql).toContain('owner-operational-notifications');
    expect(sql).toMatch(/'original_notification'.*'data'.*'incident_id'/s);
  });

  it('the fixing migration keeps the aged-out rule and is guarded', () => {
    const sql = readFileSync(
      join(DIR, '20261117224454_owner_incident_notice_closes_with_incident.sql'),
      'utf8'
    );
    expect(sql).toContain("<> 'aged_out_unverified'");
    expect(sql).toMatch(/anchor found % times/);
    expect(sql).toMatch(/did not land/);
    expect(sql).toMatch(/^-- @live-proof: /m);
  });
});
