/**
 * LAW: a rolling release replaces the engine table by table, with every
 *      safety kept, and every failure before retirement leaves the old engine
 *      serving.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner orders (Dan, 2026-11-19): "WE NEED TO STOP REQUIRING AN ENGINE CUT
 * OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES." and "FULLY BUILD,
 * FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND
 * TESTED BEFORE CLAIMING SUCCESS."
 *
 * The rolling block of server/scripts/engine-release-transaction.sh runs here
 * against a fake host (tests/fixtures/rolling-release/fakeworld.py): Docker,
 * the engines' handoff routes, /health, Caddy, systemctl, the release seal,
 * engine-up.sh and the database proof. Proven:
 *   1. success: successor on 8081, hop 1, Caddy to 8081, old stopped, home on
 *      8080, hop 2, Caddy back to 8080, successor stopped, leader proof, seal
 *      of club-arena-engine; every unit moved, none lost;
 *   2. a stuck hop before retirement hands the moved tables back, stops the
 *      successor, aborts the seal and leaves the old engine serving on 8080;
 *   3. a serving engine without the handoff starts nothing and prepares no seal;
 *   4. a failure after retirement settles forward: the successor is sealed,
 *      the public route follows it and a home-pending marker is left;
 *   5. the route record: absent = classic, auto = rolling only with the
 *      capability and the certificate, a record for another SHA is refused;
 *   6. the pinned wiring in the workflows, engine-up.sh, recovery and docs.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const FIX = resolve(ROOT, 'tests/fixtures/rolling-release');
const TRANSACTION = read('server/scripts/engine-release-transaction.sh');
const SHA = 'b'.repeat(40);
const OLD_SHA = 'c'.repeat(40);
const IMAGE = 'sha256:' + '2'.repeat(64);

function rollingBlock(): string {
  // Exactly what --rolling-recover loads: the two marked rolling regions.
  const regions = [
    ...TRANSACTION.matchAll(
      /^# >>> ROLLING RELEASE [A-Z]+\n[\s\S]*?^# <<< ROLLING RELEASE [A-Z]+\n/gm
    ),
  ].map((m) => m[0]);
  expect(regions).toHaveLength(2);
  return regions.join('\n');
}

interface World {
  containers: Record<string, any>;
  ops?: string[];
  fail?: Record<string, any>;
  desired?: { sha: string; container?: string };
  [k: string]: any;
}

function world(fail: Record<string, any> = {}, capable = true): World {
  return {
    target: SHA,
    desired: { sha: OLD_SHA },
    fail,
    containers: {
      'club-arena-engine': {
        id: '9'.repeat(64),
        image: 'sha256:' + '1'.repeat(64),
        sha: OLD_SHA,
        port: 8080,
        running: true,
        engine: {
          instance: '1795000000000-aaaaaaaa',
          mode: 'serving',
          owned: 5,
          adopted: 0,
          successor: null,
          capable,
        },
      },
      'sp-autoheal': { id: '8'.repeat(64), image: 'x', sha: '', running: true, engine: null },
    },
  };
}

function run(w: World, script: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rolling-release-'));
  const bin = join(dir, 'bin');
  spawnSync('bash', [join(FIX, 'shims.sh'), bin], { encoding: 'utf8' });
  mkdirSync(join(dir, 'requests'));
  writeFileSync(join(dir, 'world.json'), JSON.stringify(w));
  writeFileSync(
    join(dir, 'Caddyfile'),
    'engine.smarter.poker {\n    reverse_proxy localhost:8080 {\n        flush_interval -1\n    }\n}\n'
  );
  writeFileSync(join(dir, 'env'), 'X=1\n');
  writeFileSync(join(dir, 'retain-engine-images.sh'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(dir, 'retain-engine-images.sh'), 0o755);
  writeFileSync(join(dir, 'block.sh'), rollingBlock());
  const prelude = `set -Eeuo pipefail
export PATH="${bin}:$PATH"
REQUEST_ROOT="${dir}/requests"; RELEASE_SEAL="${bin}/seal"; ENGINE_UP="${bin}/engine-up"; DATABASE_PROOF="${bin}/dbproof"
CONTAINER=club-arena-engine; IMAGE_REPO=club-arena-engine; PUBLIC_URL="$ENGINE_URL"; ENV_FILE="${dir}/env"; REPO_DIR="${dir}"; CONTROL_DIR="${dir}"
SHA=${SHA}; TARGET_IMAGE_ID=${IMAGE}; RUN_ID=123-1; RUN_URL=https://example.invalid/run; ACTOR=tester; SEAL_MODE=deploy; CONTROL_SHA=${'d'.repeat(40)}
LOCK_HELD=0; PREPARED=0; MUTATION_STARTED=0; DRILL_MODE=''; WINDOW_DOOR_NAMES=''
die() { echo "FATAL: $*" >&2; exit 1; }
require_backup_certificate() { return 0; }
installed_migrations_unchanged() { :; }
acquire_engine_lock() { LOCK_HELD=1; }
source_target_is_current() { :; }
exact_runtime_instance() { return 1; }
emit_already_released() { exit 0; }
validate_candidate_image() { :; }
source_instance_for_sha() { rolling_local_instance 8080 - ok; }
persist_result() { echo "ENGINE_RELEASE_RESULT=$1 instance=$2 container=$CONTAINER"; }
source "${dir}/block.sh"
rolling_certificate() { return 0; }
`;
  writeFileSync(join(dir, 'run.sh'), prelude + script);
  const result = spawnSync('bash', [join(dir, 'run.sh')], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      ROLLING_WORLD: join(dir, 'world.json'),
      ENGINE_URL: 'https://engine.example',
      ENGINE_ROLLING_CADDYFILE: join(dir, 'Caddyfile'),
      ENGINE_ROLLING_CADDY_BIN: join(bin, 'caddy'),
      ENGINE_ROLLING_SYSTEMCTL_BIN: join(bin, 'systemctl'),
      ENGINE_RELEASE_STATE_DIR: dir,
      ENGINE_ROLLING_PUBLIC_SECONDS: '3',
      ENGINE_ROLLING_BOOT_SECONDS: '5',
      ...env,
    },
  });
  const after: World = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
  return { ...result, after, dir, caddy: readFileSync(join(dir, 'Caddyfile'), 'utf8') };
}

const RELEASE = `trap 'rc=$?; rolling_recover_on_exit $rc' EXIT\nrolling_release\n`;

describe('a rolling release', () => {
  it('moves every table to the new engine in two hops and seals club-arena-engine on 8080', () => {
    const r = run(world(), RELEASE);
    expect(r.stderr).not.toContain('FATAL');
    expect(r.status).toBe(0);
    const ops = r.after.ops!;
    expect(ops).toContain('engine-up --successor club-arena-engine-next 8081 autoheal=false');
    expect(ops).toContain('engine-up --successor club-arena-engine 8080 autoheal=true');
    expect(ops.filter((o) => o === 'seal prepare')).toHaveLength(2);
    expect(ops).toContain('seal commit club-arena-engine');
    expect(ops).not.toContain('seal abort');
    const home = r.after.containers['club-arena-engine'];
    expect(home.sha).toBe(SHA);
    expect(home.port).toBe(8080);
    expect(home.running).toBe(true);
    expect(home.engine.owned).toBe(5);
    expect(r.after.containers['club-arena-engine-next']).toBeUndefined();
    const outgoing = Object.entries(r.after.containers).filter(([n]) =>
      n.startsWith('club-arena-engine-outgoing-')
    );
    expect(outgoing).toHaveLength(2);
    expect(
      outgoing.every(([, c]: [string, any]) => c.running === false && c.engine.owned === 0)
    ).toBe(true);
    expect(r.caddy).toContain('reverse_proxy localhost:8080 {');
    expect(r.stdout).toContain(
      `ENGINE_RELEASE_RESULT=sealed instance=${home.engine.instance} container=club-arena-engine`
    );
    expect(r.after.containers['sp-autoheal'].running).toBe(true);
  });

  it('hands moved tables back and leaves the old engine serving when hop 1 cannot finish', () => {
    const r = run(world({ stuck_after: { 'club-arena-engine': 2 } }), RELEASE, {
      ENGINE_ROLLING_HOP_SECONDS: '2',
    });
    expect(r.status).toBe(1);
    const ops = r.after.ops!;
    expect(ops).toContain('abort club-arena-engine');
    expect(
      ops.some((o) => o.startsWith('yield club-arena-engine-next -> 1795000000000-aaaaaaaa'))
    ).toBe(true);
    expect(ops).toContain('seal abort');
    expect(ops).not.toContain('seal commit club-arena-engine');
    const old = r.after.containers['club-arena-engine'];
    expect(old.running).toBe(true);
    expect(old.sha).toBe(OLD_SHA);
    expect(old.engine.mode).toBe('serving');
    expect(old.engine.owned).toBe(5);
    expect(r.after.containers['club-arena-engine-next']).toBeUndefined();
    expect(r.caddy).toContain('reverse_proxy localhost:8080 {');
    expect(readFileSync(join(r.dir, 'requests/123-1.rolling-state'), 'utf8')).toContain(
      'phase=recovered'
    );
  });

  it('starts nothing when the serving engine does not offer the handoff', () => {
    const r = run(world({}, false), RELEASE);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('does not offer the rolling handoff');
    expect(
      (r.after.ops ?? []).filter((o) => o.startsWith('engine-up') || o.startsWith('seal'))
    ).toEqual([]);
  });

  it('settles forward on the successor when the route home fails after retirement', () => {
    // Caddy reloads fail: hop 1 retires the old engine, then the route to 8081 cannot be proven.
    const r = run(world({ caddy: true }), RELEASE);
    expect(r.status).toBe(0);
    expect(r.after.ops).toContain('seal commit club-arena-engine-next');
    expect(r.stdout).toContain('ENGINE_ROLLING_HOME_PENDING=8081');
    expect(existsSync(join(r.dir, 'engine-rolling-home-pending'))).toBe(true);
    expect(r.after.containers['club-arena-engine-next'].running).toBe(true);
    expect(r.after.containers['club-arena-engine-next'].engine.owned).toBe(5);
  });

  it('selects its route from the root-only record, defaulting to classic', () => {
    const script = (record: string) => `
${record}
rolling_select_mode >/dev/null
echo "MODE=$RELEASE_MODE"
`;
    const write = (mode: string, sha = SHA) =>
      `printf 'engine-release-mode-v1\\n${mode}\\n${sha}\\n%s\\n' "$CONTROL_SHA" > "$REQUEST_ROOT/$RUN_ID.mode"; chmod 600 "$REQUEST_ROOT/$RUN_ID.mode"
stat() { echo "0:600"; }`;
    expect(run(world(), script('')).stdout).toContain('MODE=classic');
    expect(run(world(), script(write('auto'))).stdout).toContain('MODE=rolling');
    expect(run(world({}, false), script(write('auto'))).stdout).toContain('MODE=classic');
    expect(
      run(world(), script(write('auto') + '\nrolling_certificate() { return 1; }')).stdout
    ).toContain('MODE=classic');
    expect(run(world(), script(write('classic'))).stdout).toContain('MODE=classic');
    const wrong = run(world(), script(write('rolling', 'e'.repeat(40))));
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('names a different target');
  });

  it('lets ExecStopPost hand moved tables back through the real --rolling-recover entry', () => {
    const w = world({ stuck: 'club-arena-engine' });
    w.containers['club-arena-engine'].engine = {
      instance: '1795000000000-aaaaaaaa',
      mode: 'yielding',
      owned: 3,
      adopted: 0,
      successor: '17950000000003-00000003',
    };
    w.containers['club-arena-engine-next'] = {
      id: '3'.repeat(64),
      image: IMAGE,
      sha: SHA,
      port: 8081,
      running: true,
      successor: true,
      engine: {
        instance: '17950000000003-00000003',
        mode: 'serving',
        owned: 2,
        adopted: 2,
        successor: null,
      },
    };
    const script = `
printf 'engine-rolling-state-v1\\nphase=hop1-yielding\\nsha=${SHA}\\nimage=${IMAGE}\\nold=1795000000000-aaaaaaaa\\nnext=17950000000003-00000003\\nhome=-\\n' > "$REQUEST_ROOT/123-1.rolling-state"
printf '${SHA}\\nhttps://example.invalid/run\\ntester\\n/x\\n${'d'.repeat(40)}\\n1795000000\\n' > "$REQUEST_ROOT/123-1.request"
ENGINE_RELEASE_REQUEST_ROOT="$REQUEST_ROOT" CONTAINER=club-arena-engine bash "${resolve(ROOT, 'server/scripts/engine-release-transaction.sh')}" --rolling-recover --run-id 123-1
`;
    const r = run(w, script);
    expect(r.stderr).not.toContain('command not found');
    expect(r.status).toBe(0);
    expect(r.after.ops).toContain('abort club-arena-engine');
    const old = r.after.containers['club-arena-engine'];
    expect(old.engine.mode).toBe('serving');
    expect(old.engine.owned).toBe(5);
    expect(r.after.containers['club-arena-engine-next']).toBeUndefined();
    expect(readFileSync(join(r.dir, 'requests/123-1.rolling-state'), 'utf8')).toContain(
      'phase=recovered'
    );
  });
});

describe('the rolling route is wired end to end', () => {
  it('keeps the classic transaction path behind the same gates when no route record exists', () => {
    expect(TRANSACTION).toContain(
      'rolling_select_mode\nif [ "${RELEASE_MODE:-classic}" = rolling ]; then\nFLOOR_DISPOSITION=never-entered'
    );
    expect(TRANSACTION).toContain(
      '[ "${RELEASE_MODE:-classic}" = rolling ] || initialise_phase1_cycle'
    );
    expect(TRANSACTION).toContain(
      'if [ "${RELEASE_MODE:-classic}" = rolling ]; then rolling_release; fi'
    );
    expect(TRANSACTION).toContain(
      'if [ "${RELEASE_MODE:-classic}" = rolling ] && declare -F rolling_recover_on_exit >/dev/null; then rolling_recover_on_exit "$rc"; fi'
    );
    // Rolling keeps the certificate, the rolling verdict, the lock, the image checks and the seal.
    const main = TRANSACTION.slice(
      TRANSACTION.indexOf('rolling_release() {'),
      TRANSACTION.indexOf('rolling_finish_forward() {')
    );
    for (const gate of [
      'require_backup_certificate',
      'rolling_certificate',
      'acquire_engine_lock',
      'validate_candidate_image',
      'rolling_prepare_token',
      'installed_migrations_unchanged',
      'window_doors_ready',
      '"$DATABASE_PROOF"',
      'rolling_commit',
      'persist_result sealed',
    ])
      expect(main).toContain(gate);
    // ...and never touches the break machinery.
    for (const skipped of [
      'daily_cutover_clock',
      'maintenance_certificate',
      'persist_break_deadline',
      'request_recovery_window',
      'hold_lightning_when_counting_down',
    ])
      expect(main).not.toContain(skipped);
  });

  it('starts the successor beside the serving engine through the one classic run-spec', () => {
    const up = read('server/scripts/engine-up.sh');
    expect(up.match(/docker create \\/g)).toHaveLength(1);
    const successor = up.slice(
      up.indexOf('if [ "$SUCCESSOR_MODE" = 1 ]; then\n  ENGINE_AUTOHEAL_LABEL'),
      up.indexOf('log "replacing $CONTAINER with')
    );
    expect(successor).toContain(
      'SUCCESSOR_CREATE_ARGS=(--label sp.engine-up.successor=1 --env "$SUCCESSOR_ROLE_ENV")'
    );
    expect(successor).toContain('already exists; a successor never replaces a container');
    expect(successor).toContain(
      'is already published; the successor starts beside the serving engine'
    );
    expect(successor).not.toMatch(/docker (stop|rm|kill|rename)/);
    const create = up.slice(
      up.indexOf('docker create \\'),
      up.indexOf('"$AUTHORIZED_IMAGE_ID")"', up.indexOf('docker create \\'))
    );
    expect(create).toContain('--label "autoheal=$ENGINE_AUTOHEAL_LABEL"');
    expect(create).toContain('${SUCCESSOR_CREATE_ARGS[@]+"${SUCCESSOR_CREATE_ARGS[@]}"}');
    expect(create).toContain('--env "$ROLLING_HANDOFF_FLAG_ENV"');
    expect(create).toContain('--env "$HANDOFF_PEER_PORT_ENV"');
    expect(up).toContain("SUCCESSOR_ROLE_ENV='ENGINE_ROLE=handoff-successor'");
    expect(up).toContain('HANDOFF_PEER_PORT_ENV="ENGINE_HANDOFF_PEER_PORT=8081"');
    expect(spawnSync('bash', ['-n', resolve(ROOT, 'server/scripts/engine-up.sh')]).status).toBe(0);
  });

  it('lets ExecStopPost run the rolling recovery and cleans the route records', () => {
    const recover = read('server/scripts/engine-release-recover.sh');
    expect(recover).toContain(
      '"$CONTROL_DIR/engine-release-transaction.sh" --rolling-recover --run-id "$RUN_ID"'
    );
    expect(recover).toContain('"$REQUEST_ROOT/$RUN_ID.mode" "$REQUEST_ROOT/$RUN_ID.rolling-state"');
    expect(TRANSACTION).toContain('if [ "${1:-}" = --rolling-recover ]; then');
    expect(TRANSACTION).toContain(
      `source <(sed -n '/^# >>> ROLLING RELEASE /,/^# <<< ROLLING RELEASE /p' "\${BASH_SOURCE[0]}")`
    );
  });

  it('drops the 04:00 gating only on a clock-free route in the workflows', () => {
    const deploy = read('.github/workflows/auto-deploy-hetzner.yml');
    expect(deploy).toContain(
      "REQUESTED_MODE: ${{ github.event.client_payload.release_mode || 'auto' }}"
    );
    // The gates stay unconditional steps; only a clock-free route exits them early.
    const jobs = (
      parse(deploy) as { jobs: Record<string, { steps?: Array<Record<string, unknown>> }> }
    ).jobs;
    const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
    for (const id of ['daily_release', 'admit', 'floor']) {
      const step = steps.find((s) => s.id === id);
      expect(step).toBeDefined();
      expect(String(step!.run)).toContain('if [ "${CLOCK_FREE:-false}" = true ]; then');
      expect(step!.if).toBeUndefined();
    }
    // The route is resolved only after the unconditional certificate gate,
    // inside the daily gate step that it may exit early.
    const daily = String(steps.find((s) => s.id === 'daily_release')!.run);
    expect(
      daily.indexOf('echo "clock_free=$CLOCK_FREE" >> "${GITHUB_OUTPUT:-/dev/null}"')
    ).toBeGreaterThan(-1);
    expect(
      daily.indexOf('echo "clock_free=$CLOCK_FREE" >> "${GITHUB_OUTPUT:-/dev/null}"')
    ).toBeLessThan(daily.indexOf('if [ "${CLOCK_FREE:-false}" = true ]; then'));
    expect(deploy).toContain('clock_free: ${{ steps.daily_release.outputs.clock_free }}');
    expect(deploy).toContain('backup-engine/rolling-handoff');
    expect(deploy).toContain("printf 'engine-release-mode-v1\\n%s\\n%s\\n%s\\n'");
    // The Backup certificate gate itself is unconditional.
    expect(deploy).toMatch(/id: backup_certificate\n\s+env:/);
    const stage = read('.github/workflows/stage-engine-release.yml');
    expect(stage).toContain('client_payload[release_mode]=$RELEASE_MODE');
    expect(stage).toMatch(
      /release_mode:\n\s+description:[^\n]*\n\s+required: false\n\s+default: auto/
    );
    const backup = read('.github/workflows/backup-engine.yml');
    expect(backup).toContain('context=backup-engine/rolling-handoff');
  });

  it('rehearses the rolling release on the Backup and records it in the certificate', () => {
    const standby = read('server/standby/standby-engine.sh');
    const trials = read('server/standby/standby-trials.sh');
    expect(trials).toContain('trial_rolling_handoff() {');
    expect(trials).toContain('rolling-handoff) trial_rolling_handoff');
    for (const assertion of [
      'moves_not_adopted',
      'seats_changed',
      'tournament_clock_changed',
      'old_did_not_retire',
      'rollback_did_not_drain',
    ])
      expect(trials).toContain(assertion);
    expect(standby).toContain('"rollingHandoff": json.loads(sys.argv[6])');
    for (const f of [
      'server/standby/standby-engine.sh',
      'server/standby/standby-trials.sh',
      'server/scripts/engine-release-transaction.sh',
      'server/scripts/engine-release-recover.sh',
    ])
      expect(spawnSync('bash', ['-n', resolve(ROOT, f)]).status).toBe(0);
  });
});
