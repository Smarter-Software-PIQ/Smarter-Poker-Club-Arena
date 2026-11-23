/**
 * A MIGRATION NEVER FIRES THE APPLIER'S CLAIM CHECK EARLY (2026-11-23).
 *
 * Apply Merged Migration claims a file, runs it, then writes its history row,
 * all in one transaction. ca_migration_applier_claim_is_recorded
 * (20261119053515) is a DEFERRABLE INITIALLY DEFERRED constraint trigger that
 * refuses the commit unless that exact history row exists. A file that runs
 * `SET CONSTRAINTS ALL IMMEDIATE` fires that check before the history row is
 * written, so it can never install: 20261123024924 refused at 04:12:58Z
 * (migration_applier_claim_unrecorded, run 45110209471), and the applier then
 * refused every newer migration by order, which stood down every Backup of
 * main ahead of the 01:00 and 04:00 CST cutovers.
 *
 * Every ordinary migration after the claim guard may force ALL constraints
 * immediate only inside a rolled-back probe branch (`IF v_probe THEN`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '..', 'supabase', 'migrations');
const CLAIM_GUARD = '20261119053515';
const FORCE_ALL = /^\s*SET\s+CONSTRAINTS\s+ALL\s+IMMEDIATE\s*;/i;
const PROBE_BRANCH = /^\s*IF\s+v_probe\s+THEN\s*$/i;

function unprotected(sql: string): number[] {
  const lines = sql.split('\n');
  const bad: number[] = [];
  lines.forEach((line, i) => {
    if (!FORCE_ALL.test(line)) return;
    let j = i - 1;
    while (j >= 0 && (lines[j].trim() === '' || lines[j].trim().startsWith('--'))) j -= 1;
    if (j < 0 || !PROBE_BRANCH.test(lines[j])) bad.push(i + 1);
  });
  return bad;
}

describe('a migration never fires the applier claim check early', () => {
  it('finds the claim guard as a deferred constraint trigger', () => {
    const guard = readdirSync(DIR).find((f) => f.startsWith(CLAIM_GUARD + '_'));
    expect(guard).toBeDefined();
    const sql = readFileSync(resolve(DIR, guard as string), 'utf8');
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER ca_migration_applier_claim_is_recorded');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('no ordinary migration after the guard forces ALL constraints immediate outside a probe branch', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).sort()) {
      if (!/^\d{14}_.+\.sql$/.test(file) || file.slice(0, 14) <= CLAIM_GUARD) continue;
      const sql = readFileSync(resolve(DIR, file), 'utf8');
      if (/^\s*--\s*SUPERSEDED/im.test(sql)) continue;
      for (const line of unprotected(sql)) offenders.push(`${file}:${line}`);
    }
    expect(offenders).toEqual([]);
  });

  it('recognises the refused form and accepts the probe-only form', () => {
    expect(
      unprotected(
        "BEGIN;\n  SET CONSTRAINTS ALL IMMEDIATE;\n  IF v_probe THEN\n    RAISE EXCEPTION 'x';\n  END IF;\n"
      )
    ).toEqual([2]);
    expect(
      unprotected(
        "  IF v_probe THEN\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE EXCEPTION 'x';\n  END IF;\n"
      )
    ).toEqual([]);
    expect(
      unprotected('  IF v_probe THEN\n    -- probe only\n    SET CONSTRAINTS ALL IMMEDIATE;\n')
    ).toEqual([]);
  });
});
