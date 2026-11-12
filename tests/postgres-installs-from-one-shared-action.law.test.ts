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

  it('matches the pinned native tool minor when the signed feed advances', () => {
    const start = SH.indexOf('pg_match_tool_version() {');
    expect(start).toBeGreaterThan(0);
    const fn = SH.slice(start, SH.indexOf('\n}\n', start) + 3);
    const run = (
      required: string,
      indexed = '17.11-1.signed',
      packages = 'postgresql-17 postgresql-17-cron postgresql-server-dev-17 build-essential'
    ) =>
      spawnSync(
        '/bin/bash',
        [
          '-eu',
          '-c',
          `${fn}
pg_packages=(${packages})
pg_apt=(-o Dir::Etc::sourcelist=/dev/null -o Dir::Etc::sourceparts=/signed)
apt-cache() {
  [[ " $* " == *" Dir::Etc::sourceparts=/signed "* ]] || return 99
  printf 'package | 17.12-1.signed | signed\\npackage | %s | signed\\n' "$INDEXED"
}
pg_match_tool_version
printf 'SELECTED:%s\\n' "${'${pg_packages[*]}'}"
`,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PG_REQUIRED_VERSION: required, INDEXED: indexed },
        }
      );
    const matched = run('17.11');
    expect(matched.status, matched.stderr).toBe(0);
    expect(matched.stdout).toContain(
      'SELECTED:postgresql-17=17.11-1.signed postgresql-17-cron postgresql-server-dev-17=17.11-1.signed build-essential'
    );
    expect(run('17.12').stdout).toContain('postgresql-17=17.12-1.signed');
    const missing = run('17.10');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('No signed postgresql-17 version matches 17.10');
    expect(run('17.1', '17.11-1.signed').status).toBe(1);
    expect(run('18.1').status).toBe(1);
    expect(run('17.11;false').status).toBe(1);
    expect(run('').stdout).toContain(
      'SELECTED:postgresql-17 postgresql-17-cron postgresql-server-dev-17 build-essential'
    );
    const exact = run('17.11', '', 'postgresql-17=17.11-exact postgresql-17-cron');
    expect(exact.status, exact.stderr).toBe(0);
    expect(exact.stdout).toContain('SELECTED:postgresql-17=17.11-exact postgresql-17-cron');
    expect(SH.indexOf('pg_match_tool_version\n')).toBeLessThan(SH.indexOf('# PGDG can publish'));
    expect(SH).toContain(
      '[ -z "${PG_REQUIRED_VERSION:-}" ] || pg_version_options=(--allow-downgrades)'
    );
  });

  it('keeps the default install valid on Bash 3.2 and allows only explicit pinned downgrades', () => {
    const begin = SH.indexOf('pg_version_options=()');
    const options = SH.slice(begin, SH.indexOf('# PGDG can publish', begin));
    const install = SH.split('\n').find(
      (line) => line.startsWith('pg_attempt sudo apt-get') && line.includes('"${pg_packages[@]}"')
    );
    expect(install).toBeTruthy();
    for (const required of ['', '17.11']) {
      const r = spawnSync(
        '/bin/bash',
        [
          '-eu',
          '-c',
          `${options}
pg_apt=(signed)
pg_packages=(postgresql-17)
pg_attempt() { printf '%s\\n' "$@"; }
${install}
`,
        ],
        { encoding: 'utf8', env: { ...process.env, PG_REQUIRED_VERSION: required } }
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.includes('--allow-downgrades')).toBe(Boolean(required));
      expect(r.stdout).toContain('postgresql-17');
    }
    const simulation = SH.split('\n').find(
      (line) => line.includes('sudo apt-get') && line.includes('--simulate')
    );
    expect(simulation).toContain('${pg_version_options[@]+"${pg_version_options[@]}"}');
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
