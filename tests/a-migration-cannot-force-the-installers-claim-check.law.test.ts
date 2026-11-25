/**
 * A MIGRATION CANNOT FORCE THE INSTALLER'S OWN DEFERRED CLAIM CHECK
 * (2026-11-23). See scripts/ci/migration-installer-claim-shape.mjs.
 *
 * 20261123024924 ran SET CONSTRAINTS ALL IMMEDIATE on its install path. That
 * fired the applier's deferred claim trigger before the history row existed
 * and production refused the install (migration_applier_claim_unrecorded,
 * 04:10 UTC, nothing applied). This pins that the merge check refuses the
 * statement outside the probe-only shape, that the applier asks the same
 * question before it sends anything, and that the exact merged bytes that
 * were refused are caught.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  CLAIM_CHECKED_FROM,
  installerClaimRisks,
  isClaimChecked,
} from '../scripts/ci/migration-installer-claim-shape.mjs';

const ROOT = resolve(__dirname, '..');
const DIR = join(ROOT, 'supabase/migrations');
const APPLIER = join(ROOT, 'scripts/ci/apply-recorded-migration.mjs');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const GIVE_BACK = '20261123024924_the_promo_a_refund_took_goes_back_to_twin2983.sql';
const HELD = '20261123002808_the_promo_a_refund_took_goes_back_to_the_two_members.sql';

const wrap = (body: string) =>
  `BEGIN;\nDO $settle$\nDECLARE v_probe boolean := false;\nBEGIN\n${body}\nEND\n$settle$;\nCOMMIT;\n`;

const REFUSED: Record<string, string> = {
  'at the top level':
    'BEGIN;\nUPDATE public.t SET a = 1;\nSET CONSTRAINTS ALL IMMEDIATE;\nCOMMIT;\n',
  'unguarded in a DO block': wrap('  PERFORM 1;\n  SET CONSTRAINTS ALL IMMEDIATE;'),
  'lower case': wrap('  set constraints all immediate;'),
  'spread over lines and tabs': wrap('  SET\n   CONSTRAINTS\tALL\n  IMMEDIATE ;'),
  'mixed case': wrap('  Set Constraints All Immediate;'),
  'before the probe branch, not inside it (the held file)': wrap(
    "  SET CONSTRAINTS ALL IMMEDIATE;\n  IF v_probe THEN\n    RAISE EXCEPTION 'PROBE OK';\n  END IF;"
  ),
  'in an IF branch that does not raise': wrap(
    '  IF v_probe THEN\n    SET CONSTRAINTS ALL IMMEDIATE;\n  END IF;'
  ),
  'with a statement between it and the raise': wrap(
    "  IF v_probe THEN\n    SET CONSTRAINTS ALL IMMEDIATE;\n    PERFORM 1;\n    RAISE EXCEPTION 'PROBE OK';\n  END IF;"
  ),
  'not the first statement of the branch': wrap(
    "  IF v_probe THEN\n    PERFORM 1;\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE EXCEPTION 'PROBE OK';\n  END IF;"
  ),
  'in an ELSE branch': wrap(
    "  IF v_probe THEN\n    PERFORM 1;\n  ELSE\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE EXCEPTION 'x';\n  END IF;"
  ),
  'followed by a notice, not an exception': wrap(
    "  IF v_probe THEN\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE NOTICE 'checked';\n  END IF;"
  ),
  'in the probe-law unwind block, which the install does run': wrap(
    "  BEGIN\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE EXCEPTION 'probe-unwind';\n  EXCEPTION WHEN raise_exception THEN\n    IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;\n  END;"
  ),
};

const ACCEPTED: Record<string, string> = {
  'the probe-only shape': wrap(
    "  IF v_probe THEN\n    SET CONSTRAINTS ALL IMMEDIATE;\n    RAISE EXCEPTION 'PROBE OK (rolled back)';\n  END IF;"
  ),
  'the probe-only shape with a comment between': wrap(
    "  IF current_setting('ca.probe', true) = 'on' THEN\n    -- forced only here\n    set constraints all immediate;\n    -- and unwound\n    RAISE EXCEPTION 'PROBE OK';\n  END IF;"
  ),
  'a named constraint': wrap(
    '  SET CONSTRAINTS smarter_private.ca_function_calls_must_resolve IMMEDIATE;'
  ),
  'several named constraints':
    'BEGIN;\nSET CONSTRAINTS public.a_check, public.b_check IMMEDIATE;\nCOMMIT;\n',
  'all deferred': 'BEGIN;\nSET CONSTRAINTS ALL DEFERRED;\nCOMMIT;\n',
  'a comment':
    'BEGIN;\n-- never SET CONSTRAINTS ALL IMMEDIATE here\n/* SET CONSTRAINTS ALL IMMEDIATE; */\nSELECT 1;\nCOMMIT;\n',
  'a string literal (an error message that names it)': wrap(
    "  RAISE NOTICE 'create the callee before any SET CONSTRAINTS ALL IMMEDIATE';"
  ),
  'a function body, which the install does not run':
    'BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_x() RETURNS void LANGUAGE plpgsql AS $function$\nBEGIN\n  SET CONSTRAINTS ALL IMMEDIATE;\nEND $function$;\nCOMMIT;\n',
};

