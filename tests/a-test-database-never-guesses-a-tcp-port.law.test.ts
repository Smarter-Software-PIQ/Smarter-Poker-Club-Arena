/**
 * A TEST DATABASE NEVER GUESSES A TCP PORT (2026-11-07).
 *
 * Twelve CI scripts started PostgreSQL with `-h 127.0.0.1` on a port made from
 * the process id (39000 + pid % 9000) or a literal such as 55483, although
 * every client they run connects through the script's own Unix socket. Those
 * ports sit inside Linux's ephemeral range (32768-60999), where any outbound
 * connection on the runner may already own them, and three accounting shards
 * failed with "pg_ctl: could not start server" (2026-11-05..07; #9946 shard 1
 * among them) without the server log that would have said why.
 *
 * Pinned here:
 *   1. a scripts/ci Python harness that makes PostgreSQL listen on TCP gets its
 *      port from the kernel (bind / getsockname), never from a guess;
 *   2. the twelve socket-only harnesses listen on no TCP address at all
 *      (`-c listen_addresses=`) and print the server log when pg_ctl fails;
 *   3. the TLS credential check, which needs TCP, asks the kernel for its port
 *      and hands it to its fixture;
 *   4. (2026-11-24) no vitest test starts PostgreSQL on TCP either. Twelve
 *      tests/unit Postgres tests still drew `20000 + random * 30000` and
 *      listened on 127.0.0.1; PR #11911's first run lost
 *      playedHeadsUpClubRetirement.pg.test.ts to "could not start server" in
 *      1.5 s and passed on a rerun. They now listen on a socket in a directory
 *      of their own (tests/helpers/scratchPostgres.ts) and fail with the server
 *      log when the start fails.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import {
  scratchPostgresListenOptions,
  scratchPostgresSocket,
  showServerLogWhenStartFails,
} from './helpers/scratchPostgres';

const ROOT = join(__dirname, '..');
const CI = join(ROOT, 'scripts', 'ci');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TESTS = join(ROOT, 'tests');
const TCP = /-h\s*['"]?127\.0\.0\.1|listen_addresses\s*=\s*'(127\.0\.0\.1|\*|localhost)'/;

const SOCKET_ONLY = [
  'addon-after-entry-levels',
  'bounty-only-final-two-make-good',
  'bounty-only-pko-final-two',
  'cashier-value-tickets',
  'final-two-close-held-place-two',
  'midway-free-buy-pko',
  'midway-free-buy-rotation',
  'quick-club-opening',
  'realtime-revive-is-recorded',
  'satellite-entry-prices',
  'sweep-gate-pending-bounty-work',
  'tournament-entry-boundary',
].map((n) => `scripts/ci/test-${n}.py`);

describe('a test database never guesses a TCP port', () => {
  it('every scripts/ci Python harness that listens on TCP takes its port from the kernel', () => {
    const guessing = readdirSync(CI)
      .filter((f) => f.endsWith('.py'))
      .map((f) => [f, readFileSync(join(CI, f), 'utf8')] as const)
      .filter(([, s]) => s.includes('pg_ctl') && TCP.test(s) && !/getsockname|\.bind\(/.test(s))
      .map(([f]) => f);
    expect(guessing).toEqual([]);
  });

  it.each(SOCKET_ONLY)(
    '%s listens only on its own socket and shows the server log when start fails',
    (file) => {
      const s = read(file);
      expect(s).not.toMatch(TCP);
      expect(s).toContain('-c listen_addresses=');
      expect(s).toMatch(/read_text\(\) if [^\n]*\.exists\(\)/);
    }
  );

  it('the TLS credential check asks the kernel for its port and passes it to its fixture', () => {
    const sh = read('scripts/ci/test-private-record-credentials-postgres.sh');
    const fixture = read('scripts/ci/fixtures/private-record-credentials-postgres.mjs');
    expect(sh).toMatch(/s\.bind\(\("127\.0\.0\.1",0\)\)/);
    expect(sh).toContain('export PRIVATE_RECORD_PG_PORT="$port"');
    expect(sh).not.toMatch(/-p 5\d{4}/);
    expect(fixture).toContain('process.env.PRIVATE_RECORD_PG_PORT');
    expect(fixture.match(/port: PG_PORT/g)).toHaveLength(5);
  });

  it('no vitest test starts PostgreSQL on TCP or on a guessed port', () => {
    // The index, not a directory walk: one read of tracked files, so the law costs the same on a loaded disk.
    const files = execFileSync(
      'git',
      ['grep', '-l', 'pg_ctl', '--', 'tests/*.ts', 'tests/*.tsx', 'tests/*.mjs', 'tests/*.js'],
      { cwd: ROOT, encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .map((f) => join(ROOT, f));
    const self = join(TESTS, 'a-test-database-never-guesses-a-tcp-port.law.test.ts');
    const starters = files.filter((f) => f !== self);
    expect(starters.length).toBeGreaterThan(12);
    const tcp = starters
      .filter((f) => {
        const s = readFileSync(f, 'utf8');
        return (
          TCP.test(s) ||
          /PG(HOST|_HOST)\s*:\s*['"](127\.0\.0\.1|localhost)['"]/.test(s) ||
          /Math\.random\(\)\s*\*\s*\d{3,}/.test(s)
        );
      })
      .map((f) => relative(ROOT, f));
    expect(tcp).toEqual([]);
  });

  it('the scratch-Postgres helper listens on its own socket only and shows the server log on a failed start', () => {
    const socket = scratchPostgresSocket();
    try {
      expect(join(socket, '.s.PGSQL.5432').length).toBeLessThanOrEqual(100);
      const options = scratchPostgresListenOptions(socket);
      expect(options).toContain(`-k '${socket}'`);
      expect(options).toContain("-c listen_addresses=''");
      expect(options).not.toMatch(TCP);
      const other = scratchPostgresSocket();
      rmSync(other, { recursive: true, force: true });
      expect(other).not.toBe(socket);
      const log = join(socket, 'postgres.log');
      writeFileSync(
        log,
        'FATAL:  could not bind IPv4 address "127.0.0.1": Address already in use\n'
      );
      expect(() =>
        showServerLogWhenStartFails(log, () => {
          throw new Error('pg_ctl: could not start server');
        })
      ).toThrow(/could not start server[\s\S]*Address already in use/);
      expect(showServerLogWhenStartFails(log, () => 'started')).toBe('started');
    } finally {
      rmSync(socket, { recursive: true, force: true });
    }
  });
});
