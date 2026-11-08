/**
 * LAW: the engine release runbook names only what exists, and quotes only
 * what the code says.
 * ═══════════════════════════════════════════════════════════════════════════
 * Created 2026-11-07 with docs/ENGINE-RELEASE-RUNBOOK.md. The runbook is the
 * single operating document an agent reads before managing a 04:00 cutover,
 * and a procedure document rots in two ways that nothing else in this repo
 * checks: a path or workflow it names is renamed or deleted (PUBLISHING.md
 * already names scripts/ci/select-daily-engine.py, which does not exist), and
 * a number it quotes stops matching the constant it describes. Either one
 * sends the next agent to the wrong place at 03:30.
 *
 * So:
 *   - every backticked repository path under .github/, server/, scripts/,
 *     docs/, tests/ or supabase/ must exist (directories count when the path
 *     ends in '/'; a ':<line>' suffix is stripped; globs are skipped);
 *   - every backticked `*.yml` basename must be a workflow under
 *     .github/workflows/;
 *   - a path marked "(pending on main)" is exempt while absent, and must lose
 *     the marker once it lands, so the exemption cannot outlive its reason;
 *   - the reserve seconds (150 / 135 / 285000), the preparation window
 *     (03:30-03:50), the cutover window (04:00-04:05) and the last-hand notice
 *     (03:58) quoted in the runbook are read back from
 *     server/scripts/engine-release-transaction.sh, stage-engine-release.yml,
 *     auto-deploy-hetzner.yml and server/src/maintenance/MaintenanceBreak.ts;
 *   - the transaction line numbers the runbook cites for its named constants
 *     and functions are the lines those names are defined on;
 *   - the runbook carries no em dash (CLAUDE.md 10.7).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RUNBOOK_PATH = 'docs/ENGINE-RELEASE-RUNBOOK.md';
const RUNBOOK = read(RUNBOOK_PATH);
const RUNBOOK_LINES = RUNBOOK.split('\n');
/** Prose wraps; constant checks read the runbook with its line breaks collapsed. */
const FLAT = RUNBOOK.replace(/\s+/g, ' ');
const TRANSACTION = read('server/scripts/engine-release-transaction.sh');
const TRANSACTION_LINES = TRANSACTION.split('\n');
const STAGE = read('.github/workflows/stage-engine-release.yml');
const RECEIVER = read('.github/workflows/auto-deploy-hetzner.yml');
const ENGINE = read('server/src/maintenance/MaintenanceBreak.ts');

