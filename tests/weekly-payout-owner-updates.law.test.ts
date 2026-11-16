/**
 * WEEKLY PAYOUT OWNER UPDATES ONLY READ THE PAYOUT (owner, 2026-11-15)
 *
 * 20261115205037 tells the union owner as the Monday rakeback pays and checks
 * each club statement against Club Data. The first live payout after it
 * installs is the next morning, so the law is that it adds new objects only:
 * it never modifies, replaces or wraps a payout function, trigger, cron job or
 * table, never writes a public table except through the platform's
 * notification and alert recorders, runs with its own short limits and lock,
 * and no client role can execute it. Behaviour (each milestone once, nothing
 * outside the window, one alert per mismatch, never raises) is proved on
 * native PostgreSQL 17 by scripts/ci/test-weekly-payout-owner-updates-postgres.py.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_weekly_payout_owner_updates_and_invoice_self_check.sql')
);
if (name.length !== 1) throw new Error('Expected One Weekly Payout Owner Updates Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
const NEW_FUNCTIONS = [
  'weekly_payout_owner_chips',
  'weekly_payout_owner_count',
  'weekly_union_club_statements',
  'weekly_invoice_club_data_check_next',
  'weekly_payout_owner_milestones',
  'weekly_payout_owner_notify_tick',
];
const NEW_TABLES = ['weekly_payout_owner_updates', 'weekly_invoice_club_data_checks'];

describe('weekly payout owner updates only read the payout', () => {
  it('is one transaction that opens with short limits', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(code).toMatch(
      /BEGIN;\s*SET LOCAL lock_timeout='1s';\s*SET LOCAL statement_timeout='20s';/
    );
    expect(sql).toMatch(/^-- @live-proof: .+$/m);
    expect(sql).toMatch(/^-- periodic-work: \S/m);
  });

  it('creates only new objects and changes nothing that exists', () => {
    expect(code).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(code).not.toMatch(
      /\b(ALTER\s+FUNCTION|DROP\s|CREATE\s+TRIGGER|ALTER\s+TABLE\s+public\.)/i
    );
    const fns = [...code.matchAll(/CREATE FUNCTION smarter_private\.(\w+)\(/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual([...NEW_FUNCTIONS].sort());
    const tables = [...code.matchAll(/CREATE TABLE (\S+?)\(/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(NEW_TABLES.map((t) => `smarter_private.${t}`).sort());
    expect(code.match(/CREATE (FUNCTION|TABLE)/g)).toHaveLength(
      NEW_FUNCTIONS.length + NEW_TABLES.length
    );
  });

  it('never writes a public table, and never updates or deletes anything', () => {
    expect(code).not.toMatch(/\bINSERT\s+INTO\s+public\./i);
    expect(code).not.toMatch(/\bUPDATE\s+\w/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM/i);
    const writes = [...code.matchAll(/INSERT INTO (\S+?)\(/g)].map((m) => m[1]);
    for (const w of writes) expect(NEW_TABLES.map((t) => `smarter_private.${t}`)).toContain(w);
    expect(code).toContain("PERFORM public.fn_raise_notification(v_owner,'system',");
    expect(code).toContain("PERFORM public.fn_record_operational_alert('weekly-payout',");
  });

  it('is not executable by any client role and is never a definer', () => {
    expect(code).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(code).not.toMatch(/GRANT\s+EXECUTE/i);
    for (const fn of NEW_FUNCTIONS) {
      expect(code).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION smarter_private\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`
        )
      );
    }
    for (const t of NEW_TABLES) {
      expect(code).toContain(
        `REVOKE ALL ON TABLE smarter_private.${t} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(code).toContain(`ALTER TABLE smarter_private.${t} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('runs on its own job, lock and limits, and only inside the week window', () => {
    expect([...code.matchAll(/cron\.schedule\('([^']+)'/g)].map((m) => m[1])).toEqual([
      'weekly-payout-owner-updates',
    ]);
    expect(code).toContain("WHERE jobname='weekly-payout-owner-updates' LOOP");
    expect(code).toContain(
      "$c$SELECT set_config('statement_timeout','20s',false),set_config('lock_timeout','1s',false); SELECT smarter_private.weekly_payout_owner_notify_tick();$c$"
    );
    expect(code).toContain(
      "pg_try_advisory_xact_lock(hashtextextended('weekly-payout-owner-notify',0))"
    );
    expect(code).not.toContain('union-accounting-scheduler');
    expect(code).toContain(
      "IF e IS NULL OR due IS NULL OR n<due OR n>=due+interval '24 hours' THEN RETURN NULL; END IF;"
    );
    expect(code).toMatch(
      /EXCEPTION WHEN OTHERS THEN\s+RETURN jsonb_build_object\('error',SQLSTATE/
    );
  });

  it('reads Club Data through the screen router and skips the house row', () => {
    expect(code).toContain(
      "public.ca_club_data_screen(s.club_id,d_from,d_to,'ALL','ALL',NULL,1)->'summary'"
    );
    expect(code).toContain('i.club_id<>p_union');
    expect(code).toContain('d_to := public.fn_ca_accounting_day(p_period_end)-1;');
  });

  it('carries no banned dash character', () => {
    expect(sql).not.toMatch(/[‒-―]/);
  });
});
