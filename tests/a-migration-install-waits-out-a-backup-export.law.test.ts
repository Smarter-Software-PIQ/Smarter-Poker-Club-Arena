/**
 * LAW: A MIGRATION INSTALL WAITS OUT A BACKUP EXPORT (2026-11-09).
 *
 * Apply Merged Migration installs a merged file whenever it is dispatched.
 * Backup Engine's refresh job exports production's structure and checks the
 * export against schema evidence captured just before it. An install that
 * commits inside that export makes the copy disagree with itself and costs
 * the Backup certificate another full run, so the applier holds, inside its
 * existing bounded queue, while an export is in progress.
 *
 * What this pins:
 *   1. The hold reads only the refresh job between a successful "due" decision
 *      and the end of its export step; it never holds while the refresh is
 *      still deciding (that step waits for uninstalled merged files itself).
 *   2. The step names it reads still exist in backup-engine.yml, so renaming
 *      them cannot silently switch the hold off.
 *   3. The applier asks before anything is sent, shares the queue's 900 s
 *      budget, and an unreadable answer or a timeout is REFUSED with nothing
 *      sent. Nothing is retried and nothing is installed by the hold itself.
 *   4. The reader only reads (GET) GitHub; it holds no database credential.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  DUE_STEP,
  EXPORT_STEP_PREFIX,
  REFRESH_JOB,
  countExports,
  exportInProgress,
} from '../scripts/ci/backup-export-holds-installs.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const applier = parse(read('.github/workflows/apply-merged-migration.yml')) as Record<string, any>;
const backup = parse(read('.github/workflows/backup-engine.yml')) as Record<string, any>;
const reader = read('scripts/ci/backup-export-holds-installs.mjs');

const step = (name: string, status: string, conclusion: string | null = null) => ({
  name,
  status,
  conclusion,
});
const refresh = (steps: object[], status = 'in_progress') => ({ name: REFRESH_JOB, status, steps });
const EXPORT = `${EXPORT_STEP_PREFIX} and the horse-only seed (read-only, short reads)`;

describe('a migration install waits out a Backup export', () => {
  it('holds only between a successful due decision and the end of the export', () => {
    expect(exportInProgress(refresh([step(DUE_STEP, 'in_progress')]))).toBe(false);
    expect(exportInProgress(refresh([step(DUE_STEP, 'completed', 'failure')]))).toBe(false);
    expect(
      exportInProgress(refresh([step(DUE_STEP, 'completed', 'success'), step(EXPORT, 'queued')]))
    ).toBe(true);
    expect(
      exportInProgress(
        refresh([step(DUE_STEP, 'completed', 'success'), step(EXPORT, 'in_progress')])
      )
    ).toBe(true);
    expect(exportInProgress(refresh([step(DUE_STEP, 'completed', 'success')]))).toBe(true);
    expect(
      exportInProgress(
        refresh([step(DUE_STEP, 'completed', 'success'), step(EXPORT, 'completed', 'success')])
      )
    ).toBe(false);
    // Not due: GitHub records the export step as completed/skipped.
    expect(
      exportInProgress(
        refresh([step(DUE_STEP, 'completed', 'success'), step(EXPORT, 'completed', 'skipped')])
      )
    ).toBe(false);
    expect(exportInProgress(refresh([step(DUE_STEP, 'completed', 'success')], 'completed'))).toBe(
      false
    );
    expect(exportInProgress({ name: 'certify', status: 'in_progress', steps: [] })).toBe(false);
    expect(
      countExports([
        refresh([step(DUE_STEP, 'completed', 'success')]),
        { name: 'plan', status: 'completed' },
      ])
    ).toBe(1);
  });

  it('reads step names that still exist in the Backup refresh job', () => {
    const names: string[] = (backup.jobs[REFRESH_JOB]?.steps ?? [])
      .map((s: any) => s.name)
      .filter(Boolean);
    expect(names).toContain(DUE_STEP);
    expect(names.filter((n) => n.startsWith(EXPORT_STEP_PREFIX))).toHaveLength(1);
    expect(names.indexOf(DUE_STEP)).toBeLessThan(
      names.findIndex((n) => n.startsWith(EXPORT_STEP_PREFIX))
    );
  });

  it('asks inside the bounded queue, before anything is sent, and refuses when it cannot tell', () => {
    const run: string = applier.jobs.apply.steps.find((s: any) => s.id === 'apply').run;
    const ask = run.indexOf('node scripts/ci/backup-export-holds-installs.mjs');
    expect(ask).toBeGreaterThan(run.indexOf('while :; do'));
    expect(ask).toBeLessThan(run.indexOf('node scripts/ci/apply-recorded-migration.mjs'));
    expect(run.match(/deadline=\$\(\(/g)).toHaveLength(1);
    expect(run).toContain(
      '[apply] REFUSED: could not read whether a Backup export is running. Nothing was sent'
    );
    expect(run).toContain(
      '[apply] REFUSED: a Backup export of production is still running after 900s. Nothing was sent'
    );
    expect(run).toMatch(/\[\[ "\$exporting" == "0" \]\] && break/);
  });

  it('only reads GitHub', () => {
    expect(reader).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/);
    expect(reader).not.toMatch(/DATABASE_URL|pg\b|spawn|exec/);
  });
});
