/**
 * LAW: POSTGRESQL IS INSTALLED BY ONE SHARED INSTALLER, WITH BOUNDED RETRIES
 * (2026-11-07).
 *
 * About seventy jobs inlined "Install PostgreSQL 17 from the signed PGDG
 * source only". Each copy failed alone when the network blinked: the key
 * download died with curl (55) SSL EOF several times a day (#9950 moved the
 * key into the checkout), and the apt-get update/install calls had no retry.
 * Every workflow now uses .github/actions/install-postgres-17 (or runs its
 * install.sh), so the retry and the trust controls live in one file.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const WF = join(ROOT, '.github/workflows');
const ACTION = join(ROOT, '.github/actions/install-postgres-17');
const SH = readFileSync(join(ACTION, 'install.sh'), 'utf8');

describe('one shared PostgreSQL installer', () => {
  it('no workflow inlines its own PGDG install', () => {
    const inline: string[] = [];
    let users = 0;
    for (const f of readdirSync(WF).filter((n) => /\.ya?ml$/.test(n))) {
      const raw = readFileSync(join(WF, f), 'utf8');
      if (
        /apt\.postgresql\.org|Dir::Etc::sourceparts|pgdg\.sources|apt\.postgresql\.org\.sh/.test(
          raw
        )
      )
        inline.push(f);
      users += (raw.match(/\.github\/actions\/install-postgres-17/g) ?? []).length;
    }
    expect(inline).toEqual([]);
    expect(users).toBeGreaterThanOrEqual(70);
  });

  it('the action runs exactly the shared script', () => {
    const action = parse(readFileSync(join(ACTION, 'action.yml'), 'utf8'));
    expect(action.runs.using).toBe('composite');
    expect(action.runs.steps).toHaveLength(1);
    expect(action.runs.steps[0].run).toBe('bash "$GITHUB_ACTION_PATH/install.sh"');
    expect(action.runs.steps[0].env.PG_PACKAGES).toBe('${{ inputs.packages }}');
    expect(action.inputs.packages.default).toBe('postgresql-17');
  });

  it('keeps apt to the signed Ubuntu and PGDG sources, the checkout key and no default cluster', () => {
    expect(SH).toContain('-o "Dir::Etc::sourcelist=/dev/null"');
    expect(SH).toContain('-o "Dir::Etc::sourceparts=$pg_sources"');
    expect(SH).toContain('cp /etc/apt/sources.list.d/ubuntu.sources "$pg_sources/ubuntu.sources"');
    expect(SH).toContain('sudo install -m 0644 "$PG_KEY_SRC" "$PG_KEY_DST"');
    expect(SH).toContain(
      "printf 'create_main_cluster = false\\n' | sudo tee /etc/postgresql-common/createcluster.conf"
    );
    expect(SH.indexOf('create_main_cluster')).toBeLessThan(SH.lastIndexOf('"${pg_packages[@]}"'));
    expect(SH).not.toMatch(
      /--insecure|--allow-unauthenticated|trusted=yes|AllowInsecureRepositories/
    );
  });

  it('every apt call is retried, bounded, and an index fetch failure fails the update', () => {
    const aptCalls = SH.split('\n').filter(
      (l) => /sudo apt-get /.test(l) && !l.includes('--simulate')
    );
    expect(aptCalls).toHaveLength(4);
    for (const l of aptCalls)
      expect(l.trimStart().startsWith('pg_attempt sudo apt-get "${pg_apt[@]}"'), l).toBe(true);
    expect(SH).toContain('-o "Acquire::Retries=5"');
    expect(SH).toContain('pg_update=(-o "APT::Update::Error-Mode=any")');
    expect(SH).toMatch(/max=\$\{PG_APT_ATTEMPTS:-4\}/);
  });

  it('retries a failing command a bounded number of times, then fails', () => {
    const box = mkdtempSync(join(tmpdir(), 'pg-attempt-'));
    try {
      const fn = SH.slice(
        SH.indexOf('pg_attempt() {'),
        SH.indexOf('\n}\n', SH.indexOf('pg_attempt() {')) + 3
      );
      const counter = join(box, 'n');
      writeFileSync(
        join(box, 'flaky'),
        `#!/bin/bash\nn=$(( $(cat '${counter}' 2>/dev/null || echo 0) + 1 ))\necho $n > '${counter}'\n[ $n -ge "$1" ]\n`
      );
      chmodSync(join(box, 'flaky'), 0o755);
      const run = (needed: number) => {
        rmSync(counter, { force: true });
        const r = spawnSync('bash', ['-c', `${fn}\npg_attempt "${join(box, 'flaky')}" ${needed}`], {
          encoding: 'utf8',
          env: { ...process.env, PG_APT_ATTEMPTS: '3', PG_APT_DELAY: '0' },
        });
        return { status: r.status, tries: Number(readFileSync(counter, 'utf8')), err: r.stderr };
      };
      expect(run(3)).toMatchObject({ status: 0, tries: 3 });
      const failed = run(9);
      expect(failed).toMatchObject({ status: 1, tries: 3 });
      expect(failed.err).toContain('failed after 3 attempts');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it.each([
    ['true', false, 'postgresql-17', 0],
    ['false', false, 'postgresql-17', 0],
    ['true', true, 'postgresql-17', 1],
    ['true', false, 'postgresql-17=17.12-1.pgdg26.04+1', 1],
  ])(
    'binds only explicit isolation toolchains to their source version (%s, %s, %s)',
    (enabled, missing, server, status) => {
      const fn = SH.slice(
        SH.indexOf('pg_pin_isolation_toolchain() {'),
        SH.indexOf('\n}\n', SH.indexOf('pg_pin_isolation_toolchain() {')) + 3
      );
      const script = `${fn}
pg_packages=(${server} postgresql-17-cron postgresql-server-dev-17 build-essential)
pg_apt=()
apt-cache() {
  printf 'pkg | 17.12-1.pgdg26.04+1 | signed\\n'
  if [ "$MISSING" != true ]; then printf 'pkg | 17.11-1.pgdg26.04+2 | signed\\n'; fi
}
pg_pin_isolation_toolchain || exit $?
printf '%s\\n' "\${pg_packages[@]}"
`;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_WORKSPACE: ROOT,
          PG_ISOLATION_TOOLCHAIN: String(enabled),
          MISSING: String(missing),
        },
      });
      expect(result.status, result.stderr).toBe(status);
      if (status === 0 && enabled === 'true') {
        for (const name of ['postgresql-17', 'postgresql-client-17', 'postgresql-server-dev-17'])
          expect(result.stdout).toContain(`${name}=17.11-1.pgdg26.04+2`);
        expect(result.stdout).toContain('build-essential');
        expect(result.stdout).toContain('postgresql-17-cron');
      } else if (status === 0) expect(result.stdout).not.toContain('postgresql-17=');
      else expect(result.stderr).toMatch(/No signed|conflicts with qualified/);
    }
  );
  it('opts only the native isolation source-build shard into exact toolchain matching', () => {
    const ci = readFileSync(join(WF, 'ci.yml'), 'utf8');
    expect(ci).toContain("PG_ISOLATION_TOOLCHAIN: ${{ matrix.shard == 3 && 'true' || 'false' }}");
    expect(SH.indexOf('pg_pin_isolation_toolchain\n')).toBeLessThan(
      SH.indexOf('# PGDG can publish an extension rebuild')
    );
    expect(readFileSync(join(ROOT, 'scripts/ci/build_pg17_isolationtester.py'), 'utf8')).toContain(
      "VERSION = '17.11'"
    );
  });

  it('refuses to run without the checkout key', () => {
    const box = mkdtempSync(join(tmpdir(), 'pg-nokey-'));
    try {
      mkdirSync(join(box, 'tmp'));
      const r = spawnSync('/bin/bash', [join(ACTION, 'install.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_WORKSPACE: box,
          RUNNER_TEMP: join(box, 'tmp'),
          PATH: '/nonexistent',
        },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('.github/pgdg/apt.postgresql.org.asc is missing');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });
  it('selects the newest installable signed cron version and refuses an unsolvable set', () => {
    const box = mkdtempSync(join(tmpdir(), 'pg-compatible-'));
    try {
      const start = SH.indexOf(
        'if printf \'%s\\n\' "${pg_packages[@]}" | grep -qx postgresql-17-cron;'
      );
      expect(start).toBeGreaterThan(0);
      const block = SH.slice(start, SH.indexOf('\npg_attempt sudo apt-get', start));
      const script = `
pg_packages=(postgresql-17 postgresql-17-cron postgresql-server-dev-17)
pg_apt=()
apt-cache() {
  if [ "$1" = policy ]; then echo 'Candidate: 17.11'; else
    printf 'postgresql-17-cron | 1.6.8+3 | signed\\npostgresql-17-cron | 1.6.8+2 | signed\\n'
  fi
}
sudo() {
  printf '%s\\n' "$*" >> '${box}/calls'
  case "$*" in *postgresql-17-cron=1.6.8+2*) [ "$SOLVABLE" = yes ];; *) return 1;; esac
}
${block}
printf '%s\\n' "\${pg_packages[@]}"
`;
      for (const solvable of ['yes', 'no']) {
        const r = spawnSync('bash', ['-c', script], {
          encoding: 'utf8',
          env: { ...process.env, SOLVABLE: solvable },
        });
        expect(r.status).toBe(solvable === 'yes' ? 0 : 1);
        if (solvable === 'yes') expect(r.stdout).toContain('postgresql-17-cron=1.6.8+2');
        else expect(r.stderr).toContain('No signed pg_cron package solves');
      }
      const calls = readFileSync(join(box, 'calls'), 'utf8');
      expect(calls).toContain('--simulate install');
      expect(calls).toContain('postgresql-server-dev-17');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });
});
