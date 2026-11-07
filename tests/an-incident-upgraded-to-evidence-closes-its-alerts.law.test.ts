/**
 * AN INCIDENT UPGRADED TO EVIDENCE CLOSES ITS ALERTS (2026-11-07).
 *
 * fn_ca_incident_resolution_reaches_the_alerts propagates two things: an
 * incident becoming resolved, and an already-resolved incident whose
 * closure_basis changes (an age-out upgraded to evidence). Its trigger was
 * AFTER UPDATE OF status, so an upgrade that wrote closure_basis alone never
 * reached it - three cron-failure alerts stayed open from 2026-10-28 on
 * incidents already proven fixed. Measured on production 2026-11-07: the same
 * closure_basis-only upgrade left its alert open before this migration and
 * closed it after; an unrelated edit to an aged-out incident closes nothing.
 *
 * Pinned: the newest migration that (re)creates this trigger lists BOTH
 * columns, and the function it calls is untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const code = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '');
const creators = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => /^CREATE\s+TRIGGER\s+zz_ca_incident_resolution_reaches_the_alerts\b/im.test(code(f)));
const newest = creators[creators.length - 1];

describe('an incident upgraded to evidence closes its alerts', () => {
  it('the newest trigger fires on status and on closure_basis', () => {
    expect(newest >= '20261107194824').toBe(true);
    const sql = code(newest);
    const m = sql.match(/^CREATE\s+TRIGGER\s+zz_ca_incident_resolution_reaches_the_alerts\s+AFTER\s+UPDATE\s+OF\s+([^\n]+?)\s+ON\s+public\.ca_drift_incidents/im);
    expect(m, 'trigger declaration').not.toBeNull();
    const cols = m![1].split(',').map((c) => c.trim().toLowerCase());
    expect(cols).toContain('status');
    expect(cols).toContain('closure_basis');
  });

  it('does not touch the propagation function, which keeps the age-out refusal', () => {
    const sql = code('20261107194824_an_incident_upgraded_to_evidence_closes_its_alerts.sql');
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_incident_resolution_reaches_the_alerts/i);
    expect(sql).toContain("'0d6c1f30fd1d9e1caebdfb9e9f2fd27e'");
  });

  it('closes only the three stranded alerts, each re-checked against its proven incident', () => {
    const sql = code('20261107194824_an_incident_upgraded_to_evidence_closes_its_alerts.sql');
    expect(sql).toContain("d.closure_basis = 'verified_remeasured'");
    expect(sql).toContain("d.correction_ref LIKE 'verified: %'");
    expect(sql).toContain("f.context->>'incident_id' = d.id::text");
    expect(sql).toMatch(/IF n NOT IN \(0, 3\)/);
    expect(sql).not.toMatch(/UPDATE public\.(chip_ledger|wallets|club_members|union_wallets|tournament_escrow)\b/i);
  });
});
