/**
 * A WINDOW MIGRATION DOES NOT WAIT ON THE ENGINE'S RELEASE CONTROLS (2026-11-12)
 *
 * The daily reservation owner of stage-engine-release.yml waits up to five
 * hours, then refuses to bind source if the release controls changed on main
 * meanwhile ("Release controls changed during reservation; keep serving.").
 * That refusal fails the detect job, which is right for the engine. On
 * 2026-11-10 (run 42756607383) and 2026-11-11 (run 42959839523) the
 * window-migrations job also required `needs.detect.result == 'success'` and
 * checked out `protected_sha` (the cutoff step's output), so the database-only
 * installer was skipped and five merged window migrations missed two breaks.
 *
 * Pinned here: the install job neither requires detect to succeed nor checks
 * out the engine's bound source; it reads the window_source step, which names
 * protected main at the reserved cutoff even when the engine refuses, and only
 * when the cutoff was actually reached inside the preparation window. The
 * engine path (cutoff step, protected_sha, selection, signal) is unchanged and
 * never reads window_sha.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const text = readFileSync(
  resolve(process.cwd(), '.github/workflows/stage-engine-release.yml'),
  'utf8'
);
const stage = parse(text);
const detect = stage.jobs.detect;
const step = (id: string) => detect.steps.find((s: { id?: string }) => s.id === id);
const cutoffStep = step('cutoff');
const windowStep = step('window_source');
const install = stage.jobs['window-migrations'];
const CONTROL = '1'.repeat(40);
const cutoff = 1_800_000_000;

// Runs the cutoff step, then the window_source step with the cutoff step's
// sha output, exactly as GitHub would hand it over. Clock, sleep, git and the
// release-control comparison are stubbed.
function run(opts: { before: number; after: number; changed: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'window-source-'));
  const stubs = `
    date() { if [ -f "$MARK" ]; then printf '%s' "$AFTER"; else touch "$MARK"; printf '%s' "$BEFORE"; fi; }
    sleep() { :; }
    git() { if [ "$1" = rev-list ]; then printf '%s' "${CONTROL}"; fi; }
    python3() { cat > /dev/null; return "$CHANGED"; }
  `;
  const env = {
    ...process.env,
    CUTOFF_EPOCH: String(cutoff),
    OWNER_WINDOW_ID: '',
    BEFORE: String(opts.before),
    AFTER: String(opts.after),
    MARK: join(dir, 'clock'),
    CHANGED: opts.changed ? '1' : '0',
    GITHUB_SHA: 'a'.repeat(40),
  };
  try {
    const engine = spawnSync('bash', ['-c', `${stubs}\n${cutoffStep.run}`], {
      encoding: 'utf8',
      env: { ...env, GITHUB_OUTPUT: join(dir, 'cutoff') },
    });
    const cutoffOut = existsSync(join(dir, 'cutoff'))
      ? readFileSync(join(dir, 'cutoff'), 'utf8')
      : '';
    const bound = /^sha=(.*)$/m.exec(cutoffOut)?.[1] ?? '';
    const window = spawnSync('bash', ['-c', `${stubs}\n${windowStep.run}`], {
      encoding: 'utf8',
      env: { ...env, BOUND_SHA: bound, GITHUB_OUTPUT: join(dir, 'window') },
    });
    const windowOut = existsSync(join(dir, 'window'))
      ? readFileSync(join(dir, 'window'), 'utf8')
      : '';
    return { engineStatus: engine.status, cutoffOut, windowStatus: window.status, windowOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the window install does not depend on the engine release-control check', () => {
  it('does not require the detect job to succeed', () => {
    expect(install.needs).toBe('detect');
    expect(install.if).not.toMatch(/detect\.result/);
    expect(install.if).toContain("needs.detect.outputs.daily_preparation == 'true'");
    expect(install.if).toContain("needs.detect.outputs.window_sha != ''");
    expect(install.if).toContain('always()');
  });

  it('checks out the window source, never the engine-bound source', () => {
    const checkout = install.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/checkout')
    );
    expect(checkout.with.ref).toBe('${{ needs.detect.outputs.window_sha || github.sha }}');
    expect(JSON.stringify(install)).not.toContain('protected_sha');
    expect(detect.outputs.window_sha).toBe('${{ steps.window_source.outputs.sha }}');
  });

  it('names the window source even when the cutoff step refuses, and never fails the job itself', () => {
    expect(windowStep.if).toContain('always()');
    expect(windowStep.if).toContain("steps.cutoff.outcome == 'failure'");
    expect(windowStep.if).toContain("steps.admission.outputs.daily_preparation == 'true'");
    expect(windowStep['continue-on-error']).toBe(true);
    expect(windowStep.run).not.toMatch(/\bsleep\b/);
  });

  it('release controls changed: the engine still refuses, the window still installs from the cutoff commit', () => {
    const r = run({ before: cutoff - 3600, after: cutoff + 5, changed: true });
    expect(r.engineStatus).not.toBe(0);
    expect(r.cutoffOut).toBe('');
    expect(r.windowStatus).toBe(0);
    expect(r.windowOut).toBe(`sha=${CONTROL}\n`);
  });

  it('release controls unchanged: both name the same commit', () => {
    const r = run({ before: cutoff - 3600, after: cutoff + 5, changed: false });
    expect(r.engineStatus).toBe(0);
    expect(r.cutoffOut).toBe(`sha=${CONTROL}\n`);
    expect(r.windowOut).toBe(`sha=${CONTROL}\n`);
  });

  it('a missed preparation window names no window source', () => {
    const r = run({ before: cutoff, after: cutoff + 1200, changed: false });
    expect(r.engineStatus).not.toBe(0);
    expect(r.windowOut).toBe('');
  });

  it('leaves the engine path reading only the cutoff step', () => {
    expect(detect.outputs.protected_sha).toBe('${{ steps.cutoff.outputs.sha }}');
    expect(cutoffStep.run).not.toContain('window_source');
    expect(cutoffStep.run).toContain('Release controls changed during reservation; keep serving.');
    for (const name of ['selection', 'signal']) {
      expect(JSON.stringify(stage.jobs[name])).not.toContain('window_sha');
    }
    for (const s of detect.steps) {
      if (s.id !== 'window_source') expect(JSON.stringify(s)).not.toContain('window_source');
    }
  });
});
