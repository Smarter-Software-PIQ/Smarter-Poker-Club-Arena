import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The assemble CLI loads the locked contract, which imports engine modules
// holding live module-level handles (ChannelHub's lobby interval). Without an
// explicit end, --prepare and --assemble never exited: every held-out cell would
// sit until its 240-minute job timeout with the partition already reserved.
const server = fileURLToPath(new URL('../../', import.meta.url));
const tsx = join(server, 'node_modules', '.bin', 'tsx');
const dir = mkdtempSync(join(tmpdir(), 'assemble-exit-'));
const harness = join(dir, 'harness.mts');
writeFileSync(
  harness,
  `import { pathToFileURL } from 'node:url';
const [server, mode] = process.argv.slice(2);
await import(pathToFileURL(server + 'src/benchmark/FeatureAblationQualification.ts').href);
if (mode === 'control') { console.log('loaded'); }
else {
  const { finishCli } = await import(pathToFileURL(server + 'scripts/feature-ablation-assemble.mjs').href);
  console.log('loaded');
  if (mode === 'code3') process.exitCode = 3;
  finishCli(mode === 'refuse' ? Promise.reject(new Error('probe_refusal')) : Promise.resolve());
}
`
);
const env = {
  ...process.env,
  SUPABASE_URL: 'https://supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'feature-ablation-offline-placeholder',
};
function run(mode: string, killAfterMs: number) {
  return new Promise<{ code: number | null; killed: boolean; out: string; err: string }>((done) => {
    const child = spawn(tsx, [harness, server, mode], { cwd: server, env });
    let out = '',
      err = '',
      killed = false;
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, killAfterMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, killed, out, err });
    });
  });
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the feature-ablation assemble CLI always ends', () => {
  it('the contract import alone keeps the process alive (the hazard is real)', async () => {
    const r = await run('control', 8_000);
    expect(r.out).toContain('loaded');
    expect(r.killed).toBe(true);
  }, 60_000);

  it('ends with code 0 once a successful run settles', async () => {
    const r = await run('ok', 45_000);
    expect(r.killed).toBe(false);
    expect(r.out).toContain('loaded');
    expect(r.code).toBe(0);
  }, 60_000);

  it('ends with code 2 and the refusal on stderr when the run rejects', async () => {
    const r = await run('refuse', 45_000);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Feature ablation assembly refused: probe_refusal');
  }, 60_000);

  it('keeps an exit code the run set', async () => {
    const r = await run('code3', 45_000);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(3);
  }, 60_000);
});
