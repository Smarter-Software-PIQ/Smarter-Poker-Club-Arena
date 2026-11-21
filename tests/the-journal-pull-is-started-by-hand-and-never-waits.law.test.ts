/**
 * LAW (2026-11-21): the off-host copy of the Horse decision journal is started
 * by hand, reads the engine host only when the release rules allow it, and
 * never waits.
 *
 * scripts/ops/journal-keep/pull.sh is the only sanctioned way records leave the
 * engine host. A host read between a booking's merge and its seal, or inside
 * the nightly 03:05-04:45 Chicago window, is forbidden; on 2026-11-20 a pull
 * guarded by the WORDING of a coordination post missed a merge and read the
 * host inside an open window, and a phrase-triggered waiter was killed for
 * restarting itself. So:
 *   - the guard is read from GitHub and the engine's /health, and every clause
 *     that cannot be read refuses;
 *   - when it refuses, before the first batch or between two, the script exits;
 *     it has no sleep, no polling loop and nothing that restarts it;
 *   - records go only into private files; the terminal and the log get counts.
 * The hermetic script test (fake gh, curl and ssh) proves each clause; this law
 * runs it and pins the properties in the source.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const PULL = join(ROOT, 'scripts', 'ops', 'journal-keep', 'pull.sh');
const TEST = join(ROOT, 'scripts', 'ops', 'journal-keep', 'tests', 'test_pull.sh');

describe('the journal pull is started by hand and never waits', () => {
  const source = readFileSync(PULL, 'utf8');
  const code = source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('the hermetic test passes: every guard clause refuses, a closed guard stops a pull, records stay in private files', () => {
    const out = execFileSync('bash', [TEST], { encoding: 'utf8', timeout: 120_000 });
    expect(out).toMatch(/journal-keep pull: (\d+)\/\1 passed/);
    expect(Number(/(\d+)\/\d+ passed/.exec(out)![1])).toBeGreaterThanOrEqual(57);
  }, 150_000);

  it('cannot wait: no sleep, no polling loop, nothing that restarts or schedules it', () => {
    expect(code).not.toMatch(
      /(^|[^A-Za-z])(sleep|until|watch|inotifywait|fswatch|nohup|screen|crontab|launchctl)([^A-Za-z]|$)/m
    );
    expect(code).not.toMatch(/while (true|:)/);
    // One loop: over the batches of the keys it was given.
    expect(code.match(/^\s*while /gm)?.length).toBe(1);
    expect(code).toContain('if ! guard; then');
    expect(code).toMatch(/guard refused before \$name"[^\n]*exit 75/);
  });

  it('the guard is GitHub and /health, never the wording of a coordination post', () => {
    expect(code).not.toMatch(/COORDINATION-INBOX|SUBJECT:|SEALED|BOOKING MERGED|extreme-archive/);
    for (const clause of [
      '-ge 305',
      '-le 445',
      'America/Chicago',
      'apply-merged-migration.yml dispatch-merged-migrations.yml',
      'auto-deploy-hetzner.yml',
      'startswith("Engine Release")',
      'stage-engine-release.yml',
      'server/release/owner-maintenance-windows.json',
      'pr list --state merged',
      '.conclusion==',
    ])
      expect(code, clause).toContain(clause);
  });

  it('on the host: one throwaway read-only container, no network, the store mounted read-only, nothing written', () => {
    expect(code).toContain('run --rm -i --network none --read-only');
    expect(code).toContain('-v $MOUNT:/j:ro');
    expect(code).not.toMatch(/\bscp\b|\brsync\b|\bsftp\b/);
    // The one command the host is ever given: a load check and the container. No redirect, no file command.
    expect(code.match(/\$SSH /g)?.length).toBe(1);
    const remote = code.split('\n').filter((line) => /^\s*remote=/.test(line));
    expect(remote.length).toBe(1);
    expect(remote[0]).not.toMatch(
      />|(?<!-)\b(mkdir|rm|mv|cp|tee|touch|chmod|chown|sudo|exec|kill|restart)\b/
    );
  });

  it('is executable and writes private files', () => {
    expect(statSync(PULL).mode & 0o111).not.toBe(0);
    expect(code).toContain('umask 077');
    expect(code).toContain('chmod 600 "$out"');
    expect(code).toContain('DEST is inside a git checkout');
  });
});
