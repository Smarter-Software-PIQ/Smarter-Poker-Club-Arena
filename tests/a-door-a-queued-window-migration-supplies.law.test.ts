/**
 * A DOOR A QUEUED WINDOW MIGRATION SUPPLIES (2026-11-01).
 *
 * From #9054 (merge 0d7cd8df4e) every engine release request failed "Prove
 * The Exact Engine Has Every Production Door": the engine calls
 * fn_ca_cancel_tournament_abort_unsettled_hand, which only the queued
 * "-- @install-window: daily-maintenance" migration 20261101005048 creates,
 * and that migration installs only inside the 04:00 America/Chicago freeze -
 * some 25 minutes after the door check runs. The build could never reach the
 * freeze that would have made it safe: a deadlock.
 *
 * The door check now CARRIES such a door instead of refusing it, and only when
 * (a) a non-superseded window migration in the target tree creates it and
 * production has not recorded that migration, (b) no live owner-window floor
 * moves the cutover off the daily freeze, and (c) this is not a rollback. The
 * carried names are bound to the run key before the durable intake, and the
 * host transaction refuses any break but the daily one, never requests an
 * off-cycle window for it, and refuses the SEAL unless each function exists
 * after the window installer has committed - inside its unchanged budgets.
 *
 * Changelog: docs/changelog/2026-11-01-a-door-a-queued-window-migration-supplies.md
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Real child processes: wall time scales with machine load (see the sibling
// the-engine-ships-only-with-its-doors law for the measured headroom).
vi.setConfig({ testTimeout: 90_000 });

const root = resolve(__dirname, '..');
const SCRIPT = resolve(root, 'scripts/ci/check-engine-doors-exist.mjs');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const WF = read('.github/workflows/auto-deploy-hetzner.yml');
const TX = read('server/scripts/engine-release-transaction.sh');
const RECOVER = read('server/scripts/engine-release-recover.sh');
const PROOF = resolve(root, 'server/scripts/engine-release-database-proof.py');
const MIGRATION = read(
  'supabase/migrations/20261101134516_engine_release_reads_which_public_functions_are_missing.sql'
);

type Tree = {
  dir: string;
  run: (opts?: {
    live?: string[];
    history?: unknown;
    env?: Record<string, string>;
  }) => { status: number | null; stdout: string; output: string };
};

const WINDOW = '-- @install-window: daily-maintenance';

function tree(files: Record<string, string>): Tree {
  const dir = mkdtempSync(join(tmpdir(), 'window-door-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return {
    dir,
    run: ({ live = ['fn_existing'], history, env = {} } = {}) => {
      const liveFile = join(dir, '.live.json');
      writeFileSync(liveFile, JSON.stringify(live));
      const out = join(dir, '.github-output');
      writeFileSync(out, '');
      const clean = { ...process.env };
      for (const k of Object.keys(clean)) if (k.startsWith('ENGINE_DOORS_')) delete clean[k];
      delete clean.DATABASE_URL;
      const extra: Record<string, string> = {};
      if (history !== undefined) {
        const h = join(dir, '.history.json');
        writeFileSync(h, JSON.stringify(history));
        extra.ENGINE_DOORS_WINDOW_HISTORY_FIXTURE = h;
      }
      const res = spawnSync(process.execPath, [SCRIPT], {
        cwd: dir,
        env: {
          ...clean,
          GITHUB_OUTPUT: out,
          ENGINE_DOORS_LIVE_FIXTURE: liveFile,
          ...extra,
          ...env,
        },
        encoding: 'utf8',
      });
      return { status: res.status, stdout: res.stdout, output: readFileSync(out, 'utf8') };
    },
  };
}

const ENGINE = "await supabase.rpc('fn_existing');\nawait supabase.rpc('fn_window_door', {});\n";
const windowMigration = (extra = '') =>
  `-- 20990101000000_window_door.sql\n${WINDOW}\n${extra}BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_window_door(p uuid) RETURNS int LANGUAGE sql AS $$ select 1 $$;\nCOMMIT;\n`;

describe('the door check carries a door only a queued window migration can supply', () => {
  it('carries it, names it, and passes when its window migration is queued', () => {
    const t = tree({
      'server/src/a.ts': ENGINE,
      'supabase/migrations/20990101000000_window_door.sql': windowMigration(),
    });
    try {
      const res = t.run({ history: [] });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(
        /::notice title=DOOR SUPPLIED BY A QUEUED WINDOW MIGRATION::fn_window_door\(\) is created by 20990101000000_window_door\.sql/
      );
      expect(res.output).toBe('window_doors=fn_window_door@20990101000000\n');
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it('refuses it when production already records the supplier (by version or by name)', () => {
    const t = tree({
      'server/src/a.ts': ENGINE,
      'supabase/migrations/20990101000000_window_door.sql': windowMigration(),
    });
    try {
      for (const row of [
        { version: '20990101000000', name: 'other' },
        { version: '20990101000999', name: 'window_door' },
      ]) {
        const res = t.run({ history: [row] });
        expect(res.status).toBe(1);
        expect(res.stdout).toMatch(/::error title=MISSING DATABASE DOOR::fn_window_door\(\)/);
        expect(res.output).toContain('refusal=missing database function fn_window_door()');
        expect(res.output).not.toContain('window_doors=');
      }
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it('never treats an ordinary, superseded or commented-out creation as a supplier', () => {
    const cases: Record<string, string> = {
      ordinary: `BEGIN;\nCREATE FUNCTION public.fn_window_door() RETURNS int LANGUAGE sql AS $$ select 1 $$;\nCOMMIT;\n`,
      superseded: windowMigration('-- SUPERSEDED BY 20990101000001\n'),
      commented: `${WINDOW}\nBEGIN;\n-- CREATE FUNCTION public.fn_window_door() RETURNS int\nCOMMIT;\n`,
      private: `${WINDOW}\nBEGIN;\nCREATE FUNCTION smarter_private.fn_window_door() RETURNS int LANGUAGE sql AS $$ select 1 $$;\nCOMMIT;\n`,
    };
    for (const [label, sql] of Object.entries(cases)) {
      const t = tree({
        'server/src/a.ts': ENGINE,
        'supabase/migrations/20990101000000_window_door.sql': sql,
        'supabase/migrations/20990101000001_later.sql': 'BEGIN;\nCOMMIT;\n',
      });
      try {
        const res = t.run({ history: [] });
        expect(res.status, label).toBe(1);
        expect(res.output, label).not.toContain('window_doors=');
      } finally {
        rmSync(t.dir, { recursive: true, force: true });
      }
    }
  });

  it('refuses a carried door while a live owner window moves the cutover off the daily freeze', () => {
    const t = tree({
      'server/src/a.ts': ENGINE,
      'supabase/migrations/20990101000000_window_door.sql': windowMigration(),
      'server/release/activation-floor.json': JSON.stringify({
        schema: 'engine-release-activation-floor/v2-owner-window',
        ownerWindowId: 'w1',
        expiresAt: '2099-01-01T12:00:00Z',
      }),
    });
    try {
      const live = t.run({
        history: [],
        env: { ENGINE_DOORS_NOW_MS: String(Date.parse('2099-01-01T11:00:00Z')) },
      });
      expect(live.status).toBe(1);
      expect(live.stdout).toMatch(/::error title=NO DAILY FREEZE FOR A WINDOW DOOR::owner window w1/);
      // Once the owner floor has expired, the routine daily route applies again.
      const expired = t.run({
        history: [],
        env: { ENGINE_DOORS_NOW_MS: String(Date.parse('2099-01-01T13:00:00Z')) },
      });
      expect(expired.status).toBe(0);
      expect(expired.output).toBe('window_doors=fn_window_door@20990101000000\n');
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it('carries nothing for a rollback and refuses the whole build when any missing door is unsupplied', () => {
    const t = tree({
      'server/src/a.ts': ENGINE + "await supabase.rpc('fn_nobody_creates');\n",
      'supabase/migrations/20990101000000_window_door.sql': windowMigration(),
    });
    try {
      const rollback = t.run({ history: [], env: { ROLLBACK_REQUESTED: 'true' } });
      expect(rollback.status).toBe(0);
      expect(rollback.output).not.toContain('window_doors=');
      const mixed = t.run({ history: [] });
      expect(mixed.status).toBe(1);
      expect(mixed.output).toContain('refusal=missing database function fn_nobody_creates()');
      expect(mixed.output).not.toContain('fn_window_door()');
      expect(mixed.output).not.toContain('window_doors=');
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it('refuses when the supplier history cannot be read (unknown is not "queued")', async () => {
    const mod = await import(SCRIPT);
    const suppliers = new Map([
      ['fn_window_door', [{ file: 'f.sql', version: '20990101000000', slug: 'window_door' }]],
    ]);
    expect(
      mod.classifyMissing({
        missing: ['fn_window_door'],
        suppliers,
        recorded: null,
        ownerWindow: null,
        rollback: false,
      })
    ).toEqual({ carried: [], refused: ['fn_window_door'] });
    expect(mod.liveOwnerWindowFloor(join(tmpdir(), 'no-such-floor.json'))).toBeNull();
  });

  it('sees the incident: 20261101005048 is the queued window supplier of the cancel door', async () => {
    const mod = await import(SCRIPT);
    const found = mod.windowSuppliers(
      ['fn_ca_cancel_tournament_abort_unsettled_hand'],
      resolve(root, 'supabase/migrations')
    );
    expect(found.get('fn_ca_cancel_tournament_abort_unsettled_hand')?.[0]?.version).toBe(
      '20261101005048'
    );
  });
});

describe('the carried doors reach the host before the request does', () => {
  it('the door job outputs them and the deploy job validates and binds them before the intake', () => {
    expect(WF).toContain("window_doors: ${{ steps.doors.outputs.window_doors || '' }}");
    expect(WF).toContain("WINDOW_DOORS: ${{ needs['engine-doors'].outputs.window_doors || '' }}");
    const intake = WF.indexOf('run_remote_intake() {');
    const bind = WF.indexOf('WINDOW_DOORS_FILE="$REQUEST_ROOT/$RUN_KEY.window-doors"', intake);
    const record = WF.indexOf("printf 'engine-window-doors-v1\\n%s\\n' \"$TARGET_SHA\"", bind);
    const install = WF.indexOf('"$STAGE/server/scripts/install-engine-intake.sh"', intake);
    expect(intake).toBeGreaterThan(0);
    expect(bind).toBeGreaterThan(intake);
    expect(record).toBeGreaterThan(bind);
    expect(install).toBeGreaterThan(record);
    expect(WF.slice(bind, install)).toContain('already has a release request and no window-doors record');
    expect(WF.slice(bind, install)).toContain('cmp -s "$WINDOW_DOORS_TMP" "$WINDOW_DOORS_FILE"');
    expect(WF).toContain("WINDOW_DOORS='$WINDOW_DOORS' GIT_NO_REPLACE_OBJECTS=1 bash -se");
  });

  it('the recovery retires the record after the request, beside the drill record', () => {
    const request = RECOVER.indexOf('bounded_recovery_command 10 rm -f -- "$REQUEST_FILE"');
    const drill = RECOVER.indexOf('bounded_recovery_command 10 rm -f -- "$DRILL_FILE"');
    const doors = RECOVER.indexOf('bounded_recovery_command 10 rm -f -- "$WINDOW_DOORS_FILE"');
    expect(request).toBeGreaterThan(0);
    expect(drill).toBeGreaterThan(request);
    expect(doors).toBeGreaterThan(drill);
  });
});

describe('the host transaction proves the carried doors inside its unchanged budgets', () => {
  const block = TX.slice(
    TX.indexOf('WINDOW_DOORS_FILE="$REQUEST_ROOT/$RUN_ID.window-doors"'),
    TX.indexOf("# Only a rollback drill prepares the seal's audited rollback mode")
  );
  const parse = (record: string | null, mode = '0:600', drill = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'window-doors-record-'));
    try {
      if (record !== null) writeFileSync(join(dir, '7-1.window-doors'), record);
      const script = [
        'set -euo pipefail',
        'die() { echo "FATAL: $*" >&2; exit 1; }',
        `stat() { echo '${mode}'; }`,
        `REQUEST_ROOT='${dir}'; RUN_ID=7-1; SHA=${'a'.repeat(40)}; DRILL_MODE='${drill}'`,
        block,
        'printf "names=%s\\n" "$WINDOW_DOOR_NAMES"',
        'printf "args=%s\\n" "${WINDOW_DOOR_ARGS[*]-}"',
      ].join('\n');
      return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const SHA = 'a'.repeat(40);

  it('reads an exact record, and an absent record is an ordinary release', () => {
    const ok = parse(`engine-window-doors-v1\n${SHA}\nfn_a 20990101000000\nfn_b 20990101000001\n`);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('names=fn_a fn_b');
    expect(ok.stdout).toContain('args=--require-function fn_a --require-function fn_b');
    const none = parse(null);
    expect(none.status).toBe(0);
    expect(none.stdout).toContain('names=\n');
  });

  it('refuses a record that is not exactly what the deploy job writes', () => {
    for (const [label, record, mode, drill] of [
      ['other target', `engine-window-doors-v1\n${'b'.repeat(40)}\nfn_a 20990101000000\n`, '0:600', ''],
      ['schema', `engine-window-doors-v2\n${SHA}\nfn_a 20990101000000\n`, '0:600', ''],
      ['no door', `engine-window-doors-v1\n${SHA}\n`, '0:600', ''],
      ['bad line', `engine-window-doors-v1\n${SHA}\nfn_a;rm 20990101000000\n`, '0:600', ''],
      ['twice', `engine-window-doors-v1\n${SHA}\nfn_a 20990101000000\nfn_a 20990101000001\n`, '0:600', ''],
      ['mode', `engine-window-doors-v1\n${SHA}\nfn_a 20990101000000\n`, '1000:644', ''],
      ['drill', `engine-window-doors-v1\n${SHA}\nfn_a 20990101000000\n`, '0:600', 'rollback'],
    ] as const) {
      const res = parse(record, mode, drill);
      expect(res.status, label).toBe(1);
      expect(res.stderr, label).toMatch(/FATAL: (window-doors record|an engine drill)/);
    }
  });

  it('never requests an off-cycle window and declines any break but the daily one, before the lock', () => {
    // The whole function body: from its header to the first closing brace in column 0.
    const start = TX.indexOf('request_recovery_window() {');
    const request = TX.slice(start, TX.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(0);
    expect(request).toContain('[ -z "${WINDOW_DOOR_NAMES:-}" ] || return 0');
    expect(request.indexOf('[ -z "${WINDOW_DOOR_NAMES:-}" ] || return 0')).toBeLessThan(
      request.indexOf('curl -sS --max-time 5 http://127.0.0.1:8080/health')
    );
    const decline = TX.indexOf('only that freeze installs window doors');
    const lock = TX.indexOf("acquire_engine_lock 'maintenance cutover'");
    const certificate = TX.indexOf('BREAK_REMAINING_MS="$(maintenance_certificate "$ADMISSION_MIN_BREAK_MS")"');
    expect(certificate).toBeGreaterThan(0);
    expect(decline).toBeGreaterThan(certificate);
    expect(lock).toBeGreaterThan(decline);
    expect(TX).toContain('raise SystemExit(0 if (l.hour==4 and l.minute<5) else 1)');
  });

  it('requires the doors in the final pre-seal proof, after the replacement and before the commit', () => {
    const replace = TX.indexOf('ENGINE_UP_LOCK_HELD=1 ENGINE_RELEASE_TOKEN_FD=3');
    const proof = TX.indexOf('"$DATABASE_PROOF" --env-file "$ENV_FILE" --sha "$SHA" --instance-id "$CANDIDATE_INSTANCE"');
    const commit = TX.indexOf('"$RELEASE_SEAL" commit', proof);
    expect(replace).toBeGreaterThan(0);
    expect(proof).toBeGreaterThan(replace);
    expect(commit).toBeGreaterThan(proof);
    expect(TX.slice(proof, commit)).toContain('${WINDOW_DOOR_ARGS[@]+"${WINDOW_DOOR_ARGS[@]}"}');
    expect(TX.slice(proof, commit)).toContain('--max-heartbeat-age-seconds 15');
  });

  it('keeps every pinned ceiling', () => {
    expect(TX).toMatch(/^BREAK_CUTOVER_PROOF_SECONDS=150$/m);
    expect(TX).toMatch(/^BREAK_ROLLBACK_RESERVE_SECONDS=135$/m);
    expect(TX).toMatch(/^LEGACY_CHECKPOINT_BUDGET_SECONDS=40$/m);
    expect(TX).toMatch(/^BREAK_LOCKED_ENTRY_SECONDS=15$/m);
    expect(TX).toContain('[ "$DB_TIMEOUT" -le 60 ] || DB_TIMEOUT=60');
    expect(TX).toContain('[ "$DB_TIMEOUT" -ge 17 ] || die');
  });
});

describe('the database proof reads the doors before the leader, and unknown is a refusal', () => {
  // Drives the real script's main() with its two network reads replaced.
  const drive = (missingAnswers: unknown[], extraArgs: string[] = []) => {
    const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("proof", ${JSON.stringify(PROOF)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
answers = json.loads(sys.argv[1]); calls = []
m.read_fixed_env = lambda p: {"SUPABASE_URL": "https://kuklfnapbkmacvwxktbh.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"}
def missing(base, key, names, timeout):
    calls.append("doors:" + ",".join(names))
    a = answers.pop(0) if answers else answers_last[0]
    if a == "unreadable": raise ValueError("x")
    return m.verify_missing_functions(a, names)
answers_last = [answers[-1] if answers else []]
def leader(base, key, timeout):
    calls.append("leader")
    return ("${'c'.repeat(8)}", "1-abcdef12", 1.0)
m.read_missing_functions = missing; m.read_leader = leader
clock = [0.0]
m.time.monotonic = lambda: clock[0]
def fake_sleep(seconds): clock[0] += seconds
m.time.sleep = fake_sleep
sys.argv = ["proof", "--env-file", "/dev/null", "--sha", "${'c'.repeat(40)}", "--instance-id", "1-abcdef12", "--timeout-seconds", "3", "--poll-seconds", "1"] + json.loads(sys.argv[2])
try:
    m.main(); code = 0
except SystemExit as e:
    code = e.code
print("CALLS=" + json.dumps(calls)); sys.exit(code)
`;
    return spawnSync(
      'python3',
      ['-I', '-c', driver, JSON.stringify(missingAnswers), JSON.stringify(extraArgs)],
      { encoding: 'utf8' }
    );
  };
  const req = ['--require-function', 'fn_a', '--require-function', 'fn_b'];

  it('without carried doors the proof is unchanged: one leader read', () => {
    const res = drive([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('CALLS=["leader"]');
  });

  it('waits for the installer inside its own bounded poll, then proves the leader last', () => {
    const res = drive([['fn_a', 'fn_b'], ['fn_b'], []], req);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('CALLS=["doors:fn_a,fn_b", "doors:fn_a,fn_b", "doors:fn_b", "leader"]');
    expect(res.stdout).toContain('every carried window door exists');
  });

  it('refuses the seal when a door never appears, and names unreadable apart from missing', () => {
    const missing = drive([['fn_b']], req);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/carried window doors never proved; state=missing missing=fn_b/);
    expect(missing.stdout).not.toContain('"leader"');
    const unreadable = drive(['unreadable'], req);
    expect(unreadable.status).toBe(1);
    expect(unreadable.stderr).toMatch(/state=unreadable missing=fn_a,fn_b/);
    // An answer naming a function it was not asked about is unreadable too.
    const stranger = drive([['fn_zz']], req);
    expect(stranger.status).toBe(1);
    expect(stranger.stderr).toMatch(/state=unreadable/);
  });

  it('refuses malformed or duplicate names before any read', () => {
    for (const bad of [
      ['--require-function', 'fn;drop'],
      ['--require-function', 'fn_a', '--require-function', 'fn_a'],
    ]) {
      const res = drive([[]], bad);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('required function names are outside the bounded contract');
      expect(res.stdout).toContain('CALLS=[]');
    }
  });
});

describe('the catalog read is a read and nothing else', () => {
  it('is STABLE, invoker, pinned, service-role only, one transaction, and not a window migration', () => {
    expect(MIGRATION).toMatch(/CREATE FUNCTION public\.fn_ca_engine_release_missing_functions\(p_names text\[\]\)/);
    expect(MIGRATION).toMatch(/^STABLE$/m);
    expect(MIGRATION).toMatch(/^SECURITY INVOKER$/m);
    expect(MIGRATION).toMatch(/^SET search_path = pg_catalog$/m);
    expect(MIGRATION).toContain('FROM PUBLIC, anon, authenticated;');
    expect(MIGRATION).toContain('TO service_role;');
    expect(MIGRATION.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(MIGRATION).not.toContain('@install-window');
    expect(read('server/scripts/engine-release-database-proof.py')).toContain(
      'MISSING_FUNCTIONS_RPC = "fn_ca_engine_release_missing_functions"'
    );
  });
});
