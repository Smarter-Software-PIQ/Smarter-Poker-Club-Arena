/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - THE DAILY METRICS NEVER NAME A COLUMN AFTER A VARIABLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 2026-11-19: cron job sp-daily-metrics-snapshot failed on every run from
 * 06:15 UTC with `column reference "d" is ambiguous`. 20261118165140 (#11308)
 * added max_degraded_run to public.fn_sp_daily_metrics_compute(date) and named
 * its run flag column `d`, but that function DECLAREs `d jsonb`. PL/pgSQL only
 * resolves a statement's names when it first runs it, so every check passed
 * and the first real snapshot of the day failed (Production Alerts incident
 * sp-daily-metrics-snapshot-ambiguous-d, operational_alert_events 445194 and
 * 445206).
 *
 * Migration 20261119080913 renames the alias to is_degraded. This law pins the
 * fix, and refuses any later text for the function (a pinned substitution or a
 * full rewrite) that names a column alias after one of its declared variables.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const SIG = "'public.fn_sp_daily_metrics_compute(date)'";
const DEFECT = '20261118165140';

const FIX = migrationNames()
  .filter((n) => n.endsWith('_the_daily_metrics_never_name_a_column_after_a_variable.sql'))
  .at(-1);
if (!FIX) throw new Error('the daily-metrics alias fix migration is missing');
const FIX_SQL = migrationText(FIX);

/** The variables the newest full definition of the function declares. */
function declaredVariables(): Set<string> {
  const full = migrationCorpus()
    .filter((m) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i.test(m.sql))
    .at(-1);
  if (!full) throw new Error('no full definition of fn_sp_daily_metrics_compute');
  const at = full.sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i);
  const body = full.sql.slice(at);
  const decl = body.slice(body.indexOf('DECLARE') + 'DECLARE'.length, body.search(/\nBEGIN\b/));
  const names = new Set<string>();
  for (const stmt of decl.split(';')) {
    const m = stmt.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/** The SQL a migration installs into the function: its replacement blocks. */
function installedText(sql: string): string[] {
  const out: string[] = [];
  const re = /\$(n\d+)\$([\s\S]*?)\$\1\$/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) out.push(m[2]);
  if (/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i.test(sql)) out.push(sql);
  return out.map((t) => t.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

/** Column aliases (`expr AS name`) that collide with a declared variable. */
function collisions(text: string, vars: Set<string>): string[] {
  const hits: string[] = [];
  const re = /\bAS\s+([a-z_][a-z0-9_]*)\s*(?=[,)]|\bFROM\b)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (vars.has(m[1].toLowerCase())) hits.push(m[0]);
  }
  return hits;
}

describe('the daily metrics never name a column after a variable', () => {
  const vars = declaredVariables();

  it('reads the declared variables, and d is one of them', () => {
    for (const v of ['s', 'e', 'd', 'pl', 'h', 'm', 'g']) expect(vars.has(v), v).toBe(true);
  });

  it('would have caught the defect that shipped', () => {
    const defect = migrationCorpus().find((m) => m.name.startsWith(DEFECT));
    expect(defect).toBeDefined();
    const n4 = installedText(defect!.sql).find((t) => t.includes('max_degraded_run'));
    expect(collisions(n4 ?? '', vars)).toContain('AS d');
  });

  it('renames the run flag on the exact installed text', () => {
    expect(FIX_SQL).toContain(
      `${SIG},\n  'd28b32a8562f5b24035f7fc0d1323326', '075e3684b69d680a55a2c29d81cf3de4'`
    );
    expect(FIX_SQL).toContain('$o1$SELECT COALESCE(degraded, false) AS d, count(*)$o1$');
    expect(FIX_SQL).toContain('$o2$FROM hb) r WHERE d GROUP BY grp$o2$');
    expect(FIX_SQL).toContain('$n1$SELECT COALESCE(degraded, false) AS is_degraded, count(*)$n1$');
    expect(FIX_SQL).toContain('$n2$FROM hb) r WHERE is_degraded GROUP BY grp$n2$');
    expect(FIX_SQL).toMatch(/already the postimage, nothing to do/);
    expect(FIX_SQL).toMatch(/owner, security, settings or grants moved/);
    expect(FIX_SQL).toMatch(/^BEGIN;$/m);
    expect(FIX_SQL).toMatch(/^COMMIT;$/m);
  });

  it('no migration after the defect installs a column alias named after a variable', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= DEFECT) continue;
      const touches =
        m.sql.includes(SIG) ||
        /FUNCTION\s+public\.fn_sp_daily_metrics_compute\s*\(/i.test(m.sql);
      if (!touches) continue;
      for (const t of installedText(m.sql)) {
        expect(collisions(t, vars), m.name).toEqual([]);
      }
    }
  });
});