describe('a migration cannot force the installer claim check', () => {
  it('the premise holds: the applier claim check is a deferred constraint trigger', () => {
    const file = readdirSync(DIR).find((f) => f.startsWith('20261119053515_'));
    expect(file).toBeDefined();
    const sql = read(file as string);
    expect(sql).toMatch(
      /CREATE CONSTRAINT TRIGGER ca_migration_applier_claim_is_recorded[\s\S]{0,200}DEFERRABLE INITIALLY DEFERRED/
    );
    expect(sql).toContain('migration_applier_claim_unrecorded');
  });

  it('every migration from the cut-over on keeps the statement off its install path', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && isClaimChecked(f));
    expect(files).toContain(GIVE_BACK);
    for (const f of files) expect(installerClaimRisks(f, read(f)), f).toEqual([]);
  });

  it('the repaired give-back passes as it stands, and it does carry the statement', () => {
    const sql = read(GIVE_BACK);
    expect(sql).toMatch(/IF v_probe THEN\s+SET CONSTRAINTS ALL IMMEDIATE;\s+RAISE EXCEPTION/);
    expect(installerClaimRisks(GIVE_BACK, sql)).toEqual([]);
  });

  it('catches the exact merged bytes production refused on 2026-11-23, and the held file', () => {
    expect(installerClaimRisks(HELD, read(HELD))).toHaveLength(1);
    try {
      // #11810, the give-back as first merged: refused at install 04:10 UTC.
      const sql = execFileSync('git', ['show', `58f9fa7c6:supabase/migrations/${GIVE_BACK}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      expect(installerClaimRisks(GIVE_BACK, sql)).toHaveLength(1);
    } catch {
      // A shallow checkout may not hold the commit; the held file and the fixtures still pin the rule.
    }
  });

  it.each(Object.entries(REFUSED))('refuses the statement %s', (_name, sql) => {
    const reasons = installerClaimRisks('20261123999999_x.sql', sql);
    expect(reasons, sql).toHaveLength(1);
    expect(reasons[0]).toContain('migration_applier_claim_unrecorded');
    expect(reasons[0]).toContain('SET CONSTRAINTS <name> IMMEDIATE');
    expect(reasons[0]).toContain('IF v_probe THEN');
  });

  it('does not see the statement sent through EXECUTE (a stated limit of a textual rule)', () => {
    // String literals are blanked, so the dynamic form is invisible. Pinned
    // so nobody reads the rule as covering it.
    const sql = wrap("  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';");
    expect(installerClaimRisks('20261123999999_x.sql', sql)).toEqual([]);
  });

  it.each(Object.entries(ACCEPTED))('accepts %s', (_name, sql) => {
    expect(installerClaimRisks('20261123999999_x.sql', sql), sql).toEqual([]);
  });

  it('the shape it tells authors to write also satisfies the sibling line-based law (#11830)', () => {
    // tests/a-migration-never-fires-the-applier-claim-early.law.test.ts accepts
    // the statement only when the line above it is exactly "IF v_probe THEN".
    const sibling = readFileSync(
      join(ROOT, 'tests/a-migration-never-fires-the-applier-claim-early.law.test.ts'),
      'utf8'
    );
    expect(sibling).toContain('IF\\s+v_probe\\s+THEN');
    const lines = ACCEPTED['the probe-only shape'].split('\n');
    const at = lines.findIndex((l) => /^\s*SET\s+CONSTRAINTS\s+ALL\s+IMMEDIATE\s*;/i.test(l));
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toMatch(/^\s*IF\s+v_probe\s+THEN\s*$/i);
    expect(lines[at + 1]).toMatch(/^\s*RAISE\s+EXCEPTION\b/i);
  });

  it('counts every occurrence', () => {
    const sql = wrap(
      '  SET CONSTRAINTS ALL IMMEDIATE;\n  PERFORM 1;\n  SET CONSTRAINTS ALL IMMEDIATE;'
    );
    expect(installerClaimRisks('20261123999999_x.sql', sql)).toHaveLength(2);
  });

  it('judges only from the cut-over on, so installed history is not re-judged', () => {
    expect(isClaimChecked(`${CLAIM_CHECKED_FROM}_x.sql`)).toBe(true);
    expect(isClaimChecked(GIVE_BACK)).toBe(true);
    expect(isClaimChecked(HELD)).toBe(false);
    expect(
      isClaimChecked('20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql')
    ).toBe(false);
  });

  it('the applier asks the same question before it sends anything', () => {
    const applier = readFileSync(APPLIER, 'utf8');
    expect(applier).toContain("from './migration-installer-claim-shape.mjs'");
    const costAt = applier.indexOf('const risks = migrationCostRisks(file, sql);');
    const claimAt = applier.indexOf('const forced = installerClaimRisks(file, sql);');
    expect(costAt).toBeGreaterThan(0);
    expect(claimAt).toBeGreaterThan(costAt);
    const block = applier.slice(claimAt, applier.indexOf('}', claimAt));
    expect(block).toContain('if (forced.length) refused(');
    expect(applier.slice(applier.lastIndexOf('if (', claimAt), claimAt)).toContain(
      'isClaimChecked(file)'
    );
    expect(claimAt).toBeLessThan(applier.indexOf('client.connect('));
  });

  it('the real applier refuses a bad file with a sentence and connects to nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'claim-shape-'));
    try {
      mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
      const bad = '20261123999999_forces_the_claim_check.sql';
      writeFileSync(join(root, 'supabase/migrations', bad), REFUSED['unguarded in a DO block']);
      // No database address or credential is in this environment, so a run
      // that got past the static refusals could not send anything either.
      const env = { PATH: process.env.PATH ?? '', HOME: root };
      const run = spawnSync(process.execPath, [APPLIER, '--migration', bad], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain('[apply] REFUSED:');
      expect(run.stderr).toContain('SET CONSTRAINTS ALL IMMEDIATE is on the install path');
      expect(run.stderr).toContain(bad);

      const good = '20261123999998_forces_it_only_in_the_probe.sql';
      writeFileSync(join(root, 'supabase/migrations', good), ACCEPTED['the probe-only shape']);
      const ok = spawnSync(process.execPath, [APPLIER, '--migration', good], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      // The good file passes every static refusal and stops only for want of a database.
      // (Inside the :50-:03 UTC break window the applier stops one step
      // earlier, on the clock; that is also after the static refusals.)
      expect(ok.stderr).not.toContain('is on the install path');
      expect(ok.stderr).toMatch(/DATABASE_URL is not set|the break window is :50-:03/);
      expect(ok.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
