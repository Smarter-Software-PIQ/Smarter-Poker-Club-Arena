import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const script = resolve(__dirname, '../../scripts/ci/inspect-engine-restart-evidence.py');
const source = readFileSync(script, 'utf8');
const workflowText = readFileSync(
  resolve(__dirname, '../../.github/workflows/inspect-engine-restart-evidence.yml'),
  'utf8'
);

function py(code: string, ...args: string[]) {
  return spawnSync(
    'python3',
    ['-B', '-c', `import json,runpy,sys; m=runpy.run_path(sys.argv[1]); ${code}`, script, ...args],
    { encoding: 'utf8', timeout: 5000 }
  );
}

describe('engine restart evidence inspector', () => {
  it('masks every identifier, number, string, url and address before anything leaves', () => {
    const line =
      "[Tournament:b6d94533] FATAL (GameServer.Uncaught_exception) user 12345678-abcd-4321-abcd-123456789abc lost 2500.50 chips 'secret' at https://db.example.co/x?k=1 owner a@b.co deadbeefcafe";
    const result = py('print(m["mask"](sys.argv[2]))', line);
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout.trim();
    expect(out).toContain('FATAL (GameServer.Uncaught_exception)');
    for (const leaked of ['b6d94533', '12345678-abcd', '2500', 'secret', 'example.co', 'a@b.co', 'deadbeef']) {
      expect(out).not.toContain(leaked);
    }
  });

  it('refuses malformed, future, oversized or stale windows before any host read', () => {
    const now = 'datetime=__import__("datetime"); now=datetime.datetime(2026,11,14,15,0,0,tzinfo=datetime.timezone.utc)';
    const ok = py(`${now}; s,e=m["window"](sys.argv[2],sys.argv[3],now); print(m["iso"](s), m["iso"](e))`, '2026-11-14T06:10:00Z', '30');
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim()).toBe('2026-11-14T06:10:00Z 2026-11-14T06:40:00Z');
    for (const [start, minutes] of [
      ['2026-11-14 06:10:00', '30'],
      ['2026-11-14T06:10:00Z', '4'],
      ['2026-11-14T06:10:00Z', '61'],
      ['2026-11-14T14:50:00Z', '30'],
      ['2026-11-01T06:10:00Z', '30'],
      ['2026-11-14T06:10:00Z', '3; rm -rf /'],
    ]) {
      const bad = py(`${now}; m["window"](sys.argv[2],sys.argv[3],now)`, start, minutes);
      expect(bad.status, `${start} ${minutes}`).not.toBe(0);
    }
  });

  it('answers a refused argument with one fixed line and no exception text', () => {
    const result = spawnSync('python3', [script, 'not-a-sha', '2026-11-14T06:10:00Z', '30'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      '{"readOnly":true,"status":"diagnostic_refused","rawLogsExported":false}'
    );
  });

  it('only ever reads: no command in it can change the host', () => {
    expect(source).not.toMatch(
      /['"]docker['"],\s*['"](?:restart|stop|kill|rm|start|update|exec|run|pause|cp)['"]/
    );
    expect(source).not.toMatch(/systemctl|reboot|open\([^)]*['"][wa]/);
  });

  it('runs only from main, by a person, with pinned SSH and read-only repository access', () => {
    const workflow = parse(workflowText);
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.inspect;
    expect(job.environment).toBe('ci-main');
    expect(job.if).toContain("github.triggering_actor != 'github-actions[bot]'");
    expect(job.if).toContain('refs/heads/{0}');
    expect(workflowText).toContain('-o StrictHostKeyChecking=yes');
    expect(workflowText).toContain('-o GlobalKnownHostsFile=/dev/null');
    expect(workflowText).toContain('< scripts/ci/inspect-engine-restart-evidence.py');
  });
});
