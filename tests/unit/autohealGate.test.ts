/**
 * The autoheal gate asks the engine before restarting it (incident b6151c69).
 *
 * Docker failed to START the health-probe exec at 00:23-00:25 Chicago on
 * 2026-11-12 and 2026-11-14 ("timed out starting health check") while the
 * engine was dealing, and autoheal restarted a live engine. The gate restarts
 * only when the engine's own /health, read from the host with no exec, is not
 * alive or does not answer. These tests run the real script against a fake
 * `curl` and prove both branches, including that a genuinely dead engine
 * still restarts.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const script = resolve(__dirname, '../../infra/monitoring/autoheal-gate.sh');
const compose = readFileSync(
  resolve(__dirname, '../../infra/monitoring/autoheal-compose.yml'),
  'utf8'
);

const ENGINE_ID = 'a'.repeat(64);
const EXEC_START_FAILED =
  'Health check exceeded timeout (15s): timed out starting health check for container';

function run(health: { exitCode: number; body?: string }, lastOutput: string, published = true) {
  const dir = mkdtempSync(join(tmpdir(), 'autoheal-gate-'));
  const restarts = join(dir, 'restarts');
  const textfile = join(dir, 'textfile');
  spawnSync('mkdir', [textfile]);
  const list = JSON.stringify([{ Id: ENGINE_ID }]);
  const inspect = JSON.stringify({
    Name: '/club-arena-engine',
    State: { Health: { Status: 'unhealthy', Log: [{ Output: 'old' }, { Output: lastOutput }] } },
    NetworkSettings: {
      Ports: published ? { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] } : {},
    },
  });
  writeFileSync(join(dir, 'list.json'), list);
  writeFileSync(join(dir, 'inspect.json'), inspect);
  writeFileSync(join(dir, 'health.json'), health.body ?? '');
  const fakeCurl = `#!/bin/sh
for a in "$@"; do last="$a"; done
case "$*" in
  *"-X POST"*) echo "$last" >> "${restarts}"; exit 0 ;;
  *"/containers/json"*) cat "${join(dir, 'list.json')}" ;;
  *"/containers/${ENGINE_ID}/json"*) cat "${join(dir, 'inspect.json')}" ;;
  *"/health"*) [ ${health.exitCode} = 0 ] || exit ${health.exitCode}; cat "${join(dir, 'health.json')}" ;;
  *) exit 7 ;;
esac
`;
  writeFileSync(join(dir, 'curl'), fakeCurl);
  chmodSync(join(dir, 'curl'), 0o755);
  const result = spawnSync('sh', [script], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      AUTOHEAL_GATE_ONCE: '1',
      AUTOHEAL_DEFAULT_STOP_TIMEOUT: '45',
      AUTOHEAL_TEXTFILE_DIR: textfile,
    },
  });
  const restarted = existsSync(restarts) ? readFileSync(restarts, 'utf8') : '';
  const prom = existsSync(join(textfile, 'sp_autoheal.prom'))
    ? readFileSync(join(textfile, 'sp_autoheal.prom'), 'utf8')
    : '';
  return { result, restarted, prom };
}

describe('autoheal asks the engine before restarting it', () => {
  it('declines the restart when Docker could not start the probe but /health answers alive', () => {
    const { result, restarted, prom } = run(
      { exitCode: 0, body: '{"running":true,"liveness":"ok"}' },
      EXEC_START_FAILED
    );
    expect(result.status, result.stderr).toBe(0);
    expect(restarted).toBe('');
    expect(result.stdout).toContain('restart declined');
    expect(result.stdout).toContain('exec_start_failed');
    expect(prom).toContain('sp_autoheal_restart_declined_total{reason="exec_start_failed"} 1');
    expect(prom).toContain('sp_autoheal_restarts_total 0');
  });

  it('declines a standby engine that answers, and names a probe that ran and failed', () => {
    const { restarted, prom } = run(
      { exitCode: 0, body: '{"running":true,"liveness":"standby"}' },
      ''
    );
    expect(restarted).toBe('');
    expect(prom).toContain('sp_autoheal_restart_declined_total{reason="probe_failed"} 1');
  });

  it('restarts a genuinely dead engine whose /health says liveness dead', () => {
    const { result, restarted, prom } = run(
      { exitCode: 0, body: '{"running":true,"liveness":"dead"}' },
      ''
    );
    expect(restarted).toContain(`/containers/${ENGINE_ID}/restart?t=45`);
    expect(result.stdout).toContain('not_alive:dead');
    expect(prom).toContain('sp_autoheal_restarts_total 1');
  });

  it('restarts when /health does not answer within the budget, even after an exec-start failure', () => {
    const { result, restarted } = run({ exitCode: 28 }, EXEC_START_FAILED);
    expect(restarted).toContain(`/containers/${ENGINE_ID}/restart?t=45`);
    expect(result.stdout).toContain('no_answer');
  });

  it('restarts on a malformed answer or running false', () => {
    expect(run({ exitCode: 0, body: '<html>502</html>' }, '').restarted).toContain('/restart?t=45');
    expect(run({ exitCode: 0, body: '{"running":false,"liveness":"ok"}' }, '').restarted).toContain(
      '/restart?t=45'
    );
  });

  it('restarts as before when the container publishes no engine port to ask', () => {
    const { restarted } = run({ exitCode: 0, body: '{"running":true,"liveness":"ok"}' }, '', false);
    expect(restarted).toContain('/restart?t=45');
  });

  it('runs on the host network with the same 15 s budget and keeps the drain stop timeout', () => {
    expect(compose).toMatch(/entrypoint: \["\/bin\/sh", "\/autoheal-gate.sh"\]/);
    expect(compose).toMatch(/network_mode: host/);
    expect(compose).toMatch(/AUTOHEAL_ENGINE_PROBE_SECONDS: 15/);
    expect(compose).toMatch(/AUTOHEAL_DEFAULT_STOP_TIMEOUT: 45/);
    const gate = readFileSync(script, 'utf8');
    // The verdict is the HEALTHCHECK's own expression; never looser.
    expect(gate).toContain('.running == true and (.liveness == "ok" or .liveness == "standby")');
  });
});
