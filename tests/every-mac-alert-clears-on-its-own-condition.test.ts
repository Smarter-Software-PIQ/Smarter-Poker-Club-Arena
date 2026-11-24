/**
 * EVERY MAC ALERT CLEARS ON ITS OWN CONDITION (2026-11-24).
 *
 * The install queue (InstallQueueServiceDown, InstallQueueJobFailed) and the git
 * maintenance guard (Git Maintenance Not Keeping Up) raised firing alerts that
 * nothing ever resolved: 6 and 34 were still firing on 2026-11-24, so their
 * Reliability Controller incidents could never clear. Each sender now measures
 * its own condition on every run and resolves through
 * public.fn_resolve_operational_alerts when the condition is clear.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const dir = 'operations/ops-mac';
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mac-alert-'));

describe('the git maintenance guard', () => {
  const run = (packs: number, limit: number) => {
    const root = tmp();
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.git', 'objects', 'pack'), { recursive: true });
    for (let i = 0; i < packs; i++)
      fs.writeFileSync(path.join(repo, '.git', 'objects', 'pack', `p${i}.pack`), '');
    const log = path.join(root, 'guard.log');
    execFileSync('bash', [`${dir}/git-maintenance-guard.sh`], {
      env: {
        ...process.env,
        DRY_ALERTS: '1',
        GUARD_REPOS: repo,
        PACK_LIMIT: String(limit),
        GUARD_LOG: log,
      },
    });
    return { repo, out: fs.readFileSync(log, 'utf8') };
  };

  it('raises the backlog warning over the limit and does not resolve it', () => {
    const { repo, out } = run(3, 2);
    expect(out).toContain(`DRY alert firing/warning pack-backlog:${repo}:`);
    expect(out).not.toContain('DRY resolve');
  });

  it("resolves the repo's backlog warnings once it is back at or under the limit", () => {
    const { repo, out } = run(2, 2);
    expect(out).toContain(`DRY resolve pack-backlog:${repo}:`);
    expect(out).not.toContain('DRY alert firing');
  });

  it('resolves through the one narrow door for its own source', () => {
    expect(read('git-maintenance-guard.sh')).toContain(
      "public.fn_resolve_operational_alerts('mac-studio-git-maintenance',"
    );
  });
});

describe('the heartbeat clears the install-queue alerts', () => {
  const beat = read('heartbeat.sh');

  it('resolves queue-down while the queue process runs', () => {
    expect(beat).toMatch(
      /if pgrep -f 'ops\/install-queue\.sh' >\/dev\/null; then\n\s+echo "SELECT public\.fn_resolve_operational_alerts\('install-queue', 'queue-down:ops-mac-studio:'/
    );
  });

  it('resolves a failed job only when its migration is recorded or its PR closed', () => {
    expect(beat).toContain(
      "FROM supabase_migrations.schema_migrations m WHERE m.version = j->>'version'"
    );
    expect(beat).toContain("WHERE (j->>'closed')::boolean");
  });

  it('reads each failed job into its alert key, version and closed state', () => {
    const script = beat.match(/F=\$\(python3 - "\$Q\/failed" <<'PY'\n([\s\S]*?)\nPY\n/)?.[1];
    expect(script, 'the failed-job reader').toBeTruthy();
    const failed = tmp();
    fs.writeFileSync(
      path.join(failed, '20261118T233246-pr11326.job'),
      'PR=11326\nFILE=20261118233000_the_capped_satellite_executor.sql\nRESULT=install rc=3 (see log)\n'
    );
    fs.writeFileSync(
      path.join(failed, '20261103T192704-pr9448.job'),
      'PR=9448\nFILE=20261103190000_x.sql\nRESULT=PR closed without merge\n'
    );
    const py = path.join(tmp(), 'reader.py');
    fs.writeFileSync(py, script!);
    const rows = JSON.parse(execFileSync('python3', [py, failed], { encoding: 'utf8' }));
    expect(rows).toEqual([
      { key: 'failed:20261103T192704-pr9448.job', version: '20261103190000', closed: true },
      { key: 'failed:20261118T233246-pr11326.job', version: '20261118233000', closed: false },
    ]);
  });
});
