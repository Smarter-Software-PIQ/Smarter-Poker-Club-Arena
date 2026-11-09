import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  const outFile = process.argv[4];
  const { writeFileSync } = await import('node:fs');
  const { writeFile } = await import('node:fs/promises');
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  if (mode === 'code3') process.exitCode = 3;
  const runs = {
    ok: async () => {},
    code3: async () => {},
    refuse: async () => { throw new Error('probe_refusal'); },
    // A write the run made before it failed survives, and the failure is kept.
    'write-then-refuse': async () => {
      writeFileSync(outFile, 'written-before-refusal');
      await later(300);
      throw new Error('probe_refusal_after_write');
    },
    // Asynchronous writes the run awaits are complete before the exit.
    'async-write': async () => {
      await later(300);
      await writeFile(outFile, 'x'.repeat(4 * 1024 * 1024));
    },
    // Output larger than a pipe buffer still reaches the reader in full.
    'big-stdout': async () => { process.stdout.write('y'.repeat(2 * 1024 * 1024) + '\\nEND\\n'); },
  };
  finishCli(runs[mode]());
}
`
);
const env = {
  ...process.env,
  SUPABASE_URL: 'https://supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'feature-ablation-offline-placeholder',
};
function run(mode: string, killAfterMs: number, outFile = '') {
  return new Promise<{ code: number | null; killed: boolean; out: string; err: string }>((done) => {
    const child = spawn(tsx, [harness, server, mode, outFile], { cwd: server, env });
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

  it('keeps a write made before a failure, and still exits 2 with the refusal', async () => {
    const file = join(dir, 'before-refusal.txt');
    const r = await run('write-then-refuse', 45_000, file);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Feature ablation assembly refused: probe_refusal_after_write');
    expect(readFileSync(file, 'utf8')).toBe('written-before-refusal');
  }, 60_000);

  it('completes awaited asynchronous writes before exiting', async () => {
    const file = join(dir, 'async-write.txt');
    const r = await run('async-write', 45_000, file);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(0);
    expect(statSync(file).size).toBe(4 * 1024 * 1024);
  }, 60_000);

  it('delivers stdout larger than a pipe buffer in full before exiting', async () => {
    const r = await run('big-stdout', 45_000);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(0);
    expect(r.out.endsWith('END\n')).toBe(true);
    expect(r.out.length).toBeGreaterThan(2 * 1024 * 1024);
  }, 60_000);

  it('keeps an exit code the run set', async () => {
    const r = await run('code3', 45_000);
    expect(r.killed).toBe(false);
    expect(r.code).toBe(3);
  }, 60_000);
});