const PENDING = /\(pending on main\)/;
const PATH_REF = /`((?:\.github|server|scripts|docs|tests|supabase)\/[^`\s]+)`/g;
const WORKFLOW_REF = /`([A-Za-z0-9._-]+\.yml)`/g;

function citedPaths(): Array<{ path: string; line: number; pending: boolean }> {
  const out: Array<{ path: string; line: number; pending: boolean }> = [];
  RUNBOOK_LINES.forEach((text, i) => {
    for (const m of text.matchAll(PATH_REF)) {
      const raw = m[1];
      if (/[*?<>]/.test(raw)) continue;
      const path = raw.replace(/:\d+(-\d+)?$/, '').replace(/[),.;]+$/, '');
      out.push({ path, line: i + 1, pending: PENDING.test(text) });
    }
  });
  return out;
}

function citedWorkflows(): Array<{ name: string; line: number; pending: boolean }> {
  const out: Array<{ name: string; line: number; pending: boolean }> = [];
  RUNBOOK_LINES.forEach((text, i) => {
    for (const m of text.matchAll(WORKFLOW_REF)) {
      out.push({ name: m[1], line: i + 1, pending: PENDING.test(text) });
    }
  });
  return out;
}

function exists(path: string): boolean {
  const full = join(ROOT, path);
  if (!existsSync(full)) return false;
  if (path.endsWith('/')) return statSync(full).isDirectory();
  return true;
}

describe('the engine release runbook names what exists', () => {
  const paths = citedPaths();
  const workflows = citedWorkflows();

  it('cites at least the files that implement the cutover', () => {
    const named = new Set(paths.map((p) => p.path));
    for (const must of [
      'server/scripts/engine-release-transaction.sh',
      'server/standby/standby-engine.sh',
      'scripts/ci/install-window-migrations.mjs',
      'server/scripts/engine-release-seal.py',
    ]) {
      expect(named.has(must), `${RUNBOOK_PATH} must cite ${must}`).toBe(true);
    }
    const workflowNames = new Set(workflows.map((w) => w.name));
    for (const must of [
      'stage-engine-release.yml',
      'backup-engine.yml',
      'auto-deploy-hetzner.yml',
      'post-deploy-e2e.yml',
      'apply-merged-migration.yml',
    ]) {
      expect(workflowNames.has(must), `${RUNBOOK_PATH} must cite ${must}`).toBe(true);
    }
  });

  it.each(paths.filter((p) => !p.pending).map((p) => [p.path, p.line]))(
    'cited path %s (line %i) exists',
    (path) => {
      expect(
        exists(path as string),
        `${RUNBOOK_PATH} names ${path}, which is not in the tree`
      ).toBe(true);
    }
  );

  it.each(workflows.filter((w) => !w.pending).map((w) => [w.name, w.line]))(
    'cited workflow %s (line %i) exists under .github/workflows/',
    (name) => {
      expect(
        readdirSync(join(ROOT, '.github/workflows')).includes(name as string),
        `${RUNBOOK_PATH} names workflow ${name}, which is not under .github/workflows/`
      ).toBe(true);
    }
  );

  it('a "(pending on main)" marker is removed once the file lands', () => {
    const landed = [
      ...paths.filter((p) => p.pending && exists(p.path)).map((p) => `${p.path} (line ${p.line})`),
      ...workflows
        .filter((w) => w.pending && readdirSync(join(ROOT, '.github/workflows')).includes(w.name))
        .map((w) => `${w.name} (line ${w.line})`),
    ];
    expect(
      landed,
      `these are marked pending in ${RUNBOOK_PATH} but now exist; drop the marker and describe them as built`
    ).toEqual([]);
  });

  it('carries no em dash', () => {
    expect(RUNBOOK.includes('—')).toBe(false);
  });
});

describe('the engine release runbook quotes the constants the code holds', () => {
  const num = (src: string, re: RegExp): number => {
    const m = src.match(re);
    expect(m, `${re} is not in its file any more`).not.toBeNull();
    return Number(m![1]);
  };

  it('the reserve seconds and the strict minimum are the transaction values', () => {
    const proof = num(TRANSACTION, /^BREAK_CUTOVER_PROOF_SECONDS=(\d+)$/m);
    const rollback = num(TRANSACTION, /^BREAK_ROLLBACK_RESERVE_SECONDS=(\d+)$/m);
    const slack = num(TRANSACTION, /^BREAK_DEADLINE_SLACK_SECONDS=(\d+)$/m);
    const window = num(TRANSACTION, /^BREAK_WINDOW_MS=(\d+)$/m);
    const minimum = (proof + rollback + slack) * 1000;
    expect(proof).toBe(150);
    expect(rollback).toBe(135);
    expect(minimum).toBe(285000);
    expect(FLAT).toContain(`\`BREAK_CUTOVER_PROOF_SECONDS\` = ${proof}`);
    expect(FLAT).toContain(`\`BREAK_ROLLBACK_RESERVE_SECONDS\` = ${rollback}`);
    expect(FLAT).toContain(`(${proof} + ${rollback} + ${slack}) s = ${minimum} ms`);
    expect(FLAT).toContain(`of the ${window} ms break`);
    expect(FLAT).toContain(`${proof}/${rollback} split`);
  });

  it('the non-break recovery bound is the transaction value', () => {
    const bound = num(TRANSACTION, /^NON_BREAK_RECOVERY_MAX_SECONDS=(\d+)$/m);
    expect(FLAT).toContain(`\`NON_BREAK_RECOVERY_MAX_SECONDS\` = ${bound} s`);
  });

  it('the preparation window is the one both workflows admit', () => {
    expect(STAGE).toContain('START_HOUR, START_MINUTE, WINDOW_MINUTES = 3, 30, 20');
    expect(RECEIVER).toContain('now.hour == 3 and 30 <= now.minute < 50');
    expect(FLAT).toContain('03:30-03:50');
    expect(FLAT).toContain('`START_HOUR, START_MINUTE, WINDOW_MINUTES = 3, 30, 20`');
  });

  it('the cutover window is the host clock', () => {
    const clock = TRANSACTION.slice(
      TRANSACTION.indexOf('daily_cutover_clock() {'),
      TRANSACTION.indexOf('\n}\n', TRANSACTION.indexOf('daily_cutover_clock() {'))
    );
    expect(clock).toContain('n.hour == 4 and n.minute < 5');
    expect(FLAT).toContain('04:00-04:05');
    expect(FLAT).toContain('(hour 4, minute under 5)');
  });

  it('the last-hand notice and break length are the engine constants', () => {
    expect(ENGINE).toMatch(/LAST_HAND_LEAD_MS = 2 \* 60 \* 1000/);
    expect(ENGINE).toMatch(/BREAK_DURATION_MS = 5 \* 60 \* 1000/);
    expect(FLAT).toContain('03:58');
    expect(FLAT).toContain('announce 120 s before 04:00, break 300 s');
  });

  it('every transaction line number the runbook cites is the line that defines the name', () => {
    // "`NAME` (line N)", "`NAME` line N", "line N `NAME`" and "`NAME` (line N via ..." shapes.
    const cites: Array<[string, number]> = [];
    for (const m of RUNBOOK.matchAll(/`([A-Za-z_]+)` \(?line (\d+)/g))
      cites.push([m[1], Number(m[2])]);
    for (const m of RUNBOOK.matchAll(/line (\d+) `([A-Za-z_]+)`/g))
      cites.push([m[2], Number(m[1])]);
    expect(cites.length).toBeGreaterThan(6);
    for (const [name, line] of cites) {
      const text = TRANSACTION_LINES[line - 1] ?? '';
      expect(
        text.startsWith(`${name}=`) || text.startsWith(`${name}() {`),
        `${RUNBOOK_PATH} says ${name} is on engine-release-transaction.sh line ${line}; that line reads: ${text}`
      ).toBe(true);
    }
  });

  it('the paired constant lines (52, 53, 109, 115) and the two certificate re-reads are where it says', () => {
    const at = (n: number) => TRANSACTION_LINES[n - 1];
    expect(at(52)).toMatch(/^BREAK_CUTOVER_PROOF_SECONDS=/);
    expect(at(53)).toMatch(/^BREAK_ROLLBACK_RESERVE_SECONDS=/);
    expect(at(109)).toMatch(/^MIN_BREAK_REMAINING_MS=/);
    expect(at(115)).toMatch(/^BREAK_WINDOW_MS=/);
    expect(FLAT).toContain('(lines 52, 53, 109, 115)');
    expect(at(3284)).toContain('require_backup_certificate ||');
    expect(at(3873)).toContain('require_backup_certificate ||');
    expect(at(3874)).toContain('daily_cutover_clock ||');
    expect(at(4017)).toContain('persist_result sealed');
    expect(FLAT).toContain('line 3284');
    expect(FLAT).toContain('line 3873');
    expect(FLAT).toContain('line 3874');
    expect(FLAT).toContain('line 4017');
  });
});
